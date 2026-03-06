let hoverCol: number = -1
let hoverRow: number = -1
let zoom: number = 100
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

export function getHover(): { col: number; row: number } {
  return { col: hoverCol, row: hoverRow }
}

export function setHover(col: number, row: number): void {
  if (col === hoverCol && row === hoverRow) return
  hoverCol = col
  hoverRow = row
  notify()
}

export function getZoomPercent(): number {
  return Math.round(zoom)
}

export function getZoomPercentLabel(): string {
  if (zoom < 0.1) return zoom.toFixed(2)
  if (zoom < 1) return zoom.toFixed(1)
  return String(Math.round(zoom))
}

export function setZoomPercent(z: number): void {
  zoom = z
  notify()
}
