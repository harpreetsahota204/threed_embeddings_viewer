/**
 * Console logging, prefixed so it can be filtered in DevTools with
 * "[3d-embeddings]".
 */

const PREFIX = '[3d-embeddings]';

export function logInfo(...args: unknown[]) {
  console.info(PREFIX, ...args);
}

export function logWarn(...args: unknown[]) {
  console.warn(PREFIX, ...args);
}

export function logError(...args: unknown[]) {
  console.error(PREFIX, ...args);
}
