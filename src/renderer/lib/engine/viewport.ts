import type { MapConfig } from '../models/map'
import type { Camera } from './camera'
import { screenToMap } from './iso-math'

export interface VisibleRange {
  minCol: number
  maxCol: number
  minRow: number
  maxRow: number
}

/** Compute the visible tile range given the camera and viewport dimensions */
export function getVisibleRange(
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  config: MapConfig
): VisibleRange {
  const orientation = config.orientation || 'diamond'

  // Convert viewport corners to world coordinates, then to map coordinates
  const topLeft = camera.screenToWorld(0, 0)
  const topRight = camera.screenToWorld(viewportWidth, 0)
  const bottomLeft = camera.screenToWorld(0, viewportHeight)
  const bottomRight = camera.screenToWorld(viewportWidth, viewportHeight)

  const corners = [topLeft, topRight, bottomLeft, bottomRight]
  const mapCoords = corners.map(c =>
    screenToMap(c.wx, c.wy, config.tileWidth, config.tileHeight, orientation)
  )

  // Add padding for tiles that might be partially visible
  const padding = 2
  const minCol = Math.max(0, Math.min(...mapCoords.map(m => m.col)) - padding)
  const maxCol = Math.min(config.gridWidth - 1, Math.max(...mapCoords.map(m => m.col)) + padding)
  const minRow = Math.max(0, Math.min(...mapCoords.map(m => m.row)) - padding)
  const maxRow = Math.min(config.gridHeight - 1, Math.max(...mapCoords.map(m => m.row)) + padding)

  return { minCol, maxCol, minRow, maxRow }
}
