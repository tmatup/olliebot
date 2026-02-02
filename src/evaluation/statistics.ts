/**
 * StatisticsEngine - Handles statistical analysis for evaluation comparisons
 *
 * Provides:
 * - Descriptive statistics (mean, median, std dev)
 * - Confidence intervals
 * - Statistical significance tests (Welch's t-test)
 * - Effect size calculations (Cohen's d)
 */

import type {
  SingleRunResult,
  AggregatedResults,
  StatisticalSummary,
  ComparisonResult,
} from './types.js';

export class StatisticsEngine {
  /**
   * Aggregate multiple run results into statistical summaries
   */
  aggregateResults(
    runs: SingleRunResult[],
    promptType: 'baseline' | 'alternative'
  ): AggregatedResults {
    const toolScores = runs.map(r => r.toolSelectionScore);
    const responseScores = runs.map(r => r.responseQualityScore);
    const delegationScores = runs
      .filter(r => r.delegationScore !== undefined)
      .map(r => r.delegationScore!);
    const overallScores = runs.map(r => r.overallScore);

    // Calculate element pass rates
    const elementPassRates: Record<string, number> = {};
    const allElements = new Set(runs.flatMap(r => r.elementResults.map(e => e.elementId)));

    for (const elementId of allElements) {
      const passes = runs.filter(r =>
        r.elementResults.find(e => e.elementId === elementId)?.matched
      ).length;
      elementPassRates[elementId] = passes / runs.length;
    }

    return {
      promptType,
      runs,
      toolSelectionScore: this.summarize(toolScores),
      responseQualityScore: this.summarize(responseScores),
      delegationScore: delegationScores.length > 0 ? this.summarize(delegationScores) : undefined,
      overallScore: this.summarize(overallScores),
      elementPassRates,
    };
  }

  /**
   * Calculate statistical summary for a set of samples
   */
  summarize(samples: number[], confidenceLevel = 0.95): StatisticalSummary {
    if (samples.length === 0) {
      return {
        mean: 0,
        median: 0,
        stdDev: 0,
        min: 0,
        max: 0,
        confidenceInterval: [0, 0],
        samples: [],
      };
    }

    const n = samples.length;
    const sorted = [...samples].sort((a, b) => a - b);

    // Mean
    const mean = samples.reduce((a, b) => a + b, 0) / n;

    // Median
    const median = n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];

    // Standard deviation (sample)
    const variance = n > 1
      ? samples.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / (n - 1)
      : 0;
    const stdDev = Math.sqrt(variance);

    // Confidence interval (using t-distribution)
    const tValue = this.getTValue(Math.max(1, n - 1), confidenceLevel);
    const marginOfError = n > 0 ? tValue * (stdDev / Math.sqrt(n)) : 0;

