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
  { id: 'tool.path', label: 'Path', category: 'Tools', key: 'h', defaultKey: 'h' },
  { id: 'tool.sketch', label: 'Sketch', category: 'Tools', key: 'k', defaultKey: 'k' },
  { id: 'tool.stamp', label: 'Stamp', category: 'Tools', key: 't', defaultKey: 't' },
  // Canvas
  { id: 'canvas.copy', label: 'Copy', category: 'Canvas', key: 'ctrl+c', defaultKey: 'ctrl+c' },
  { id: 'canvas.paste', label: 'Paste', category: 'Canvas', key: 'ctrl+v', defaultKey: 'ctrl+v' },
  { id: 'canvas.duplicate', label: 'Duplicate', category: 'Canvas', key: 'ctrl+d', defaultKey: 'ctrl+d' },
  { id: 'canvas.delete', label: 'Delete', category: 'Canvas', key: 'delete', defaultKey: 'delete' },
  { id: 'canvas.pan', label: 'Pan (hold)', category: 'Canvas', key: 'space,mousemiddle', defaultKey: 'space,mousemiddle' },
]

let bindings: KeyBinding[] = loadBindings()
let listeners: Array<() => void> = []

function notify(): void {
  for (const fn of listeners) fn()
}

function splitKeys(key: string): string[] {
  return key.split(',').map(k => k.trim()).filter(Boolean)
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

/** Get individual keys as array: 'space,mousemiddle' → ['space', 'mousemiddle'] */
export function getKeys(id: string): string[] {
  return splitKeys(getKey(id))
}

const MOUSE_BUTTON_NAMES: Record<number, string> = {
  0: 'mouseleft',
  1: 'mousemiddle',
  2: 'mouseright',
  3: 'mouseback',
  4: 'mouseforward',
}

const MOUSE_DISPLAY_NAMES: Record<string, string> = {
  mouseleft: 'Left Click',
  mousemiddle: 'Middle Click',
  mouseright: 'Right Click',
  mouseback: 'Mouse Back',
  mouseforward: 'Mouse Forward',
}

/** Format a single key for display: 'ctrl+c' → 'Ctrl+C', 'mouseback' → 'Mouse Back' */
export function formatKey(key: string): string {
  return key.split('+').map(p => {
    const lower = p.toLowerCase()
    if (MOUSE_DISPLAY_NAMES[lower]) return MOUSE_DISPLAY_NAMES[lower]
    return p.charAt(0).toUpperCase() + p.slice(1)
  }).join('+')
}

/** Format all keys of a binding for display, joined with ' / ' */
export function formatAllKeys(id: string): string {
  return getKeys(id).map(formatKey).join(' / ')
}

/** Check if a binding uses a mouse button */
export function isMouseBinding(id: string): boolean {
  const b = bindings.find(b => b.id === id)
  if (!b) return false
  return splitKeys(b.key).some(k => k.split('+').some(p => p.startsWith('mouse')))
}

/** Replace all keys for a binding */
export function setKey(id: string, key: string): void {
  const b = bindings.find(b => b.id === id)
  if (b) {
    b.key = key.toLowerCase()
    persist()
    notify()
  }
}

/** Replace a single key at a given slot index */
export function setKeyAt(id: string, index: number, key: string): void {
  const b = bindings.find(b => b.id === id)
  if (!b) return
  const keys = splitKeys(b.key)
  if (index >= 0 && index < keys.length) {
    keys[index] = key.toLowerCase()
    b.key = keys.join(',')
    persist()
    notify()
  }
}

/** Add an additional key to a binding */
export function addKey(id: string, key: string): void {
  const b = bindings.find(b => b.id === id)
  if (!b) return
  const keys = splitKeys(b.key)
  keys.push(key.toLowerCase())
  b.key = keys.join(',')
  persist()
  notify()
}

/** Remove a key at a given slot index (keeps at least one key) */
export function removeKeyAt(id: string, index: number): void {
  const b = bindings.find(b => b.id === id)
  if (!b) return
  const keys = splitKeys(b.key)
  if (keys.length <= 1) return
  keys.splice(index, 1)
  b.key = keys.join(',')
  persist()
  notify()
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
  const needle = key.toLowerCase()
  return bindings.find(b => b.id !== excludeId && splitKeys(b.key).includes(needle)) || null
}

/** Convert a KeyboardEvent to a key string like 'ctrl+shift+a' or 'delete' */
export function eventToKeyString(e: KeyboardEvent): string | null {
  const key = e.key.toLowerCase()
  if (['control', 'shift', 'alt', 'meta'].includes(key)) return null

  const parts: string[] = []
  if (e.ctrlKey) parts.push('ctrl')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')

  const keyName = key === ' ' ? 'space' : key
  parts.push(keyName)
  return parts.join('+')
}

/** Convert a MouseEvent to a key string like 'ctrl+mouseback' or 'mousemiddle' */
export function mouseEventToKeyString(e: MouseEvent): string | null {
  const btnName = MOUSE_BUTTON_NAMES[e.button]
  if (!btnName) return null

  const parts: string[] = []
  if (e.ctrlKey) parts.push('ctrl')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')
  parts.push(btnName)
  return parts.join('+')
}

function matchesSingleKey(subKey: string, e: KeyboardEvent): boolean {
  const parts = subKey.split('+')
  const targetKey = parts[parts.length - 1]
  if (targetKey.startsWith('mouse')) return false

  const needsCtrl = parts.includes('ctrl')
  const needsShift = parts.includes('shift')
  const needsAlt = parts.includes('alt')

  const pressedKey = e.key.toLowerCase() === ' ' ? 'space' : e.key.toLowerCase()

  return pressedKey === targetKey
    && e.ctrlKey === needsCtrl
    && e.shiftKey === needsShift
    && e.altKey === needsAlt
}

function matchesSingleMouseKey(subKey: string, e: MouseEvent): boolean {
  const parts = subKey.split('+')
  const targetKey = parts[parts.length - 1]
  if (!targetKey.startsWith('mouse')) return false

  const needsCtrl = parts.includes('ctrl')
  const needsShift = parts.includes('shift')
  const needsAlt = parts.includes('alt')

  const btnName = MOUSE_BUTTON_NAMES[e.button]
  if (!btnName) return false

  return btnName === targetKey
    && e.ctrlKey === needsCtrl
    && e.shiftKey === needsShift
    && e.altKey === needsAlt
}

/** Check if a KeyboardEvent matches any key of a binding */
export function matchesKey(id: string, e: KeyboardEvent): boolean {
  const b = bindings.find(b => b.id === id)
  if (!b) return false
  return splitKeys(b.key).some(k => matchesSingleKey(k, e))
}

/** Check if a MouseEvent matches any key of a binding */
export function matchesMouseKey(id: string, e: MouseEvent): boolean {
  const b = bindings.find(b => b.id === id)
  if (!b) return false
  return splitKeys(b.key).some(k => matchesSingleMouseKey(k, e))
}
