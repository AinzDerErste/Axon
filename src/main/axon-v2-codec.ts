/**
 * Axon v2 binary file format codec.
 *
 * File layout:
 *   [0x00] Magic "AXON" (4 bytes)
 *   [0x04] Version uint16 LE = 2
 *   [0x06] Section count uint16 LE
 *   [0x08] Section table: N × 10 bytes (type:u16 + offset:u32 + length:u32)
 *   [...]  Section data (each independently gzipped)
 *
 * Section types:
 *   0x01  METADATA         — gzipped JSON (no tile data, no image blobs)
 *   0x02  IMAGE_BLOB_TABLE — gzipped binary (length-prefixed raw image blobs)
 *   0x10+ TILE_DATA_N      — gzipped RLE binary per tile layer
 */

import { gzipSync, gunzipSync } from 'zlib'

// ── Constants ────────────────────────────────────────────────────────────────

const MAGIC = Buffer.from('AXON', 'ascii')
const FORMAT_VERSION = 2

const SECTION_METADATA = 0x01
const SECTION_IMAGE_BLOBS = 0x02
const SECTION_TILE_BASE = 0x10 // 0x10 + layerIndex

const MIME_CODES: Record<string, number> = {
  'image/png': 0,
  'image/jpeg': 1,
  'image/webp': 2,
  'image/gif': 3
}
const MIME_STRINGS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

// ── Helpers ──────────────────────────────────────────────────────────────────

function dataUrlToRaw(dataUrl: string): { mime: number; bytes: Buffer } {
  const comma = dataUrl.indexOf(',')
  const header = dataUrl.substring(0, comma) // "data:image/png;base64"
  const mimeStr = header.replace('data:', '').replace(';base64', '')
  const mime = MIME_CODES[mimeStr] ?? 0
  const bytes = Buffer.from(dataUrl.substring(comma + 1), 'base64')
  return { mime, bytes }
}

function rawToDataUrl(mimeCode: number, bytes: Buffer): string {
  const mime = MIME_STRINGS[mimeCode] || 'image/png'
  return `data:${mime};base64,${bytes.toString('base64')}`
}

/** Simple content hash for deduplication (length + first/last bytes) */
function hashBytes(bytes: Buffer): string {
  const len = bytes.length
  if (len === 0) return '0:'
  const head = bytes.subarray(0, Math.min(64, len)).toString('hex')
  const tail = len > 64 ? bytes.subarray(len - 32).toString('hex') : ''
  return `${len}:${head}:${tail}`
}

// ── Image Blob Table ─────────────────────────────────────────────────────────

interface BlobEntry { mime: number; bytes: Buffer }

interface BlobTableResult {
  blobs: BlobEntry[]
  /** Maps dataUrl content hash → blob index */
  indexMap: Map<string, number>
}

function buildBlobTable(project: any): BlobTableResult {
  const blobs: BlobEntry[] = []
  const indexMap = new Map<string, number>()

  function addImage(dataUrl: string | undefined | null): number {
    if (!dataUrl || !dataUrl.startsWith('data:')) return -1
    const raw = dataUrlToRaw(dataUrl)
    const hash = hashBytes(raw.bytes)
    const existing = indexMap.get(hash)
    if (existing !== undefined) return existing
    const idx = blobs.length
    blobs.push(raw)
    indexMap.set(hash, idx)
    return idx
  }

  // Tilesets
  for (const ts of project.tilesets || []) {
    if (!ts.sourcePath) addImage(ts.imageDataUrl)
  }

  // Layers
  for (const l of project.layers || []) {
    if (l.type === 'object' || l.type === 'drawing') {
      for (const o of l.objects || []) addImage(o.imageDataUrl)
    }
    if (l.type === 'image') addImage(l.imageDataUrl)
  }

  // Object library
  for (const o of project.objectLibrary || []) addImage(o.imageDataUrl)

  // Presets
  for (const p of project.presets || []) {
    for (const o of p.objects || []) addImage(o.imageDataUrl)
    if (p.thumbnail) addImage(p.thumbnail)
  }

  return { blobs, indexMap }
}

