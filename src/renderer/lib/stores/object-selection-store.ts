/** Stores the currently selected object image for placement */

export interface ObjectImage {
  name: string
  imageDataUrl: string
  imageBitmap: ImageBitmap | null
  /** Hash key into the central image cache (runtime only) */
  imageHash?: string
  width: number
  height: number
}

let selectedImage: ObjectImage | null = null
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

export function getSelectedObjectImage(): ObjectImage | null {
  return selectedImage
}

export function setSelectedObjectImage(img: ObjectImage | null): void {
  selectedImage = img
  notify()
}
