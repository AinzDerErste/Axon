/**
 * Extracts a network operation from a Command instance by inspecting its type.
 * Returns null if the command type is not recognized or not syncable.
 */

import type { Command } from '../commands/command'
import { PaintCommand } from '../commands/paint-command'
import { EraseCommand } from '../commands/erase-command'
import { FillCommand } from '../commands/fill-command'
import { PlaceObjectCommand, MoveObjectCommand, DeleteObjectCommand } from '../commands/object-command'
import { AddZoneCommand, DeleteZoneCommand } from '../commands/zone-command'
import { AddPathCommand, DeletePathCommand } from '../commands/path-command'

export interface CollabOp {
  opType: string
  layerId: string
  data: any
}

/**
 * Convert a locally-executed Command into a minimal operation payload for network broadcast.
 * Uses private field access via (cmd as any) since Commands store their data as private fields.
 */
export function commandToOp(cmd: Command): CollabOp | null {
  if (cmd instanceof PaintCommand) {
    const c = cmd as any
    return {
      opType: 'tile-paint',
      layerId: c.layerId,
      data: {
        cells: c.positions.map((pos: any, i: number) => ({
          col: pos.col,
          row: pos.row,
          tileRef: c.newTile
        }))
      }
    }
  }

  if (cmd instanceof EraseCommand) {
    const c = cmd as any
    return {
      opType: 'tile-erase',
      layerId: c.layerId,
      data: {
        cells: c.positions.map((pos: any) => ({
          col: pos.col,
          row: pos.row
        }))
      }
    }
  }

  if (cmd instanceof FillCommand) {
    const c = cmd as any
    return {
      opType: 'tile-fill',
      layerId: c.layerId,
      data: {
        cells: c.positions.map((pos: any) => ({
          col: pos.col,
          row: pos.row,
          tileRef: c.newTile
        }))
      }
    }
  }

  if (cmd instanceof PlaceObjectCommand) {
    const c = cmd as any
    return {
      opType: 'object-add',
      layerId: c.layerId,
      data: { object: serializeMapObject(c.object) }
    }
  }

  if (cmd instanceof MoveObjectCommand) {
    const c = cmd as any
    return {
      opType: 'object-move',
      layerId: c.layerId,
      data: { objectId: c.objectId, x: c.newX, y: c.newY }
    }
  }

  if (cmd instanceof DeleteObjectCommand) {
    const c = cmd as any
    return {
      opType: 'object-delete',
      layerId: c.layerId,
      data: { objectId: c.object.id }
    }
  }

  if (cmd instanceof AddZoneCommand) {
    const c = cmd as any
    return {
      opType: 'zone-add',
      layerId: c.layerId,
      data: { zone: c.zone }
    }
  }

  if (cmd instanceof DeleteZoneCommand) {
    const c = cmd as any
    return {
      opType: 'zone-delete',
      layerId: c.layerId,
      data: { zoneId: c.zone.id }
    }
  }

  if (cmd instanceof AddPathCommand) {
    const c = cmd as any
    return {
      opType: 'path-add',
      layerId: c.layerId,
      data: { path: c.path }
    }
  }

  if (cmd instanceof DeletePathCommand) {
    const c = cmd as any
    return {
      opType: 'path-delete',
      layerId: c.layerId,
      data: { pathId: c.path.id }
    }
  }

  // BatchCommand, PresetCommand, Reorder commands — not synced individually for now
  return null
}

/** Strip imageBitmap (non-serializable) from MapObject for network transfer */
function serializeMapObject(obj: any): any {
  const { imageBitmap, ...rest } = obj
  return rest
}
