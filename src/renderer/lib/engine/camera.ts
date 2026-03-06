import type { Orientation } from '../models/map'

export class Camera {
  x: number = 0
  y: number = 0
  zoom: number = 1.0
  minZoom: number = 0.05
  maxZoom: number = 5.0

  /** Convert screen pixel coords (from mouse event) to world coords */
  screenToWorld(screenX: number, screenY: number): { wx: number; wy: number } {
    return {
      wx: screenX / this.zoom + this.x,
      wy: screenY / this.zoom + this.y
    }
  }

  /** Convert world coords to screen coords for rendering */
  worldToScreen(wx: number, wy: number): { sx: number; sy: number } {
    return {
      sx: (wx - this.x) * this.zoom,
      sy: (wy - this.y) * this.zoom
    }
  }

  pan(dx: number, dy: number): void {
    this.x -= dx / this.zoom
    this.y -= dy / this.zoom
  }

  zoomAt(screenX: number, screenY: number, delta: number): void {
    const worldBefore = this.screenToWorld(screenX, screenY)
    const factor = delta > 0 ? 0.9 : 1.1
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor))
    const worldAfter = this.screenToWorld(screenX, screenY)
    this.x += worldBefore.wx - worldAfter.wx
    this.y += worldBefore.wy - worldAfter.wy
  }

  /** Compute a dynamic minZoom so the entire map fits in the viewport */
  updateMinZoom(
    gridWidth: number, gridHeight: number,
    tileWidth: number, tileHeight: number,
    viewportWidth: number, viewportHeight: number,
    orientation: Orientation = 'diamond'
  ): void {
    let worldWidth: number
    let worldHeight: number

    if (orientation === 'staggered') {
      // Staggered: roughly rectangular layout
      worldWidth = (gridWidth + 0.5) * tileWidth
      worldHeight = (gridHeight + 1) * (tileHeight / 2)
    } else {
      // Diamond: isometric diamond bounding box
      worldWidth = (gridWidth + gridHeight) * (tileWidth / 2)
      worldHeight = (gridWidth + gridHeight) * (tileHeight / 2)
    }

    const fitZoom = Math.min(
      viewportWidth / worldWidth,
      viewportHeight / worldHeight
    ) * 0.8
    // Allow zooming out well past fit level, especially for very large maps
    this.minZoom = Math.max(0.0001, fitZoom * 0.15)
  }

  /** Center the camera on an isometric map, resetting zoom to fit */
  centerOnMap(
    gridWidth: number, gridHeight: number,
    tileWidth: number, tileHeight: number,
    viewportWidth: number, viewportHeight: number,
    orientation: Orientation = 'diamond'
  ): void {
    this.updateMinZoom(gridWidth, gridHeight, tileWidth, tileHeight, viewportWidth, viewportHeight, orientation)

    let worldWidth: number
    let worldHeight: number
    let mapCenterX: number
    let mapCenterY: number

    if (orientation === 'staggered') {
      worldWidth = (gridWidth + 0.5) * tileWidth
      worldHeight = (gridHeight + 1) * (tileHeight / 2)
      mapCenterX = worldWidth / 2
      mapCenterY = worldHeight / 2
    } else {
      worldWidth = (gridWidth + gridHeight) * (tileWidth / 2)
      worldHeight = (gridWidth + gridHeight) * (tileHeight / 2)
      const halfW = tileWidth / 2
      const halfH = tileHeight / 2
      mapCenterX = (gridWidth - gridHeight) * halfW / 2
      mapCenterY = (gridWidth + gridHeight) * halfH / 2
    }

    // Set zoom to fit the entire map with 20% margin
    this.zoom = Math.max(
      this.minZoom,
      Math.min(this.maxZoom, Math.min(viewportWidth / worldWidth, viewportHeight / worldHeight) * 0.8)
    )

    this.x = mapCenterX - viewportWidth / (2 * this.zoom)
    this.y = mapCenterY - viewportHeight / (2 * this.zoom)
  }
}
