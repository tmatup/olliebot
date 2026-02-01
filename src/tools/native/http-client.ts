/**
 * HTTP Client Native Tool
 *
 * Translates curl command syntax into HTTP requests.
 * Supports common curl flags for method, headers, data, auth, etc.
 */

import type { NativeTool, NativeToolResult } from './types.js';

export interface HttpClientConfig {
  /** Default timeout in ms (default: 30000) */
  timeout?: number;
  /** Default user agent */
  userAgent?: string;
}

/**
 * Parsed curl command structure
 */
interface ParsedCurl {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeout?: number;
  followRedirects: boolean;
}

export class HttpClientTool implements NativeTool {
  readonly name = 'http_client';
  readonly description = `Execute HTTP requests using curl command syntax.

Supports common curl flags:
- -X, --request <method>: HTTP method (GET, POST, PUT, DELETE, etc.)
- -H, --header <header>: Add header (e.g., "Content-Type: application/json")
- -d, --data <data>: Request body data
- --data-raw <data>: Raw request body (same as -d)
- -u, --user <user:password>: Basic authentication
- -A, --user-agent <agent>: User agent string
- -b, --cookie <cookies>: Send cookies
- -L, --location: Follow redirects (default: true)
- -m, --max-time <seconds>: Request timeout
- -F, --form <name=value>: Multipart form data

Example:
curl -X POST https://api.example.com/data -H "Content-Type: application/json" -d '{"key": "value"}'`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      curl: {
        type: 'string',
        description: 'The curl command to execute (with or without the "curl" prefix)',
      },
    },
    required: ['curl'],
  };

  private defaultTimeout: number;
  private defaultUserAgent: string;

  constructor(config: HttpClientConfig = {}) {
    this.defaultTimeout = config.timeout || 30000;
    this.defaultUserAgent = config.userAgent || 'OllieBot/1.0 HttpClient';
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const curlCommand = String(params.curl || '').trim();

    if (!curlCommand) {
      return {
        success: false,
        error: 'curl parameter is required',
      };
    }

    try {
      // Parse the curl command
      const parsed = this.parseCurl(curlCommand);

      // Validate URL
      let url: URL;
      try {
        url = new URL(parsed.url);
        if (!['http:', 'https:'].includes(url.protocol)) {
          throw new Error('Invalid protocol');
        }
      } catch {
        return {
          success: false,
          error: `Invalid URL: ${parsed.url}. Must be a valid http or https URL.`,
        };
      }

      // Execute the request
      const controller = new AbortController();
      const timeout = parsed.timeout || this.defaultTimeout;
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(parsed.url, {
        method: parsed.method,
        headers: parsed.headers,
        body: parsed.body,
        signal: controller.signal,
        redirect: parsed.followRedirects ? 'follow' : 'manual',
      });

      clearTimeout(timeoutId);

      // Get response body
      const contentType = response.headers.get('content-type') || '';
      let responseBody: unknown;

      if (contentType.includes('application/json')) {
        try {
          responseBody = await response.json();
        } catch {
          responseBody = await response.text();
        }
      } else {
        responseBody = await response.text();
      }

      // Build response headers object
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return {
        success: true,
        output: {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          body: responseBody,
          url: response.url,
          redirected: response.redirected,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          success: false,
          error: `Request timeout after ${this.defaultTimeout}ms`,
        };
      }
      return {
        success: false,
        error: `HTTP request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Parse a curl command into its components.
   */
  private parseCurl(command: string): ParsedCurl {
    // Tokenize the command, handling quoted strings
    const tokens = this.tokenize(command);

    // Remove 'curl' if present at the start
    if (tokens.length > 0 && tokens[0].toLowerCase() === 'curl') {
      tokens.shift();
    }

    const result: ParsedCurl = {
      method: 'GET',
      url: '',
      headers: {
        'User-Agent': this.defaultUserAgent,
      },
      followRedirects: true,
    };

    const formData: Array<{ name: string; value: string }> = [];
    let i = 0;

    while (i < tokens.length) {
      const token = tokens[i];

      // Method
      if (token === '-X' || token === '--request') {
        i++;
        if (i < tokens.length) {
          result.method = tokens[i].toUpperCase();
        }
      }
      // Header
      else if (token === '-H' || token === '--header') {
        i++;
        if (i < tokens.length) {
          const header = tokens[i];
          const colonIndex = header.indexOf(':');
          if (colonIndex > 0) {
            const name = header.substring(0, colonIndex).trim();
            const value = header.substring(colonIndex + 1).trim();
            result.headers[name] = value;
          }
        }
      }
      // Data
      else if (token === '-d' || token === '--data' || token === '--data-raw') {
        i++;
        if (i < tokens.length) {
          result.body = tokens[i];
          // If method is still GET, change to POST
          if (result.method === 'GET') {
            result.method = 'POST';
          }
        }
      }
      // Form data
      else if (token === '-F' || token === '--form') {
        i++;
        if (i < tokens.length) {
          const formField = tokens[i];
          const eqIndex = formField.indexOf('=');
          if (eqIndex > 0) {
            formData.push({
              name: formField.substring(0, eqIndex),
              value: formField.substring(eqIndex + 1),
            });
          }
          // If method is still GET, change to POST
          if (result.method === 'GET') {
            result.method = 'POST';
          }
        }
      }
      // Basic auth
      else if (token === '-u' || token === '--user') {
        i++;
        if (i < tokens.length) {
          const auth = tokens[i];
          const encoded = Buffer.from(auth).toString('base64');
          result.headers['Authorization'] = `Basic ${encoded}`;
        }
      }
      // User agent
      else if (token === '-A' || token === '--user-agent') {
        i++;
        if (i < tokens.length) {
          result.headers['User-Agent'] = tokens[i];
        }
      }
      // Cookies
      else if (token === '-b' || token === '--cookie') {
        i++;
        if (i < tokens.length) {
          result.headers['Cookie'] = tokens[i];
        }
      }
      // Follow redirects
      else if (token === '-L' || token === '--location') {
        result.followRedirects = true;
      }
      // Timeout
      else if (token === '-m' || token === '--max-time') {
        i++;
        if (i < tokens.length) {
          const seconds = parseFloat(tokens[i]);
          if (!isNaN(seconds)) {
            result.timeout = seconds * 1000;
          }
        }
      }
      // Connect timeout (treat same as max-time)
      else if (token === '--connect-timeout') {
        i++;
        if (i < tokens.length) {
          const seconds = parseFloat(tokens[i]);
          if (!isNaN(seconds) && !result.timeout) {
            result.timeout = seconds * 1000;
          }
        }
      }
      // Silent mode (ignore)
      else if (token === '-s' || token === '--silent') {
        // Ignore
      }
      // Verbose mode (ignore)
      else if (token === '-v' || token === '--verbose') {
        // Ignore
      }
      // Insecure (ignore - can't disable SSL verification in fetch)
      else if (token === '-k' || token === '--insecure') {
        // Ignore
      }
      // Output file (ignore)
      else if (token === '-o' || token === '--output') {
        i++; // Skip the filename
      }
      // Include headers in output (ignore - we always include headers)
      else if (token === '-i' || token === '--include') {
        // Ignore
      }
      // URL (anything that looks like a URL or doesn't start with -)
      else if (!token.startsWith('-') || token.startsWith('http://') || token.startsWith('https://')) {
        result.url = token;
      }

      i++;
    }

    // Handle form data
    if (formData.length > 0) {
      // Build URL-encoded form data
      const formBody = formData
        .map(({ name, value }) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
        .join('&');
      result.body = formBody;

      // Set content type if not already set
      if (!Object.keys(result.headers).some(h => h.toLowerCase() === 'content-type')) {
        result.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
    }

    // Auto-set Content-Type for JSON body if not set
    if (result.body && !Object.keys(result.headers).some(h => h.toLowerCase() === 'content-type')) {
      const trimmedBody = result.body.trim();
      if ((trimmedBody.startsWith('{') && trimmedBody.endsWith('}')) ||
          (trimmedBody.startsWith('[') && trimmedBody.endsWith(']'))) {
        result.headers['Content-Type'] = 'application/json';
      }
    }

    return result;
  }

  /**
   * Tokenize a command string, handling quoted strings and escape sequences.
   */
  private tokenize(command: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let escape = false;

    for (let i = 0; i < command.length; i++) {
      const char = command[i];

      if (escape) {
        // Handle escape sequences
        if (char === 'n') {
          current += '\n';
        } else if (char === 't') {
          current += '\t';
        } else if (char === 'r') {
          current += '\r';
        } else {
          current += char;
        }
        escape = false;
        continue;
      }

      if (char === '\\' && !inSingleQuote) {
        escape = true;
        continue;
      }

      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
        continue;
      }

      if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
        continue;
      }

      // Handle line continuation (backslash at end of line)
      if (char === '\n' || char === '\r') {
        if (!inSingleQuote && !inDoubleQuote) {
          // Skip newlines outside quotes
          continue;
        }
      }

      if ((char === ' ' || char === '\t') && !inSingleQuote && !inDoubleQuote) {
        if (current.length > 0) {
          tokens.push(current);
          current = '';
        }
        continue;
      }

      current += char;
    }

    if (current.length > 0) {
      tokens.push(current);
    }

    return tokens;
  }
}
