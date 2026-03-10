<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { collabStore } from '../../lib/collab/collab-store'
  import type { CollabUser } from '../../lib/collab/collab-store'
  import * as collabClient from '../../lib/collab/collab-client'
  import { startCollabBridge, stopCollabBridge } from '../../lib/collab/collab-bridge'
  import { getMap } from '../../lib/stores/map-store'

  let connected = $state(false)
  let connecting = $state(false)
  let role = $state<'host' | 'client' | null>(null)
  let users = $state<CollabUser[]>([])
  let error = $state<string | null>(null)
  let expanded = $state(true)

  // Form state
  let hostPort = $state(7777)
  let joinAddress = $state('ws://localhost:7777')
  let userName = $state('Player')

  let prevConnected = false

  onMount(() => {
    const api = (window as any).electronAPI

    // Listen for host-side IPC events (remote users joining/leaving, remote ops)
    if (api?.onCollabUserJoined) {
      api.onCollabUserJoined((user: { id: string; name: string; color: string }) => {
        collabStore.addUser(user)
      })
    }
    if (api?.onCollabUserLeft) {
      api.onCollabUserLeft((info: { id: string }) => {
        collabStore.removeUser(info.id)
      })
    }
    if (api?.onCollabMessage) {
      api.onCollabMessage((msg: any) => {
        // Host receives remote ops/cursor/chat via IPC from main process
        if (msg.type === 'op') {
          collabStore.addIncomingOp(msg.payload)
        } else if (msg.type === 'cursor') {
          collabStore.updateRemoteCursor(msg.sender, msg.payload)
        } else if (msg.type === 'chat') {
          collabStore.addChatMessage({
            sender: msg.sender,
            name: msg.payload.name || 'Unknown',
            text: msg.payload.text,
            ts: msg.ts,
            mapCoord: msg.payload.mapCoord
          })
        }
      })
    }
    if (api?.onCollabError) {
      api.onCollabError((err: string) => {
        collabStore.setError(err)
      })
    }

    const unsub = collabStore.subscribe(() => {
      const s = collabStore.getState()
      connected = s.connected
      connecting = s.connecting
      role = s.role
      users = s.users
      error = s.error

      // Start/stop bridge when connection state changes
      if (s.connected && !prevConnected) {
        startCollabBridge()
      } else if (!s.connected && prevConnected) {
        stopCollabBridge()
      }
      prevConnected = s.connected
    })
    return unsub
  })

  onDestroy(() => {
    stopCollabBridge()
  })

  async function startHost() {
    error = null
    collabStore.setRole('host')

    const api = (window as any).electronAPI
    if (!api?.collabStartServer) {
      collabStore.setError('Collaboration API not available')
      return
    }

    const result = await api.collabStartServer(hostPort)
    if (!result.success) {
      collabStore.setError(result.error || 'Failed to start server')
      collabStore.setRole(null)
      return
    }

    // Send current map state as snapshot to the server
    // so new clients joining will get the current state
    const map = getMap()
    if (map && api.collabSetSnapshot) {
      // Serialize map without ImageBitmaps (not serializable)
      const snapshot = JSON.stringify(map, (key, value) => {
        if (key === 'imageBitmap') return undefined
        return value
      })
      await api.collabSetSnapshot(snapshot)
    }

    // Host also connects as client to its own server
    collabClient.connect(`ws://localhost:${hostPort}`, userName)
  }

  async function joinSession() {
    error = null
    collabStore.setRole('client')
    collabClient.connect(joinAddress, userName)
  }

  async function disconnect() {
    const api = (window as any).electronAPI
    collabClient.disconnect()
    if (role === 'host' && api?.collabStopServer) {
      await api.collabStopServer()
    }
    collabStore.reset()
  }
</script>

