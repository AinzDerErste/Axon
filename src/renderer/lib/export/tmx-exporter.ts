import type { MapData } from '../models/map'

export interface TmxExportResult {
  tmxContent: string
  tilesetImages: { filename: string; dataUrl: string }[]
}

/** Escape XML special characters */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/**
 * Export the map as a Tiled .tmx file (XML format, CSV tile encoding).
 * Returns the TMX XML string plus a list of tileset images to save alongside.
 */
export function exportMapAsTmx(map: MapData): TmxExportResult {
  const { config, layers, tilesets } = map
  const { gridWidth, gridHeight, tileWidth, tileHeight } = config
  const orientation = config.orientation || 'diamond'
  const renderOrder = config.renderOrder || 'right-down'

  // Build firstgid table
  const firstGids: number[] = []
  let nextGid = 1
  for (const ts of tilesets) {
    firstGids.push(nextGid)
    nextGid += ts.tiles.length
  }

  // Track tileset images to save
  const tilesetImages: { filename: string; dataUrl: string }[] = []

  // Assign layer/object IDs
  let nextLayerId = 1
  let nextObjectId = 1

  // Map orientation
  const tmxOrientation = orientation === 'staggered' ? 'staggered' : 'isometric'

  // Start building XML
  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')

  // Map element
  let mapAttrs = `version="1.10" orientation="${tmxOrientation}"`
  mapAttrs += ` renderorder="${renderOrder}"`
  mapAttrs += ` width="${gridWidth}" height="${gridHeight}"`
  mapAttrs += ` tilewidth="${tileWidth}" tileheight="${tileHeight}"`
  mapAttrs += ` infinite="0"`
  if (orientation === 'staggered') {
    mapAttrs += ` staggeraxis="y" staggerindex="odd"`
  }
  mapAttrs += ` nextlayerid="${layers.length + 1}" nextobjectid="1"`

  lines.push(`<map ${mapAttrs}>`)

  // Tilesets
  for (let i = 0; i < tilesets.length; i++) {
    const ts = tilesets[i]
    const firstgid = firstGids[i]
    const tileCount = ts.tiles.length
    const filename = sanitizeFilename(ts.name) + '.png'

    // Compute image dimensions from tileset data
    const imgWidth = ts.columns * ts.tileWidth
    const imgHeight = Math.ceil(tileCount / ts.columns) * ts.tileHeight

    lines.push(`  <tileset firstgid="${firstgid}" name="${esc(ts.name)}" tilewidth="${ts.tileWidth}" tileheight="${ts.tileHeight}" tilecount="${tileCount}" columns="${ts.columns}">`)
    lines.push(`    <image source="tilesets/${filename}" width="${imgWidth}" height="${imgHeight}"/>`)
    lines.push(`  </tileset>`)

    tilesetImages.push({ filename, dataUrl: ts.imageDataUrl })
  }

  // Layers
  for (const layer of layers) {
    const layerId = nextLayerId++

    if (layer.type === 'tile') {
      const visible = layer.visible ? 1 : 0
      lines.push(`  <layer id="${layerId}" name="${esc(layer.name)}" width="${gridWidth}" height="${gridHeight}" opacity="${layer.opacity}" visible="${visible}">`)
      lines.push(`    <data encoding="csv">`)

      // Build CSV rows
      const csvRows: string[] = []
      for (let row = 0; row < gridHeight; row++) {
        const rowValues: number[] = []
        for (let col = 0; col < gridWidth; col++) {
          const cell = layer.data[row]?.[col]
          if (!cell) {
            rowValues.push(0)
          } else {
            const tsIdx = tilesets.findIndex(ts => ts.id === cell.tilesetId)
            if (tsIdx === -1) {
              rowValues.push(0)
            } else {
              rowValues.push(firstGids[tsIdx] + cell.tileIndex)
            }
          }
        }
        csvRows.push(rowValues.join(','))
      }
      lines.push(csvRows.join(',\n'))

      lines.push(`    </data>`)
      lines.push(`  </layer>`)
    } else if (layer.type === 'object' || layer.type === 'drawing') {
      const visible = layer.visible ? 1 : 0
      lines.push(`  <objectgroup id="${layerId}" name="${esc(layer.name)}" opacity="${layer.opacity}" visible="${visible}">`)

      // Export map objects
      for (const obj of layer.objects) {
        const objId = nextObjectId++
        // Export as positioned rectangle (TMX tile objects require a tileset GID, which we don't have for free-form objects)
        let objAttrs = `id="${objId}"`
        if (obj.name) objAttrs += ` name="${esc(obj.name)}"`
        objAttrs += ` x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}"`
        lines.push(`    <object ${objAttrs}/>`)
      }

      // Export zones as polygons (object layers only, drawing layers have no zones)
      const zones = layer.type === 'object' ? layer.zones : []
      for (const zone of zones) {
        if (zone.points.length < 2) continue
        const objId = nextObjectId++
        const zoneType = zone.zoneType || 'zone'
        let objAttrs = `id="${objId}"`
        if (zone.name) objAttrs += ` name="${esc(zone.name)}"`
        objAttrs += ` type="${esc(zoneType)}"`
        // Use first point as anchor, make rest relative
        const anchor = zone.points[0]
        objAttrs += ` x="${anchor.x}" y="${anchor.y}"`

        if (zone.closed && zone.points.length >= 3) {
          // Closed polygon
          const relPoints = zone.points.map(p =>
            `${(p.x - anchor.x).toFixed(1)},${(p.y - anchor.y).toFixed(1)}`
          ).join(' ')
          lines.push(`    <object ${objAttrs}>`)
          lines.push(`      <polygon points="${relPoints}"/>`)
          // Add color as property
          lines.push(`      <properties>`)
          lines.push(`        <property name="color" value="${zone.color}"/>`)
          lines.push(`      </properties>`)
          lines.push(`    </object>`)
        } else {
          // Open polyline
          const relPoints = zone.points.map(p =>
            `${(p.x - anchor.x).toFixed(1)},${(p.y - anchor.y).toFixed(1)}`
          ).join(' ')
          lines.push(`    <object ${objAttrs}>`)
          lines.push(`      <polyline points="${relPoints}"/>`)
          lines.push(`      <properties>`)
          lines.push(`        <property name="color" value="${zone.color}"/>`)
          lines.push(`      </properties>`)
          lines.push(`    </object>`)
        }
      }

      lines.push(`  </objectgroup>`)
    } else if (layer.type === 'image') {
      const visible = layer.visible ? 1 : 0
      const filename = sanitizeFilename(layer.name || 'image') + '.png'
      lines.push(`  <imagelayer id="${layerId}" name="${esc(layer.name)}" opacity="${layer.opacity}" visible="${visible}" offsetx="${layer.x}" offsety="${layer.y}">`)
      lines.push(`    <image source="tilesets/${filename}" width="${layer.width}" height="${layer.height}"/>`)
      lines.push(`  </imagelayer>`)

      if (layer.imageDataUrl) {
        tilesetImages.push({ filename, dataUrl: layer.imageDataUrl })
      }
    }
  }

  lines.push(`</map>`)

  return {
    tmxContent: lines.join('\n'),
    tilesetImages
  }
}

/** Sanitize a name for use as a filename */
function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').toLowerCase()
}
