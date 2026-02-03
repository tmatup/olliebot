/**
 * Query RAG Project Native Tool
 *
 * Queries a RAG project's vector index and returns relevant document chunks.
 */

import type { NativeTool, NativeToolResult } from './types.js';
import type { RAGProjectService } from '../../rag-projects/service.js';

export class QueryRAGProjectTool implements NativeTool {
  readonly name = 'query_rag_project';
  readonly description =
    'Query a RAG (Retrieval-Augmented Generation) project to find relevant document chunks. Use this to search through indexed documents in a specific project. Returns text chunks with similarity scores.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'The ID of the RAG project to query (folder name in user/rag/)',
      },
      query: {
        type: 'string',
        description: 'The search query text to find relevant documents',
      },
      topK: {
        type: 'number',
        description: 'Maximum number of results to return (default: 5, max: 20)',
      },
      minScore: {
        type: 'number',
        description: 'Minimum similarity score threshold between 0 and 1 (default: 0)',
      },
    },
    required: ['projectId', 'query'],
  };

  private ragService: RAGProjectService;

  constructor(ragService: RAGProjectService) {
    this.ragService = ragService;
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const projectId = String(params.projectId || '');
    const query = String(params.query || '');
    const topK = Math.min(Math.max(Number(params.topK) || 5, 1), 20);
    const minScore = Math.min(Math.max(Number(params.minScore) || 0, 0), 1);

    if (!projectId.trim()) {
      return {
        success: false,
        error: 'projectId parameter is required',
      };
    }

    if (!query.trim()) {
      return {
        success: false,
        error: 'query parameter is required',
      };
    }

    try {
      const response = await this.ragService.queryProject(projectId, {
        query,
        topK,
        minScore,
      });

      if (response.results.length === 0) {
        return {
          success: true,
          output: {
            projectId,
            query,
            results: [],
            totalResults: 0,
            queryTimeMs: response.queryTimeMs,
            message: 'No relevant documents found for this query.',
          },
        };
      }

      // Format results for LLM consumption
      const formattedResults = response.results.map((result) => ({
        documentPath: result.documentPath,
        text: result.text,
        score: result.score,
        chunkIndex: result.chunkIndex,
        ...(result.metadata && Object.keys(result.metadata).length > 0 && { metadata: result.metadata }),
      }));

      return {
        success: true,
        output: {
          projectId,
          query,
          results: formattedResults,
          totalResults: formattedResults.length,
          queryTimeMs: response.queryTimeMs,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `RAG query failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
