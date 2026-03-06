<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { getMap, addTileset, removeTileset, updateTilesetImage, subscribe as mapSubscribe } from '../../lib/stores/map-store'
  import { getSelectedTile, setSelectedTile, subscribe as selSubscribe } from '../../lib/stores/tile-selection-store'
  import { getSettings, updateSettings } from '../../lib/stores/settings-store'
  import SpritesheetSlicer from './SpritesheetSlicer.svelte'
  import type { Tileset } from '../../lib/models/tileset'
  import type { TileRef } from '../../lib/models/tile'

  let tilesets = $state<Tileset[]>([])
  let selectedTile = $state<TileRef | null>(null)
  let showSlicer = $state(false)
  let slicerImageData = $state('')
  let slicerImageName = $state('')
  let tileGridEl: HTMLDivElement | null = null
  let viewMode = $state<'list' | 'grid'>('grid')
  let showFolderManager = $state(false)
  let watchFolders = $state<string[]>([])

  // Cache of known files per folder: folder → Map<fileName, mtimeMs>
  const folderFileCache = new Map<string, Map<string, number>>()
  let syncingFolders = $state(false)

  onMount(() => {
    const unsub1 = mapSubscribe(() => {
      const map = getMap()
      tilesets = map ? [...map.tilesets] : []
      tick().then(renderAllPreviews)
    })
    const unsub2 = selSubscribe(() => {
      selectedTile = getSelectedTile()
    })

    watchFolders = [...getSettings().tileWatchFolders]

    // Initial sync of all watched folders
    if (watchFolders.length > 0) {
      syncAllTileFolders()
    }

    // Poll watched folders every 3 seconds
    const pollInterval = setInterval(() => {
      if (watchFolders.length > 0) syncAllTileFolders()
    }, 3000)

    return () => { unsub1(); unsub2(); clearInterval(pollInterval) }
  })

  /** Scan all watched folders and sync changes into tilesets */
  async function syncAllTileFolders() {
    if (syncingFolders || !getMap()) return
    syncingFolders = true
    try {
      for (const folder of watchFolders) {
        await syncTileFolder(folder)
      }
    } finally {
      syncingFolders = false
    }
  }

  async function syncTileFolder(folderPath: string) {
    const meta = await window.electronAPI?.scanImageMeta(folderPath)
    if (!meta) return

    const map = getMap()
    if (!map) return

    const cached = folderFileCache.get(folderPath) || new Map<string, number>()
    const currentNames = new Set<string>()

    for (const file of meta) {
      currentNames.add(file.name)
      const cachedMtime = cached.get(file.name)

      if (cachedMtime === undefined) {
        // New file — check if a tileset with this sourcePath already exists
        const existing = map.tilesets.find(ts => ts.sourcePath === file.filePath)
        if (!existing) {
          // Also skip if there's a tileset with same name from this folder
          const byName = map.tilesets.find(ts => ts.name === file.name && ts.sourcePath?.startsWith(folderPath))
          if (!byName) {
            const data = await window.electronAPI?.readImageFile(file.filePath)
            if (data) {
              await addTileFromFile(data.data, data.name, file.filePath)
            }
          }
        }
        cached.set(file.name, file.mtimeMs)
      } else if (cachedMtime !== file.mtimeMs) {
        // Changed file — update existing tileset
        const existing = map.tilesets.find(ts => ts.sourcePath === file.filePath)
        if (existing) {
          const data = await window.electronAPI?.readImageFile(file.filePath)
          if (data) {
            const img = new Image()
            img.src = data.data
            await new Promise<void>(resolve => {
              img.onload = async () => {
                const bmp = await createImageBitmap(img)
                updateTilesetImage(existing.id, data.data, bmp, img.naturalWidth, img.naturalHeight)
                resolve()
              }
              img.onerror = () => resolve()
            })
          }
        }
        cached.set(file.name, file.mtimeMs)
      }
    }

    // Deleted files — remove tilesets that came from this folder
    for (const [name, _mtime] of cached) {
      if (!currentNames.has(name)) {
        const existing = map.tilesets.find(ts => ts.sourcePath && ts.sourcePath.startsWith(folderPath) && ts.name === name)
        if (existing) {
          if (selectedTile && selectedTile.tilesetId === existing.id) {
            setSelectedTile(null)
          }
          removeTileset(existing.id)
        }
        cached.delete(name)
      }
    }

    folderFileCache.set(folderPath, cached)
  }

  async function addTileFromFile(dataUrl: string, name: string, sourcePath: string) {
    const img = new Image()
    img.src = dataUrl
    await new Promise<void>(resolve => {
      img.onload = () => {
        createImageBitmap(img).then(bmp => {
          const tileset: Tileset = {
            id: crypto.randomUUID(),
            name,
            imageDataUrl: dataUrl,
            imageBitmap: bmp,
            tileWidth: img.naturalWidth,
            tileHeight: img.naturalHeight,
            columns: 1,
            tiles: [{ id: 0, x: 0, y: 0, width: img.naturalWidth, height: img.naturalHeight }],
            sourcePath
          }
          addTileset(tileset)
          resolve()
        })
      }
      img.onerror = () => resolve()
    })
  }

  async function handleAddWatchFolder() {
    const folder = await window.electronAPI?.selectFolder()
    if (!folder) return
    if (watchFolders.includes(folder)) return
    watchFolders = [...watchFolders, folder]
    updateSettings({ tileWatchFolders: watchFolders })
    await syncTileFolder(folder)
  }

  function handleRemoveWatchFolder(folder: string) {
    watchFolders = watchFolders.filter(f => f !== folder)
    updateSettings({ tileWatchFolders: watchFolders })
    folderFileCache.delete(folder)
  }

  function getFolderDisplayName(folderPath: string): string {
    const parts = folderPath.replace(/\\/g, '/').split('/')
    return parts[parts.length - 1] || folderPath
  }

  function renderAllPreviews() {
    if (!tileGridEl) return
    const canvases = tileGridEl.querySelectorAll('canvas[data-tileset-id]')
    canvases.forEach((canvas) => {
      const c = canvas as HTMLCanvasElement
      const tilesetId = c.dataset.tilesetId!
      const tileIndex = parseInt(c.dataset.tileIndex!, 10)
      const tileset = tilesets.find(ts => ts.id === tilesetId)
      if (tileset) drawTilePreview(c, tileset, tileIndex)
    })
  }

  async function handleImportTiles() {
    try {
      const result = await window.electronAPI.readImageFiles()
      if (!result || result.length === 0) return
      const map = getMap()
      if (!map) return

      for (const file of result) {
        const img = new Image()
        img.src = file.data
        await new Promise<void>((resolve) => {
          img.onload = () => {
            const tileset: Tileset = {
              id: crypto.randomUUID(),
              name: file.name,
              imageDataUrl: file.data,
              imageBitmap: null,
              tileWidth: img.width,
              tileHeight: img.height,
              columns: 1,
              tiles: [{ id: 0, x: 0, y: 0, width: img.width, height: img.height }]
            }
            createImageBitmap(img).then(bmp => {
              tileset.imageBitmap = bmp
              addTileset(tileset)
              resolve()
            })
          }
        })
      }
    } catch (e) {
      console.error('Failed to import tiles:', e)
    }
  }

  async function handleImportSpritesheet() {
    try {
      const result = await window.electronAPI.readSpritesheetFile()
      if (!result) return
      slicerImageData = result.data
      slicerImageName = result.name
      showSlicer = true
    } catch (e) {
      console.error('Failed to import spritesheet:', e)
    }
  }

  function handleSlicerConfirm(e: CustomEvent<Tileset>) {
    addTileset(e.detail)
    showSlicer = false
  }

  function handleSlicerCancel() {
    showSlicer = false
  }

  function selectTile(tilesetId: string, tileIndex: number) {
    setSelectedTile({ tilesetId, tileIndex })
  }

  function handleRemoveTileset(tilesetId: string, e: MouseEvent) {
    e.stopPropagation()
    // Clear selection if it belongs to the deleted tileset
    if (selectedTile && selectedTile.tilesetId === tilesetId) {
      setSelectedTile(null)
    }
    removeTileset(tilesetId)
  }

  function isSelected(tilesetId: string, tileIndex: number): boolean {
    return selectedTile?.tilesetId === tilesetId && selectedTile?.tileIndex === tileIndex
  }

  // Re-render canvas previews when view mode changes (new canvas elements are created)
  $effect(() => {
    void viewMode
    tick().then(renderAllPreviews)
  })

  function drawTilePreview(canvas: HTMLCanvasElement, tileset: Tileset, tileIndex: number) {
    const tile = tileset.tiles[tileIndex]
    if (!tile) return
    const size = 48
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, size, size)

    if (tileset.imageBitmap) {
      const scale = Math.min(size / tile.width, size / tile.height)
      const dw = tile.width * scale
      const dh = tile.height * scale
      ctx.drawImage(tileset.imageBitmap, tile.x, tile.y, tile.width, tile.height,
        (size - dw) / 2, (size - dh) / 2, dw, dh)
    } else {
      // Load bitmap if not yet available
      const img = new Image()
      img.src = tileset.imageDataUrl
      img.onload = () => {
        createImageBitmap(img).then(bmp => {
          tileset.imageBitmap = bmp
          const scale = Math.min(size / tile.width, size / tile.height)
          const dw = tile.width * scale
          const dh = tile.height * scale
          ctx.drawImage(bmp, tile.x, tile.y, tile.width, tile.height,
            (size - dw) / 2, (size - dh) / 2, dw, dh)
        })
      }
    }
  }
