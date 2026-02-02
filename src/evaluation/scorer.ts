/**
 * Scorer - Calculates scores based on evaluation criteria
 *
 * Responsibilities:
 * - Score tool selection accuracy
 * - Score response quality (required/optional elements)
 * - Score delegation decisions
 * - Handle semantic matching via LLM
 */

import type { LLMService } from '../llm/service.js';
import type {
  EvaluationDefinition,
  ToolCallResult,
  ElementMatchResult,
  ResponseElement,
  MatchType,
  DelegationExpectations,
  DelegationDecision,
  ScoringConfig,
  DEFAULT_SCORING,
  ToolExpectation,
  ParameterExpectation,
} from './types.js';
import type { RecordedToolCall } from './mocked-tool-runner.js';

export interface ScoringResult {
  toolSelectionScore: number;
  responseQualityScore: number;
  delegationScore?: number;
  overallScore: number;
  elementResults: ElementMatchResult[];
  constraintViolations: string[];
  toolCallResults: ToolCallResult[];
}

export class Scorer {
  private llmService: LLMService;

  constructor(llmService: LLMService) {
    this.llmService = llmService;
  }

  /**
   * Score all aspects of an evaluation run
   */
  async score(
    definition: EvaluationDefinition,
    response: string,
    recordedToolCalls: RecordedToolCall[],
    delegationDecision?: DelegationDecision
  ): Promise<ScoringResult> {
    const scoring = definition.scoring || this.getDefaultScoring();

    // Score tool selection
    const { score: toolScore, toolCallResults } = this.scoreToolSelection(
      definition,
      recordedToolCalls
    );

    // Score response quality
    const {
      score: responseScore,
      elementResults,
      constraintViolations,
    } = await this.scoreResponse(definition, response);

    // Score delegation (if applicable)
    const delegationScore = delegationDecision && definition.delegationExpectations
      ? this.scoreDelegation(definition.delegationExpectations, delegationDecision)
      : undefined;

    // Calculate weighted overall score
    let overallScore = 0;
    let totalWeight = 0;

    overallScore += toolScore * scoring.toolSelection.weight;
    totalWeight += scoring.toolSelection.weight;

    overallScore += responseScore * scoring.responseQuality.weight;
    totalWeight += scoring.responseQuality.weight;

    if (delegationScore !== undefined && scoring.delegationAccuracy) {
      overallScore += delegationScore * scoring.delegationAccuracy.weight;
      totalWeight += scoring.delegationAccuracy.weight;
    }

    overallScore = totalWeight > 0 ? overallScore / totalWeight : 0;

    return {
      toolSelectionScore: toolScore,
      responseQualityScore: responseScore,
      delegationScore,
      overallScore,
      elementResults,
      constraintViolations,
      toolCallResults,
    };
  }

