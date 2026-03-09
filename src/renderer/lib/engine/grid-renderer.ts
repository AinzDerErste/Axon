import type { MapConfig } from '../models/map'
import type { VisibleRange } from './viewport'
import { mapToScreen } from './iso-math'

/**
 * Draw the full grid (lines + boundary + hover).
 * Used as fallback when grid caching is not available.
 */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  config: MapConfig,
  hoverCol: number,
  hoverRow: number,
  zoom: number = 1,
  visibleRange?: VisibleRange
): void {
  const o = config.orientation || 'diamond'

  if (o === 'staggered') {
    drawStaggeredGridLines(ctx, config, visibleRange)
    drawStaggeredBoundary(ctx, config, zoom)
  } else {
    drawDiamondGridLines(ctx, config, visibleRange)
    drawDiamondBoundary(ctx, config, zoom)
  }

  drawHoverHighlight(ctx, config, hoverCol, hoverRow)
}

/**
 * Draw only the grid lines for the entire map (no range filter).
 * Output is zoom-independent and suitable for caching to OffscreenCanvas.
 */
export function drawGridLinesFullMap(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  config: MapConfig
): void {
  const o = config.orientation || 'diamond'
  if (o === 'staggered') {
    drawStaggeredGridLines(ctx as CanvasRenderingContext2D, config)
  } else {
    drawDiamondGridLines(ctx as CanvasRenderingContext2D, config)
  }
}

/** Draw the map boundary outline (zoom-dependent line width). */
export function drawBoundary(
  ctx: CanvasRenderingContext2D,
  config: MapConfig,
  zoom: number
): void {
  const o = config.orientation || 'diamond'
  if (o === 'staggered') {
    drawStaggeredBoundary(ctx, config, zoom)
  } else {
    drawDiamondBoundary(ctx, config, zoom)
  }
}

