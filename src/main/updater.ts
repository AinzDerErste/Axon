import { autoUpdater } from 'electron-updater'
import { BrowserWindow, ipcMain } from 'electron'

let mainWin: BrowserWindow | null = null

export function initUpdater(win: BrowserWindow): void {
  mainWin = win

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

  // Register IPC handlers
  ipcMain.handle('updater:check', () => {
    autoUpdater.checkForUpdates()
  })

  ipcMain.handle('updater:download', () => {
    autoUpdater.downloadUpdate()
  })

  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall()
  })

  // Auto-check 3 seconds after launch
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // Silently fail (e.g. no internet)
    })
  }, 3000)
}
