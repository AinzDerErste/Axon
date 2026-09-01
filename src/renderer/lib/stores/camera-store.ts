/**
 * Camera Store — bridges the canvas camera to code outside the canvas.
 *
 * The camera lives on the MapRenderer instance inside MapCanvas, so save and
 * load had no way to reach it and wrote a hardcoded {0, 0, 1} into every
 * project file. MapCanvas registers accessors here; save reads through them
 * and load writes back through them.
 */

export interface CameraState {
  x: number
  y: number
  zoom: number
}

export interface CameraAccessor {
  read: () => CameraState
  write: (state: CameraState) => void
}

let accessor: CameraAccessor | null = null

export function registerCamera(a: CameraAccessor): () => void {
  accessor = a
  return () => {
    if (accessor === a) accessor = null
  }
}

/** Current camera, or null while no canvas is mounted. */
export function readCamera(): CameraState | null {
  return accessor ? accessor.read() : null
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Restore a camera from a project file. Ignores anything malformed rather than
 * moving the view somewhere unreachable — an old file may carry no camera at
 * all, and the canvas has already centred itself by the time this runs.
 */
export function applyCamera(state: unknown): void {
  if (!accessor || !state || typeof state !== 'object') return
  const { x, y, zoom } = state as Partial<CameraState>
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(zoom) || zoom <= 0) return
  accessor.write({ x, y, zoom })
}