/** Draw the hover tile highlight. */
export function drawHoverHighlight(
  ctx: CanvasRenderingContext2D,
  config: MapConfig,
  hoverCol: number,
  hoverRow: number
): void {
  const { gridWidth, gridHeight, tileWidth, tileHeight, orientation } = config
  const o = orientation || 'diamond'
  if (hoverCol >= 0 && hoverCol < gridWidth && hoverRow >= 0 && hoverRow < gridHeight) {
    const top = mapToScreen(hoverCol, hoverRow, tileWidth, tileHeight, o)
    const halfW = tileWidth / 2
    const halfH = tileHeight / 2
    ctx.fillStyle = 'rgba(137, 180, 250, 0.15)'
    ctx.strokeStyle = 'rgba(137, 180, 250, 0.6)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(top.x, top.y)
    ctx.lineTo(top.x + halfW, top.y + halfH)
    ctx.lineTo(top.x, top.y + tileHeight)
    ctx.lineTo(top.x - halfW, top.y + halfH)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
}

// ── Internal helpers ──

function drawDiamondGridLines(
  ctx: CanvasRenderingContext2D,
  config: MapConfig,
  range?: VisibleRange
): void {
  const { gridWidth, gridHeight, tileWidth, tileHeight } = config

  const minRow = range ? Math.max(0, range.minRow) : 0
  const maxRow = range ? Math.min(gridHeight, range.maxRow + 1) : gridHeight
  const minCol = range ? Math.max(0, range.minCol) : 0
  const maxCol = range ? Math.min(gridWidth, range.maxCol + 1) : gridWidth

  const lineCount = (maxRow - minRow + 1) + (maxCol - minCol + 1)
  if (lineCount > 2048) return

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
  ctx.lineWidth = 1
  ctx.beginPath()

  for (let row = minRow; row <= maxRow; row++) {
    const start = mapToScreen(minCol, row, tileWidth, tileHeight, 'diamond')
    const end = mapToScreen(maxCol, row, tileWidth, tileHeight, 'diamond')
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
  }

  for (let col = minCol; col <= maxCol; col++) {
    const start = mapToScreen(col, minRow, tileWidth, tileHeight, 'diamond')
    const end = mapToScreen(col, maxRow, tileWidth, tileHeight, 'diamond')
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
  }

  ctx.stroke()
}

function drawDiamondBoundary(
  ctx: CanvasRenderingContext2D,
  config: MapConfig,
  zoom: number
): void {
  const { gridWidth, gridHeight, tileWidth, tileHeight } = config
  const topPt = mapToScreen(0, 0, tileWidth, tileHeight, 'diamond')
  const rightPt = mapToScreen(gridWidth, 0, tileWidth, tileHeight, 'diamond')
  const bottomPt = mapToScreen(gridWidth, gridHeight, tileWidth, tileHeight, 'diamond')
  const leftPt = mapToScreen(0, gridHeight, tileWidth, tileHeight, 'diamond')

  ctx.strokeStyle = '#89b4fa'
  ctx.lineWidth = Math.max(2, 2 / zoom)
  ctx.beginPath()
  ctx.moveTo(topPt.x, topPt.y)
  ctx.lineTo(rightPt.x, rightPt.y)
  ctx.lineTo(bottomPt.x, bottomPt.y)
  ctx.lineTo(leftPt.x, leftPt.y)
  ctx.closePath()
  ctx.stroke()
}

function drawStaggeredGridLines(
  ctx: CanvasRenderingContext2D,
  config: MapConfig,
  range?: VisibleRange
): void {
  const { gridWidth, gridHeight, tileWidth, tileHeight } = config
  const halfW = tileWidth / 2
  const halfH = tileHeight / 2

  const minRow = range ? Math.max(0, range.minRow) : 0
  const maxRow = range ? Math.min(gridHeight - 1, range.maxRow) : gridHeight - 1
  const minCol = range ? Math.max(0, range.minCol) : 0
  const maxCol = range ? Math.min(gridWidth - 1, range.maxCol) : gridWidth - 1

  const visibleTileCount = (maxCol - minCol + 1) * (maxRow - minRow + 1)
  if (visibleTileCount > 10000) return

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
  ctx.lineWidth = 1
  ctx.beginPath()

  for (let row = minRow; row <= maxRow; row++) {
    const isOdd = row & 1
    const yTop = row * halfH
    const xBase = isOdd ? halfW : 0

    for (let col = minCol; col <= maxCol; col++) {
      const x = xBase + col * tileWidth
      ctx.moveTo(x, yTop)
      ctx.lineTo(x + halfW, yTop + halfH)
      ctx.lineTo(x, yTop + tileHeight)
      ctx.lineTo(x - halfW, yTop + halfH)
      ctx.closePath()
    }
  }

  ctx.stroke()
}

function drawStaggeredBoundary(
  ctx: CanvasRenderingContext2D,
  config: MapConfig,
  zoom: number
): void {
  const { gridWidth, gridHeight, tileWidth, tileHeight } = config
  const halfW = tileWidth / 2
  const halfH = tileHeight / 2

  ctx.strokeStyle = '#89b4fa'
  ctx.lineWidth = Math.max(2, 2 / zoom)
  ctx.beginPath()

  if (gridWidth + gridHeight <= 500) {
    const topRow0 = mapToScreen(0, 0, tileWidth, tileHeight, 'staggered')
    ctx.moveTo(topRow0.x - halfW, topRow0.y + halfH)
    for (let col = 0; col < gridWidth; col++) {
      const top = mapToScreen(col, 0, tileWidth, tileHeight, 'staggered')
      ctx.lineTo(top.x, top.y)
      ctx.lineTo(top.x + halfW, top.y + halfH)
    }

    for (let row = 0; row < gridHeight; row++) {
      const top = mapToScreen(gridWidth - 1, row, tileWidth, tileHeight, 'staggered')
      ctx.lineTo(top.x + halfW, top.y + halfH)
      ctx.lineTo(top.x, top.y + tileHeight)
    }

    for (let col = gridWidth - 1; col >= 0; col--) {
      const top = mapToScreen(col, gridHeight - 1, tileWidth, tileHeight, 'staggered')
      ctx.lineTo(top.x, top.y + tileHeight)
      ctx.lineTo(top.x - halfW, top.y + halfH)
    }

    for (let row = gridHeight - 1; row >= 0; row--) {
      const top = mapToScreen(0, row, tileWidth, tileHeight, 'staggered')
      ctx.lineTo(top.x - halfW, top.y + halfH)
      ctx.lineTo(top.x, top.y)
    }
  } else {
    const minX = -halfW
    const maxX = gridWidth * tileWidth + halfW
    const minY = 0
    const maxY = (gridHeight + 1) * halfH
    ctx.moveTo(minX, minY)
    ctx.lineTo(maxX, minY)
    ctx.lineTo(maxX, maxY)
    ctx.lineTo(minX, maxY)
  }

  ctx.closePath()
  ctx.stroke()
}