  /**
   * Score tool selection accuracy
   */
  private scoreToolSelection(
    definition: EvaluationDefinition,
    recordedToolCalls: RecordedToolCall[]
  ): { score: number; toolCallResults: ToolCallResult[] } {
    const toolCallResults: ToolCallResult[] = [];

    // If no tool expectations, full score
    if (!definition.toolExpectations) {
      return { score: 1.0, toolCallResults };
    }

    const expectations = definition.toolExpectations;
    const scoring = definition.scoring?.toolSelection.criteria || {
      correct_tools_called: 0.5,
      correct_parameters: 0.3,
      no_forbidden_tools: 0.2,
    };

    // Build tool call results with analysis
    for (let i = 0; i < recordedToolCalls.length; i++) {
      const call = recordedToolCalls[i];
      const expectation = expectations.expectedTools.find(e => e.name === call.toolName);
      const wasForbidden = expectations.forbiddenTools?.includes(call.toolName) || false;

      let parameterMatchScore = 1.0;
      if (expectation?.parameters) {
        parameterMatchScore = this.scoreParameters(call.parameters, expectation.parameters);
      }

      toolCallResults.push({
        toolName: call.toolName,
        parameters: call.parameters,
        wasExpected: !!expectation,
        wasForbidden,
        parameterMatchScore,
        executionOrder: i,
      });
    }

    // Calculate scores
    let score = 0;

    // Score: correct tools called
    const requiredTools = expectations.expectedTools.filter(t => t.required);
    const calledToolNames = new Set(recordedToolCalls.map(c => c.toolName));
    const correctToolsCalled = requiredTools.filter(t => calledToolNames.has(t.name)).length;
    const correctToolsScore = requiredTools.length > 0
      ? correctToolsCalled / requiredTools.length
      : 1.0;
    score += correctToolsScore * (scoring.correct_tools_called || 0);

    // Score: correct parameters
    const toolsWithParamExpectations = toolCallResults.filter(
      r => r.wasExpected && expectations.expectedTools.find(e => e.name === r.toolName)?.parameters
    );
    const avgParamScore = toolsWithParamExpectations.length > 0
      ? toolsWithParamExpectations.reduce((sum, r) => sum + r.parameterMatchScore, 0) /
        toolsWithParamExpectations.length
      : 1.0;
    score += avgParamScore * (scoring.correct_parameters || 0);

    // Score: no forbidden tools
    const forbiddenCalled = toolCallResults.filter(r => r.wasForbidden).length;
    const noForbiddenScore = forbiddenCalled === 0 ? 1.0 : 0.0;
    score += noForbiddenScore * (scoring.no_forbidden_tools || 0);

    return { score, toolCallResults };
  }

  /**
   * Score parameter matching
   */
  private scoreParameters(
    actualParams: Record<string, unknown>,
    expectedParams: Record<string, ParameterExpectation>
  ): number {
    let matchedCount = 0;
    let totalExpected = Object.keys(expectedParams).length;

    if (totalExpected === 0) return 1.0;

    for (const [paramName, expectation] of Object.entries(expectedParams)) {
      const actualValue = actualParams[paramName];

      if (actualValue === undefined) {
        continue; // Parameter not provided
      }

      const matched = this.matchParameterValue(actualValue, expectation);
      if (matched) {
        matchedCount++;
      }
    }

    return matchedCount / totalExpected;
  }

  /**
   * Match a parameter value against expectation
   */
  private matchParameterValue(
    actual: unknown,
    expectation: ParameterExpectation
  ): boolean {
    const actualStr = String(actual);

    switch (expectation.matchType) {
      case 'exact':
        return actual === expectation.expected;

      case 'contains':
        return actualStr.toLowerCase().includes(String(expectation.expected).toLowerCase());

      case 'regex':
        if (expectation.pattern) {
          return new RegExp(expectation.pattern, 'i').test(actualStr);
        }
        return false;

      case 'semantic':
        // For parameters, fall back to contains matching
        // (semantic matching is expensive for parameters)
        return actualStr.toLowerCase().includes(String(expectation.expected).toLowerCase());

      default:
        // Handle range matching for numbers
        if (typeof actual === 'number') {
          if (expectation.min !== undefined && actual < expectation.min) return false;
          if (expectation.max !== undefined && actual > expectation.max) return false;
          return true;
        }
        return false;
    }
  }

  /**
   * Score response quality
   */
  private async scoreResponse(
    definition: EvaluationDefinition,
    response: string
  ): Promise<{
    score: number;
    elementResults: ElementMatchResult[];
    constraintViolations: string[];
  }> {
    const expectations = definition.responseExpectations;
    const scoring = definition.scoring?.responseQuality.criteria || {
      required_elements: 0.6,
      optional_elements: 0.2,
      constraints_met: 0.2,
    };

    // Match required elements
    const requiredResults = await this.matchElements(
      expectations.requiredElements,
      response
    );

    // Match optional elements
    const optionalResults = expectations.optionalElements
      ? await this.matchElements(expectations.optionalElements, response)
      : [];

    // Check constraints
    const constraintViolations = this.checkConstraints(
      expectations.constraints,
      response
    );

    // Calculate scores
    const requiredScore = this.calculateElementScore(
      expectations.requiredElements,
      requiredResults
    );

    const optionalScore = expectations.optionalElements
      ? this.calculateElementScore(expectations.optionalElements, optionalResults)
      : 1.0;

    const constraintScore = constraintViolations.length === 0 ? 1.0 : 0.5;

    const score =
      requiredScore * (scoring.required_elements || 0) +
      optionalScore * (scoring.optional_elements || 0) +
      constraintScore * (scoring.constraints_met || 0);

    return {
      score,
      elementResults: [...requiredResults, ...optionalResults],
      constraintViolations,
    };
  }

