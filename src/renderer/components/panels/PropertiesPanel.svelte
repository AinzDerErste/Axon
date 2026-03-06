<script lang="ts">
  import { onMount } from 'svelte'
  import {
    getSelection, getSelectedObjectIds,
    subscribe as selSubscribe,
    type SelectionTarget
  } from '../../lib/stores/selection-store'
  import {
    getMap, updateObject, updateZone, updateImageLayer,
    subscribe as mapSubscribe
  } from '../../lib/stores/map-store'
  import type { MapObject, Zone, ImageLayer, ObjectLayer } from '../../lib/models/layer'

  let selection = $state<SelectionTarget>(null)
  let selectedObject = $state<MapObject | null>(null)
  let selectedZone = $state<Zone | null>(null)
  let selectedImageLayer = $state<ImageLayer | null>(null)
  let multiSelectedObjects = $state<MapObject[]>([])

  function refresh() {
    selection = getSelection()
    const map = getMap()
    if (!map || !selection) {
      selectedObject = null
      selectedZone = null
      selectedImageLayer = null
      multiSelectedObjects = []
      return
    }
    const layer = map.layers.find(l => l.id === selection!.layerId)
    if (!layer) {
      selectedObject = null
      selectedZone = null
      selectedImageLayer = null
      multiSelectedObjects = []
      return
    }
    if (selection.type === 'image-layer' && layer.type === 'image') {
      selectedImageLayer = layer
      selectedObject = null
      selectedZone = null
      multiSelectedObjects = []
      return
    }
    selectedImageLayer = null
    if (layer.type !== 'object' && layer.type !== 'drawing') {
      selectedObject = null
      selectedZone = null
      multiSelectedObjects = []
      return
    }
    if (selection.type === 'object') {
      selectedObject = layer.objects.find(o => o.id === (selection as { type: 'object'; objectId: string }).objectId) ?? null
      selectedZone = null
      multiSelectedObjects = []
    } else if (selection.type === 'objects') {
      const ids = (selection as { type: 'objects'; objectIds: string[] }).objectIds
      multiSelectedObjects = layer.objects.filter(o => ids.includes(o.id))
      selectedObject = null
      selectedZone = null
    } else if (selection.type === 'zone' && layer.type === 'object') {
      selectedZone = layer.zones.find(z => z.id === (selection as { type: 'zone'; zoneId: string }).zoneId) ?? null
      selectedObject = null
      multiSelectedObjects = []
    } else {
      selectedObject = null
      selectedZone = null
      multiSelectedObjects = []
    }
  }

  onMount(() => {
    const unsub1 = selSubscribe(refresh)
    const unsub2 = mapSubscribe(refresh)
    refresh()
    return () => { unsub1(); unsub2() }
  })

  // Object property handlers
  function handleObjectNameChange(e: Event) {
    if (!selection || selection.type !== 'object') return
    updateObject(selection.layerId, selection.objectId, { name: (e.target as HTMLInputElement).value })
  }

  function handleObjectXChange(e: Event) {
    if (!selection || selection.type !== 'object') return
    const val = parseFloat((e.target as HTMLInputElement).value)
    if (!isNaN(val)) updateObject(selection.layerId, selection.objectId, { x: val })
  }

  function handleObjectYChange(e: Event) {
    if (!selection || selection.type !== 'object') return
    const val = parseFloat((e.target as HTMLInputElement).value)
    if (!isNaN(val)) updateObject(selection.layerId, selection.objectId, { y: val })
  }

  function handleObjectWidthChange(e: Event) {
    if (!selection || selection.type !== 'object') return
    const val = parseFloat((e.target as HTMLInputElement).value)
    if (!isNaN(val) && val > 0) updateObject(selection.layerId, selection.objectId, { width: val })
  }

  function handleObjectHeightChange(e: Event) {
    if (!selection || selection.type !== 'object') return
    const val = parseFloat((e.target as HTMLInputElement).value)
    if (!isNaN(val) && val > 0) updateObject(selection.layerId, selection.objectId, { height: val })
  }

  function handleObjectFlipX() {
    if (!selection || selection.type !== 'object' || !selectedObject) return
    updateObject(selection.layerId, selection.objectId, { flipX: !selectedObject.flipX })
  }

  function handleObjectFlipY() {
    if (!selection || selection.type !== 'object' || !selectedObject) return
    updateObject(selection.layerId, selection.objectId, { flipY: !selectedObject.flipY })
  }

  function handleObjectRotationChange(e: Event) {
    if (!selection || selection.type !== 'object') return
    const val = parseFloat((e.target as HTMLInputElement).value)
    if (!isNaN(val)) updateObject(selection.layerId, selection.objectId, { rotation: val })
  }

  function handleObjectScaleChange(e: Event) {
    if (!selection || selection.type !== 'object' || !selectedObject) return
    const pct = parseFloat((e.target as HTMLInputElement).value)
    if (isNaN(pct) || pct <= 0) return
    // Find original size from imageBitmap or imageDataUrl
    const bmp = selectedObject.imageBitmap
    if (!bmp) return
    const origW = bmp.width
    const origH = bmp.height
    const factor = pct / 100
    updateObject(selection.layerId, selection.objectId, {
      width: Math.round(origW * factor),
      height: Math.round(origH * factor)
    })
  }

  // Zone property handlers
  function handleZoneNameChange(e: Event) {
    if (!selection || selection.type !== 'zone') return
    updateZone(selection.layerId, selection.zoneId, { name: (e.target as HTMLInputElement).value })
  }

  function handleZoneColorChange(e: Event) {
    if (!selection || selection.type !== 'zone') return
    updateZone(selection.layerId, selection.zoneId, { color: (e.target as HTMLInputElement).value })
  }

  function handleZoneClosedChange(e: Event) {
    if (!selection || selection.type !== 'zone') return
    updateZone(selection.layerId, selection.zoneId, { closed: (e.target as HTMLInputElement).checked })
  }

  // Image layer property handlers
  // Batch editing handlers for multi-selection
  let batchScalePercent = $state(100)

  function handleBatchScale(e: Event) {
    if (!selection || selection.type !== 'objects') return
    const pct = parseFloat((e.target as HTMLInputElement).value)
    if (isNaN(pct) || pct <= 0) return
    batchScalePercent = pct
    const factor = pct / 100
    for (const obj of multiSelectedObjects) {
      if (obj.locked || !obj.imageBitmap) continue
      const origW = obj.imageBitmap.width
      const origH = obj.imageBitmap.height
      updateObject(selection.layerId, obj.id, {
        width: Math.round(origW * factor),
        height: Math.round(origH * factor)
      })
    }
  }

  function handleBatchFlipX() {
    if (!selection || selection.type !== 'objects') return
    for (const obj of multiSelectedObjects) {
      if (obj.locked) continue
      updateObject(selection.layerId, obj.id, { flipX: !obj.flipX })
    }
  }

  function handleBatchFlipY() {
    if (!selection || selection.type !== 'objects') return
    for (const obj of multiSelectedObjects) {
      if (obj.locked) continue
      updateObject(selection.layerId, obj.id, { flipY: !obj.flipY })
    }
  }

  function handleBatchLockToggle() {
    if (!selection || selection.type !== 'objects') return
    // If any are unlocked, lock all; otherwise unlock all
    const anyUnlocked = multiSelectedObjects.some(o => !o.locked)
    for (const obj of multiSelectedObjects) {
      updateObject(selection.layerId, obj.id, { locked: anyUnlocked })
    }
  }

  function handleImgNameChange(e: Event) {
    if (!selection || selection.type !== 'image-layer') return
    updateImageLayer(selection.layerId, { name: (e.target as HTMLInputElement).value })
  }

  function handleImgXChange(e: Event) {
    if (!selection || selection.type !== 'image-layer') return
    const val = parseFloat((e.target as HTMLInputElement).value)
    if (!isNaN(val)) updateImageLayer(selection.layerId, { x: val })
  }

  function handleImgYChange(e: Event) {
    if (!selection || selection.type !== 'image-layer') return
    const val = parseFloat((e.target as HTMLInputElement).value)
    if (!isNaN(val)) updateImageLayer(selection.layerId, { y: val })
  }

  function handleImgWidthChange(e: Event) {
    if (!selection || selection.type !== 'image-layer') return
    const val = parseFloat((e.target as HTMLInputElement).value)
    if (!isNaN(val) && val > 0) updateImageLayer(selection.layerId, { width: val })
  }

  function handleImgHeightChange(e: Event) {
    if (!selection || selection.type !== 'image-layer') return
    const val = parseFloat((e.target as HTMLInputElement).value)
    if (!isNaN(val) && val > 0) updateImageLayer(selection.layerId, { height: val })
  }

  function handleImgOpacityChange(e: Event) {
    if (!selection || selection.type !== 'image-layer') return
    const val = parseFloat((e.target as HTMLInputElement).value) / 100
    if (!isNaN(val)) updateImageLayer(selection.layerId, { opacity: Math.max(0, Math.min(1, val)) })
  }

  function handleImgIsoTransformChange(e: Event) {
    if (!selection || selection.type !== 'image-layer') return
    updateImageLayer(selection.layerId, { isoTransform: (e.target as HTMLInputElement).checked })
  }

  function handleImgRotationChange(e: Event) {
    if (!selection || selection.type !== 'image-layer') return
    const val = parseFloat((e.target as HTMLInputElement).value)
    if (!isNaN(val)) updateImageLayer(selection.layerId, { rotation: val })
  }

  function handleObjectLockToggle() {
    if (!selection || selection.type !== 'object' || !selectedObject) return
    updateObject(selection.layerId, selection.objectId, { locked: !selectedObject.locked })
  }

  function handleObjectVisibilityToggle() {
    if (!selection || selection.type !== 'object' || !selectedObject) return
    updateObject(selection.layerId, selection.objectId, { visible: selectedObject.visible === false ? true : false })
  }

  function handleBatchVisibilityToggle() {
    if (!selection || selection.type !== 'objects') return
    const anyHidden = multiSelectedObjects.some(o => o.visible === false)
    for (const obj of multiSelectedObjects) {
      updateObject(selection.layerId, obj.id, { visible: anyHidden })
    }
  }

  function handleImgLockToggle() {
    if (!selection || selection.type !== 'image-layer' || !selectedImageLayer) return
    updateImageLayer(selection.layerId, { locked: !selectedImageLayer.locked })
  }

  function handleFitToGrid() {
    if (!selection || selection.type !== 'image-layer' || !selectedImageLayer) return
    const map = getMap()
    if (!map) return
    const { gridWidth, gridHeight, tileWidth, tileHeight } = map.config
    const orientation = map.config.orientation || 'diamond'
    const halfW = tileWidth / 2
    const halfH = tileHeight / 2

    if (selectedImageLayer.isoTransform) {
      // With iso transform: compute pre-transform rectangle that projects to the grid
      const isoLen = Math.sqrt(halfW * halfW + halfH * halfH)
      updateImageLayer(selection.layerId, {
        x: 0, y: 0,
        width: Math.round(gridWidth * isoLen),
        height: Math.round(gridHeight * isoLen),
        rotation: 0
      })
    } else if (orientation === 'staggered') {
      // Staggered: roughly rectangular bounding box
      const minX = -halfW
      const maxX = gridWidth * tileWidth + halfW
      const minY = 0
      const maxY = (gridHeight + 1) * halfH
      updateImageLayer(selection.layerId, {
        x: Math.round(minX), y: Math.round(minY),
        width: Math.round(maxX - minX),
        height: Math.round(maxY - minY),
        rotation: 0
      })
    } else {
      // Diamond: AABB of the grid diamond
      const minX = -gridHeight * halfW
      const maxX = gridWidth * halfW
      const minY = 0
      const maxY = (gridWidth + gridHeight) * halfH
      updateImageLayer(selection.layerId, {
        x: Math.round(minX), y: Math.round(minY),
        width: Math.round(maxX - minX),
        height: Math.round(maxY - minY),
        rotation: 0
      })
    }
  }

  function handleJumpTo() {
    let wx = 0, wy = 0
    if (selectedObject) {
      wx = selectedObject.x + selectedObject.width / 2
      wy = selectedObject.y + selectedObject.height / 2
    } else if (selectedZone && selectedZone.points.length > 0) {
      for (const p of selectedZone.points) { wx += p.x; wy += p.y }
      wx /= selectedZone.points.length
      wy /= selectedZone.points.length
    } else if (selectedImageLayer) {
      wx = selectedImageLayer.x + selectedImageLayer.width / 2
      wy = selectedImageLayer.y + selectedImageLayer.height / 2
    } else {
      return
    }
    window.dispatchEvent(new CustomEvent('jump-to', { detail: { wx, wy } }))
  }
