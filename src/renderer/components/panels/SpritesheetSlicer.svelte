<script lang="ts">
  import { onMount } from 'svelte'
  import type { Tileset } from '../../lib/models/tileset'
  import type { TileEntry } from '../../lib/models/tile'

  interface Props {
    imageData: string
    imageName: string
    initialTileWidth?: number
    initialTileHeight?: number
    onconfirm: (e: CustomEvent<Tileset>) => void
    oncancel: () => void
  }

  let { imageData, imageName, initialTileWidth, initialTileHeight, onconfirm, oncancel }: Props = $props()

  // svelte-ignore state_referenced_locally — intentionally capturing initial prop values only
  let tileWidth = $state(initialTileWidth || 64)
  // svelte-ignore state_referenced_locally
  let tileHeight = $state(initialTileHeight || 64)
  let margin = $state(0)
  let spacing = $state(0)
  let skipEmpty = $state(true)
  let previewCanvas: HTMLCanvasElement
  let img: HTMLImageElement | null = $state(null)
  let imgWidth = $state(0)
  let imgHeight = $state(0)
  let totalCells = $state(0)
  let nonEmptyCount = $state(0)

  // Offscreen canvas for pixel analysis
  let analysisCtx: OffscreenCanvasRenderingContext2D | null = null

  onMount(() => {
    const image = new Image()
    image.src = imageData
    image.onload = () => {
      img = image
      imgWidth = image.width
      imgHeight = image.height
      // Create analysis canvas at full resolution for transparency detection
      const offscreen = new OffscreenCanvas(imgWidth, imgHeight)
      analysisCtx = offscreen.getContext('2d')!
      analysisCtx.drawImage(image, 0, 0)
      drawPreview()
    }
  })

  function isTileEmpty(x: number, y: number, w: number, h: number): boolean {
    if (!analysisCtx) return false
    const data = analysisCtx.getImageData(x, y, w, h).data
    // Check alpha channel — if all pixels have alpha < 10, tile is empty
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 10) return false
    }
    return true
  }

  function drawPreview() {
    if (!previewCanvas || !img) return
    const maxW = 560
    const maxH = 450
    const scale = Math.min(maxW / imgWidth, maxH / imgHeight, 1)
    previewCanvas.width = imgWidth * scale
    previewCanvas.height = imgHeight * scale
    const ctx = previewCanvas.getContext('2d')!
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height)

    // Checkerboard background to show transparency
    const checkSize = 8
    for (let cy = 0; cy < previewCanvas.height; cy += checkSize) {
      for (let cx = 0; cx < previewCanvas.width; cx += checkSize) {
        ctx.fillStyle = ((cx / checkSize + cy / checkSize) % 2 === 0) ? '#2a2a3a' : '#222232'
        ctx.fillRect(cx, cy, checkSize, checkSize)
      }
    }

    ctx.drawImage(img, 0, 0, previewCanvas.width, previewCanvas.height)

    let total = 0
    let nonEmpty = 0

    for (let y = margin; y + tileHeight <= imgHeight - margin; y += tileHeight + spacing) {
      for (let x = margin; x + tileWidth <= imgWidth - margin; x += tileWidth + spacing) {
        total++
        const empty = skipEmpty && isTileEmpty(x, y, tileWidth, tileHeight)

        if (empty) {
          // Dim overlay for empty tiles
          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
          ctx.fillRect(x * scale, y * scale, tileWidth * scale, tileHeight * scale)
          ctx.strokeStyle = 'rgba(100, 100, 120, 0.3)'
          ctx.lineWidth = 1
          ctx.strokeRect(x * scale, y * scale, tileWidth * scale, tileHeight * scale)
        } else {
          nonEmpty++
          ctx.strokeStyle = 'rgba(137, 180, 250, 0.8)'
          ctx.lineWidth = 1
          ctx.strokeRect(x * scale, y * scale, tileWidth * scale, tileHeight * scale)
        }
      }
    }
    totalCells = total
    nonEmptyCount = nonEmpty
  }

  $effect(() => {
    tileWidth; tileHeight; margin; spacing; skipEmpty
    drawPreview()
  })

  function handleConfirm() {
    if (!img) return
    const tiles: TileEntry[] = []
    let id = 0
    for (let y = margin; y + tileHeight <= imgHeight - margin; y += tileHeight + spacing) {
      for (let x = margin; x + tileWidth <= imgWidth - margin; x += tileWidth + spacing) {
        if (skipEmpty && isTileEmpty(x, y, tileWidth, tileHeight)) continue
        tiles.push({ id: id++, x, y, width: tileWidth, height: tileHeight })
      }
    }

    const columns = Math.floor((imgWidth - 2 * margin + spacing) / (tileWidth + spacing))

    createImageBitmap(img).then(bmp => {
      const tileset: Tileset = {
        id: crypto.randomUUID(),
        name: imageName,
        imageDataUrl: imageData,
        imageBitmap: bmp,
        tileWidth,
        tileHeight,
        columns,
        tiles
      }
      onconfirm(new CustomEvent('confirm', { detail: tileset }))
    })
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') oncancel()
    if (e.key === 'Enter') handleConfirm()
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="slicer-dialog" onkeydown={handleKeydown}>
  <h3>Import Spritesheet</h3>
  <div class="slicer-content">
    <div class="preview-area">
      <canvas bind:this={previewCanvas}></canvas>
    </div>
    <div class="slicer-controls">
      <div class="field">
        <label for="slicer-tw">Tile Width</label>
        <input id="slicer-tw" type="number" min="1" bind:value={tileWidth} />
      </div>
      <div class="field">
        <label for="slicer-th">Tile Height</label>
        <input id="slicer-th" type="number" min="1" bind:value={tileHeight} />
      </div>
      <div class="field">
        <label for="slicer-margin">Margin</label>
        <input id="slicer-margin" type="number" min="0" bind:value={margin} />
      </div>
      <div class="field">
        <label for="slicer-spacing">Spacing</label>
        <input id="slicer-spacing" type="number" min="0" bind:value={spacing} />
      </div>
      <label class="checkbox-field">
        <input type="checkbox" bind:checked={skipEmpty} />
        <span>Skip empty tiles</span>
      </label>
      <div class="info">
        Image: {imgWidth}&times;{imgHeight} px<br />
        Grid cells: {totalCells}<br />
        {#if skipEmpty}
          Tiles to import: <strong>{nonEmptyCount}</strong> ({totalCells - nonEmptyCount} empty)
        {:else}
          Tiles to import: <strong>{totalCells}</strong>
        {/if}
      </div>
      <div class="buttons">
        <button class="cancel-btn" onclick={oncancel}>Cancel</button>
        <button class="confirm-btn" onclick={handleConfirm} disabled={(skipEmpty ? nonEmptyCount : totalCells) === 0}>
          Import {skipEmpty ? nonEmptyCount : totalCells} Tiles
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .slicer-dialog {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 20px;
    max-width: 780px;
    width: 90%;
  }

  h3 {
    margin: 0 0 16px;
    font-size: var(--font-size-lg);
    color: var(--text-primary);
  }

  .slicer-content {
    display: flex;
    gap: 20px;
  }

  .preview-area {
    flex: 1;
    background: var(--bg-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 200px;
    overflow: auto;
  }

  .preview-area canvas {
    image-rendering: pixelated;
    max-width: 100%;
  }

  .slicer-controls {
    width: 200px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .field label {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .field input {
    width: 100%;
  }

  .checkbox-field {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .checkbox-field input[type="checkbox"] {
    width: 14px;
    height: 14px;
    accent-color: var(--accent);
  }

  .info {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    line-height: 1.6;
  }

  .info strong {
    color: var(--accent);
  }

  .buttons {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: auto;
  }

  .confirm-btn {
    background: var(--accent);
    color: var(--bg-primary);
    border-color: var(--accent);
    font-weight: 600;
  }

  .confirm-btn:hover {
    background: var(--accent-hover);
  }

  .confirm-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .cancel-btn {
    background: var(--bg-tertiary);
  }
</style>