  /**
   * Match elements against response using appropriate matching strategy
   */
  private async matchElements(
    elements: ResponseElement[],
    response: string
  ): Promise<ElementMatchResult[]> {
    const results: ElementMatchResult[] = [];

    for (const element of elements) {
      const result = await this.matchElement(element, response);
      results.push(result);
    }

    return results;
  }

  /**
   * Match a single element using its match type
   */
  private async matchElement(
    element: ResponseElement,
    response: string
  ): Promise<ElementMatchResult> {
    switch (element.matchType) {
      case 'exact':
        return {
          elementId: element.id,
          matched: response.includes(element.value),
          confidence: response.includes(element.value) ? 1.0 : 0.0,
        };

      case 'contains': {
        const containsMatch = response.toLowerCase().includes(element.value.toLowerCase());
        return {
          elementId: element.id,
          matched: containsMatch,
          confidence: containsMatch ? 1.0 : 0.0,
        };
      }

      case 'regex': {
        const regex = new RegExp(element.value, 'i');
        const regexMatch = regex.test(response);
        const matchedText = response.match(regex)?.[0];
        return {
          elementId: element.id,
          matched: regexMatch,
          confidence: regexMatch ? 1.0 : 0.0,
          matchedText,
        };
      }

      case 'semantic':
        return this.semanticMatch(element, response);

      default:
        return { elementId: element.id, matched: false, confidence: 0 };
    }
  }

  /**
   * Perform semantic matching using LLM
   */
  private async semanticMatch(
    element: ResponseElement,
    response: string
  ): Promise<ElementMatchResult> {
    const prompt = `Evaluate if the following response contains the concept described.

Concept to find: "${element.description}"
Expected semantic meaning: "${element.value}"

Response to evaluate:
"""
${response.slice(0, 3000)}
"""

Respond with ONLY a JSON object (no markdown):
{"matched": true or false, "confidence": 0.0 to 1.0, "excerpt": "brief 10-20 word excerpt or null"}`;

    try {
      const result = await this.llmService.quickGenerate(
        [{ role: 'user', content: prompt }],
        { maxTokens: 150 }
      );

      // Extract JSON from response - try multiple methods
      let jsonStr = result.content.trim();

      // Remove markdown code blocks
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.slice(7);
      }
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.slice(3);
      }
      if (jsonStr.endsWith('```')) {
        jsonStr = jsonStr.slice(0, -3);
      }
      jsonStr = jsonStr.trim();

      // Try to extract JSON object if there's extra text
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      // Try to fix common JSON issues (truncated strings)
      if (!jsonStr.endsWith('}')) {
        // Try to close the JSON properly
        const lastQuote = jsonStr.lastIndexOf('"');
        if (lastQuote > 0) {
          jsonStr = jsonStr.slice(0, lastQuote + 1) + '}';
        }
      }

