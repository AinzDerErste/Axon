<script lang="ts">
  import { onMount } from 'svelte'
  import { MapRenderer, getNextZoneColor, getNextPathColor, type PreviewObject } from '../../lib/engine/renderer'
  import { screenToMap, snapToTileCorner } from '../../lib/engine/iso-math'
  import {
    getMap, setActiveLayer, updateImageLayer, updateObject,
    addGroupToLayer, setObjectGroup, setLayerSortMode, addDrawingLayer,
    subscribe as mapSubscribe
  } from '../../lib/stores/map-store'
  import { setHover, setZoomPercent } from '../../lib/stores/ui-store'
  import { getActiveTool, setActiveTool } from '../../lib/stores/tool-store'
  import { getHistory, executeCommand } from '../../lib/stores/history-store'
  import { PaintCommand } from '../../lib/commands/paint-command'
  import { EraseCommand } from '../../lib/commands/erase-command'
  import { FillCommand, estimateFillCount } from '../../lib/commands/fill-command'
  import { getSettings } from '../../lib/stores/settings-store'
  import { PlaceObjectCommand, MoveObjectCommand, DeleteObjectCommand, ReorderObjectCommand, BatchCommand } from '../../lib/commands/object-command'
  import { AddZoneCommand, DeleteZoneCommand } from '../../lib/commands/zone-command'
  import { AddPathCommand, DeletePathCommand } from '../../lib/commands/path-command'
  import { getSelectedTile } from '../../lib/stores/tile-selection-store'
  import { getSelectedObjectImage, subscribe as objSelSubscribe } from '../../lib/stores/object-selection-store'
  import {
    getSelection, selectObject, selectZone, selectPath, selectImageLayer, clearSelection,
    toggleObjectSelection, getSelectedObjectIds, isObjectSelected, selectObjects,
    subscribe as selSubscribe
  } from '../../lib/stores/selection-store'
  import type { TileRef } from '../../lib/models/tile'
  import type { MapObject, ImageLayer } from '../../lib/models/layer'
  import { getSketchSettings, subscribe as sketchSubscribe } from '../../lib/stores/sketch-store'
  import {
    getPresets, addPreset, getSelectedPresetId, getPresetById, selectPreset,
    getPresetObjectBitmap,
    subscribe as presetSubscribe
  } from '../../lib/stores/preset-store'
  import { PlacePresetCommand } from '../../lib/commands/preset-command'
  import { mapToScreen } from '../../lib/engine/iso-math'
  import type { Preset, PresetObject, PresetZone } from '../../lib/models/preset'
  import { matchesKey } from '../../lib/stores/keybindings-store'
  import { registerImage, registerImageSync, getBitmap } from '../../lib/stores/image-cache'
  import SketchToolbar from './SketchToolbar.svelte'

  let canvasEl: HTMLCanvasElement
  let containerEl: HTMLDivElement
  let renderer: MapRenderer

  let isPanning = false
  let isDrawing = false
  let lastPointerX = 0
  let lastPointerY = 0
  let spaceHeld = false
  let paintedCells = new Set<string>()
  let strokePositions: { row: number; col: number }[] = []
  let strokePreviousTiles: (TileRef | null)[] = []

  // Fill confirmation dialog state
  let showFillConfirm = $state(false)
  let pendingFillCount = $state(0)
  // Store the fill parameters so we only run the full BFS after confirmation
  let pendingFillParams: {
    layerId: string
    col: number
    row: number
    selectedTile: TileRef
    layerData: (TileRef | null)[][]
    gridWidth: number
    gridHeight: number
    orientation: import('../../lib/models/map').Orientation
  } | null = null

  function confirmFill() {
    if (pendingFillParams) {
      const p = pendingFillParams
      const cmd = new FillCommand(p.layerId, p.col, p.row, p.selectedTile, p.layerData, p.gridWidth, p.gridHeight, p.orientation)
      executeCommand(cmd)
      renderer.markDirty()
    }
    pendingFillParams = null
    showFillConfirm = false
    pendingFillCount = 0
  }

  function cancelFill() {
    pendingFillParams = null
    showFillConfirm = false
    pendingFillCount = 0
  }

  function commitPath(layer: import('../../lib/models/layer').ObjectLayer, points: { x: number; y: number }[], loop: boolean) {
    const path = {
      id: crypto.randomUUID(),
      name: `Path ${layer.paths.length + 1}`,
      color: renderer.activePathColor,
      points,
      loop
    }
    const cmd = new AddPathCommand(layer.id, path)
    executeCommand(cmd)
    renderer.activePathPoints = []
    renderer.pathMousePos = null
    renderer.activePathColor = getNextPathColor()
    renderer.markDirty()
  }

  // Object clipboard for copy/paste/duplicate
  let clipboardObject: MapObject | null = null
  let clipboardObjects: MapObject[] = []
  let clipboardLayerId: string | null = null

  // Object dragging state
  let isDraggingObject = false
  let dragObject: MapObject | null = null
  let dragStartX = 0
  let dragStartY = 0
  let dragObjStartX = 0
  let dragObjStartY = 0

  // Multi-object drag state
  let isDraggingMultiObjects = false
  let dragMultiObjects: { obj: MapObject; startX: number; startY: number }[] = []
  let multiDragStartX = 0
  let multiDragStartY = 0

  // Canvas context menu state
  let showCanvasContextMenu = $state(false)
  let ctxMenuX = $state(0)
  let ctxMenuY = $state(0)
  let ctxMenuObjId = $state<string | null>(null)
  let ctxMenuLayerId = $state<string | null>(null)

  function closeCanvasContextMenu() {
    showCanvasContextMenu = false
    ctxMenuObjId = null
    ctxMenuLayerId = null
  }

  // Context menu actions
  function ctxLock() {
    if (!ctxMenuLayerId) return
    const sel = getSelection()
    const ids = sel?.type === 'objects' ? sel.objectIds : ctxMenuObjId ? [ctxMenuObjId] : []
    for (const id of ids) {
      updateObject(ctxMenuLayerId, id, { locked: true })
    }
    closeCanvasContextMenu()
  }

  function ctxUnlock() {
    if (!ctxMenuLayerId) return
    const sel = getSelection()
    const ids = sel?.type === 'objects' ? sel.objectIds : ctxMenuObjId ? [ctxMenuObjId] : []
    for (const id of ids) {
      updateObject(ctxMenuLayerId, id, { locked: false })
    }
    closeCanvasContextMenu()
  }

  function ctxShow() {
    if (!ctxMenuLayerId) return
    const sel = getSelection()
    const ids = sel?.type === 'objects' ? sel.objectIds : ctxMenuObjId ? [ctxMenuObjId] : []
    for (const id of ids) {
      updateObject(ctxMenuLayerId, id, { visible: true })
    }
    closeCanvasContextMenu()
    renderer.markDirty()
  }

  function ctxHide() {
    if (!ctxMenuLayerId) return
    const sel = getSelection()
    const ids = sel?.type === 'objects' ? sel.objectIds : ctxMenuObjId ? [ctxMenuObjId] : []
    for (const id of ids) {
      updateObject(ctxMenuLayerId, id, { visible: false })
    }
    closeCanvasContextMenu()
    renderer.markDirty()
  }

  function ctxDelete() {
    if (!ctxMenuLayerId) return
    const map = getMap()
    if (!map) return
    const layer = map.layers.find(l => l.id === ctxMenuLayerId)
    if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return
    const sel = getSelection()
    const ids = sel?.type === 'objects' ? sel.objectIds : ctxMenuObjId ? [ctxMenuObjId] : []
    const cmds: DeleteObjectCommand[] = []
    for (const id of ids) {
      const obj = layer.objects.find(o => o.id === id)
      if (obj && !obj.locked) cmds.push(new DeleteObjectCommand(ctxMenuLayerId, obj))
    }
    if (cmds.length === 1) {
      executeCommand(cmds[0])
    } else if (cmds.length > 1) {
      executeCommand(new BatchCommand('Delete objects', cmds))
    }
    clearSelection()
    closeCanvasContextMenu()
    renderer.markDirty()
  }

  function ctxCopy() {
    if (!ctxMenuLayerId) return
    const map = getMap()
    if (!map) return
    const layer = map.layers.find(l => l.id === ctxMenuLayerId)
    if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return
    const sel = getSelection()
    if (sel?.type === 'objects') {
      clipboardObjects = sel.objectIds
        .map(id => layer.objects.find(o => o.id === id))
        .filter((o): o is MapObject => !!o)
        .map(o => ({ ...o }))
      clipboardObject = null
    } else if (ctxMenuObjId) {
      const obj = layer.objects.find(o => o.id === ctxMenuObjId)
      if (obj) {
        clipboardObject = { ...obj }
        clipboardObjects = []
      }
    }
    clipboardLayerId = ctxMenuLayerId
    closeCanvasContextMenu()
  }

  function ctxDuplicate() {
    if (!ctxMenuLayerId) return
    const map = getMap()
    if (!map) return
    const layer = map.layers.find(l => l.id === ctxMenuLayerId)
    if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return
    const sel = getSelection()
    const ids = sel?.type === 'objects' ? sel.objectIds : ctxMenuObjId ? [ctxMenuObjId] : []
    const cmds: PlaceObjectCommand[] = []
    const newIds: string[] = []
    for (const id of ids) {
      const obj = layer.objects.find(o => o.id === id)
      if (obj) {
        const newObj: MapObject = { ...obj, id: crypto.randomUUID(), x: obj.x + 20, y: obj.y + 20 }
        cmds.push(new PlaceObjectCommand(ctxMenuLayerId!, newObj))
        newIds.push(newObj.id)
      }
    }
    if (cmds.length === 1) {
      executeCommand(cmds[0])
      selectObject(ctxMenuLayerId!, newIds[0])
    } else if (cmds.length > 1) {
      executeCommand(new BatchCommand('Duplicate objects', cmds))
      selectObjects(ctxMenuLayerId!, newIds)
    }
    closeCanvasContextMenu()
    renderer.markDirty()
  }

  function ctxFlipX() {
    if (!ctxMenuLayerId) return
    const sel = getSelection()
    const ids = sel?.type === 'objects' ? sel.objectIds : ctxMenuObjId ? [ctxMenuObjId] : []
    const map = getMap()
    if (!map) return
    const layer = map.layers.find(l => l.id === ctxMenuLayerId)
    if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return
    for (const id of ids) {
      const obj = layer.objects.find(o => o.id === id)
      if (obj && !obj.locked) updateObject(ctxMenuLayerId, id, { flipX: !obj.flipX })
    }
    closeCanvasContextMenu()
    renderer.markDirty()
  }

  function ctxFlipY() {
    if (!ctxMenuLayerId) return
    const sel = getSelection()
    const ids = sel?.type === 'objects' ? sel.objectIds : ctxMenuObjId ? [ctxMenuObjId] : []
    const map = getMap()
    if (!map) return
    const layer = map.layers.find(l => l.id === ctxMenuLayerId)
    if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return
    for (const id of ids) {
      const obj = layer.objects.find(o => o.id === id)
      if (obj && !obj.locked) updateObject(ctxMenuLayerId, id, { flipY: !obj.flipY })
    }
    closeCanvasContextMenu()
    renderer.markDirty()
  }

  function ctxNewGroupWithSelection() {
    if (!ctxMenuLayerId) return
    const map = getMap()
    if (!map) return
    const layer = map.layers.find(l => l.id === ctxMenuLayerId)
    if (!layer || layer.type !== 'object') return
    const sel = getSelection()
    const ids = sel?.type === 'objects' ? sel.objectIds : ctxMenuObjId ? [ctxMenuObjId] : []
    const count = (layer.groups || []).length
    const group = addGroupToLayer(ctxMenuLayerId, `Group ${count + 1}`)
    if (group) {
      for (const id of ids) {
        setObjectGroup(ctxMenuLayerId, id, group.id)
      }
    }
    closeCanvasContextMenu()
  }

  function ctxMoveToGroup(groupId: string) {
    if (!ctxMenuLayerId) return
    const sel = getSelection()
    const ids = sel?.type === 'objects' ? sel.objectIds : ctxMenuObjId ? [ctxMenuObjId] : []
    for (const id of ids) {
      setObjectGroup(ctxMenuLayerId, id, groupId)
    }
    closeCanvasContextMenu()
  }

  function ctxRemoveFromGroup() {
    if (!ctxMenuLayerId) return
    const sel = getSelection()
    const ids = sel?.type === 'objects' ? sel.objectIds : ctxMenuObjId ? [ctxMenuObjId] : []
    for (const id of ids) {
      setObjectGroup(ctxMenuLayerId, id, undefined)
    }
    closeCanvasContextMenu()
  }

  function ctxReorder(direction: 'up' | 'down' | 'front' | 'back') {
    if (!ctxMenuLayerId) return
    const map = getMap()
    const layer = map.layers.find(l => l.id === ctxMenuLayerId)
    // If layer is in auto sort mode, switch to manual first so reordering takes effect
    if (layer && layer.type === 'object' && layer.sortMode !== 'manual') {
      setLayerSortMode(ctxMenuLayerId, 'manual')
    }
    const sel = getSelection()
    const ids = sel?.type === 'objects' ? sel.objectIds : ctxMenuObjId ? [ctxMenuObjId] : []
    if (ids.length === 0) return
    if (ids.length === 1) {
      const cmd = new ReorderObjectCommand(ctxMenuLayerId, ids[0], direction)
      executeCommand(cmd)
    } else {
      const cmds = ids.map(id => new ReorderObjectCommand(ctxMenuLayerId!, id, direction))
      executeCommand(new BatchCommand('Reorder objects', cmds))
    }
    closeCanvasContextMenu()
    renderer.markDirty()
  }

  function ctxResetOrder() {
    if (!ctxMenuLayerId) return
    setLayerSortMode(ctxMenuLayerId, 'auto')
    closeCanvasContextMenu()
    renderer.markDirty()
  }

  // ── Preset extraction from object selection ──

  function extractPresetFromObjects(): Preset | null {
    const map = getMap()
    if (!map) return null
    const sel = getSelection()
    const ids = sel?.type === 'objects' ? sel.objectIds : ctxMenuObjId ? [ctxMenuObjId] : []
    if (ids.length === 0) return null
    const layerId = ctxMenuLayerId || (sel?.type === 'objects' ? sel.layerId : null)
    if (!layerId) return null
    const layer = map.layers.find(l => l.id === layerId)
    if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return null

    const objs = ids
      .map(id => layer.objects.find(o => o.id === id))
      .filter((o): o is import('../../lib/models/layer').MapObject => !!o)
    if (objs.length === 0) return null

    // Bounding box in world coords
    let bbMinX = Infinity, bbMinY = Infinity, bbMaxX = -Infinity, bbMaxY = -Infinity
    for (const obj of objs) {
      bbMinX = Math.min(bbMinX, obj.x)
      bbMinY = Math.min(bbMinY, obj.y)
      bbMaxX = Math.max(bbMaxX, obj.x + obj.width)
      bbMaxY = Math.max(bbMaxY, obj.y + obj.height)
    }

    const presetObjects: PresetObject[] = objs.map(obj => ({
      name: obj.name,
      imageDataUrl: obj.imageDataUrl,
      relX: obj.x - bbMinX,
      relY: obj.y - bbMinY,
      width: obj.width,
      height: obj.height,
      flipX: obj.flipX,
      flipY: obj.flipY,
      rotation: obj.rotation
    }))

    // Collect zones within bounding box from object layers
    const presetZones: PresetZone[] = []
    for (const l of map.layers) {
      if (l.type !== 'object' || !l.visible) continue
      for (const zone of l.zones) {
        const allInside = zone.points.every(p =>
          p.x >= bbMinX && p.x <= bbMaxX && p.y >= bbMinY && p.y <= bbMaxY
        )
        if (allInside && zone.points.length > 0) {
          presetZones.push({
            name: zone.name,
            color: zone.color,
            points: zone.points.map(p => ({ relX: p.x - bbMinX, relY: p.y - bbMinY })),
            closed: zone.closed,
            zoneType: zone.zoneType
          })
        }
      }
    }

    // Generate thumbnail
    let thumbnail: string | undefined
    try {
      const thumbCanvas = document.createElement('canvas')
      const thumbSize = 128
      thumbCanvas.width = thumbSize
      thumbCanvas.height = thumbSize
      const thumbCtx = thumbCanvas.getContext('2d')
      if (thumbCtx) {
        const bW = bbMaxX - bbMinX
        const bH = bbMaxY - bbMinY
        const scale = Math.min(thumbSize / bW, thumbSize / bH) * 0.9
        const offX = (thumbSize - bW * scale) / 2
        const offY = (thumbSize - bH * scale) / 2
        for (const obj of objs) {
          if (obj.imageBitmap) {
            thumbCtx.drawImage(
              obj.imageBitmap,
              (obj.x - bbMinX) * scale + offX,
              (obj.y - bbMinY) * scale + offY,
              obj.width * scale,
              obj.height * scale
            )
          }
        }
        thumbnail = thumbCanvas.toDataURL('image/png')
      }
    } catch { /* thumbnail is optional */ }

    return {
      id: crypto.randomUUID(),
      name: 'Preset',
      width: Math.ceil(bbMaxX - bbMinX),
      height: Math.ceil(bbMaxY - bbMinY),
      tileLayers: [],
      objects: presetObjects,
      zones: presetZones,
      thumbnail
    }
  }

  function openPresetNameDialogFromObjects() {
    closeCanvasContextMenu()
    presetNameValue = `Preset ${getPresets().length + 1}`
    showPresetNameDialog = true
  }

  function savePresetFromSelection() {
    const preset = extractPresetFromObjects()
    if (!preset) return
    preset.name = presetNameValue.trim() || `Preset ${getPresets().length + 1}`
    addPreset(preset)
    showPresetNameDialog = false
    presetNameValue = ''
  }

  function cancelPresetNameDialog() {
    showPresetNameDialog = false
    presetNameValue = ''
  }

  function focusOnMount(el: HTMLElement) {
    requestAnimationFrame(() => el.focus())
  }

  // Marquee (drag-select) state
  let isMarqueeSelecting = false
  let marqueeStartWX = 0
  let marqueeStartWY = 0
  let marqueeLayerId: string | null = null

  // Preset name dialog
  let showPresetNameDialog = $state(false)
  let presetNameValue = $state('')
  let presetNameInputRef = $state<HTMLInputElement | null>(null)

  // Image layer drag/resize state
  let isDraggingImageLayer = false
  let isResizingImageLayer = false
  let dragImageLayer: ImageLayer | null = null
  let resizeHandle: string | null = null // 'tl'|'tr'|'bl'|'br'
  let imgDragStartX = 0
  let imgDragStartY = 0
  let imgLayerStartX = 0
  let imgLayerStartY = 0
  let imgLayerStartW = 0
  let imgLayerStartH = 0

  // Sketch tool state
  let isSketchDrawing = false
  let sketchPoints: { x: number; y: number }[] = []
  let sketchStartW: { x: number; y: number } | null = null

  // Drawing layer state
  let isDrawingLayerActive = $state(false)
  let showCreateDrawingLayerPrompt = $state(false)

  // Text tool state
  let showTextInput = $state(false)
  let textInputX = $state(0)  // screen x
  let textInputY = $state(0)  // screen y
  let textWorldX = 0
  let textWorldY = 0
  let textInputValue = $state('')
  let textInputEl: HTMLTextAreaElement | undefined = $state(undefined)

  function confirmCreateDrawingLayer() {
    const layer = addDrawingLayer('Drawing')
    showCreateDrawingLayerPrompt = false
  }

  function cancelCreateDrawingLayer() {
    showCreateDrawingLayerPrompt = false
  }

  onMount(() => {
    renderer = new MapRenderer(canvasEl)
    resizeCanvas()

    let lastMapConfigKey = ''
    const unsub = mapSubscribe(() => {
      const map = getMap()
      renderer.map = map
      if (map) {
        const configKey = `${map.config.gridWidth}x${map.config.gridHeight}x${map.config.tileWidth}x${map.config.tileHeight}x${map.config.orientation || 'diamond'}`
        if (configKey !== lastMapConfigKey) {
          lastMapConfigKey = configKey
          const rect = containerEl.getBoundingClientRect()
          renderer.camera.centerOnMap(
            map.config.gridWidth, map.config.gridHeight,
            map.config.tileWidth, map.config.tileHeight,
            rect.width, rect.height,
            map.config.orientation || 'diamond'
          )
          setZoomPercent(renderer.camera.zoom * 100)
        }
      } else {
        lastMapConfigKey = ''
      }
      // Sync drawing layer active state
      const activeLayer = map ? map.layers.find(l => l.id === map.activeLayerId) : null
      isDrawingLayerActive = activeLayer?.type === 'drawing'
      renderer.markDirty()
    })
    renderer.map = getMap()

    // Sync selection store → renderer highlight fields
    const unsubSel = selSubscribe(() => {
      const sel = getSelection()
      renderer.selectedObjectIds = sel?.type === 'object'
        ? new Set([sel.objectId])
        : sel?.type === 'objects'
          ? new Set(sel.objectIds)
          : new Set()
      renderer.selectedZoneId = sel?.type === 'zone' ? sel.zoneId : null
      renderer.selectedPathId = sel?.type === 'path' ? sel.pathId : null
      renderer.selectedImageLayerId = sel?.type === 'image-layer' ? sel.layerId : null
      renderer.markDirty()
    })

    // Sync sketch settings → renderer
    const unsubSketch = sketchSubscribe(() => {
      const s = getSketchSettings()
      renderer.sketchSubTool = s.subTool
      renderer.sketchColor = s.color
      renderer.sketchStrokeWidth = s.strokeWidth
      renderer.sketchFill = s.fill
      renderer.markDirty()
    })

    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1
      const rect = containerEl.getBoundingClientRect()
      canvasEl.width = rect.width * dpr
      canvasEl.height = rect.height * dpr
      canvasEl.style.width = rect.width + 'px'
      canvasEl.style.height = rect.height + 'px'
      const ctx = canvasEl.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // Recalculate minZoom for current viewport size
      const map = getMap()
      if (map) {
        renderer.camera.updateMinZoom(
          map.config.gridWidth, map.config.gridHeight,
          map.config.tileWidth, map.config.tileHeight,
          rect.width, rect.height,
          map.config.orientation || 'diamond'
        )
      }
      // Clamp current zoom to updated bounds and sync the UI
      renderer.camera.zoom = Math.max(renderer.camera.minZoom, Math.min(renderer.camera.maxZoom, renderer.camera.zoom))
      setZoomPercent(renderer.camera.zoom * 100)
      renderer.markDirty()
    }

    const resizeObserver = new ResizeObserver(() => resizeCanvas())
    resizeObserver.observe(containerEl)

    function getWorldCoords(e: PointerEvent): { wx: number; wy: number } {
      return renderer.camera.screenToWorld(e.offsetX, e.offsetY)
    }

    /** Get world coords, optionally snapped to tile corners when Ctrl is held */
    function getZoneWorldCoords(e: PointerEvent): { x: number; y: number } {
      const world = renderer.camera.screenToWorld(e.offsetX, e.offsetY)
      if (e.ctrlKey) {
        const map = getMap()
        if (map) {
          const snapped = snapToTileCorner(
            world.wx, world.wy,
            map.config.tileWidth, map.config.tileHeight,
            map.config.gridWidth, map.config.gridHeight,
            map.config.orientation || 'diamond'
          )
          return { x: snapped.x, y: snapped.y }
        }
      }
      return { x: world.wx, y: world.wy }
    }

    function getMapCoords(e: PointerEvent): { col: number; row: number } | null {
      const map = getMap()
      if (!map) return null
      const world = renderer.camera.screenToWorld(e.offsetX, e.offsetY)
      return screenToMap(world.wx, world.wy, map.config.tileWidth, map.config.tileHeight, map.config.orientation || 'diamond')
    }

    function handlePointerDown(e: PointerEvent) {
      // Close context menus on any pointer down
      if (showCanvasContextMenu) closeCanvasContextMenu()

      const map = getMap()
      if (!map) return

      if (e.button === 1 || (e.button === 0 && spaceHeld)) {
        isPanning = true
        lastPointerX = e.clientX
        lastPointerY = e.clientY
        canvasEl.setPointerCapture(e.pointerId)
        return
      }

      if (e.button !== 0) return

      const tool = getActiveTool()
      const activeLayer = map.layers.find(l => l.id === map.activeLayerId)
      if (!activeLayer) return

      // Stamp tool: place selected preset
      if (tool === 'stamp') {
        const presetId = getSelectedPresetId()
        const preset = presetId ? getPresetById(presetId) : null
        if (preset) {
          const coords = getMapCoords(e)
          if (!coords) return
          const { col, row } = coords
          const anchorScreen = mapToScreen(col, row, map.config.tileWidth, map.config.tileHeight, map.config.orientation)
          const cmd = new PlacePresetCommand(preset, col, row, anchorScreen.x, anchorScreen.y, map)
          executeCommand(cmd)
          renderer.markDirty()
        }
        return
      }

      // Image layer: select, drag, or resize
      if (activeLayer.type === 'image') {
        const world = getWorldCoords(e)
        // Check resize handles first (if already selected and not locked)
        if (renderer.selectedImageLayerId === activeLayer.id && !activeLayer.locked) {
          const handle = renderer.hitTestImageLayerHandle(world.wx, world.wy, activeLayer)
          if (handle) {
            isResizingImageLayer = true
            dragImageLayer = activeLayer
            resizeHandle = handle
            imgDragStartX = world.wx
            imgDragStartY = world.wy
            imgLayerStartX = activeLayer.x
            imgLayerStartY = activeLayer.y
            imgLayerStartW = activeLayer.width
            imgLayerStartH = activeLayer.height
            canvasEl.setPointerCapture(e.pointerId)
            return
          }
        }
        // Check body hit for drag (skip drag if locked)
        const hitImg = renderer.hitTestImageLayer(world.wx, world.wy)
        if (hitImg && hitImg.id === activeLayer.id) {
          selectImageLayer(activeLayer.id)
          if (!activeLayer.locked) {
            isDraggingImageLayer = true
            dragImageLayer = activeLayer
            imgDragStartX = world.wx
            imgDragStartY = world.wy
            imgLayerStartX = activeLayer.x
            imgLayerStartY = activeLayer.y
            imgLayerStartW = activeLayer.width
            imgLayerStartH = activeLayer.height
            canvasEl.setPointerCapture(e.pointerId)
          }
          renderer.markDirty()
          return
        }
        // Clicked outside image → just select the layer (deselect sub-items)
        selectImageLayer(activeLayer.id)
        renderer.markDirty()
        return
      }

      // Select tool: select/drag existing objects or zones (never places)
      if (tool === 'select') {
        if (activeLayer.type !== 'object' && activeLayer.type !== 'drawing') return
        const world = getWorldCoords(e)

        const hitResult = renderer.hitTestObject(world.wx, world.wy)
        if (hitResult) {
          if (e.ctrlKey) {
            // Ctrl+Click: toggle multi-selection
            toggleObjectSelection(hitResult.layerId, hitResult.obj.id)
            setActiveLayer(hitResult.layerId)
          } else {
            // Check if clicking on an already-selected object in a multi-selection → start multi-drag
            const selectedIds = getSelectedObjectIds()
            if (selectedIds.length > 1 && isObjectSelected(hitResult.obj.id)) {
              // Start multi-object drag
              const layer = map.layers.find(l => l.id === hitResult.layerId)
              if (layer && (layer.type === 'object' || layer.type === 'drawing')) {
                isDraggingMultiObjects = true
                multiDragStartX = world.wx
                multiDragStartY = world.wy
                dragMultiObjects = []
                for (const id of selectedIds) {
                  const obj = layer.objects.find(o => o.id === id)
                  if (obj && !obj.locked) {
                    dragMultiObjects.push({ obj, startX: obj.x, startY: obj.y })
                  }
                }
                canvasEl.setPointerCapture(e.pointerId)
              }
            } else {
              selectObject(hitResult.layerId, hitResult.obj.id)
              setActiveLayer(hitResult.layerId)
              if (!hitResult.obj.locked) {
                isDraggingObject = true
                dragObject = hitResult.obj
                dragStartX = world.wx
                dragStartY = world.wy
                dragObjStartX = hitResult.obj.x
                dragObjStartY = hitResult.obj.y
                canvasEl.setPointerCapture(e.pointerId)
              }
            }
          }
          renderer.markDirty()
          return
        }

        const hitZone = renderer.hitTestZone(world.wx, world.wy)
        if (hitZone) {
          selectZone(hitZone.layerId, hitZone.zone.id)
          setActiveLayer(hitZone.layerId)
          renderer.markDirty()
          return
        }

        const hitPath = renderer.hitTestPath(world.wx, world.wy)
        if (hitPath) {
          selectPath(hitPath.layerId, hitPath.path.id)
          setActiveLayer(hitPath.layerId)
          renderer.markDirty()
          return
        }

        // Nothing hit → start marquee drag-select
        clearSelection()
        isMarqueeSelecting = true
        marqueeStartWX = world.wx
        marqueeStartWY = world.wy
        marqueeLayerId = activeLayer.id
        renderer.marqueeRect = { x: world.wx, y: world.wy, w: 0, h: 0 }
        canvasEl.setPointerCapture(e.pointerId)
        renderer.markDirty()
        return
      }

      // Object tool: place new object OR select/drag existing
      if (tool === 'object') {
        const world = getWorldCoords(e)
        const selectedImg = getSelectedObjectImage()

        // If stamp is selected → always place new object (priority over hit-test)
        if (selectedImg && activeLayer.type === 'object') {
          const obj: MapObject = {
            id: crypto.randomUUID(),
            name: selectedImg.name,
            imageDataUrl: selectedImg.imageDataUrl,
            imageBitmap: selectedImg.imageBitmap!,
            x: world.wx - selectedImg.width / 2,
            y: world.wy - selectedImg.height,
            width: selectedImg.width,
            height: selectedImg.height
          }

          const cmd = new PlaceObjectCommand(activeLayer.id, obj)
          executeCommand(cmd)
          selectObject(activeLayer.id, obj.id)
          renderer.markDirty()
          return
        }

        // No stamp selected → select/drag existing objects or zones
        const hitResult = renderer.hitTestObject(world.wx, world.wy)
        if (hitResult) {
          if (e.ctrlKey) {
            toggleObjectSelection(hitResult.layerId, hitResult.obj.id)
            setActiveLayer(hitResult.layerId)
          } else {
            const selectedIds = getSelectedObjectIds()
            if (selectedIds.length > 1 && isObjectSelected(hitResult.obj.id)) {
              const layer = map.layers.find(l => l.id === hitResult.layerId)
              if (layer && (layer.type === 'object' || layer.type === 'drawing')) {
                isDraggingMultiObjects = true
                multiDragStartX = world.wx
                multiDragStartY = world.wy
                dragMultiObjects = []
                for (const id of selectedIds) {
                  const obj = layer.objects.find(o => o.id === id)
                  if (obj && !obj.locked) {
                    dragMultiObjects.push({ obj, startX: obj.x, startY: obj.y })
                  }
                }
                canvasEl.setPointerCapture(e.pointerId)
              }
            } else {
              selectObject(hitResult.layerId, hitResult.obj.id)
              setActiveLayer(hitResult.layerId)
              if (!hitResult.obj.locked) {
                isDraggingObject = true
                dragObject = hitResult.obj
                dragStartX = world.wx
                dragStartY = world.wy
                dragObjStartX = hitResult.obj.x
                dragObjStartY = hitResult.obj.y
                canvasEl.setPointerCapture(e.pointerId)
              }
            }
          }
          renderer.markDirty()
          return
        }

        const hitZone = renderer.hitTestZone(world.wx, world.wy)
        if (hitZone) {
          selectZone(hitZone.layerId, hitZone.zone.id)
          setActiveLayer(hitZone.layerId)
          renderer.markDirty()
          return
        }

        const hitPath2 = renderer.hitTestPath(world.wx, world.wy)
        if (hitPath2) {
          selectPath(hitPath2.layerId, hitPath2.path.id)
          setActiveLayer(hitPath2.layerId)
          renderer.markDirty()
          return
        }

        clearSelection()
        return
      }

      // Sketch tool: start drawing (only on drawing layers)
      if (tool === 'sketch') {
        if (activeLayer.type !== 'drawing') {
          // Try to find an existing drawing layer and switch to it
          const drawingLayer = map.layers.find(l => l.type === 'drawing' && l.visible)
          if (drawingLayer) {
            setActiveLayer(drawingLayer.id)
          } else {
            showCreateDrawingLayerPrompt = true
            return
          }
        }
        const world = getWorldCoords(e)
        const settings = getSketchSettings()

        // Text sub-tool: show text input at click position
        if (settings.subTool === 'text') {
          // If text input is already open, confirm it first
          if (showTextInput) {
            rasterizeAndPlaceText()
          }
          textWorldX = world.wx
          textWorldY = world.wy
          // Convert world coords to screen for positioning the input
          const sx = (world.wx - renderer.camera.offsetX) * renderer.camera.zoom
          const sy = (world.wy - renderer.camera.offsetY) * renderer.camera.zoom
          const rect = canvasEl.getBoundingClientRect()
          textInputX = rect.left + sx
          textInputY = rect.top + sy
          textInputValue = ''
          showTextInput = true
          // Focus the textarea after it renders
          requestAnimationFrame(() => {
            if (textInputEl) textInputEl.focus()
          })
          return
        }

        isSketchDrawing = true
        canvasEl.setPointerCapture(e.pointerId)

        if (settings.subTool === 'pencil') {
          sketchPoints = [{ x: world.wx, y: world.wy }]
          renderer.activeSketchPoints = sketchPoints
        } else {
          sketchStartW = { x: world.wx, y: world.wy }
          renderer.sketchStartPoint = sketchStartW
          renderer.sketchMousePos = { x: world.wx, y: world.wy }
        }
        renderer.markDirty()
        return
      }

      // Zone / Collision tool: add point to active zone polygon
      if (tool === 'zone' || tool === 'collision') {
        if (activeLayer.type !== 'object') return
        const world = getZoneWorldCoords(e)
        const pts = renderer.activeZonePoints

        // Check if clicking near first point to close
        if (pts.length >= 3) {
          const dx = world.x - pts[0].x
          const dy = world.y - pts[0].y
          const closeThreshold = 15 / renderer.camera.zoom
          if (Math.sqrt(dx * dx + dy * dy) < closeThreshold) {
            // Close and commit zone
            const isCollision = tool === 'collision'
            const zone = {
              id: crypto.randomUUID(),
              name: isCollision
                ? `Collision ${activeLayer.zones.filter(z => z.zoneType === 'collision').length + 1}`
                : `Zone ${activeLayer.zones.filter(z => z.zoneType !== 'collision').length + 1}`,
              color: isCollision ? '#f38ba8' : renderer.activeZoneColor,
              points: [...pts],
              closed: true,
              zoneType: (isCollision ? 'collision' : 'zone') as 'zone' | 'collision'
            }
            const cmd = new AddZoneCommand(activeLayer.id, zone)
            executeCommand(cmd)
            renderer.activeZonePoints = []
            renderer.zoneMousePos = null
            if (!isCollision) renderer.activeZoneColor = getNextZoneColor()
            renderer.markDirty()
            return
          }
        }

        pts.push({ x: world.x, y: world.y })
        renderer.markDirty()
        return
      }

      // Path tool: add waypoint to active path
      if (tool === 'path') {
        if (activeLayer.type !== 'object') return
        const world = getZoneWorldCoords(e)
        const pts = renderer.activePathPoints

        // Check if clicking near first point to close as loop
        if (pts.length >= 3) {
          const dx = world.x - pts[0].x
          const dy = world.y - pts[0].y
          const closeThreshold = 15 / renderer.camera.zoom
          if (Math.sqrt(dx * dx + dy * dy) < closeThreshold) {
            commitPath(activeLayer, [...pts], true)
            return
          }
        }

        pts.push({ x: world.x, y: world.y })
        renderer.markDirty()
        return
      }

      // Tile-based tools need grid coords
      const coords = getMapCoords(e)
      if (!coords) return
      const { col, row } = coords
      if (col < 0 || row < 0 || col >= map.config.gridWidth || row >= map.config.gridHeight) return

      if (activeLayer.type !== 'tile') return

      // Clear tile selection when using paint/eraser/fill tools
      if (tool === 'paint') {
        const selectedTile = getSelectedTile()
        if (!selectedTile) return
        isDrawing = true
        renderer.previewTiles = null
        paintedCells = new Set()
        strokePositions = []
        strokePreviousTiles = []
        applyPaint(col, row, activeLayer, selectedTile)
        canvasEl.setPointerCapture(e.pointerId)
      } else if (tool === 'eraser') {
        isDrawing = true
        paintedCells = new Set()
        strokePositions = []
        strokePreviousTiles = []
        applyErase(col, row, activeLayer)
        canvasEl.setPointerCapture(e.pointerId)
      } else if (tool === 'fill') {
        const selectedTile = getSelectedTile()
        if (!selectedTile) return
        const orientation = map.config.orientation || 'diamond'
        const threshold = getSettings().fillWarningThreshold
        if (threshold > 0) {
          // Quick pre-check with early bailout — no heavy allocations
          const estimate = estimateFillCount(
            activeLayer.data, col, row, selectedTile,
            map.config.gridWidth, map.config.gridHeight, threshold, orientation
          )
          if (estimate > threshold) {
            // Store params for deferred execution after confirmation
            pendingFillParams = {
              layerId: activeLayer.id, col, row, selectedTile,
              layerData: activeLayer.data,
              gridWidth: map.config.gridWidth, gridHeight: map.config.gridHeight,
              orientation
            }
            pendingFillCount = estimate
            showFillConfirm = true
            return
          }
        }
        // Under threshold or disabled → execute immediately
        const cmd = new FillCommand(activeLayer.id, col, row, selectedTile, activeLayer.data, map.config.gridWidth, map.config.gridHeight, orientation)
        executeCommand(cmd)
        renderer.markDirty()
      }
    }

    function applyPaint(col: number, row: number, layer: any, tileRef: TileRef) {
      const key = `${col},${row}`
      if (paintedCells.has(key)) return
      paintedCells.add(key)
      strokePositions.push({ row, col })
      strokePreviousTiles.push(layer.data[row][col] ? { ...layer.data[row][col]! } : null)
      layer.data[row][col] = { ...tileRef }
      renderer.markDirty()
    }

    function applyErase(col: number, row: number, layer: any) {
      const key = `${col},${row}`
      if (paintedCells.has(key)) return
      paintedCells.add(key)
      strokePositions.push({ row, col })
      strokePreviousTiles.push(layer.data[row][col] ? { ...layer.data[row][col]! } : null)
      layer.data[row][col] = null
      renderer.markDirty()
    }

    async function rasterizeAndPlaceSketch() {
      const map = getMap()
      if (!map) return
      const activeLayer = map.layers.find(l => l.id === map.activeLayerId)
      if (!activeLayer || activeLayer.type !== 'drawing') return

      const settings = getSketchSettings()
      const pad = settings.strokeWidth + 2

      // Compute bounding box in world space
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

      if (settings.subTool === 'pencil') {
        if (sketchPoints.length < 2) {
          // Reset preview
          renderer.activeSketchPoints = []
          sketchPoints = []
          renderer.markDirty()
          return
        }
        for (const p of sketchPoints) {
          if (p.x < minX) minX = p.x
          if (p.y < minY) minY = p.y
          if (p.x > maxX) maxX = p.x
          if (p.y > maxY) maxY = p.y
        }
      } else {
        if (!sketchStartW || !renderer.sketchMousePos) {
          renderer.sketchStartPoint = null
          renderer.sketchMousePos = null
          sketchStartW = null
          renderer.markDirty()
          return
        }
        const sp = sketchStartW
        const mp = renderer.sketchMousePos

        if (settings.subTool === 'arrow') {
          // Arrow bounding box must include arrowhead
          const headLen = Math.max(settings.strokeWidth * 4, 12)
          const dx = mp.x - sp.x
          const dy = mp.y - sp.y
          const angle = Math.atan2(dy, dx)
          const hx1 = mp.x - headLen * Math.cos(angle - Math.PI / 6)
          const hy1 = mp.y - headLen * Math.sin(angle - Math.PI / 6)
          const hx2 = mp.x - headLen * Math.cos(angle + Math.PI / 6)
          const hy2 = mp.y - headLen * Math.sin(angle + Math.PI / 6)
          const allX = [sp.x, mp.x, hx1, hx2]
          const allY = [sp.y, mp.y, hy1, hy2]
          minX = Math.min(...allX)
          minY = Math.min(...allY)
          maxX = Math.max(...allX)
          maxY = Math.max(...allY)
        } else {
          minX = Math.min(sp.x, mp.x)
          minY = Math.min(sp.y, mp.y)
          maxX = Math.max(sp.x, mp.x)
          maxY = Math.max(sp.y, mp.y)
        }
      }

      // Check for degenerate shapes (too small)
      if (maxX - minX < 2 && maxY - minY < 2) {
        renderer.activeSketchPoints = []
        renderer.sketchStartPoint = null
        renderer.sketchMousePos = null
        sketchPoints = []
        sketchStartW = null
        renderer.markDirty()
        return
      }

      // Add padding for stroke width
      minX -= pad
      minY -= pad
      maxX += pad
      maxY += pad

      const bboxW = maxX - minX
      const bboxH = maxY - minY

      // Rasterize at 2× for crisp rendering
      const scale = 2
      const osc = new OffscreenCanvas(bboxW * scale, bboxH * scale)
      const octx = osc.getContext('2d')!
      octx.scale(scale, scale)
      octx.translate(-minX, -minY)

      octx.strokeStyle = settings.color
      octx.lineWidth = settings.strokeWidth
      octx.lineCap = 'round'
      octx.lineJoin = 'round'

      if (settings.subTool === 'pencil') {
        octx.beginPath()
        octx.moveTo(sketchPoints[0].x, sketchPoints[0].y)
        for (let i = 1; i < sketchPoints.length; i++) {
          octx.lineTo(sketchPoints[i].x, sketchPoints[i].y)
        }
        octx.stroke()
      } else if (sketchStartW && renderer.sketchMousePos) {
        const sp = sketchStartW
        const mp = renderer.sketchMousePos

        if (settings.subTool === 'line') {
          octx.beginPath()
          octx.moveTo(sp.x, sp.y)
          octx.lineTo(mp.x, mp.y)
          octx.stroke()
        } else if (settings.subTool === 'arrow') {
          octx.beginPath()
          octx.moveTo(sp.x, sp.y)
          octx.lineTo(mp.x, mp.y)
          octx.stroke()
          const dx = mp.x - sp.x
          const dy = mp.y - sp.y
          const angle = Math.atan2(dy, dx)
          const headLen = Math.max(settings.strokeWidth * 4, 12)
          octx.beginPath()
          octx.moveTo(mp.x, mp.y)
          octx.lineTo(mp.x - headLen * Math.cos(angle - Math.PI / 6), mp.y - headLen * Math.sin(angle - Math.PI / 6))
          octx.moveTo(mp.x, mp.y)
          octx.lineTo(mp.x - headLen * Math.cos(angle + Math.PI / 6), mp.y - headLen * Math.sin(angle + Math.PI / 6))
          octx.stroke()
        } else if (settings.subTool === 'rect') {
          const rx = Math.min(sp.x, mp.x)
          const ry = Math.min(sp.y, mp.y)
          const rw = Math.abs(mp.x - sp.x)
          const rh = Math.abs(mp.y - sp.y)
          if (settings.fill) {
            octx.fillStyle = settings.color + '45'
            octx.fillRect(rx, ry, rw, rh)
          }
          octx.strokeRect(rx, ry, rw, rh)
        } else if (settings.subTool === 'ellipse') {
          const cx = (sp.x + mp.x) / 2
          const cy = (sp.y + mp.y) / 2
          const rx = Math.abs(mp.x - sp.x) / 2
          const ry = Math.abs(mp.y - sp.y) / 2
          octx.beginPath()
          octx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
          if (settings.fill) {
            octx.fillStyle = settings.color + '45'
            octx.fill()
          }
          octx.stroke()
        }
      }

      // Clear preview
      renderer.activeSketchPoints = []
      renderer.sketchStartPoint = null
      renderer.sketchMousePos = null
      sketchPoints = []
      sketchStartW = null

      // Convert to data URL
      try {
        const blob = await osc.convertToBlob({ type: 'image/png' })
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })

        const hash = await registerImage(dataUrl)

        const obj: MapObject = {
          id: crypto.randomUUID(),
          name: `Sketch (${settings.subTool})`,
          imageDataUrl: dataUrl,
          imageHash: hash,
          imageBitmap: getBitmap(hash),
          x: minX,
          y: minY,
          width: bboxW,
          height: bboxH
        }

        const cmd = new PlaceObjectCommand(activeLayer.id, obj)
        executeCommand(cmd)
        selectObject(activeLayer.id, obj.id)
      } catch {
        // Silently fail if rasterization fails
      }

      renderer.markDirty()
    }

    async function rasterizeAndPlaceText() {
      if (!textInputValue.trim()) {
        showTextInput = false
        textInputValue = ''
        return
      }

      const map = getMap()
      if (!map) return
      const activeLayer = map.layers.find(l => l.id === map.activeLayerId)
      if (!activeLayer || activeLayer.type !== 'drawing') {
        showTextInput = false
        textInputValue = ''
        return
      }

      const settings = getSketchSettings()
      const scale = 2
      const font = `${settings.fontSize}px ${settings.fontFamily}`

      // Measure text using an offscreen canvas
      const measureCanvas = new OffscreenCanvas(1, 1)
      const mctx = measureCanvas.getContext('2d')!
      mctx.font = font

      // Handle multi-line text
      const lines = textInputValue.split('\n')
      const lineHeight = settings.fontSize * 1.3
      let maxWidth = 0
      for (const line of lines) {
        const m = mctx.measureText(line)
        if (m.width > maxWidth) maxWidth = m.width
      }
      const textH = lineHeight * lines.length
      const pad = 4

      const bboxW = maxWidth + pad * 2
      const bboxH = textH + pad * 2

      const osc = new OffscreenCanvas(bboxW * scale, bboxH * scale)
      const octx = osc.getContext('2d')!
      octx.scale(scale, scale)

      octx.fillStyle = settings.color
      octx.font = font
      octx.textBaseline = 'top'

      for (let i = 0; i < lines.length; i++) {
        octx.fillText(lines[i], pad, pad + i * lineHeight)
      }

      try {
        const blob = await osc.convertToBlob({ type: 'image/png' })
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })

        const hash = await registerImage(dataUrl)

        const obj: MapObject = {
          id: crypto.randomUUID(),
          name: `Text "${textInputValue.substring(0, 20)}${textInputValue.length > 20 ? '...' : ''}"`,
          imageDataUrl: dataUrl,
          imageHash: hash,
          imageBitmap: getBitmap(hash),
          x: textWorldX - pad,
          y: textWorldY - pad,
          width: bboxW,
          height: bboxH
        }

        const cmd = new PlaceObjectCommand(activeLayer.id, obj)
        executeCommand(cmd)
        selectObject(activeLayer.id, obj.id)
      } catch {
        // Silently fail
      }

      showTextInput = false
      textInputValue = ''
      renderer.markDirty()
    }

    function handlePointerMove(e: PointerEvent) {
      const map = getMap()
      if (!map) return

      if (isPanning) {
        renderer.camera.pan(e.clientX - lastPointerX, e.clientY - lastPointerY)
        lastPointerX = e.clientX
        lastPointerY = e.clientY
        setZoomPercent(renderer.camera.zoom * 100)
        renderer.markDirty()
        return
      }

      // Marquee drag-select
      if (isMarqueeSelecting) {
        const world = getWorldCoords(e)
        const x = Math.min(marqueeStartWX, world.wx)
        const y = Math.min(marqueeStartWY, world.wy)
        const w = Math.abs(world.wx - marqueeStartWX)
        const h = Math.abs(world.wy - marqueeStartWY)
        renderer.marqueeRect = { x, y, w, h }
        renderer.markDirty()
        return
      }

      // Multi-object dragging
      if (isDraggingMultiObjects && dragMultiObjects.length > 0) {
        const world = getWorldCoords(e)
        const dx = world.wx - multiDragStartX
        const dy = world.wy - multiDragStartY
        for (const entry of dragMultiObjects) {
          entry.obj.x = entry.startX + dx
          entry.obj.y = entry.startY + dy
        }
        renderer.markDirty()
        return
      }

      // Object dragging
      if (isDraggingObject && dragObject) {
        const world = getWorldCoords(e)
        dragObject.x = dragObjStartX + (world.wx - dragStartX)
        dragObject.y = dragObjStartY + (world.wy - dragStartY)
        renderer.markDirty()
        return
      }

      // Image layer dragging
      if (isDraggingImageLayer && dragImageLayer) {
        const world = getWorldCoords(e)
        dragImageLayer.x = imgLayerStartX + (world.wx - imgDragStartX)
        dragImageLayer.y = imgLayerStartY + (world.wy - imgDragStartY)
        renderer.markDirty()
        return
      }

      // Image layer resizing
      if (isResizingImageLayer && dragImageLayer && resizeHandle) {
        const world = getWorldCoords(e)
        let dx = world.wx - imgDragStartX
        let dy = world.wy - imgDragStartY
        const hasIso = dragImageLayer.isoTransform && renderer.map
        const hasRot = (dragImageLayer.rotation || 0) !== 0

        if (hasIso || hasRot) {
          // Build combined inverse: first undo iso, then undo rotation
          let a = 1, b = 0, c = 0, d = 1 // identity

          if (hasIso) {
            const { tileWidth, tileHeight } = renderer.map!.config
            const hw = tileWidth / 2
            const hh = tileHeight / 2
            const isoLen = Math.sqrt(hw * hw + hh * hh)
            a = hw / isoLen; b = hh / isoLen
            c = -hw / isoLen; d = hh / isoLen
          }

          // If rotation, compose with iso matrix
          if (hasRot) {
            const rot = (dragImageLayer.rotation || 0) * Math.PI / 180
            const cosR = Math.cos(rot), sinR = Math.sin(rot)
            // Compose: M_iso × M_rot
            const a2 = a * cosR + c * sinR
            const b2 = b * cosR + d * sinR
            const c2 = -a * sinR + c * cosR
            const d2 = -b * sinR + d * cosR
            a = a2; b = b2; c = c2; d = d2
          }

          const det = a * d - b * c
          const invDW = (d * dx - c * dy) / det
          const invDH = (a * dy - b * dx) / det

          let newW: number, newH: number, newX: number, newY: number

          if (resizeHandle === 'br') {
            newW = Math.max(10, imgLayerStartW + invDW)
            newH = Math.max(10, imgLayerStartH + invDH)
            newX = imgLayerStartX
            newY = imgLayerStartY
          } else if (resizeHandle === 'tl') {
            newW = Math.max(10, imgLayerStartW - invDW)
            newH = Math.max(10, imgLayerStartH - invDH)
            const brX = imgLayerStartX + a * imgLayerStartW + c * imgLayerStartH
            const brY = imgLayerStartY + b * imgLayerStartW + d * imgLayerStartH
            newX = brX - a * newW - c * newH
            newY = brY - b * newW - d * newH
          } else if (resizeHandle === 'tr') {
            newW = Math.max(10, imgLayerStartW + invDW)
            newH = Math.max(10, imgLayerStartH - invDH)
            const blX = imgLayerStartX + c * imgLayerStartH
            const blY = imgLayerStartY + d * imgLayerStartH
            newX = blX - c * newH
            newY = blY - d * newH
          } else {
            newW = Math.max(10, imgLayerStartW - invDW)
            newH = Math.max(10, imgLayerStartH + invDH)
            const trX = imgLayerStartX + a * imgLayerStartW
            const trY = imgLayerStartY + b * imgLayerStartW
            newX = trX - a * newW
            newY = trY - b * newW
          }

          dragImageLayer.x = newX
          dragImageLayer.y = newY
          dragImageLayer.width = newW
          dragImageLayer.height = newH
        } else {
          // Standard AABB resize
          if (resizeHandle === 'br') {
            dragImageLayer.width = Math.max(10, imgLayerStartW + dx)
            dragImageLayer.height = Math.max(10, imgLayerStartH + dy)
          } else if (resizeHandle === 'bl') {
            dragImageLayer.x = imgLayerStartX + dx
            dragImageLayer.width = Math.max(10, imgLayerStartW - dx)
            dragImageLayer.height = Math.max(10, imgLayerStartH + dy)
          } else if (resizeHandle === 'tr') {
            dragImageLayer.y = imgLayerStartY + dy
            dragImageLayer.width = Math.max(10, imgLayerStartW + dx)
            dragImageLayer.height = Math.max(10, imgLayerStartH - dy)
          } else if (resizeHandle === 'tl') {
            dragImageLayer.x = imgLayerStartX + dx
            dragImageLayer.y = imgLayerStartY + dy
            dragImageLayer.width = Math.max(10, imgLayerStartW - dx)
            dragImageLayer.height = Math.max(10, imgLayerStartH - dy)
          }
        }

        renderer.markDirty()
        return
      }

      // Sketch drawing in progress
      if (isSketchDrawing) {
        const world = getWorldCoords(e)
        const settings = getSketchSettings()
        if (settings.subTool === 'pencil') {
          sketchPoints.push({ x: world.wx, y: world.wy })
          renderer.activeSketchPoints = sketchPoints
        } else {
          renderer.sketchMousePos = { x: world.wx, y: world.wy }
        }
        renderer.markDirty()
        return
      }

      // Update zone preview mouse position
      if ((getActiveTool() === 'zone' || getActiveTool() === 'collision') && renderer.activeZonePoints.length > 0) {
        const world = getZoneWorldCoords(e)
        renderer.zoneMousePos = { x: world.x, y: world.y }
        renderer.markDirty()
      }

      // Update path preview mouse position
      if (getActiveTool() === 'path' && renderer.activePathPoints.length > 0) {
        const world = getZoneWorldCoords(e)
        renderer.pathMousePos = { x: world.x, y: world.y }
        renderer.markDirty()
      }

      // Suppress grid hover on drawing layers (no crosshair / grid highlight)
      if (isDrawingLayerActive) {
        renderer.hoverCol = -1
        renderer.hoverRow = -1
        setHover(-1, -1)
        renderer.markDirty()
        return
      }

      const coords = getMapCoords(e)
      if (!coords) return
      const { col, row } = coords

      if (col >= 0 && col < map.config.gridWidth && row >= 0 && row < map.config.gridHeight) {
        renderer.hoverCol = col
        renderer.hoverRow = row
        setHover(col, row)

        // Tile placement preview (holo)
        const tool = getActiveTool()
        if (tool === 'paint' && !isDrawing) {
          const selectedTile = getSelectedTile()
          if (selectedTile) {
            renderer.previewTiles = [{ col, row, tileRef: selectedTile }]
          } else {
            renderer.previewTiles = null
          }
        } else if (tool === 'stamp') {
          const presetId = getSelectedPresetId()
          const preset = presetId ? getPresetById(presetId) : null
          if (preset) {
            // Tile previews
            const previews: { col: number; row: number; tileRef: import('../../lib/models/tile').TileRef }[] = []
            for (const presetLayer of preset.tileLayers) {
              for (let r = 0; r < presetLayer.tiles.length; r++) {
                for (let c = 0; c < presetLayer.tiles[r].length; c++) {
                  const tileRef = presetLayer.tiles[r][c]
                  if (tileRef) previews.push({ col: col + c, row: row + r, tileRef })
                }
              }
            }
            renderer.previewTiles = previews.length > 0 ? previews : null

            // Object previews
            if (preset.objects.length > 0) {
              const anchorScreen = mapToScreen(col, row, map.config.tileWidth, map.config.tileHeight, map.config.orientation)
              const objPreviews: PreviewObject[] = []
              for (let i = 0; i < preset.objects.length; i++) {
                const pObj = preset.objects[i]
                const bmp = getPresetObjectBitmap(preset.id, i)
                if (!bmp) continue
                objPreviews.push({
                  imageBitmap: bmp,
                  x: anchorScreen.x + pObj.relX,
                  y: anchorScreen.y + pObj.relY,
                  width: pObj.width, height: pObj.height,
                  rotation: pObj.rotation, flipX: pObj.flipX, flipY: pObj.flipY
                })
              }
              renderer.previewObjects = objPreviews.length > 0 ? objPreviews : null
            } else {
              renderer.previewObjects = null
            }
          } else {
            renderer.previewTiles = null
            renderer.previewObjects = null
          }
        } else if (tool !== 'paint') {
          renderer.previewTiles = null
        }
      } else {
        renderer.hoverCol = -1
        renderer.hoverRow = -1
        setHover(-1, -1)
        renderer.previewTiles = null
        renderer.previewObjects = null
      }

      // Object placement preview (holo) — outside grid bounds check since objects are freely placed
      {
        const tool = getActiveTool()
        if (tool === 'object') {
          const selectedImg = getSelectedObjectImage()
          if (selectedImg?.imageBitmap) {
            const world = getWorldCoords(e)
            renderer.previewObjects = [{
              imageBitmap: selectedImg.imageBitmap,
              x: world.wx - selectedImg.width / 2,
              y: world.wy - selectedImg.height,
              width: selectedImg.width, height: selectedImg.height
            }]
          } else {
            renderer.previewObjects = null
          }
        } else if (tool !== 'stamp') {
          renderer.previewObjects = null
        }
      }

      renderer.markDirty()

      if (isDrawing && col >= 0 && col < map.config.gridWidth && row >= 0 && row < map.config.gridHeight) {
        const activeLayer = map.layers.find(l => l.id === map.activeLayerId)
        if (!activeLayer || activeLayer.type !== 'tile') return
        const tool = getActiveTool()
        if (tool === 'paint') {
          const selectedTile = getSelectedTile()
          if (selectedTile) applyPaint(col, row, activeLayer, selectedTile)
        } else if (tool === 'eraser') {
          applyErase(col, row, activeLayer)
        }
      }
    }

    function handlePointerUp(_e: PointerEvent) {
      if (isPanning) { isPanning = false; return }

      // Finish sketch drawing
      if (isSketchDrawing) {
        isSketchDrawing = false
        rasterizeAndPlaceSketch()
        return
      }

      // Finish tile selection
      // Finish marquee drag-select
      if (isMarqueeSelecting) {
        isMarqueeSelecting = false
        const rect = renderer.marqueeRect
        renderer.marqueeRect = null
        renderer.markDirty()

        if (rect && marqueeLayerId && (rect.w > 2 || rect.h > 2)) {
          const map = getMap()
          if (map) {
            const layer = map.layers.find(l => l.id === marqueeLayerId)
            if (layer && (layer.type === 'object' || layer.type === 'drawing')) {
              const rx = rect.x, ry = rect.y, rr = rect.x + rect.w, rb = rect.y + rect.h
              const hitIds: string[] = []
              for (const obj of layer.objects) {
                // Object overlaps marquee if their AABBs intersect
                const ox = obj.x, oy = obj.y, or = obj.x + obj.width, ob = obj.y + obj.height
                if (ox < rr && or > rx && oy < rb && ob > ry) {
                  hitIds.push(obj.id)
                }
              }
              if (hitIds.length > 0) {
                selectObjects(marqueeLayerId, hitIds)
              }
            }
          }
        }
        marqueeLayerId = null
        return
      }

      // Finish image layer drag/resize
      if ((isDraggingImageLayer || isResizingImageLayer) && dragImageLayer) {
        // Persist the final position/size to the store
        updateImageLayer(dragImageLayer.id, {
          x: dragImageLayer.x,
          y: dragImageLayer.y,
          width: dragImageLayer.width,
          height: dragImageLayer.height
        })
        isDraggingImageLayer = false
        isResizingImageLayer = false
        dragImageLayer = null
        resizeHandle = null
        return
      }

      // Finish multi-object drag
      if (isDraggingMultiObjects && dragMultiObjects.length > 0) {
        const sel = getSelection()
        if (sel && (sel.type === 'objects' || sel.type === 'object')) {
          const moveCommands: MoveObjectCommand[] = []
          for (const entry of dragMultiObjects) {
            if (entry.obj.x !== entry.startX || entry.obj.y !== entry.startY) {
              moveCommands.push(new MoveObjectCommand(
                sel.layerId, entry.obj.id,
                entry.startX, entry.startY,
                entry.obj.x, entry.obj.y
              ))
            }
          }
          if (moveCommands.length > 0) {
            const cmd = new BatchCommand('Move objects', moveCommands)
            getHistory().pushExecuted(cmd)
          }
        }
        isDraggingMultiObjects = false
        dragMultiObjects = []
        return
      }

      // Finish object drag
      if (isDraggingObject && dragObject) {
        const sel = getSelection()
        if (sel && sel.type === 'object') {
          // Only create command if actually moved
          if (dragObject.x !== dragObjStartX || dragObject.y !== dragObjStartY) {
            const cmd = new MoveObjectCommand(
              sel.layerId, dragObject.id,
              dragObjStartX, dragObjStartY,
              dragObject.x, dragObject.y
            )
            getHistory().pushExecuted(cmd)
          }
        }
        isDraggingObject = false
        dragObject = null
        return
      }

      if (isDrawing && strokePositions.length > 0) {
        const map = getMap()!
        const tool = getActiveTool()
        if (tool === 'paint') {
          const cmd = new PaintCommand(map.activeLayerId, [...strokePositions], getSelectedTile()!, [...strokePreviousTiles])
          getHistory().pushExecuted(cmd)
        } else if (tool === 'eraser') {
          const cmd = new EraseCommand(map.activeLayerId, [...strokePositions], [...strokePreviousTiles])
          getHistory().pushExecuted(cmd)
        }
      }
      isDrawing = false
      paintedCells.clear()
      strokePositions = []
      strokePreviousTiles = []
    }

    function handleWheel(e: WheelEvent) {
      e.preventDefault()
      renderer.camera.zoomAt(e.offsetX, e.offsetY, e.deltaY)
      setZoomPercent(renderer.camera.zoom * 100)
      renderer.markDirty()
    }

    function handleContextMenu(e: MouseEvent) {
      e.preventDefault()
      const map = getMap()
      if (!map) return
      const tool = getActiveTool()
      if (tool !== 'select' && tool !== 'object' && tool !== 'sketch') return
      const activeLayer = map.layers.find(l => l.id === map.activeLayerId)
      if (!activeLayer || (activeLayer.type !== 'object' && activeLayer.type !== 'drawing')) return

      const world = renderer.camera.screenToWorld(e.offsetX, e.offsetY)
      const hitResult = renderer.hitTestObject(world.wx, world.wy)
      if (!hitResult) return

      // If clicking on an object that's not part of the current selection, select it
      if (!isObjectSelected(hitResult.obj.id)) {
        selectObject(hitResult.layerId, hitResult.obj.id)
        setActiveLayer(hitResult.layerId)
      }

      ctxMenuObjId = hitResult.obj.id
      ctxMenuLayerId = hitResult.layerId
      ctxMenuX = e.clientX
      ctxMenuY = e.clientY
      showCanvasContextMenu = true
      renderer.markDirty()
    }

    /** Close canvas context menu on any click elsewhere */
    function handleDocClickForCtxMenu(e: MouseEvent) {
      if (showCanvasContextMenu) {
        const menuEl = document.querySelector('.canvas-context-menu')
        if (menuEl && !menuEl.contains(e.target as Node)) {
          closeCanvasContextMenu()
        }
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept keys when typing in input fields
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return

      if (e.code === 'Escape' && showCanvasContextMenu) {
        closeCanvasContextMenu()
        return
      }
      // Escape deselects stamp tool
      if (e.code === 'Escape' && getActiveTool() === 'stamp') {
        selectPreset(null)
        setActiveTool('select')
        renderer.previewTiles = null
        renderer.previewObjects = null
        renderer.markDirty()
        return
      }

      if (matchesKey('canvas.pan', e)) { spaceHeld = true; e.preventDefault() }

      // Zone drawing: undo last point with Ctrl+Z, Backspace, or Delete
      if (renderer.activeZonePoints.length > 0) {
        if ((e.ctrlKey && e.code === 'KeyZ') || e.code === 'Backspace' || e.code === 'Delete') {
          e.preventDefault()
          e.stopPropagation()
          renderer.activeZonePoints.pop()
          if (renderer.activeZonePoints.length === 0) {
            renderer.zoneMousePos = null
          }
          renderer.markDirty()
          return
        }
      }

      // Path drawing: undo last point with Ctrl+Z, Backspace, or Delete
      if (renderer.activePathPoints.length > 0) {
        if ((e.ctrlKey && e.code === 'KeyZ') || e.code === 'Backspace' || e.code === 'Delete') {
          e.preventDefault()
          e.stopPropagation()
          renderer.activePathPoints.pop()
          if (renderer.activePathPoints.length === 0) {
            renderer.pathMousePos = null
          }
          renderer.markDirty()
          return
        }
        // Enter: commit open path (≥2 points)
        if (e.code === 'Enter' && renderer.activePathPoints.length >= 2) {
          e.preventDefault()
          const map = getMap()
          if (map) {
            const activeLayer = map.layers.find(l => l.id === map.activeLayerId)
            if (activeLayer && activeLayer.type === 'object') {
              commitPath(activeLayer, [...renderer.activePathPoints], false)
            }
          }
          return
        }
      }

      // Escape cancels text input
      if (e.code === 'Escape' && showTextInput) {
        showTextInput = false
        textInputValue = ''
        return
      }

      // Escape cancels active sketch drawing
      if (e.code === 'Escape' && isSketchDrawing) {
        isSketchDrawing = false
        renderer.activeSketchPoints = []
        renderer.sketchStartPoint = null
        renderer.sketchMousePos = null
        sketchPoints = []
        sketchStartW = null
        renderer.markDirty()
        return
      }

      // Escape cancels active zone drawing
      if (e.code === 'Escape' && renderer.activeZonePoints.length > 0) {
        renderer.activeZonePoints = []
        renderer.zoneMousePos = null
        renderer.markDirty()
      }

      // Escape cancels active path drawing
      if (e.code === 'Escape' && renderer.activePathPoints.length > 0) {
        renderer.activePathPoints = []
        renderer.pathMousePos = null
        renderer.markDirty()
        return
      }

      // Copy selected object(s)
      if (matchesKey('canvas.copy', e)) {
        const sel = getSelection()
        if (sel && sel.type === 'objects') {
          const map = getMap()
          if (map) {
            const layer = map.layers.find(l => l.id === sel.layerId)
            if (layer && (layer.type === 'object' || layer.type === 'drawing')) {
              clipboardObjects = sel.objectIds
                .map(id => layer.objects.find(o => o.id === id))
                .filter((o): o is MapObject => !!o)
                .map(o => ({ ...o }))
              clipboardObject = null
              clipboardLayerId = sel.layerId
              e.preventDefault()
            }
          }
        } else if (sel && sel.type === 'object') {
          const map = getMap()
          if (map) {
            const layer = map.layers.find(l => l.id === sel.layerId)
            if (layer && (layer.type === 'object' || layer.type === 'drawing')) {
              const obj = layer.objects.find(o => o.id === sel.objectId)
              if (obj) {
                clipboardObject = { ...obj }
                clipboardObjects = []
                clipboardLayerId = sel.layerId
                e.preventDefault()
              }
            }
          }
        }
        return
      }

      // Paste copied object(s)
      if (matchesKey('canvas.paste', e)) {
        const map = getMap()
        if (!map) return

        const activeLayer = map.layers.find(l => l.id === map.activeLayerId)
        const targetLayerId = (activeLayer && (activeLayer.type === 'object' || activeLayer.type === 'drawing'))
          ? activeLayer.id
          : (clipboardLayerId || map.activeLayerId)

        if (clipboardObjects.length > 0) {
          // Multi-paste
          const placeCommands: PlaceObjectCommand[] = []
          const newIds: string[] = []
          for (const src of clipboardObjects) {
            const newObj: MapObject = {
              ...src,
              id: crypto.randomUUID(),
              x: src.x + 20,
              y: src.y + 20
            }
            if (newObj.imageDataUrl) {
              const hash = registerImageSync(newObj.imageDataUrl)
              newObj.imageHash = hash
              newObj.imageBitmap = getBitmap(hash)
            }
            placeCommands.push(new PlaceObjectCommand(targetLayerId, newObj))
            newIds.push(newObj.id)
          }
          const cmd = new BatchCommand('Paste objects', placeCommands)
          executeCommand(cmd)
          selectObjects(targetLayerId, newIds)
          // Update clipboard for next paste offset
          clipboardObjects = clipboardObjects.map(o => ({ ...o, x: o.x + 20, y: o.y + 20 }))
          clipboardLayerId = targetLayerId
          renderer.markDirty()
          e.preventDefault()
        } else if (clipboardObject) {
          const newObj: MapObject = {
            ...clipboardObject,
            id: crypto.randomUUID(),
            x: clipboardObject.x + 20,
            y: clipboardObject.y + 20
          }
          if (newObj.imageDataUrl) {
            const hash = registerImageSync(newObj.imageDataUrl)
            newObj.imageHash = hash
            newObj.imageBitmap = getBitmap(hash)
          }
          const cmd = new PlaceObjectCommand(targetLayerId, newObj)
          executeCommand(cmd)
          selectObject(targetLayerId, newObj.id)
          clipboardObject = { ...newObj }
          clipboardLayerId = targetLayerId
          renderer.markDirty()
          e.preventDefault()
        }
        return
      }

      // Duplicate selected object(s) in-place
      if (matchesKey('canvas.duplicate', e)) {
        const sel = getSelection()
        const map = getMap()
        if (!map) return

        if (sel && sel.type === 'objects') {
          const layer = map.layers.find(l => l.id === sel.layerId)
          if (layer && (layer.type === 'object' || layer.type === 'drawing')) {
            const placeCommands: PlaceObjectCommand[] = []
            const newIds: string[] = []
            for (const objId of sel.objectIds) {
              const obj = layer.objects.find(o => o.id === objId)
              if (obj) {
                const newObj: MapObject = {
                  ...obj,
                  id: crypto.randomUUID(),
                  x: obj.x + 20,
                  y: obj.y + 20
                }
                placeCommands.push(new PlaceObjectCommand(sel.layerId, newObj))
                newIds.push(newObj.id)
              }
            }
            if (placeCommands.length > 0) {
              const cmd = new BatchCommand('Duplicate objects', placeCommands)
              executeCommand(cmd)
              selectObjects(sel.layerId, newIds)
              renderer.markDirty()
              e.preventDefault()
            }
          }
        } else if (sel && sel.type === 'object') {
          const layer = map.layers.find(l => l.id === sel.layerId)
          if (layer && (layer.type === 'object' || layer.type === 'drawing')) {
            const obj = layer.objects.find(o => o.id === sel.objectId)
            if (obj) {
              const newObj: MapObject = {
                ...obj,
                id: crypto.randomUUID(),
                x: obj.x + 20,
                y: obj.y + 20
              }
              const cmd = new PlaceObjectCommand(sel.layerId, newObj)
              executeCommand(cmd)
              selectObject(sel.layerId, newObj.id)
              renderer.markDirty()
              e.preventDefault()
            }
          }
        }
        return
      }

      // Delete selected object(s) or zone (skip if locked)
      if (matchesKey('canvas.delete', e) || e.code === 'Backspace') {
        const sel = getSelection()
        if (!sel) return
        const map = getMap()
        if (!map) return
        const layer = map.layers.find(l => l.id === sel.layerId)
        if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return

        if (sel.type === 'objects') {
          const deleteCommands: DeleteObjectCommand[] = []
          for (const objId of sel.objectIds) {
            const obj = layer.objects.find(o => o.id === objId)
            if (obj && !obj.locked) {
              deleteCommands.push(new DeleteObjectCommand(sel.layerId, obj))
            }
          }
          if (deleteCommands.length > 0) {
            const cmd = new BatchCommand('Delete objects', deleteCommands)
            executeCommand(cmd)
            clearSelection()
            renderer.markDirty()
          }
        } else if (sel.type === 'object') {
          const obj = layer.objects.find(o => o.id === sel.objectId)
          if (obj && !obj.locked) {
            const cmd = new DeleteObjectCommand(sel.layerId, obj)
            executeCommand(cmd)
            clearSelection()
            renderer.markDirty()
          }
        } else if (sel.type === 'zone') {
          const zone = layer.zones.find(z => z.id === sel.zoneId)
          if (zone) {
            const cmd = new DeleteZoneCommand(sel.layerId, zone)
            executeCommand(cmd)
            clearSelection()
            renderer.markDirty()
          }
        } else if (sel.type === 'path') {
          if (layer.type === 'object') {
            const path = layer.paths.find(p => p.id === sel.pathId)
            if (path) {
              const cmd = new DeletePathCommand(sel.layerId, path)
              executeCommand(cmd)
              clearSelection()
              renderer.markDirty()
            }
          }
        }
      }
    }

    function handleKeyUp(e: KeyboardEvent) {
      if (matchesKey('canvas.pan', e)) spaceHeld = false
    }

    function handleToggleGrid() {
      renderer.showGrid = !renderer.showGrid
      renderer.markDirty()
    }

    function handleJumpTo(e: Event) {
      const { wx, wy } = (e as CustomEvent).detail
      const rect = containerEl.getBoundingClientRect()
      // Apply configured zoom level (0 = keep current)
      const jumpZoom = getSettings().jumpToZoom
      if (jumpZoom > 0) {
        renderer.camera.zoom = Math.max(
          renderer.camera.minZoom,
          Math.min(renderer.camera.maxZoom, jumpZoom / 100)
        )
        setZoomPercent(renderer.camera.zoom * 100)
      }
      renderer.camera.x = wx - rect.width / (2 * renderer.camera.zoom)
      renderer.camera.y = wy - rect.height / (2 * renderer.camera.zoom)
      renderer.markDirty()
    }

    function handlePointerLeave() {
      renderer.previewTiles = null
      renderer.previewObjects = null
      renderer.hoverCol = -1
      renderer.hoverRow = -1
      renderer.markDirty()
    }

    canvasEl.addEventListener('pointerdown', handlePointerDown)
    canvasEl.addEventListener('pointermove', handlePointerMove)
    canvasEl.addEventListener('pointerup', handlePointerUp)
    canvasEl.addEventListener('pointerleave', handlePointerLeave)
    canvasEl.addEventListener('wheel', handleWheel, { passive: false })
    canvasEl.addEventListener('contextmenu', handleContextMenu)
    document.addEventListener('mousedown', handleDocClickForCtxMenu, true)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('toggle-grid', handleToggleGrid)
    window.addEventListener('jump-to', handleJumpTo)

    return () => {
      unsub()
      unsubSel()
      unsubSketch()
      resizeObserver.disconnect()
      renderer.destroy()
      canvasEl.removeEventListener('pointerdown', handlePointerDown)
      canvasEl.removeEventListener('pointermove', handlePointerMove)
      canvasEl.removeEventListener('pointerleave', handlePointerLeave)
      canvasEl.removeEventListener('pointerup', handlePointerUp)
      canvasEl.removeEventListener('wheel', handleWheel)
      canvasEl.removeEventListener('contextmenu', handleContextMenu)
      document.removeEventListener('mousedown', handleDocClickForCtxMenu, true)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('toggle-grid', handleToggleGrid)
      window.removeEventListener('jump-to', handleJumpTo)
    }
  })
