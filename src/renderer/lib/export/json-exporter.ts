import type { MapData } from '../models/map'

export function exportMapAsJson(map: MapData): string {
  const { config, layers, tilesets } = map

  const exported = {
    width: config.gridWidth,
    height: config.gridHeight,
    tileWidth: config.tileWidth,
    tileHeight: config.tileHeight,
    orientation: config.orientation || 'diamond',
    tilesets: tilesets.map(ts => ({
      name: ts.name,
      tileCount: ts.tiles.length,
      tileWidth: ts.tileWidth,
      tileHeight: ts.tileHeight
    })),
    layers: layers.map(l => {
      if (l.type === 'object') {
        return {
          type: 'object',
          name: l.name,
          visible: l.visible,
          opacity: l.opacity,
          objects: l.objects.map(o => ({
            name: o.name, x: o.x, y: o.y, width: o.width, height: o.height,
            flipX: o.flipX || false, flipY: o.flipY || false
          })),
          zones: l.zones.map(z => ({
            name: z.name, color: z.color, points: z.points, closed: z.closed
          })),
          paths: (l.paths || []).map(p => ({
            name: p.name, color: p.color, points: p.points, loop: p.loop,
            assignedObjectId: p.assignedObjectId || undefined
          }))
        }
      }
      if (l.type === 'drawing') {
        return {
          type: 'drawing',
          name: l.name,
          visible: l.visible,
          opacity: l.opacity,
          objects: l.objects.map(o => ({
            name: o.name, x: o.x, y: o.y, width: o.width, height: o.height,
            flipX: o.flipX || false, flipY: o.flipY || false
          }))
        }
      }
      if (l.type === 'image') {
        return {
          type: 'image',
          name: l.name,
          visible: l.visible,
          opacity: l.opacity,
          x: l.x, y: l.y, width: l.width, height: l.height,
          isoTransform: l.isoTransform || false,
          rotation: l.rotation || 0
        }
      }
      return {
        type: 'tile',
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        data: l.data.map(row =>
          row.map(cell =>
            cell ? { tileset: cell.tilesetId, tile: cell.tileIndex } : null
          )
        )
      }
    })
  }

  return JSON.stringify(exported, null, 2)
}