function encodeBlobTable(blobs: BlobEntry[]): Buffer {
  // Calculate total size
  let size = 4 // blob count
  for (const b of blobs) size += 1 + 4 + b.bytes.length // mime + len + data
  const buf = Buffer.alloc(size)
  let offset = 0
  buf.writeUInt32LE(blobs.length, offset); offset += 4
  for (const b of blobs) {
    buf.writeUInt8(b.mime, offset); offset += 1
    buf.writeUInt32LE(b.bytes.length, offset); offset += 4
    b.bytes.copy(buf, offset); offset += b.bytes.length
  }
  return buf
}

function decodeBlobTable(buf: Buffer): BlobEntry[] {
  const blobs: BlobEntry[] = []
  let offset = 0
  const count = buf.readUInt32LE(offset); offset += 4
  for (let i = 0; i < count; i++) {
    const mime = buf.readUInt8(offset); offset += 1
    const len = buf.readUInt32LE(offset); offset += 4
    const bytes = Buffer.from(buf.subarray(offset, offset + len))
    offset += len
    blobs.push({ mime, bytes })
  }
  return blobs
}

// ── Tile Grid Encoding ───────────────────────────────────────────────────────

function encodeTileGrid(
  data: any[][],
  tilesetIndexMap: Map<string, number>,
  rows: number,
  cols: number
): Buffer {
  // Worst case: 4 header + rows*cols*3 (all placed tiles)
  const buf = Buffer.alloc(4 + rows * cols * 5)
  let offset = 0

  buf.writeUInt16LE(cols, offset); offset += 2
  buf.writeUInt16LE(rows, offset); offset += 2

  // Flatten to row-major, encode with RLE for empty runs
  let emptyRun = 0

  function flushEmpty() {
    while (emptyRun > 0) {
      if (emptyRun === 1) {
        buf.writeUInt8(0x00, offset); offset += 1
        emptyRun = 0
      } else {
        const count = Math.min(emptyRun, 65535)
        buf.writeUInt8(0x00, offset); offset += 1
        buf.writeUInt16LE(0xFFFF, offset); offset += 2
        buf.writeUInt16LE(count, offset); offset += 2
        emptyRun -= count
      }
    }
  }

  for (let r = 0; r < rows; r++) {
    const row = data[r]
    for (let c = 0; c < cols; c++) {
      const cell = row?.[c]
      if (!cell) {
        emptyRun++
        continue
      }
      flushEmpty()
      const tsIdx = tilesetIndexMap.get(cell.tilesetId) ?? 0
      buf.writeUInt8(tsIdx, offset); offset += 1
      buf.writeUInt16LE(cell.tileIndex, offset); offset += 2
    }
  }
  flushEmpty()

  return buf.subarray(0, offset)
}

function decodeTileGrid(buf: Buffer, tilesetIds: string[]): any[][] {
  let offset = 0
  const cols = buf.readUInt16LE(offset); offset += 2
  const rows = buf.readUInt16LE(offset); offset += 2

  const data: any[][] = []
  let r = 0, c = 0

  // Pre-allocate rows
  for (let i = 0; i < rows; i++) {
    data.push(new Array(cols).fill(null))
  }

  while (offset < buf.length && r < rows) {
    const b = buf.readUInt8(offset); offset += 1

    if (b === 0x00) {
      // Empty cell or RLE run
      if (offset + 1 < buf.length && buf.readUInt16LE(offset) === 0xFFFF) {
        // RLE empty run
        offset += 2
        const count = buf.readUInt16LE(offset); offset += 2
        // Skip 'count' cells (already null)
        let remaining = count
        while (remaining > 0 && r < rows) {
          const skip = Math.min(remaining, cols - c)
          c += skip
          remaining -= skip
          if (c >= cols) { c = 0; r++ }
        }
      } else {
        // Single empty
        c++
        if (c >= cols) { c = 0; r++ }
      }
    } else {
      // Placed tile: tsIdx(already read as b) + tileIndex
      const tileIndex = buf.readUInt16LE(offset); offset += 2
      if (r < rows && c < cols) {
        data[r][c] = { tilesetId: tilesetIds[b] || '', tileIndex }
      }
      c++
      if (c >= cols) { c = 0; r++ }
    }
  }

  return data
}

