import type { Command } from './command'
import type { MapData } from '../models/map'
import type { TileRef } from '../models/tile'

export class PaintCommand implements Command {
  readonly description: string

  constructor(
    private layerId: string,
    private positions: { row: number; col: number }[],
    private newTile: TileRef,
    private previousTiles: (TileRef | null)[]
  ) {
    this.description = `Paint ${positions.length} tile(s)`
  }

  execute(map: MapData): void {
    const layer = map.layers.find(l => l.id === this.layerId)
    if (!layer || layer.type !== 'tile') return
    for (const pos of this.positions) {
      layer.data[pos.row][pos.col] = { ...this.newTile }
    }
  }

  undo(map: MapData): void {
    const layer = map.layers.find(l => l.id === this.layerId)
    if (!layer || layer.type !== 'tile') return
    for (let i = 0; i < this.positions.length; i++) {
      const pos = this.positions[i]
      layer.data[pos.row][pos.col] = this.previousTiles[i]
        ? { ...this.previousTiles[i]! }
        : null
    }
  }
}
