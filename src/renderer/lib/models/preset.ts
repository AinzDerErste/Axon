import type { TileRef } from './tile'

/** A single tile layer's data within a preset */
export interface PresetTileLayer {
  name: string
  tiles: (TileRef | null)[][]  // [row][col] relative to preset origin
}

/** An object captured within a preset */
export interface PresetObject {
  name: string
  imageDataUrl: string
  relX: number
  relY: number
  width: number
  height: number
  flipX?: boolean
  flipY?: boolean
  rotation?: number
}

/** A zone captured within a preset */
export interface PresetZone {
  name: string
  color: string
  points: { relX: number; relY: number }[]
  closed: boolean
  zoneType?: 'zone' | 'collision'
}

/** A reusable preset/prefab containing tiles, objects, and zones */
export interface Preset {
  id: string
  name: string
  width: number   // grid cells
  height: number  // grid cells
  tileLayers: PresetTileLayer[]
  objects: PresetObject[]
  zones: PresetZone[]
  thumbnail?: string  // data URL for panel preview
}
