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
import { getMap, setMap, notify as notifyMap, sanitizeConfig } from '../stores/map-store'
import { collabStore } from './collab-store'
import { lockStore } from './lock-store'
import { commandToOp } from './op-serializer'
import { applyRemoteOp } from './op-applier'
import { registerImageSync } from '../stores/image-cache'
import * as collabClient from './collab-client'

let unsub: (() => void) | null = null
let lockExpiryTimer: ReturnType<typeof setInterval> | null = null
let cacheInvalidationCallback: ((opType: string, layerId: string) => void) | null = null
let fullInvalidationCallback: (() => void) | null = null

/**
 * Start the collab bridge. Call this when a collab session is established.
 * @param onCacheInvalidate Callback to invalidate renderer caches per-op
 * @param onFullInvalidate Callback to fully invalidate all renderer caches (after snapshot load)
 */
export function startCollabBridge(
  onCacheInvalidate?: (opType: string, layerId: string) => void,
  onFullInvalidate?: () => void
): void {
  stopCollabBridge()

  cacheInvalidationCallback = onCacheInvalidate || null
  fullInvalidationCallback = onFullInvalidate || null

  // Start lock expiry timer (cleans up stale tile locks every 200ms)
  lockExpiryTimer = setInterval(() => lockStore.expireStale(), 200)

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

  // 2. Subscribe to incoming ops and snapshots from collab-store
  unsub = collabStore.subscribe(() => {
    // Check for incoming snapshot first (initial join or snapshot-restore)
    const snapshot = collabStore.consumeIncomingSnapshot()
    if (snapshot) {
      lockStore.reset()
      loadCollabSnapshot(snapshot)
      return
    }

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
 * Load a full map snapshot received from the collab server.
 */
function loadCollabSnapshot(snapshotJson: string): void {
  try {
    const project = JSON.parse(snapshotJson)
    if (!project.config || !project.layers) return

    if (!project.config.orientation) project.config.orientation = 'diamond'
    project.config = sanitizeConfig(project.config)

    // Trim tile layers and ensure layer types
    for (const layer of project.layers) {
      if (!layer.type) layer.type = 'tile'
      if (layer.type === 'tile' && Array.isArray(layer.data)) {
        if (layer.data.length > project.config.gridHeight) {
          layer.data.length = project.config.gridHeight
        }
        for (let r = 0; r < layer.data.length; r++) {
          if (Array.isArray(layer.data[r]) && layer.data[r].length > project.config.gridWidth) {
            layer.data[r].length = project.config.gridWidth
          }
        }
      }
      if (layer.type === 'object') {
        if (!layer.zones) layer.zones = []
        if (!layer.paths) layer.paths = []
        if (!layer.groups) layer.groups = []
        for (const zone of layer.zones) {
          if (!zone.zoneType) zone.zoneType = 'zone'
        }
        // Register object images synchronously
        for (const obj of layer.objects) {
          if (obj.imageDataUrl) {
            obj.imageHash = registerImageSync(obj.imageDataUrl)
          }
        }
      }
    }

    // Register tileset images
    for (const ts of project.tilesets) {
      if (ts.imageDataUrl) {
        ts.imageHash = registerImageSync(ts.imageDataUrl)
      }
    }

    setMap({
      config: project.config,
      layers: project.layers,
      tilesets: project.tilesets,
      activeLayerId: project.activeLayerId
    })

    // Invalidate all renderer caches
    if (fullInvalidationCallback) {
      fullInvalidationCallback()
    }
  } catch (e) {
    console.error('[collab-bridge] Failed to load snapshot:', e)
  }
}

/**
 * Stop the collab bridge. Call when disconnecting from a session.
 */
export function stopCollabBridge(): void {
  const history = getHistory()
  history.collabBroadcastHook = null
  cacheInvalidationCallback = null

  if (lockExpiryTimer) {
    clearInterval(lockExpiryTimer)
    lockExpiryTimer = null
  }
  lockStore.reset()

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
