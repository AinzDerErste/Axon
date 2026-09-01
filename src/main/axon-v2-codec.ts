/**
 * Axon v2/v3 binary file format codec.
 *
 * v3 changes (v2 files stay readable):
 *   - tile records carry an explicit opcode, so the empty-cell marker can no
 *     longer be confused with tileset index 0 (which used to shift the whole
 *     grid when a tile referenced a deleted tileset)
 *   - tileset index widened to uint16, grid dimensions to uint32
 *   - image dedup uses SHA-1 instead of a length/head/tail fingerprint
 *
 * File layout:
 *   [0x00] Magic "AXON" (4 bytes)
 *   [0x04] Version uint16 LE = 3 (2 = legacy, still readable)
 *   [0x06] Section count uint16 LE
 *   [0x08] Section table: N × 10 bytes (type:u16 + offset:u32 + length:u32)
 *   [...]  Section data (each independently gzipped)
 *
 * Section types:
 *   0x01  METADATA         — gzipped JSON (no tile data, no image blobs)
 *   0x02  IMAGE_BLOB_TABLE — gzipped binary (length-prefixed raw image blobs)
 *   0x10+ TILE_DATA_N      — gzipped RLE binary per tile layer
 */

import { gzipSync, gunzipSync, brotliCompressSync, brotliDecompressSync, constants as ZLIB } from 'zlib'
import { createHash } from 'crypto'

// ── Constants ────────────────────────────────────────────────────────────────

const MAGIC = Buffer.from('AXON', 'ascii')
const FORMAT_VERSION = 3
const READABLE_VERSIONS = new Set([2, 3])

/** v3 tile stream opcodes */
const OP_EMPTY_RUN = 0x00
const OP_TILE = 0x01

const MAX_TILESET_INDEX = 0xFFFF
const MAX_TILE_INDEX = 0xFFFF
const MAX_GRID_DIM = 0xFFFFFFFF

const SECTION_METADATA = 0x01
const SECTION_IMAGE_BLOBS = 0x02
const SECTION_TILE_BASE = 0x10     // 0x10 + layerIndex
const SECTION_PRESET_TILE_BASE = 0x4000 // 0x4000 + presetTileLayerIndex
const MAX_TILE_SECTIONS = SECTION_PRESET_TILE_BASE - SECTION_TILE_BASE
const MAX_SECTION_TYPE = 0xFFFF

const MIME_CODES: Record<string, number> = {
  'image/png': 0,
  'image/jpeg': 1,
  'image/webp': 2,
  'image/gif': 3
}
const MIME_STRINGS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

// ── Section compression ──────────────────────────────────────────────────────
//
// Text and tile streams compress far better with brotli than with gzip; image
// blobs are already-compressed PNG/JPEG, where anything above the cheapest
// gzip level costs seconds and saves nothing. Sections carry no compression
// flag — gzip is recognised by its magic bytes, everything else is brotli — so
// v2 files (all gzip) keep decoding unchanged.

function brotli(buf: Buffer, quality: number): Buffer {
  return brotliCompressSync(buf, {
    params: {
      [ZLIB.BROTLI_PARAM_QUALITY]: quality,
      [ZLIB.BROTLI_PARAM_SIZE_HINT]: buf.length
    }
  })
}

/** JSON metadata — small enough to afford a high quality setting. */
function compressText(buf: Buffer): Buffer {
  return brotli(buf, 9)
}

/** Tile streams — already RLE-compacted, so a fast setting is the right trade. */
function compressBinary(buf: Buffer): Buffer {
  return brotli(buf, 5)
}

/** Image blobs — incompressible; only pay for the framing. */
function compressBlobs(buf: Buffer): Buffer {
  return gzipSync(buf, { level: 1 })
}

function decompressSection(buf: Buffer): Buffer {
  const isGzip = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b
  return isGzip ? gunzipSync(buf) : brotliDecompressSync(buf)
}

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

/**
 * Content hash for image deduplication.
 *
 * Must be a real digest: the previous fingerprint (length + first 64 + last 32
 * bytes) collided for same-size tiles sliced from one spritesheet, which made
 * different tiles share a single blob after a reload.
 */
