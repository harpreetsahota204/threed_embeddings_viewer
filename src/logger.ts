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

// Temporary, highly-visible debugging channel. Filter DevTools console
// with "3D-DEBUG" to see only these. Remove once the cloud thumbnail /
// operator issues are resolved.
const DEBUG_PREFIX = '🟣 3D-DEBUG';

export function logDebug(label: string, data?: unknown) {
  if (data === undefined) {
    console.log(`${DEBUG_PREFIX} | ${label}`);
  } else {
    console.log(`${DEBUG_PREFIX} | ${label}`, data);
  }
}
