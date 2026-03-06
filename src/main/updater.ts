import { autoUpdater } from 'electron-updater'
import { BrowserWindow, ipcMain } from 'electron'

let mainWin: BrowserWindow | null = null
let updaterInitialized = false
let updaterIpcRegistered = false
let autoCheckScheduled = false

function registerUpdaterIpcHandlers(): void {
  if (updaterIpcRegistered) return
  updaterIpcRegistered = true

  ipcMain.handle('updater:check', async () => {
    await autoUpdater.checkForUpdates()
  })

  ipcMain.handle('updater:download', async () => {
    await autoUpdater.downloadUpdate()
  })

  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall()
  })
}

export function initUpdater(win: BrowserWindow): void {
  // Always point updater events to the latest active window.
  mainWin = win

  // Listener/IPC registration must only happen once per app lifecycle.
  if (updaterInitialized) return
  updaterInitialized = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    mainWin?.webContents.send('updater:update-available', {
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : ''
    })
  })

  autoUpdater.on('update-not-available', () => {
    mainWin?.webContents.send('updater:update-not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWin?.webContents.send('updater:download-progress', {
      percent: Math.round(progress.percent)
    })
  })

  autoUpdater.on('update-downloaded', () => {
    mainWin?.webContents.send('updater:update-downloaded')
  })

  autoUpdater.on('error', (err) => {
    mainWin?.webContents.send('updater:error', err?.message || 'Unknown error')
  })

  registerUpdaterIpcHandlers()

  // Auto-check 3 seconds after launch.
  if (!autoCheckScheduled) {
    autoCheckScheduled = true
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {
        // Silently fail (e.g. no internet)
      })
    }, 3000)
  }
}
