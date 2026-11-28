/**
 * Generates an RFC 4122 v4 UUID using Web Crypto APIs.
 * Uses crypto.randomUUID() when available, falling back to crypto.getRandomValues().
 * Throws an explicit error if neither cryptographic primitive is available.
 */
export function generateUuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    // RFC 4122 v4: version 4 (0100) and variant 10xx
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error('Cryptographic UUID generation is unavailable in this environment.');
}