    return {
      mean,
      median,
      stdDev,
      min: sorted[0],
      max: sorted[n - 1],
      confidenceInterval: [mean - marginOfError, mean + marginOfError],
      samples,
    };
  }

  /**
   * Compare two sets of results using Welch's t-test
   */
  welchTTest(
    baseline: AggregatedResults,
    alternative: AggregatedResults,
    confidenceLevel = 0.95
  ): ComparisonResult['comparison'] {
    const baselineScores = baseline.overallScore.samples;
    const altScores = alternative.overallScore.samples;

    const n1 = baselineScores.length;
    const n2 = altScores.length;

    if (n1 < 2 || n2 < 2) {
      // Not enough samples for statistical comparison
      return {
        overallScoreDifference: alternative.overallScore.mean - baseline.overallScore.mean,
        pValue: 1.0,
        isSignificant: false,
        confidenceLevel,
        effectSize: 0,
        recommendation: 'inconclusive',
      };
    }

    const mean1 = baseline.overallScore.mean;
    const mean2 = alternative.overallScore.mean;
    const var1 = Math.pow(baseline.overallScore.stdDev, 2);
    const var2 = Math.pow(alternative.overallScore.stdDev, 2);

    // Handle zero variance edge cases
    if (var1 === 0 && var2 === 0) {
      // Both samples have no variance - compare means directly
      const diff = mean2 - mean1;
      return {
        overallScoreDifference: diff,
        pValue: diff === 0 ? 1.0 : 0.0,
        isSignificant: diff !== 0,
        confidenceLevel,
        effectSize: 0,
        recommendation: diff > 0 ? 'adopt-alternative' : (diff < 0 ? 'keep-baseline' : 'inconclusive'),
      };
    }

    // Welch's t-statistic
    const denominator = Math.sqrt(var1 / n1 + var2 / n2);
    if (denominator === 0) {
      return {
        overallScoreDifference: mean2 - mean1,
        pValue: 1.0,
        isSignificant: false,
        confidenceLevel,
        effectSize: 0,
        recommendation: 'inconclusive',
      };
    }

    const t = (mean2 - mean1) / denominator;

    // Welch-Satterthwaite degrees of freedom
    const numerator = Math.pow(var1 / n1 + var2 / n2, 2);
    const denomDF = Math.pow(var1 / n1, 2) / (n1 - 1) + Math.pow(var2 / n2, 2) / (n2 - 1);
    const df = denomDF > 0 ? numerator / denomDF : 1;

    // Calculate p-value (two-tailed)
    const pValue = this.tDistributionPValue(Math.abs(t), df);

    // Effect size (Cohen's d)
    const pooledStd = Math.sqrt(
      ((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2)
    );
    const effectSize = pooledStd > 0 ? (mean2 - mean1) / pooledStd : 0;

    const isSignificant = pValue < (1 - confidenceLevel);
    const scoreDiff = mean2 - mean1;

    let recommendation: 'keep-baseline' | 'adopt-alternative' | 'inconclusive';
    if (!isSignificant) {
      recommendation = 'inconclusive';
    } else if (scoreDiff > 0) {
      recommendation = 'adopt-alternative';
    } else {
      recommendation = 'keep-baseline';
    }

    return {
      overallScoreDifference: scoreDiff,
      pValue,
      isSignificant,
      confidenceLevel,
      effectSize,
      recommendation,
    };
  }

  /**
   * Interpret effect size (Cohen's d)
   */
  interpretEffectSize(d: number): 'negligible' | 'small' | 'medium' | 'large' {
    const absD = Math.abs(d);
    if (absD < 0.2) return 'negligible';
    if (absD < 0.5) return 'small';
    if (absD < 0.8) return 'medium';
    return 'large';
  }

  /**
   * Detect outliers using IQR method
   */
  detectOutliers(samples: number[]): { indices: number[]; method: string } {
    if (samples.length < 4) {
      return { indices: [], method: 'IQR (insufficient data)' };
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const q1Index = Math.floor(sorted.length * 0.25);
    const q3Index = Math.floor(sorted.length * 0.75);
    const q1 = sorted[q1Index];
    const q3 = sorted[q3Index];
    const iqr = q3 - q1;
    const lower = q1 - 1.5 * iqr;
    const upper = q3 + 1.5 * iqr;

    const indices = samples
      .map((s, i) => (s < lower || s > upper ? i : -1))
      .filter(i => i !== -1);

    return { indices, method: 'IQR' };
  }

  /**
   * Get t-value for given degrees of freedom and confidence level
   * Uses a lookup table approximation
   */
  private getTValue(df: number, confidence: number): number {
    // T-value lookup tables for common confidence levels
    const t95: Record<number, number> = {
      1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
      6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
      15: 2.131, 20: 2.086, 25: 2.060, 30: 2.042, 40: 2.021,
      50: 2.009, 60: 2.000, 80: 1.990, 100: 1.984, 120: 1.980,
    };

    const t99: Record<number, number> = {
      1: 63.657, 2: 9.925, 3: 5.841, 4: 4.604, 5: 4.032,
      6: 3.707, 7: 3.499, 8: 3.355, 9: 3.250, 10: 3.169,
      15: 2.947, 20: 2.845, 25: 2.787, 30: 2.750, 40: 2.704,
      50: 2.678, 60: 2.660, 80: 2.639, 100: 2.626, 120: 2.617,
    };

    const table = confidence >= 0.99 ? t99 : t95;

    // Find closest df in table
    const dfs = Object.keys(table).map(Number).sort((a, b) => a - b);
    let closestDf = dfs[0];

    for (const tableDf of dfs) {
      if (tableDf <= df) {
        closestDf = tableDf;
      } else {
        break;
      }
    }

    // For very large df, use z-value approximation
    if (df > 120) {
      return confidence >= 0.99 ? 2.576 : 1.96;
    }

    return table[closestDf] || (confidence >= 0.99 ? 2.576 : 1.96);
  }

  /**
   * Calculate p-value from t-distribution
   * Uses approximation for computational efficiency
   */
  private tDistributionPValue(t: number, df: number): number {
    // For large df, approximate with normal distribution
    if (df > 100) {
      return 2 * (1 - this.normalCDF(t));
    }

    // For smaller df, use a better approximation
    // Based on approximation: P(T > t) ≈ P(Z > t * sqrt(df / (df + t^2)))
    const adjusted = t * Math.sqrt(df / (df + t * t));
    return 2 * (1 - this.normalCDF(adjusted));
  }

  /**
   * Standard normal CDF approximation (Abramowitz and Stegun)
   */
  private normalCDF(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return 0.5 * (1.0 + sign * y);
  }

  /**
   * Calculate percentage improvement
   */
  percentageImprovement(baseline: number, alternative: number): number {
    if (baseline === 0) return alternative > 0 ? 100 : 0;
    return ((alternative - baseline) / baseline) * 100;
  }

  /**
   * Format summary for display
   */
  formatSummary(summary: StatisticalSummary): string {
    return `${summary.mean.toFixed(3)} ± ${summary.stdDev.toFixed(3)} [${summary.confidenceInterval[0].toFixed(3)}, ${summary.confidenceInterval[1].toFixed(3)}]`;
  }
}
