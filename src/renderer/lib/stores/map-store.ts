import type { MapData, MapConfig } from '../models/map'
import type { Layer, ObjectLayer, ImageLayer, DrawingLayer, MapObject, Zone, Path, ObjectGroup } from '../models/layer'
import type { Tileset } from '../models/tileset'
import { createLayer, createObjectLayer, createImageLayer, createDrawingLayer } from '../models/layer'

/** Cell count above which the UI shows a performance warning (not a hard limit) */
export const LARGE_MAP_THRESHOLD = 1_000_000

/** Normalise a config (floor to integers, enforce minimums). No upper clamp. */
export function sanitizeConfig(config: MapConfig): MapConfig {
  return {
    ...config,
    gridWidth: Math.max(1, Math.round(config.gridWidth)),
    gridHeight: Math.max(1, Math.round(config.gridHeight)),
    tileWidth: Math.max(8, config.tileWidth),
    tileHeight: Math.max(8, config.tileHeight),
  }
}

let currentMap: MapData | null = null
let listeners: Array<() => void> = []

export function notify() {
  for (const fn of listeners) fn()
}

export function subscribe(fn: () => void): () => void {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter(l => l !== fn)
  }
}

export function getMap(): MapData | null {
  return currentMap
}

export function createNewMap(config: MapConfig): MapData {
  const safe = sanitizeConfig(config)
  const layerId = crypto.randomUUID()
  const layer = createLayer(layerId, 'Ground', safe.gridHeight, safe.gridWidth)
  currentMap = {
    config: safe,
    layers: [layer],
    tilesets: [],
    activeLayerId: layerId
  }
  notify()
  return currentMap
}

export function setMap(map: MapData | null): void {
  currentMap = map
  notify()
}

export function getActiveLayer(): Layer | undefined {
  if (!currentMap) return undefined
  return currentMap.layers.find(l => l.id === currentMap!.activeLayerId)
}

export function setActiveLayer(layerId: string): void {
  if (!currentMap) return
  currentMap.activeLayerId = layerId
  notify()
}

export function addLayer(name: string): Layer | undefined {
  if (!currentMap) return undefined
  const id = crypto.randomUUID()
  const layer = createLayer(id, name, currentMap.config.gridHeight, currentMap.config.gridWidth)
  currentMap.layers = [...currentMap.layers, layer]
  currentMap.activeLayerId = id
  notify()
  return layer
}

export function addObjectLayer(name: string): ObjectLayer | undefined {
  if (!currentMap) return undefined
  const id = crypto.randomUUID()
  const layer = createObjectLayer(id, name)
  currentMap.layers = [...currentMap.layers, layer]
  currentMap.activeLayerId = id
  notify()
  return layer
}

export function addImageLayer(
  name: string,
  imageDataUrl: string,
  imageBitmap: ImageBitmap,
  width: number,
  height: number
): ImageLayer | undefined {
  if (!currentMap) return undefined
  const id = crypto.randomUUID()
  const layer = createImageLayer(id, name, imageDataUrl, imageBitmap, width, height)
  currentMap.layers = [...currentMap.layers, layer]
  currentMap.activeLayerId = id
  notify()
  return layer
}

export function addDrawingLayer(name: string): DrawingLayer | undefined {
  if (!currentMap) return undefined
  const id = crypto.randomUUID()
  const layer = createDrawingLayer(id, name)
  currentMap.layers = [...currentMap.layers, layer]
  currentMap.activeLayerId = id
  notify()
  return layer
}

export function updateImageLayer(
  layerId: string,
  updates: Partial<Pick<ImageLayer, 'x' | 'y' | 'width' | 'height' | 'name' | 'opacity' | 'isoTransform' | 'rotation' | 'locked'>>
): void {
  if (!currentMap) return
  const layer = currentMap.layers.find(l => l.id === layerId)
  if (!layer || layer.type !== 'image') return
  Object.assign(layer, updates)
  notify()
}

export function addObjectToLayer(layerId: string, obj: MapObject): void {
  if (!currentMap) return
  const layer = currentMap.layers.find(l => l.id === layerId)
  if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return
  layer.objects = [...layer.objects, obj]
  notify()
}

export function removeObjectFromLayer(layerId: string, objectId: string): void {
  if (!currentMap) return
  const layer = currentMap.layers.find(l => l.id === layerId)
  if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return
  layer.objects = layer.objects.filter(o => o.id !== objectId)
  notify()
}

export function updateObject(layerId: string, objectId: string, updates: Partial<Pick<MapObject, 'x' | 'y' | 'name' | 'width' | 'height' | 'flipX' | 'flipY' | 'locked' | 'visible'>>): void {
  if (!currentMap) return
  const layer = currentMap.layers.find(l => l.id === layerId)
  if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return
  const obj = layer.objects.find(o => o.id === objectId)
  if (obj) {
    Object.assign(obj, updates)
    notify()
  }
}

