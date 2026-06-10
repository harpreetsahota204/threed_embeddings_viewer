/**
 * Decodes a base64 string to raw bytes. Shared by the geometry float32
 * chunks (Operator.ts) and the in-view dimming bitmask (bitmask.ts),
 * which both receive binary payloads as base64 from Python.
 */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}