</script>

{#if showSlicer && slicerImageData}
  <div class="slicer-overlay">
    <SpritesheetSlicer
      imageData={slicerImageData}
      imageName={slicerImageName}
      onconfirm={handleSlicerConfirm}
      oncancel={handleSlicerCancel}
    />
  </div>
{/if}

<div class="panel">
  <div class="panel-header">
    <span class="panel-title">Tiles</span>
    <div class="panel-actions">
      <button class="view-toggle" class:active={viewMode === 'list'} onclick={() => viewMode = 'list'} title="List view">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <rect x="0" y="1" width="16" height="3" rx="0.5"/>
          <rect x="0" y="6.5" width="16" height="3" rx="0.5"/>
          <rect x="0" y="12" width="16" height="3" rx="0.5"/>
        </svg>
      </button>
      <button class="view-toggle" class:active={viewMode === 'grid'} onclick={() => viewMode = 'grid'} title="Grid view">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <rect x="0" y="0" width="7" height="7" rx="1"/>
          <rect x="9" y="0" width="7" height="7" rx="1"/>
          <rect x="0" y="9" width="7" height="7" rx="1"/>
          <rect x="9" y="9" width="7" height="7" rx="1"/>
        </svg>
      </button>
      <button class="view-toggle" title="Watch Folder" onclick={() => showFolderManager = !showFolderManager}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1 3.5A1.5 1.5 0 012.5 2h3.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.62 4H13.5A1.5 1.5 0 0115 5.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z"/>
        </svg>
      </button>
    </div>
  </div>
  {#if showFolderManager}
    <div class="folder-manager">
      <div class="folder-manager-header">
        <span class="folder-manager-title">Watched Folders</span>
        <button class="folder-add-btn" title="Add Folder" onclick={handleAddWatchFolder}>+</button>
      </div>
      {#if watchFolders.length === 0}
        <div class="folder-empty">No folders watched</div>
      {:else}
        {#each watchFolders as folder}
          <div class="folder-item" title={folder}>
            <svg class="folder-icon" width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 3.5A1.5 1.5 0 012.5 2h3.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.62 4H13.5A1.5 1.5 0 0115 5.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z"/>
            </svg>
            <span class="folder-path">{getFolderDisplayName(folder)}</span>
            <button class="folder-remove-btn" title="Remove folder" onclick={() => handleRemoveWatchFolder(folder)}>×</button>
          </div>
        {/each}
      {/if}
      {#if syncingFolders}
        <div class="folder-sync-status">Syncing...</div>
      {/if}
    </div>
  {/if}
  <div class="panel-body" bind:this={tileGridEl}>
    <div class="import-buttons">
      <button class="import-btn" onclick={handleImportTiles}>Import Tiles</button>
      <button class="import-btn" onclick={handleImportSpritesheet}>Import Spritesheet</button>
    </div>
    {#if tilesets.length === 0}
      <div class="empty-message">No tiles imported yet</div>
    {:else}
      {#each tilesets as tileset (tileset.id)}
        <div class="tileset-section">
          <div class="tileset-header">
            <span class="tileset-name">{tileset.name}</span>
            <button
              class="remove-btn"
              title="Remove tileset"
              onclick={(e: MouseEvent) => handleRemoveTileset(tileset.id, e)}
            >×</button>
          </div>
          {#if viewMode === 'grid'}
            <div class="tile-grid">
              {#each tileset.tiles as tile, i (tile.id)}
                <button
                  class="tile-btn"
                  class:selected={isSelected(tileset.id, i)}
                  title="{tileset.name} #{i}"
                  onclick={() => selectTile(tileset.id, i)}
                >
                  <canvas
                    width="48" height="48"
                    data-tileset-id={tileset.id}
                    data-tile-index={i}
                  ></canvas>
                </button>
              {/each}
            </div>
          {:else}
            <div class="tile-list">
              {#each tileset.tiles as tile, i (tile.id)}
                <div
                  class="tile-list-item"
                  class:selected={isSelected(tileset.id, i)}
                  onclick={() => selectTile(tileset.id, i)}
                  role="button"
                  tabindex="0"
                  onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') selectTile(tileset.id, i) }}
                >
                  <div class="tile-list-thumb">
                    <canvas
                      width="48" height="48"
                      data-tileset-id={tileset.id}
                      data-tile-index={i}
                    ></canvas>
                  </div>
                  <span class="tile-list-name">{tileset.name} #{i}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-subtle);
  }

  .panel-title {
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-secondary);
  }

  .panel-body {
    padding: 8px;
    flex: 1;
    overflow-y: auto;
  }

  .import-buttons {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 8px;
  }

  .import-btn {
    width: 100%;
    padding: 6px;
    font-size: var(--font-size-sm);
  }

  .empty-message {
    text-align: center;
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    padding: 20px 0;
  }

  .tileset-section {
    margin-bottom: 8px;
  }

  .tileset-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .tileset-name {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .remove-btn {
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .remove-btn:hover {
    color: var(--danger, #f38ba8);
  }

  .tile-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }

  .tile-btn {
    width: 52px;
    height: 52px;
    padding: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-primary);
    border: 2px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .tile-btn:hover {
    border-color: var(--text-muted);
  }

  .tile-btn.selected {
    border-color: var(--accent);
    background: var(--bg-active);
  }

  .tile-btn canvas {
    width: 48px;
    height: 48px;
    image-rendering: pixelated;
  }

  /* List view */
  .tile-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tile-list-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 6px;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .tile-list-item:hover {
    background: var(--bg-hover);
  }

  .tile-list-item.selected {
    background: var(--bg-active);
    outline: 1px solid var(--accent);
  }

  .tile-list-thumb {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-primary);
    border-radius: 3px;
    flex-shrink: 0;
    overflow: hidden;
  }

  .tile-list-thumb canvas {
    width: 36px;
    height: 36px;
    image-rendering: pixelated;
  }

  .tile-list-name {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Panel actions & view toggle */
  .panel-actions {
    display: flex;
    gap: 2px;
    align-items: center;
  }

  .view-toggle {
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
  }

  .view-toggle:hover {
    color: var(--text-primary);
  }

  .view-toggle.active {
    color: var(--accent);
    background: var(--bg-primary);
  }

  .slicer-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Folder manager */
  .folder-manager {
    padding: 4px 8px 6px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-secondary);
  }

  .folder-manager-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .folder-manager-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .folder-add-btn {
    width: 22px;
    height: 22px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .folder-add-btn:hover {
    background: var(--bg-hover);
  }

  .folder-empty {
    font-size: 11px;
    color: var(--text-muted);
    padding: 4px 0;
  }

  .folder-item {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 2px 4px;
    border-radius: var(--radius-sm);
    font-size: 11px;
    color: var(--text-secondary);
  }

  .folder-item:hover {
    background: var(--bg-hover);
  }

  .folder-icon {
    flex-shrink: 0;
    color: var(--text-muted);
  }

  .folder-path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .folder-remove-btn {
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.1s;
    flex-shrink: 0;
  }

  .folder-item:hover .folder-remove-btn {
    opacity: 1;
  }

  .folder-remove-btn:hover {
    color: var(--danger, #f38ba8);
  }

  .folder-sync-status {
    font-size: 10px;
    color: var(--accent);
    padding: 2px 0;
  }
</style>
