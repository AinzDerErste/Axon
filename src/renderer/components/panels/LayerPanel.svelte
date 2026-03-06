<script lang="ts">
  import { onMount } from 'svelte'
  import {
    getMap, getActiveLayer, setActiveLayer,
    addLayer, addObjectLayer, addImageLayer, addDrawingLayer, removeLayer, toggleLayerVisibility,
    moveLayerUp, moveLayerDown, setLayerSortMode, updateObject,
    addGroupToLayer, removeGroupFromLayer, renameGroup, renameLayer, setObjectGroup, toggleGroupExpanded,
    subscribe as mapSubscribe
  } from '../../lib/stores/map-store'
  import {
    getSelection, selectObject, selectZone, selectImageLayer, clearSelection,
    toggleObjectSelection, isObjectSelected, getSelectedObjectIds,
    subscribe as selSubscribe,
    type SelectionTarget
  } from '../../lib/stores/selection-store'
  import { executeCommand } from '../../lib/stores/history-store'
  import { DeleteObjectCommand, ReorderObjectCommand } from '../../lib/commands/object-command'
  import { DeleteZoneCommand, ReorderZoneCommand } from '../../lib/commands/zone-command'
  import type { Layer, ObjectLayer, DrawingLayer, ObjectGroup } from '../../lib/models/layer'

  let layers = $state<Layer[]>([])
  let activeLayerId = $state('')
  let showAddMenu = $state(false)
  let expandedLayers = $state(new Set<string>())
  let selectionTarget = $state<SelectionTarget>(null)
  let searchQuery = $state('')
  let searchInputRef = $state<HTMLInputElement | null>(null)

  onMount(() => {
    const unsub = mapSubscribe(() => {
      const map = getMap()
      if (map) {
        layers = [...map.layers].reverse()
        activeLayerId = map.activeLayerId
      } else {
        layers = []
        activeLayerId = ''
      }
    })

    const unsubSel = selSubscribe(() => {
      selectionTarget = getSelection()
      // Auto-expand layer when something inside it is selected from canvas
      if (selectionTarget) {
        const next = new Set(expandedLayers)
        next.add(selectionTarget.layerId)
        expandedLayers = next
      }
    })

    const map = getMap()
    if (map) {
      layers = [...map.layers].reverse()
      activeLayerId = map.activeLayerId
    }

    function handleClickOutside() {
      if (showAddMenu) showAddMenu = false
    }
    window.addEventListener('click', handleClickOutside)
    return () => { unsub(); unsubSel(); window.removeEventListener('click', handleClickOutside) }
  })

  function handleAddTileLayer() {
    const name = `Tile ${(getMap()?.layers.length ?? 0) + 1}`
    addLayer(name)
    showAddMenu = false
  }

  function handleAddObjectLayer() {
    const name = `Objects ${(getMap()?.layers.length ?? 0) + 1}`
    addObjectLayer(name)
    showAddMenu = false
  }

  function handleAddDrawingLayer() {
    const name = `Drawing ${(getMap()?.layers.length ?? 0) + 1}`
    addDrawingLayer(name)
    showAddMenu = false
  }

  async function handleAddImageLayer() {
    showAddMenu = false
    const result = await window.electronAPI?.readImageFiles()
    if (!result || result.length === 0) return
    const file = result[0]
    const img = new Image()
    img.src = file.data
    await new Promise<void>(resolve => {
      img.onload = async () => {
        const bmp = await createImageBitmap(img)
        const name = file.name.replace(/\.[^.]+$/, '')
        addImageLayer(name, file.data, bmp, img.naturalWidth, img.naturalHeight)
        resolve()
      }
    })
  }

  function handleRemoveLayer(id: string) {
    removeLayer(id)
  }

  function toggleAddMenu(e: MouseEvent) {
    e.stopPropagation()
    showAddMenu = !showAddMenu
  }

  function toggleExpand(layerId: string, e: MouseEvent) {
    e.stopPropagation()
    const next = new Set(expandedLayers)
    if (next.has(layerId)) next.delete(layerId)
    else next.add(layerId)
    expandedLayers = next
  }

  function handleLayerClick(layerId: string) {
    setActiveLayer(layerId)
    // Auto-select image layers so PropertiesPanel shows
    const map = getMap()
    const layer = map?.layers.find(l => l.id === layerId)
    if (layer?.type === 'image') {
      selectImageLayer(layerId)
    } else if (selectionTarget && selectionTarget.layerId !== layerId) {
      clearSelection()
    }
  }

  function handleSelectObject(layerId: string, objectId: string, e: MouseEvent) {
    e.stopPropagation()
    setActiveLayer(layerId)
    if (e.ctrlKey || e.metaKey) {
      toggleObjectSelection(layerId, objectId)
    } else {
      selectObject(layerId, objectId)
    }
  }

  function handleSelectZone(layerId: string, zoneId: string, e: MouseEvent) {
    e.stopPropagation()
    setActiveLayer(layerId)
    selectZone(layerId, zoneId)
  }

  function handleDeleteObject(layerId: string, objectId: string, e: MouseEvent) {
    e.stopPropagation()
    const map = getMap()
    if (!map) return
    const layer = map.layers.find(l => l.id === layerId)
    if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return
    const obj = layer.objects.find(o => o.id === objectId)
    if (obj && !obj.locked) {
      const cmd = new DeleteObjectCommand(layerId, obj)
      executeCommand(cmd)
      if (selectionTarget?.type === 'object' && selectionTarget.objectId === objectId) {
        clearSelection()
      }
    }
  }

  function handleToggleObjectVisibility(layerId: string, objectId: string, e: MouseEvent) {
    e.stopPropagation()
    const map = getMap()
    if (!map) return
    const layer = map.layers.find(l => l.id === layerId)
    if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return
    const obj = layer.objects.find(o => o.id === objectId)
    if (obj) {
      updateObject(layerId, objectId, { visible: obj.visible === false ? true : false })
    }
  }

  function handleDeleteZone(layerId: string, zoneId: string, e: MouseEvent) {
    e.stopPropagation()
    const map = getMap()
    if (!map) return
    const layer = map.layers.find(l => l.id === layerId)
    if (!layer || layer.type !== 'object') return
    const zone = layer.zones.find(z => z.id === zoneId)
    if (zone) {
      const cmd = new DeleteZoneCommand(layerId, zone)
      executeCommand(cmd)
      if (selectionTarget?.type === 'zone' && selectionTarget.zoneId === zoneId) {
        clearSelection()
      }
    }
  }

  /** Check if a layer (or its children) matches the search query */
  function layerMatchesSearch(layer: Layer, q: string): boolean {
    if (layer.name.toLowerCase().includes(q)) return true
    if (layer.type === 'object') {
      const objLayer = layer as ObjectLayer
      if (objLayer.objects.some(o => o.name.toLowerCase().includes(q))) return true
      if (objLayer.zones.some(z => z.name.toLowerCase().includes(q))) return true
    }
    if (layer.type === 'drawing') {
      if (layer.objects.some(o => o.name.toLowerCase().includes(q))) return true
    }
    return false
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

  function handleReorderObject(layerId: string, objectId: string, dir: 'up' | 'down', e: MouseEvent) {
    e.stopPropagation()
    const cmd = new ReorderObjectCommand(layerId, objectId, dir)
    executeCommand(cmd)
  }

  function handleReorderZone(layerId: string, zoneId: string, dir: 'up' | 'down', e: MouseEvent) {
    e.stopPropagation()
    const cmd = new ReorderZoneCommand(layerId, zoneId, dir)
    executeCommand(cmd)
  }

  function handleToggleSortMode(layerId: string, e: MouseEvent) {
    e.stopPropagation()
    const map = getMap()
    const layer = map?.layers.find(l => l.id === layerId)
    if (!layer || layer.type !== 'object') return
    const current = (layer as ObjectLayer).sortMode || 'auto'
    setLayerSortMode(layerId, current === 'auto' ? 'manual' : 'auto')
  }

  function handleAddGroup(layerId: string, e: MouseEvent) {
    e.stopPropagation()
    const map = getMap()
    const layer = map?.layers.find(l => l.id === layerId)
    if (!layer || layer.type !== 'object') return
    const count = ((layer as ObjectLayer).groups || []).length
    addGroupToLayer(layerId, `Group ${count + 1}`)
  }

  function handleDeleteGroup(layerId: string, groupId: string, e: MouseEvent) {
    e.stopPropagation()
    removeGroupFromLayer(layerId, groupId)
  }

  function handleToggleGroupExpand(layerId: string, groupId: string, e: MouseEvent) {
    e.stopPropagation()
    toggleGroupExpanded(layerId, groupId)
  }

  function handleMoveToGroup(layerId: string, objectId: string, groupId: string | undefined, e: MouseEvent) {
    e.stopPropagation()
    setObjectGroup(layerId, objectId, groupId)
  }

  // Group rename state
  let editingGroupId = $state<string | null>(null)
  let editingGroupName = $state('')

  function handleStartRenameGroup(layerId: string, group: ObjectGroup, e: MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    editingGroupId = group.id
    editingGroupName = group.name
  }

  function handleFinishRenameGroup(layerId: string) {
    if (editingGroupId && editingGroupName.trim()) {
      renameGroup(layerId, editingGroupId, editingGroupName.trim())
    }
    editingGroupId = null
    editingGroupName = ''
  }

  function handleRenameGroupKeydown(layerId: string, e: KeyboardEvent) {
    if (e.key === 'Enter') {
      handleFinishRenameGroup(layerId)
    } else if (e.key === 'Escape') {
      editingGroupId = null
      editingGroupName = ''
    }
  }

  // Layer rename state
  let editingLayerId = $state<string | null>(null)
  let editingLayerName = $state('')

  function handleStartRenameLayer(layer: Layer, e: MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    editingLayerId = layer.id
    editingLayerName = layer.name
  }

  function handleFinishRenameLayer() {
    if (editingLayerId && editingLayerName.trim()) {
      renameLayer(editingLayerId, editingLayerName.trim())
    }
    editingLayerId = null
    editingLayerName = ''
  }

  function handleRenameLayerKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      handleFinishRenameLayer()
    } else if (e.key === 'Escape') {
      editingLayerId = null
      editingLayerName = ''
    }
  }

  // Drag & drop state for moving objects into/out of groups
  let dragObjId = $state<string | null>(null)
  let dragObjLayerId = $state<string | null>(null)
  let dropTargetGroupId = $state<string | null>(null)  // group id or '__ungrouped__'

  function handleDragStart(layerId: string, objectId: string, e: DragEvent) {
    dragObjId = objectId
    dragObjLayerId = layerId
    e.dataTransfer!.effectAllowed = 'move'
    e.dataTransfer!.setData('text/plain', objectId)
  }

  function handleDragEnd() {
    dragObjId = null
    dragObjLayerId = null
    dropTargetGroupId = null
  }

  function handleDragOverGroup(groupId: string, e: DragEvent) {
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'
    dropTargetGroupId = groupId
  }

  function handleDragLeaveGroup() {
    dropTargetGroupId = null
  }

  function handleDropOnGroup(layerId: string, groupId: string | undefined, e: DragEvent) {
    e.preventDefault()
    dropTargetGroupId = null
    if (dragObjId && dragObjLayerId === layerId) {
      setObjectGroup(layerId, dragObjId, groupId)
    }
    dragObjId = null
    dragObjLayerId = null
  }

  /** Create a new group and assign all selected objects to it */
  function handleCreateGroupWithSelection(layerId: string, e: MouseEvent) {
    e.stopPropagation()
    const selectedIds = getSelectedObjectIds()
    const map = getMap()
    const layer = map?.layers.find(l => l.id === layerId)
    if (!layer || layer.type !== 'object') return
    const count = ((layer as ObjectLayer).groups || []).length
    const group = addGroupToLayer(layerId, `Group ${count + 1}`)
    if (group) {
      for (const objId of selectedIds) {
        setObjectGroup(layerId, objId, group.id)
      }
    }
  }

  /** Move all selected objects to a group (or ungroup) */
  function handleMoveSelectionToGroup(layerId: string, groupId: string | undefined, e: MouseEvent) {
    e.stopPropagation()
    const selectedIds = getSelectedObjectIds()
    for (const objId of selectedIds) {
      setObjectGroup(layerId, objId, groupId)
    }
  }

  /** Show context menu with group assignment options for an object */
  let contextMenuObj = $state<{ layerId: string; objectId: string; x: number; y: number } | null>(null)

  function handleObjectContextMenu(layerId: string, objectId: string, e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    contextMenuObj = { layerId, objectId, x: e.clientX, y: e.clientY }
  }

  function closeContextMenu() {
    contextMenuObj = null
  }

  $effect(() => {
    if (contextMenuObj) {
      const handler = () => closeContextMenu()
      window.addEventListener('click', handler)
      return () => window.removeEventListener('click', handler)
    }
  })
