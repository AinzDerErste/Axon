<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import { collabStore } from '../../lib/collab/collab-store'
  import type { CollabUser, ChatMessage } from '../../lib/collab/collab-store'
  import { lockStore } from '../../lib/collab/lock-store'
  import * as collabClient from '../../lib/collab/collab-client'
  import { startCollabBridge, stopCollabBridge } from '../../lib/collab/collab-bridge'
  import { getMap } from '../../lib/stores/map-store'

  // ── Shared state ──
  let connected = $state(false)
  let connecting = $state(false)
  let role = $state<'host' | 'client' | null>(null)
  let users = $state<CollabUser[]>([])
  let error = $state<string | null>(null)

  // ── Panel toggle ──
  let open = $state(false)
  let activeTab = $state<'connect' | 'chat' | 'snapshots'>('connect')
  let connectMode = $state<'host' | 'join'>('host')

  // ── Connect form ──
  let hostPort = $state(7777)
  let joinAddress = $state('ws://localhost:7777')
  let userName = $state('Player')
  let joinPassword = $state('')

  // ── Chat ──
  let messages = $state<ChatMessage[]>([])
  let messageText = $state('')
  let messagesEl = $state<HTMLDivElement>(undefined!)

  // ── Snapshots ──
  interface SnapshotInfo { id: string; name: string; ts: number }
  let snapshots = $state<SnapshotInfo[]>([])
  let isHost = $state(false)
  let newSnapName = $state('')
  let creating = $state(false)
  let restoring = $state(false)

  let prevConnected = false

  onMount(() => {
    const api = (window as any).electronAPI

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
        } else if (msg.type === 'lock') {
          const user = collabStore.getUsers().find(u => u.id === msg.sender)
          const color = user?.color || '#89b4fa'
          if (msg.payload.tiles?.length) {
            lockStore.claimTileLocks(msg.sender, color, msg.payload.tiles)
          }
          if (msg.payload.entities?.length) {
            for (const e of msg.payload.entities) {
              lockStore.claimEntityLock(msg.sender, color, e.layerId, e.entityId)
            }
          }
        } else if (msg.type === 'unlock') {
          if (msg.payload.tiles?.length) {
            lockStore.releaseTileLocks(msg.payload.tiles)
          }
          if (msg.payload.entities?.length) {
            for (const e of msg.payload.entities) {
              lockStore.releaseEntityLock(e.layerId, e.entityId)
            }
          }
        }
      })
    }
    if (api?.onCollabError) {
      api.onCollabError((err: string) => {
        collabStore.setError(err)
      })
    }
    if (api?.onCollabSnapshotRestored) {
      api.onCollabSnapshotRestored((_data: string) => {
        refreshSnapshots()
      })
    }

    const unsub = collabStore.subscribe(() => {
      const s = collabStore.getState()
      connected = s.connected
      connecting = s.connecting
      role = s.role
      users = s.users
      error = s.error
      isHost = s.role === 'host'

      const wasAtBottom = messagesEl
        ? messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 30
        : true
      messages = collabStore.getChatMessages()
      if (wasAtBottom && messagesEl) {
        tick().then(() => { messagesEl.scrollTop = messagesEl.scrollHeight })
      }

      if (s.connected && !prevConnected) {
        startCollabBridge()
        activeTab = 'chat'
      } else if (!s.connected && prevConnected) {
        stopCollabBridge()
        activeTab = 'connect'
      }
      prevConnected = s.connected
    })
    return unsub
  })

  onDestroy(() => {
    stopCollabBridge()
  })

  $effect(() => {
    if (connected && isHost) refreshSnapshots()
  })

  // ── Connect ──
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
    const map = getMap()
    if (map && api.collabSetSnapshot) {
      const snapshot = JSON.stringify(map, (key, value) => {
        if (key === 'imageBitmap') return undefined
        return value
      })
      await api.collabSetSnapshot(snapshot)
    }
    collabClient.connect(`ws://localhost:${hostPort}`, userName)
  }

  async function joinSession() {
    error = null
    collabStore.setRole('client')
    collabClient.connect(joinAddress, userName, joinPassword || undefined)
  }

  function uploadMapToServer() {
    const map = getMap()
    if (!map) return
    const json = JSON.stringify(map, (key, value) => {
      if (key === 'imageBitmap') return undefined
      return value
    })
    collabClient.sendUploadMap(json)
  }

  async function disconnect() {
    const api = (window as any).electronAPI
    collabClient.disconnect()
    if (role === 'host' && api?.collabStopServer) {
      await api.collabStopServer()
    }
    collabStore.reset()
  }

  // ── Chat ──
  function sendMessage() {
    const text = messageText.trim()
    if (!text) return
    collabClient.sendChat(text)
    messageText = ''
  }

  function handleChatKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // ── Snapshots ──
  async function refreshSnapshots() {
    const api = (window as any).electronAPI
    if (!api?.collabListSnapshots) return
    snapshots = await api.collabListSnapshots()
  }

  async function createSnapshot() {
    const api = (window as any).electronAPI
    if (!api?.collabCreateSnapshot) return
    const map = getMap()
    if (!map) return
    creating = true
    const name = newSnapName.trim() || `Snapshot ${snapshots.length + 1}`
    const data = JSON.stringify(map, (key, value) => {
      if (key === 'imageBitmap') return undefined
      return value
    })
    const info = await api.collabCreateSnapshot(name, data)
    snapshots = [...snapshots, info]
    newSnapName = ''
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

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="collab-toggle" class:connected class:open onclick={() => open = !open} title="Collaboration">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
  {#if connected}
    <span class="toggle-dot"></span>
  {/if}
</div>

{#if open}
  <div class="collab-overlay">
    <div class="overlay-header">
      <div class="tabs">
        <button class="tab" class:active={activeTab === 'connect'} onclick={() => activeTab = 'connect'}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            {#if connected}
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            {:else}
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            {/if}
          </svg>
        </button>
        {#if connected}
          <button class="tab" class:active={activeTab === 'chat'} onclick={() => activeTab = 'chat'}>
            Chat
            {#if messages.length > 0}
              <span class="tab-badge">{messages.length}</span>
            {/if}
          </button>
          {#if isHost}
            <button class="tab" class:active={activeTab === 'snapshots'} onclick={() => activeTab = 'snapshots'}>
              Snapshots
            </button>
          {/if}
        {/if}
      </div>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="close-btn" onclick={() => open = false}>&times;</span>
    </div>

    <div class="overlay-body">

      <!-- ═══════════ CONNECTION ═══════════ -->
      {#if activeTab === 'connect'}
        {#if !connected && !connecting && role === null}
          <div class="field">
            <span class="field-label">Name</span>
            <input type="text" class="input" bind:value={userName} placeholder="Your name" />
          </div>

          <div class="mode-switch">
            <button class="mode-btn" class:active={connectMode === 'host'} onclick={() => connectMode = 'host'}>Host</button>
            <button class="mode-btn" class:active={connectMode === 'join'} onclick={() => connectMode = 'join'}>Join</button>
          </div>

          {#if connectMode === 'host'}
            <div class="field">
              <span class="field-label">Port</span>
              <input type="number" class="input input-short" bind:value={hostPort} min={1024} max={65535} />
            </div>
            <button class="action-btn primary" onclick={startHost}>Start Server</button>
          {:else}
            <div class="field">
              <span class="field-label">Address</span>
              <input type="text" class="input" bind:value={joinAddress} placeholder="ws://192.168.1.100:7777" />
            </div>
            <div class="field">
              <span class="field-label">Password</span>
              <input type="password" class="input" bind:value={joinPassword} placeholder="Optional" />
            </div>
            <button class="action-btn" onclick={joinSession}>Connect</button>
          {/if}

        {:else if connecting}
          <div class="center-status">
            <span class="spinner"></span>
            <span class="status-text">Connecting...</span>
          </div>
          <button class="action-btn danger" onclick={disconnect}>Cancel</button>

        {:else if connected}
          <div class="connected-bar">
            <span class="role-badge" class:host={role === 'host'}>{role === 'host' ? 'Host' : 'Client'}</span>
            {#if role === 'host'}
              <span class="meta">Port {hostPort}</span>
            {/if}
            <span class="meta">{users.length} {users.length === 1 ? 'Member' : 'Members'}</span>
          </div>
          <div class="user-chips">
            {#each users as user (user.id)}
              <span class="user-chip">
                <span class="dot" style="background:{user.color}"></span>
                {user.name}
              </span>
            {/each}
          </div>
          <div class="action-row">
            <button class="action-btn small" onclick={uploadMapToServer} title="Upload your current map to the server for others to see">Upload Map</button>
            <button class="action-btn danger small" onclick={disconnect}>Disconnect</button>
          </div>
        {/if}

        {#if error}
          <div class="error-msg">{error}</div>
        {/if}

      <!-- ═══════════ CHAT ═══════════ -->
      {:else if activeTab === 'chat'}
        <div class="chat-messages" bind:this={messagesEl}>
          {#if messages.length === 0}
            <div class="empty">No messages yet</div>
          {:else}
            {#each messages as msg (msg.ts + msg.sender)}
              <div class="msg" class:own={msg.sender === collabClient.getUserId()}>
                <span class="msg-who">{msg.name}</span>
                <span class="msg-txt">{msg.text}</span>
                <span class="msg-ts">{formatTime(msg.ts)}</span>
              </div>
            {/each}
          {/if}
        </div>
        {#if connected}
          <div class="chat-bar">
            <input
              type="text"
              class="input chat-input"
              bind:value={messageText}
              placeholder="Message..."
              onkeydown={handleChatKeyDown}
            />
            <button class="send-btn" onclick={sendMessage} disabled={!messageText.trim()} title="Send">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
            </button>
          </div>
        {/if}

      <!-- ═══════════ SNAPSHOTS ═══════════ -->
      {:else if activeTab === 'snapshots'}
        <div class="snap-create">
          <input
            type="text"
            class="input"
            bind:value={newSnapName}
            placeholder="Snapshot name..."
            onkeydown={(e) => { if (e.key === 'Enter') createSnapshot() }}
          />
          <button class="send-btn" onclick={createSnapshot} disabled={creating} title="Create snapshot">
            {creating ? '...' : '+'}
          </button>
        </div>
        {#if snapshots.length === 0}
          <div class="empty">No snapshots</div>
        {:else}
          <div class="snap-list">
            {#each snapshots as snap (snap.id)}
              <div class="snap-row">
                <div class="snap-meta">
                  <span class="snap-name">{snap.name}</span>
                  <span class="snap-time">{formatDate(snap.ts)}</span>
                </div>
                <button
                  class="icon-btn"
                  onclick={() => restoreSnapshot(snap.id)}
                  disabled={restoring}
                  title="Restore"
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
      {/if}

    </div>
  </div>
{/if}

<style>
  /* ── Toggle ── */
  .collab-toggle {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 101;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    cursor: pointer;
    color: var(--text-muted);
    -webkit-app-region: no-drag;
    transition: all 0.15s;
  }
  .collab-toggle:hover { color: var(--text-primary); border-color: var(--text-muted); }
  .collab-toggle.connected { border-color: var(--accent); color: var(--accent); }
  .collab-toggle.open { background: var(--bg-tertiary); }
  .toggle-dot {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #a6e3a1;
    border: 1px solid var(--bg-secondary);
  }

  /* ── Overlay ── */
  .collab-overlay {
    position: absolute;
    top: 8px;
    right: 44px;
    z-index: 100;
    width: 280px;
    display: flex;
    flex-direction: column;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.45);
    -webkit-app-region: no-drag;
    overflow: hidden;
  }

  /* ── Header / Tabs ── */
  .overlay-header {
    display: flex;
    align-items: center;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }
  .tabs {
    display: flex;
    flex: 1;
  }
  .tab {
    padding: 6px 10px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
    transition: color 0.1s;
  }
  .tab:hover { color: var(--text-primary); }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .tab-badge {
    font-size: 9px;
    background: var(--accent);
    color: var(--bg-primary);
    padding: 0 5px;
    border-radius: 8px;
    font-weight: 700;
    line-height: 14px;
  }
  .close-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 18px;
    flex-shrink: 0;
    border-radius: 4px;
  }
  .close-btn:hover { color: var(--text-primary); background: var(--bg-hover); }

  /* ── Body ── */
  .overlay-body {
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* ── Shared form elements ── */
  .field {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .field-label {
    font-size: 11px;
    color: var(--text-muted);
    min-width: 44px;
    flex-shrink: 0;
  }
  .input {
    flex: 1;
    padding: 5px 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 12px;
    outline: none;
    transition: border-color 0.15s;
  }
  .input:focus { border-color: var(--accent); }
  .input::placeholder { color: var(--text-muted); }
  .input-short { max-width: 90px; }

  /* ── Mode switch ── */
  .mode-switch {
    display: flex;
    background: var(--bg-primary);
    border-radius: 4px;
    border: 1px solid var(--border-color);
    overflow: hidden;
  }
  .mode-btn {
    flex: 1;
    padding: 5px 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .mode-btn:hover { color: var(--text-primary); }
  .mode-btn.active {
    background: var(--accent);
    color: var(--bg-primary);
  }

  /* ── Action buttons ── */
  .action-btn {
    padding: 6px 0;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    background: var(--bg-hover);
    color: var(--text-primary);
    transition: all 0.15s;
  }
  .action-btn:hover { filter: brightness(1.15); }
  .action-btn.primary { background: var(--accent); color: var(--bg-primary); }
  .action-btn.danger { background: #f38ba8; color: var(--bg-primary); }
  .action-btn.small { padding: 4px 0; font-size: 11px; flex: 1; }
  .action-row { display: flex; gap: 6px; }

  /* ── Connecting state ── */
  .center-status {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 4px 0;
  }
  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--border-color);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .status-text { font-size: 12px; color: var(--text-muted); }

  /* ── Connected state ── */
  .connected-bar {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .role-badge {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    background: var(--bg-hover);
    color: var(--text-muted);
  }
  .role-badge.host {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    color: var(--accent);
  }
  .meta {
    font-size: 11px;
    color: var(--text-muted);
  }
  .user-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .user-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    background: var(--bg-primary);
    border-radius: 10px;
    font-size: 11px;
    color: var(--text-primary);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .error-msg {
    font-size: 11px;
    color: #f38ba8;
    padding: 4px 8px;
    background: rgba(243,139,168,0.1);
    border-radius: 4px;
  }

  /* ── Chat ── */
  .chat-messages {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-height: 80px;
    max-height: 280px;
    overflow-y: auto;
  }
  .empty {
    color: var(--text-muted);
    font-size: 11px;
    text-align: center;
    padding: 16px 0;
  }
  .msg {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 2px 0;
  }
  .msg.own .msg-who { color: var(--accent); }
  .msg-who {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  .msg-txt {
    font-size: 12px;
    color: var(--text-primary);
    word-break: break-word;
    flex: 1;
  }
  .msg-ts {
    font-size: 9px;
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .chat-bar {
    display: flex;
    gap: 4px;
    border-top: 1px solid var(--border-color);
    padding-top: 6px;
  }
  .chat-input { flex: 1; }
  .send-btn {
    width: 28px;
    height: 28px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    color: var(--bg-primary);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
    font-size: 14px;
    font-weight: 700;
  }
  .send-btn:hover { filter: brightness(1.1); }
  .send-btn:disabled { opacity: 0.35; cursor: default; filter: none; }

  /* ── Snapshots ── */
  .snap-create {
    display: flex;
    gap: 4px;
  }
  .snap-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 220px;
    overflow-y: auto;
  }
  .snap-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 6px;
    border-radius: 4px;
    background: var(--bg-primary);
  }
  .snap-row:hover { background: var(--bg-hover); }
  .snap-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .snap-name {
    font-size: 12px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .snap-time {
    font-size: 10px;
    color: var(--text-muted);
  }
  .icon-btn {
    width: 24px;
    height: 24px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--text-muted);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .icon-btn:hover { color: var(--accent); background: var(--bg-hover); }
  .icon-btn:disabled { opacity: 0.35; cursor: default; }
</style>
