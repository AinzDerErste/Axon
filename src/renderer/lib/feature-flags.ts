/**
 * Central feature flags.
 *
 * Features that are not finished or not safe to ship are switched off here
 * instead of being deleted, so the code stays reviewable and can be re-enabled
 * once the open points below are closed.
 */

export const FEATURES = {
  /**
   * Real-time collaboration (host mode, standalone server, chat, snapshots).
   *
   * OFF — incomplete and unhardened:
   *  - op coverage is partial: layer add/delete/reorder/rename, drawing-layer
   *    edits, image-layer edits, object resize/rotate/flip, tileset and preset
   *    changes are never synced, so clients silently diverge.
   *  - remote ops bypass the undo/redo command stack.
   *  - the server trusts the client-supplied `sender` id, so any client can
   *    impersonate another user and repeated `join` messages grow the user list
   *    without bound.
   *  - no heartbeat/timeout and no cap on snapshot memory.
   */
  collab: false
} as const

export type FeatureName = keyof typeof FEATURES
