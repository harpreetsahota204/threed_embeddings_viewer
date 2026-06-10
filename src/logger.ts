/**
 * Error logging, prefixed so it can be filtered in DevTools with
 * "[3d-embeddings]".
 */

const PREFIX = '[3d-embeddings]';

export function logError(...args: unknown[]) {
  console.error(PREFIX, ...args);
}
