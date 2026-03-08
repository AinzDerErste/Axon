import type { MapData } from '../models/map'
import type { Layer, TileLayer, ObjectLayer, ImageLayer, DrawingLayer, MapObject, Zone, Path } from '../models/layer'
import type { TileRef } from '../models/tile'
import { Camera } from './camera'
import { drawGrid } from './grid-renderer'
import { mapToScreen } from './iso-math'
import { getVisibleRange } from './viewport'

/** Zone colors for new zones */
const ZONE_COLORS = [
  '#f38ba8', '#a6e3a1', '#89b4fa', '#f9e2af',
  '#cba6f7', '#94e2d5', '#fab387', '#89dceb'
]
let nextZoneColorIdx = 0
export function getNextZoneColor(): string {
  const color = ZONE_COLORS[nextZoneColorIdx % ZONE_COLORS.length]
  nextZoneColorIdx++
  return color
}

/** Path colors for new paths (teal/green tones, distinct from zones) */
const PATH_COLORS = [
  '#94e2d5', '#a6e3a1', '#89dceb', '#f9e2af',
  '#cba6f7', '#fab387', '#f38ba8', '#89b4fa'
]
let nextPathColorIdx = 0
export function getNextPathColor(): string {
  const color = PATH_COLORS[nextPathColorIdx % PATH_COLORS.length]
  nextPathColorIdx++
  return color
}

/** Lightweight object descriptor for holo preview rendering */
export interface PreviewObject {
  imageBitmap: ImageBitmap
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  flipX?: boolean
  flipY?: boolean
}

export class MapRenderer {
  private ctx: CanvasRenderingContext2D
  private dirty: boolean = true
  private animFrameId: number = 0
  /** Small offscreen canvas for pixel-precise hit-testing */
  private hitCanvas: OffscreenCanvas = new OffscreenCanvas(1, 1)
  private hitCtx: OffscreenCanvasRenderingContext2D = null as any
  camera: Camera = new Camera()
  map: MapData | null = null
  showGrid: boolean = true
  hoverCol: number = -1
  hoverRow: number = -1

  /** Currently selected object IDs (for highlighting) */
  selectedObjectIds: Set<string> = new Set()
  /** Currently selected zone ID (for highlighting) */
  selectedZoneId: string | null = null
  /** Currently selected image layer ID (for move/resize handles) */
  selectedImageLayerId: string | null = null
  /** Active zone being drawn (not yet committed) */
  activeZonePoints: { x: number; y: number }[] = []
  activeZoneColor: string = '#f38ba8'
  /** Current mouse position in world space for zone preview line */
  zoneMousePos: { x: number; y: number } | null = null
  /** Currently selected path ID (for highlighting) */
  selectedPathId: string | null = null
  /** Active path being drawn (not yet committed) */
  activePathPoints: { x: number; y: number }[] = []
  activePathColor: string = '#94e2d5'
  /** Current mouse position in world space for path preview line */
  pathMousePos: { x: number; y: number } | null = null

  /** Marquee drag-select rectangle in world space (null = not active) */
  marqueeRect: { x: number; y: number; w: number; h: number } | null = null

  /** Preview tiles shown as semi-transparent holo overlay (paint preview / stamp preview) */
  previewTiles: { col: number; row: number; tileRef: TileRef }[] | null = null

  /** Preview objects shown as semi-transparent holo overlay (object tool / stamp preview) */
  previewObjects: PreviewObject[] | null = null

