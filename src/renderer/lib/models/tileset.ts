import type { TileEntry } from './tile'

export interface Tileset {
  id: string
  name: string
  imageDataUrl: string
  imageBitmap: ImageBitmap | null
  /** Hash key into the central image cache (runtime only, not persisted) */
  imageHash?: string
  tileWidth: number
  tileHeight: number
  columns: number
  tiles: TileEntry[]
  /** Absolute file path when imported from a watched folder (used for auto-sync) */
  sourcePath?: string
}
