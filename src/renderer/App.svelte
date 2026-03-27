<script lang="ts">
  import { onMount } from 'svelte'
  import TitleBar from './components/layout/TitleBar.svelte'
  import Toolbar from './components/layout/Toolbar.svelte'
  import Sidebar from './components/layout/Sidebar.svelte'
  import StatusBar from './components/layout/StatusBar.svelte'
  import UpdateToast from './components/layout/UpdateToast.svelte'
  import GpuToast from './components/layout/GpuToast.svelte'
  import MapCanvas from './components/canvas/MapCanvas.svelte'
  import NewMapDialog from './components/dialogs/NewMapDialog.svelte'
  import MapPropertiesDialog from './components/dialogs/MapPropertiesDialog.svelte'
  import SettingsDialog from './components/dialogs/SettingsDialog.svelte'
  import AboutDialog from './components/dialogs/AboutDialog.svelte'
  import { undo, redo, getHistory } from './lib/stores/history-store'
  import { getMap, setMap, sanitizeConfig } from './lib/stores/map-store'
  import {
    serializeLibrary, deserializeLibrary, clearLibrary
  } from './lib/stores/object-library-store'
  import {
    serializePresets, deserializePresets, clearPresets
  } from './lib/stores/preset-store'
  import {
    registerImage, getDataUrl, clearAll as clearImageCache
  } from './lib/stores/image-cache'
  import {
    getSettings, subscribe as settingsSubscribe
  } from './lib/stores/settings-store'

  let showNewMapDialog = $state(false)
  let showMapPropertiesDialog = $state(false)
  let showSettingsDialog = $state(false)
  let showAboutDialog = $state(false)
  let windowTitle = $state('Axon')
  let isSaving = $state(false)

  // Resizable sidebar
  const SIDEBAR_MIN = 200
  const SIDEBAR_MAX = 500
  const SIDEBAR_DEFAULT = 280
  const SIDEBAR_STORAGE_KEY = 'sidebarWidth'

  let sidebarWidth = $state(loadSidebarWidth())
  let isResizingSidebar = $state(false)
  let resizeStartX = 0
  let resizeStartWidth = 0

  function loadSidebarWidth(): number {
    try {
      const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY)
      if (stored) {
        const val = parseInt(stored, 10)
        if (!isNaN(val) && val >= SIDEBAR_MIN && val <= SIDEBAR_MAX) return val
      }
    } catch { /* ignore */ }
    return SIDEBAR_DEFAULT
  }

  function startSidebarResize(e: PointerEvent) {
    isResizingSidebar = true
    resizeStartX = e.clientX
    resizeStartWidth = sidebarWidth
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  function onResizeMove(e: PointerEvent) {
    if (!isResizingSidebar) return
    const dx = resizeStartX - e.clientX  // drag left = wider
    const newWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, resizeStartWidth + dx))
    sidebarWidth = newWidth
  }

  function onResizeEnd(_e: PointerEvent) {
    if (!isResizingSidebar) return
    isResizingSidebar = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarWidth)) } catch { /* ignore */ }
  }

  onMount(() => {
    // Apply persisted settings on startup (e.g., maxUndo)
    const initialSettings = getSettings()
    getHistory().maxSize = initialSettings.maxUndo

    // Listen for new map dialog trigger from toolbar
    function handleShowDialog() { showNewMapDialog = true }
    window.addEventListener('show-new-map-dialog', handleShowDialog)

    // Listen for menu actions from main process (keyboard accelerators)
    if (window.electronAPI?.onMenuAction) {
      window.electronAPI.onMenuAction((action: string) => handleMenuAction(action))
    }

    function handleTitleChanged(e: Event) {
      windowTitle = (e as CustomEvent).detail
    }
    window.addEventListener('title-changed', handleTitleChanged)

    // Autosave timer
    let autosaveTimer: ReturnType<typeof setInterval> | null = null

    function setupAutosave() {
      if (autosaveTimer) { clearInterval(autosaveTimer); autosaveTimer = null }
      const s = getSettings()
      if (s.autosaveEnabled && s.autosaveInterval > 0) {
        autosaveTimer = setInterval(() => {
          if (currentFilePath && getMap()) {
            handleSave()
          }
        }, s.autosaveInterval * 60 * 1000)
      }
    }

    setupAutosave()
    const unsubSettings = settingsSubscribe(setupAutosave)

    // Auto-reload project after page reload (Ctrl+R / HMR)
    if (currentFilePath && !getMap()) {
      window.electronAPI.readFile(currentFilePath).then(async (data: string) => {
        try {
          const project = JSON.parse(data)
          await loadProject(project)
        } catch (e) {
          console.error('Failed to restore project on reload:', e)
          setCurrentFilePath(null)
        }
      }).catch(() => {
        setCurrentFilePath(null)
      })
    }

    return () => {
      window.removeEventListener('show-new-map-dialog', handleShowDialog)
      window.removeEventListener('title-changed', handleTitleChanged)
      if (autosaveTimer) clearInterval(autosaveTimer)
      unsubSettings()
    }
  })

  function handleMenuAction(action: string) {
    switch (action) {
      case 'new-map':
        clearImageCache()
        showNewMapDialog = true
        setCurrentFilePath(null)
        break
      case 'undo': undo(); break
      case 'redo': redo(); break
      case 'save': handleSave(); break
      case 'save-as': handleSaveAs(); break
      case 'open': handleOpen(); break
      case 'export-png': handleExportPng(); break
      case 'export-json': handleExportJson(); break
      case 'export-tmx': handleExportTmx(); break
      case 'export-godot': handleExportGodot(); break
      case 'map-properties': showMapPropertiesDialog = true; break
      case 'toggle-grid': window.dispatchEvent(new CustomEvent('toggle-grid')); break
      case 'settings': showSettingsDialog = true; break
      case 'about': showAboutDialog = true; break
      case 'check-for-updates':
        window.dispatchEvent(new CustomEvent('update:check'))
        break
    }
  }

  function updateTitle(name: string) {
    windowTitle = `Axon - ${name}`
    window.electronAPI?.setTitle(windowTitle)
  }

  // Persist file path across HMR / page reloads via sessionStorage
  let currentFilePath: string | null = sessionStorage.getItem('currentFilePath')

  function setCurrentFilePath(path: string | null) {
    currentFilePath = path
    if (path) {
      sessionStorage.setItem('currentFilePath', path)
    } else {
      sessionStorage.removeItem('currentFilePath')
    }
  }

  /**
   * Serialize the project in async chunks so the UI thread stays responsive.
   * Large tile layers are serialized row-by-row with periodic yields.
   */
  async function deferSerialize(): Promise<string> {
    // Wait one frame so the saving overlay can render
    await new Promise<void>(r => requestAnimationFrame(() => setTimeout(r, 0)))
    return await serializeProjectAsync()
  }

  /** Yield control to the browser every N rows to keep UI responsive */
  function yieldToUI(): Promise<void> {
    return new Promise(r => setTimeout(r, 0))
  }

  async function serializeProjectAsync(): Promise<string> {
    const map = getMap()!
    const ROWS_PER_CHUNK = 200

    const serializedLayers: any[] = []
    for (const l of map.layers) {
      if (l.type === 'tile') {
        // Serialize tile data in chunks to avoid blocking
        const rows: any[] = []
        for (let r = 0; r < l.data.length; r++) {
          rows.push(l.data[r])
          if (r > 0 && r % ROWS_PER_CHUNK === 0) {
            await yieldToUI()
          }
        }
        serializedLayers.push({
          type: 'tile', id: l.id, name: l.name,
          visible: l.visible, opacity: l.opacity, data: rows
        })
        continue
      }
      if (l.type === 'object') {
        serializedLayers.push({
          type: 'object',
          id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
          sortMode: l.sortMode || 'auto',
          groups: (l.groups || []).map(g => ({
            id: g.id, name: g.name, expanded: g.expanded ?? true
          })),
          objects: l.objects.map(o => ({
            id: o.id, name: o.name,
            imageDataUrl: (o.imageHash && getDataUrl(o.imageHash)) || o.imageDataUrl,
            x: o.x, y: o.y, width: o.width, height: o.height,
            flipX: o.flipX || false, flipY: o.flipY || false,
            rotation: o.rotation || 0,
            locked: o.locked || false,
            visible: o.visible !== false,
            groupId: o.groupId || undefined
          })),
          zones: l.zones.map(z => ({
            id: z.id, name: z.name, color: z.color,
            points: z.points, closed: z.closed,
            zoneType: z.zoneType || 'zone'
          })),
          paths: (l.paths || []).map(p => ({
            id: p.id, name: p.name, color: p.color,
            points: p.points, loop: p.loop,
            assignedObjectId: p.assignedObjectId || undefined
          }))
        })
        continue
      }
      if (l.type === 'drawing') {
        serializedLayers.push({
          type: 'drawing',
          id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
          objects: l.objects.map(o => ({
            id: o.id, name: o.name,
            imageDataUrl: (o.imageHash && getDataUrl(o.imageHash)) || o.imageDataUrl,
            x: o.x, y: o.y, width: o.width, height: o.height,
            flipX: o.flipX || false, flipY: o.flipY || false,
            rotation: o.rotation || 0,
            locked: o.locked || false,
            visible: o.visible !== false
          }))
        })
        continue
      }
      if (l.type === 'image') {
        serializedLayers.push({
          type: 'image',
          id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
          imageDataUrl: (l.imageHash && getDataUrl(l.imageHash)) || l.imageDataUrl,
          x: l.x, y: l.y, width: l.width, height: l.height,
          isoTransform: l.isoTransform || false,
          rotation: l.rotation || 0,
          locked: l.locked || false
        })
        continue
      }
    }

    await yieldToUI()

    return JSON.stringify({
      version: 1,
      config: map.config,
      layers: serializedLayers,
      tilesets: map.tilesets.map(ts => ({
        id: ts.id,
        name: ts.name,
        imageDataUrl: (ts.imageHash && getDataUrl(ts.imageHash)) || ts.imageDataUrl,
        tileWidth: ts.tileWidth,
        tileHeight: ts.tileHeight,
        columns: ts.columns,
        tiles: ts.tiles,
        ...(ts.sourcePath ? { sourcePath: ts.sourcePath } : {})
      })),
      activeLayerId: map.activeLayerId,
      camera: { x: 0, y: 0, zoom: 1 },
      objectLibrary: serializeLibrary(),
      presets: serializePresets()
    })
  }

  let saveInProgress = false

  async function handleSave() {
    if (saveInProgress) return
    const map = getMap()
    if (!map) return
    if (!currentFilePath) { await handleSaveAs(); return }
    saveInProgress = true
    isSaving = true
    try {
      const data = await deferSerialize()
      await window.electronAPI.writeFile(currentFilePath, data)
      updateTitle(map.config.name)
      window.dispatchEvent(new CustomEvent('project-saved', { detail: 'saved' }))
    } catch (err) {
      console.error('[Axon] Save failed:', err)
      alert(`Speichern fehlgeschlagen:\n${err instanceof Error ? err.message : String(err)}`)
    } finally {
      isSaving = false
      saveInProgress = false
    }
  }

  async function handleSaveAs() {
    if (saveInProgress) return
    const map = getMap()
    if (!map) return
    // Set the flag synchronously before the first await so that any concurrent
    // save triggered while the dialog is open (e.g. rapid Ctrl+S) is blocked.
    saveInProgress = true
    try {
      const path = await window.electronAPI.showSaveDialog({
        filters: [{ name: 'Axon Map Project', extensions: ['axon'] }],
        defaultPath: map.config.name + '.axon'
      })
      if (!path) return
      setCurrentFilePath(path)
      isSaving = true
      const data = await deferSerialize()
      await window.electronAPI.writeFile(path, data)
      updateTitle(map.config.name)
      window.dispatchEvent(new CustomEvent('project-saved', { detail: 'saved' }))
    } catch (err) {
      console.error('[Axon] Save As failed:', err)
      alert(`Speichern fehlgeschlagen:\n${err instanceof Error ? err.message : String(err)}`)
    } finally {
      isSaving = false
      saveInProgress = false
    }
  }

  async function handleOpen() {
    const paths = await window.electronAPI.showOpenDialog({
      filters: [{ name: 'Axon Map Project', extensions: ['axon'] }],
      properties: ['openFile']
    })
    if (!paths || paths.length === 0) return
    setCurrentFilePath(paths[0])
    const data = await window.electronAPI.readFile(currentFilePath!)
    const project = JSON.parse(data)
    await loadProject(project)
  }

  async function loadProject(project: any) {
    // Clear previous project's image cache (closes all ImageBitmaps)
    clearImageCache()

    // Register all images in central cache in parallel
    const imagePromises: Promise<void>[] = []

    // Tilesets
    for (const ts of project.tilesets) {
      imagePromises.push(registerImage(ts.imageDataUrl).then(h => { ts.imageHash = h }))
    }

    // Backward compat: default orientation
    if (!project.config.orientation) project.config.orientation = 'diamond'

    // Sanitize grid dimensions to prevent freeze on oversized projects
    project.config = sanitizeConfig(project.config)

    // Trim tile layer data to match sanitized grid dimensions
    for (const layer of project.layers) {
      if (layer.type === 'tile' && Array.isArray(layer.data)) {
        if (layer.data.length > project.config.gridHeight) {
          layer.data.length = project.config.gridHeight
        }
        for (let r = 0; r < layer.data.length; r++) {
          if (Array.isArray(layer.data[r]) && layer.data[r].length > project.config.gridWidth) {
            layer.data[r].length = project.config.gridWidth
          }
        }
      }
    }

    // Reconstitute object layer images and ensure layer types
    for (const layer of project.layers) {
      if (!layer.type) layer.type = 'tile' // Backward compat
      if (layer.type === 'object') {
        if (!layer.zones) layer.zones = []
        if (!layer.paths) layer.paths = []
        if (!layer.groups) layer.groups = []
        // Backward compat: default zoneType to 'zone'
        for (const zone of layer.zones) {
          if (!zone.zoneType) zone.zoneType = 'zone'
        }
        for (const obj of layer.objects) {
          if (obj.imageDataUrl) {
            imagePromises.push(registerImage(obj.imageDataUrl).then(h => { obj.imageHash = h }))
          }
        }
      }
      if (layer.type === 'drawing') {
        for (const obj of layer.objects) {
          if (obj.imageDataUrl) {
            imagePromises.push(registerImage(obj.imageDataUrl).then(h => { obj.imageHash = h }))
          }
        }
      }
      if (layer.type === 'image' && layer.imageDataUrl) {
        imagePromises.push(registerImage(layer.imageDataUrl).then(h => { layer.imageHash = h }))
      }
    }

    // Wait for all image registrations to complete
    await Promise.all(imagePromises)

    // Restore object library
    if (project.objectLibrary && Array.isArray(project.objectLibrary)) {
      await deserializeLibrary(project.objectLibrary)
    } else {
      clearLibrary()
    }

    // Restore presets
    if (project.presets && Array.isArray(project.presets)) {
      deserializePresets(project.presets)
    } else {
      clearPresets()
    }

    setMap({
      config: project.config,
      layers: project.layers,
      tilesets: project.tilesets,
      activeLayerId: project.activeLayerId
    })
    updateTitle(project.config.name)
  }

  async function handleExportPng() {
    const map = getMap()
    if (!map) return
    // Import dynamically to keep initial load light
    const { exportMapAsPng } = await import('./lib/export/png-exporter')
    const blob = await exportMapAsPng(map)
    const buffer = await blob.arrayBuffer()
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
    const path = await window.electronAPI.showSaveDialog({
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
      defaultPath: map.config.name + '.png'
    })
    if (!path) return
    await window.electronAPI.writeFile(path, `data:image/png;base64,${base64}`)
  }

  async function handleExportJson() {
    const map = getMap()
    if (!map) return
    const { exportMapAsJson } = await import('./lib/export/json-exporter')
    const json = exportMapAsJson(map)
    const path = await window.electronAPI.showSaveDialog({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      defaultPath: map.config.name + '.json'
    })
    if (!path) return
    await window.electronAPI.writeFile(path, json)
  }

  /** Save tileset/image layer images alongside an export file */
  async function saveTilesetImages(
    exportPath: string,
    images: { filename: string; dataUrl: string }[]
  ) {
    if (images.length === 0) return
    // Determine directory from export path (handle both / and \)
    const dir = exportPath.replace(/[/\\][^/\\]+$/, '') + '/tilesets'
    await window.electronAPI.ensureDir(dir)
    for (const img of images) {
      await window.electronAPI.writeFile(dir + '/' + img.filename, img.dataUrl)
    }
  }

  async function handleExportTmx() {
    const map = getMap()
    if (!map) return
    isSaving = true
    try {
      const { exportMapAsTmx } = await import('./lib/export/tmx-exporter')
      const result = exportMapAsTmx(map)
      const path = await window.electronAPI.showSaveDialog({
        filters: [{ name: 'Tiled Map (TMX)', extensions: ['tmx'] }],
        defaultPath: map.config.name + '.tmx'
      })
      if (!path) return
      await saveTilesetImages(path, result.tilesetImages)
      await window.electronAPI.writeFile(path, result.tmxContent)
    } finally {
      isSaving = false
    }
  }

  async function handleExportGodot() {
    const map = getMap()
    if (!map) return
    isSaving = true
    try {
      const { exportMapAsGodot } = await import('./lib/export/godot-exporter')
      const result = exportMapAsGodot(map)
      const path = await window.electronAPI.showSaveDialog({
        filters: [{ name: 'Godot Scene', extensions: ['tscn'] }],
        defaultPath: map.config.name + '.tscn'
      })
      if (!path) return
      await saveTilesetImages(path, result.tilesetImages)
      await window.electronAPI.writeFile(path, result.tscnContent)
    } finally {
      isSaving = false
    }
  }
