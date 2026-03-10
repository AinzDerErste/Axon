/**
 * Collab Bridge — connects the collab system to the map editor.
 *
 * Responsibilities:
 * 1. Hook into history-store to broadcast local commands as network ops
 * 2. Subscribe to collab-store to apply incoming remote ops to MapData
 * 3. Handle snapshot loading when joining a session
 * 4. Invalidate renderer caches when remote ops modify the map
 */

import { getHistory } from '../stores/history-store'
import { getMap, notify as notifyMap } from '../stores/map-store'
import { collabStore } from './collab-store'
import { commandToOp } from './op-serializer'
import { applyRemoteOp } from './op-applier'
import * as collabClient from './collab-client'

let unsub: (() => void) | null = null
let cacheInvalidationCallback: ((opType: string, layerId: string) => void) | null = null

/**
 * Start the collab bridge. Call this when a collab session is established.
 * @param onCacheInvalidate Callback to invalidate renderer caches (tile/object)
 */
export function startCollabBridge(
  onCacheInvalidate?: (opType: string, layerId: string) => void
): void {
  stopCollabBridge()

  cacheInvalidationCallback = onCacheInvalidate || null

  // 1. Hook: local commands → network broadcast
  const history = getHistory()
  history.collabBroadcastHook = (cmd) => {
    if (!collabStore.getState().connected) return
    const op = commandToOp(cmd)
    if (!op) return

    const state = collabStore.getState()
    if (state.role === 'host') {
      // Host: broadcast via main process server
      const api = (window as any).electronAPI
      if (api?.collabBroadcastOp) {
        api.collabBroadcastOp({
          type: 'op',
          sender: collabClient.getUserId(),
          ts: Date.now(),
          payload: op
        })
      }
    } else {
      // Client: send via WebSocket
      collabClient.sendOp(op.opType, op.layerId, op.data)
    }
  }

  // 2. Subscribe to incoming ops from collab-store
  unsub = collabStore.subscribe(() => {
    const map = getMap()
    if (!map) return

    // Process incoming remote ops
    const ops = collabStore.consumeIncomingOps()
    if (ops.length > 0) {
      let modified = false
      for (const op of ops) {
        if (applyRemoteOp(map, op)) {
          modified = true
          if (cacheInvalidationCallback) {
            cacheInvalidationCallback(op.opType, op.layerId)
          }
        }
      }
      if (modified) {
        notifyMap()
      }
    }
  })
}

/**
 * Stop the collab bridge. Call when disconnecting from a session.
 */
export function stopCollabBridge(): void {
  const history = getHistory()
  history.collabBroadcastHook = null
  cacheInvalidationCallback = null

  if (unsub) {
    unsub()
    unsub = null
  }
}

/**
 * Check if the bridge is active.
 */
export function isBridgeActive(): boolean {
  return unsub !== null
}
