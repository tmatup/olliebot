/**
 * Document Loader
 * Loads and parses various document formats (PDF, text, markdown).
 */

import { readFile } from 'fs/promises';
import { extname } from 'path';
import type { DocumentChunk } from './types.js';

/**
 * Supported file extensions and their MIME types.
 */
export const SUPPORTED_EXTENSIONS: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.htm': 'text/html',
};

/**
 * Check if a file extension is supported.
 */
export function isSupportedFile(filename: string): boolean {
  const ext = extname(filename).toLowerCase();
  return ext in SUPPORTED_EXTENSIONS;
}

/**
 * Get MIME type for a file.
 */
export function getMimeType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return SUPPORTED_EXTENSIONS[ext] || 'application/octet-stream';
}

/**
 * Options for text chunking.
 */
export interface ChunkOptions {
  /** Maximum chunk size in characters */
  chunkSize: number;
  /** Overlap between chunks in characters */
  chunkOverlap: number;
  /** Preserve paragraph boundaries when possible */
  preserveParagraphs: boolean;
}

const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  chunkSize: 1000,
  chunkOverlap: 100,
  preserveParagraphs: true,
};

/**
 * Split text into chunks with overlap.
 */
function chunkText(text: string, options: ChunkOptions = DEFAULT_CHUNK_OPTIONS): string[] {
  const { chunkSize, chunkOverlap, preserveParagraphs } = options;
  const chunks: string[] = [];

  if (!text || text.length === 0) {
    return chunks;
  }

  // If text fits in one chunk, return it as-is
  if (text.length <= chunkSize) {
    return [text.trim()].filter((c) => c.length > 0);
  }

  if (preserveParagraphs) {
    // Split by double newlines (paragraphs)
    const paragraphs = text.split(/\n\n+/);
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      const trimmedParagraph = paragraph.trim();
      if (!trimmedParagraph) continue;

      // If adding this paragraph would exceed chunk size
      if (currentChunk.length + trimmedParagraph.length + 2 > chunkSize) {
        // Save current chunk if not empty
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
        }

        // If paragraph itself is too large, split it by sentences
        if (trimmedParagraph.length > chunkSize) {
          const sentences = trimmedParagraph.split(/(?<=[.!?])\s+/);
          currentChunk = '';

          for (const sentence of sentences) {
            if (currentChunk.length + sentence.length + 1 > chunkSize) {
              if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
              }
              // If single sentence is too long, force-split it
              if (sentence.length > chunkSize) {
                for (let i = 0; i < sentence.length; i += chunkSize - chunkOverlap) {
                  chunks.push(sentence.slice(i, i + chunkSize).trim());
                }
                currentChunk = '';
              } else {
                currentChunk = sentence;
              }
            } else {
              currentChunk += (currentChunk ? ' ' : '') + sentence;
            }
          }
        } else {
          currentChunk = trimmedParagraph;
        }
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + trimmedParagraph;
      }
    }

    // Don't forget the last chunk
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
  } else {
    // Simple sliding window approach
    for (let i = 0; i < text.length; i += chunkSize - chunkOverlap) {
      const chunk = text.slice(i, i + chunkSize).trim();
      if (chunk) {
        chunks.push(chunk);
      }
    }
  }

  return chunks.filter((c) => c.length > 0);
}

/**
 * Load and parse a text file.
 */
async function loadTextFile(filePath: string): Promise<string> {
  const content = await readFile(filePath, 'utf-8');
  return content;
}

/**
 * Load and parse a PDF file using unpdf.
 */
async function loadPdfFile(filePath: string): Promise<string> {
  try {
    // Dynamic import for unpdf
    const { extractText, getDocumentProxy } = await import('unpdf');

    const buffer = await readFile(filePath);
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });

    return text;
  } catch (error) {
    console.error(`[DocumentLoader] Failed to load PDF ${filePath}:`, error);
    throw new Error(`Failed to parse PDF: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Load and parse an HTML file (strip tags).
 */
async function loadHtmlFile(filePath: string): Promise<string> {
  const content = await readFile(filePath, 'utf-8');
  // Simple HTML tag stripping (for basic HTML)
  return content
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Load and parse a JSON file.
 */
async function loadJsonFile(filePath: string): Promise<string> {
  const content = await readFile(filePath, 'utf-8');
  try {
    const json = JSON.parse(content);
    // Pretty print JSON for better chunking
    return JSON.stringify(json, null, 2);
  } catch {
    return content;
  }
}

/**
 * Load a document and return its text content.
 */
export async function loadDocument(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();

  switch (ext) {
    case '.pdf':
      return loadPdfFile(filePath);
    case '.html':
    case '.htm':
      return loadHtmlFile(filePath);
    case '.json':
      return loadJsonFile(filePath);
    case '.txt':
    case '.md':
    case '.markdown':
    case '.csv':
    default:
      return loadTextFile(filePath);
  }
}

/**
 * Load a document and split it into chunks ready for embedding.
 */
export async function loadAndChunkDocument(
  filePath: string,
  relativePath: string,
  options: Partial<ChunkOptions> = {}
): Promise<DocumentChunk[]> {
  const chunkOptions: ChunkOptions = {
    ...DEFAULT_CHUNK_OPTIONS,
    ...options,
  };

  // Load the document
  const text = await loadDocument(filePath);

  // Chunk the text
  const textChunks = chunkText(text, chunkOptions);

  // Convert to DocumentChunk format
  return textChunks.map((chunk, index) => ({
    text: chunk,
    documentPath: relativePath,
    chunkIndex: index,
    contentType: 'text' as const,
    metadata: {
      totalChunks: textChunks.length,
    },
  }));
}