function hashBytes(bytes: Buffer): string {
  return createHash('sha1').update(bytes).digest('hex')
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

// ── Tile Grid Encoding ─────────────────────────────────────────────

/**
 * Encode a tile grid (v3).
 *
 * Header:  cols uint32 LE, rows uint32 LE
 * Records: 0x00 <count uint32 LE>                    — run of empty cells
 *          0x01 <tilesetIdx uint16 LE> <tileIdx uint16 LE>  — placed tile
 *
 * The opcode makes the stream unambiguous. In v2 an empty cell and tileset
 * index 0 were the same byte, so a tile pointing at a deleted tileset shifted
 * every following cell of the grid.
 */
function encodeTileGrid(
  data: any[][],
  tilesetIndexMap: Map<string, number>,
  rows: number,
  cols: number
): Buffer {
  if (rows > MAX_GRID_DIM || cols > MAX_GRID_DIM) {
    throw new Error(`Map too large to save: ${cols}×${rows} exceeds ${MAX_GRID_DIM} cells per axis`)
  }

  // Worst case: 8 byte header + 5 byte per cell (opcode + two uint16)
  const buf = Buffer.alloc(8 + rows * cols * 5)
  let offset = 0

  buf.writeUInt32LE(cols, offset); offset += 4
  buf.writeUInt32LE(rows, offset); offset += 4

  let emptyRun = 0

  function flushEmpty(): void {
    if (emptyRun === 0) return
    buf.writeUInt8(OP_EMPTY_RUN, offset); offset += 1
    buf.writeUInt32LE(emptyRun, offset); offset += 4
    emptyRun = 0
  }

  for (let r = 0; r < rows; r++) {
    const row = data[r]
    for (let c = 0; c < cols; c++) {
      const cell = row?.[c]
      const tsIdx = cell ? tilesetIndexMap.get(cell.tilesetId) : undefined

      // No cell, or a cell pointing at a tileset that no longer exists.
      // The tile reference is unusable either way — write it as empty rather
      // than emitting a record the decoder cannot resolve.
      if (!cell || tsIdx === undefined) {
        emptyRun++
        continue
      }

      if (tsIdx > MAX_TILESET_INDEX) {
        throw new Error(`Too many tilesets to save: index ${tsIdx} exceeds ${MAX_TILESET_INDEX}`)
      }
      const tileIndex = cell.tileIndex | 0
      if (tileIndex < 0 || tileIndex > MAX_TILE_INDEX) {
        throw new Error(`Tile index ${tileIndex} out of range (0–${MAX_TILE_INDEX}) in tileset "${cell.tilesetId}"`)
      }

      flushEmpty()
      buf.writeUInt8(OP_TILE, offset); offset += 1
      buf.writeUInt16LE(tsIdx, offset); offset += 2
      buf.writeUInt16LE(tileIndex, offset); offset += 2
    }
  }
  flushEmpty()

  return buf.subarray(0, offset)
}

/** Decode a v3 tile stream. */
function decodeTileGridV3(buf: Buffer, tilesetIds: string[]): any[][] {
  let offset = 0
  const cols = buf.readUInt32LE(offset); offset += 4
  const rows = buf.readUInt32LE(offset); offset += 4

  const data: any[][] = []
  for (let i = 0; i < rows; i++) data.push(new Array(cols).fill(null))

  let r = 0, c = 0

  function advance(n: number): void {
    while (n > 0 && r < rows) {
      const step = Math.min(n, cols - c)
      c += step
      n -= step
      if (c >= cols) { c = 0; r++ }
    }
  }

  while (offset < buf.length && r < rows) {
    const op = buf.readUInt8(offset); offset += 1

    if (op === OP_EMPTY_RUN) {
      const count = buf.readUInt32LE(offset); offset += 4
      advance(count)
      continue
    }

    if (op === OP_TILE) {
      const tsIdx = buf.readUInt16LE(offset); offset += 2
      const tileIndex = buf.readUInt16LE(offset); offset += 2
      if (r < rows && c < cols) {
        data[r][c] = { tilesetId: tilesetIds[tsIdx] || '', tileIndex }
      }
      advance(1)
      continue
    }

    throw new Error(`Corrupt tile stream: unknown opcode 0x${op.toString(16)} at byte ${offset - 1}`)
  }

  return data
}

/**
 * Decode a legacy v2 tile stream.
 *
 * Kept as-is so existing .axon files keep opening. It carries the v2 ambiguity
 * (0x00 means both "empty cell" and "tileset index 0"), which is exactly why
 * v3 exists — a v2 file written after a tileset was deleted may already be
 * shifted and cannot be recovered here.
 */
function decodeTileGridV2(buf: Buffer, tilesetIds: string[]): any[][] {
  let offset = 0
  const cols = buf.readUInt16LE(offset); offset += 2
  const rows = buf.readUInt16LE(offset); offset += 2

  const data: any[][] = []
  let r = 0, c = 0

  for (let i = 0; i < rows; i++) {
    data.push(new Array(cols).fill(null))
  }

  while (offset < buf.length && r < rows) {
    const b = buf.readUInt8(offset); offset += 1

    if (b === 0x00) {
      if (offset + 1 < buf.length && buf.readUInt16LE(offset) === 0xFFFF) {
        offset += 2
        const count = buf.readUInt16LE(offset); offset += 2
        let remaining = count
        while (remaining > 0 && r < rows) {
          const skip = Math.min(remaining, cols - c)
          c += skip
          remaining -= skip
          if (c >= cols) { c = 0; r++ }
        }
      } else {
        c++
        if (c >= cols) { c = 0; r++ }
      }
    } else {
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

/** Decode a tile stream written by format version `version`. */
function decodeTileGrid(buf: Buffer, tilesetIds: string[], version: number): any[][] {
  return version >= 3
    ? decodeTileGridV3(buf, tilesetIds)
    : decodeTileGridV2(buf, tilesetIds)
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

function buildMetadata(
  project: any,
  blobTable: BlobTableResult,
  tileLayerIndices: number[],
  presetTileSectionIds: Map<string, number>
): any {
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

  // Keep every field except the inlined image; a whitelist here silently
  // dropped ids, categories and tags on every save.
  const objectLibrary = (project.objectLibrary || []).map((o: any) => {
    const { imageDataUrl: _img, ...rest } = o
    return { ...rest, imageIndex: resolveImageIndex(o.imageDataUrl, blobTable) }
  })

  const presets = (project.presets || []).map((p: any, pi: number) => {
    const { thumbnail: _thumb, objects: _objs, tileLayers: _tl, ...rest } = p
    return {
      ...rest,
      // Preset tiles used to sit here as raw nested JSON — one object per cell,
      // the largest single block in most files. They now live in their own
      // RLE-compacted sections, same as map layers.
      tileLayers: (p.tileLayers || []).map((tl: any, li: number) => ({
        name: tl.name,
        tileDataSection: presetTileSectionIds.get(`${pi}:${li}`)
      })),
      objects: (p.objects || []).map((o: any) => {
        const { imageDataUrl: _img, ...orest } = o
        return { ...orest, imageIndex: resolveImageIndex(o.imageDataUrl, blobTable) }
      }),
      zones: p.zones || [],
      thumbnailIndex: p.thumbnail ? resolveImageIndex(p.thumbnail, blobTable) : undefined
    }
  })

  return {
    version: FORMAT_VERSION,
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
      if (tileIdx >= MAX_TILE_SECTIONS) {
        throw new Error(`Too many tile layers to save: ${tileIdx + 1} exceeds ${MAX_TILE_SECTIONS}`)
      }
      tileSections.push({ sectionType: SECTION_TILE_BASE + tileIdx, data: compressBinary(raw) })
      tileLayerIndices.push(tileIdx)
      tileIdx++
    }
  }

  // 4. Encode preset tile layers into their own sections
  const presetSections: { sectionType: number; data: Buffer }[] = []
  const presetTileSectionIds = new Map<string, number>()
  let presetTileIdx = 0
  ;(project.presets || []).forEach((p: any, pi: number) => {
    ;(p.tileLayers || []).forEach((tl: any, li: number) => {
      const tiles = tl.tiles || []
      const rows = tiles.length
      const cols = rows > 0 ? (tiles[0]?.length || 0) : 0
      const raw = encodeTileGrid(tiles, tilesetIndexMap, rows, cols)
      const sectionType = SECTION_PRESET_TILE_BASE + presetTileIdx
      if (sectionType > MAX_SECTION_TYPE) {
        throw new Error(`Too many preset tile layers to save: ${presetTileIdx + 1}`)
      }
      presetSections.push({ sectionType, data: compressBinary(raw) })
      presetTileSectionIds.set(`${pi}:${li}`, presetTileIdx)
      presetTileIdx++
    })
  })

  // 5. Build metadata section
  const metadata = buildMetadata(project, blobTable, tileLayerIndices, presetTileSectionIds)
  const metadataSection = compressText(Buffer.from(JSON.stringify(metadata), 'utf-8'))

  // 6. Encode and compress blob table
  const blobSection = compressBlobs(encodeBlobTable(blobTable.blobs))

  // 7. Assemble file
  const sections = [
    { type: SECTION_METADATA, data: metadataSection },
    { type: SECTION_IMAGE_BLOBS, data: blobSection },
    ...tileSections.map(s => ({ type: s.sectionType, data: s.data })),
    ...presetSections.map(s => ({ type: s.sectionType, data: s.data }))
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
  if (!READABLE_VERSIONS.has(version)) {
    throw new Error(`Unsupported Axon version: ${version}`)
  }

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
    return decompressSection(buf.subarray(s.offset, s.offset + s.length))
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
      const data = decodeTileGrid(tileBuf, tilesetIds, version)
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
    tileLayers: (p.tileLayers || []).map((tl: any) => {
      // v3 keeps preset tiles in their own sections; v2 inlined them as JSON.
      if (tl.tileDataSection === undefined) return tl
      const tileBuf = getSection(SECTION_PRESET_TILE_BASE + tl.tileDataSection)
      if (!tileBuf) throw new Error(`Missing PRESET_TILE_DATA section ${tl.tileDataSection}`)
      return { name: tl.name, tiles: decodeTileGrid(tileBuf, tilesetIds, version) }
    }),
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

// ── Section Extraction (for fast IPC transfer) ─────────────────────────────

/**
 * Extract and decompress v2 sections without full decode.
 * Returns metadata JSON string + binary ArrayBuffers for fast IPC transfer.
 */
export function extractV2Sections(buf: Buffer): {
  version: number
  metadataJson: string
  blobTable: ArrayBuffer
  tileSections: { index: number; data: ArrayBuffer }[]
  presetTileSections: { index: number; data: ArrayBuffer }[]
} {
  if (buf.subarray(0, 4).toString('ascii') !== 'AXON') {
    throw new Error('Not a valid Axon project file')
  }

  const version = buf.readUInt16LE(4)
  if (!READABLE_VERSIONS.has(version)) {
    throw new Error(`Unsupported Axon version: ${version}`)
  }

  const sectionCount = buf.readUInt16LE(6)
  const sections: { type: number; offset: number; length: number }[] = []
  let tableOffset = 8
  for (let i = 0; i < sectionCount; i++) {
    const type = buf.readUInt16LE(tableOffset); tableOffset += 2
    const off = buf.readUInt32LE(tableOffset); tableOffset += 4
    const len = buf.readUInt32LE(tableOffset); tableOffset += 4
    sections.push({ type, offset: off, length: len })
  }

  function sectionByType(type: number): Buffer | null {
    const s = sections.find(s => s.type === type)
    if (!s) return null
    return decompressSection(buf.subarray(s.offset, s.offset + s.length))
  }

  // Metadata → JSON string (small, fast to transfer)
  const metaBuf = sectionByType(SECTION_METADATA)
  if (!metaBuf) throw new Error('Missing METADATA section')
  const metadataJson = metaBuf.toString('utf-8')

  // Blob table → ArrayBuffer (binary, efficient transfer)
  const blobBuf = sectionByType(SECTION_IMAGE_BLOBS)
  const blobTable: ArrayBuffer = blobBuf
    ? (blobBuf.buffer.slice(blobBuf.byteOffset, blobBuf.byteOffset + blobBuf.byteLength) as ArrayBuffer)
    : new ArrayBuffer(0)

  // Tile sections → ArrayBuffers (map layers and preset tile layers separately)
  const tileSections: { index: number; data: ArrayBuffer }[] = []
  const presetTileSections: { index: number; data: ArrayBuffer }[] = []
  for (const s of sections) {
    if (s.type < SECTION_TILE_BASE) continue
    const raw = decompressSection(buf.subarray(s.offset, s.offset + s.length))
    const entry = {
      index: s.type - (s.type >= SECTION_PRESET_TILE_BASE ? SECTION_PRESET_TILE_BASE : SECTION_TILE_BASE),
      data: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
    }
    if (s.type >= SECTION_PRESET_TILE_BASE) presetTileSections.push(entry)
    else tileSections.push(entry)
  }

  return { version, metadataJson, blobTable, tileSections, presetTileSections }
}

// ── Format Detection ─────────────────────────────────────────────────────────

export function detectFormat(buf: Buffer): 1 | 2 {
  if (buf.length >= 4 && buf[0] === 0x41 && buf[1] === 0x58
    && buf[2] === 0x4F && buf[3] === 0x4E) {
    return 2
  }
  return 1
}