</script>

<!-- svelte-ignore a11y_label_has_associated_control -->
{#if multiSelectedObjects.length > 1}
  <div class="panel">
    <div class="panel-header">
      <span class="panel-title">Properties</span>
      <div class="header-actions">
        <button class="visibility-toggle-btn" class:hidden-obj={multiSelectedObjects.every(o => o.visible === false)} onclick={handleBatchVisibilityToggle}
          title={multiSelectedObjects.some(o => o.visible === false) ? 'Show all' : 'Hide all'}>
          <svg width="14" height="14" viewBox="0 0 640 512" fill="currentColor">
            {#if multiSelectedObjects.every(o => o.visible === false)}
              <path d="M38.8 5.1C28.4-3.1 13.3-1.2 5.1 9.2S-1.2 34.7 9.2 42.9l592 464c10.4 8.2 25.5 6.3 33.7-4.1s6.3-25.5-4.1-33.7L525.6 386.7c39.6-40.6 66.4-86.1 79.9-118.4c3.3-7.9 3.3-16.7 0-24.6c-14.9-35.7-46.2-87.7-93-131.1C465.5 68.8 400.8 32 320 32c-68.2 0-125 26.3-169.3 60.8L38.8 5.1zM223.1 149.5C248.6 126.2 282.7 112 320 112c79.5 0 144 64.5 144 144c0 24.9-6.3 48.3-17.4 68.7L408 294.5c8.4-19.3 10.6-41.4 4.8-63.3c-11.1-41.5-47.8-69.4-88.6-71.1c-5.8-.2-9.2 6.1-7.4 11.7c2.1 6.4 3.3 13.2 3.3 20.3c0 10.2-2.4 19.8-6.6 28.3l-90.4-70.9zM373 389.9c-16.4 6.5-34.3 10.1-53 10.1c-79.5 0-144-64.5-144-144c0-6.9 .5-13.6 1.4-20.2L83.1 161.5C60.3 191.2 44 220.8 34.5 243.7c-3.3 7.9-3.3 16.7 0 24.6c14.9 35.7 46.2 87.7 93 131.1C174.5 443.2 239.2 480 320 480c47.8 0 89.9-12.9 126.2-32.5L373 389.9z"/>
            {:else}
              <path d="M288 80c-65.2 0-118.8 29.6-159.9 67.7C89.6 183.5 63 226 49.4 256c13.6 30 40.2 72.5 78.6 108.3C169.2 402.4 222.8 432 288 432s118.8-29.6 159.9-67.7C486.4 328.5 513 286 526.6 256c-13.6-30-40.2-72.5-78.6-108.3C406.8 109.6 353.2 80 288 80zM95.4 112.6C142.5 68.8 207.2 32 288 32s145.5 36.8 192.6 80.6c46.8 43.5 78.1 95.4 93 131.1c3.3 7.9 3.3 16.7 0 24.6c-14.9 35.7-46.2 87.7-93 131.1C433.5 443.2 368.8 480 288 480s-145.5-36.8-192.6-80.6C48.6 356 17.3 304 2.5 268.3c-3.3-7.9-3.3-16.7 0-24.6C17.3 208 48.6 156 95.4 112.6zM288 336c44.2 0 80-35.8 80-80s-35.8-80-80-80s-80 35.8-80 80s35.8 80 80 80z"/>
            {/if}
          </svg>
        </button>
        <button class="lock-btn" class:locked={multiSelectedObjects.every(o => o.locked)} onclick={handleBatchLockToggle}
          title={multiSelectedObjects.some(o => !o.locked) ? 'Lock all' : 'Unlock all'}>
          <svg width="14" height="14" viewBox="0 0 448 512" fill="currentColor">
            {#if multiSelectedObjects.every(o => o.locked)}
              <path d="M144 144v48H304V144c0-44.2-35.8-80-80-80s-80 35.8-80 80zM80 192V144C80 64.5 144.5 0 224 0s144 64.5 144 144v48h16c35.3 0 64 28.7 64 64V448c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V256c0-35.3 28.7-64 64-64H80z"/>
            {:else}
              <path d="M144 144c0-44.2 35.8-80 80-80c31.9 0 59.4 18.6 72.3 45.7c7.6 16 26.7 22.8 42.6 15.2s22.8-26.7 15.2-42.6C331.8 35.5 281.1 0 224 0C144.5 0 80 64.5 80 144v48H64c-35.3 0-64 28.7-64 64V448c0 35.3 28.7 64 64 64H384c35.3 0 64-28.7 64-64V256c0-35.3-28.7-64-64-64H144V144z"/>
            {/if}
          </svg>
        </button>
        <span class="prop-type-badge">Multi</span>
      </div>
    </div>
    <div class="panel-body properties-body">
      <div class="multi-header">{multiSelectedObjects.length} Objects Selected</div>
      <div class="prop-group">
        <label class="prop-label">Scale %</label>
        <input class="prop-input" type="number" min="1" max="1000" step="10"
          value={batchScalePercent}
          onchange={handleBatchScale} />
      </div>
      <div class="prop-group">
        <label class="prop-label">Mirror</label>
        <div class="flip-row">
          <button class="flip-btn" onclick={handleBatchFlipX}
            title="Flip Horizontal">↔ H</button>
          <button class="flip-btn" onclick={handleBatchFlipY}
            title="Flip Vertical">↕ V</button>
        </div>
      </div>
    </div>
  </div>
{:else if selectedObject || selectedZone || selectedImageLayer}
  <div class="panel">
    <div class="panel-header">
      <span class="panel-title">Properties</span>
      <div class="header-actions">
        <button class="jump-btn" onclick={handleJumpTo} title="Jump to selection">
          <svg width="14" height="14" viewBox="0 0 640 640" fill="currentColor">
            <path d="M320 48C337.7 48 352 62.3 352 80L352 98.3C450.1 112.3 527.7 189.9 541.7 288L560 288C577.7 288 592 302.3 592 320C592 337.7 577.7 352 560 352L541.7 352C527.7 450.1 450.1 527.7 352 541.7L352 560C352 577.7 337.7 592 320 592C302.3 592 288 577.7 288 560L288 541.7C189.9 527.7 112.3 450.1 98.3 352L80 352C62.3 352 48 337.7 48 320C48 302.3 62.3 288 80 288L98.3 288C112.3 189.9 189.9 112.3 288 98.3L288 80C288 62.3 302.3 48 320 48zM160 320C160 408.4 231.6 480 320 480C408.4 480 480 408.4 480 320C480 231.6 408.4 160 320 160C231.6 160 160 231.6 160 320zM320 224C373 224 416 267 416 320C416 373 373 416 320 416C267 416 224 373 224 320C224 267 267 224 320 224z"/>
          </svg>
        </button>
        {#if selectedObject}
          <button class="visibility-toggle-btn" class:hidden-obj={selectedObject.visible === false} onclick={handleObjectVisibilityToggle}
            title={selectedObject.visible === false ? 'Show' : 'Hide'}>
            <svg width="14" height="14" viewBox="0 0 640 512" fill="currentColor">
              {#if selectedObject.visible === false}
                <path d="M38.8 5.1C28.4-3.1 13.3-1.2 5.1 9.2S-1.2 34.7 9.2 42.9l592 464c10.4 8.2 25.5 6.3 33.7-4.1s6.3-25.5-4.1-33.7L525.6 386.7c39.6-40.6 66.4-86.1 79.9-118.4c3.3-7.9 3.3-16.7 0-24.6c-14.9-35.7-46.2-87.7-93-131.1C465.5 68.8 400.8 32 320 32c-68.2 0-125 26.3-169.3 60.8L38.8 5.1zM223.1 149.5C248.6 126.2 282.7 112 320 112c79.5 0 144 64.5 144 144c0 24.9-6.3 48.3-17.4 68.7L408 294.5c8.4-19.3 10.6-41.4 4.8-63.3c-11.1-41.5-47.8-69.4-88.6-71.1c-5.8-.2-9.2 6.1-7.4 11.7c2.1 6.4 3.3 13.2 3.3 20.3c0 10.2-2.4 19.8-6.6 28.3l-90.4-70.9zM373 389.9c-16.4 6.5-34.3 10.1-53 10.1c-79.5 0-144-64.5-144-144c0-6.9 .5-13.6 1.4-20.2L83.1 161.5C60.3 191.2 44 220.8 34.5 243.7c-3.3 7.9-3.3 16.7 0 24.6c14.9 35.7 46.2 87.7 93 131.1C174.5 443.2 239.2 480 320 480c47.8 0 89.9-12.9 126.2-32.5L373 389.9z"/>
              {:else}
                <path d="M288 80c-65.2 0-118.8 29.6-159.9 67.7C89.6 183.5 63 226 49.4 256c13.6 30 40.2 72.5 78.6 108.3C169.2 402.4 222.8 432 288 432s118.8-29.6 159.9-67.7C486.4 328.5 513 286 526.6 256c-13.6-30-40.2-72.5-78.6-108.3C406.8 109.6 353.2 80 288 80zM95.4 112.6C142.5 68.8 207.2 32 288 32s145.5 36.8 192.6 80.6c46.8 43.5 78.1 95.4 93 131.1c3.3 7.9 3.3 16.7 0 24.6c-14.9 35.7-46.2 87.7-93 131.1C433.5 443.2 368.8 480 288 480s-145.5-36.8-192.6-80.6C48.6 356 17.3 304 2.5 268.3c-3.3-7.9-3.3-16.7 0-24.6C17.3 208 48.6 156 95.4 112.6zM288 336c44.2 0 80-35.8 80-80s-35.8-80-80-80s-80 35.8-80 80s35.8 80 80 80z"/>
              {/if}
            </svg>
          </button>
          <button class="lock-btn" class:locked={selectedObject.locked} onclick={handleObjectLockToggle}
            title={selectedObject.locked ? 'Unlock' : 'Lock'}>
            <svg width="14" height="14" viewBox="0 0 448 512" fill="currentColor">
              {#if selectedObject.locked}
                <path d="M144 144v48H304V144c0-44.2-35.8-80-80-80s-80 35.8-80 80zM80 192V144C80 64.5 144.5 0 224 0s144 64.5 144 144v48h16c35.3 0 64 28.7 64 64V448c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V256c0-35.3 28.7-64 64-64H80z"/>
              {:else}
                <path d="M144 144c0-44.2 35.8-80 80-80c31.9 0 59.4 18.6 72.3 45.7c7.6 16 26.7 22.8 42.6 15.2s22.8-26.7 15.2-42.6C331.8 35.5 281.1 0 224 0C144.5 0 80 64.5 80 144v48H64c-35.3 0-64 28.7-64 64V448c0 35.3 28.7 64 64 64H384c35.3 0 64-28.7 64-64V256c0-35.3-28.7-64-64-64H144V144z"/>
              {/if}
            </svg>
          </button>
        {/if}
        {#if selectedImageLayer}
          <button class="lock-btn" class:locked={selectedImageLayer.locked} onclick={handleImgLockToggle}
            title={selectedImageLayer.locked ? 'Unlock' : 'Lock'}>
            <svg width="14" height="14" viewBox="0 0 448 512" fill="currentColor">
              {#if selectedImageLayer.locked}
                <path d="M144 144v48H304V144c0-44.2-35.8-80-80-80s-80 35.8-80 80zM80 192V144C80 64.5 144.5 0 224 0s144 64.5 144 144v48h16c35.3 0 64 28.7 64 64V448c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V256c0-35.3 28.7-64 64-64H80z"/>
              {:else}
                <path d="M144 144c0-44.2 35.8-80 80-80c31.9 0 59.4 18.6 72.3 45.7c7.6 16 26.7 22.8 42.6 15.2s22.8-26.7 15.2-42.6C331.8 35.5 281.1 0 224 0C144.5 0 80 64.5 80 144v48H64c-35.3 0-64 28.7-64 64V448c0 35.3 28.7 64 64 64H384c35.3 0 64-28.7 64-64V256c0-35.3-28.7-64-64-64H144V144z"/>
              {/if}
            </svg>
          </button>
        {/if}
        <span class="prop-type-badge">
          {#if selectedObject}Object{:else if selectedZone}Zone{:else}Image{/if}
        </span>
      </div>
    </div>
    <div class="panel-body properties-body">
      {#if selectedImageLayer}
        <div class="prop-group">
          <label class="prop-label">Name</label>
          <input class="prop-input" type="text" value={selectedImageLayer.name}
            onchange={handleImgNameChange} />
        </div>
        <div class="prop-row">
          <div class="prop-group half">
            <label class="prop-label">X</label>
            <input class="prop-input" type="number" value={Math.round(selectedImageLayer.x)}
              onchange={handleImgXChange} disabled={selectedImageLayer.locked} />
          </div>
          <div class="prop-group half">
            <label class="prop-label">Y</label>
            <input class="prop-input" type="number" value={Math.round(selectedImageLayer.y)}
              onchange={handleImgYChange} disabled={selectedImageLayer.locked} />
          </div>
        </div>
        <div class="prop-row">
          <div class="prop-group half">
            <label class="prop-label">Width</label>
            <input class="prop-input" type="number" value={Math.round(selectedImageLayer.width)}
              onchange={handleImgWidthChange} disabled={selectedImageLayer.locked} />
          </div>
          <div class="prop-group half">
            <label class="prop-label">Height</label>
            <input class="prop-input" type="number" value={Math.round(selectedImageLayer.height)}
              onchange={handleImgHeightChange} disabled={selectedImageLayer.locked} />
          </div>
        </div>
        <div class="prop-group">
          <label class="prop-label">Opacity</label>
          <input class="prop-input" type="number" min="0" max="100" step="5"
            value={Math.round(selectedImageLayer.opacity * 100)}
            onchange={handleImgOpacityChange} />
        </div>
        <div class="prop-group">
          <label class="prop-label">Rotation °</label>
          <input class="prop-input" type="number" min="-360" max="360" step="5"
            value={selectedImageLayer.rotation ?? 0}
            onchange={handleImgRotationChange} disabled={selectedImageLayer.locked} />
        </div>
        <div class="prop-group">
          <label class="prop-checkbox">
            <input type="checkbox" checked={selectedImageLayer.isoTransform ?? false}
              onchange={handleImgIsoTransformChange} disabled={selectedImageLayer.locked} />
            Isometric transform
          </label>
        </div>
        <div class="prop-group">
          <button class="fit-btn" onclick={handleFitToGrid} disabled={selectedImageLayer.locked}
            title="Position and resize image to cover the isometric grid">
            Fit to Grid
          </button>
        </div>
      {/if}

      {#if selectedObject}
        <div class="prop-group">
          <label class="prop-label">Name</label>
          <input
            class="prop-input"
            type="text"
            value={selectedObject.name}
            onchange={handleObjectNameChange}
          />
        </div>
        <div class="prop-row">
          <div class="prop-group half">
            <label class="prop-label">X</label>
            <input class="prop-input" type="number" value={Math.round(selectedObject.x)}
              onchange={handleObjectXChange} disabled={selectedObject.locked} />
          </div>
          <div class="prop-group half">
            <label class="prop-label">Y</label>
            <input class="prop-input" type="number" value={Math.round(selectedObject.y)}
              onchange={handleObjectYChange} disabled={selectedObject.locked} />
          </div>
        </div>
        <div class="prop-row">
          <div class="prop-group half">
            <label class="prop-label">Width</label>
            <input class="prop-input" type="number" value={selectedObject.width}
              onchange={handleObjectWidthChange} disabled={selectedObject.locked} />
          </div>
          <div class="prop-group half">
            <label class="prop-label">Height</label>
            <input class="prop-input" type="number" value={selectedObject.height}
              onchange={handleObjectHeightChange} disabled={selectedObject.locked} />
          </div>
        </div>
        <div class="prop-group">
          <label class="prop-label">Scale %</label>
          <input class="prop-input" type="number" min="1" max="1000" step="10"
            value={selectedObject.imageBitmap ? Math.round(selectedObject.width / selectedObject.imageBitmap.width * 100) : 100}
            onchange={handleObjectScaleChange} disabled={selectedObject.locked} />
        </div>
        <div class="prop-group">
          <label class="prop-label">Rotation °</label>
          <input class="prop-input" type="number" min="-360" max="360" step="5"
            value={selectedObject.rotation ?? 0}
            onchange={handleObjectRotationChange} disabled={selectedObject.locked} />
        </div>
        <div class="prop-group">
          <label class="prop-label">Mirror</label>
          <div class="flip-row">
            <button class="flip-btn" class:active={selectedObject.flipX} onclick={handleObjectFlipX}
              title="Flip Horizontal" disabled={selectedObject.locked}>↔ H</button>
            <button class="flip-btn" class:active={selectedObject.flipY} onclick={handleObjectFlipY}
              title="Flip Vertical" disabled={selectedObject.locked}>↕ V</button>
          </div>
        </div>
      {/if}

      {#if selectedZone}
        <div class="prop-group">
          <label class="prop-label">Name</label>
          <input class="prop-input" type="text" value={selectedZone.name}
            onchange={handleZoneNameChange} />
        </div>
        <div class="prop-group">
          <label class="prop-label">Color</label>
          <div class="color-input-row">
            <input type="color" value={selectedZone.color}
              onchange={handleZoneColorChange} class="color-picker" />
            <span class="color-value">{selectedZone.color}</span>
          </div>
        </div>
        <div class="prop-group">
          <label class="prop-checkbox">
            <input type="checkbox" checked={selectedZone.closed}
              onchange={handleZoneClosedChange} />
            Closed polygon
          </label>
        </div>
        <div class="prop-group">
          <label class="prop-label">Vertices</label>
          <span class="prop-value">{selectedZone.points.length}</span>
        </div>
      {/if}
    </div>
  </div>
{/if}

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

  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .jump-btn {
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
  }

  .jump-btn:hover {
    background: var(--bg-hover);
    color: var(--accent);
  }

  .lock-btn {
    width: 22px;
    height: 22px;
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

  .lock-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .lock-btn.locked {
    color: #fab387;
  }

  .visibility-toggle-btn {
    width: 22px;
    height: 22px;
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

  .visibility-toggle-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .visibility-toggle-btn.hidden-obj {
    color: #f38ba8;
  }

  .prop-type-badge {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-muted);
    background: var(--bg-primary);
    padding: 1px 6px;
    border-radius: var(--radius-sm);
  }

  .panel-body {
    padding: 4px;
    max-height: 400px;
    overflow-y: auto;
  }

  .properties-body {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .prop-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .prop-group.half {
    flex: 1;
  }

  .prop-row {
    display: flex;
    gap: 8px;
  }

  .prop-label {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    font-weight: 500;
  }

  .prop-input {
    width: 100%;
    padding: 4px 6px;
    font-size: var(--font-size-sm);
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    outline: none;
    box-sizing: border-box;
  }

  .prop-input:focus {
    border-color: var(--accent);
  }

  .prop-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .prop-input[type="number"] {
    -moz-appearance: textfield;
  }

  .color-input-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .color-picker {
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    cursor: pointer;
    background: transparent;
  }

  .color-value {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    font-family: monospace;
  }

  .prop-checkbox {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    cursor: pointer;
  }

  .prop-value {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
  }

  .flip-row {
    display: flex;
    gap: 6px;
  }

  .flip-btn {
    flex: 1;
    padding: 4px 8px;
    font-size: var(--font-size-sm);
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .flip-btn:hover {
    background: var(--bg-hover);
    border-color: var(--text-muted);
  }

  .flip-btn.active {
    background: var(--accent);
    color: var(--bg-primary);
    border-color: var(--accent);
  }

  .flip-btn:disabled, .fit-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .fit-btn {
    width: 100%;
    padding: 5px 8px;
    font-size: var(--font-size-sm);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    cursor: pointer;
    font-weight: 500;
  }

  .fit-btn:hover {
    background: var(--accent);
    color: var(--bg-primary);
    border-color: var(--accent);
  }

  .multi-header {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--accent);
    text-align: center;
    padding: 2px 0 4px;
  }
</style>
