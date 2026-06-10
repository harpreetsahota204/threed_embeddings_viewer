/**
 * Console logging, prefixed so it can be filtered in DevTools with
 * "[3d-embeddings]". `log` is reserved for features under active testing;
 * stable code paths should only use `logError`.
 */

const PREFIX = '[3d-embeddings]';

export function log(...args: unknown[]) {
  console.log(PREFIX, ...args);
}

export function logError(...args: unknown[]) {
  console.error(PREFIX, ...args);
}
