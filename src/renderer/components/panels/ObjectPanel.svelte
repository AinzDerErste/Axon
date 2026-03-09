<script lang="ts">
  import { onMount } from 'svelte'
  import {
    getSelectedObjectImage, setSelectedObjectImage,
    subscribe as objSelSubscribe
  } from '../../lib/stores/object-selection-store'
  import type { ObjectImage } from '../../lib/stores/object-selection-store'
  import {
    getObjectLibrary, addToLibrary, removeFromLibrary, updateInLibrary,
    subscribe as libSubscribe
  } from '../../lib/stores/object-library-store'
  import { getSettings, updateSettings } from '../../lib/stores/settings-store'
  import { registerImage, getBitmap } from '../../lib/stores/image-cache'

  let objectLibrary = $state<ObjectImage[]>([])
  let selectedIdx = $state(-1)
  let searchQuery = $state('')
  let searchInputRef = $state<HTMLInputElement | null>(null)
  let viewMode = $state<'list' | 'grid'>('list')
  let showFolderManager = $state(false)
  let watchFolders = $state<string[]>([])

  // Cache of known files per folder: folder → Map<fileName, mtimeMs>
  const folderFileCache = new Map<string, Map<string, number>>()
  let syncingFolders = $state(false)

  onMount(() => {
    const unsubSel = objSelSubscribe(() => {
      const sel = getSelectedObjectImage()
      if (sel) {
        selectedIdx = objectLibrary.findIndex(o => o.name === sel.name && o.imageDataUrl === sel.imageDataUrl)
      } else {
        selectedIdx = -1
      }
    })

    const unsubLib = libSubscribe(() => {
      objectLibrary = getObjectLibrary()
    })

    // Initialize from store
    objectLibrary = getObjectLibrary()
    watchFolders = [...getSettings().objectWatchFolders]

    // Initial sync of all watched folders
    if (watchFolders.length > 0) {
      syncAllFolders()
    }

    // Poll watched folders every 3 seconds
    const pollInterval = setInterval(() => {
      if (watchFolders.length > 0) syncAllFolders()
    }, 3000)

    return () => {
      unsubSel()
      unsubLib()
      clearInterval(pollInterval)
    }
  })

  /** Scan all watched folders and sync changes into the object library */
  async function syncAllFolders() {
    if (syncingFolders) return
    syncingFolders = true
    try {
      for (const folder of watchFolders) {
        await syncFolder(folder)
      }
    } finally {
      syncingFolders = false
    }
  }

  async function syncFolder(folderPath: string) {
    const meta = await window.electronAPI?.scanImageMeta(folderPath)
    if (!meta) return

    const cached = folderFileCache.get(folderPath) || new Map<string, number>()
    const currentNames = new Set<string>()

    for (const file of meta) {
      currentNames.add(file.name)
      const cachedMtime = cached.get(file.name)

      if (cachedMtime === undefined) {
        // New file — add to library
        const data = await window.electronAPI?.readImageFile(file.filePath)
        if (data) {
          const hash = await registerImage(data.data)
          const img = new Image()
          img.src = data.data
          await new Promise<void>(resolve => {
            img.onload = () => {
              addToLibrary({ name: data.name, imageDataUrl: data.data, imageBitmap: getBitmap(hash), imageHash: hash, width: img.naturalWidth, height: img.naturalHeight })
              resolve()
            }
            img.onerror = () => resolve()
          })
        }
        cached.set(file.name, file.mtimeMs)
      } else if (cachedMtime !== file.mtimeMs) {
        // Changed file — update in library
        const data = await window.electronAPI?.readImageFile(file.filePath)
        if (data) {
          const hash = await registerImage(data.data)
          const img = new Image()
          img.src = data.data
          await new Promise<void>(resolve => {
            img.onload = () => {
              updateInLibrary({ name: data.name, imageDataUrl: data.data, imageBitmap: getBitmap(hash), imageHash: hash, width: img.naturalWidth, height: img.naturalHeight })
              resolve()
            }
            img.onerror = () => resolve()
          })
        }
        cached.set(file.name, file.mtimeMs)
      }
    }

    // Deleted files — remove from library
    for (const [name] of cached) {
      if (!currentNames.has(name)) {
        removeFromLibrary(name)
        cached.delete(name)
      }
    }

    folderFileCache.set(folderPath, cached)
  }

  async function handleAddWatchFolder() {
    const folder = await window.electronAPI?.selectFolder()
    if (!folder) return
    if (watchFolders.includes(folder)) return
    watchFolders = [...watchFolders, folder]
    updateSettings({ objectWatchFolders: watchFolders })
    // Immediately sync the new folder
    await syncFolder(folder)
  }

  function handleRemoveWatchFolder(folder: string) {
    watchFolders = watchFolders.filter(f => f !== folder)
    updateSettings({ objectWatchFolders: watchFolders })
    folderFileCache.delete(folder)
  }

  function getFolderDisplayName(folderPath: string): string {
    const parts = folderPath.replace(/\\/g, '/').split('/')
    return parts[parts.length - 1] || folderPath
  }

  async function handleImportObjects() {
    const result = await window.electronAPI?.readImageFiles()
    if (!result || result.length === 0) return

    const wasEmpty = objectLibrary.length === 0

    for (const file of result) {
      // Check if already in library
      if (objectLibrary.some(o => o.name === file.name)) continue

      const hash = await registerImage(file.data)
      const img = new Image()
      img.src = file.data
      await new Promise<void>(resolve => {
        img.onload = () => {
          const objImg: ObjectImage = {
            name: file.name,
            imageDataUrl: file.data,
            imageBitmap: getBitmap(hash),
            imageHash: hash,
            width: img.naturalWidth,
            height: img.naturalHeight
          }
          addToLibrary(objImg)
          resolve()
        }
      })
    }

    // Auto-select first if library was empty
    const lib = getObjectLibrary()
    if (wasEmpty && lib.length > 0) {
      setSelectedObjectImage(lib[0])
    }
  }

  function selectObject(idx: number) {
    if (selectedIdx === idx) {
      // Toggle off: deselect stamp so select/drag works
      selectedIdx = -1
      setSelectedObjectImage(null)
    } else {
      selectedIdx = idx
      setSelectedObjectImage(objectLibrary[idx])
    }
  }

  function handleRemoveObject(idx: number, e: MouseEvent) {
    e.stopPropagation()
    const removed = objectLibrary[idx]
    removeFromLibrary(removed.name)
    if (getSelectedObjectImage()?.name === removed.name) {
      const lib = getObjectLibrary()
      setSelectedObjectImage(lib.length > 0 ? lib[0] : null)
    }
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      searchQuery = ''
      searchInputRef?.blur()
    }
  }

  function clearSearch() {
    searchQuery = ''
    searchInputRef?.focus()
  }