export function addZoneToLayer(layerId: string, zone: Zone): void {
  if (!currentMap) return
  const layer = currentMap.layers.find(l => l.id === layerId)
  if (!layer || layer.type !== 'object') return
  layer.zones = [...layer.zones, zone]
  notify()
}

export function removeZoneFromLayer(layerId: string, zoneId: string): void {
  if (!currentMap) return
  const layer = currentMap.layers.find(l => l.id === layerId)
  if (!layer || layer.type !== 'object') return
  layer.zones = layer.zones.filter(z => z.id !== zoneId)
  notify()
}

export function updateZone(layerId: string, zoneId: string, updates: Partial<Pick<Zone, 'name' | 'color' | 'points' | 'closed'>>): void {
  if (!currentMap) return
  const layer = currentMap.layers.find(l => l.id === layerId)
  if (!layer || layer.type !== 'object') return
  const zone = layer.zones.find(z => z.id === zoneId)
  if (zone) {
    Object.assign(zone, updates)
    notify()
  }
}

export function updatePath(layerId: string, pathId: string, updates: Partial<Pick<Path, 'name' | 'color' | 'points' | 'loop' | 'assignedObjectId'>>): void {
  if (!currentMap) return
  const layer = currentMap.layers.find(l => l.id === layerId)
  if (!layer || layer.type !== 'object') return
  const path = layer.paths.find(p => p.id === pathId)
  if (path) {
    Object.assign(path, updates)
    notify()
  }
}

export function removeLayer(layerId: string): void {
  if (!currentMap || currentMap.layers.length <= 1) return
  currentMap.layers = currentMap.layers.filter(l => l.id !== layerId)
  if (currentMap.activeLayerId === layerId) {
    currentMap.activeLayerId = currentMap.layers[0].id
  }
  notify()
}

export function toggleLayerVisibility(layerId: string): void {
  if (!currentMap) return
  const layer = currentMap.layers.find(l => l.id === layerId)
  if (layer) {
    layer.visible = !layer.visible
    notify()
  }
}

export function moveLayerUp(layerId: string): void {
  if (!currentMap) return
  const idx = currentMap.layers.findIndex(l => l.id === layerId)
  if (idx < currentMap.layers.length - 1) {
    ;[currentMap.layers[idx], currentMap.layers[idx + 1]] = [currentMap.layers[idx + 1], currentMap.layers[idx]]
    notify()
  }
}

export function moveLayerDown(layerId: string): void {
  if (!currentMap) return
  const idx = currentMap.layers.findIndex(l => l.id === layerId)
  if (idx > 0) {
    ;[currentMap.layers[idx], currentMap.layers[idx - 1]] = [currentMap.layers[idx - 1], currentMap.layers[idx]]
    notify()
  }
}

export function addTileset(tileset: Tileset): void {
  if (!currentMap) return
  currentMap.tilesets = [...currentMap.tilesets, tileset]
  notify()
}

export function removeTileset(tilesetId: string): void {
  if (!currentMap) return
  currentMap.tilesets = currentMap.tilesets.filter(ts => ts.id !== tilesetId)
  // Clean up tile references in all tile layers
  for (const layer of currentMap.layers) {
    if (layer.type !== 'tile') continue
    for (let r = 0; r < layer.data.length; r++) {
      for (let c = 0; c < layer.data[r].length; c++) {
        const cell = layer.data[r][c]
        if (cell && cell.tilesetId === tilesetId) {
          layer.data[r][c] = null
        }
      }
    }
  }
  notify()
}

/** Update a tileset's image data (used by folder watcher when source file changes) */
export function updateTilesetImage(tilesetId: string, imageDataUrl: string, imageBitmap: ImageBitmap, width: number, height: number): void {
  if (!currentMap) return
  const ts = currentMap.tilesets.find(t => t.id === tilesetId)
  if (!ts) return
  ts.imageDataUrl = imageDataUrl
  ts.imageBitmap = imageBitmap
  // For single-tile tilesets from folder watch, update dimensions
  if (ts.tiles.length === 1) {
    ts.tileWidth = width
    ts.tileHeight = height
    ts.tiles[0].width = width
    ts.tiles[0].height = height
  }
  notify()
}

export function renameLayer(layerId: string, name: string): void {
  if (!currentMap) return
  const layer = currentMap.layers.find(l => l.id === layerId)
  if (layer) {
    layer.name = name
    notify()
  }
}

export function setLayerOpacity(layerId: string, opacity: number): void {
  if (!currentMap) return
  const layer = currentMap.layers.find(l => l.id === layerId)
  if (layer) {
    layer.opacity = Math.max(0, Math.min(1, opacity))
    notify()
  }
}

export function moveObjectInLayer(layerId: string, objectId: string, direction: 'up' | 'down' | 'front' | 'back'): void {
  if (!currentMap) return
  const layer = currentMap.layers.find(l => l.id === layerId)
  if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return
  const idx = layer.objects.findIndex(o => o.id === objectId)
  if (idx === -1) return

  const [obj] = layer.objects.splice(idx, 1)
  let newIdx: number
  switch (direction) {
    case 'up':    newIdx = Math.min(idx + 1, layer.objects.length); break
    case 'down':  newIdx = Math.max(idx - 1, 0); break
    case 'front': newIdx = layer.objects.length; break
    case 'back':  newIdx = 0; break
  }
  layer.objects.splice(newIdx, 0, obj)
  notify()
}

