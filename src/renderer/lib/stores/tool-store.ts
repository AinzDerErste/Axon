export type ToolType = 'paint' | 'eraser' | 'fill' | 'select' | 'object' | 'zone' | 'collision' | 'sketch'

let activeTool: ToolType = 'paint'
let listeners: Array<() => void> = []

function notify() {
  for (const fn of listeners) fn()
}

export function subscribe(fn: () => void): () => void {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter(l => l !== fn)
  }
}

export function getActiveTool(): ToolType {
  return activeTool
}

export function setActiveTool(tool: ToolType): void {
  activeTool = tool
  notify()
}
