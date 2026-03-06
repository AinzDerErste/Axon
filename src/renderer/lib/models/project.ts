import type { MapConfig } from './map'
import type { Layer } from './layer'
import type { Tileset } from './tileset'
import type { SerializedObjectImage } from '../stores/object-library-store'

/** On-disk format for .isomapproject files */
export interface ProjectFile {
  version: 1
  config: MapConfig
  layers: Layer[]
  tilesets: Omit<Tileset, 'imageBitmap'>[]
  activeLayerId: string
  camera: { x: number; y: number; zoom: number }
  /** Object image library (persisted across sessions) */
  objectLibrary?: SerializedObjectImage[]
}