</script>

<div class="canvas-wrapper" class:drawing-active={isDrawingLayerActive} bind:this={containerEl}>
  <canvas bind:this={canvasEl}></canvas>
  <SketchToolbar />
</div>

{#if showCanvasContextMenu}
  {@const map = getMap()}
  {@const layer = map?.layers.find(l => l.id === ctxMenuLayerId)}
  {@const sel = getSelection()}
  {@const isMulti = sel?.type === 'objects'}
  {@const ids = isMulti ? sel.objectIds : ctxMenuObjId ? [ctxMenuObjId] : []}
  {@const objs = (layer && (layer.type === 'object' || layer.type === 'drawing')) ? ids.map(id => layer.objects.find(o => o.id === id)).filter(Boolean) : []}
  {@const anyLocked = objs.some(o => o?.locked)}
  {@const allLocked = objs.length > 0 && objs.every(o => o?.locked)}
  {@const anyHidden = objs.some(o => o?.visible === false)}
  {@const allHidden = objs.length > 0 && objs.every(o => o?.visible === false)}
  {@const groups = (layer && layer.type === 'object' && layer.groups) ? layer.groups : []}
  {@const currentGroupId = (!isMulti && objs[0]) ? objs[0].groupId : undefined}
  {@const isManualSort = layer && layer.type === 'object' && layer.sortMode === 'manual'}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="canvas-context-menu" style="left:{ctxMenuX}px;top:{ctxMenuY}px" onkeydown={(e) => { if (e.key === 'Escape') closeCanvasContextMenu() }}>
    {#if isMulti}
      <div class="ctx-header">{ids.length} Objects</div>
    {:else if objs[0]}
      <div class="ctx-header">{objs[0].name}</div>
    {/if}
    <div class="ctx-separator"></div>
    {#if allHidden}
      <button class="ctx-item" onclick={ctxShow}>
        <span class="ctx-icon"><svg width="13" height="13" viewBox="0 0 576 512" fill="currentColor"><path d="M288 80c-65.2 0-118.8 29.6-159.9 67.7C89.6 183.5 63 226 49.4 256c13.6 30 40.2 72.5 78.6 108.3C169.2 402.4 222.8 432 288 432s118.8-29.6 159.9-67.7C486.4 328.5 513 286 526.6 256c-13.6-30-40.2-72.5-78.6-108.3C406.8 109.6 353.2 80 288 80zM95.4 112.6C142.5 68.8 207.2 32 288 32s145.5 36.8 192.6 80.6c46.8 43.5 78.1 95.4 93 131.1c3.3 7.9 3.3 16.7 0 24.6c-14.9 35.7-46.2 87.7-93 131.1C433.5 443.2 368.8 480 288 480s-145.5-36.8-192.6-80.6C48.6 356 17.3 304 2.5 268.3c-3.3-7.9-3.3-16.7 0-24.6C17.3 208 48.6 156 95.4 112.6zM288 336c44.2 0 80-35.8 80-80s-35.8-80-80-80s-80 35.8-80 80s35.8 80 80 80z"/></svg></span> Show{isMulti ? ' All' : ''}
      </button>
    {:else}
      <button class="ctx-item" onclick={ctxHide}>
        <span class="ctx-icon"><svg width="13" height="13" viewBox="0 0 640 512" fill="currentColor"><path d="M38.8 5.1C28.4-3.1 13.3-1.2 5.1 9.2S-1.2 34.7 9.2 42.9l592 464c10.4 8.2 25.5 6.3 33.7-4.1s6.3-25.5-4.1-33.7L525.6 386.7c39.6-40.6 66.4-86.1 79.9-118.4c3.3-7.9 3.3-16.7 0-24.6c-14.9-35.7-46.2-87.7-93-131.1C465.5 68.8 400.8 32 320 32c-68.2 0-125 26.3-169.3 60.8L38.8 5.1z"/></svg></span> Hide{isMulti ? ' All' : ''}
      </button>
    {/if}
    {#if allLocked}
      <button class="ctx-item" onclick={ctxUnlock}>
        <span class="ctx-icon">🔓</span> Unlock{isMulti ? ' All' : ''}
      </button>
    {:else}
      <button class="ctx-item" onclick={ctxLock}>
        <span class="ctx-icon">🔒</span> Lock{isMulti ? ' All' : ''}
      </button>
    {/if}
    <div class="ctx-separator"></div>
    <button class="ctx-item" onclick={ctxCopy}>
      <span class="ctx-icon">📋</span> Copy
      <span class="ctx-shortcut">Ctrl+C</span>
    </button>
    <button class="ctx-item" onclick={ctxDuplicate}>
      <span class="ctx-icon">📄</span> Duplicate
      <span class="ctx-shortcut">Ctrl+D</span>
    </button>
    <button class="ctx-item ctx-danger" onclick={ctxDelete} disabled={allLocked}>
      <span class="ctx-icon">🗑️</span> Delete{isMulti ? ' All' : ''}
      <span class="ctx-shortcut">Del</span>
    </button>
    <div class="ctx-separator"></div>
    <button class="ctx-item" onclick={ctxFlipX} disabled={allLocked}>
      <span class="ctx-icon">↔</span> Flip Horizontal
    </button>
    <button class="ctx-item" onclick={ctxFlipY} disabled={allLocked}>
      <span class="ctx-icon">↕</span> Flip Vertical
    </button>
    <div class="ctx-separator"></div>
    <button class="ctx-item" onclick={() => ctxReorder('front')}>
      <span class="ctx-icon">⇈</span> Bring to Front
    </button>
    <button class="ctx-item" onclick={() => ctxReorder('up')}>
      <span class="ctx-icon">↑</span> Bring Forward
    </button>
    <button class="ctx-item" onclick={() => ctxReorder('down')}>
      <span class="ctx-icon">↓</span> Send Backward
    </button>
    <button class="ctx-item" onclick={() => ctxReorder('back')}>
      <span class="ctx-icon">⇊</span> Send to Back
    </button>
    {#if isManualSort}
      <button class="ctx-item" onclick={ctxResetOrder}>
        <span class="ctx-icon">↻</span> Reset to Auto Sort
      </button>
    {/if}
    {#if layer && layer.type === 'object' && (groups.length > 0 || ids.length > 0)}
      <div class="ctx-separator"></div>
      <button class="ctx-item" onclick={ctxNewGroupWithSelection}>
        <span class="ctx-icon">📁</span> New Group with {isMulti ? 'Selection' : 'Object'}
      </button>
      {#each groups as g}
        {#if g.id !== currentGroupId || isMulti}
          <button class="ctx-item" onclick={() => ctxMoveToGroup(g.id)}>
            <span class="ctx-icon">→</span> Move to "{g.name}"
          </button>
        {/if}
      {/each}
      {#if currentGroupId && !isMulti}
        <button class="ctx-item" onclick={ctxRemoveFromGroup}>
          <span class="ctx-icon">✕</span> Remove from Group
        </button>
      {/if}
      {#if isMulti}
        <button class="ctx-item" onclick={ctxRemoveFromGroup}>
          <span class="ctx-icon">✕</span> Remove All from Group
        </button>
      {/if}
    {/if}
    <div class="ctx-separator"></div>
    <button class="ctx-item" onclick={openPresetNameDialogFromObjects}>
      <span class="ctx-icon">📦</span> Als Preset speichern
    </button>
  </div>
{/if}

{#if showPresetNameDialog}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fill-confirm-overlay" onkeydown={(e) => { if (e.key === 'Escape') cancelPresetNameDialog(); if (e.key === 'Enter') savePresetFromSelection() }}>
    <div class="fill-confirm-dialog">
      <h3>Preset speichern</h3>
      <p>Name für das Preset:</p>
      <input
        bind:this={presetNameInputRef}
        class="preset-name-input"
        type="text"
        bind:value={presetNameValue}
        placeholder="Preset Name"
        use:focusOnMount
      />
      <div class="fill-confirm-buttons">
        <button class="cancel-btn" onclick={cancelPresetNameDialog}>Abbrechen</button>
        <button class="confirm-btn" onclick={savePresetFromSelection}>Speichern</button>
      </div>
    </div>
  </div>
{/if}

{#if showCreateDrawingLayerPrompt}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fill-confirm-overlay" onkeydown={(e) => { if (e.key === 'Escape') cancelCreateDrawingLayer(); if (e.key === 'Enter') confirmCreateDrawingLayer() }}>
    <div class="fill-confirm-dialog">
      <h3>Drawing Layer Required</h3>
      <p>The sketch tool requires a <strong>Drawing layer</strong>. No drawing layer exists yet.</p>
      <p>Create a new Drawing layer?</p>
      <div class="fill-confirm-buttons">
        <button class="cancel-btn" onclick={cancelCreateDrawingLayer}>Cancel</button>
        <button class="confirm-btn" onclick={confirmCreateDrawingLayer}>Create</button>
      </div>
    </div>
  </div>
{/if}

{#if showTextInput}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="text-input-overlay" onclick={() => rasterizeAndPlaceText()}>
    <div
      class="text-input-container"
      style="left:{textInputX}px;top:{textInputY}px"
      onclick={(e) => e.stopPropagation()}
    >
      <textarea
        bind:this={textInputEl}
        bind:value={textInputValue}
        class="text-input-field"
        style="color:{getSketchSettings().color};font-size:{getSketchSettings().fontSize}px;font-family:{getSketchSettings().fontFamily}"
        placeholder="Type text..."
        rows="1"
        onkeydown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            rasterizeAndPlaceText()
          }
          if (e.key === 'Escape') {
            showTextInput = false
            textInputValue = ''
          }
        }}
        oninput={(e) => {
          const ta = e.target as HTMLTextAreaElement
          ta.style.height = 'auto'
          ta.style.height = ta.scrollHeight + 'px'
        }}
      ></textarea>
      <div class="text-input-hint">Enter to confirm &middot; Shift+Enter for new line &middot; Esc to cancel</div>
    </div>
  </div>
{/if}

{#if showFillConfirm}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fill-confirm-overlay" onkeydown={(e) => { if (e.key === 'Escape') cancelFill(); if (e.key === 'Enter') confirmFill() }}>
    <div class="fill-confirm-dialog">
      <h3>Large Fill Operation</h3>
      <p>This fill will affect more than <strong>{getSettings().fillWarningThreshold.toLocaleString()}</strong> tiles. This may cause a short lag.</p>
      <p>Do you want to continue?</p>
      <div class="fill-confirm-buttons">
        <button class="cancel-btn" onclick={cancelFill}>Cancel</button>
        <button class="confirm-btn" onclick={confirmFill}>Fill</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .canvas-wrapper {
    width: 100%;
    height: 100%;
    position: relative;
    cursor: crosshair;
  }

  .canvas-wrapper.drawing-active {
    cursor: default;
  }

  canvas {
    position: absolute;
    top: 0;
    left: 0;
  }

  .fill-confirm-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .fill-confirm-dialog {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 24px;
    width: 360px;
  }

  .fill-confirm-dialog h3 {
    margin: 0 0 12px;
    font-size: 16px;
    color: var(--text-primary);
  }

  .fill-confirm-dialog p {
    margin: 0 0 8px;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .fill-confirm-dialog strong {
    color: #fab387;
  }

  .fill-confirm-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }

  .fill-confirm-buttons .cancel-btn {
    padding: 6px 16px;
  }

  .fill-confirm-buttons .confirm-btn {
    background: var(--accent);
    color: var(--bg-primary);
    border-color: var(--accent);
    font-weight: 600;
    padding: 6px 16px;
  }

  .fill-confirm-buttons .confirm-btn:hover {
    background: var(--accent-hover);
  }

  /* Canvas context menu */
  .canvas-context-menu {
    position: fixed;
    z-index: 1500;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 4px 0;
    min-width: 200px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }

  .ctx-header {
    padding: 4px 12px 2px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 220px;
  }

  .ctx-separator {
    height: 1px;
    background: var(--border-color);
    margin: 3px 8px;
  }

  .ctx-item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 5px 12px;
    border: none;
    background: none;
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    text-align: left;
    gap: 8px;
    white-space: nowrap;
  }

  .ctx-item:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .ctx-item:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .ctx-item.ctx-danger:hover:not(:disabled) {
    background: rgba(243, 139, 168, 0.15);
    color: #f38ba8;
  }

  .ctx-icon {
    font-size: 13px;
    width: 18px;
    text-align: center;
    flex-shrink: 0;
  }

  .ctx-shortcut {
    margin-left: auto;
    font-size: 11px;
    color: var(--text-muted);
    padding-left: 16px;
  }

  /* Text input overlay */
  .text-input-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 200;
    cursor: default;
  }

  .text-input-container {
    position: absolute;
    transform: translate(0, -4px);
  }

  .text-input-field {
    background: transparent;
    border: 1px dashed var(--accent);
    border-radius: 2px;
    outline: none;
    padding: 4px 6px;
    min-width: 80px;
    max-width: 500px;
    resize: none;
    overflow: hidden;
    line-height: 1.3;
    caret-color: var(--accent);
  }

  .text-input-field::placeholder {
    color: var(--text-muted);
    opacity: 0.5;
    font-size: 14px !important;
  }

  .text-input-hint {
    font-size: 10px;
    color: var(--text-muted);
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 3px;
    padding: 2px 6px;
    margin-top: 4px;
    white-space: nowrap;
    width: fit-content;
  }

  .preset-name-input {
    width: 100%;
    padding: 6px 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    margin: 8px 0;
  }

  .preset-name-input:focus {
    outline: none;
    border-color: var(--accent);
  }
</style>