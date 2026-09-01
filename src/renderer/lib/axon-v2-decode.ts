/**
 * Browser-side Axon v2 section decoder.
 * Reconstructs a project object from decompressed sections received via IPC.
 * No Node.js dependencies — works with Uint8Array/DataView only.
 */

const MIME_STRINGS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** v3 tile stream opcodes (see src/main/axon-v2-codec.ts) */
const OP_EMPTY_RUN = 0x00
const OP_TILE = 0x01

interface BlobEntry { mime: number; bytes: Uint8Array }

function decodeBlobTable(buf: Uint8Array): BlobEntry[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const blobs: BlobEntry[] = []
  let offset = 0
  const count = view.getUint32(offset, true); offset += 4
  for (let i = 0; i < count; i++) {
    const mime = view.getUint8(offset); offset += 1
    const len = view.getUint32(offset, true); offset += 4
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset + offset, len)
    offset += len
    blobs.push({ mime, bytes })
  }
  return blobs
}

function blobToDataUrl(blobs: BlobEntry[], index: number): string {
  if (index < 0 || index >= blobs.length) return ''
  const b = blobs[index]
  const mime = MIME_STRINGS[b.mime] || 'image/png'
  // Convert Uint8Array to base64 in chunks — one String.fromCharCode call per
  // byte turns a few large tilesets into seconds of load time.
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < b.bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...b.bytes.subarray(i, i + CHUNK))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