</script>

<div class="panel">
  <div class="panel-header">
    <span class="panel-title">Layers</span>
    <div class="panel-actions">
      <button class="icon-btn" title="Move Up" onclick={() => moveLayerUp(activeLayerId)}>↑</button>
      <button class="icon-btn" title="Move Down" onclick={() => moveLayerDown(activeLayerId)}>↓</button>
      <button class="icon-btn" title="Remove Layer" onclick={() => handleRemoveLayer(activeLayerId)}>−</button>
      <div class="add-menu-wrapper">
        <button class="icon-btn" title="Add Layer" onclick={toggleAddMenu}>+</button>
        {#if showAddMenu}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_interactive_supports_focus -->
          <div class="add-menu" role="menu" onclick={(e: MouseEvent) => e.stopPropagation()}>
            <button class="add-menu-item" role="menuitem" onclick={handleAddTileLayer}>
              <span class="layer-type-icon tile">T</span> Tile Layer
            </button>
            <button class="add-menu-item" role="menuitem" onclick={handleAddObjectLayer}>
              <span class="layer-type-icon object">O</span> Object Layer
            </button>
            <button class="add-menu-item" role="menuitem" onclick={handleAddImageLayer}>
              <span class="layer-type-icon image">I</span> Image Layer
            </button>
            <button class="add-menu-item" role="menuitem" onclick={handleAddDrawingLayer}>
              <span class="layer-type-icon drawing">D</span> Drawing Layer
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>
  <div class="panel-body">
    {#if layers.length > 0}
      <div class="search-input-wrapper">
        <input
          class="search-input"
          type="text"
          placeholder="Filter layers..."
          bind:value={searchQuery}
          bind:this={searchInputRef}
          onkeydown={handleSearchKeydown}
        />
        {#if searchQuery}
          <button class="search-clear" onclick={clearSearch} title="Clear">×</button>
        {/if}
      </div>
    {/if}
    {#if layers.length === 0}
      <div class="empty-message">No map loaded</div>
    {:else}
      {@const q = searchQuery.toLowerCase().trim()}
      {#each layers as layer (layer.id)}
        {#if !q || layerMatchesSearch(layer, q)}
        <div
          class="layer-item"
          class:active={layer.id === activeLayerId}
          onclick={() => handleLayerClick(layer.id)}
          onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') handleLayerClick(layer.id) }}
          role="button"
          tabindex="0"
        >
          {#if layer.type === 'object' || layer.type === 'drawing'}
            <button
              class="expand-btn"
              onclick={(e: MouseEvent) => toggleExpand(layer.id, e)}
              title={expandedLayers.has(layer.id) ? 'Collapse' : 'Expand'}
            >
              {expandedLayers.has(layer.id) ? '▼' : '▶'}
            </button>
          {:else}
            <span class="expand-spacer"></span>
          {/if}
          <button
            class="visibility-btn"
            class:visible={layer.visible}
            title="Toggle visibility"
            onclick={(e: MouseEvent) => { e.stopPropagation(); toggleLayerVisibility(layer.id) }}
          >
            {layer.visible ? '●' : '○'}
          </button>
          <span class="layer-type-badge" class:object-badge={layer.type === 'object'} class:image-badge={layer.type === 'image'} class:drawing-badge={layer.type === 'drawing'}>
            {layer.type === 'object' ? 'O' : layer.type === 'image' ? 'I' : layer.type === 'drawing' ? 'D' : 'T'}
          </span>
          {#if editingLayerId === layer.id}
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="layer-rename-input"
              type="text"
              bind:value={editingLayerName}
              onblur={handleFinishRenameLayer}
              onkeydown={handleRenameLayerKeydown}
              onclick={(e: MouseEvent) => e.stopPropagation()}
              autofocus
            />
          {:else}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
              class="layer-name"
              ondblclick={(e: MouseEvent) => handleStartRenameLayer(layer, e)}
              title="Double-click to rename"
            >{layer.name}</span>
          {/if}
          {#if layer.type === 'object'}
            <button
              class="sort-mode-btn"
              title={((layer as ObjectLayer).sortMode || 'auto') === 'auto' ? 'Sort: Auto (depth) — click for Manual' : 'Sort: Manual (array order) — click for Auto'}
              onclick={(e: MouseEvent) => handleToggleSortMode(layer.id, e)}
            >
              {((layer as ObjectLayer).sortMode || 'auto') === 'manual' ? 'M' : 'A'}
            </button>
            <button
              class="add-group-icon-btn"
              title="New Group"
              onclick={(e: MouseEvent) => handleAddGroup(layer.id, e)}
            >
              <svg width="12" height="12" viewBox="0 0 512 512" fill="currentColor">
                <path d="M64 480H448c35.3 0 64-28.7 64-64V160c0-35.3-28.7-64-64-64H288c-10.1 0-19.6-4.7-25.6-12.8L243.2 57.6C231.1 41.5 212.1 32 192 32H64C28.7 32 0 60.7 0 96V416c0 35.3 28.7 64 64 64z"/>
              </svg>
              <span class="add-group-plus">+</span>
            </button>
          {/if}
          {#if layer.type === 'image' && layer.locked}
            <svg class="lock-icon" width="10" height="10" viewBox="0 0 448 512" fill="currentColor">
              <path d="M144 144v48H304V144c0-44.2-35.8-80-80-80s-80 35.8-80 80zM80 192V144C80 64.5 144.5 0 224 0s144 64.5 144 144v48h16c35.3 0 64 28.7 64 64V448c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V256c0-35.3 28.7-64 64-64H80z"/>
            </svg>
          {/if}
          <span class="layer-opacity">{Math.round(layer.opacity * 100)}%</span>
        </div>

        <!-- Sub-items for expanded object layers (or auto-expanded by search) -->
        {#if layer.type === 'object' && (expandedLayers.has(layer.id) || (q && !layer.name.toLowerCase().includes(q)))}
          {@const objLayer = layer as ObjectLayer}
          {@const groups = objLayer.groups || []}
          {@const filteredObjects = q ? objLayer.objects.filter(o => o.name.toLowerCase().includes(q)) : objLayer.objects}
          {@const filteredZones = q ? objLayer.zones.filter(z => z.name.toLowerCase().includes(q)) : objLayer.zones}
          {@const ungroupedObjects = filteredObjects.filter(o => !o.groupId || !groups.some(g => g.id === o.groupId))}

          {#if filteredObjects.length === 0 && filteredZones.length === 0 && groups.length === 0 && !q}
            <div class="sub-item-empty">No items</div>
          {/if}

          <!-- Groups -->
          {#each groups as group (group.id)}
            {@const groupObjects = filteredObjects.filter(o => o.groupId === group.id)}
            {#if !q || groupObjects.length > 0}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div
                class="sub-item group-header"
                class:drop-target={dropTargetGroupId === group.id}
                onclick={(e: MouseEvent) => handleToggleGroupExpand(layer.id, group.id, e)}
                ondragover={(e: DragEvent) => handleDragOverGroup(group.id, e)}
                ondragleave={handleDragLeaveGroup}
                ondrop={(e: DragEvent) => handleDropOnGroup(layer.id, group.id, e)}
                role="button"
                tabindex="0"
              >
                <button class="expand-btn" onclick={(e: MouseEvent) => handleToggleGroupExpand(layer.id, group.id, e)}>
                  {group.expanded ? '▼' : '▶'}
                </button>
                <svg class="group-folder-icon" width="12" height="12" viewBox="0 0 512 512" fill="currentColor">
                  <path d="M64 480H448c35.3 0 64-28.7 64-64V160c0-35.3-28.7-64-64-64H288c-10.1 0-19.6-4.7-25.6-12.8L243.2 57.6C231.1 41.5 212.1 32 192 32H64C28.7 32 0 60.7 0 96V416c0 35.3 28.7 64 64 64z"/>
                </svg>
                {#if editingGroupId === group.id}
                  <!-- svelte-ignore a11y_autofocus -->
                  <input
                    class="group-rename-input"
                    type="text"
                    bind:value={editingGroupName}
                    onblur={() => handleFinishRenameGroup(layer.id)}
                    onkeydown={(e: KeyboardEvent) => handleRenameGroupKeydown(layer.id, e)}
                    onclick={(e: MouseEvent) => e.stopPropagation()}
                    autofocus
                  />
                {:else}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <span
                    class="sub-item-name"
                    ondblclick={(e: MouseEvent) => handleStartRenameGroup(layer.id, group, e)}
                    title="Double-click to rename"
                  >{group.name}</span>
                {/if}
                <span class="group-count">{groupObjects.length}</span>
                <button
                  class="sub-item-delete"
                  title="Delete group (objects will be ungrouped)"
                  onclick={(e: MouseEvent) => handleDeleteGroup(layer.id, group.id, e)}
                >×</button>
              </div>

              {#if group.expanded}
                {#each groupObjects as obj (obj.id)}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <div
                    class="sub-item grouped-item"
                    class:selected={isObjectSelected(obj.id)}
                    class:search-match={!!q}
                    class:dragging={dragObjId === obj.id}
                    draggable="true"
                    ondragstart={(e: DragEvent) => handleDragStart(layer.id, obj.id, e)}
                    ondragend={handleDragEnd}
                    onclick={(e: MouseEvent) => handleSelectObject(layer.id, obj.id, e)}
                    oncontextmenu={(e: MouseEvent) => handleObjectContextMenu(layer.id, obj.id, e)}
                    role="button"
                    tabindex="0"
                  >
                    <div class="sub-item-icon object-thumb-mini">
                      <img src={obj.imageDataUrl} alt={obj.name} />
                    </div>
                    <span class="sub-item-name" class:hidden-name={obj.visible === false}>{obj.name}</span>
                    {#if obj.locked}
                      <svg class="lock-icon" width="10" height="10" viewBox="0 0 448 512" fill="currentColor">
                        <path d="M144 144v48H304V144c0-44.2-35.8-80-80-80s-80 35.8-80 80zM80 192V144C80 64.5 144.5 0 224 0s144 64.5 144 144v48h16c35.3 0 64 28.7 64 64V448c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V256c0-35.3 28.7-64 64-64H80z"/>
                      </svg>
                    {/if}
                    <button class="sub-item-visibility" class:obj-hidden={obj.visible === false} title={obj.visible === false ? 'Show' : 'Hide'} onclick={(e: MouseEvent) => handleToggleObjectVisibility(layer.id, obj.id, e)}>
                      <svg width="12" height="12" viewBox="0 0 640 512" fill="currentColor">
                        {#if obj.visible === false}
                          <path d="M38.8 5.1C28.4-3.1 13.3-1.2 5.1 9.2S-1.2 34.7 9.2 42.9l592 464c10.4 8.2 25.5 6.3 33.7-4.1s6.3-25.5-4.1-33.7L525.6 386.7c39.6-40.6 66.4-86.1 79.9-118.4c3.3-7.9 3.3-16.7 0-24.6c-14.9-35.7-46.2-87.7-93-131.1C465.5 68.8 400.8 32 320 32c-68.2 0-125 26.3-169.3 60.8L38.8 5.1z"/>
                        {:else}
                          <path d="M288 80c-65.2 0-118.8 29.6-159.9 67.7C89.6 183.5 63 226 49.4 256c13.6 30 40.2 72.5 78.6 108.3C169.2 402.4 222.8 432 288 432s118.8-29.6 159.9-67.7C486.4 328.5 513 286 526.6 256c-13.6-30-40.2-72.5-78.6-108.3C406.8 109.6 353.2 80 288 80zM95.4 112.6C142.5 68.8 207.2 32 288 32s145.5 36.8 192.6 80.6c46.8 43.5 78.1 95.4 93 131.1c3.3 7.9 3.3 16.7 0 24.6c-14.9 35.7-46.2 87.7-93 131.1C433.5 443.2 368.8 480 288 480s-145.5-36.8-192.6-80.6C48.6 356 17.3 304 2.5 268.3c-3.3-7.9-3.3-16.7 0-24.6C17.3 208 48.6 156 95.4 112.6zM288 336c44.2 0 80-35.8 80-80s-35.8-80-80-80s-80 35.8-80 80s35.8 80 80 80z"/>
                        {/if}
                      </svg>
                    </button>
                    <button class="sub-item-order" title="Move forward (up)" onclick={(e: MouseEvent) => handleReorderObject(layer.id, obj.id, 'up', e)}>↑</button>
                    <button class="sub-item-order" title="Move backward (down)" onclick={(e: MouseEvent) => handleReorderObject(layer.id, obj.id, 'down', e)}>↓</button>
                    <button class="sub-item-delete" title="Delete object" onclick={(e: MouseEvent) => handleDeleteObject(layer.id, obj.id, e)}>×</button>
                  </div>
                {/each}
              {/if}
            {/if}
          {/each}

          <!-- Ungrouped objects (also a drop target to remove from group) -->
          {#if dragObjId && groups.length > 0}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="ungrouped-drop-zone"
              class:drop-target={dropTargetGroupId === '__ungrouped__'}
              ondragover={(e: DragEvent) => handleDragOverGroup('__ungrouped__', e)}
              ondragleave={handleDragLeaveGroup}
              ondrop={(e: DragEvent) => handleDropOnGroup(layer.id, undefined, e)}
            >
              Drop here to ungroup
            </div>
          {/if}
          {#each ungroupedObjects as obj (obj.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="sub-item"
              class:selected={isObjectSelected(obj.id)}
              class:search-match={!!q}
              class:dragging={dragObjId === obj.id}
              draggable="true"
              ondragstart={(e: DragEvent) => handleDragStart(layer.id, obj.id, e)}
              ondragend={handleDragEnd}
              onclick={(e: MouseEvent) => handleSelectObject(layer.id, obj.id, e)}
              oncontextmenu={(e: MouseEvent) => handleObjectContextMenu(layer.id, obj.id, e)}
              role="button"
              tabindex="0"
            >
              <div class="sub-item-icon object-thumb-mini">
                <img src={obj.imageDataUrl} alt={obj.name} />
              </div>
              <span class="sub-item-name" class:hidden-name={obj.visible === false}>{obj.name}</span>
              {#if obj.locked}
                <svg class="lock-icon" width="10" height="10" viewBox="0 0 448 512" fill="currentColor">
                  <path d="M144 144v48H304V144c0-44.2-35.8-80-80-80s-80 35.8-80 80zM80 192V144C80 64.5 144.5 0 224 0s144 64.5 144 144v48h16c35.3 0 64 28.7 64 64V448c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V256c0-35.3 28.7-64 64-64H80z"/>
                </svg>
              {/if}
              <button class="sub-item-visibility" class:obj-hidden={obj.visible === false} title={obj.visible === false ? 'Show' : 'Hide'} onclick={(e: MouseEvent) => handleToggleObjectVisibility(layer.id, obj.id, e)}>
                <svg width="12" height="12" viewBox="0 0 640 512" fill="currentColor">
                  {#if obj.visible === false}
                    <path d="M38.8 5.1C28.4-3.1 13.3-1.2 5.1 9.2S-1.2 34.7 9.2 42.9l592 464c10.4 8.2 25.5 6.3 33.7-4.1s6.3-25.5-4.1-33.7L525.6 386.7c39.6-40.6 66.4-86.1 79.9-118.4c3.3-7.9 3.3-16.7 0-24.6c-14.9-35.7-46.2-87.7-93-131.1C465.5 68.8 400.8 32 320 32c-68.2 0-125 26.3-169.3 60.8L38.8 5.1z"/>
                  {:else}
                    <path d="M288 80c-65.2 0-118.8 29.6-159.9 67.7C89.6 183.5 63 226 49.4 256c13.6 30 40.2 72.5 78.6 108.3C169.2 402.4 222.8 432 288 432s118.8-29.6 159.9-67.7C486.4 328.5 513 286 526.6 256c-13.6-30-40.2-72.5-78.6-108.3C406.8 109.6 353.2 80 288 80zM95.4 112.6C142.5 68.8 207.2 32 288 32s145.5 36.8 192.6 80.6c46.8 43.5 78.1 95.4 93 131.1c3.3 7.9 3.3 16.7 0 24.6c-14.9 35.7-46.2 87.7-93 131.1C433.5 443.2 368.8 480 288 480s-145.5-36.8-192.6-80.6C48.6 356 17.3 304 2.5 268.3c-3.3-7.9-3.3-16.7 0-24.6C17.3 208 48.6 156 95.4 112.6zM288 336c44.2 0 80-35.8 80-80s-35.8-80-80-80s-80 35.8-80 80s35.8 80 80 80z"/>
                  {/if}
                </svg>
              </button>
              <button class="sub-item-order" title="Move forward (up)" onclick={(e: MouseEvent) => handleReorderObject(layer.id, obj.id, 'up', e)}>↑</button>
              <button class="sub-item-order" title="Move backward (down)" onclick={(e: MouseEvent) => handleReorderObject(layer.id, obj.id, 'down', e)}>↓</button>
              <button class="sub-item-delete" title="Delete object" onclick={(e: MouseEvent) => handleDeleteObject(layer.id, obj.id, e)}>×</button>
            </div>
          {/each}

          <!-- Zones -->
          {#each filteredZones as zone (zone.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="sub-item"
              class:selected={selectionTarget?.type === 'zone' && selectionTarget.zoneId === zone.id}
              class:search-match={!!q}
              onclick={(e: MouseEvent) => handleSelectZone(layer.id, zone.id, e)}
              role="button"
              tabindex="0"
            >
              {#if zone.zoneType === 'collision'}
                <svg class="zone-icon collision-icon" width="12" height="12" viewBox="0 0 512 512" fill={zone.color}>
                  <path d="M256 0c4.6 0 9.2 1 13.4 2.9L457.7 82.8c22 9.3 38.4 31 38.3 57.2c-.5 99.2-41.3 280.7-213.6 363.2c-16.7 8-36.1 8-52.8 0C57.3 420.7 16.5 239.2 16 140c-.1-26.2 16.3-47.9 38.3-57.2L242.7 2.9C246.8 1 251.4 0 256 0zm0 66.8V444.8C394 378 431.1 230.1 432 141.4L256 66.8z"/>
                </svg>
              {:else}
                <span class="zone-color-dot" style="background: {zone.color}"></span>
              {/if}
              <span class="sub-item-name">{zone.name}</span>
              <button class="sub-item-order" title="Move forward (up)" onclick={(e: MouseEvent) => handleReorderZone(layer.id, zone.id, 'up', e)}>↑</button>
              <button class="sub-item-order" title="Move backward (down)" onclick={(e: MouseEvent) => handleReorderZone(layer.id, zone.id, 'down', e)}>↓</button>
              <button class="sub-item-delete" title="Delete zone" onclick={(e: MouseEvent) => handleDeleteZone(layer.id, zone.id, e)}>×</button>
            </div>
          {/each}
        {/if}

        <!-- Sub-items for expanded drawing layers -->
        {#if layer.type === 'drawing' && (expandedLayers.has(layer.id) || (q && !layer.name.toLowerCase().includes(q)))}
          {@const drawLayer = layer as DrawingLayer}
          {@const filteredDrawObjs = q ? drawLayer.objects.filter(o => o.name.toLowerCase().includes(q)) : drawLayer.objects}

          {#if filteredDrawObjs.length === 0 && !q}
            <div class="sub-item-empty">No sketches</div>
          {/if}

          {#each filteredDrawObjs as obj (obj.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="sub-item"
              class:selected={isObjectSelected(obj.id)}
              class:search-match={!!q}
              onclick={(e: MouseEvent) => handleSelectObject(layer.id, obj.id, e)}
              role="button"
              tabindex="0"
            >
              <div class="sub-item-icon object-thumb-mini">
                <img src={obj.imageDataUrl} alt={obj.name} />
              </div>
              <span class="sub-item-name" class:hidden-name={obj.visible === false}>{obj.name}</span>
              {#if obj.locked}
                <svg class="lock-icon" width="10" height="10" viewBox="0 0 448 512" fill="currentColor">
                  <path d="M144 144v48H304V144c0-44.2-35.8-80-80-80s-80 35.8-80 80zM80 192V144C80 64.5 144.5 0 224 0s144 64.5 144 144v48h16c35.3 0 64 28.7 64 64V448c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V256c0-35.3 28.7-64 64-64H80z"/>
                </svg>
              {/if}
              <button class="sub-item-visibility" class:obj-hidden={obj.visible === false} title={obj.visible === false ? 'Show' : 'Hide'} onclick={(e: MouseEvent) => handleToggleObjectVisibility(layer.id, obj.id, e)}>
                <svg width="12" height="12" viewBox="0 0 640 512" fill="currentColor">
                  {#if obj.visible === false}
                    <path d="M38.8 5.1C28.4-3.1 13.3-1.2 5.1 9.2S-1.2 34.7 9.2 42.9l592 464c10.4 8.2 25.5 6.3 33.7-4.1s6.3-25.5-4.1-33.7L525.6 386.7c39.6-40.6 66.4-86.1 79.9-118.4c3.3-7.9 3.3-16.7 0-24.6c-14.9-35.7-46.2-87.7-93-131.1C465.5 68.8 400.8 32 320 32c-68.2 0-125 26.3-169.3 60.8L38.8 5.1z"/>
                  {:else}
                    <path d="M288 80c-65.2 0-118.8 29.6-159.9 67.7C89.6 183.5 63 226 49.4 256c13.6 30 40.2 72.5 78.6 108.3C169.2 402.4 222.8 432 288 432s118.8-29.6 159.9-67.7C486.4 328.5 513 286 526.6 256c-13.6-30-40.2-72.5-78.6-108.3C406.8 109.6 353.2 80 288 80zM95.4 112.6C142.5 68.8 207.2 32 288 32s145.5 36.8 192.6 80.6c46.8 43.5 78.1 95.4 93 131.1c3.3 7.9 3.3 16.7 0 24.6c-14.9 35.7-46.2 87.7-93 131.1C433.5 443.2 368.8 480 288 480s-145.5-36.8-192.6-80.6C48.6 356 17.3 304 2.5 268.3c-3.3-7.9-3.3-16.7 0-24.6C17.3 208 48.6 156 95.4 112.6zM288 336c44.2 0 80-35.8 80-80s-35.8-80-80-80s-80 35.8-80 80s35.8 80 80 80z"/>
                  {/if}
                </svg>
              </button>
              <button class="sub-item-order" title="Move forward (up)" onclick={(e: MouseEvent) => handleReorderObject(layer.id, obj.id, 'up', e)}>↑</button>
              <button class="sub-item-order" title="Move backward (down)" onclick={(e: MouseEvent) => handleReorderObject(layer.id, obj.id, 'down', e)}>↓</button>
              <button class="sub-item-delete" title="Delete sketch" onclick={(e: MouseEvent) => handleDeleteObject(layer.id, obj.id, e)}>×</button>
            </div>
          {/each}
        {/if}
        {/if}
      {/each}
    {/if}
  </div>
</div>

<!-- Context menu for group assignment -->
{#if contextMenuObj}
  {@const map = getMap()}
  {@const ctxLayer = map?.layers.find(l => l.id === contextMenuObj.layerId)}
  {@const ctxGroups = (ctxLayer?.type === 'object' ? (ctxLayer as ObjectLayer).groups : null) || []}
  {@const ctxObj = ctxLayer?.type === 'object' ? (ctxLayer as ObjectLayer).objects.find(o => o.id === contextMenuObj.objectId) : null}
  {@const multiIds = getSelectedObjectIds()}
  {@const isMulti = multiIds.length > 1 && isObjectSelected(contextMenuObj.objectId)}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div class="context-menu" style="left: {contextMenuObj.x}px; top: {contextMenuObj.y}px" role="menu" onclick={(e: MouseEvent) => e.stopPropagation()}>
    {#if isMulti}
      <!-- Multi-selection context menu -->
      <div class="context-menu-header">{multiIds.length} objects selected</div>
      <button class="context-menu-item" role="menuitem" onclick={(e: MouseEvent) => { handleCreateGroupWithSelection(contextMenuObj!.layerId, e); closeContextMenu() }}>
        New Group with Selection
      </button>
      {#each ctxGroups as g (g.id)}
        <button class="context-menu-item" role="menuitem" onclick={(e: MouseEvent) => { handleMoveSelectionToGroup(contextMenuObj!.layerId, g.id, e); closeContextMenu() }}>
          Move all to "{g.name}"
        </button>
      {/each}
      <button class="context-menu-item" role="menuitem" onclick={(e: MouseEvent) => { handleMoveSelectionToGroup(contextMenuObj!.layerId, undefined, e); closeContextMenu() }}>
        Remove all from Group
      </button>
    {:else}
      <!-- Single object context menu -->
      {#if ctxObj?.groupId}
        <button class="context-menu-item" role="menuitem" onclick={(e: MouseEvent) => { handleMoveToGroup(contextMenuObj!.layerId, contextMenuObj!.objectId, undefined, e); closeContextMenu() }}>
          Remove from Group
        </button>
      {/if}
      {#each ctxGroups as g (g.id)}
        {#if g.id !== ctxObj?.groupId}
          <button class="context-menu-item" role="menuitem" onclick={(e: MouseEvent) => { handleMoveToGroup(contextMenuObj!.layerId, contextMenuObj!.objectId, g.id, e); closeContextMenu() }}>
            Move to "{g.name}"
          </button>
        {/if}
      {/each}
      {#if ctxGroups.length === 0 && !ctxObj?.groupId}
        <div class="context-menu-item disabled">No groups (create one first)</div>
      {/if}
    {/if}
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

  .panel-actions {
    display: flex;
    gap: 2px;
    align-items: center;
  }

  .add-menu-wrapper {
    position: relative;
  }

  .add-menu {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 100;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: 4px 0;
    min-width: 140px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .add-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    text-align: left;
  }

  .add-menu-item:hover {
    background: var(--bg-hover);
  }

  .layer-type-icon {
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 700;
  }

  .layer-type-icon.tile {
    background: var(--accent);
    color: var(--bg-primary);
  }

  .layer-type-icon.object {
    background: #f38ba8;
    color: var(--bg-primary);
  }

  .layer-type-icon.image {
    background: #a6e3a1;
    color: var(--bg-primary);
  }

  .layer-type-icon.drawing {
    background: #cba6f7;
    color: var(--bg-primary);
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
    max-height: 350px;
    overflow-y: auto;
  }

  .layer-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .layer-item:hover {
    background: var(--bg-hover);
  }

  .layer-item.active {
    background: var(--bg-active);
  }

  .expand-btn {
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
  }

  .expand-btn:hover {
    color: var(--text-primary);
  }

  .expand-spacer {
    width: 16px;
    flex-shrink: 0;
  }

  .visibility-btn {
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    background: transparent;
    font-size: 10px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .visibility-btn.visible {
    color: var(--accent);
  }

  .layer-type-badge {
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    font-size: 9px;
    font-weight: 700;
    background: var(--accent);
    color: var(--bg-primary);
    flex-shrink: 0;
  }

  .layer-type-badge.object-badge {
    background: #f38ba8;
  }

  .layer-type-badge.image-badge {
    background: #a6e3a1;
  }

  .layer-type-badge.drawing-badge {
    background: #cba6f7;
  }

  .layer-name {
    font-size: var(--font-size-base);
    flex: 1;
    cursor: default;
  }

  .layer-rename-input {
    flex: 1;
    font-size: var(--font-size-base);
    background: var(--bg-tertiary);
    border: 1px solid var(--accent);
    border-radius: 3px;
    color: var(--text-primary);
    padding: 1px 4px;
    outline: none;
    min-width: 0;
  }

  .lock-icon {
    color: #fab387;
    flex-shrink: 0;
  }

  .layer-opacity {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
  }

  .empty-message {
    text-align: center;
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    padding: 12px 0;
  }

  /* Sub-items for tree view */
  .sub-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px 3px 40px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--font-size-sm);
  }

  .sub-item:hover {
    background: var(--bg-hover);
  }

  .sub-item.selected {
    background: var(--bg-active);
    border-left: 2px solid var(--accent);
    padding-left: 38px;
  }

  .sub-item-empty {
    padding: 4px 8px 4px 40px;
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    font-style: italic;
  }

  .object-thumb-mini {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-tertiary);
    border-radius: 2px;
    flex-shrink: 0;
    overflow: hidden;
  }

  .object-thumb-mini img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    image-rendering: pixelated;
  }

  .zone-color-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .zone-icon {
    flex-shrink: 0;
  }

  .sub-item-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sub-item-delete {
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

  .sub-item:hover .sub-item-delete {
    opacity: 1;
  }

  .sub-item-delete:hover {
    color: #f38ba8;
  }

  .sub-item-visibility {
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.1s;
    flex-shrink: 0;
  }

  .sub-item:hover .sub-item-visibility {
    opacity: 1;
  }

  /* Always show eye-slash when hidden */
  .sub-item-visibility.obj-hidden {
    opacity: 1;
    color: #f38ba8;
  }

  .sub-item-visibility:hover {
    color: var(--text-primary);
  }

  .hidden-name {
    opacity: 0.4;
    text-decoration: line-through;
  }

  .sub-item-order {
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 10px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.1s;
    flex-shrink: 0;
  }

  .sub-item:hover .sub-item-order {
    opacity: 1;
  }

  .sub-item-order:hover {
    color: var(--accent);
  }

  .sort-mode-btn {
    width: 18px;
    height: 16px;
    padding: 0;
    font-size: 9px;
    font-weight: 700;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .sort-mode-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
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

  .search-match {
    border-left: 2px solid var(--accent);
    padding-left: 38px;
  }

  /* Add group icon button in layer header */
  .add-group-icon-btn {
    width: 22px;
    height: 16px;
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    position: relative;
  }

  .add-group-icon-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .add-group-plus {
    font-size: 8px;
    font-weight: 700;
    position: absolute;
    bottom: -1px;
    right: 0px;
    color: var(--accent);
    line-height: 1;
  }

  /* Group styles */
  .group-header {
    font-weight: 600;
    color: var(--text-secondary);
  }

  .group-header:hover {
    background: var(--bg-hover);
  }

  .group-folder-icon {
    flex-shrink: 0;
    color: #f9e2af;
  }

  .group-count {
    font-size: 10px;
    color: var(--text-muted);
    font-weight: 400;
    flex-shrink: 0;
  }

  .grouped-item {
    padding-left: 56px;
  }

  .grouped-item.selected {
    padding-left: 54px;
  }

  /* Group rename input */
  .group-rename-input {
    flex: 1;
    padding: 1px 4px;
    font-size: var(--font-size-sm);
    font-weight: 600;
    background: var(--bg-primary);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    outline: none;
    min-width: 0;
  }

  /* Drag & drop styles */
  .dragging {
    opacity: 0.4;
  }

  .drop-target {
    background: rgba(137, 180, 250, 0.15) !important;
    outline: 1px dashed var(--accent);
    outline-offset: -1px;
  }

  .ungrouped-drop-zone {
    padding: 4px 8px 4px 40px;
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-sm);
    margin: 2px 8px 2px 8px;
    text-align: center;
    font-style: italic;
  }

  .ungrouped-drop-zone.drop-target {
    background: rgba(137, 180, 250, 0.15);
    border-color: var(--accent);
    color: var(--accent);
  }

  /* Context menu */
  .context-menu {
    position: fixed;
    z-index: 10000;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: 4px 0;
    min-width: 160px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .context-menu-item {
    display: block;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    text-align: left;
  }

  .context-menu-item:hover {
    background: var(--accent);
    color: var(--bg-primary);
  }

  .context-menu-header {
    padding: 4px 12px 2px;
    font-size: 10px;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid var(--border-subtle);
    margin-bottom: 2px;
  }

  .context-menu-item.disabled {
    color: var(--text-muted);
    cursor: default;
    font-style: italic;
  }

  .context-menu-item.disabled:hover {
    background: transparent;
    color: var(--text-muted);
  }
</style>
