<script lang="ts">
  import { onMount } from 'svelte'
  import { collabStore } from '../../lib/collab/collab-store'
  import { getMap } from '../../lib/stores/map-store'

  interface SnapshotInfo {
    id: string
    name: string
    ts: number
  }

  let snapshots = $state<SnapshotInfo[]>([])
  let connected = $state(false)
  let isHost = $state(false)
  let expanded = $state(true)
  let newName = $state('')
  let creating = $state(false)
  let restoring = $state(false)

  onMount(() => {
    const unsub = collabStore.subscribe(() => {
      const s = collabStore.getState()
      connected = s.connected
      isHost = s.role === 'host'
    })

    // Listen for snapshot restore events
    const api = (window as any).electronAPI
    if (api?.onCollabSnapshotRestored) {
      api.onCollabSnapshotRestored((_data: string) => {
        // The collab-bridge will handle applying the snapshot via collab-store
        // Just refresh snapshot list
        refreshSnapshots()
      })
    }

    return unsub
  })

  async function refreshSnapshots() {
    const api = (window as any).electronAPI
    if (!api?.collabListSnapshots) return
    snapshots = await api.collabListSnapshots()
  }

  // Refresh when connected
  $effect(() => {
    if (connected && isHost) {
      refreshSnapshots()
    }
  })

  async function createSnapshot() {
    const api = (window as any).electronAPI
    if (!api?.collabCreateSnapshot) return

    const map = getMap()
    if (!map) return

    creating = true
    const name = newName.trim() || `Snapshot ${snapshots.length + 1}`
    const data = JSON.stringify(map, (key, value) => {
      if (key === 'imageBitmap') return undefined
      return value
    })

    const info = await api.collabCreateSnapshot(name, data)
    snapshots = [...snapshots, info]
    newName = ''
    creating = false
  }

  async function restoreSnapshot(id: string) {
    const api = (window as any).electronAPI
    if (!api?.collabRestoreSnapshot) return

    restoring = true
    await api.collabRestoreSnapshot(id)
    restoring = false
  }

  function formatTime(ts: number): string {
    const d = new Date(ts)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  function formatDate(ts: number): string {
    const d = new Date(ts)
    return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}. ${formatTime(ts)}`
  }
</script>

{#if connected && isHost}
<div class="panel">
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="panel-header" onclick={() => expanded = !expanded}>
    <span class="panel-title">
      <span class="chevron" class:open={expanded}>&#9656;</span>
      Snapshots
    </span>
    {#if snapshots.length > 0}
      <span class="count">{snapshots.length}</span>
    {/if}
  </div>

  {#if expanded}
    <div class="panel-body">
      <!-- Create snapshot -->
      <div class="create-row">
        <input
          type="text"
          class="name-input"
          bind:value={newName}
          placeholder="Snapshot-Name..."
          onkeydown={(e) => { if (e.key === 'Enter') createSnapshot() }}
        />
        <button class="create-btn" onclick={createSnapshot} disabled={creating}>
          {creating ? '...' : '+'}
        </button>
      </div>

      <!-- Snapshot list -->
      {#if snapshots.length === 0}
        <div class="empty">Keine Snapshots</div>
      {:else}
        <div class="snapshot-list">
          {#each snapshots as snap (snap.id)}
            <div class="snapshot-item">
              <div class="snap-info">
                <span class="snap-name">{snap.name}</span>
                <span class="snap-time">{formatDate(snap.ts)}</span>
              </div>
              <button
                class="restore-btn"
                onclick={() => restoreSnapshot(snap.id)}
                disabled={restoring}
                title="Wiederherstellen"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="1 4 1 10 7 10"></polyline>
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
                </svg>
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
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
    padding: 8px 12px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color);
    cursor: pointer;
  }

  .panel-title {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    display: flex;
    align-items: center;
    gap: 4px;
    user-select: none;
  }

  .chevron {
    font-size: 10px;
    color: var(--text-muted);
    transition: transform 0.15s;
    display: inline-block;
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .count {
    font-size: 10px;
    color: var(--text-muted);
  }

  .panel-body {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .create-row {
    display: flex;
    gap: 4px;
  }

  .name-input {
    flex: 1;
    padding: 4px 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
  }

  .name-input:focus {
    border-color: var(--accent);
    outline: none;
  }

  .name-input::placeholder {
    color: var(--text-muted);
  }

  .create-btn {
    width: 28px;
    height: 28px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    color: var(--bg-primary);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 16px;
    font-weight: 700;
    flex-shrink: 0;
  }

  .create-btn:hover {
    filter: brightness(1.1);
  }

  .create-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .empty {
    color: var(--text-muted);
    font-size: 11px;
    text-align: center;
    padding: 8px 0;
  }

  .snapshot-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 150px;
    overflow-y: auto;
  }

  .snapshot-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    background: var(--bg-primary);
  }

  .snapshot-item:hover {
    background: var(--bg-hover);
  }

  .snap-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .snap-name {
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .snap-time {
    font-size: 10px;
    color: var(--text-muted);
  }

  .restore-btn {
    width: 24px;
    height: 24px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--text-muted);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    flex-shrink: 0;
  }

  .restore-btn:hover {
    color: var(--accent);
    background: var(--bg-hover);
  }

  .restore-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
