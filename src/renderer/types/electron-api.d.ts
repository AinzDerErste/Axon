interface ElectronAPI {
  showOpenDialog(options: { filters?: { name: string; extensions: string[] }[]; properties?: string[] }): Promise<string[] | undefined>
  showSaveDialog(options: { filters?: { name: string; extensions: string[] }[]; defaultPath?: string }): Promise<string | undefined>
  readFile(path: string): Promise<string>
  readProjectParsed(path: string): Promise<any>
  fileSize(path: string): Promise<number>
  writeFile(path: string, data: string): Promise<void>
  saveProjectInit(path: string): Promise<void>
  saveProjectAppend(path: string, chunk: string): Promise<void>
  saveProjectV2(path: string, project: any): Promise<number>
  readImageFiles(): Promise<{ data: string; name: string }[]>
  readSpritesheetFile(): Promise<{ data: string; name: string } | undefined>
  setTitle(title: string): Promise<void>
  onMenuAction(callback: (action: string) => void): void
  minimizeWindow(): Promise<void>
  maximizeWindow(): Promise<void>
  closeWindow(): Promise<void>
  isMaximized(): Promise<boolean>
  onMaximizedChange(callback: (maximized: boolean) => void): void
  getSystemMetrics(): Promise<{
    cpuPercent: number
    appMemoryMB: number
    systemMemUsedMB: number
    systemMemTotalMB: number
    gpuMemMB: number
  }>
  selectFolder(): Promise<string | undefined>
  scanImageMeta(folderPath: string): Promise<{ name: string; filePath: string; mtimeMs: number }[]>
  readImageFile(filePath: string): Promise<{ data: string; name: string } | null>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
