import type { Command } from './command'
import type { MapData, Orientation } from '../models/map'
import type { TileRef } from '../models/tile'
import { getNeighbors } from '../engine/iso-math'

/**
 * Lightweight BFS that only counts how many tiles a fill would affect.
 * Stops early once the count exceeds `limit`, returning limit + 1.
 * This avoids the heavy allocation of storing millions of positions.
 */
export function estimateFillCount(
  layerData: (TileRef | null)[][],
  startCol: number,
  startRow: number,
  newTile: TileRef,
  gridWidth: number,
  gridHeight: number,
  limit: number,
  orientation: Orientation = 'diamond'
): number {
  const targetTile = layerData[startRow]?.[startCol]
  const targetKey = targetTile ? `${targetTile.tilesetId}:${targetTile.tileIndex}` : 'null'
  const newKey = `${newTile.tilesetId}:${newTile.tileIndex}`

  if (targetKey === newKey) return 0

  // Use a flat boolean grid for fast lookups instead of Set<string>
  const visited = new Uint8Array(gridWidth * gridHeight)
  const queue: number[] = [startCol, startRow] // flat pairs: [col, row, col, row, ...]
  let count = 0
  let head = 0

  while (head < queue.length) {
    const col = queue[head++]
    const row = queue[head++]

    if (col < 0 || row < 0 || col >= gridWidth || row >= gridHeight) continue
    const idx = row * gridWidth + col
    if (visited[idx]) continue

    const current = layerData[row]?.[col]
    const currentKey = current ? `${current.tilesetId}:${current.tileIndex}` : 'null'
    if (currentKey !== targetKey) continue

    visited[idx] = 1
    count++

    if (count > limit) return count // early bailout

    for (const n of getNeighbors(col, row, orientation)) {
      queue.push(n.col, n.row)
    }
  }

  return count
}

export class FillCommand implements Command {
  readonly description: string
  private positions: { row: number; col: number }[] = []
  private previousTiles: (TileRef | null)[] = []

  /** Number of tiles that will be affected by this fill */
  get fillCount(): number {
    return this.positions.length
  }

  constructor(
    private layerId: string,
    private startCol: number,
    private startRow: number,
    private newTile: TileRef,
    layerData: (TileRef | null)[][],
    private gridWidth: number,
    private gridHeight: number,
    private orientation: Orientation = 'diamond'
  ) {
    this.description = 'Flood fill'
    // Pre-calculate the fill area
    this.calculateFill(layerData)
  }

  private calculateFill(layerData: (TileRef | null)[][]): void {
    const targetTile = layerData[this.startRow]?.[this.startCol]
    const targetKey = targetTile ? `${targetTile.tilesetId}:${targetTile.tileIndex}` : 'null'
    const newKey = `${this.newTile.tilesetId}:${this.newTile.tileIndex}`

    if (targetKey === newKey) return // Already the same tile

    const visited = new Set<string>()
    const queue: { col: number; row: number }[] = [{ col: this.startCol, row: this.startRow }]

    while (queue.length > 0) {
      const { col, row } = queue.shift()!
      const key = `${col},${row}`
      if (visited.has(key)) continue
      if (col < 0 || row < 0 || col >= this.gridWidth || row >= this.gridHeight) continue

      const current = layerData[row]?.[col]
      const currentKey = current ? `${current.tilesetId}:${current.tileIndex}` : 'null'
      if (currentKey !== targetKey) continue

      visited.add(key)
      this.positions.push({ row, col })
      this.previousTiles.push(current ? { ...current } : null)

      for (const n of getNeighbors(col, row, this.orientation)) {
        queue.push(n)
      }
    }
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
