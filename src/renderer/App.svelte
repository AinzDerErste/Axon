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
  import { reconstructFromSections } from './lib/axon-v2-decode'
  import { FEATURES } from '../shared/feature-flags'
  import {
    getSettings, subscribe as settingsSubscribe
  } from './lib/stores/settings-store'

  let showNewMapDialog = $state(false)
  let showMapPropertiesDialog = $state(false)
  let showSettingsDialog = $state(false)
  let showAboutDialog = $state(false)
  let windowTitle = $state('Axon')
  let isSaving = $state(false)
  let isLoading = $state(false)
  let loadingMessage = $state('Loading...')

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
          if (getMap()) handleSave({ silent: true })
        }, s.autosaveInterval * 60 * 1000)
      }
    }

    setupAutosave()
    const unsubSettings = settingsSubscribe(setupAutosave)

    // Auto-reload project after page reload (Ctrl+R / HMR)
    if (currentFilePath && !getMap()) {
      isLoading = true
      loadingMessage = 'Reopening project...'
      ;(async () => {
        await yieldToUI()
        const t0 = performance.now()
        try {
          const result = await window.electronAPI.readProjectParsed(currentFilePath!)
          const tIpc = Math.round(performance.now() - t0)
          const tParseStart = performance.now()
          let project: any
          if (result.__format === 'v2-sections') {
            project = reconstructFromSections(result.sections)
          } else if (result.__format === 'json') {
            project = JSON.parse(result.json)
          } else {
            project = result.project
          }
          const tParse = Math.round(performance.now() - tParseStart)
          const bytes = result.bytes || 0
          const readMs = result.readMs || 0
          const timings = await loadProject(project)
          const ms = Math.round(performance.now() - t0)
          window.dispatchEvent(new CustomEvent('project-loaded', { detail: { ms, tIpc, readMs, tParse, bytes, ...timings } }))
        } catch (e) {
          console.error('Failed to restore project on reload:', e)
          setCurrentFilePath(null)
        } finally {
          isLoading = false
        }
      })()
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
      case 'export-tmx': if (FEATURES.tmxExport) handleExportTmx(); break
      case 'export-godot': if (FEATURES.godotExport) handleExportGodot(); break
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

  // Persist file path across HMR, page reloads, and app restarts via localStorage
  let currentFilePath: string | null = localStorage.getItem('currentFilePath')

  function setCurrentFilePath(path: string | null) {
    currentFilePath = path
    if (path) {
      localStorage.setItem('currentFilePath', path)
    } else {
      localStorage.removeItem('currentFilePath')
    }
  }

  /** Yield control to the browser every N rows to keep UI responsive */
  function yieldToUI(): Promise<void> {
    return new Promise(r => setTimeout(r, 0))
  }

  function formatSaveError(err: unknown): string {
    if (err instanceof RangeError && err.message === 'Invalid string length') {
      return 'Invalid string length — a single field (often one huge image or tile row) exceeds the maximum size. Try smaller assets, fewer embedded images, or link tilesets from a folder instead of pasting large images.'
    }
    return err instanceof Error ? err.message : String(err)
  }

  /**
   * Build the project object and save it in v2 binary format via the main process.
   * Image dedup, RLE tile encoding, and gzip compression happen in the codec.
   */
  function buildProjectPayload() {
    const map = getMap()!

    function resolveImage(o: { imageHash?: string; imageDataUrl: string }): string {
      return (o.imageHash && getDataUrl(o.imageHash)) || o.imageDataUrl
    }

    const layers = map.layers.map(l => {
      if (l.type === 'tile') {
        return { type: 'tile', id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, data: l.data }
      }
      if (l.type === 'object') {
        return {
          type: 'object', id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
          sortMode: l.sortMode || 'auto',
          groups: (l.groups || []).map(g => ({ id: g.id, name: g.name, expanded: g.expanded ?? true })),
          objects: l.objects.map(o => ({
            id: o.id, name: o.name, imageDataUrl: resolveImage(o),
            x: o.x, y: o.y, width: o.width, height: o.height,
            flipX: o.flipX || false, flipY: o.flipY || false,
            rotation: o.rotation || 0, locked: o.locked || false,
            visible: o.visible !== false, groupId: o.groupId || undefined
          })),
          zones: l.zones.map(z => ({
            id: z.id, name: z.name, color: z.color, points: z.points,
            closed: z.closed, zoneType: z.zoneType || 'zone'
          })),
          paths: (l.paths || []).map(p => ({
            id: p.id, name: p.name, color: p.color, points: p.points,
            loop: p.loop, assignedObjectId: p.assignedObjectId || undefined
          }))
        }
      }
      if (l.type === 'drawing') {
        return {
          type: 'drawing', id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
          objects: l.objects.map(o => ({
            id: o.id, name: o.name, imageDataUrl: resolveImage(o),
            x: o.x, y: o.y, width: o.width, height: o.height,
            flipX: o.flipX || false, flipY: o.flipY || false,
            rotation: o.rotation || 0, locked: o.locked || false,
            visible: o.visible !== false
          }))
        }
      }
      if (l.type === 'image') {
        return {
          type: 'image', id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
          imageDataUrl: resolveImage(l),
          x: l.x, y: l.y, width: l.width, height: l.height,
          isoTransform: l.isoTransform || false, rotation: l.rotation || 0,
          locked: l.locked || false
        }
      }
      return l
    })

    const tilesets = map.tilesets.map(ts => {
      const out: Record<string, unknown> = {
        id: ts.id, name: ts.name, tileWidth: ts.tileWidth, tileHeight: ts.tileHeight,
        columns: ts.columns, tiles: ts.tiles
      }
      if (ts.sourcePath) out.sourcePath = ts.sourcePath
      else out.imageDataUrl = resolveImage(ts)
      return out
    })

    const project = {
      version: 1,
      config: map.config,
      layers,
      tilesets,
      activeLayerId: map.activeLayerId,
      camera: { x: 0, y: 0, zoom: 1 },
      objectLibrary: serializeLibrary(),
      presets: serializePresets()
    }

    return project
  }

  /** Build the project object and save it in v3 binary format via the main process. */
  async function saveProjectV2(filePath: string) {
    const bytes = await window.electronAPI.saveProjectV2(filePath, buildProjectPayload())
    console.log(`[Axon] Saved: ${(bytes / 1024 / 1024).toFixed(1)} MB`)
  }

  let saveInProgress = false

  function reportSaveError(err: unknown, silent: boolean) {
    console.error('[Axon] Save failed:', err)
    const message = formatSaveError(err)
    if (silent) {
      // An autosave must never interrupt what the user is doing with a modal.
      window.dispatchEvent(new CustomEvent('project-save-failed', { detail: message }))
    } else {
      alert(`Save failed:\n${message}`)
    }
  }

  async function handleSave({ silent = false } = {}) {
    if (saveInProgress) return
    const map = getMap()
    if (!map) return
    if (!currentFilePath) {
      if (silent) { await autosaveToRecovery(map.config.name); return }
      await handleSaveAs()
      return
    }
    saveInProgress = true
    isSaving = !silent
    try {
      await new Promise<void>(r => requestAnimationFrame(() => setTimeout(r, 0)))
      await saveProjectV2(currentFilePath)
      updateTitle(map.config.name)
      window.dispatchEvent(new CustomEvent('project-saved', { detail: silent ? 'autosaved' : 'saved' }))
    } catch (err) {
      reportSaveError(err, silent)
    } finally {
      isSaving = false
      saveInProgress = false
    }
  }

  /**
   * Autosave for a project that has never been saved to a file. Writes into
   * the app's own data directory; previously a new map was simply never
   * autosaved, however long it had been worked on.
   */
  async function autosaveToRecovery(name: string) {
    if (saveInProgress) return
    saveInProgress = true
    try {
      const path = await window.electronAPI.saveRecovery(name, buildProjectPayload())
      window.dispatchEvent(new CustomEvent('project-saved', { detail: 'recovery', path }))
      console.log('[Axon] Autosaved unsaved project to', path)
    } catch (err) {
      reportSaveError(err, true)
    } finally {
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
      await new Promise<void>(r => requestAnimationFrame(() => setTimeout(r, 0)))
      await saveProjectV2(path)
      updateTitle(map.config.name)
      window.dispatchEvent(new CustomEvent('project-saved', { detail: 'saved' }))
    } catch (err) {
      console.error('[Axon] Save As failed:', err)
      alert(`Save failed:\n${formatSaveError(err)}`)
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
    isLoading = true
    loadingMessage = 'Opening project...'
    await yieldToUI()
    const t0 = performance.now()
    try {
      const result = await window.electronAPI.readProjectParsed(currentFilePath!)
      const tIpc = Math.round(performance.now() - t0)
      const tParseStart = performance.now()
      let project: any
      if (result.__format === 'v2-sections') {
        project = reconstructFromSections(result.sections)
      } else if (result.__format === 'json') {
        project = JSON.parse(result.json)
      } else {
        project = result.project
      }
      const tParse = Math.round(performance.now() - tParseStart)
      const bytes = result.bytes || 0
      const readMs = result.readMs || 0
      const timings = await loadProject(project)
      const ms = Math.round(performance.now() - t0)
      window.dispatchEvent(new CustomEvent('project-loaded', { detail: { ms, tIpc, readMs, tParse, bytes, ...timings } }))
    } catch (err) {
      console.error('[Axon] Open failed:', err)
      alert(`Failed to open project:\n${err instanceof Error ? err.message : String(err)}`)
      setCurrentFilePath(null)
    } finally {
      isLoading = false
    }
  }

  async function loadProject(project: any): Promise<{ tImages: number; imgCount: number; tLib: number; tMap: number }> {
    // Clear previous project's image cache (closes all ImageBitmaps)
    clearImageCache()

    // Register all images in central cache in parallel
    const imagePromises: Promise<void>[] = []

    // Tilesets (inline data URL, or reload from linked file path)
    for (const ts of project.tilesets) {
      if (ts.imageDataUrl) {
        imagePromises.push(registerImage(ts.imageDataUrl).then(h => { ts.imageHash = h }))
      } else if (ts.sourcePath) {
        imagePromises.push(
          (async () => {
            const result = await window.electronAPI.readImageFile(ts.sourcePath)
            if (!result?.data) {
              console.error('[Axon] Tileset image missing:', ts.sourcePath)
              return
            }
            ts.imageDataUrl = result.data
            const h = await registerImage(result.data)
            ts.imageHash = h
          })()
        )
      }
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

    // Include library image registration in the same parallel batch
    if (project.objectLibrary && Array.isArray(project.objectLibrary)) {
      for (const item of project.objectLibrary) {
        if (item.imageDataUrl) {
          imagePromises.push(registerImage(item.imageDataUrl).then(h => { item._hash = h }))
        }
      }
    }

    // Wait for all image registrations to complete (tilesets + objects + library)
    const tImgStart = performance.now()
    await Promise.all(imagePromises)
    const tImages = Math.round(performance.now() - tImgStart)

    // Restore object library (bitmaps already cached, no extra decode)
    const tLibStart = performance.now()
    if (project.objectLibrary && Array.isArray(project.objectLibrary)) {
      await deserializeLibrary(project.objectLibrary)
    } else {
      clearLibrary()
    }
    const tLib = Math.round(performance.now() - tLibStart)

    // Restore presets
    if (project.presets && Array.isArray(project.presets)) {
      deserializePresets(project.presets)
    } else {
      clearPresets()
    }

    const tMapStart = performance.now()
    setMap({
      config: project.config,
      layers: project.layers,
      tilesets: project.tilesets,
      activeLayerId: project.activeLayerId
    })
    const tMap = Math.round(performance.now() - tMapStart)
    updateTitle(project.config.name)
    return { tImages, imgCount: imagePromises.length, tLib, tMap }
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

{#if isSaving || isLoading}
  <div class="loading-overlay">
    <div class="loading-spinner"></div>
    <span class="loading-text">{isSaving ? 'Saving...' : loadingMessage}</span>
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

  .loading-overlay {
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

  .loading-spinner {
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

  .loading-text {
    font-size: 14px;
    color: var(--text-primary);
    font-weight: 600;
  }
</style>
