import { autoUpdater } from 'electron-updater'
import { BrowserWindow, ipcMain, shell } from 'electron'
import { RELEASES_URL } from '../shared/app-links'

/**
 * True when running from the portable build.
 *
 * electron-builder's portable wrapper sets this at runtime; it is empty in the
 * installed build. There is no portable update target in electron-builder, and
 * latest.yml points `path` at the NSIS installer — so letting a portable user
 * run the updater would silently install the app into AppData and leave the
 * portable exe they launched sitting at the old version, offering the same
 * update again on every start.
 */
function isPortable(): boolean {
  return Boolean(process.env.PORTABLE_EXECUTABLE_FILE)
}

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
    if (isPortable()) return
    await autoUpdater.downloadUpdate()
  })

  ipcMain.handle('updater:install', () => {
    if (isPortable()) return
    autoUpdater.quitAndInstall()
  })

  /** Portable builds send the user to the download page instead of self-updating. */
  ipcMain.handle('updater:openReleasePage', async () => {
    await shell.openExternal(RELEASES_URL)
  })
}

export function initUpdater(win: BrowserWindow): void {
  // Always point updater events to the latest active window.
  mainWin = win

  // Listener/IPC registration must only happen once per app lifecycle.
  if (updaterInitialized) return
  updaterInitialized = true

  const portable = isPortable()

  autoUpdater.autoDownload = false
  // A finished download would otherwise run the NSIS installer on quit, even
  // without the user pressing anything.
  autoUpdater.autoInstallOnAppQuit = !portable

  autoUpdater.on('update-available', (info) => {
    mainWin?.webContents.send('updater:update-available', {
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : '',
      // The renderer offers a download link instead of an install button when
      // this build cannot update itself.
      canInstall: !portable
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