<div class="panel">
  <div class="panel-header">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span class="panel-title" onclick={() => expanded = !expanded}>
      <span class="chevron" class:open={expanded}>&#9656;</span>
      Collaboration
    </span>
    {#if connected}
      <span class="status-dot online" title="Verbunden"></span>
    {:else if connecting}
      <span class="status-dot connecting" title="Verbinde..."></span>
    {/if}
  </div>

  {#if expanded}
    <div class="panel-body">
      {#if !connected && !connecting && role === null}
        <!-- Not connected - show host/join UI -->
        <div class="form-group">
          <label class="form-label">
            Name
            <input
              type="text"
              class="form-input"
              bind:value={userName}
              placeholder="Dein Name"
            />
          </label>
        </div>

        <div class="action-section">
          <div class="action-header">Hosten</div>
          <label class="form-row form-label">
            Port
            <input
              type="number"
              class="form-input port-input"
              bind:value={hostPort}
              min={1024}
              max={65535}
            />
          </label>
          <button class="btn btn-primary" onclick={startHost}>
            Server starten
          </button>
        </div>

        <div class="divider">oder</div>

        <div class="action-section">
          <div class="action-header">Beitreten</div>
          <div class="form-group">
            <label class="form-label">
              Server-Adresse
              <input
                type="text"
                class="form-input"
                bind:value={joinAddress}
                placeholder="ws://192.168.1.100:7777"
              />
            </label>
          </div>
          <button class="btn btn-secondary" onclick={joinSession}>
            Verbinden
          </button>
        </div>

      {:else if connecting}
        <div class="status-message">
          <span class="spinner"></span>
          Verbinde...
        </div>
        <button class="btn btn-danger" onclick={disconnect}>Abbrechen</button>

      {:else if connected}
        <!-- Connected view -->
        <div class="connected-info">
          <div class="role-badge" class:host={role === 'host'}>
            {role === 'host' ? 'Host' : 'Client'}
          </div>
          {#if role === 'host'}
            <div class="server-info">Port: {hostPort}</div>
          {/if}
        </div>

        <div class="users-section">
          <div class="users-header">
            Spieler ({users.length})
          </div>
          <div class="users-list">
            {#each users as user (user.id)}
              <div class="user-item">
                <span class="user-color" style="background: {user.color}"></span>
                <span class="user-name">{user.name}</span>
              </div>
            {/each}
          </div>
        </div>

        <button class="btn btn-danger" onclick={disconnect}>
          Trennen
        </button>
      {/if}

      {#if error}
        <div class="error-message">{error}</div>
      {/if}
    </div>
  {/if}
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

  .panel-body {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .form-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .form-label {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .form-input {
    width: 100%;
    padding: 4px 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
  }

  .form-input:focus {
    border-color: var(--accent);
    outline: none;
  }

  .port-input {
    width: 80px;
  }

  .action-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .action-header {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 2px;
  }

  .divider {
    text-align: center;
    font-size: 11px;
    color: var(--text-muted);
    position: relative;
    margin: 4px 0;
  }

  .divider::before,
  .divider::after {
    content: '';
    position: absolute;
    top: 50%;
    width: 35%;
    height: 1px;
    background: var(--border-color);
  }

  .divider::before { left: 0; }
  .divider::after { right: 0; }

  .btn {
    padding: 5px 12px;
    border: none;
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    cursor: pointer;
    font-weight: 500;
    transition: background 0.15s;
  }

  .btn-primary {
    background: var(--accent);
    color: var(--bg-primary);
  }

  .btn-primary:hover {
    filter: brightness(1.1);
  }

  .btn-secondary {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .btn-secondary:hover {
    background: var(--border-color);
  }

  .btn-danger {
    background: #f38ba8;
    color: var(--bg-primary);
  }

  .btn-danger:hover {
    filter: brightness(1.1);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-dot.online {
    background: #a6e3a1;
  }

  .status-dot.connecting {
    background: #f9e2af;
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .status-message {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--font-size-sm);
    color: var(--text-muted);
  }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--border-color);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .connected-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .role-badge {
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    font-size: 11px;
    font-weight: 600;
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  .role-badge.host {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    color: var(--accent);
  }

  .server-info {
    font-size: 11px;
    color: var(--text-muted);
  }

  .users-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .users-header {
    font-size: 11px;
    color: var(--text-muted);
    font-weight: 600;
  }

  .users-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .user-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px;
    border-radius: var(--radius-sm);
  }

  .user-color {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .user-name {
    font-size: var(--font-size-sm);
    color: var(--text-primary);
  }

  .error-message {
    font-size: 11px;
    color: #f38ba8;
    padding: 4px 6px;
    background: rgba(243, 139, 168, 0.1);
    border-radius: var(--radius-sm);
  }
</style>
