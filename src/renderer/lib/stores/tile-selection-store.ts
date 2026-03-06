import type { TileRef } from '../models/tile'

let selectedTile: TileRef | null = null
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

export function getSelectedTile(): TileRef | null {
  return selectedTile
}

export function setSelectedTile(tile: TileRef | null): void {
  selectedTile = tile
  notify()
}
