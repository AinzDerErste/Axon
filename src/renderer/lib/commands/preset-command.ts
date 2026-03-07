import type { Command } from './command'
import type { MapData } from '../models/map'
import type { Preset } from '../models/preset'
import type { TileRef } from '../models/tile'
import type { MapObject, Zone, TileLayer, ObjectLayer } from '../models/layer'

/** Places an entire preset (tiles + objects + zones) on the map — undoable */
export class PlacePresetCommand implements Command {
  readonly description: string

  // Stored for undo
  private previousTiles: { layerId: string; row: number; col: number; old: TileRef | null }[] = []
  private placedObjectIds: { layerId: string; objectId: string }[] = []
  private placedZoneIds: { layerId: string; zoneId: string }[] = []

  constructor(
    private preset: Preset,
    private baseCol: number,
    private baseRow: number,
    private anchorWorldX: number,
    private anchorWorldY: number,
    targetMap: MapData
  ) {
    this.description = `Place preset "${preset.name}"`
    // Capture previous tile values for undo
    for (const presetLayer of preset.tileLayers) {
      const mapLayer = targetMap.layers.find(
        l => l.type === 'tile' && l.name === presetLayer.name
      ) as TileLayer | undefined
      if (!mapLayer) continue
      for (let r = 0; r < presetLayer.tiles.length; r++) {
        for (let c = 0; c < presetLayer.tiles[r].length; c++) {
          if (presetLayer.tiles[r][c] === null) continue
          const mapRow = baseRow + r
          const mapCol = baseCol + c
          if (mapRow < 0 || mapRow >= mapLayer.data.length) continue
          if (mapCol < 0 || mapCol >= (mapLayer.data[0]?.length ?? 0)) continue
          this.previousTiles.push({
            layerId: mapLayer.id,
            row: mapRow,
            col: mapCol,
            old: mapLayer.data[mapRow][mapCol]
          })
        }
      }
    }
  }

  execute(map: MapData): void {
    // 1. Place tiles
    for (const presetLayer of this.preset.tileLayers) {
      const mapLayer = map.layers.find(
        l => l.type === 'tile' && l.name === presetLayer.name
      ) as TileLayer | undefined
      if (!mapLayer) continue
      for (let r = 0; r < presetLayer.tiles.length; r++) {
        for (let c = 0; c < presetLayer.tiles[r].length; c++) {
          const tile = presetLayer.tiles[r][c]
          if (tile === null) continue
          const mapRow = this.baseRow + r
          const mapCol = this.baseCol + c
          if (mapRow < 0 || mapRow >= mapLayer.data.length) continue
          if (mapCol < 0 || mapCol >= (mapLayer.data[0]?.length ?? 0)) continue
          mapLayer.data[mapRow][mapCol] = { ...tile }
        }
      }
    }

    // 2. Place objects
    this.placedObjectIds = []
    for (const presetObj of this.preset.objects) {
      const objLayer = map.layers.find(
        l => (l.type === 'object' || l.type === 'drawing') && l.name === presetObj.name
      ) || map.layers.find(l => l.type === 'object' || l.type === 'drawing')
      if (!objLayer || (objLayer.type !== 'object' && objLayer.type !== 'drawing')) continue
      const newObj: MapObject = {
        id: crypto.randomUUID(),
        name: presetObj.name,
        imageDataUrl: presetObj.imageDataUrl,
        x: this.anchorWorldX + presetObj.relX,
        y: this.anchorWorldY + presetObj.relY,
        width: presetObj.width,
        height: presetObj.height,
        flipX: presetObj.flipX,
        flipY: presetObj.flipY,
        rotation: presetObj.rotation
      }
      // Reconstitute imageBitmap
      const img = new Image()
      img.src = presetObj.imageDataUrl
      img.onload = () => {
        createImageBitmap(img).then(bmp => {
          newObj.imageBitmap = bmp
        })
      }
      objLayer.objects.push(newObj)
      this.placedObjectIds.push({ layerId: objLayer.id, objectId: newObj.id })
    }

    // 3. Place zones
    this.placedZoneIds = []
    for (const presetZone of this.preset.zones) {
      const zoneLayer = map.layers.find(
        l => l.type === 'object'
      ) as ObjectLayer | undefined
      if (!zoneLayer) continue
      const newZone: Zone = {
        id: crypto.randomUUID(),
        name: presetZone.name,
        color: presetZone.color,
        points: presetZone.points.map(p => ({
          x: this.anchorWorldX + p.relX,
          y: this.anchorWorldY + p.relY
        })),
        closed: presetZone.closed,
        zoneType: presetZone.zoneType
      }
      zoneLayer.zones.push(newZone)
      this.placedZoneIds.push({ layerId: zoneLayer.id, zoneId: newZone.id })
    }
  }

  undo(map: MapData): void {
    // 1. Restore tiles
    for (const prev of this.previousTiles) {
      const layer = map.layers.find(l => l.id === prev.layerId) as TileLayer | undefined
      if (!layer) continue
      layer.data[prev.row][prev.col] = prev.old
    }

    // 2. Remove placed objects
    for (const { layerId, objectId } of this.placedObjectIds) {
      const layer = map.layers.find(l => l.id === layerId)
      if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) continue
      layer.objects = layer.objects.filter(o => o.id !== objectId)
    }

    // 3. Remove placed zones
    for (const { layerId, zoneId } of this.placedZoneIds) {
      const layer = map.layers.find(l => l.id === layerId) as ObjectLayer | undefined
      if (!layer) continue
      layer.zones = layer.zones.filter(z => z.id !== zoneId)
    }
  }
}