      const parsed = JSON.parse(jsonStr);
      return {
        elementId: element.id,
        matched: parsed.matched === true,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : (parsed.matched ? 0.8 : 0.2),
        matchedText: parsed.excerpt || parsed.matched_text || undefined,
      };
    } catch (error) {
      console.warn(`[Scorer] Semantic match failed for ${element.id}, falling back to contains:`, error);
      // Fallback to simple contains check
      const fallbackMatch = response.toLowerCase().includes(element.value.toLowerCase());
      return {
        elementId: element.id,
        matched: fallbackMatch,
        confidence: fallbackMatch ? 0.7 : 0.0,
      };
    }
  }

  /**
   * Calculate weighted score for elements
   */
  private calculateElementScore(
    elements: ResponseElement[],
    results: ElementMatchResult[]
  ): number {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const element of elements) {
      const result = results.find(r => r.elementId === element.id);
      if (result) {
        weightedSum += result.confidence * element.weight;
        totalWeight += element.weight;
      }
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  /**
   * Check response constraints
   */
  private checkConstraints(
    constraints: EvaluationDefinition['responseExpectations']['constraints'],
    response: string
  ): string[] {
    const violations: string[] = [];

    if (!constraints) return violations;

    if (constraints.maxLength && response.length > constraints.maxLength) {
      violations.push(`Response exceeds max length: ${response.length} > ${constraints.maxLength}`);
    }

    if (constraints.minLength && response.length < constraints.minLength) {
      violations.push(`Response below min length: ${response.length} < ${constraints.minLength}`);
    }

    if (constraints.forbiddenPatterns) {
      for (const pattern of constraints.forbiddenPatterns) {
        if (new RegExp(pattern, 'i').test(response)) {
          violations.push(`Response contains forbidden pattern: ${pattern}`);
        }
      }
    }

    return violations;
  }

  /**
   * Score delegation decision accuracy
   */
  private scoreDelegation(
    expectations: DelegationExpectations,
    decision: DelegationDecision
  ): number {
    const criteria = {
      correct_delegation_decision: 0.5,
      correct_agent_type: 0.3,
      quality_rationale: 0.2,
    };

    let score = 0;

    // Correct delegation decision
    const correctDecision = decision.delegated === expectations.shouldDelegate;
    score += (correctDecision ? 1.0 : 0.0) * criteria.correct_delegation_decision;

    // Correct agent type (only if delegation was expected and happened)
    if (expectations.shouldDelegate && decision.delegated) {
      if (expectations.expectedAgentType && decision.agentType) {
        const correctType = decision.agentType.toLowerCase() === expectations.expectedAgentType.toLowerCase();
        score += (correctType ? 1.0 : 0.0) * criteria.correct_agent_type;
      } else {
        // No specific agent type expected, give full score
        score += 1.0 * criteria.correct_agent_type;
      }
    } else if (!expectations.shouldDelegate && !decision.delegated) {
      // Correctly did not delegate, give full agent type score
      score += 1.0 * criteria.correct_agent_type;
    }

    // Quality of rationale
    if (expectations.delegationRationaleShouldMention && decision.rationale) {
      const mentionedCount = expectations.delegationRationaleShouldMention.filter(
        keyword => decision.rationale!.toLowerCase().includes(keyword.toLowerCase())
      ).length;
      const rationaleScore = mentionedCount / expectations.delegationRationaleShouldMention.length;
      score += rationaleScore * criteria.quality_rationale;
    } else if (!expectations.delegationRationaleShouldMention) {
      // No rationale requirements, give full score
      score += 1.0 * criteria.quality_rationale;
    }

    return score;
  }

  /**
   * Get default scoring configuration
   */
  private getDefaultScoring(): ScoringConfig {
    return {
      toolSelection: {
        weight: 0.3,
        criteria: {
          correct_tools_called: 0.5,
          correct_parameters: 0.3,
          no_forbidden_tools: 0.2,
        },
      },
      responseQuality: {
        weight: 0.5,
        criteria: {
          required_elements: 0.6,
          optional_elements: 0.2,
          constraints_met: 0.2,
        },
      },
      delegationAccuracy: {
        weight: 0.2,
        criteria: {
          correct_delegation_decision: 0.5,
          correct_agent_type: 0.3,
          quality_rationale: 0.2,
        },
      },
    };
  }
}
