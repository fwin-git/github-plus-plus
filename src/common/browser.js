// Cross-browser extension API namespace. Firefox exposes `browser` (with
// promises), Chrome exposes `chrome` (promises in MV3). Null in node tests.
export const ext = globalThis.browser ?? globalThis.chrome ?? null;
