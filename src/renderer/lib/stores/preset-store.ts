/**
 * Preset Store — manages saved presets/prefabs (tile+object+zone regions).
 * Pub/sub pattern matching all other stores.
 */

import type { Preset } from '../models/preset'

let presets: Preset[] = []
let selectedPresetId: string | null = null
let listeners: Array<() => void> = []

/** Cached ImageBitmaps for preset object previews, keyed by "presetId:objectIndex" */
const presetObjectBitmaps: Map<string, ImageBitmap> = new Map()

function notify(): void {
  for (const fn of listeners) fn()
}

export function subscribe(fn: () => void): () => void {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter(l => l !== fn)
  }
}

export function getPresets(): Preset[] {
  return presets
}

export function getPresetById(id: string): Preset | undefined {
  return presets.find(p => p.id === id)
}

export function addPreset(preset: Preset): void {
  presets = [...presets, preset]
  ensurePresetBitmaps(preset)
  notify()
}

export function removePreset(id: string): void {
  // Clean up cached bitmaps for this preset
  const preset = presets.find(p => p.id === id)
  if (preset) {
    for (let i = 0; i < preset.objects.length; i++) {
      presetObjectBitmaps.delete(`${id}:${i}`)
    }
  }
  presets = presets.filter(p => p.id !== id)
  if (selectedPresetId === id) selectedPresetId = null
  notify()
}

export function renamePreset(id: string, name: string): void {
  presets = presets.map(p => p.id === id ? { ...p, name } : p)
  notify()
}

export function getSelectedPresetId(): string | null {
  return selectedPresetId
}

export function selectPreset(id: string | null): void {
  selectedPresetId = id
  // Ensure bitmaps are ready for preview
  if (id) {
    const preset = presets.find(p => p.id === id)
    if (preset) ensurePresetBitmaps(preset)
  }
  notify()
}

export function clearPresets(): void {
  presets = []
  selectedPresetId = null
  presetObjectBitmaps.clear()
  notify()
}

export function setPresets(items: Preset[]): void {
  presets = items
  notify()
}

/** Serialize for project file */
export function serializePresets(): Preset[] {
  return presets.map(p => ({ ...p }))
}

/** Deserialize from project file */
export function deserializePresets(items: Preset[]): void {
  presets = items
  selectedPresetId = null
  // Pre-cache bitmaps for all preset objects
  for (const preset of presets) {
    ensurePresetBitmaps(preset)
  }
  notify()
}

/** Ensure all objects in a preset have their ImageBitmaps cached */
export function ensurePresetBitmaps(preset: Preset): void {
  for (let i = 0; i < preset.objects.length; i++) {
    const key = `${preset.id}:${i}`
    if (presetObjectBitmaps.has(key)) continue
    const obj = preset.objects[i]
    const img = new Image()
    img.src = obj.imageDataUrl
    img.onload = () => {
      createImageBitmap(img).then(bmp => {
        presetObjectBitmaps.set(key, bmp)
      })
    }
  }
}

/** Get the cached ImageBitmap for a preset object */
export function getPresetObjectBitmap(presetId: string, objectIndex: number): ImageBitmap | null {
  return presetObjectBitmaps.get(`${presetId}:${objectIndex}`) ?? null
}