</script>

<div class="panel">
  <div class="panel-header">
    <span class="panel-title">Objects</span>
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
      <button class="icon-btn" title="Watch Folder" onclick={() => showFolderManager = !showFolderManager}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1 3.5A1.5 1.5 0 012.5 2h3.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.62 4H13.5A1.5 1.5 0 0115 5.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z"/>
        </svg>
      </button>
      <button class="icon-btn" title="Import Objects" onclick={handleImportObjects}>+</button>
    </div>
  </div>
  {#if showFolderManager}
    <div class="folder-manager">
      <div class="folder-manager-header">
        <span class="folder-manager-title">Watched Folders</span>
        <button class="icon-btn" title="Add Folder" onclick={handleAddWatchFolder}>+</button>
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
  <div class="panel-body">
    {#if objectLibrary.length === 0}
      <div class="empty-message">
        <button class="import-btn" onclick={handleImportObjects}>Import Images</button>
        <span>No objects loaded</span>
      </div>
    {:else}
      {#if objectLibrary.length > 0}
        <div class="search-input-wrapper">
          <input
            class="search-input"
            type="text"
            placeholder="Filter objects..."
            bind:value={searchQuery}
            bind:this={searchInputRef}
            onkeydown={handleSearchKeydown}
          />
          {#if searchQuery}
            <button class="search-clear" onclick={clearSearch} title="Clear">×</button>
          {/if}
        </div>
      {/if}
      {@const q = searchQuery.toLowerCase().trim()}
      {#if viewMode === 'list'}
        <div class="object-list">
          {#each objectLibrary as obj, idx}
            {#if !q || obj.name.toLowerCase().includes(q)}
            <div
              class="object-item"
              class:selected={idx === selectedIdx}
              onclick={() => selectObject(idx)}
              role="button"
              tabindex="0"
              onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') selectObject(idx) }}
              title={obj.name}
            >
              <div class="object-thumb">
                <img src={obj.imageDataUrl} alt={obj.name} />
              </div>
              <span class="object-name">{obj.name.replace(/\.[^.]+$/, '')}</span>
              <button
                class="remove-btn"
                title="Remove"
                onclick={(e: MouseEvent) => handleRemoveObject(idx, e)}
              >×</button>
            </div>
            {/if}
          {/each}
        </div>
      {:else}
        <div class="object-grid">
          {#each objectLibrary as obj, idx}
            {#if !q || obj.name.toLowerCase().includes(q)}
            <div
              class="object-grid-item"
              class:selected={idx === selectedIdx}
              onclick={() => selectObject(idx)}
              role="button"
              tabindex="0"
              onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') selectObject(idx) }}
              title={obj.name.replace(/\.[^.]+$/, '')}
            >
              <img src={obj.imageDataUrl} alt={obj.name} />
              <button
                class="grid-remove-btn"
                title="Remove"
                onclick={(e: MouseEvent) => handleRemoveObject(idx, e)}
              >×</button>
            </div>
            {/if}
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    border-bottom: 1px solid var(--border-color);
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

  .panel-actions {
    display: flex;
    gap: 2px;
  }

  .icon-btn {
    width: 22px;
    height: 22px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    border: none;
    background: transparent;
  }

  .icon-btn:hover {
    background: var(--bg-hover);
  }

  .panel-body {
    padding: 4px;
    max-height: 250px;
    overflow-y: auto;
  }

  .empty-message {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    padding: 12px 0;
  }

  .import-btn {
    padding: 4px 12px;
    font-size: var(--font-size-sm);
    border: 1px dashed var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .import-btn:hover {
    background: var(--bg-hover);
    border-color: var(--accent);
    color: var(--accent);
  }

  /* List view */
  .object-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .object-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    position: relative;
  }

  .object-item:hover {
    background: var(--bg-hover);
  }

  .object-item.selected {
    background: var(--bg-active);
  }

  .object-thumb {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: repeating-conic-gradient(#313244 0% 25%, #45475a 0% 50%) 50% / 8px 8px;
    border-radius: 3px;
    flex-shrink: 0;
    overflow: hidden;
  }

  .object-thumb img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    image-rendering: pixelated;
  }

  .object-name {
    font-size: var(--font-size-sm);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    opacity: 0;
    transition: opacity 0.1s;
  }

  .object-item:hover .remove-btn {
    opacity: 1;
  }

  .remove-btn:hover {
    color: var(--danger, #f38ba8);
  }

  /* Grid view */
  .object-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }

  .object-grid-item {
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
    position: relative;
    overflow: hidden;
  }

  .object-grid-item:hover {
    border-color: var(--text-muted);
  }

  .object-grid-item.selected {
    border-color: var(--accent);
    background: var(--bg-active);
  }

  .object-grid-item img {
    max-width: 48px;
    max-height: 48px;
    object-fit: contain;
    image-rendering: pixelated;
  }

  .grid-remove-btn {
    position: absolute;
    top: 1px;
    right: 1px;
    width: 14px;
    height: 14px;
    padding: 0;
    border: none;
    background: rgba(30, 30, 46, 0.8);
    color: var(--text-muted);
    font-size: 10px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 2px;
    opacity: 0;
    transition: opacity 0.1s;
  }

  .object-grid-item:hover .grid-remove-btn {
    opacity: 1;
  }

  .grid-remove-btn:hover {
    color: var(--danger, #f38ba8);
  }

  /* View toggle */
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

  /* Search input */
  .search-input-wrapper {
    padding: 4px 4px 2px 4px;
    position: relative;
  }

  .search-input {
    width: 100%;
    padding: 4px 24px 4px 8px;
    font-size: var(--font-size-sm);
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    outline: none;
    box-sizing: border-box;
  }

  .search-input:focus {
    border-color: var(--accent);
  }

  .search-input::placeholder {
    color: var(--text-muted);
  }

  .search-clear {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
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
  }

  .search-clear:hover {
    color: var(--text-primary);
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
