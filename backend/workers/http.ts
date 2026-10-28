/**
 * CABMS Worker HTTP Utilities
 * Handles strong ETags and strict RFC 9110 If-Match validator processing.
 */

export interface IfMatchResult {
  isPresent: boolean;
  isWildcard: boolean;
  isWeak: boolean;
  isMalformed: boolean;
  strongVersions: number[];
}

/**
 * Generates an authoritative strong ETag formatted as `"${version}"`.
 */
export function generateStrongETag(version: number): string {
  return `"${version}"`;
}

/**
 * Parses and validates an `If-Match` request header according to RFC 9110 §13.1.1
 * and CABMS §19.5 exact-version concurrency rules.
 *
 * Rules:
 * - Absent: isPresent = false
 * - Wildcard `*`: isWildcard = true (disallowed for exact-version PATCH)
 * - Weak `W/"..."`: isWeak = true (disallowed for exact-version PATCH)
 * - Malformed: isMalformed = true
 * - Strong tags: e.g. `"1"` -> parsed as version integer 1
 */
export function parseIfMatchHeader(header: string | null): IfMatchResult {
  if (!header || !header.trim()) {
    return {
      isPresent: false,
      isWildcard: false,
      isWeak: false,
      isMalformed: false,
      strongVersions: [],
    };
  }

  const trimmed = header.trim();

  if (trimmed === '*') {
    return {
      isPresent: true,
      isWildcard: true,
      isWeak: false,
      isMalformed: false,
      strongVersions: [],
    };
  }

  const parts = trimmed.split(',').map(s => s.trim());
  const strongVersions: number[] = [];
  let isWeak = false;
  let isMalformed = false;

  for (const part of parts) {
    if (part.startsWith('W/')) {
      isWeak = true;
      continue;
    }

    // Must be enclosed in double quotes: "1"
    const match = /^"(\d+)"$/.exec(part);
    if (!match) {
      isMalformed = true;
    } else {
      const num = parseInt(match[1], 10);
      if (!Number.isSafeInteger(num) || num < 0) {
        isMalformed = true;
      } else {
        strongVersions.push(num);
      }
    }
  }

  return {
    isPresent: true,
    isWildcard: false,
    isWeak,
    isMalformed,
    strongVersions,
  };
}
