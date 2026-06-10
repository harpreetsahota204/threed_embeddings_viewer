/**
 * Console logging, prefixed so it can be filtered in DevTools with
 * "[3d-embeddings]". `log` is reserved for features under active
 * investigation and includes a timestamp for latency analysis; stable
 * code paths should only use `logError`.
 */

const PREFIX = '[3d-embeddings]';

function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

export function log(...args: unknown[]) {
  console.log(PREFIX, timestamp(), ...args);
}

export function logError(...args: unknown[]) {
  console.error(PREFIX, ...args);
}
