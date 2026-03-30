/**
 * Object Library Store — persists the collection of imported object images
 * across save/load. Pub/sub pattern matching all other stores.
 */

import type { ObjectImage } from './object-selection-store'
import { registerImage, getDataUrl, getBitmap } from './image-cache'

/** Serializable form of an ObjectImage (no imageBitmap) */
export interface SerializedObjectImage {
  name: string
  imageDataUrl: string
  width: number
  height: number
}

let library: ObjectImage[] = []
let listeners: Array<() => void> = []

function notify(): void {
  for (const fn of listeners) fn()
}

export function subscribe(fn: () => void): () => void {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter(l => l !== fn)
  }
}

export function getObjectLibrary(): ObjectImage[] {
  return library
}

export function addToLibrary(img: ObjectImage): void {
  // Prevent duplicates by name
  if (library.some(o => o.name === img.name)) return
  library = [...library, img]
  notify()
}

export function removeFromLibrary(name: string): void {
  library = library.filter(o => o.name !== name)
  notify()
}

/** Update an existing library item by name (replace image data + bitmap) */
export function updateInLibrary(img: ObjectImage): void {
  library = library.map(o => o.name === img.name ? img : o)
  notify()
}

export function clearLibrary(): void {
  library = []
  notify()
}

/** Set entire library at once (used on project load) */
export function setLibrary(items: ObjectImage[]): void {
  library = items
  notify()
}

/** Serialize for project file (strip imageBitmap, resolve dataUrl from cache) */
export function serializeLibrary(): SerializedObjectImage[] {
  return library.map(o => ({
    name: o.name,
    imageDataUrl: (o.imageHash && getDataUrl(o.imageHash)) || o.imageDataUrl,
    width: o.width,
    height: o.height
  }))
}

/** Deserialize from project file (register images in central cache) */
export async function deserializeLibrary(items: SerializedObjectImage[]): Promise<void> {
  const hashes = await Promise.all(items.map(item => registerImage(item.imageDataUrl)))
  library = items.map((item, i) => ({
    name: item.name,
    imageDataUrl: item.imageDataUrl,
    imageBitmap: getBitmap(hashes[i]),
    imageHash: hashes[i],
    width: item.width,
    height: item.height
  }))
  notify()
}
