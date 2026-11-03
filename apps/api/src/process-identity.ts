/**
 * SupportOS Process Identity Tracker
 *
 * Distinguishes the HTTP application server runtime from dedicated offline
 * maintenance, database migration, and test harness processes.
 */
let isServerProcess = false;

/**
 * Marks the currently running process as an HTTP application server process.
 * Invoked exclusively upon HTTP server initialization in apps/api/src/server.ts.
 */
export function markAsServerProcess(): void {
  isServerProcess = true;
}

/**
 * Returns true if the current execution is within an HTTP application server process.
 */
export function isServerProcessActive(): boolean {
  return isServerProcess;
}

/**
 * For testing purposes only: resets server process flag.
 * @internal
 */
export function _resetServerProcessForTesting(): void {
  isServerProcess = false;
}
