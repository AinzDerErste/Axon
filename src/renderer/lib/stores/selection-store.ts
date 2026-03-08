/**
 * Selection Store — tracks which placed object(s) or zone is currently selected.
 * Pub/sub pattern matching all other stores.
 */

export type SelectionTarget =
  | { type: 'object'; layerId: string; objectId: string }
  | { type: 'objects'; layerId: string; objectIds: string[] }
  | { type: 'zone'; layerId: string; zoneId: string }
  | { type: 'path'; layerId: string; pathId: string }
  | { type: 'image-layer'; layerId: string }
  | null

let current: SelectionTarget = null
let listeners: Array<() => void> = []

function notify(): void {
  for (const fn of listeners) fn()
}

export function subscribe(fn: () => void): () => void {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter(l => l !== fn)
  }
}

export function getSelection(): SelectionTarget {
  return current
}

export function selectObject(layerId: string, objectId: string): void {
  current = { type: 'object', layerId, objectId }
  notify()
}

export function selectObjects(layerId: string, objectIds: string[]): void {
  if (objectIds.length === 0) {
    clearSelection()
    return
  }
  if (objectIds.length === 1) {
    current = { type: 'object', layerId, objectId: objectIds[0] }
  } else {
    current = { type: 'objects', layerId, objectIds }
  }
  notify()
}

/** Toggle an object in/out of multi-selection (for Ctrl+Click) */
export function toggleObjectSelection(layerId: string, objectId: string): void {
  if (!current) {
    // Nothing selected → select this object
    current = { type: 'object', layerId, objectId }
  } else if (current.type === 'object' && current.layerId === layerId) {
    if (current.objectId === objectId) {
      // Deselect the only selected object
      current = null
    } else {
      // Upgrade to multi-selection
      current = { type: 'objects', layerId, objectIds: [current.objectId, objectId] }
    }
  } else if (current.type === 'objects' && current.layerId === layerId) {
    const idx = current.objectIds.indexOf(objectId)
    if (idx >= 0) {
      // Remove from multi-selection
      const newIds = current.objectIds.filter(id => id !== objectId)
      if (newIds.length === 0) {
        current = null
      } else if (newIds.length === 1) {
        current = { type: 'object', layerId, objectId: newIds[0] }
      } else {
        current = { type: 'objects', layerId, objectIds: newIds }
      }
    } else {
      // Add to multi-selection
      current = { type: 'objects', layerId, objectIds: [...current.objectIds, objectId] }
    }
  } else {
    // Different layer or different type → start fresh single selection
    current = { type: 'object', layerId, objectId }
  }
  notify()
}

/** Check if a given object ID is currently selected (works for both single and multi) */
export function isObjectSelected(objectId: string): boolean {
  if (!current) return false
  if (current.type === 'object') return current.objectId === objectId
  if (current.type === 'objects') return current.objectIds.includes(objectId)
  return false
}

/** Get array of all selected object IDs (works for both single and multi) */
export function getSelectedObjectIds(): string[] {
  if (!current) return []
  if (current.type === 'object') return [current.objectId]
  if (current.type === 'objects') return current.objectIds
  return []
}

export function selectZone(layerId: string, zoneId: string): void {
  current = { type: 'zone', layerId, zoneId }
  notify()
}

export function selectPath(layerId: string, pathId: string): void {
  current = { type: 'path', layerId, pathId }
  notify()
}

export function selectImageLayer(layerId: string): void {
  current = { type: 'image-layer', layerId }
  notify()
}

export function clearSelection(): void {
  if (current === null) return
  current = null
  notify()
}
