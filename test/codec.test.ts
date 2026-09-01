/**
 * Roundtrip tests for the .axon binary codec.
 *
 * Run with:  npm test
 * (node --experimental-strip-types, no build step, no Electron needed)
 */

import { encodeAxonV2, decodeAxonV2, detectFormat } from '../src/main/axon-v2-codec.ts'

let failures = 0

/** JSON.stringify with object keys in a stable order, so key order is not a diff. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : 1)))
      : val)
}

function check(name: string, expected: unknown, actual: unknown): void {
  const ok = stable(expected) === stable(actual)
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`)
  if (!ok) {
    failures++
    console.log(`      expected ${stable(expected).slice(0, 240)}`)
    console.log(`      actual   ${stable(actual).slice(0, 240)}`)
  }
}

function throws(name: string, fn: () => unknown, expectThrow: boolean): void {
  let threw = false
  let message = ''
  try { fn() } catch (e) { threw = true; message = (e as Error).message }
  const ok = threw === expectThrow
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`)
  if (!ok) {
    failures++
    console.log(`      ${expectThrow ? 'expected a throw, got none' : 'unexpected throw: ' + message}`)
  }
}

function grid(rows: number, cols: number, fn: (r: number, c: number) => unknown): any[][] {
  const g: any[][] = []
  for (let r = 0; r < rows; r++) {
    const row: unknown[] = []
    for (let c = 0; c < cols; c++) row.push(fn(r, c))
    g.push(row as any[])
  }
  return g
}

function tileset(id: string) {
  return { id, name: id, tileWidth: 32, tileHeight: 32, columns: 4, tiles: [], sourcePath: `/${id}.png` }
}

function project(tilesets: any[], data: any[][]) {
  return {
    version: 1,
    config: { name: 'test', cols: data[0].length, rows: data.length, tileSize: 32 },
    layers: [{ type: 'tile', id: 'L1', name: 'Tiles', visible: true, opacity: 1, data }],
    tilesets,
    activeLayerId: 'L1',
    camera: { x: 12, y: 34, zoom: 2 },
    objectLibrary: [],
    presets: []
  }
}

function roundtrip(p: any): any {
  return decodeAxonV2(encodeAxonV2(p))
}

function png(bytes: Buffer): string {
  return 'data:image/png;base64,' + bytes.toString('base64')
}

// ── Tile grid ──

{
  const ts = [tileset('ts1')]
  const data = grid(4, 4, (r, c) => ((r + c) % 2 ? { tilesetId: 'ts1', tileIndex: r * 4 + c } : null))
  check('tile grid survives a roundtrip', data, roundtrip(project(ts, data)).layers[0].data)
}

{
  // A tile pointing at a deleted tileset must not shift the rest of the grid.
  const ts = [tileset('ts1')]
  const data = grid(3, 3, (r, c) =>
    r === 1 && c === 1 ? { tilesetId: 'DELETED', tileIndex: 7 }
      : r === 2 && c === 2 ? { tilesetId: 'ts1', tileIndex: 3 }
        : null)
  const expected = grid(3, 3, (r, c) => (r === 2 && c === 2 ? { tilesetId: 'ts1', tileIndex: 3 } : null))
  check('orphan tilesetId does not shift the grid', expected, roundtrip(project(ts, data)).layers[0].data)
}

{
  const ts = Array.from({ length: 400 }, (_, i) => tileset('ts' + (i + 1)))
  const data = grid(1, 2, (_r, c) => (c === 0 ? { tilesetId: 'ts400', tileIndex: 1 } : null))
  check('more than 255 tilesets', data, roundtrip(project(ts, data)).layers[0].data)
}

{
  const ts = [tileset('ts1')]
  const data = grid(1, 70000, (_r, c) => (c === 0 ? { tilesetId: 'ts1', tileIndex: 1 } : null))
  check('grid wider than 65535 columns', 70000, roundtrip(project(ts, data)).layers[0].data[0].length)
}

{
  const ts = [tileset('ts1')]
  const data = grid(300, 300, (r, c) => (r === 299 && c === 299 ? { tilesetId: 'ts1', tileIndex: 5 } : null))
  check('empty run longer than 65535 cells', data, roundtrip(project(ts, data)).layers[0].data)
}

{
  const ts = [tileset('ts1')]
  const data = grid(1, 1, () => ({ tilesetId: 'ts1', tileIndex: 70000 }))
  throws('tile index out of range is reported, not silently written', () => encodeAxonV2(project(ts, data)), true)
}

// ── Images ──

{
  // Same length, same first 64 and last 32 bytes — the old fingerprint collided.
  const mk = (mid: number) => { const b = Buffer.alloc(200, 0xAA); b[100] = mid; return png(b) }
  const p = {
    version: 1,
    config: { name: 'test' },
    layers: [
      { type: 'image', id: 'I1', name: 'a', visible: true, opacity: 1, imageDataUrl: mk(1), x: 0, y: 0, width: 1, height: 1 },
      { type: 'image', id: 'I2', name: 'b', visible: true, opacity: 1, imageDataUrl: mk(2), x: 0, y: 0, width: 1, height: 1 }
    ],
    tilesets: [], activeLayerId: 'I1', camera: {}, objectLibrary: [], presets: []
  }
  const out = roundtrip(p)
  check('near-identical images are not deduplicated into one',
    [p.layers[0].imageDataUrl, p.layers[1].imageDataUrl],
    [out.layers[0].imageDataUrl, out.layers[1].imageDataUrl])
}

{
  const shared = png(Buffer.alloc(64, 7))
  const p = {
    version: 1,
    config: { name: 'test' },
    layers: [
      { type: 'image', id: 'I1', name: 'a', visible: true, opacity: 1, imageDataUrl: shared, x: 0, y: 0, width: 1, height: 1 },
      { type: 'image', id: 'I2', name: 'b', visible: true, opacity: 1, imageDataUrl: shared, x: 0, y: 0, width: 1, height: 1 }
    ],
    tilesets: [], activeLayerId: 'I1', camera: {}, objectLibrary: [], presets: []
  }
  const encoded = encodeAxonV2(p)
  const twice = encodeAxonV2({ ...p, layers: [p.layers[0]] })
  check('identical images are still deduplicated', true, encoded.length < twice.length + 200)
}

// ── Metadata ──

{
  const p = {
    version: 1,
    config: { name: 'test' },
    layers: [], tilesets: [], activeLayerId: null, camera: { x: 5, y: 6, zoom: 3 },
    objectLibrary: [{ id: 'o1', name: 'tree', imageDataUrl: png(Buffer.alloc(20, 1)), width: 32, height: 32, category: 'nature', tags: ['x'] }],
    presets: []
  }
  const out = roundtrip(p)
  check('object library keeps all of its fields', p.objectLibrary[0], out.objectLibrary[0])
  check('camera is carried through', p.camera, out.camera)
}

// ── Presets ──

{
  const ts = [tileset('ts1')]
  const tiles = grid(8, 8, (r, c) => ((r + c) % 3 === 0 ? { tilesetId: 'ts1', tileIndex: r * 8 + c } : null))
  const p = {
    version: 1,
    config: { name: 'test' },
    layers: [], tilesets: ts, activeLayerId: null, camera: {},
    objectLibrary: [],
    presets: [{
      id: 'p1', name: 'house', width: 8, height: 8,
      tileLayers: [{ name: 'base', tiles }],
      objects: [{ name: 'door', imageDataUrl: png(Buffer.alloc(24, 3)), relX: 1, relY: 2, width: 8, height: 8, flipX: true, rotation: 90 }],
      zones: [{ name: 'z', color: '#fff', points: [{ relX: 0, relY: 0 }], closed: true }],
      thumbnail: png(Buffer.alloc(30, 4))
    }]
  }
  const out = roundtrip(p)
  check('preset tile layers survive a roundtrip', tiles, out.presets[0].tileLayers[0].tiles)
  check('preset tile layer keeps its name', 'base', out.presets[0].tileLayers[0].name)
  check('preset objects keep all of their fields', p.presets[0].objects[0], out.presets[0].objects[0])
  check('preset zones survive', p.presets[0].zones, out.presets[0].zones)
  check('preset thumbnail survives', p.presets[0].thumbnail, out.presets[0].thumbnail)
}

{
  // Preset tiles used to be written as raw nested JSON, one object per cell.
  const ts = [tileset('ts1')]
  const tiles = grid(120, 120, (r, c) => ((r * c) % 7 === 0 ? { tilesetId: 'ts1', tileIndex: (r + c) % 64 } : null))
  const p = {
    version: 1,
    config: { name: 'test' },
    layers: [], tilesets: ts, activeLayerId: null, camera: {},
    objectLibrary: [],
    presets: [{ id: 'p1', name: 'big', width: 120, height: 120, tileLayers: [{ name: 'base', tiles }], objects: [], zones: [] }]
  }
  const encoded = encodeAxonV2(p)
  const asJson = Buffer.byteLength(JSON.stringify(p), 'utf-8')
  check('a preset-heavy project stays far below its JSON size', true, encoded.length < asJson / 20)
  check('preset tiles still decode after compaction', tiles, roundtrip(p).presets[0].tileLayers[0].tiles)
}

// ── Format ──

{
  const ts = [tileset('ts1')]
  const data = grid(2, 2, () => null)
  const buf = encodeAxonV2(project(ts, data))
  check('magic marks the file as v2/v3 binary', 2, detectFormat(buf))
  check('header version is 3', 3, buf.readUInt16LE(4))
}

console.log('')
if (failures > 0) {
  console.log(`${failures} test(s) failed`)
  process.exit(1)
}
console.log('all codec tests passed')
