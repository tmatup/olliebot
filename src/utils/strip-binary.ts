/**
 * Strip Binary Data Utility
 *
 * Removes large binary data (like base64 images) from tool results before sending to LLM.
 * The LLM can't meaningfully process binary data, and it wastes context tokens.
 */

/**
 * Fields that commonly contain base64 image data
 */
const BINARY_FIELD_NAMES = new Set([
  'dataUrl',
  'screenshot',
  'image',
  'imageData',
  'base64',
  'b64_json',
]);

/**
 * Check if a string looks like a base64 data URL
 */
function isDataUrl(value: string): boolean {
  return value.startsWith('data:') && value.includes('base64,');
}

/**
 * Check if a string looks like raw base64 data (long alphanumeric string)
 */
function looksLikeBase64(value: string): boolean {
  // Base64 strings are typically long and contain only alphanumeric + /+=
  if (value.length < 1000) return false;
  return /^[A-Za-z0-9+/]+=*$/.test(value.substring(0, 100));
}

/**
 * Strip large binary data from tool results before sending to LLM.
 * Replaces base64 image data with a placeholder message.
 */
export function stripBinaryDataForLLM(output: unknown): unknown {
  if (output === null || output === undefined) {
    return output;
  }

  // Check for data URL strings
  if (typeof output === 'string') {
    if (isDataUrl(output)) {
      const sizeKB = Math.round(output.length / 1024);
      return `[Binary data: ${sizeKB}KB - displayed to user]`;
    }
    if (looksLikeBase64(output)) {
      const sizeKB = Math.round(output.length / 1024);
      return `[Base64 data: ${sizeKB}KB - displayed to user]`;
    }
    return output;
  }

  if (Array.isArray(output)) {
    return output.map(item => stripBinaryDataForLLM(item));
  }

  if (typeof output === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(output as Record<string, unknown>)) {
      // Check if this is a known binary field with data URL content
      if (BINARY_FIELD_NAMES.has(key) && typeof value === 'string') {
        if (isDataUrl(value) || looksLikeBase64(value)) {
          const sizeKB = Math.round(value.length / 1024);
          cleaned[key] = `[Image data: ${sizeKB}KB - displayed to user]`;
          continue;
        }
      }
      // Recursively clean nested values
      cleaned[key] = stripBinaryDataForLLM(value);
    }
    return cleaned;
  }

  return output;
}
