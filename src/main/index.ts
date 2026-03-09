import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc-handlers'
import { createAppMenu } from './menu'
import { initUpdater } from './updater'

// GPU acceleration flags — must be set before app.ready
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-accelerated-2d-canvas')
app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization')

function createWindow(): BrowserWindow {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../build/icon.png')

  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    title: 'Axon',
    backgroundColor: '#1e1e2e',
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !app.isPackaged
    }
  })

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximized-changed', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximized-changed', false)
  })

  mainWindow.on('unresponsive', () => {
    console.warn('[main] Renderer became unresponsive')
  })
  mainWindow.on('responsive', () => {
    console.info('[main] Renderer is responsive again')
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[main] Render process gone:', details.reason)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createAppMenu()

  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('shell:openExternal', (_event, url: string) => shell.openExternal(url))

  const win = createWindow()

  if (app.isPackaged) {
    initUpdater(win)
  } else {
    // Dev mode: register stub handlers so IPC calls don't throw
    ipcMain.handle('updater:check', () => {
      win.webContents.send('updater:update-not-available')
    })
    ipcMain.handle('updater:download', () => {})
    ipcMain.handle('updater:install', () => {})
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWin = createWindow()
      if (app.isPackaged) initUpdater(newWin)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
