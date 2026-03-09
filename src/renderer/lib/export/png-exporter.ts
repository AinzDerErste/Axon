import type { MapData } from '../models/map'
import { mapToScreen } from '../engine/iso-math'
import { getBitmap } from '../stores/image-cache'

/** Get bitmap from cache or fallback to inline */
function bmp(item: { imageHash?: string; imageBitmap?: ImageBitmap | null }): ImageBitmap | null {
  if (item.imageHash) {
    const cached = getBitmap(item.imageHash)
    if (cached) return cached
  }
  return item.imageBitmap ?? null
}

export async function exportMapAsPng(map: MapData): Promise<Blob> {
  const { config, layers, tilesets } = map
  const { gridWidth, gridHeight, tileWidth, tileHeight } = config
  const orientation = config.orientation || 'diamond'

  // Calculate bounding box of the rendered map
  let minX: number, maxX: number, minY: number, maxY: number

  if (orientation === 'staggered') {
    // Staggered: roughly rectangular
    minX = -tileWidth / 2
    maxX = gridWidth * tileWidth + tileWidth / 2
    minY = 0
    maxY = (gridHeight + 1) * (tileHeight / 2)
  } else {
    // Diamond
    const topLeft = mapToScreen(0, 0, tileWidth, tileHeight, 'diamond')
    const topRight = mapToScreen(gridWidth - 1, 0, tileWidth, tileHeight, 'diamond')
    const bottomLeft = mapToScreen(0, gridHeight - 1, tileWidth, tileHeight, 'diamond')
    const bottomRight = mapToScreen(gridWidth - 1, gridHeight - 1, tileWidth, tileHeight, 'diamond')

    minX = Math.min(topLeft.x, bottomLeft.x) - tileWidth / 2
    maxX = Math.max(topRight.x, bottomRight.x) + tileWidth / 2
    minY = topLeft.y
    maxY = Math.max(bottomLeft.y, bottomRight.y) + tileHeight
  }

  const canvasWidth = Math.ceil(maxX - minX)
  const canvasHeight = Math.ceil(maxY - minY)

  const offscreen = new OffscreenCanvas(canvasWidth, canvasHeight)
  const ctx = offscreen.getContext('2d')!
  ctx.translate(-minX, -minY)

  // Draw layers bottom to top
  for (const layer of layers) {
    if (!layer.visible) continue
    ctx.globalAlpha = layer.opacity

    if (layer.type === 'object' || layer.type === 'drawing') {
      // Draw objects
      for (const obj of layer.objects) {
        if (!bmp(obj)) continue
        if (obj.visible === false) continue
        if (obj.flipX || obj.flipY) {
          ctx.save()
          const cx = obj.x + obj.width / 2
          const cy = obj.y + obj.height / 2
          ctx.translate(cx, cy)
          ctx.scale(obj.flipX ? -1 : 1, obj.flipY ? -1 : 1)
          ctx.drawImage(bmp(obj)!, -obj.width / 2, -obj.height / 2, obj.width, obj.height)
          ctx.restore()
        } else {
          ctx.drawImage(bmp(obj)!, obj.x, obj.y, obj.width, obj.height)
        }
      }
      continue
    }

    if (layer.type === 'image') {
      if (bmp(layer)) {
        const rot = (layer.rotation || 0) * Math.PI / 180
        const hasRotation = rot !== 0
        const hasIso = !!layer.isoTransform

        if (hasRotation || hasIso) {
          ctx.save()
          ctx.translate(layer.x, layer.y)
          if (hasIso) {
            const hw = tileWidth / 2
            const hh = tileHeight / 2
            const isoLen = Math.sqrt(hw * hw + hh * hh)
            ctx.transform(hw / isoLen, hh / isoLen, -hw / isoLen, hh / isoLen, 0, 0)
          }
          if (hasRotation) {
            ctx.translate(layer.width / 2, layer.height / 2)
            ctx.rotate(rot)
            ctx.translate(-layer.width / 2, -layer.height / 2)
          }
          ctx.drawImage(bmp(layer)!, 0, 0, layer.width, layer.height)
          ctx.restore()
        } else {
          ctx.drawImage(bmp(layer)!, layer.x, layer.y, layer.width, layer.height)
        }
      }
      continue
    }

    for (let row = 0; row < gridHeight; row++) {
      for (let col = 0; col < gridWidth; col++) {
        const tileRef = layer.data[row]?.[col]
        if (!tileRef) continue

        const tileset = tilesets.find(ts => ts.id === tileRef.tilesetId)
        if (!tileset || !bmp(tileset)) continue

        const tileEntry = tileset.tiles[tileRef.tileIndex]
        if (!tileEntry) continue

        const screen = mapToScreen(col, row, tileWidth, tileHeight, orientation)
        ctx.drawImage(
          bmp(tileset)!,
          tileEntry.x, tileEntry.y,
          tileEntry.width, tileEntry.height,
          screen.x - tileEntry.width / 2,
          screen.y + tileHeight - tileEntry.height,
          tileEntry.width, tileEntry.height
        )
      }
    }
  }

  ctx.globalAlpha = 1.0
  return offscreen.convertToBlob({ type: 'image/png' })
}
