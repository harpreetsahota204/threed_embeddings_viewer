/**
 * In-view dimming state arrives from Python as a base64 bitmask in
 * brain-result index order (1 bit per point). Decode it with
 * base64ToBytes; this is just the bit-test helper. Id lists do not scale
 * — they were previously capped at 50k ids, beyond which dimming was
 * silently skipped — while the bitmask is n/8 bytes at any scale.
 */

export function testBit(bits: Uint8Array, i: number): boolean {
  return (bits[i >> 3] & (1 << (i & 7))) !== 0;
}
