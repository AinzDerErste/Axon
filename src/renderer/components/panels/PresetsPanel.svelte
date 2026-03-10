<script lang="ts">
  import { onMount } from 'svelte'
  import {
    getPresets, removePreset, renamePreset,
    getSelectedPresetId, selectPreset,
    subscribe as presetSubscribe
  } from '../../lib/stores/preset-store'
  import { setActiveTool } from '../../lib/stores/tool-store'
  import type { Preset } from '../../lib/models/preset'

  let presets = $state<Preset[]>([])
  let selectedId = $state<string | null>(null)
  let viewMode = $state<'list' | 'grid'>('grid')
  let searchQuery = $state('')
  let renamingId = $state<string | null>(null)
  let renameValue = $state('')
  let renameInputRef = $state<HTMLInputElement | null>(null)

  onMount(() => {
    const unsub = presetSubscribe(() => {
      presets = getPresets()
      selectedId = getSelectedPresetId()
    })
    presets = getPresets()
    selectedId = getSelectedPresetId()
    return unsub
  })

  $effect(() => {
    if (renamingId && renameInputRef) {
      renameInputRef.focus()
      renameInputRef.select()
    }
  })

  function handleSelect(id: string) {
    if (selectedId === id) {
      selectPreset(null)
    } else {
      selectPreset(id)
      setActiveTool('stamp')
    }
  }

  function handleDelete(id: string) {
    removePreset(id)
  }

  function startRename(id: string, currentName: string) {
    renamingId = id
    renameValue = currentName
  }

  function finishRename() {
    if (renamingId && renameValue.trim()) {
      renamePreset(renamingId, renameValue.trim())
    }
    renamingId = null
    renameValue = ''
  }

  function cancelRename() {
    renamingId = null
    renameValue = ''
  }

  const filtered = $derived(
    !searchQuery
      ? presets
      : presets.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
  )
</script>

