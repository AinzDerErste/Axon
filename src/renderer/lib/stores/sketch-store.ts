export type SketchSubTool = 'pencil' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text'

export interface SketchSettings {
  subTool: SketchSubTool
  color: string
  strokeWidth: number
  fill: boolean
  fontSize: number
  fontFamily: string
}

let settings: SketchSettings = {
  subTool: 'pencil',
  color: '#f38ba8',
  strokeWidth: 3,
  fill: false,
  fontSize: 24,
  fontFamily: 'sans-serif'
}

let listeners: Array<() => void> = []

function notify() {
  for (const fn of listeners) fn()
}

export function subscribe(fn: () => void): () => void {
  listeners.push(fn)
  return () => { listeners = listeners.filter(l => l !== fn) }
}

export function getSketchSettings(): SketchSettings {
  return settings
}

export function setSketchSubTool(subTool: SketchSubTool): void {
  settings = { ...settings, subTool }
  notify()
}

export function setSketchColor(color: string): void {
  settings = { ...settings, color }
  notify()
}

export function setSketchStrokeWidth(strokeWidth: number): void {
  settings = { ...settings, strokeWidth: Math.max(1, Math.min(20, strokeWidth)) }
  notify()
}

export function setSketchFill(fill: boolean): void {
  settings = { ...settings, fill }
  notify()
}

export function setSketchFontSize(fontSize: number): void {
  settings = { ...settings, fontSize: Math.max(8, Math.min(200, fontSize)) }
  notify()
}

export function setSketchFontFamily(fontFamily: string): void {
  settings = { ...settings, fontFamily }
  notify()
}
