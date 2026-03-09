import { contextBridge, ipcRenderer, shell } from 'electron'

const electronAPI = {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  showOpenDialog: (options: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke('dialog:showOpen', options),
  showSaveDialog: (options: Electron.SaveDialogOptions) =>
    ipcRenderer.invoke('dialog:showSave', options),
  readFile: (path: string) =>
    ipcRenderer.invoke('file:read', path),
  writeFile: (path: string, data: string) =>
    ipcRenderer.invoke('file:write', path, data),
  ensureDir: (path: string) =>
    ipcRenderer.invoke('file:ensureDir', path),
  readImageFiles: () =>
    ipcRenderer.invoke('file:readImages'),
  readSpritesheetFile: () =>
    ipcRenderer.invoke('file:readSpritesheet'),
  setTitle: (title: string) =>
    ipcRenderer.invoke('window:setTitle', title),
  onMenuAction: (callback: (action: string) => void) => {
    ipcRenderer.on('menu:action', (_event, action) => callback(action))
  },
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximizedChange: (callback: (maximized: boolean) => void) => {
    ipcRenderer.on('window:maximized-changed', (_event, maximized) => callback(maximized))
  },
  getSystemMetrics: () => ipcRenderer.invoke('system:getMetrics'),
  selectFolder: () => ipcRenderer.invoke('folder:select') as Promise<string | undefined>,
  scanImageMeta: (folderPath: string) =>
    ipcRenderer.invoke('folder:scanImageMeta', folderPath) as Promise<{ name: string; filePath: string; mtimeMs: number }[]>,
  readImageFile: (filePath: string) =>
    ipcRenderer.invoke('folder:readImageFile', filePath) as Promise<{ data: string; name: string } | null>,

  // GPU info
  getGpuStatus: () => ipcRenderer.invoke('gpu:getStatus') as Promise<{
    accelerated: boolean
    gpuName?: string
    features: Record<string, string>
  }>,

  // Auto-update API
  getAppVersion: () => ipcRenderer.invoke('app:getVersion') as Promise<string>,
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdateAvailable: (callback: (info: { version: string; releaseNotes: string }) => void) => {
    ipcRenderer.on('updater:update-available', (_event, info) => callback(info))
  },
  onUpdateNotAvailable: (callback: () => void) => {
    ipcRenderer.on('updater:update-not-available', () => callback())
  },
  onDownloadProgress: (callback: (progress: { percent: number }) => void) => {
    ipcRenderer.on('updater:download-progress', (_event, progress) => callback(progress))
  },
  onUpdateDownloaded: (callback: () => void) => {
    ipcRenderer.on('updater:update-downloaded', () => callback())
  },
  onUpdateError: (callback: (message: string) => void) => {
    ipcRenderer.on('updater:error', (_event, message) => callback(message))
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
