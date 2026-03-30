import { ipcMain, dialog, BrowserWindow, app, type GPUFeatureStatus } from 'electron'
import * as os from 'os'
import * as path from 'path'
import { readFile, writeFile, appendFile, mkdir, readdir, stat } from 'fs/promises'
import { statSync } from 'fs'
import { detectFormat, decodeAxonV2, encodeAxonV2, extractV2Sections } from './axon-v2-codec'

export function registerIpcHandlers(): void {
  ipcMain.handle('dialog:showOpen', async (_event, options) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return undefined
    const result = await dialog.showOpenDialog(win, options)
    if (result.canceled) return undefined
    return result.filePaths
  })

  ipcMain.handle('dialog:showSave', async (_event, options) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return undefined
    const result = await dialog.showSaveDialog(win, options)
    if (result.canceled) return undefined
    return result.filePath
  })

  ipcMain.handle('file:read', async (_event, path: string) => {
    const data = await readFile(path, 'utf-8')
    return data
  })

  /** Return file size in bytes (used by renderer to skip auto-reload on huge files). */
  ipcMain.handle('file:size', async (_event, filePath: string) => {
    try {
      const s = statSync(filePath)
      return s.size
    } catch {
      return -1
    }
  })

  /**
   * Read a project file by parsing it in the main process (avoids renderer
   * string-length limits). Uses a worker thread so the main process stays
   * responsive during parsing of very large files.
   */
  ipcMain.handle('file:readProjectParsed', async (_event, filePath: string) => {
    const t0 = Date.now()
    const buf = await readFile(filePath) // Buffer (no encoding — avoids V8 string limit)
    const readMs = Date.now() - t0

    // v2 binary format — send decompressed sections as ArrayBuffers for fast IPC
    if (detectFormat(buf) === 2) {
      const sections = extractV2Sections(buf)
      return { __format: 'v2-sections', sections, bytes: buf.length, readMs }
    }

    // v1 JSON: return raw string for renderer to parse (avoids slow structured clone
    // of deeply nested objects). Only parse in main for files > 400MB (V8 string limit).
    if (buf.length < 400 * 1024 * 1024) {
      return { __format: 'json', json: buf.toString('utf-8'), bytes: buf.length, readMs }
    }

    // For very large v1 files: stream-parse the buffer, try stringify
    const project = parseProjectBuffer(buf)
    try {
      return { __format: 'json', json: JSON.stringify(project), bytes: buf.length, readMs }
    } catch {
      return { __format: 'parsed', project, bytes: buf.length, readMs }
    }
  })

  ipcMain.handle('file:write', async (_event, path: string, data: string) => {
    // If data is a base64 data URL, write as binary
    if (data.startsWith('data:')) {
      const base64 = data.split(',')[1]
      await writeFile(path, Buffer.from(base64, 'base64'))
    } else {
      await writeFile(path, data, 'utf-8')
    }
  })

  /** Truncate and start a chunked UTF-8 project save (see file:saveProjectAppend). */
  ipcMain.handle('file:saveProjectInit', async (_event, filePath: string) => {
    await writeFile(filePath, '', 'utf-8')
  })

  ipcMain.handle('file:saveProjectAppend', async (_event, filePath: string, chunk: string) => {
    await appendFile(filePath, chunk, 'utf-8')
  })

  /** Save project in v2 binary format. Receives the full project object via IPC. */
  ipcMain.handle('file:saveProjectV2', async (_event, filePath: string, project: any) => {
    const buf = encodeAxonV2(project)
    await writeFile(filePath, buf)
    return buf.length
  })

  ipcMain.handle('file:readImages', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return []
    const result = await dialog.showOpenDialog(win, {
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return []

    const files: { data: string; name: string }[] = []
    for (const filePath of result.filePaths) {
      const buffer = await readFile(filePath)
      const ext = filePath.split('.').pop()?.toLowerCase() || 'png'
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'webp' ? 'image/webp'
        : ext === 'gif' ? 'image/gif'
        : 'image/png'
      const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`
      const name = filePath.replace(/\\/g, '/').split('/').pop() || 'tile.png'
      files.push({ data: dataUrl, name })
    }
    return files
  })

  ipcMain.handle('file:ensureDir', async (_event, dirPath: string) => {
    await mkdir(dirPath, { recursive: true })
  })

  ipcMain.handle('file:readSpritesheet', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return undefined
    const result = await dialog.showOpenDialog(win, {
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return undefined

    const filePath = result.filePaths[0]
    const buffer = await readFile(filePath)
    const ext = filePath.split('.').pop()?.toLowerCase() || 'png'
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
    const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`
    const name = filePath.replace(/\\/g, '/').split('/').pop() || 'spritesheet.png'
    return { data: dataUrl, name }
  })

  ipcMain.handle('window:setTitle', async (_event, title: string) => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) win.setTitle(title)
  })

  ipcMain.handle('window:minimize', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) win.minimize()
  })

  ipcMain.handle('window:maximize', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    }
  })

  ipcMain.handle('window:close', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) win.close()
  })

  ipcMain.handle('window:isMaximized', async () => {
    const win = BrowserWindow.getFocusedWindow()
    return win ? win.isMaximized() : false
  })

  // System metrics
  let lastCpuTimes: { idle: number; total: number } | null = null

  function getCpuUsage(): number {
    const cpus = os.cpus()
    let idle = 0, total = 0
    for (const cpu of cpus) {
      idle += cpu.times.idle
      total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle
    }
    if (lastCpuTimes) {
      const idleDiff = idle - lastCpuTimes.idle
      const totalDiff = total - lastCpuTimes.total
      lastCpuTimes = { idle, total }
      return totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0
    }
    lastCpuTimes = { idle, total }
    return 0
  }

  ipcMain.handle('system:getMetrics', async () => {
    const metrics = app.getAppMetrics()
    // Sum memory across all Electron processes
    let appMemoryMB = 0
    for (const m of metrics) {
      appMemoryMB += m.memory.workingSetSize / 1024
    }

    const totalMemMB = Math.round(os.totalmem() / (1024 * 1024))
    const freeMemMB = Math.round(os.freemem() / (1024 * 1024))
    const usedMemMB = totalMemMB - freeMemMB

    const cpuPercent = getCpuUsage()

    // GPU memory from GPU process in app metrics
    let gpuMemMB = 0
    for (const m of metrics) {
      if (m.type === 'GPU') {
        gpuMemMB = Math.round(m.memory.workingSetSize / 1024)
      }
    }

    return {
      cpuPercent,
      appMemoryMB: Math.round(appMemoryMB),
      systemMemUsedMB: usedMemMB,
      systemMemTotalMB: totalMemMB,
      gpuMemMB
    }
  })

  // GPU feature status
  ipcMain.handle('gpu:getStatus', async () => {
    try {
      const features = app.getGPUFeatureStatus()
      const gpuInfo: any = await app.getGPUInfo('basic')
      const devices: { vendorId: number; deviceId: number; description?: string }[] =
        gpuInfo?.gpuDevice ?? []
      const gpuName = devices[0]?.description || undefined

      const gpuAccelerated =
        features.gpu_compositing === 'enabled' ||
        features.gpu_compositing === 'enabled_on'

      return {
        accelerated: gpuAccelerated,
        gpuName,
        features: {
          compositing: features.gpu_compositing,
          canvas: (features as any)['canvas_oop_rasterization'] ?? (features as any)['2d_canvas'] ?? 'unknown',
          rasterization: features.gpu_rasterization,
          webgl: features.webgl,
          webgl2: features.webgl2
        }
      }
    } catch {
      return { accelerated: false, features: {} }
    }
  })

  // ── Folder operations for asset watching ──

  ipcMain.handle('folder:select', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return undefined
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return undefined
    return result.filePaths[0]
  })

  const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

  /** Lightweight metadata scan — returns file names + modification times (no image data) */
  ipcMain.handle('folder:scanImageMeta', async (_event, folderPath: string) => {
    try {
      const entries = await readdir(folderPath)
      const results: { name: string; filePath: string; mtimeMs: number }[] = []
      for (const entry of entries) {
        const ext = path.extname(entry).toLowerCase()
        if (!IMAGE_EXTS.has(ext)) continue
        try {
          const filePath = path.join(folderPath, entry)
          const s = await stat(filePath)
          if (!s.isFile()) continue
          results.push({ name: entry, filePath, mtimeMs: s.mtimeMs })
        } catch { /* skip unreadable files */ }
      }
      return results
    } catch {
      return []
    }
  })

  /** Read a single image file by absolute path, return base64 data URL */
  ipcMain.handle('folder:readImageFile', async (_event, filePath: string) => {
    try {
      const buffer = await readFile(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
        : ext === '.webp' ? 'image/webp'
        : ext === '.gif' ? 'image/gif'
        : 'image/png'
      const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`
      const name = path.basename(filePath)
      return { data: dataUrl, name }
    } catch {
      return null
    }
  })
}

// ── Large-file project parser ──────────────────────────────────────────────

const CHAR_LBRACE = 0x7B    // {
const CHAR_RBRACE = 0x7D    // }
const CHAR_LBRACKET = 0x5B  // [
const CHAR_RBRACKET = 0x5D  // ]
const CHAR_QUOTE = 0x22     // "
const CHAR_BACKSLASH = 0x5C // \
const CHAR_COLON = 0x3A     // :
const CHAR_COMMA = 0x2C     // ,

/**
 * Find the end position of a JSON value starting at `start` in the buffer.
 * Returns the index AFTER the last byte of the value.
 * Handles nested objects, arrays, strings, and primitives.
 */
function findValueEnd(buf: Buffer, start: number): number {
  const b = buf[start]

  // String
  if (b === CHAR_QUOTE) {
    let i = start + 1
    while (i < buf.length) {
      if (buf[i] === CHAR_BACKSLASH) { i += 2; continue }
      if (buf[i] === CHAR_QUOTE) return i + 1
      i++
    }
    return buf.length
  }

  // Object or Array
  if (b === CHAR_LBRACE || b === CHAR_LBRACKET) {
    const close = b === CHAR_LBRACE ? CHAR_RBRACE : CHAR_RBRACKET
    let depth = 1
    let i = start + 1
    while (i < buf.length && depth > 0) {
      const c = buf[i]
      if (c === CHAR_QUOTE) {
        // Skip string contents
        i++
        while (i < buf.length) {
          if (buf[i] === CHAR_BACKSLASH) { i += 2; continue }
          if (buf[i] === CHAR_QUOTE) break
          i++
        }
      } else if (c === b) {
        depth++
      } else if (c === close) {
        depth--
      }
      i++
    }
    return i
  }

  // Primitive (number, true, false, null)
  let i = start
  while (i < buf.length) {
    const c = buf[i]
    if (c === CHAR_COMMA || c === CHAR_RBRACE || c === CHAR_RBRACKET) return i
    i++
  }
  return i
}

/**
 * Parse a large project Buffer without ever creating the full string.
 * Extracts top-level fields individually, parses arrays element-by-element.
 */
function parseProjectBuffer(buf: Buffer): any {
  const MAX_SUBSTR = 300 * 1024 * 1024 // 300 MB safe limit for substrings

  // Helper: safely convert a buffer region to string and JSON.parse it
  function parseSlice(from: number, to: number): any {
    const len = to - from
    if (len <= MAX_SUBSTR) {
      return JSON.parse(buf.toString('utf-8', from, to))
    }
    // Shouldn't happen for individual elements, but fallback:
    throw new RangeError(`Single JSON element too large: ${(len / 1024 / 1024).toFixed(0)} MB`)
  }

  // Helper: parse a JSON array element-by-element
  function parseArrayElements(arrStart: number, arrEnd: number): any[] {
    const result: any[] = []
    let i = arrStart + 1 // skip '['
    // Skip whitespace
    while (i < arrEnd && (buf[i] === 0x20 || buf[i] === 0x0A || buf[i] === 0x0D || buf[i] === 0x09)) i++
    if (buf[i] === CHAR_RBRACKET) return result

    while (i < arrEnd) {
      // Skip whitespace
      while (i < arrEnd && (buf[i] === 0x20 || buf[i] === 0x0A || buf[i] === 0x0D || buf[i] === 0x09)) i++
      if (i >= arrEnd || buf[i] === CHAR_RBRACKET) break

      const elemEnd = findValueEnd(buf, i)
      result.push(parseSlice(i, elemEnd))
      i = elemEnd

      // Skip whitespace and comma
      while (i < arrEnd && (buf[i] === 0x20 || buf[i] === 0x0A || buf[i] === 0x0D || buf[i] === 0x09)) i++
      if (buf[i] === CHAR_COMMA) i++
    }
    return result
  }

  // Parse the top-level object key by key
  const project: any = {}
  let i = 0

  // Skip to opening brace
  while (i < buf.length && buf[i] !== CHAR_LBRACE) i++
  i++ // skip '{'

  while (i < buf.length) {
    // Skip whitespace
    while (i < buf.length && (buf[i] === 0x20 || buf[i] === 0x0A || buf[i] === 0x0D || buf[i] === 0x09)) i++
    if (buf[i] === CHAR_RBRACE) break

    // Parse key
    if (buf[i] !== CHAR_QUOTE) break
    const keyEnd = findValueEnd(buf, i)
    const key = parseSlice(i, keyEnd) as string
    i = keyEnd

    // Skip whitespace + colon
    while (i < buf.length && buf[i] !== CHAR_COLON) i++
    i++ // skip ':'
    while (i < buf.length && (buf[i] === 0x20 || buf[i] === 0x0A || buf[i] === 0x0D || buf[i] === 0x09)) i++

    const valEnd = findValueEnd(buf, i)
    const valLen = valEnd - i

    if (key === 'layers' || key === 'tilesets' || key === 'objectLibrary' || key === 'presets') {
      // Parse large arrays element-by-element
      project[key] = parseArrayElements(i, valEnd)
    } else if (valLen > MAX_SUBSTR) {
      // Single value too large — shouldn't happen for config/version/etc
      throw new RangeError(`Field "${key}" is too large: ${(valLen / 1024 / 1024).toFixed(0)} MB`)
    } else {
      project[key] = parseSlice(i, valEnd)
    }

    i = valEnd
    // Skip whitespace + comma
    while (i < buf.length && (buf[i] === 0x20 || buf[i] === 0x0A || buf[i] === 0x0D || buf[i] === 0x09)) i++
    if (buf[i] === CHAR_COMMA) i++
  }

  return project
}
