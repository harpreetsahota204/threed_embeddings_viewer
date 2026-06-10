/**
 * Console logging for debugging. All plugin logs are prefixed so they can
 * be filtered in DevTools with "[3d-embeddings]".
 */

const PREFIX = '[3d-embeddings]';

function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

export function log(...args: unknown[]) {
  console.log(PREFIX, timestamp(), ...args);
}

export function logError(...args: unknown[]) {
  console.error(PREFIX, timestamp(), ...args);
}
