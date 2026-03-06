export interface KeyBinding {
  id: string
  label: string
  category: 'Tools' | 'Canvas'
  key: string
  defaultKey: string
}

const STORAGE_KEY = 'keybindings'

const defaultBindings: KeyBinding[] = [
  // Tools
  { id: 'tool.paint', label: 'Paint', category: 'Tools', key: 'b', defaultKey: 'b' },
  { id: 'tool.eraser', label: 'Eraser', category: 'Tools', key: 'e', defaultKey: 'e' },
  { id: 'tool.fill', label: 'Fill', category: 'Tools', key: 'g', defaultKey: 'g' },
  { id: 'tool.select', label: 'Select', category: 'Tools', key: 's', defaultKey: 's' },
  { id: 'tool.object', label: 'Object', category: 'Tools', key: 'o', defaultKey: 'o' },
  { id: 'tool.zone', label: 'Zone', category: 'Tools', key: 'z', defaultKey: 'z' },
  { id: 'tool.collision', label: 'Collision', category: 'Tools', key: 'c', defaultKey: 'c' },
  { id: 'tool.sketch', label: 'Sketch', category: 'Tools', key: 'k', defaultKey: 'k' },
  // Canvas
  { id: 'canvas.copy', label: 'Copy', category: 'Canvas', key: 'ctrl+c', defaultKey: 'ctrl+c' },
  { id: 'canvas.paste', label: 'Paste', category: 'Canvas', key: 'ctrl+v', defaultKey: 'ctrl+v' },
  { id: 'canvas.duplicate', label: 'Duplicate', category: 'Canvas', key: 'ctrl+d', defaultKey: 'ctrl+d' },
  { id: 'canvas.delete', label: 'Delete', category: 'Canvas', key: 'delete', defaultKey: 'delete' },
  { id: 'canvas.pan', label: 'Pan (hold)', category: 'Canvas', key: 'space', defaultKey: 'space' },
]

let bindings: KeyBinding[] = loadBindings()
let listeners: Array<() => void> = []

function notify(): void {
  for (const fn of listeners) fn()
}

function loadBindings(): KeyBinding[] {
  const result = defaultBindings.map(b => ({ ...b }))
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const overrides: Record<string, string> = JSON.parse(raw)
      for (const b of result) {
        if (overrides[b.id]) b.key = overrides[b.id]
      }
    }
  } catch { /* ignore */ }
  return result
}

function persist(): void {
  const overrides: Record<string, string> = {}
  for (const b of bindings) {
    if (b.key !== b.defaultKey) overrides[b.id] = b.key
  }
  if (Object.keys(overrides).length > 0) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
  } else {
    localStorage.removeItem(STORAGE_KEY)
  }
}

export function subscribe(fn: () => void): () => void {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter(l => l !== fn)
  }
}

export function getKeyBindings(): KeyBinding[] {
  return bindings
}

export function getKey(id: string): string {
  const b = bindings.find(b => b.id === id)
  return b ? b.key : ''
}

/** Format key for display: 'ctrl+c' → 'Ctrl+C', 'delete' → 'Delete', 'b' → 'B' */
export function formatKey(key: string): string {
  return key.split('+').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('+')
}

export function setKey(id: string, key: string): void {
  const b = bindings.find(b => b.id === id)
  if (b) {
    b.key = key.toLowerCase()
    persist()
    notify()
  }
}

export function resetKey(id: string): void {
  const b = bindings.find(b => b.id === id)
  if (b) {
    b.key = b.defaultKey
    persist()
    notify()
  }
}

export function resetAll(): void {
  for (const b of bindings) b.key = b.defaultKey
  persist()
  notify()
}

/** Find binding that conflicts with a given key (excluding the binding being edited) */
export function findConflict(key: string, excludeId: string): KeyBinding | null {
  return bindings.find(b => b.id !== excludeId && b.key === key.toLowerCase()) || null
}

/** Convert a KeyboardEvent to a key string like 'ctrl+shift+a' or 'delete' */
export function eventToKeyString(e: KeyboardEvent): string | null {
  const key = e.key.toLowerCase()
  // Ignore modifier-only presses
  if (['control', 'shift', 'alt', 'meta'].includes(key)) return null

  const parts: string[] = []
  if (e.ctrlKey) parts.push('ctrl')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')

  // Normalize key names
  const keyName = key === ' ' ? 'space' : key
  parts.push(keyName)
  return parts.join('+')
}

/** Check if a KeyboardEvent matches a binding */
export function matchesKey(id: string, e: KeyboardEvent): boolean {
  const b = bindings.find(b => b.id === id)
  if (!b) return false

  const parts = b.key.toLowerCase().split('+')
  const targetKey = parts[parts.length - 1]
  const needsCtrl = parts.includes('ctrl')
  const needsShift = parts.includes('shift')
  const needsAlt = parts.includes('alt')

  const pressedKey = e.key.toLowerCase() === ' ' ? 'space' : e.key.toLowerCase()

  return pressedKey === targetKey
    && e.ctrlKey === needsCtrl
    && e.shiftKey === needsShift
    && e.altKey === needsAlt
}