  /** Sketch tool preview state */
  activeSketchPoints: { x: number; y: number }[] = []
  sketchSubTool: string = 'pencil'
  sketchStartPoint: { x: number; y: number } | null = null
  sketchMousePos: { x: number; y: number } | null = null
  sketchColor: string = '#f38ba8'
  sketchStrokeWidth: number = 3
  sketchFill: boolean = false

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!
    this.hitCtx = this.hitCanvas.getContext('2d')!
    this.startLoop()
  }

  markDirty(): void {
    this.dirty = true
  }

  private startLoop(): void {
    const loop = () => {
      if (this.dirty) {
        this.render()
        this.dirty = false
      }
      this.animFrameId = requestAnimationFrame(loop)
    }
    this.animFrameId = requestAnimationFrame(loop)
  }

  destroy(): void {
    cancelAnimationFrame(this.animFrameId)
  }

  private getViewportSize(): { width: number; height: number } {
    const dpr = window.devicePixelRatio || 1
    return {
      width: this.canvas.width / dpr,
      height: this.canvas.height / dpr
    }
  }

  private render(): void {
    const { ctx, camera, map } = this
    const { width, height } = this.getViewportSize()

    ctx.clearRect(0, 0, width, height)

    if (!map) {
      ctx.fillStyle = '#6c7086'
      ctx.font = '16px -apple-system, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Axon', width / 2, height / 2 - 10)
      ctx.font = '12px -apple-system, sans-serif'
      ctx.fillText('Create a new map to start (File > New)', width / 2, height / 2 + 14)
      return
    }

    ctx.save()
    ctx.scale(camera.zoom, camera.zoom)
    ctx.translate(-camera.x, -camera.y)

    // Draw layers bottom-to-top
    const visibleRange = getVisibleRange(camera, width, height, map.config)
    for (const layer of map.layers) {
      if (!layer.visible) continue
      ctx.globalAlpha = layer.opacity
      if (layer.type === 'object') {
        this.drawObjectLayer(ctx, layer)
      } else if (layer.type === 'drawing') {
        this.drawDrawingLayer(ctx, layer)
      } else if (layer.type === 'image') {
        this.drawImageLayer(ctx, layer)
      } else {
        this.drawTileLayer(ctx, layer, visibleRange)
      }
    }
    ctx.globalAlpha = 1.0

    // Draw tile preview holo overlay
    if (this.previewTiles && this.previewTiles.length > 0) {
      this.drawPreviewTiles(ctx)
    }

    // Draw object preview holo overlay
    if (this.previewObjects && this.previewObjects.length > 0) {
      this.drawPreviewObjects(ctx)
    }

    // Draw active zone being drawn
    if (this.activeZonePoints.length > 0) {
      this.drawActiveZone(ctx)
    }

    // Draw active path being drawn
    if (this.activePathPoints.length > 0) {
      this.drawActivePath(ctx)
    }

    // Draw sketch preview
    if (this.activeSketchPoints.length > 0 || this.sketchStartPoint) {
      this.drawSketchPreview(ctx)
    }

    // Draw grid overlay
    if (this.showGrid) {
      drawGrid(ctx, map.config, this.hoverCol, this.hoverRow, camera.zoom, visibleRange)
    }

    // Draw marquee selection rectangle
    if (this.marqueeRect) {
      const { x, y, w, h } = this.marqueeRect
      const lw = 1 / camera.zoom // 1px regardless of zoom
      ctx.strokeStyle = '#89b4fa'
      ctx.lineWidth = lw
      ctx.setLineDash([4 / camera.zoom, 3 / camera.zoom])
      ctx.fillStyle = 'rgba(137, 180, 250, 0.12)'
      ctx.fillRect(x, y, w, h)
      ctx.strokeRect(x, y, w, h)
      ctx.setLineDash([])
    }

    ctx.restore()
  }

  private drawPreviewTiles(ctx: CanvasRenderingContext2D): void {
    if (!this.map || !this.previewTiles) return
    const { config, tilesets } = this.map

    ctx.save()
    ctx.globalAlpha = 0.5

    for (const { col, row, tileRef } of this.previewTiles) {
      const tileset = tilesets.find(ts => ts.id === tileRef.tilesetId)
      if (!tileset?.imageBitmap) continue

      const tileEntry = tileset.tiles[tileRef.tileIndex]
      if (!tileEntry) continue

      const screen = mapToScreen(col, row, config.tileWidth, config.tileHeight, config.orientation || 'diamond')

      ctx.drawImage(
        tileset.imageBitmap,
        tileEntry.x, tileEntry.y,
        tileEntry.width, tileEntry.height,
        screen.x - tileEntry.width / 2,
        screen.y + config.tileHeight - tileEntry.height,
        tileEntry.width, tileEntry.height
      )
    }

    ctx.restore()
  }

  private drawPreviewObjects(ctx: CanvasRenderingContext2D): void {
    if (!this.previewObjects) return

    ctx.save()
    ctx.globalAlpha = 0.5

    for (const obj of this.previewObjects) {
      const rot = (obj.rotation || 0) * Math.PI / 180
      const hasRotation = rot !== 0
      const hasFlip = obj.flipX || obj.flipY

      if (hasRotation || hasFlip) {
        ctx.save()
        const cx = obj.x + obj.width / 2
        const cy = obj.y + obj.height / 2
        ctx.translate(cx, cy)
        if (hasRotation) ctx.rotate(rot)
        if (hasFlip) ctx.scale(obj.flipX ? -1 : 1, obj.flipY ? -1 : 1)
        ctx.drawImage(obj.imageBitmap, -obj.width / 2, -obj.height / 2, obj.width, obj.height)
        ctx.restore()
      } else {
        ctx.drawImage(obj.imageBitmap, obj.x, obj.y, obj.width, obj.height)
      }
    }

    ctx.restore()
  }

  private drawTileLayer(
    ctx: CanvasRenderingContext2D,
    layer: TileLayer,
    range: { minCol: number; maxCol: number; minRow: number; maxRow: number }
  ): void {
    if (!this.map) return
    const { config, tilesets } = this.map

    const order = config.renderOrder || 'right-down'
    const rowStart = order.includes('up') ? range.maxRow : range.minRow
    const rowEnd   = order.includes('up') ? range.minRow - 1 : range.maxRow + 1
    const rowStep  = order.includes('up') ? -1 : 1
    const colStart = order.includes('left') ? range.maxCol : range.minCol
    const colEnd   = order.includes('left') ? range.minCol - 1 : range.maxCol + 1
    const colStep  = order.includes('left') ? -1 : 1

    for (let row = rowStart; row !== rowEnd; row += rowStep) {
      for (let col = colStart; col !== colEnd; col += colStep) {
        const tileRef = layer.data[row]?.[col]
        if (!tileRef) continue

        const tileset = tilesets.find(ts => ts.id === tileRef.tilesetId)
        if (!tileset?.imageBitmap) continue

        const tileEntry = tileset.tiles[tileRef.tileIndex]
        if (!tileEntry) continue

        const screen = mapToScreen(col, row, config.tileWidth, config.tileHeight, config.orientation || 'diamond')

        ctx.drawImage(
          tileset.imageBitmap,
          tileEntry.x, tileEntry.y,
          tileEntry.width, tileEntry.height,
          screen.x - tileEntry.width / 2,
          screen.y + config.tileHeight - tileEntry.height,
          tileEntry.width, tileEntry.height
        )
      }
    }
  }

  private drawObjectLayer(ctx: CanvasRenderingContext2D, layer: ObjectLayer): void {
    // Draw zones first (below objects)
    for (const zone of layer.zones) {
      this.drawZone(ctx, zone)
    }

    // Draw paths (below objects, above zones)
    for (const path of (layer.paths || [])) {
      this.drawPath(ctx, layer, path)
    }

    // Determine draw order based on layer sort mode
    let objectsToDraw: MapObject[]

    if (layer.sortMode === 'manual') {
      // Manual mode: draw in array order (first = behind, last = on top)
      objectsToDraw = layer.objects
    } else {
      // Auto mode (default): sort by isometric depth
      const order = this.map?.config.renderOrder || 'right-down'
      objectsToDraw = [...layer.objects].sort((a, b) => {
        const ay = a.y + a.height
        const by = b.y + b.height
        const ax = a.x + a.width / 2
        const bx = b.x + b.width / 2
        const yDir = order.includes('up') ? -1 : 1
        const yDiff = (ay - by) * yDir
        if (yDiff !== 0) return yDiff
        const xDir = order.includes('left') ? -1 : 1
        return (ax - bx) * xDir
      })
    }

    // Draw objects in order
    for (const obj of objectsToDraw) {
      if (!obj.imageBitmap) continue
      if (obj.visible === false) continue

      const rot = (obj.rotation || 0) * Math.PI / 180
      const hasRotation = rot !== 0
      const hasFlip = obj.flipX || obj.flipY

      if (hasRotation || hasFlip) {
        ctx.save()
        const cx = obj.x + obj.width / 2
        const cy = obj.y + obj.height / 2
        ctx.translate(cx, cy)
        if (hasRotation) ctx.rotate(rot)
        if (hasFlip) ctx.scale(obj.flipX ? -1 : 1, obj.flipY ? -1 : 1)
        ctx.drawImage(obj.imageBitmap, -obj.width / 2, -obj.height / 2, obj.width, obj.height)
        ctx.restore()
      } else {
        ctx.drawImage(obj.imageBitmap, obj.x, obj.y, obj.width, obj.height)
      }

      // Highlight selected object
      if (this.selectedObjectIds.has(obj.id)) {
        if (hasRotation) {
          const corners = this.getObjectCorners(obj)
          ctx.strokeStyle = '#89b4fa'
          ctx.lineWidth = 2
          ctx.setLineDash([6, 3])
          ctx.beginPath()
          ctx.moveTo(corners[0].x, corners[0].y)
          for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y)
          ctx.closePath()
          ctx.stroke()
          ctx.setLineDash([])

          const handleSize = 6
          ctx.fillStyle = '#89b4fa'
          for (const c of corners) {
            ctx.fillRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize)
          }
        } else {
          ctx.strokeStyle = '#89b4fa'
          ctx.lineWidth = 2
          ctx.setLineDash([6, 3])
          ctx.strokeRect(obj.x, obj.y, obj.width, obj.height)
          ctx.setLineDash([])

          const handleSize = 6
          ctx.fillStyle = '#89b4fa'
          const corners = [
            [obj.x, obj.y],
            [obj.x + obj.width, obj.y],
            [obj.x, obj.y + obj.height],
            [obj.x + obj.width, obj.y + obj.height]
          ]
          for (const [cx, cy] of corners) {
            ctx.fillRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize)
          }
        }
      }
    }
  }

  /** Compute the isometric transform coefficients for an image layer */
  private getIsoTransformCoeffs(): { a: number; b: number; c: number; d: number } | null {
    if (!this.map) return null
    const { tileWidth, tileHeight } = this.map.config
    const hw = tileWidth / 2
    const hh = tileHeight / 2
    const isoLen = Math.sqrt(hw * hw + hh * hh)
    return {
      a: hw / isoLen,
      b: hh / isoLen,
      c: -hw / isoLen,
      d: hh / isoLen
    }
  }

  /** Get the four corners of an image layer in world space (handles rotation + iso transform) */
  getImageLayerCorners(layer: ImageLayer): { x: number; y: number }[] {
    const hw = layer.width / 2
    const hh = layer.height / 2

    // Corners relative to image center: tl, tr, br, bl
    let corners = [
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh }
    ]

    // Apply rotation around center
    const rot = (layer.rotation || 0) * Math.PI / 180
    if (rot !== 0) {
      const cosR = Math.cos(rot)
      const sinR = Math.sin(rot)
      corners = corners.map(p => ({
        x: p.x * cosR - p.y * sinR,
        y: p.x * sinR + p.y * cosR
      }))
    }

    // Convert back to image-space (relative to top-left anchor)
    corners = corners.map(p => ({ x: p.x + hw, y: p.y + hh }))

    if (layer.isoTransform && this.map) {
      const coeffs = this.getIsoTransformCoeffs()
      if (coeffs) {
        const { a, b, c, d } = coeffs
        return corners.map(p => ({
          x: layer.x + a * p.x + c * p.y,
          y: layer.y + b * p.x + d * p.y
        }))
      }
    }

    // No iso — just offset to world position
    return corners.map(p => ({
      x: layer.x + p.x,
      y: layer.y + p.y
    }))
  }

  /** Check whether an image layer has any transform (rotation or iso) */
  private imageLayerHasTransform(layer: ImageLayer): boolean {
    return !!(layer.isoTransform || (layer.rotation && layer.rotation !== 0))
  }

  private drawImageLayer(ctx: CanvasRenderingContext2D, layer: ImageLayer): void {
    if (!layer.imageBitmap) return

    const rot = (layer.rotation || 0) * Math.PI / 180
    const hasRotation = rot !== 0
    const hasIso = !!(layer.isoTransform && this.map)

    if (hasRotation || hasIso) {
      ctx.save()
      ctx.translate(layer.x, layer.y)
      if (hasIso) {
        const coeffs = this.getIsoTransformCoeffs()!
        ctx.transform(coeffs.a, coeffs.b, coeffs.c, coeffs.d, 0, 0)
      }
      if (hasRotation) {
        ctx.translate(layer.width / 2, layer.height / 2)
        ctx.rotate(rot)
        ctx.translate(-layer.width / 2, -layer.height / 2)
      }
      ctx.drawImage(layer.imageBitmap, 0, 0, layer.width, layer.height)
      ctx.restore()

      // Selection highlight as polygon
      if (layer.id === this.selectedImageLayerId) {
        const corners = this.getImageLayerCorners(layer)
        ctx.strokeStyle = '#a6e3a1'
        ctx.lineWidth = 2
        ctx.setLineDash([6, 3])
        ctx.beginPath()
        ctx.moveTo(corners[0].x, corners[0].y)
        for (let i = 1; i < corners.length; i++) {
          ctx.lineTo(corners[i].x, corners[i].y)
        }
        ctx.closePath()
        ctx.stroke()
        ctx.setLineDash([])

        const hs = 8
        ctx.fillStyle = '#a6e3a1'
        for (const corner of corners) {
          ctx.fillRect(corner.x - hs / 2, corner.y - hs / 2, hs, hs)
        }
      }
      return
    }

    // Plain non-transformed draw
    ctx.drawImage(layer.imageBitmap, layer.x, layer.y, layer.width, layer.height)

    // Selection highlight with corner resize handles
    if (layer.id === this.selectedImageLayerId) {
      ctx.strokeStyle = '#a6e3a1'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 3])
      ctx.strokeRect(layer.x, layer.y, layer.width, layer.height)
      ctx.setLineDash([])

      const hs = 8
      ctx.fillStyle = '#a6e3a1'
      const corners = [
        [layer.x, layer.y],
        [layer.x + layer.width, layer.y],
        [layer.x, layer.y + layer.height],
        [layer.x + layer.width, layer.y + layer.height]
      ]
      for (const [cx, cy] of corners) {
        ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs)
      }
    }
  }

  private drawZone(ctx: CanvasRenderingContext2D, zone: Zone): void {
    if (zone.points.length < 2) return

    const isCollision = zone.zoneType === 'collision'

    ctx.beginPath()
    ctx.moveTo(zone.points[0].x, zone.points[0].y)
    for (let i = 1; i < zone.points.length; i++) {
      ctx.lineTo(zone.points[i].x, zone.points[i].y)
    }
    if (zone.closed) {
      ctx.closePath()
      if (isCollision) {
        // Collision zones: diagonal hatching fill
        ctx.save()
        ctx.clip()
        // Compute bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const p of zone.points) {
          if (p.x < minX) minX = p.x
          if (p.y < minY) minY = p.y
          if (p.x > maxX) maxX = p.x
          if (p.y > maxY) maxY = p.y
        }
        const spacing = 12 / this.camera.zoom
        ctx.strokeStyle = zone.color + '55'
        ctx.lineWidth = 1.5 / this.camera.zoom
        const range = maxX - minX + maxY - minY
        for (let d = -range; d < range; d += spacing) {
          ctx.beginPath()
          ctx.moveTo(minX + d, minY)
          ctx.lineTo(minX + d + (maxY - minY), maxY)
          ctx.stroke()
        }
        ctx.restore()
      } else {
        // Regular zones: semi-transparent fill
        ctx.fillStyle = zone.color + '33' // ~20% alpha
        ctx.fill()
      }
    }

    if (isCollision) {
      // Collision zones: dashed stroke
      ctx.strokeStyle = zone.color
      ctx.lineWidth = 2
      ctx.setLineDash([8, 4])
      ctx.beginPath()
      ctx.moveTo(zone.points[0].x, zone.points[0].y)
      for (let i = 1; i < zone.points.length; i++) {
        ctx.lineTo(zone.points[i].x, zone.points[i].y)
      }
      if (zone.closed) ctx.closePath()
      ctx.stroke()
      ctx.setLineDash([])
    } else {
      ctx.strokeStyle = zone.color
      ctx.lineWidth = 2
      ctx.stroke()
    }

    // Draw vertex dots
    ctx.fillStyle = zone.color
    for (const p of zone.points) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
      ctx.fill()
    }

    // Draw zone label at centroid
    if (zone.points.length >= 3 && zone.name) {
      let cx = 0, cy = 0
      for (const p of zone.points) { cx += p.x; cy += p.y }
      cx /= zone.points.length
      cy /= zone.points.length
      ctx.font = '12px -apple-system, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillStyle = zone.color
      ctx.fillText(zone.name, cx, cy)
    }

    // Highlight selected zone
    if (zone.id === this.selectedZoneId) {
      ctx.beginPath()
      ctx.moveTo(zone.points[0].x, zone.points[0].y)
      for (let i = 1; i < zone.points.length; i++) {
        ctx.lineTo(zone.points[i].x, zone.points[i].y)
      }
      if (zone.closed) ctx.closePath()
      ctx.strokeStyle = '#89b4fa'
      ctx.lineWidth = 3
      ctx.setLineDash([6, 3])
      ctx.stroke()
      ctx.setLineDash([])

      // Enlarged vertex handles
      ctx.fillStyle = '#89b4fa'
      for (const p of zone.points) {
        ctx.fillRect(p.x - 4, p.y - 4, 8, 8)
      }
    }
  }

  private drawActiveZone(ctx: CanvasRenderingContext2D): void {
    const pts = this.activeZonePoints
    if (pts.length === 0) return
    const mouse = this.zoneMousePos

    // Draw placed segments (solid)
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y)
    }
    ctx.strokeStyle = this.activeZoneColor
    ctx.lineWidth = 2
    ctx.stroke()

    // Draw preview line from last point to mouse (dashed)
    if (mouse) {
      const last = pts[pts.length - 1]
      ctx.beginPath()
      ctx.moveTo(last.x, last.y)
      ctx.lineTo(mouse.x, mouse.y)
      ctx.strokeStyle = this.activeZoneColor
      ctx.lineWidth = 1.5
      ctx.setLineDash([6, 4])
      ctx.stroke()
      ctx.setLineDash([])

      // If near first point, preview the closing segment too
      if (pts.length >= 3) {
        const dx = mouse.x - pts[0].x
        const dy = mouse.y - pts[0].y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const closeThreshold = 15 / this.camera.zoom
        if (dist < closeThreshold) {
          // Preview close line from mouse back to first point
          ctx.beginPath()
          ctx.moveTo(mouse.x, mouse.y)
          ctx.lineTo(pts[0].x, pts[0].y)
          ctx.strokeStyle = this.activeZoneColor + '88'
          ctx.lineWidth = 1.5
          ctx.setLineDash([6, 4])
          ctx.stroke()
          ctx.setLineDash([])
        }
      }
    }

    // Draw vertex dots
    ctx.fillStyle = this.activeZoneColor
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      ctx.beginPath()
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
      ctx.fill()

      // White outline for first point (close target)
      if (i === 0 && pts.length >= 3) {
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(p.x, p.y, 9, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    // Draw snap indicator on mouse position
    if (mouse) {
      ctx.strokeStyle = this.activeZoneColor
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(mouse.x, mouse.y, 4, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  private drawPath(ctx: CanvasRenderingContext2D, layer: ObjectLayer, path: Path): void {
    if (path.points.length < 1) return

    // Draw segments
    if (path.points.length >= 2) {
      ctx.beginPath()
      ctx.moveTo(path.points[0].x, path.points[0].y)
      for (let i = 1; i < path.points.length; i++) {
        ctx.lineTo(path.points[i].x, path.points[i].y)
      }
      if (path.loop) ctx.closePath()
      ctx.strokeStyle = path.color
      ctx.lineWidth = 2.5
      ctx.stroke()

      // Directional arrowheads at segment midpoints
      const segCount = path.loop ? path.points.length : path.points.length - 1
      for (let i = 0; i < segCount; i++) {
        const a = path.points[i]
        const b = path.points[(i + 1) % path.points.length]
        const mx = (a.x + b.x) / 2
        const my = (a.y + b.y) / 2
        const angle = Math.atan2(b.y - a.y, b.x - a.x)
        const headLen = Math.max(6, 8 / this.camera.zoom)

        ctx.beginPath()
        ctx.moveTo(mx, my)
        ctx.lineTo(mx - headLen * Math.cos(angle - Math.PI / 6), my - headLen * Math.sin(angle - Math.PI / 6))
        ctx.moveTo(mx, my)
        ctx.lineTo(mx - headLen * Math.cos(angle + Math.PI / 6), my - headLen * Math.sin(angle + Math.PI / 6))
        ctx.strokeStyle = path.color
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }

    // Numbered waypoint circles
    const radius = Math.max(6, 8 / this.camera.zoom)
    const fontSize = Math.max(8, 10 / this.camera.zoom)
    ctx.font = `bold ${fontSize}px -apple-system, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let i = 0; i < path.points.length; i++) {
      const p = path.points[i]
      ctx.beginPath()
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = path.color
      ctx.fill()
      ctx.fillStyle = '#1e1e2e'
      ctx.fillText(`${i + 1}`, p.x, p.y)
    }

    // Connector to assigned object
    if (path.assignedObjectId) {
      const obj = layer.objects.find(o => o.id === path.assignedObjectId)
      if (obj && path.points.length > 0) {
        const start = path.points[0]
        const objCx = obj.x + obj.width / 2
        const objCy = obj.y + obj.height / 2
        ctx.beginPath()
        ctx.moveTo(start.x, start.y)
        ctx.lineTo(objCx, objCy)
        ctx.strokeStyle = path.color + '55'
        ctx.lineWidth = 1.5
        ctx.setLineDash([4, 4])
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    // Path label at centroid
    if (path.name && path.points.length >= 2) {
      let cx = 0, cy = 0
      for (const p of path.points) { cx += p.x; cy += p.y }
      cx /= path.points.length
      cy /= path.points.length
      ctx.font = '12px -apple-system, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillStyle = path.color
      ctx.fillText(path.name, cx, cy - radius - 4)
    }

    // Selection highlight
    if (path.id === this.selectedPathId) {
      if (path.points.length >= 2) {
        ctx.beginPath()
        ctx.moveTo(path.points[0].x, path.points[0].y)
        for (let i = 1; i < path.points.length; i++) {
          ctx.lineTo(path.points[i].x, path.points[i].y)
        }
        if (path.loop) ctx.closePath()
        ctx.strokeStyle = '#89b4fa'
        ctx.lineWidth = 3
        ctx.setLineDash([6, 3])
        ctx.stroke()
        ctx.setLineDash([])
      }
      ctx.fillStyle = '#89b4fa'
      for (const p of path.points) {
        ctx.fillRect(p.x - 5, p.y - 5, 10, 10)
      }
    }
  }

  private drawActivePath(ctx: CanvasRenderingContext2D): void {
    const pts = this.activePathPoints
    if (pts.length === 0) return
    const mouse = this.pathMousePos

    // Draw placed segments
    if (pts.length >= 2) {
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y)
      }
      ctx.strokeStyle = this.activePathColor
      ctx.lineWidth = 2.5
      ctx.stroke()

      // Directional arrowheads
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]
        const b = pts[i + 1]
        const mx = (a.x + b.x) / 2
        const my = (a.y + b.y) / 2
        const angle = Math.atan2(b.y - a.y, b.x - a.x)
        const headLen = Math.max(6, 8 / this.camera.zoom)

        ctx.beginPath()
        ctx.moveTo(mx, my)
        ctx.lineTo(mx - headLen * Math.cos(angle - Math.PI / 6), my - headLen * Math.sin(angle - Math.PI / 6))
        ctx.moveTo(mx, my)
        ctx.lineTo(mx - headLen * Math.cos(angle + Math.PI / 6), my - headLen * Math.sin(angle + Math.PI / 6))
        ctx.strokeStyle = this.activePathColor
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }

    // Dashed preview line from last point to mouse
    if (mouse) {
      const last = pts[pts.length - 1]
      ctx.beginPath()
      ctx.moveTo(last.x, last.y)
      ctx.lineTo(mouse.x, mouse.y)
      ctx.strokeStyle = this.activePathColor
      ctx.lineWidth = 1.5
      ctx.setLineDash([6, 4])
      ctx.stroke()
      ctx.setLineDash([])

      // Loop close preview
      if (pts.length >= 3) {
        const dx = mouse.x - pts[0].x
        const dy = mouse.y - pts[0].y
        if (Math.sqrt(dx * dx + dy * dy) < 15 / this.camera.zoom) {
          ctx.beginPath()
          ctx.moveTo(mouse.x, mouse.y)
          ctx.lineTo(pts[0].x, pts[0].y)
          ctx.strokeStyle = this.activePathColor + '88'
          ctx.lineWidth = 1.5
          ctx.setLineDash([6, 4])
          ctx.stroke()
          ctx.setLineDash([])
        }
      }
    }

    // Numbered waypoint circles
    const radius = 6
    ctx.font = 'bold 10px -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      ctx.beginPath()
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = this.activePathColor
      ctx.fill()
      ctx.fillStyle = '#1e1e2e'
      ctx.fillText(`${i + 1}`, p.x, p.y)

      // White ring on first point (loop close target)
      if (i === 0 && pts.length >= 3) {
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(p.x, p.y, 10, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    // Mouse snap indicator
    if (mouse) {
      ctx.strokeStyle = this.activePathColor
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(mouse.x, mouse.y, 4, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  hitTestPath(worldX: number, worldY: number): { path: Path; layerId: string } | null {
    if (!this.map) return null
    const threshold = 10 / this.camera.zoom
    for (let i = this.map.layers.length - 1; i >= 0; i--) {
      const layer = this.map.layers[i]
      if (!layer.visible || layer.type !== 'object') continue
      for (let j = (layer.paths || []).length - 1; j >= 0; j--) {
        const path = layer.paths[j]
        if (path.points.length < 1) continue
        // Check proximity to waypoints
        for (const p of path.points) {
          const dx = worldX - p.x
          const dy = worldY - p.y
          if (Math.sqrt(dx * dx + dy * dy) < threshold) {
            return { path, layerId: layer.id }
          }
        }
        // Check proximity to segments
        if (path.points.length >= 2) {
          if (this.nearPolyline(worldX, worldY, path.points, threshold)) {
            return { path, layerId: layer.id }
          }
          // Check closing segment for loops
          if (path.loop && path.points.length >= 3) {
            const last = path.points[path.points.length - 1]
            const first = path.points[0]
            if (this.distToSegment(worldX, worldY, last, first) < threshold) {
              return { path, layerId: layer.id }
            }
          }
        }
      }
    }
    return null
  }

  private drawDrawingLayer(ctx: CanvasRenderingContext2D, layer: DrawingLayer): void {
    for (const obj of layer.objects) {
      if (!obj.imageBitmap) continue
      if (obj.visible === false) continue

      const rot = (obj.rotation || 0) * Math.PI / 180
      const hasRotation = rot !== 0
      const hasFlip = obj.flipX || obj.flipY

      if (hasRotation || hasFlip) {
        ctx.save()
        const cx = obj.x + obj.width / 2
        const cy = obj.y + obj.height / 2
        ctx.translate(cx, cy)
        if (hasRotation) ctx.rotate(rot)
        if (hasFlip) ctx.scale(obj.flipX ? -1 : 1, obj.flipY ? -1 : 1)
        ctx.drawImage(obj.imageBitmap, -obj.width / 2, -obj.height / 2, obj.width, obj.height)
        ctx.restore()
      } else {
        ctx.drawImage(obj.imageBitmap, obj.x, obj.y, obj.width, obj.height)
      }

      if (this.selectedObjectIds.has(obj.id)) {
        if (hasRotation) {
          const corners = this.getObjectCorners(obj)
          ctx.strokeStyle = '#89b4fa'
          ctx.lineWidth = 2
          ctx.setLineDash([6, 3])
          ctx.beginPath()
          ctx.moveTo(corners[0].x, corners[0].y)
          for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y)
          ctx.closePath()
          ctx.stroke()
          ctx.setLineDash([])

          const handleSize = 6
          ctx.fillStyle = '#89b4fa'
          for (const c of corners) {
            ctx.fillRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize)
          }
        } else {
          ctx.strokeStyle = '#89b4fa'
          ctx.lineWidth = 2
          ctx.setLineDash([6, 3])
          ctx.strokeRect(obj.x, obj.y, obj.width, obj.height)
          ctx.setLineDash([])

          const handleSize = 6
          ctx.fillStyle = '#89b4fa'
          const corners = [
            [obj.x, obj.y],
            [obj.x + obj.width, obj.y],
            [obj.x, obj.y + obj.height],
            [obj.x + obj.width, obj.y + obj.height]
          ]
          for (const [cx, cy] of corners) {
            ctx.fillRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize)
          }
        }
      }
    }
  }

  private drawSketchPreview(ctx: CanvasRenderingContext2D): void {
    const lw = this.sketchStrokeWidth / this.camera.zoom
    ctx.strokeStyle = this.sketchColor
    ctx.lineWidth = lw
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (this.sketchSubTool === 'pencil') {
      const pts = this.activeSketchPoints
      if (pts.length < 2) return
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y)
      }
      ctx.stroke()
    } else if (this.sketchStartPoint && this.sketchMousePos) {
      const sp = this.sketchStartPoint
      const mp = this.sketchMousePos

      if (this.sketchSubTool === 'line') {
        ctx.beginPath()
        ctx.moveTo(sp.x, sp.y)
        ctx.lineTo(mp.x, mp.y)
        ctx.stroke()
      } else if (this.sketchSubTool === 'arrow') {
        // Shaft
        ctx.beginPath()
        ctx.moveTo(sp.x, sp.y)
        ctx.lineTo(mp.x, mp.y)
        ctx.stroke()
        // Arrowhead
        const dx = mp.x - sp.x
        const dy = mp.y - sp.y
        const angle = Math.atan2(dy, dx)
        const headLen = Math.max(lw * 4, 12 / this.camera.zoom)
        ctx.beginPath()
        ctx.moveTo(mp.x, mp.y)
        ctx.lineTo(mp.x - headLen * Math.cos(angle - Math.PI / 6), mp.y - headLen * Math.sin(angle - Math.PI / 6))
        ctx.moveTo(mp.x, mp.y)
        ctx.lineTo(mp.x - headLen * Math.cos(angle + Math.PI / 6), mp.y - headLen * Math.sin(angle + Math.PI / 6))
        ctx.stroke()
      } else if (this.sketchSubTool === 'rect') {
        const x = Math.min(sp.x, mp.x)
        const y = Math.min(sp.y, mp.y)
        const w = Math.abs(mp.x - sp.x)
        const h = Math.abs(mp.y - sp.y)
        if (this.sketchFill) {
          ctx.fillStyle = this.sketchColor + '45' // ~27% alpha
          ctx.fillRect(x, y, w, h)
        }
        ctx.strokeRect(x, y, w, h)
      } else if (this.sketchSubTool === 'ellipse') {
        const cx = (sp.x + mp.x) / 2
        const cy = (sp.y + mp.y) / 2
        const rx = Math.abs(mp.x - sp.x) / 2
        const ry = Math.abs(mp.y - sp.y) / 2
        ctx.beginPath()
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
        if (this.sketchFill) {
          ctx.fillStyle = this.sketchColor + '45'
          ctx.fill()
        }
        ctx.stroke()
      }
    }
  }

  /** Get the four corners of an object in world space (handles rotation) */
  getObjectCorners(obj: MapObject): { x: number; y: number }[] {
    const hw = obj.width / 2
    const hh = obj.height / 2
    const cx = obj.x + hw
    const cy = obj.y + hh
    const rot = (obj.rotation || 0) * Math.PI / 180

    let corners = [
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh }
    ]

    if (rot !== 0) {
      const cosR = Math.cos(rot)
      const sinR = Math.sin(rot)
      corners = corners.map(p => ({
        x: cx + p.x * cosR - p.y * sinR,
        y: cy + p.x * sinR + p.y * cosR
      }))
    } else {
      corners = corners.map(p => ({ x: cx + p.x, y: cy + p.y }))
    }

    return corners
  }

  /** Hit-test an object at world coordinates. Returns the object and its layer ID.
   *  Checks in reverse render order so the visually topmost object is hit first. */
  hitTestObject(worldX: number, worldY: number): { obj: MapObject; layerId: string } | null {
    if (!this.map) return null
    const order = this.map.config.renderOrder || 'right-down'

    // Check all object layers, top-to-bottom
    for (let i = this.map.layers.length - 1; i >= 0; i--) {
      const layer = this.map.layers[i]
      if (!layer.visible || (layer.type !== 'object' && layer.type !== 'drawing')) continue

      let ordered: MapObject[]

      if (layer.type === 'drawing') {
        // Drawing layers always use array order
        ordered = layer.objects
      } else if (layer.sortMode === 'manual') {
        // Manual mode: array order is draw order, iterate in reverse (last = topmost)
        ordered = layer.objects
      } else {
        // Auto mode: sort same way as rendering
        ordered = [...layer.objects].sort((a, b) => {
          const ay = a.y + a.height
          const by = b.y + b.height
          const ax = a.x + a.width / 2
          const bx = b.x + b.width / 2
          const yDir = order.includes('up') ? -1 : 1
          const yDiff = (ay - by) * yDir
          if (yDiff !== 0) return yDiff
          const xDir = order.includes('left') ? -1 : 1
          return (ax - bx) * xDir
        })
      }

      for (let j = ordered.length - 1; j >= 0; j--) {
        const obj = ordered[j]
        if (obj.visible === false) continue

        const rot = (obj.rotation || 0) * Math.PI / 180
        let inBounds = false
        let localX = 0, localY = 0

        if (rot !== 0) {
          // Rotate hit point into object-local space
          const cx = obj.x + obj.width / 2
          const cy = obj.y + obj.height / 2
          const cosR = Math.cos(-rot)
          const sinR = Math.sin(-rot)
          const dx = worldX - cx
          const dy = worldY - cy
          const lx = dx * cosR - dy * sinR + obj.width / 2
          const ly = dx * sinR + dy * cosR + obj.height / 2
          if (lx >= 0 && lx <= obj.width && ly >= 0 && ly <= obj.height) {
            inBounds = true
            localX = (lx / obj.width)
            localY = (ly / obj.height)
          }
        } else if (worldX >= obj.x && worldX <= obj.x + obj.width &&
                   worldY >= obj.y && worldY <= obj.y + obj.height) {
          inBounds = true
          localX = (worldX - obj.x) / obj.width
          localY = (worldY - obj.y) / obj.height
        }

        if (!inBounds) continue

        // Pixel-precise: sample the alpha channel from the imageBitmap
        if (obj.imageBitmap) {
          const bmp = obj.imageBitmap
          let px = localX * bmp.width
          let py = localY * bmp.height
          // Account for flips
          if (obj.flipX) px = bmp.width - px
          if (obj.flipY) py = bmp.height - py
          // Sample 1×1 pixel via the offscreen hit canvas
          this.hitCtx.clearRect(0, 0, 1, 1)
          this.hitCtx.drawImage(bmp, Math.floor(px), Math.floor(py), 1, 1, 0, 0, 1, 1)
          const alpha = this.hitCtx.getImageData(0, 0, 1, 1).data[3]
          if (alpha < 10) continue // transparent pixel → skip
        }
        return { obj, layerId: layer.id }
      }
    }
    return null
  }

  /** Hit-test a zone at world coordinates. Returns the zone and its layer ID. */
  hitTestZone(worldX: number, worldY: number): { zone: Zone; layerId: string } | null {
    if (!this.map) return null
    for (let i = this.map.layers.length - 1; i >= 0; i--) {
      const layer = this.map.layers[i]
      if (!layer.visible || layer.type !== 'object') continue
      for (let j = layer.zones.length - 1; j >= 0; j--) {
        const zone = layer.zones[j]
        if (zone.points.length < 2) continue
        if (zone.closed && this.pointInPolygon(worldX, worldY, zone.points)) {
          return { zone, layerId: layer.id }
        }
        // For open zones or edge proximity, check line segments
        if (this.nearPolyline(worldX, worldY, zone.points, 8 / this.camera.zoom)) {
          return { zone, layerId: layer.id }
        }
      }
    }
    return null
  }

  /** Hit-test an image layer at world coordinates. */
  hitTestImageLayer(worldX: number, worldY: number): ImageLayer | null {
    if (!this.map) return null
    // Top-to-bottom (reverse order)
    for (let i = this.map.layers.length - 1; i >= 0; i--) {
      const layer = this.map.layers[i]
      if (!layer.visible || layer.type !== 'image') continue
      if (this.imageLayerHasTransform(layer)) {
        const corners = this.getImageLayerCorners(layer)
        if (corners.length === 4 && this.pointInPolygon(worldX, worldY, corners)) {
          return layer
        }
      } else {
        if (worldX >= layer.x && worldX <= layer.x + layer.width &&
            worldY >= layer.y && worldY <= layer.y + layer.height) {
          return layer
        }
      }
    }
    return null
  }

  /**
   * Hit-test image layer resize handles.
   * Returns which corner handle was hit: 'tl' | 'tr' | 'bl' | 'br' or null.
   */
  hitTestImageLayerHandle(worldX: number, worldY: number, layer: ImageLayer): string | null {
    const hs = 10 / this.camera.zoom // handle hit area in world space

    if (this.imageLayerHasTransform(layer)) {
      const transformedCorners = this.getImageLayerCorners(layer)
      if (transformedCorners.length !== 4) return null
      const labels = ['tl', 'tr', 'br', 'bl']
      for (let i = 0; i < 4; i++) {
        if (Math.abs(worldX - transformedCorners[i].x) < hs && Math.abs(worldY - transformedCorners[i].y) < hs) {
          return labels[i]
        }
      }
      return null
    }

    const corners: [number, number, string][] = [
      [layer.x, layer.y, 'tl'],
      [layer.x + layer.width, layer.y, 'tr'],
      [layer.x, layer.y + layer.height, 'bl'],
      [layer.x + layer.width, layer.y + layer.height, 'br']
    ]
    for (const [cx, cy, handle] of corners) {
      if (Math.abs(worldX - cx) < hs && Math.abs(worldY - cy) < hs) {
        return handle
      }
    }
    return null
  }

  /** Ray-casting point-in-polygon test */
  private pointInPolygon(x: number, y: number, points: { x: number; y: number }[]): boolean {
    let inside = false
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x, yi = points[i].y
      const xj = points[j].x, yj = points[j].y
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside
      }
    }
    return inside
  }

  /** Check if a point is near any segment of a polyline */
  private nearPolyline(
    x: number, y: number,
    points: { x: number; y: number }[],
    threshold: number
  ): boolean {
    for (let i = 0; i < points.length - 1; i++) {
      if (this.distToSegment(x, y, points[i], points[i + 1]) < threshold) {
        return true
      }
    }
    return false
  }

  /** Distance from point to line segment */
  private distToSegment(
    px: number, py: number,
    a: { x: number; y: number },
    b: { x: number; y: number }
  ): number {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lenSq = dx * dx + dy * dy
    if (lenSq === 0) return Math.sqrt((px - a.x) ** 2 + (py - a.y) ** 2)
    let t = ((px - a.x) * dx + (py - a.y) * dy) / lenSq
    t = Math.max(0, Math.min(1, t))
    const projX = a.x + t * dx
    const projY = a.y + t * dy
    return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2)
  }
}
