<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { collabStore } from '../../lib/collab/collab-store'
  import type { ChatMessage } from '../../lib/collab/collab-store'
  import * as collabClient from '../../lib/collab/collab-client'

  let messages = $state<ChatMessage[]>([])
  let connected = $state(false)
  let messageText = $state('')
  let messagesEl = $state<HTMLDivElement>(undefined!)
  let expanded = $state(true)

  onMount(() => {
    const unsub = collabStore.subscribe(() => {
      const newMessages = collabStore.getChatMessages()
      const wasAtBottom = messagesEl
        ? messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 30
        : true
      messages = newMessages
      connected = collabStore.getState().connected

      if (wasAtBottom && messagesEl) {
        tick().then(() => {
          messagesEl.scrollTop = messagesEl.scrollHeight
        })
      }
    })
    return unsub
  })

  function sendMessage() {
    const text = messageText.trim()
    if (!text) return
    collabClient.sendChat(text)
    messageText = ''
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function formatTime(ts: number): string {
    const d = new Date(ts)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }
</script>

<div class="panel">
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="panel-header" onclick={() => expanded = !expanded}>
    <span class="panel-title">
      <span class="chevron" class:open={expanded}>&#9656;</span>
      Chat
    </span>
    {#if messages.length > 0}
      <span class="badge">{messages.length}</span>
    {/if}
  </div>

  {#if expanded}
    <div class="chat-body">
      <div class="messages" bind:this={messagesEl}>
        {#if messages.length === 0}
          <div class="empty-chat">Keine Nachrichten</div>
        {:else}
          {#each messages as msg (msg.ts + msg.sender)}
            <div class="message" class:own={msg.sender === collabClient.getUserId()}>
              <div class="msg-header">
                <span class="msg-name">{msg.name}</span>
                <span class="msg-time">{formatTime(msg.ts)}</span>
              </div>
              <div class="msg-text">{msg.text}</div>
            </div>
          {/each}
        {/if}
      </div>

      {#if connected}
        <div class="input-row">
          <input
            type="text"
            class="chat-input"
            bind:value={messageText}
            placeholder="Nachricht..."
            onkeydown={handleKeyDown}
          />
          <button class="send-btn" onclick={sendMessage} disabled={!messageText.trim()} title="Senden">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>
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

  .badge {
    font-size: 10px;
    background: var(--accent);
    color: var(--bg-primary);
    padding: 1px 6px;
    border-radius: 8px;
    font-weight: 600;
  }

  .chat-body {
    display: flex;
    flex-direction: column;
    max-height: 250px;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 60px;
    max-height: 200px;
  }

  .empty-chat {
    color: var(--text-muted);
    font-size: 11px;
    text-align: center;
    padding: 12px 0;
  }

  .message {
    padding: 3px 6px;
    border-radius: var(--radius-sm);
    background: var(--bg-primary);
  }

  .message.own {
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-primary));
  }

  .msg-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }

  .msg-name {
    font-size: 10px;
    font-weight: 600;
    color: var(--accent);
  }

  .msg-time {
    font-size: 9px;
    color: var(--text-muted);
  }

  .msg-text {
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    word-break: break-word;
  }

  .input-row {
    display: flex;
    gap: 4px;
    padding: 4px 8px 6px;
    border-top: 1px solid var(--border-color);
  }

  .chat-input {
    flex: 1;
    padding: 4px 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
  }

  .chat-input:focus {
    border-color: var(--accent);
    outline: none;
  }

  .chat-input::placeholder {
    color: var(--text-muted);
  }

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
    border-radius: var(--radius-sm);
    cursor: pointer;
    flex-shrink: 0;
  }

  .send-btn:hover {
    filter: brightness(1.1);
  }

  .send-btn:disabled {
    opacity: 0.4;
    cursor: default;
    filter: none;
  }
</style>
