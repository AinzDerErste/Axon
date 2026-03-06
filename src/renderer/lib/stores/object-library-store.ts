/**
 * Object Library Store — persists the collection of imported object images
 * across save/load. Pub/sub pattern matching all other stores.
 */

import type { ObjectImage } from './object-selection-store'

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

/** Serialize for project file (strip imageBitmap) */
export function serializeLibrary(): SerializedObjectImage[] {
  return library.map(o => ({
    name: o.name,
    imageDataUrl: o.imageDataUrl,
    width: o.width,
    height: o.height
  }))
}

/** Deserialize from project file (reconstitute imageBitmaps) */
export async function deserializeLibrary(items: SerializedObjectImage[]): Promise<void> {
  const result: ObjectImage[] = []
  for (const item of items) {
    const img = new Image()
    img.src = item.imageDataUrl
    await new Promise<void>(resolve => {
      img.onload = () => {
        createImageBitmap(img).then(bmp => {
          result.push({
            name: item.name,
            imageDataUrl: item.imageDataUrl,
            imageBitmap: bmp,
            width: item.width,
            height: item.height
          })
          resolve()
        })
      }
    })
  }
  library = result
  notify()
}
