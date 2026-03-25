/**
 * Lock Store — tracks tile and entity locks for collaborative editing.
 *
 * Tile locks auto-expire after TILE_LOCK_TTL ms.
 * Entity locks (objects, zones) are held until explicitly released or user disconnects.
 */

const TILE_LOCK_TTL = 500 // ms

export interface TileLock {
  userId: string
  color: string
  expiry: number
}

export interface EntityLock {
  userId: string
  color: string
}

// Key format: "layerId:row,col"
const tileLocks = new Map<string, TileLock>()
// Key format: "layerId:entityId"
const entityLocks = new Map<string, EntityLock>()

let listeners: Array<() => void> = []

// ── Pub/Sub ──

function notify(): void {
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void): () => void {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter(l => l !== fn)
  }
}

// ── Tile Locks ──

function tileKey(layerId: string, col: number, row: number): string {
  return `${layerId}:${row},${col}`
}

function claimTileLocks(
  userId: string,
  color: string,
  cells: { layerId: string; col: number; row: number }[]
): void {
  const expiry = Date.now() + TILE_LOCK_TTL
  let changed = false
  for (const c of cells) {
    const key = tileKey(c.layerId, c.col, c.row)
    tileLocks.set(key, { userId, color, expiry })
    changed = true
  }
  if (changed) notify()
}

function releaseTileLocks(cells: { layerId: string; col: number; row: number }[]): void {
  let changed = false
  for (const c of cells) {
    const key = tileKey(c.layerId, c.col, c.row)
    if (tileLocks.delete(key)) changed = true
  }
  if (changed) notify()
}

function isTileLocked(layerId: string, col: number, row: number, myUserId: string): { locked: boolean; color?: string } {
  const key = tileKey(layerId, col, row)
  const lock = tileLocks.get(key)
  if (!lock) return { locked: false }
  if (lock.userId === myUserId) return { locked: false }
  if (Date.now() > lock.expiry) {
    tileLocks.delete(key)
    return { locked: false }
  }
  return { locked: true, color: lock.color }
}

// ── Entity Locks ──

function entityKey(layerId: string, entityId: string): string {
  return `${layerId}:${entityId}`
}

function claimEntityLock(userId: string, color: string, layerId: string, entityId: string): void {
  entityLocks.set(entityKey(layerId, entityId), { userId, color })
  notify()
}

function releaseEntityLock(layerId: string, entityId: string): void {
  if (entityLocks.delete(entityKey(layerId, entityId))) {
    notify()
  }
}

function isEntityLocked(layerId: string, entityId: string, myUserId: string): { locked: boolean; color?: string } {
  const lock = entityLocks.get(entityKey(layerId, entityId))
  if (!lock) return { locked: false }
  if (lock.userId === myUserId) return { locked: false }
  return { locked: true, color: lock.color }
}

// ── Bulk Operations ──

function releaseAllForUser(userId: string): void {
  let changed = false
  for (const [key, lock] of tileLocks) {
    if (lock.userId === userId) {
      tileLocks.delete(key)
      changed = true
    }
  }
  for (const [key, lock] of entityLocks) {
    if (lock.userId === userId) {
      entityLocks.delete(key)
      changed = true
    }
  }
  if (changed) notify()
}

function expireStale(): void {
  const now = Date.now()
  let changed = false
  for (const [key, lock] of tileLocks) {
    if (now > lock.expiry) {
      tileLocks.delete(key)
      changed = true
    }
  }
  if (changed) notify()
}

function reset(): void {
  tileLocks.clear()
  entityLocks.clear()
  notify()
}

// ── Getters (for renderer) ──

function getLockedTiles(): Map<string, TileLock> {
  return tileLocks
}

function getLockedEntities(): Map<string, EntityLock> {
  return entityLocks
}

// ── Export ──

export const lockStore = {
  subscribe,
  claimTileLocks,
  releaseTileLocks,
  isTileLocked,
  claimEntityLock,
  releaseEntityLock,
  isEntityLocked,
  releaseAllForUser,
  expireStale,
  reset,
  getLockedTiles,
  getLockedEntities
}
