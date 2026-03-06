/** A reference to a specific tile image within a tileset */
export interface TileRef {
  tilesetId: string
  tileIndex: number
}

/** Metadata for a single tile image within a tileset */
export interface TileEntry {
  id: number
  x: number
  y: number
  width: number
  height: number
}
