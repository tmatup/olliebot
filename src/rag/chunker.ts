import { v4 as uuid } from 'uuid';
import type { Chunk, ChunkMetadata, ChunkingOptions } from './types.js';

/**
 * Document Chunker - Splits documents into chunks for RAG
 */
export class Chunker {
  private defaultOptions: ChunkingOptions = {
    maxChunkSize: 1000,
    overlap: 100,
    preserveStructure: true,
  };

  /**
   * Chunk a document into smaller pieces
   */
  chunk(
    content: string,
    source: string,
    options?: Partial<ChunkingOptions>
  ): Chunk[] {
    const opts = { ...this.defaultOptions, ...options };

    if (opts.preserveStructure) {
      return this.chunkWithStructure(content, source, opts);
    }

    return this.chunkSimple(content, source, opts);
  }

  /**
   * Simple character-based chunking with overlap
   */
  private chunkSimple(
    content: string,
    source: string,
    options: ChunkingOptions
  ): Chunk[] {
    const chunks: Chunk[] = [];
    let offset = 0;
    let chunkIndex = 0;

    while (offset < content.length) {
      const end = Math.min(offset + options.maxChunkSize, content.length);
      const chunkContent = content.slice(offset, end);

      chunks.push({
        id: uuid(),
        source,
        chunkIndex,
        content: chunkContent,
        metadata: {
          startOffset: offset,
          endOffset: end,
          type: 'text',
        },
      });

      // Move offset, accounting for overlap
      offset = end - options.overlap;
      if (offset <= chunks[chunks.length - 1].metadata.startOffset) {
        offset = end; // Prevent infinite loop
      }
      chunkIndex++;
    }

    return chunks;
  }

  /**
   * Structure-preserving chunking
   * Tries to keep paragraphs, code blocks, and other structures intact
   */
  private chunkWithStructure(
    content: string,
    source: string,
    options: ChunkingOptions
  ): Chunk[] {
    const chunks: Chunk[] = [];
    const segments = this.splitIntoSegments(content);

    let currentChunk = '';
    let currentStart = 0;
    let chunkIndex = 0;
    let lineStart = 1;

    for (const segment of segments) {
      // If adding this segment would exceed max size, save current chunk
      if (
        currentChunk.length > 0 &&
        currentChunk.length + segment.content.length > options.maxChunkSize
      ) {
        chunks.push(this.createChunk(
          currentChunk,
          source,
          chunkIndex,
          currentStart,
          currentStart + currentChunk.length,
          lineStart,
          segment.type
        ));

        // Start new chunk with overlap
        const overlapStart = Math.max(0, currentChunk.length - options.overlap);
        currentChunk = currentChunk.slice(overlapStart) + segment.content;
        currentStart = currentStart + overlapStart;
        lineStart = this.countLines(content.slice(0, currentStart));
        chunkIndex++;
      } else {
        currentChunk += segment.content;
      }
    }

    // Don't forget the last chunk
    if (currentChunk.length > 0) {
      chunks.push(this.createChunk(
        currentChunk,
        source,
        chunkIndex,
        currentStart,
        currentStart + currentChunk.length,
        lineStart,
        'text'
      ));
    }

    return chunks;
  }

  /**
   * Split content into semantic segments
   */
  private splitIntoSegments(content: string): Array<{ content: string; type: ChunkMetadata['type'] }> {
    const segments: Array<{ content: string; type: ChunkMetadata['type'] }> = [];
    const lines = content.split('\n');
    let currentSegment = '';
    let currentType: ChunkMetadata['type'] = 'text';
    let inCodeBlock = false;

    for (const line of lines) {
      // Check for code block markers
      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          // End of code block
          currentSegment += line + '\n';
          segments.push({ content: currentSegment, type: 'code' });
          currentSegment = '';
          inCodeBlock = false;
          currentType = 'text';
        } else {
          // Start of code block
          if (currentSegment.trim()) {
            segments.push({ content: currentSegment, type: currentType });
          }
          currentSegment = line + '\n';
          inCodeBlock = true;
          currentType = 'code';
        }
        continue;
      }

      if (inCodeBlock) {
        currentSegment += line + '\n';
        continue;
      }

      // Check for paragraph breaks (empty lines)
      if (line.trim() === '' && currentSegment.trim()) {
        segments.push({ content: currentSegment + '\n', type: currentType });
        currentSegment = '';
        currentType = 'text';
        continue;
      }

      // Check for headers
      if (line.match(/^#{1,6}\s/)) {
        if (currentSegment.trim()) {
          segments.push({ content: currentSegment, type: currentType });
        }
        currentSegment = line + '\n';
        currentType = 'text';
        continue;
      }

      // Check for list items
      if (line.match(/^\s*[-*+]\s/) || line.match(/^\s*\d+\.\s/)) {
        currentType = 'list';
      }

      // Check for table rows
      if (line.includes('|') && line.trim().startsWith('|')) {
        currentType = 'table';
      }

      currentSegment += line + '\n';
    }

    // Add remaining content
    if (currentSegment.trim()) {
      segments.push({ content: currentSegment, type: currentType });
    }

    return segments;
  }

  private createChunk(
    content: string,
    source: string,
    chunkIndex: number,
    startOffset: number,
    endOffset: number,
    lineStart: number,
    type: ChunkMetadata['type']
  ): Chunk {
    return {
      id: uuid(),
      source,
      chunkIndex,
      content,
      metadata: {
        startOffset,
        endOffset,
        lineStart,
        lineEnd: lineStart + this.countLines(content) - 1,
        type,
      },
    };
  }

  private countLines(text: string): number {
    return (text.match(/\n/g) || []).length + 1;
  }
}
