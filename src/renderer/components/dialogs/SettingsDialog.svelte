<script lang="ts">
  import { onMount } from 'svelte'
  import { getSettings, updateSettings } from '../../lib/stores/settings-store'
  import { getHistory } from '../../lib/stores/history-store'
  import {
    getKeyBindings, getKeys, setKeyAt, addKey, removeKeyAt,
    resetKey, resetAll, findConflict,
    eventToKeyString, mouseEventToKeyString, formatKey,
    subscribe as kbSubscribe
  } from '../../lib/stores/keybindings-store'
  import type { KeyBinding } from '../../lib/stores/keybindings-store'

  interface Props {
    show: boolean
  }

  let { show = $bindable() }: Props = $props()

  // Tab state
  let activeTab = $state<'general' | 'keybindings'>('general')

  // General settings
  let maxUndo = $state(100)
  let autosaveEnabled = $state(false)
  let autosaveInterval = $state(5)
  let fillWarningThreshold = $state(1000)
  let jumpToZoom = $state(100)

  // Keybinding state
  let keyBindings = $state<KeyBinding[]>(getKeyBindings())
  let listeningId = $state<string | null>(null)
  let listeningIndex = $state(-1) // -1 = adding new, >= 0 = editing existing slot
  let conflictMsg = $state('')

  onMount(() => {
    const unsub = kbSubscribe(() => {
      keyBindings = getKeyBindings().map(b => ({ ...b }))
    })
    return unsub
  })

  $effect(() => {
    if (show) {
      const s = getSettings()
      maxUndo = s.maxUndo
      autosaveEnabled = s.autosaveEnabled
      autosaveInterval = s.autosaveInterval
      fillWarningThreshold = s.fillWarningThreshold
      jumpToZoom = s.jumpToZoom
      keyBindings = getKeyBindings().map(b => ({ ...b }))
      listeningId = null
      listeningIndex = -1
      conflictMsg = ''
    }
  })

  function handleApply() {
    const undoVal = Math.max(1, Math.min(10000, maxUndo))
    const intervalVal = Math.max(1, Math.min(60, autosaveInterval))

    getHistory().maxSize = undoVal
    while (getHistory().undoStack.length > undoVal) {
      getHistory().undoStack.shift()
    }

    updateSettings({
      maxUndo: undoVal,
      autosaveEnabled,
      autosaveInterval: intervalVal,
      fillWarningThreshold: Math.max(0, fillWarningThreshold),
      jumpToZoom: Math.max(0, Math.min(500, jumpToZoom))
    })

    show = false
  }

  function handleCancel() {
    show = false
  }

  function applyListeningKey(keyStr: string) {
    if (!listeningId) return

    const currentKeys = getKeys(listeningId)
    const isDuplicate = currentKeys.some((k, i) =>
      k === keyStr.toLowerCase() && (listeningIndex === -1 || i !== listeningIndex)
    )
    if (isDuplicate) {
      conflictMsg = `"${formatKey(keyStr)}" is already assigned to this action`
      return
    }

    const conflict = findConflict(keyStr, listeningId)
    if (conflict) {
      conflictMsg = `"${formatKey(keyStr)}" is already used by "${conflict.label}"`
      return
    }

    if (listeningIndex >= 0) {
      setKeyAt(listeningId, listeningIndex, keyStr)
    } else {
      addKey(listeningId, keyStr)
    }
    listeningId = null
    listeningIndex = -1
    conflictMsg = ''
  }

  function handleKeydown(e: KeyboardEvent) {
    if (listeningId) {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        listeningId = null
        listeningIndex = -1
        conflictMsg = ''
        return
      }

      const keyStr = eventToKeyString(e)
      if (!keyStr) return
      applyListeningKey(keyStr)
      return
    }

    if (e.key === 'Escape') handleCancel()
    if (e.key === 'Enter' && activeTab === 'general') handleApply()
  }

  function handleMousedown(e: MouseEvent) {
    if (!listeningId) return
    e.preventDefault()
    e.stopPropagation()
    const keyStr = mouseEventToKeyString(e)
    if (!keyStr) return
    applyListeningKey(keyStr)
  }

  function handleContextmenu(e: Event) {
    if (listeningId) e.preventDefault()
  }

  function startListeningAt(id: string, index: number) {
    listeningId = id
    listeningIndex = index
    conflictMsg = ''
  }

  function startListeningAdd(id: string) {
    listeningId = id
    listeningIndex = -1
    conflictMsg = ''
  }

  function handleRemoveKey(id: string, index: number) {
    removeKeyAt(id, index)
    listeningId = null
    listeningIndex = -1
    conflictMsg = ''
  }

  function handleResetKey(id: string) {
    resetKey(id)
    listeningId = null
    listeningIndex = -1
    conflictMsg = ''
  }

  function handleResetAll() {
    resetAll()
    listeningId = null
    listeningIndex = -1
    conflictMsg = ''
  }

  function getBindingsByCategory(category: string): KeyBinding[] {
    return keyBindings.filter(b => b.category === category)
  }