export function moveZoneInLayer(layerId: string, zoneId: string, direction: 'up' | 'down' | 'front' | 'back'): void {
  if (!currentMap) return
  const layer = currentMap.layers.find(l => l.id === layerId)
  if (!layer || layer.type !== 'object') return
  const idx = layer.zones.findIndex(z => z.id === zoneId)
  if (idx === -1) return

  const [zone] = layer.zones.splice(idx, 1)
  let newIdx: number
  switch (direction) {
    case 'up':    newIdx = Math.min(idx + 1, layer.zones.length); break
    case 'down':  newIdx = Math.max(idx - 1, 0); break
    case 'front': newIdx = layer.zones.length; break
    case 'back':  newIdx = 0; break
  }
  layer.zones.splice(newIdx, 0, zone)
  notify()
}

export function setLayerSortMode(layerId: string, sortMode: 'auto' | 'manual'): void {
  if (!currentMap) return
  const layer = currentMap.layers.find(l => l.id === layerId)
  if (!layer || layer.type !== 'object') return

  // When switching from auto to manual, sort the objects array to match
  // the current visual (depth-sort) order so nothing jumps on screen
  if (sortMode === 'manual' && layer.sortMode !== 'manual') {
    const order = currentMap.config.renderOrder || 'right-down'
    layer.objects.sort((a, b) => {
      const ay = a.y + a.height
      const by = b.y + b.height
      const ax = a.x + a.width / 2
      const bx = b.x + b.width / 2
      const yDir = order.includes('up') ? -1 : 1
      const yDiff = (ay - by) * yDir
      if (yDiff !== 0) return yDiff
      const xDir = order.includes('left') ? -1 : 1
      return (ax - bx) * xDir
    })
  }

  layer.sortMode = sortMode
  notify()
}

export function addGroupToLayer(layerId: string, name: string): ObjectGroup | undefined {
  if (!currentMap) return undefined
  const layer = currentMap.layers.find(l => l.id === layerId)
  if (!layer || layer.type !== 'object') return undefined
  if (!layer.groups) layer.groups = []
  const group: ObjectGroup = { id: crypto.randomUUID(), name, expanded: true }
  layer.groups.push(group)
  notify()
  return group
}

export function removeGroupFromLayer(layerId: string, groupId: string): void {
  if (!currentMap) return
  const layer = currentMap.layers.find(l => l.id === layerId)
  if (!layer || layer.type !== 'object' || !layer.groups) return
  layer.groups = layer.groups.filter(g => g.id !== groupId)
  // Clear groupId on all objects that belonged to this group
  for (const obj of layer.objects) {
    if (obj.groupId === groupId) obj.groupId = undefined
  }
  notify()
}

export function renameGroup(layerId: string, groupId: string, name: string): void {
  if (!currentMap) return
  const layer = currentMap.layers.find(l => l.id === layerId)
  if (!layer || layer.type !== 'object' || !layer.groups) return
  const group = layer.groups.find(g => g.id === groupId)
  if (group) {
    group.name = name
    notify()
  }
}

export function setObjectGroup(layerId: string, objectId: string, groupId: string | undefined): void {
  if (!currentMap) return
  const layer = currentMap.layers.find(l => l.id === layerId)
  if (!layer || layer.type !== 'object') return
  const obj = layer.objects.find(o => o.id === objectId)
  if (obj) {
    obj.groupId = groupId
    notify()
  }
}

export function toggleGroupExpanded(layerId: string, groupId: string): void {
  if (!currentMap) return
  const layer = currentMap.layers.find(l => l.id === layerId)
  if (!layer || layer.type !== 'object' || !layer.groups) return
  const group = layer.groups.find(g => g.id === groupId)
  if (group) {
    group.expanded = !group.expanded
    notify()
  }
}

export function updateMapConfig(newConfig: MapConfig): void {
  if (!currentMap) return
  const safe = sanitizeConfig(newConfig)
  const oldConfig = currentMap.config
  const gridChanged = safe.gridWidth !== oldConfig.gridWidth || safe.gridHeight !== oldConfig.gridHeight

  if (gridChanged) {
    for (const layer of currentMap.layers) {
      if (layer.type !== 'tile') continue
      const newData: (import('../models/tile').TileRef | null)[][] = []
      for (let r = 0; r < safe.gridHeight; r++) {
        const row: (import('../models/tile').TileRef | null)[] = new Array(safe.gridWidth).fill(null)
        for (let c = 0; c < safe.gridWidth; c++) {
          if (r < oldConfig.gridHeight && c < oldConfig.gridWidth) {
            row[c] = layer.data[r]?.[c] ?? null
          }
        }
        newData.push(row)
      }
      layer.data = newData
    }
  }

  currentMap.config = safe
  notify()
}
