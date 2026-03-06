import type { MapData } from '../models/map'
import type { TileLayer } from '../models/layer'
import type { Tileset } from '../models/tileset'

export interface GodotExportResult {
  tscnContent: string
  tilesetImages: { filename: string; dataUrl: string }[]
}

/** Write a uint16 (little-endian) into a byte array */
function writeUint16LE(bytes: number[], value: number): void {
  bytes.push(value & 0xFF, (value >> 8) & 0xFF)
}

/** Write an int16 (little-endian, two's complement) into a byte array */
function writeInt16LE(bytes: number[], value: number): void {
  if (value < 0) value = 0x10000 + value
  writeUint16LE(bytes, value)
}

/** Sanitize a name for use as a filename */
function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').toLowerCase()
}

/** Sanitize a name for Godot node names (no special chars) */
function sanitizeNodeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_ -]/g, '_')
}

/**
 * Encode a tile layer into Godot 4's PackedByteArray format for TileMapLayer.
 *
 * Format: 2-byte header (version) + 12 bytes per occupied cell:
 *   int16 cell_x, int16 cell_y, uint16 source_id,
 *   uint16 atlas_x, uint16 atlas_y, uint16 alternative_tile
 */
function encodeTileMapData(
  layer: TileLayer,
  tilesets: Tileset[],
  gridWidth: number,
  gridHeight: number
): number[] {
  const bytes: number[] = []

  // Header: format version (uint16 LE)
  writeUint16LE(bytes, 1)

  for (let row = 0; row < gridHeight; row++) {
    for (let col = 0; col < gridWidth; col++) {
      const cell = layer.data[row]?.[col]
      if (!cell) continue

      const tsIndex = tilesets.findIndex(ts => ts.id === cell.tilesetId)
      if (tsIndex === -1) continue
      const ts = tilesets[tsIndex]

      const atlasX = cell.tileIndex % ts.columns
      const atlasY = Math.floor(cell.tileIndex / ts.columns)

      writeInt16LE(bytes, col)         // cell x
      writeInt16LE(bytes, row)         // cell y
      writeUint16LE(bytes, tsIndex)    // source_id
      writeUint16LE(bytes, atlasX)     // atlas_coords.x
      writeUint16LE(bytes, atlasY)     // atlas_coords.y
      writeUint16LE(bytes, 0)          // alternative_tile (no flip)
    }
  }

  return bytes
}

/**
 * Export the map as a Godot 4 .tscn scene file.
 * Creates TileMapLayer nodes for tile layers, Node2D+Sprite2D for objects.
 * Returns the TSCN content string plus tileset images to save alongside.
 */