// ── Metadata ─────────────────────────────────────────────────────────────────

function resolveImageIndex(
  dataUrl: string | undefined | null,
  blobTable: BlobTableResult
): number {
  if (!dataUrl || !dataUrl.startsWith('data:')) return -1
  const raw = dataUrlToRaw(dataUrl)
  const hash = hashBytes(raw.bytes)
  return blobTable.indexMap.get(hash) ?? -1
}

function buildMetadata(project: any, blobTable: BlobTableResult, tileLayerIndices: number[]): any {
  let tileDataIdx = 0

  const layers = (project.layers || []).map((l: any) => {
    if (l.type === 'tile') {
      return {
        type: 'tile',
        id: l.id,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        tileDataSection: tileLayerIndices[tileDataIdx++]
      }
    }
    if (l.type === 'object') {
      return {
        type: 'object',
        id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
        sortMode: l.sortMode || 'auto',
        groups: l.groups || [],
        objects: (l.objects || []).map((o: any) => ({
          id: o.id, name: o.name,
          imageIndex: resolveImageIndex(o.imageDataUrl, blobTable),
          x: o.x, y: o.y, width: o.width, height: o.height,
          flipX: o.flipX || false, flipY: o.flipY || false,
          rotation: o.rotation || 0,
          locked: o.locked || false,
          visible: o.visible !== false,
          groupId: o.groupId || undefined
        })),
        zones: (l.zones || []).map((z: any) => ({
          id: z.id, name: z.name, color: z.color,
          points: z.points, closed: z.closed,
          zoneType: z.zoneType || 'zone'
        })),
        paths: (l.paths || []).map((p: any) => ({
          id: p.id, name: p.name, color: p.color,
          points: p.points, loop: p.loop,
          assignedObjectId: p.assignedObjectId || undefined
        }))
      }
    }
    if (l.type === 'drawing') {
      return {
        type: 'drawing',
        id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
        objects: (l.objects || []).map((o: any) => ({
          id: o.id, name: o.name,
          imageIndex: resolveImageIndex(o.imageDataUrl, blobTable),
          x: o.x, y: o.y, width: o.width, height: o.height,
          flipX: o.flipX || false, flipY: o.flipY || false,
          rotation: o.rotation || 0,
          locked: o.locked || false,
          visible: o.visible !== false
        }))
      }
    }
    if (l.type === 'image') {
      return {
        type: 'image',
        id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
        imageIndex: resolveImageIndex(l.imageDataUrl, blobTable),
        x: l.x, y: l.y, width: l.width, height: l.height,
        isoTransform: l.isoTransform || false,
        rotation: l.rotation || 0,
        locked: l.locked || false
      }
    }
    return l
  })

  // Tilesets: build ordered ID list for tile encoding, replace imageDataUrl
  const tilesets = (project.tilesets || []).map((ts: any) => {
    const out: any = {
      id: ts.id, name: ts.name,
      tileWidth: ts.tileWidth, tileHeight: ts.tileHeight,
      columns: ts.columns, tiles: ts.tiles
    }
    if (ts.sourcePath) {
      out.sourcePath = ts.sourcePath
    } else {
      out.imageIndex = resolveImageIndex(ts.imageDataUrl, blobTable)
    }
    return out
  })

  const objectLibrary = (project.objectLibrary || []).map((o: any) => ({
    name: o.name,
    imageIndex: resolveImageIndex(o.imageDataUrl, blobTable),
    width: o.width,
    height: o.height
  }))

  const presets = (project.presets || []).map((p: any) => ({
    id: p.id, name: p.name, width: p.width, height: p.height,
    tileLayers: p.tileLayers,
    objects: (p.objects || []).map((o: any) => ({
      name: o.name,
      imageIndex: resolveImageIndex(o.imageDataUrl, blobTable),
      relX: o.relX, relY: o.relY,
      width: o.width, height: o.height,
      flipX: o.flipX, flipY: o.flipY, rotation: o.rotation
    })),
    zones: p.zones || [],
    thumbnailIndex: p.thumbnail ? resolveImageIndex(p.thumbnail, blobTable) : undefined
  }))

  return {
    version: 2,
    config: project.config,
    activeLayerId: project.activeLayerId,
    camera: project.camera || { x: 0, y: 0, zoom: 1 },
    tilesets,
    layers,
    objectLibrary,
    presets
  }
}

