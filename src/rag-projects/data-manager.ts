/**
 * RAG Data Manager
 *
 * Manages RAG project data injection into agent system prompts.
 * Only injects data if the agent has access to the query_rag_project tool.
 */

import type { RAGProjectService } from './service.js';
import type { RAGProject, RAGDocument } from './types.js';

export class RagDataManager {
  private ragService: RAGProjectService;

  constructor(ragService: RAGProjectService) {
    this.ragService = ragService;
  }

  /**
   * Check if an agent has access to the query_rag_project tool.
   * Uses the same matching logic as base-agent's getToolsForLLM.
   */
  hasQueryToolAccess(canAccessTools: string[]): boolean {
    const toolName = 'query_rag_project';

    // No patterns = no tools
    if (canAccessTools.length === 0) {
      return false;
    }

    // Separate inclusion and exclusion patterns
    const inclusions = canAccessTools.filter((p) => !p.startsWith('!'));
    const exclusions = canAccessTools
      .filter((p) => p.startsWith('!'))
      .map((p) => p.slice(1));

    // Helper to check if a tool matches a pattern
    const matchesPattern = (name: string, pattern: string): boolean => {
      if (pattern === '*') return true;
      if (pattern.endsWith('*')) {
        return name.startsWith(pattern.slice(0, -1));
      }
      return name === pattern || name.includes(pattern);
    };

    // Check exclusions first
    if (exclusions.some((pattern) => matchesPattern(toolName, pattern))) {
      return false;
    }

    // Check inclusions
    return inclusions.some((pattern) => matchesPattern(toolName, pattern));
  }

  /**
   * Get formatted RAG data for system prompt injection.
   * Returns null if no indexed projects exist.
   * Kept concise to minimize token usage.
   */
  async formatForSystemPrompt(): Promise<string | null> {
    try {
      const projects = await this.ragService.listProjects();

      // Filter to only indexed projects (those with vectors)
      const indexedProjects = projects.filter((p) => p.vectorCount > 0);

      if (indexedProjects.length === 0) {
        return null;
      }

      const lines: string[] = [
        '## RAG Knowledge Bases',
        'Use `query_rag_project` tool with `projectId` parameter to search these:',
        '',
      ];

      for (const project of indexedProjects) {
        // Project header with ID clearly marked as the parameter value
        lines.push(`**${project.name}** (projectId: \`${project.id}\`)`);

        // Project summary if available
        if (project.summary) {
          lines.push(project.summary);
        }

        // Get file summaries
        const details = await this.ragService.getProjectDetails(project.id);
        if (details?.documents) {
          const fileSummaries = this.formatFileSummaries(details.documents);
          if (fileSummaries) {
            lines.push(fileSummaries);
          }
        }

        lines.push(''); // Blank line between projects
      }

      return lines.join('\n').trim();
    } catch (error) {
      console.error('[RagDataManager] Error formatting system prompt data:', error);
      return null;
    }
  }

  /**
   * Format file summaries concisely.
   */
  private formatFileSummaries(documents: RAGDocument[]): string | null {
    const indexedDocs = documents.filter((d) => d.status === 'indexed');

    if (indexedDocs.length === 0) {
      return null;
    }

    const lines: string[] = ['Files:'];

    for (const doc of indexedDocs) {
      if (doc.summary) {
        lines.push(`- ${doc.name}: ${doc.summary}`);
      } else {
        lines.push(`- ${doc.name}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get a list of all available project IDs.
   * Useful for tool validation or auto-completion.
   */
  async getProjectIds(): Promise<string[]> {
    const projects = await this.ragService.listProjects();
    return projects.map((p) => p.id);
  }
}