<div class="panel">
  <div class="panel-header">
    <span class="panel-title">Presets</span>
    <div class="header-actions">
      <button
        class="view-toggle"
        class:active={viewMode === 'list'}
        title="List View"
        onclick={() => viewMode = 'list'}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <rect x="0" y="1" width="12" height="2" rx="0.5"/>
          <rect x="0" y="5" width="12" height="2" rx="0.5"/>
          <rect x="0" y="9" width="12" height="2" rx="0.5"/>
        </svg>
      </button>
      <button
        class="view-toggle"
        class:active={viewMode === 'grid'}
        title="Grid View"
        onclick={() => viewMode = 'grid'}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <rect x="0" y="0" width="5" height="5" rx="0.5"/>
          <rect x="7" y="0" width="5" height="5" rx="0.5"/>
          <rect x="0" y="7" width="5" height="5" rx="0.5"/>
          <rect x="7" y="7" width="5" height="5" rx="0.5"/>
        </svg>
      </button>
    </div>
  </div>

  {#if presets.length > 3}
    <div class="search-wrapper">
      <input
        type="text"
        class="search-input"
        placeholder="Search..."
        bind:value={searchQuery}
        onkeydown={(e) => { if (e.key === 'Escape') searchQuery = '' }}
      />
      {#if searchQuery}
        <button class="search-clear" onclick={() => searchQuery = ''}>×</button>
      {/if}
    </div>
  {/if}

  <div class="panel-body">
    {#if presets.length === 0}
      <div class="empty-state">
        <span class="empty-icon">📦</span>
        <span class="empty-text">No presets saved</span>
        <span class="empty-hint">Select tiles and save them as a preset</span>
      </div>
    {:else if viewMode === 'grid'}
      <div class="preset-grid">
        {#each filtered as preset (preset.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="preset-grid-item"
            class:selected={selectedId === preset.id}
            title={preset.name}
            onclick={() => handleSelect(preset.id)}
            oncontextmenu={(e) => { e.preventDefault(); startRename(preset.id, preset.name) }}
          >
            {#if preset.thumbnail}
              <img class="preset-thumb" src={preset.thumbnail} alt={preset.name} />
            {:else}
              <div class="preset-thumb-placeholder">{preset.width}×{preset.height}</div>
            {/if}
            {#if renamingId === preset.id}
              <!-- svelte-ignore a11y_autofocus -->
              <input
                bind:this={renameInputRef}
                class="rename-input"
                bind:value={renameValue}
                onblur={finishRename}
                onkeydown={(e) => { if (e.key === 'Enter') finishRename(); if (e.key === 'Escape') cancelRename() }}
              />
            {:else}
              <span class="preset-name">{preset.name}</span>
            {/if}
            <button class="remove-btn" title="Delete" onclick={(e) => { e.stopPropagation(); handleDelete(preset.id) }}>×</button>
          </div>
        {/each}
      </div>
    {:else}
      <div class="preset-list">
        {#each filtered as preset (preset.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="preset-list-item"
            class:selected={selectedId === preset.id}
            onclick={() => handleSelect(preset.id)}
            oncontextmenu={(e) => { e.preventDefault(); startRename(preset.id, preset.name) }}
          >
            {#if preset.thumbnail}
              <img class="preset-list-thumb" src={preset.thumbnail} alt={preset.name} />
            {:else}
              <div class="preset-list-thumb-placeholder">{preset.width}×{preset.height}</div>
            {/if}
            {#if renamingId === preset.id}
              <!-- svelte-ignore a11y_autofocus -->
              <input
                bind:this={renameInputRef}
                class="rename-input"
                bind:value={renameValue}
                onblur={finishRename}
                onkeydown={(e) => { if (e.key === 'Enter') finishRename(); if (e.key === 'Escape') cancelRename() }}
              />
            {:else}
              <span class="preset-list-name">{preset.name}</span>
            {/if}
            <button class="remove-btn" title="Delete" onclick={(e) => { e.stopPropagation(); handleDelete(preset.id) }}>×</button>
          </div>
        {/each}
      </div>
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
    padding: 8px 12px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color);
  }

  .panel-title {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .header-actions {
    display: flex;
    gap: 2px;
  }

  .view-toggle {
    width: 22px;
    height: 22px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: var(--radius-sm);
  }

  .view-toggle:hover { color: var(--text-primary); }
  .view-toggle.active { color: var(--accent); }

  .search-wrapper {
    position: relative;
    padding: 4px 8px;
  }

  .search-input {
    width: 100%;
    padding: 4px 24px 4px 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
  }

  .search-input:focus { border-color: var(--accent); outline: none; }
  .search-input::placeholder { color: var(--text-muted); }

  .search-clear {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    width: 16px;
    height: 16px;
    border: none;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 14px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .panel-body {
    max-height: 200px;
    overflow-y: auto;
    padding: 4px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 16px 8px;
    gap: 4px;
  }

  .empty-icon { font-size: 24px; opacity: 0.5; }
  .empty-text { font-size: var(--font-size-sm); color: var(--text-muted); }
  .empty-hint { font-size: 11px; color: var(--text-muted); opacity: 0.7; text-align: center; }

  /* Grid view */
  .preset-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 2px;
  }

  .preset-grid-item {
    position: relative;
    width: 64px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 4px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
    color: var(--text-primary);
  }

  .preset-grid-item:hover { background: var(--bg-hover); }
  .preset-grid-item.selected { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }

  .preset-thumb {
    width: 52px;
    height: 52px;
    object-fit: contain;
    image-rendering: pixelated;
    border-radius: var(--radius-sm);
    background: repeating-conic-gradient(var(--bg-tertiary) 0% 25%, transparent 0% 50%) 0 0 / 8px 8px;
  }

  .preset-thumb-placeholder {
    width: 52px;
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    color: var(--text-muted);
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-sm);
  }

  .preset-name {
    font-size: 10px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 60px;
    text-align: center;
  }

  /* List view */
  .preset-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .preset-list-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
    color: var(--text-primary);
    width: 100%;
    text-align: left;
  }

  .preset-list-item:hover { background: var(--bg-hover); }
  .preset-list-item.selected { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }

  .preset-list-thumb {
    width: 36px;
    height: 36px;
    object-fit: contain;
    image-rendering: pixelated;
    border-radius: var(--radius-sm);
    background: repeating-conic-gradient(var(--bg-tertiary) 0% 25%, transparent 0% 50%) 0 0 / 6px 6px;
    flex-shrink: 0;
  }

  .preset-list-thumb-placeholder {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    color: var(--text-muted);
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }

  .preset-list-name {
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  .remove-btn {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 16px;
    height: 16px;
    border: none;
    background: rgba(0, 0, 0, 0.5);
    color: var(--text-muted);
    font-size: 12px;
    cursor: pointer;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .preset-grid-item:hover .remove-btn,
  .preset-list-item:hover .remove-btn { opacity: 1; }
  .remove-btn:hover { color: #f38ba8; background: rgba(0, 0, 0, 0.7); }

  .preset-list-item .remove-btn {
    position: relative;
    top: auto;
    right: auto;
    flex-shrink: 0;
  }

  .rename-input {
    width: 100%;
    max-width: 60px;
    padding: 1px 4px;
    font-size: 10px;
    background: var(--bg-primary);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    text-align: center;
  }

  .preset-list-item .rename-input {
    max-width: none;
    flex: 1;
    text-align: left;
    font-size: var(--font-size-sm);
  }

  .rename-input:focus { outline: none; }
</style>
