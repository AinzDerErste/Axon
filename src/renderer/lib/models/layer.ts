import type { TileRef } from './tile'

/** Organizational group for objects within an object layer */
export interface ObjectGroup {
  id: string
  name: string
  /** Whether the group is expanded in the panel */
  expanded?: boolean
}

/** Object placed freely on an object layer */
export interface MapObject {
  id: string
  name: string
  imageDataUrl: string
  imageBitmap?: ImageBitmap
  /** Hash key into the central image cache (runtime only, not persisted) */
  imageHash?: string
  /** World X position (isometric space) */
  x: number
  /** World Y position (isometric space) */
  y: number
  width: number
  height: number
  /** Flip horizontally */
  flipX?: boolean
  /** Flip vertically */
  flipY?: boolean
  /** Rotation in degrees (clockwise) */
  rotation?: number
  /** Prevent moving, resizing, and deleting */
  locked?: boolean
  /** Hide object on canvas (default true / undefined = visible) */
  visible?: boolean
  /** ID of the group this object belongs to (undefined = ungrouped) */
  groupId?: string
}

/** A zone polygon defined by world-space points */
export interface Zone {
  id: string
  name: string
  color: string
  /** Polygon vertices in world coordinates */
  points: { x: number; y: number }[]
  /** Whether the polygon is closed (complete) */
  closed: boolean
  /** Zone type: regular zone or collision zone */
  zoneType?: 'zone' | 'collision'
}

/** A waypoint path for patrol routes or movement paths */
export interface Path {
  id: string
  name: string
  color: string
  /** Waypoints in world coordinates (order defines direction) */
  points: { x: number; y: number }[]
  /** Whether the path loops back to the first point */
  loop: boolean
  /** ID of the MapObject that follows this path */
  assignedObjectId?: string
}

export interface TileLayer {
  type: 'tile'
  id: string
  name: string
  visible: boolean
  opacity: number
  /** 2D grid [row][col], null = empty cell */
  data: (TileRef | null)[][]
}

export interface ObjectLayer {
  type: 'object'
  id: string
  name: string
  visible: boolean
  opacity: number
  objects: MapObject[]
  zones: Zone[]
  paths: Path[]
  /** Object draw order: 'auto' = isometric depth sort, 'manual' = array order */
  sortMode?: 'auto' | 'manual'
  /** Organizational groups for objects */
  groups?: ObjectGroup[]
}

export interface ImageLayer {
  type: 'image'
  id: string
  name: string
  visible: boolean
  opacity: number
  /** Base64 data URL of the image */
  imageDataUrl: string
  /** Decoded bitmap for rendering (not persisted) */
  imageBitmap?: ImageBitmap
  /** Hash key into the central image cache (runtime only, not persisted) */
  imageHash?: string
  /** World X position */
  x: number
  /** World Y position */
  y: number
  /** Display width in world units */
  width: number
  /** Display height in world units */
  height: number
  /** Apply isometric projection transform to match the map grid angle */
  isoTransform?: boolean
  /** Rotation in degrees (clockwise) */
  rotation?: number
  /** Prevent moving, resizing, and deleting */
  locked?: boolean
}

export interface DrawingLayer {
  type: 'drawing'
  id: string
  name: string
  visible: boolean
  opacity: number
  objects: MapObject[]
}

export type Layer = TileLayer | ObjectLayer | ImageLayer | DrawingLayer

export function createLayer(id: string, name: string, rows: number, cols: number): TileLayer {
  const data: (TileRef | null)[][] = []
  for (let r = 0; r < rows; r++) {
    data.push(new Array(cols).fill(null))
  }
  return { type: 'tile', id, name, visible: true, opacity: 1.0, data }
}

export function createObjectLayer(id: string, name: string): ObjectLayer {
  return { type: 'object', id, name, visible: true, opacity: 1.0, objects: [], zones: [], paths: [] }
}

export function createDrawingLayer(id: string, name: string): DrawingLayer {
  return { type: 'drawing', id, name, visible: true, opacity: 1.0, objects: [] }
}

export function createImageLayer(
  id: string,
  name: string,
  imageDataUrl: string,
  imageBitmap: ImageBitmap,
  width: number,
  height: number
): ImageLayer {
  return {
    type: 'image', id, name, visible: true, opacity: 1.0,
    imageDataUrl, imageBitmap, x: 0, y: 0, width, height
  }
}
