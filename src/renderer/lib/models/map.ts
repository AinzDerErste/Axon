import type { Layer } from './layer'
import type { Tileset } from './tileset'

export type Orientation = 'diamond' | 'staggered'
export type RenderOrder = 'right-down' | 'right-up' | 'left-down' | 'left-up'

export interface MapConfig {
  name: string
  gridWidth: number
  gridHeight: number
  tileWidth: number
  tileHeight: number
  orientation: Orientation
  renderOrder?: RenderOrder
}

export interface MapData {
  config: MapConfig
  layers: Layer[]
  tilesets: Tileset[]
  activeLayerId: string
}