function decodeTileGridV3(buf: Uint8Array, tilesetIds: string[]): any[][] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let offset = 0
  const cols = view.getUint32(offset, true); offset += 4
  const rows = view.getUint32(offset, true); offset += 4

  const data: any[][] = []
  for (let i = 0; i < rows; i++) data.push(new Array(cols).fill(null))

  let r = 0, c = 0
  const end = buf.byteLength

  function advance(n: number): void {
    while (n > 0 && r < rows) {
      const step = Math.min(n, cols - c)
      c += step
      n -= step
      if (c >= cols) { c = 0; r++ }
    }
  }

  while (offset < end && r < rows) {
    const op = view.getUint8(offset); offset += 1

    if (op === OP_EMPTY_RUN) {
      const count = view.getUint32(offset, true); offset += 4
      advance(count)
      continue
    }

    if (op === OP_TILE) {
      const tsIdx = view.getUint16(offset, true); offset += 2
      const tileIndex = view.getUint16(offset, true); offset += 2
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

/** Legacy v2 tile stream — kept so existing .axon files keep opening. */
function decodeTileGridV2(buf: Uint8Array, tilesetIds: string[]): any[][] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let offset = 0
  const cols = view.getUint16(offset, true); offset += 2
  const rows = view.getUint16(offset, true); offset += 2

  const data: any[][] = []
  for (let i = 0; i < rows; i++) data.push(new Array(cols).fill(null))

  let r = 0, c = 0
  const end = buf.byteLength

  while (offset < end && r < rows) {
    const b = view.getUint8(offset); offset += 1

    if (b === 0x00) {
      if (offset + 1 < end && view.getUint16(offset, true) === 0xFFFF) {
        offset += 2
        const count = view.getUint16(offset, true); offset += 2
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
      const tileIndex = view.getUint16(offset, true); offset += 2
      if (r < rows && c < cols) {
        data[r][c] = { tilesetId: tilesetIds[b] || '', tileIndex }
      }
      c++
      if (c >= cols) { c = 0; r++ }
    }
  }

  return data
}

/**
 * Reconstruct a full project object from v2 sections.
 * Same output shape as v1 JSON / decodeAxonV2.
 */
export interface V2Sections {
  version?: number
  metadataJson: string
  blobTable: ArrayBuffer
  tileSections: { index: number; data: ArrayBuffer }[]
  presetTileSections?: { index: number; data: ArrayBuffer }[]
}

export function reconstructFromSections(sections: V2Sections): any {
  const { metadataJson, blobTable: blobTableBuf, tileSections } = sections
  const presetTileSections = sections.presetTileSections || []
  const metadata = JSON.parse(metadataJson)
  const version: number = metadata.version ?? 2
  const blobs = blobTableBuf.byteLength > 0
    ? decodeBlobTable(new Uint8Array(blobTableBuf))
    : []

  // Build tileset ID list
  const tilesetIds = [''] // index 0 = empty
  for (const ts of metadata.tilesets || []) tilesetIds.push(ts.id)

  // Index tile sections by layer index
  const tileMap = new Map<number, ArrayBuffer>()
  for (const s of tileSections) tileMap.set(s.index, s.data)
  const presetTileMap = new Map<number, ArrayBuffer>()
  for (const s of presetTileSections) presetTileMap.set(s.index, s.data)

  function decodeGrid(buf: ArrayBuffer): any[][] {
    return version >= 3
      ? decodeTileGridV3(new Uint8Array(buf), tilesetIds)
      : decodeTileGridV2(new Uint8Array(buf), tilesetIds)
  }

  // Reconstruct layers
  const layers = (metadata.layers || []).map((l: any) => {
    if (l.type === 'tile') {
      const tileBuf = tileMap.get(l.tileDataSection)
      if (!tileBuf) throw new Error(`Missing tile data for section ${l.tileDataSection}`)
      const data = decodeGrid(tileBuf)
      return { type: 'tile', id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, data }
    }
    if (l.type === 'object') {
      return {
        ...l,
        objects: (l.objects || []).map((o: any) => ({
          ...o, imageDataUrl: blobToDataUrl(blobs, o.imageIndex), imageIndex: undefined
        }))
      }
    }
    if (l.type === 'drawing') {
      return {
        ...l,
        objects: (l.objects || []).map((o: any) => ({
          ...o, imageDataUrl: blobToDataUrl(blobs, o.imageIndex), imageIndex: undefined
        }))
      }
    }
    if (l.type === 'image') {
      return { ...l, imageDataUrl: blobToDataUrl(blobs, l.imageIndex), imageIndex: undefined }
    }
    return l
  })

  // Reconstruct tilesets
  const tilesets = (metadata.tilesets || []).map((ts: any) => {
    const out: any = { ...ts }
    if (ts.imageIndex !== undefined && ts.imageIndex >= 0) {
      out.imageDataUrl = blobToDataUrl(blobs, ts.imageIndex)
      delete out.imageIndex
    }
    return out
  })

  // Reconstruct object library
  const objectLibrary = (metadata.objectLibrary || []).map((o: any) => ({
    ...o, imageDataUrl: blobToDataUrl(blobs, o.imageIndex), imageIndex: undefined
  }))

  // Reconstruct presets
  const presets = (metadata.presets || []).map((p: any) => ({
    ...p,
    tileLayers: (p.tileLayers || []).map((tl: any) => {
      // v3 keeps preset tiles in their own sections; v2 inlined them as JSON.
      if (tl.tileDataSection === undefined) return tl
      const buf = presetTileMap.get(tl.tileDataSection)
      if (!buf) throw new Error(`Missing preset tile data for section ${tl.tileDataSection}`)
      return { name: tl.name, tiles: decodeGrid(buf) }
    }),
    objects: (p.objects || []).map((o: any) => ({
      ...o, imageDataUrl: blobToDataUrl(blobs, o.imageIndex), imageIndex: undefined
    })),
    thumbnail: p.thumbnailIndex !== undefined ? blobToDataUrl(blobs, p.thumbnailIndex) : undefined,
    thumbnailIndex: undefined
  }))

  return {
    version: 1,
    config: metadata.config,
    layers,
    tilesets,
    activeLayerId: metadata.activeLayerId,
    camera: metadata.camera,
    objectLibrary,
    presets
  }
}
