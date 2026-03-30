/**
 * Browser-side Axon v2 section decoder.
 * Reconstructs a project object from decompressed sections received via IPC.
 * No Node.js dependencies — works with Uint8Array/DataView only.
 */

const MIME_STRINGS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

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
  // Convert Uint8Array to base64
  let binary = ''
  for (let i = 0; i < b.bytes.length; i++) binary += String.fromCharCode(b.bytes[i])
  return `data:${mime};base64,${btoa(binary)}`
}

function decodeTileGrid(buf: Uint8Array, tilesetIds: string[]): any[][] {
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
export function reconstructFromSections(
  metadataJson: string,
  blobTableBuf: ArrayBuffer,
  tileSections: { index: number; data: ArrayBuffer }[]
): any {
  const metadata = JSON.parse(metadataJson)
  const blobs = blobTableBuf.byteLength > 0
    ? decodeBlobTable(new Uint8Array(blobTableBuf))
    : []

  // Build tileset ID list
  const tilesetIds = [''] // index 0 = empty
  for (const ts of metadata.tilesets || []) tilesetIds.push(ts.id)

  // Index tile sections by layer index
  const tileMap = new Map<number, ArrayBuffer>()
  for (const s of tileSections) tileMap.set(s.index, s.data)

  // Reconstruct layers
  const layers = (metadata.layers || []).map((l: any) => {
    if (l.type === 'tile') {
      const tileBuf = tileMap.get(l.tileDataSection)
      if (!tileBuf) throw new Error(`Missing tile data for section ${l.tileDataSection}`)
      const data = decodeTileGrid(new Uint8Array(tileBuf), tilesetIds)
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
