import { contextBridge, ipcRenderer } from 'electron'

const electronAPI = {
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
    ipcRenderer.invoke('folder:readImageFile', filePath) as Promise<{ data: string; name: string } | null>
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