export function exportMapAsGodot(map: MapData): GodotExportResult {
  const { config, layers, tilesets } = map
  const orientation = config.orientation || 'diamond'

  const tilesetImages: { filename: string; dataUrl: string }[] = []
  const lines: string[] = []

  // Collect resources needed
  const extResources: { type: string; path: string; id: string }[] = []
  const subResources: string[] = []

  // --- External resources: tileset textures ---
  for (let i = 0; i < tilesets.length; i++) {
    const ts = tilesets[i]
    const filename = sanitizeFilename(ts.name) + '.png'
    const resId = `${i + 1}_${sanitizeFilename(ts.name)}`

    extResources.push({
      type: 'Texture2D',
      path: `res://tilesets/${filename}`,
      id: resId
    })

    tilesetImages.push({ filename, dataUrl: ts.imageDataUrl })
  }

  // Also collect image layer textures
  const imageLayers = layers.filter(l => l.type === 'image')
  for (let i = 0; i < imageLayers.length; i++) {
    const il = imageLayers[i]
    if (il.type !== 'image' || !il.imageDataUrl) continue
    const filename = sanitizeFilename(il.name || 'image_' + i) + '.png'
    const resId = `img_${i}_${sanitizeFilename(il.name || 'image')}`

    extResources.push({
      type: 'Texture2D',
      path: `res://tilesets/${filename}`,
      id: resId
    })

    tilesetImages.push({ filename, dataUrl: il.imageDataUrl })
  }

  // --- Sub-resources: TileSetAtlasSources ---
  for (let i = 0; i < tilesets.length; i++) {
    const ts = tilesets[i]
    const resId = `${i + 1}_${sanitizeFilename(ts.name)}`
    const atlasId = `TileSetAtlasSource_${i}`

    const atlasLines: string[] = []
    atlasLines.push(`[sub_resource type="TileSetAtlasSource" id="${atlasId}"]`)
    atlasLines.push(`texture = ExtResource("${resId}")`)
    atlasLines.push(`texture_region_size = Vector2i(${ts.tileWidth}, ${ts.tileHeight})`)

    // Register each tile in the atlas
    for (let t = 0; t < ts.tiles.length; t++) {
      const ax = t % ts.columns
      const ay = Math.floor(t / ts.columns)
      atlasLines.push(`${ax}:${ay}/0 = 0`)
    }

    subResources.push(atlasLines.join('\n'))
  }

  // --- Sub-resource: TileSet ---
  const tileSetLines: string[] = []
  tileSetLines.push(`[sub_resource type="TileSet" id="TileSet_main"]`)
  tileSetLines.push(`tile_shape = 1`) // ISOMETRIC

  if (orientation === 'staggered') {
    tileSetLines.push(`tile_layout = 0`)  // STACKED
    tileSetLines.push(`tile_offset_axis = 1`) // VERTICAL
  } else {
    tileSetLines.push(`tile_layout = 5`)  // DIAMOND_DOWN
    tileSetLines.push(`tile_offset_axis = 0`) // HORIZONTAL
  }

  tileSetLines.push(`tile_size = Vector2i(${config.tileWidth}, ${config.tileHeight})`)

  for (let i = 0; i < tilesets.length; i++) {
    tileSetLines.push(`sources/${i} = SubResource("TileSetAtlasSource_${i}")`)
  }

  subResources.push(tileSetLines.join('\n'))

  // --- Count load steps ---
  const loadSteps = extResources.length + subResources.length + 1

  // --- Build TSCN file ---
  lines.push(`[gd_scene load_steps=${loadSteps} format=3]`)
  lines.push('')

  // External resources
  for (const er of extResources) {
    lines.push(`[ext_resource type="${er.type}" path="${er.path}" id="${er.id}"]`)
  }
  if (extResources.length > 0) lines.push('')

  // Sub-resources
  for (const sr of subResources) {
    lines.push(sr)
    lines.push('')
  }

  // Root node
  lines.push(`[node name="Root" type="Node2D"]`)
  lines.push('')

  // Layer nodes
  let imageLayerIdx = 0
  for (const layer of layers) {
    const nodeName = sanitizeNodeName(layer.name)

    if (layer.type === 'tile') {
      const tileData = encodeTileMapData(layer, tilesets, config.gridWidth, config.gridHeight)
      const byteStr = tileData.join(', ')

      lines.push(`[node name="${nodeName}" type="TileMapLayer" parent="."]`)
      lines.push(`tile_set = SubResource("TileSet_main")`)
      if (!layer.visible) lines.push(`visible = false`)
      if (layer.opacity < 1) lines.push(`modulate = Color(1, 1, 1, ${layer.opacity.toFixed(2)})`)
      lines.push(`tile_map_data = PackedByteArray(${byteStr})`)
      lines.push('')
    } else if (layer.type === 'object' || layer.type === 'drawing') {
      // Object/Drawing layer → Node2D container
      lines.push(`[node name="${nodeName}" type="Node2D" parent="."]`)
      if (!layer.visible) lines.push(`visible = false`)
      if (layer.opacity < 1) lines.push(`modulate = Color(1, 1, 1, ${layer.opacity.toFixed(2)})`)
      lines.push('')

      // Export objects as Sprite2D (if they have images) or as markers
      for (let j = 0; j < layer.objects.length; j++) {
        const obj = layer.objects[j]
        const objName = sanitizeNodeName(obj.name || `Object_${j}`)
        lines.push(`[node name="${objName}" type="Sprite2D" parent="${nodeName}"]`)
        lines.push(`position = Vector2(${(obj.x + obj.width / 2).toFixed(1)}, ${(obj.y + obj.height / 2).toFixed(1)})`)
        if (obj.flipX) lines.push(`flip_h = true`)
        if (obj.flipY) lines.push(`flip_v = true`)
        lines.push('')
      }

      // Export zones as Polygon2D or StaticBody2D with CollisionPolygon2D (object layers only)
      const zones = layer.type === 'object' ? layer.zones : []
      for (let j = 0; j < zones.length; j++) {
        const zone = zones[j]
        if (zone.points.length < 2) continue

        const zoneName = sanitizeNodeName(zone.name || `Zone_${j}`)
        const isCollision = zone.zoneType === 'collision'

        if (isCollision && zone.closed) {
          // Collision zone → StaticBody2D + CollisionPolygon2D
          lines.push(`[node name="${zoneName}" type="StaticBody2D" parent="${nodeName}"]`)
          lines.push('')

          const pointsStr = zone.points.map(p => `${p.x.toFixed(1)}, ${p.y.toFixed(1)}`).join(', ')
          lines.push(`[node name="CollisionShape" type="CollisionPolygon2D" parent="${nodeName}/${zoneName}"]`)
          lines.push(`polygon = PackedVector2Array(${pointsStr})`)
          lines.push('')
        } else {
          // Regular zone → Polygon2D
          const pointsStr = zone.points.map(p => `${p.x.toFixed(1)}, ${p.y.toFixed(1)}`).join(', ')
          // Parse hex color to Godot Color
          const color = hexToGodotColor(zone.color)
          lines.push(`[node name="${zoneName}" type="Polygon2D" parent="${nodeName}"]`)
          lines.push(`polygon = PackedVector2Array(${pointsStr})`)
          lines.push(`color = ${color}`)
          lines.push('')
        }
      }
    } else if (layer.type === 'image') {
      const resId = `img_${imageLayerIdx}_${sanitizeFilename(layer.name || 'image')}`
      imageLayerIdx++

      lines.push(`[node name="${nodeName}" type="Sprite2D" parent="."]`)
      lines.push(`texture = ExtResource("${resId}")`)
      lines.push(`centered = false`)
      lines.push(`position = Vector2(${layer.x.toFixed(1)}, ${layer.y.toFixed(1)})`)
      if (!layer.visible) lines.push(`visible = false`)
      if (layer.opacity < 1) lines.push(`modulate = Color(1, 1, 1, ${layer.opacity.toFixed(2)})`)
      if (layer.rotation) lines.push(`rotation = ${(layer.rotation * Math.PI / 180).toFixed(4)}`)
      lines.push('')
    }
  }

  return {
    tscnContent: lines.join('\n'),
    tilesetImages
  }
}

/** Convert hex color (#rrggbb or #rgb) to Godot Color(r, g, b, a) */
function hexToGodotColor(hex: string): string {
  let r = 0, g = 0, b = 0
  const h = hex.replace('#', '')
  if (h.length === 3) {
    r = parseInt(h[0] + h[0], 16) / 255
    g = parseInt(h[1] + h[1], 16) / 255
    b = parseInt(h[2] + h[2], 16) / 255
  } else if (h.length >= 6) {
    r = parseInt(h.substring(0, 2), 16) / 255
    g = parseInt(h.substring(2, 4), 16) / 255
    b = parseInt(h.substring(4, 6), 16) / 255
  }
  return `Color(${r.toFixed(3)}, ${g.toFixed(3)}, ${b.toFixed(3)}, 0.200)`
}