// ── Encode ───────────────────────────────────────────────────────────────────

export function encodeAxonV2(project: any): Buffer {
  // 1. Build blob table (deduplicated images)
  const blobTable = buildBlobTable(project)

  // 2. Build tileset index map: tilesetId → 1-based index (0 = empty)
  const tilesetIndexMap = new Map<string, number>()
  const tilesetIds: string[] = [''] // index 0 = empty
  for (const ts of project.tilesets || []) {
    tilesetIds.push(ts.id)
    tilesetIndexMap.set(ts.id, tilesetIds.length - 1)
  }

  // 3. Encode tile layers
  const tileSections: { sectionType: number; data: Buffer }[] = []
  const tileLayerIndices: number[] = []
  let tileIdx = 0
  for (const l of project.layers || []) {
    if (l.type === 'tile') {
      const rows = l.data?.length || 0
      const cols = rows > 0 ? (l.data[0]?.length || 0) : 0
      const raw = encodeTileGrid(l.data || [], tilesetIndexMap, rows, cols)
      const compressed = gzipSync(raw)
      tileSections.push({ sectionType: SECTION_TILE_BASE + tileIdx, data: compressed })
      tileLayerIndices.push(tileIdx)
      tileIdx++
    }
  }

  // 4. Build metadata section
  const metadata = buildMetadata(project, blobTable, tileLayerIndices)
  const metadataSection = gzipSync(Buffer.from(JSON.stringify(metadata), 'utf-8'))

  // 5. Encode and compress blob table
  const blobSection = gzipSync(encodeBlobTable(blobTable.blobs))

  // 6. Assemble file
  const sections = [
    { type: SECTION_METADATA, data: metadataSection },
    { type: SECTION_IMAGE_BLOBS, data: blobSection },
    ...tileSections.map(s => ({ type: s.sectionType, data: s.data }))
  ]

  const sectionCount = sections.length
  const headerSize = 8 + sectionCount * 10 // magic(4) + version(2) + count(2) + table
  let totalSize = headerSize
  for (const s of sections) totalSize += s.data.length

  const file = Buffer.alloc(totalSize)
  let offset = 0

  // Magic
  MAGIC.copy(file, offset); offset += 4
  // Version
  file.writeUInt16LE(FORMAT_VERSION, offset); offset += 2
  // Section count
  file.writeUInt16LE(sectionCount, offset); offset += 2

  // Section table
  let dataOffset = headerSize
  for (const s of sections) {
    file.writeUInt16LE(s.type, offset); offset += 2
    file.writeUInt32LE(dataOffset, offset); offset += 4
    file.writeUInt32LE(s.data.length, offset); offset += 4
    dataOffset += s.data.length
  }

  // Section data
  for (const s of sections) {
    s.data.copy(file, offset); offset += s.data.length
  }

  return file
}

// ── Decode ───────────────────────────────────────────────────────────────────

