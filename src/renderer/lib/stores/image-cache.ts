/**
 * Centralized Image Cache — stores each unique image ONCE.
 * All objects, tilesets, layers, and presets reference images by hash
 * instead of holding their own ImageBitmap + base64 copies.
 */

interface CachedImage {
  dataUrl: string
  bitmap: ImageBitmap
  refCount: number
}

const cache = new Map<string, CachedImage>()

/** Fast content-based hash from a data URL (length + head + tail) */
export function hashDataUrl(dataUrl: string): string {
  const len = dataUrl.length
  const head = dataUrl.substring(0, 128)
  const tail = dataUrl.substring(len - 64)
  return `${len}:${head}:${tail}`
}

/**
 * Register a data URL in the cache. If already present, increments refCount.
 * Returns the hash key for later lookup.
 */
export async function registerImage(dataUrl: string): Promise<string> {
  const hash = hashDataUrl(dataUrl)
  const existing = cache.get(hash)
  if (existing) {
    existing.refCount++
    return hash
  }

  const img = new Image()
  img.src = dataUrl
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Failed to load image'))
  })
  const bitmap = await createImageBitmap(img)
  img.src = '' // Release decoded image data

  cache.set(hash, { dataUrl, bitmap, refCount: 1 })
  return hash
}

/**
 * Register synchronously if already cached, otherwise start async registration.
 * Returns the hash immediately (bitmap may not be ready yet for new images).
 */
export function registerImageSync(dataUrl: string): string {
  const hash = hashDataUrl(dataUrl)
  const existing = cache.get(hash)
  if (existing) {
    existing.refCount++
    return hash
  }
  // Start async registration in background
  registerImage(dataUrl)
  return hash
}

/** Get the ImageBitmap for a hash (for rendering) */
export function getBitmap(hash: string): ImageBitmap | null {
  return cache.get(hash)?.bitmap ?? null
}

/** Get the data URL for a hash (for serialization / thumbnails) */
export function getDataUrl(hash: string): string | null {
  return cache.get(hash)?.dataUrl ?? null
}

/** Increment reference count (e.g., when duplicating an object) */
export function addRef(hash: string): void {
  const entry = cache.get(hash)
  if (entry) entry.refCount++
}

/** Decrement reference count; close bitmap when it reaches 0 */
export function releaseRef(hash: string): void {
  const entry = cache.get(hash)
  if (!entry) return
  entry.refCount--
  if (entry.refCount <= 0) {
    entry.bitmap.close()
    cache.delete(hash)
  }
}

/** Clear all cached images (project switch / new project). Closes all bitmaps. */
export function clearAll(): void {
  for (const entry of cache.values()) {
    entry.bitmap.close()
  }
  cache.clear()
}

/** Get current cache size (for debugging) */
export function getCacheSize(): number {
  return cache.size
}