</script>

{#if show}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" onkeydown={handleKeydown} onmousedown={handleMousedown} oncontextmenu={handleContextmenu}>
    <div class="dialog">
      <h3>Settings</h3>

      <div class="tabs">
        <button
          class="tab-btn"
          class:active={activeTab === 'general'}
          onclick={() => activeTab = 'general'}
        >General</button>
        <button
          class="tab-btn"
          class:active={activeTab === 'keybindings'}
          onclick={() => activeTab = 'keybindings'}
        >Keybindings</button>
      </div>

      <div class="tab-content">
        {#if activeTab === 'general'}
          <div class="fields">
            <div class="field">
              <label for="max-undo">Max Undo Steps</label>
              <input id="max-undo" type="number" min="1" max="10000" step="10" bind:value={maxUndo} />
              <span class="field-hint">Higher values use more memory (default: 100)</span>
            </div>

            <div class="separator"></div>

            <div class="field">
              <label class="checkbox-label">
                <input type="checkbox" bind:checked={autosaveEnabled} />
                Enable Autosave
              </label>
              <span class="field-hint">Automatically save the project at a regular interval</span>
            </div>

            {#if autosaveEnabled}
              <div class="field">
                <label for="autosave-interval">Autosave Interval (minutes)</label>
                <input id="autosave-interval" type="number" min="1" max="60" step="1"
                  bind:value={autosaveInterval} />
                <span class="field-hint">Save every {autosaveInterval} minute{autosaveInterval !== 1 ? 's' : ''}</span>
              </div>
            {/if}

            <div class="separator"></div>

            <div class="field">
              <label for="fill-threshold">Fill Warning Threshold</label>
              <input id="fill-threshold" type="number" min="0" max="1000000" step="100"
                bind:value={fillWarningThreshold} />
              <span class="field-hint">Show confirmation when flood fill exceeds this many tiles (0 = disabled)</span>
            </div>

            <div class="separator"></div>

            <div class="field">
              <label for="jump-zoom">Jump-to-Selection Zoom (%)</label>
              <input id="jump-zoom" type="number" min="0" max="500" step="10"
                bind:value={jumpToZoom} />
              <span class="field-hint">Zoom level when jumping to a selected object (0 = keep current zoom)</span>
            </div>
          </div>
        {:else if activeTab === 'keybindings'}
          <div class="keybindings">
            {#each ['Tools', 'Canvas'] as category}
              <div class="kb-category">
                <h4 class="kb-category-label">{category}</h4>
                {#each getBindingsByCategory(category) as binding}
                  {@const keys = binding.key.split(',').map(k => k.trim()).filter(Boolean)}
                  <div class="kb-row">
                    <span class="kb-label">{binding.label}</span>
                    <div class="kb-controls">
                      {#each keys as subKey, idx}
                        <div class="kb-key-group">
                          <button
                            class="kb-key-btn"
                            class:listening={listeningId === binding.id && listeningIndex === idx}
                            onclick={() => startListeningAt(binding.id, idx)}
                          >
                            {#if listeningId === binding.id && listeningIndex === idx}
                              Press key / mouse...
                            {:else}
                              {formatKey(subKey)}
                            {/if}
                          </button>
                          {#if keys.length > 1}
                            <button
                              class="kb-remove-btn"
                              title="Remove this key"
                              onclick={() => handleRemoveKey(binding.id, idx)}
                            >
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5">
                                <path d="M2 2l6 6M8 2l-6 6"/>
                              </svg>
                            </button>
                          {/if}
                        </div>
                      {/each}
                      {#if listeningId === binding.id && listeningIndex === -1}
                        <button class="kb-key-btn listening">
                          Press key / mouse...
                        </button>
                      {/if}
                      <button
                        class="kb-add-btn"
                        title="Add alternative key"
                        onclick={() => startListeningAdd(binding.id)}
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8">
                          <path d="M5 1v8M1 5h8"/>
                        </svg>
                      </button>
                      {#if binding.key !== binding.defaultKey}
                        <button
                          class="kb-reset-btn"
                          title="Reset to default"
                          onclick={() => handleResetKey(binding.id)}
                        >
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M1 4l3-3v2a5 5 0 1 1-1.5 5" stroke-linecap="round" stroke-linejoin="round"/>
                          </svg>
                        </button>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            {/each}

            {#if conflictMsg}
              <div class="kb-conflict">{conflictMsg}</div>
            {/if}

            <div class="kb-footer">
              <button class="kb-reset-all-btn" onclick={handleResetAll}>Reset All to Defaults</button>
            </div>
          </div>
        {/if}
      </div>

      <div class="buttons">
        <button class="cancel-btn" onclick={handleCancel}>
          {activeTab === 'general' ? 'Cancel' : 'Close'}
        </button>
        {#if activeTab === 'general'}
          <button class="apply-btn" onclick={handleApply}>Apply</button>
        {/if}
      </div>

    </div>
  </div>
{/if}

<style>
  .overlay {
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

  .dialog {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 24px;
    width: 520px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
  }

  h3 {
    margin: 0 0 16px;
    font-size: 16px;
    color: var(--text-primary);
  }

  .tabs {
    display: flex;
    gap: 2px;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--border-color);
  }

  .tab-btn {
    padding: 8px 16px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    border-radius: 0;
    margin-bottom: -1px;
  }

  .tab-btn:hover {
    color: var(--text-primary);
    background: none;
  }

  .tab-btn.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
    background: none;
  }

  .tab-content {
    flex: 1;
    overflow-y: auto;
    margin-bottom: 16px;
    min-height: 200px;
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field label {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .field input[type="number"] {
    width: 100%;
  }

  .field-hint {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 2px;
  }

  .separator {
    height: 1px;
    background: var(--border-color);
    margin: 4px 0;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    color: var(--text-primary);
    font-size: var(--font-size-sm);
  }

  .keybindings {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .kb-category-label {
    margin: 0 0 8px;
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }

  .kb-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 0;
  }

  .kb-label {
    font-size: var(--font-size-sm);
    color: var(--text-primary);
  }

  .kb-controls {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .kb-key-group {
    display: flex;
    align-items: center;
    gap: 1px;
  }

  .kb-key-btn {
    min-width: 60px;
    padding: 4px 10px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-family: monospace;
    cursor: pointer;
    text-align: center;
    white-space: nowrap;
  }

  .kb-key-btn:hover {
    border-color: var(--accent);
  }

  .kb-key-btn.listening {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, var(--bg-tertiary));
    color: var(--accent);
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }

  .kb-remove-btn {
    width: 18px;
    height: 18px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: var(--radius-sm);
    opacity: 0.6;
  }

  .kb-remove-btn:hover {
    color: var(--danger);
    opacity: 1;
  }

  .kb-add-btn {
    width: 22px;
    height: 22px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: 1px dashed var(--border-color);
    color: var(--text-muted);
    cursor: pointer;
    border-radius: var(--radius-sm);
  }

  .kb-add-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .kb-reset-btn {
    width: 24px;
    height: 24px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: var(--radius-sm);
  }

  .kb-reset-btn:hover {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
  }

  .kb-conflict {
    font-size: var(--font-size-sm);
    color: var(--danger);
    padding: 6px 10px;
    background: color-mix(in srgb, var(--danger) 10%, var(--bg-primary));
    border-radius: var(--radius-sm);
  }

  .kb-footer {
    padding-top: 8px;
    border-top: 1px solid var(--border-color);
  }

  .kb-reset-all-btn {
    padding: 4px 12px;
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    background: none;
    border: 1px solid var(--border-color);
    cursor: pointer;
  }

  .kb-reset-all-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .apply-btn {
    background: var(--accent);
    color: var(--bg-primary);
    border-color: var(--accent);
    font-weight: 600;
    padding: 6px 16px;
  }

  .apply-btn:hover {
    background: var(--accent-hover);
  }

  .cancel-btn {
    padding: 6px 16px;
  }
</style>