export function decodeAxonV2(buf: Buffer): any {
  // Verify magic
  if (buf.subarray(0, 4).toString('ascii') !== 'AXON') {
    throw new Error('Not a valid Axon v2 file')
  }

  const version = buf.readUInt16LE(4)
  if (version !== 2) throw new Error(`Unsupported Axon version: ${version}`)

  const sectionCount = buf.readUInt16LE(6)

  // Read section table
  const sections: { type: number; offset: number; length: number }[] = []
  let tableOffset = 8
  for (let i = 0; i < sectionCount; i++) {
    const type = buf.readUInt16LE(tableOffset); tableOffset += 2
    const off = buf.readUInt32LE(tableOffset); tableOffset += 4
    const len = buf.readUInt32LE(tableOffset); tableOffset += 4
    sections.push({ type, offset: off, length: len })
  }

  function getSection(type: number): Buffer | null {
    const s = sections.find(s => s.type === type)
    if (!s) return null
    return gunzipSync(buf.subarray(s.offset, s.offset + s.length))
  }

  // 1. Decode metadata
  const metaBuf = getSection(SECTION_METADATA)
  if (!metaBuf) throw new Error('Missing METADATA section')
  const metadata = JSON.parse(metaBuf.toString('utf-8'))

  // 2. Decode blob table
  const blobBuf = getSection(SECTION_IMAGE_BLOBS)
  const blobs = blobBuf ? decodeBlobTable(blobBuf) : []

  function blobToDataUrl(index: number): string {
    if (index < 0 || index >= blobs.length) return ''
    const b = blobs[index]
    return rawToDataUrl(b.mime, b.bytes)
  }

  // 3. Build tileset ID list for tile decoding
  const tilesetIds = [''] // index 0 = empty
  for (const ts of metadata.tilesets || []) {
    tilesetIds.push(ts.id)
  }

  // 4. Reconstruct layers
  const layers = (metadata.layers || []).map((l: any) => {
    if (l.type === 'tile') {
      const sectionType = SECTION_TILE_BASE + l.tileDataSection
      const tileBuf = getSection(sectionType)
      if (!tileBuf) throw new Error(`Missing TILE_DATA section ${l.tileDataSection}`)
      const data = decodeTileGrid(tileBuf, tilesetIds)
      return {
        type: 'tile',
        id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
        data
      }
    }
    if (l.type === 'object') {
      return {
        ...l,
        objects: (l.objects || []).map((o: any) => ({
          ...o,
          imageDataUrl: blobToDataUrl(o.imageIndex),
          imageIndex: undefined
        }))
      }
    }
    if (l.type === 'drawing') {
      return {
        ...l,
        objects: (l.objects || []).map((o: any) => ({
          ...o,
          imageDataUrl: blobToDataUrl(o.imageIndex),
          imageIndex: undefined
        }))
      }
    }
    if (l.type === 'image') {
      return {
        ...l,
        imageDataUrl: blobToDataUrl(l.imageIndex),
        imageIndex: undefined
      }
    }
    return l
  })

  // 5. Reconstruct tilesets
  const tilesets = (metadata.tilesets || []).map((ts: any) => {
    const out: any = { ...ts }
    if (ts.imageIndex !== undefined && ts.imageIndex >= 0) {
      out.imageDataUrl = blobToDataUrl(ts.imageIndex)
      delete out.imageIndex
    }
    return out
  })

  // 6. Reconstruct object library
  const objectLibrary = (metadata.objectLibrary || []).map((o: any) => ({
    ...o,
    imageDataUrl: blobToDataUrl(o.imageIndex),
    imageIndex: undefined
  }))

  // 7. Reconstruct presets
  const presets = (metadata.presets || []).map((p: any) => ({
    ...p,
    objects: (p.objects || []).map((o: any) => ({
      ...o,
      imageDataUrl: blobToDataUrl(o.imageIndex),
      imageIndex: undefined
    })),
    thumbnail: p.thumbnailIndex !== undefined ? blobToDataUrl(p.thumbnailIndex) : undefined,
    thumbnailIndex: undefined
  }))

  // Return same shape as v1 ProjectFile
  return {
    version: 1, // signal to loadProject() that this is a standard project
    config: metadata.config,
    layers,
    tilesets,
    activeLayerId: metadata.activeLayerId,
    camera: metadata.camera,
    objectLibrary,
    presets
  }
}

// ── Format Detection ─────────────────────────────────────────────────────────

export function detectFormat(buf: Buffer): 1 | 2 {
  if (buf.length >= 4 && buf[0] === 0x41 && buf[1] === 0x58
    && buf[2] === 0x4F && buf[3] === 0x4E) {
    return 2
  }
  return 1
}
