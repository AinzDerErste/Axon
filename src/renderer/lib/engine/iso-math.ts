import type { Orientation } from '../models/map'

export interface ScreenPoint {
  x: number
  y: number
}

export interface MapPoint {
  col: number
  row: number
}

/** Convert map grid coordinates to screen pixel coordinates */
export function mapToScreen(
  col: number,
  row: number,
  tileWidth: number,
  tileHeight: number,
  orientation: Orientation = 'diamond'
): ScreenPoint {
  if (orientation === 'staggered') {
    return {
      x: col * tileWidth + (row & 1) * (tileWidth / 2),
      y: row * (tileHeight / 2)
    }
  }
  // Diamond (default)
  return {
    x: (col - row) * (tileWidth / 2),
    y: (col + row) * (tileHeight / 2)
  }
}

/** Convert screen pixel coordinates to map grid coordinates */
export function screenToMap(
  screenX: number,
  screenY: number,
  tileWidth: number,
  tileHeight: number,
  orientation: Orientation = 'diamond'
): MapPoint {
  if (orientation === 'staggered') {
    const halfH = tileHeight / 2
    const halfW = tileWidth / 2

    // Rough row/col estimate
    const roughRow = Math.floor(screenY / halfH)
    const isOdd = roughRow & 1
    const adjustedX = screenX - (isOdd ? halfW : 0)
    const roughCol = Math.floor(adjustedX / tileWidth)
    const relX = adjustedX - roughCol * tileWidth
    const relY = screenY - roughRow * halfH

    // Refine: check if in the upper triangles that belong to the previous row
    if (relX >= 0 && relX < halfW && (relX / halfW + relY / halfH) < 1) {
      // Upper-left triangle
      return {
        col: isOdd ? roughCol : roughCol - 1,
        row: roughRow - 1
      }
    }
    if (relX >= halfW && relX < tileWidth && ((tileWidth - relX) / halfW + relY / halfH) < 1) {
      // Upper-right triangle
      return {
        col: isOdd ? roughCol + 1 : roughCol,
        row: roughRow - 1
      }
    }

    return { col: roughCol, row: roughRow }
  }

  // Diamond (default)
  const halfW = tileWidth / 2
  const halfH = tileHeight / 2
  return {
    col: Math.floor((screenX / halfW + screenY / halfH) / 2),
    row: Math.floor((screenY / halfH - screenX / halfW) / 2)
  }
}

/** Get the grid-neighbor tiles for flood-fill / adjacency checks.
 *  Diamond uses 4-directional, staggered uses 6-directional
 *  (accounting for the half-tile row offset). */
export function getNeighbors(
  col: number, row: number, orientation: Orientation
): { col: number; row: number }[] {
  if (orientation === 'staggered') {
    const isOdd = row & 1
    return [
      { col: col - 1, row },                          // left
      { col: col + 1, row },                          // right
      { col: col - (isOdd ? 0 : 1), row: row - 1 },  // upper-left
      { col: col + (isOdd ? 1 : 0), row: row - 1 },  // upper-right
      { col: col - (isOdd ? 0 : 1), row: row + 1 },  // lower-left
      { col: col + (isOdd ? 1 : 0), row: row + 1 },  // lower-right
    ]
  }
  // Diamond: 4-directional
  return [
    { col: col + 1, row },
    { col: col - 1, row },
    { col, row: row + 1 },
    { col, row: row - 1 }
  ]
}

/** Snap a world position to the nearest tile corner vertex */
export function snapToTileCorner(
  worldX: number,
  worldY: number,
  tileWidth: number,
  tileHeight: number,
  gridWidth: number,
  gridHeight: number,
  orientation: Orientation = 'diamond'
): ScreenPoint {
  const halfW = tileWidth / 2
  const halfH = tileHeight / 2

  // Find the tile the point is in (using fractional coords)
  const mapped = screenToMap(worldX, worldY, tileWidth, tileHeight, orientation)
  const baseCol = mapped.col
  const baseRow = mapped.row

  let bestDist = Infinity
  let bestPoint: ScreenPoint = { x: worldX, y: worldY }

  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) {
      const c = baseCol + dc
      const r = baseRow + dr
      if (c < 0 || r < 0 || c > gridWidth || r > gridHeight) continue
      const diamond = getTileDiamond(c, r, tileWidth, tileHeight, orientation)
      for (const p of [diamond.top, diamond.right, diamond.bottom, diamond.left]) {
        const dx = p.x - worldX
        const dy = p.y - worldY
        const dist = dx * dx + dy * dy
        if (dist < bestDist) {
          bestDist = dist
          bestPoint = p
        }
      }
    }
  }

  return bestPoint
}

/** Get the four corner vertices of an isometric tile diamond */
export function getTileDiamond(
  col: number,
  row: number,
  tileWidth: number,
  tileHeight: number,
  orientation: Orientation = 'diamond'
): { top: ScreenPoint; right: ScreenPoint; bottom: ScreenPoint; left: ScreenPoint } {
  const center = mapToScreen(col, row, tileWidth, tileHeight, orientation)
  const halfW = tileWidth / 2
  const halfH = tileHeight / 2
  return {
    top: { x: center.x, y: center.y },
    right: { x: center.x + halfW, y: center.y + halfH },
    bottom: { x: center.x, y: center.y + tileHeight },
    left: { x: center.x - halfW, y: center.y + halfH }
  }
}