</script>

<NewMapDialog bind:show={showNewMapDialog} onclose={() => {}} />
<MapPropertiesDialog bind:show={showMapPropertiesDialog} />
<SettingsDialog bind:show={showSettingsDialog} />
<AboutDialog bind:show={showAboutDialog} />

<div class="app-layout">
  <TitleBar title={windowTitle} onaction={handleMenuAction} />
  <Toolbar />
  <div class="main-area">
    <div class="canvas-container">
      <MapCanvas />
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="sidebar-resize-handle"
      class:active={isResizingSidebar}
      onpointerdown={startSidebarResize}
      onpointermove={onResizeMove}
      onpointerup={onResizeEnd}
    ></div>
    <Sidebar width={sidebarWidth} />
  </div>
  <StatusBar />
</div>
<UpdateToast />
<GpuToast />

{#if isSaving}
  <div class="saving-overlay">
    <div class="saving-spinner"></div>
    <span class="saving-text">Saving...</span>
  </div>
{/if}

<style>
  .app-layout {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .main-area {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .canvas-container {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .sidebar-resize-handle {
    width: 4px;
    cursor: col-resize;
    background: transparent;
    transition: background 0.15s;
    flex-shrink: 0;
    z-index: 10;
  }

  .sidebar-resize-handle:hover,
  .sidebar-resize-handle.active {
    background: var(--accent);
  }

  .saving-overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    background: rgba(0, 0, 0, 0.45);
    pointer-events: all;
  }

  .saving-spinner {
    width: 18px;
    height: 18px;
    border: 2.5px solid var(--text-muted);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .saving-text {
    font-size: 14px;
    color: var(--text-primary);
    font-weight: 600;
  }
</style>
