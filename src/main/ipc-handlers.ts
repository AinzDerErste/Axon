import { ipcMain, dialog, BrowserWindow, app, type GPUFeatureStatus } from 'electron'
import * as os from 'os'
import * as path from 'path'
import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises'

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

  ipcMain.handle('file:write', async (_event, path: string, data: string) => {
    // If data is a base64 data URL, write as binary
    if (data.startsWith('data:')) {
      const base64 = data.split(',')[1]
      await writeFile(path, Buffer.from(base64, 'base64'))
    } else {
      await writeFile(path, data, 'utf-8')
    }
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
