export interface AppSettings {
  maxUndo: number
  autosaveEnabled: boolean
  /** Autosave interval in minutes */
  autosaveInterval: number
  /** Show confirmation popup when flood fill exceeds this many tiles (0 = disabled) */
  fillWarningThreshold: number
  /** Zoom level (%) to apply when jumping to a selection (0 = keep current zoom) */
  jumpToZoom: number
  /** Watched folders for auto-importing object images */
  objectWatchFolders: string[]
  /** Watched folders for auto-importing tile images */
  tileWatchFolders: string[]
}

const STORAGE_KEY = 'app-settings'

const defaults: AppSettings = {
  maxUndo: 100,
  autosaveEnabled: false,
  autosaveInterval: 5,
  fillWarningThreshold: 1000,
  jumpToZoom: 100,
  objectWatchFolders: [],
  tileWatchFolders: []
}

let settings: AppSettings = loadSettings()
let listeners: Array<() => void> = []

function notify() {
  for (const fn of listeners) fn()
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return { ...defaults, ...parsed }
    }
  } catch { /* ignore */ }
  return { ...defaults }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export function subscribe(fn: () => void): () => void {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter(l => l !== fn)
  }
}

export function getSettings(): AppSettings {
  return settings
}

export function updateSettings(updates: Partial<AppSettings>): void {
  settings = { ...settings, ...updates }
  persist()
  notify()
}
