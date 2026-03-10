/**
 * Apply a remote operation to the local MapData.
 * This directly mutates the map state WITHOUT going through the history/command system,
 * so remote ops do NOT appear in the local undo stack.
 */

import type { MapData } from '../models/map'
import type { TileLayer, ObjectLayer, MapObject, Zone, Path } from '../models/layer'
import type { CollabOp } from './op-serializer'
import { registerImageSync, getBitmap } from '../stores/image-cache'

/**
 * Apply a single remote operation to the map.
 * Returns true if the operation was applied (map was modified), false otherwise.
 */
export function applyRemoteOp(map: MapData, op: CollabOp): boolean {
  switch (op.opType) {
    case 'tile-paint':
      return applyTilePaint(map, op)
    case 'tile-erase':
      return applyTileErase(map, op)
    case 'tile-fill':
      return applyTileFill(map, op)
    case 'object-add':
      return applyObjectAdd(map, op)
    case 'object-move':
      return applyObjectMove(map, op)
    case 'object-delete':
      return applyObjectDelete(map, op)
    case 'zone-add':
      return applyZoneAdd(map, op)
    case 'zone-delete':
      return applyZoneDelete(map, op)
    case 'path-add':
      return applyPathAdd(map, op)
    case 'path-delete':
      return applyPathDelete(map, op)
    default:
      console.warn('[collab] Unknown op type:', op.opType)
      return false
  }
}

function findTileLayer(map: MapData, layerId: string): TileLayer | null {
  const layer = map.layers.find(l => l.id === layerId)
  return layer && layer.type === 'tile' ? layer : null
}

function findObjectLayer(map: MapData, layerId: string): ObjectLayer | null {
  const layer = map.layers.find(l => l.id === layerId)
  return layer && layer.type === 'object' ? layer : null
}

function applyTilePaint(map: MapData, op: CollabOp): boolean {
  const layer = findTileLayer(map, op.layerId)
  if (!layer) return false
  for (const cell of op.data.cells) {
    if (cell.row >= 0 && cell.row < layer.data.length &&
        cell.col >= 0 && cell.col < (layer.data[0]?.length ?? 0)) {
      layer.data[cell.row][cell.col] = { ...cell.tileRef }
    }
  }
  return true
}

function applyTileErase(map: MapData, op: CollabOp): boolean {
  const layer = findTileLayer(map, op.layerId)
  if (!layer) return false
  for (const cell of op.data.cells) {
    if (cell.row >= 0 && cell.row < layer.data.length &&
        cell.col >= 0 && cell.col < (layer.data[0]?.length ?? 0)) {
      layer.data[cell.row][cell.col] = null
    }
  }
  return true
}

function applyTileFill(map: MapData, op: CollabOp): boolean {
  // Fill is sent as the complete list of cells (same as paint)
  return applyTilePaint(map, op)
}

function applyObjectAdd(map: MapData, op: CollabOp): boolean {
  const layer = map.layers.find(l => l.id === op.layerId)
  if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return false

  const obj: MapObject = { ...op.data.object }
  // Register image in cache and get bitmap
  if (obj.imageDataUrl) {
    const hash = registerImageSync(obj.imageDataUrl)
    obj.imageHash = hash
    obj.imageBitmap = getBitmap(hash)
  }

  // Avoid duplicate if already exists
  if (!layer.objects.find(o => o.id === obj.id)) {
    layer.objects.push(obj)
  }
  return true
}

function applyObjectMove(map: MapData, op: CollabOp): boolean {
  const layer = map.layers.find(l => l.id === op.layerId)
  if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return false
  const obj = layer.objects.find(o => o.id === op.data.objectId)
  if (!obj) return false
  obj.x = op.data.x
  obj.y = op.data.y
  return true
}

function applyObjectDelete(map: MapData, op: CollabOp): boolean {
  const layer = map.layers.find(l => l.id === op.layerId)
  if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return false
  layer.objects = layer.objects.filter(o => o.id !== op.data.objectId)
  return true
}

function applyZoneAdd(map: MapData, op: CollabOp): boolean {
  const layer = findObjectLayer(map, op.layerId)
  if (!layer) return false
  const zone: Zone = { ...op.data.zone }
  if (!layer.zones.find(z => z.id === zone.id)) {
    layer.zones.push(zone)
  }
  return true
}

function applyZoneDelete(map: MapData, op: CollabOp): boolean {
  const layer = findObjectLayer(map, op.layerId)
  if (!layer) return false
  layer.zones = layer.zones.filter(z => z.id !== op.data.zoneId)
  return true
}

function applyPathAdd(map: MapData, op: CollabOp): boolean {
  const layer = findObjectLayer(map, op.layerId)
  if (!layer) return false
  const path: Path = { ...op.data.path }
  if (!layer.paths.find(p => p.id === path.id)) {
    layer.paths.push(path)
  }
  return true
}

function applyPathDelete(map: MapData, op: CollabOp): boolean {
  const layer = findObjectLayer(map, op.layerId)
  if (!layer) return false
  layer.paths = layer.paths.filter(p => p.id !== op.data.pathId)
  return true
}
