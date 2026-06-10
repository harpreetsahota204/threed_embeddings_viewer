/**
 * In-view dimming state arrives from Python as a base64 bitmask in
 * brain-result index order (1 bit per point). Id lists do not scale —
 * they were previously capped at 50k ids, beyond which dimming was
 * silently skipped — while the bitmask is n/8 bytes at any scale.
 */

export function decodeBitmask(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export function testBit(bits: Uint8Array, i: number): boolean {
  return (bits[i >> 3] & (1 << (i & 7))) !== 0;
}
