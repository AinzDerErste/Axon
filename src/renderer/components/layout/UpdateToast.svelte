<script lang="ts">
  import { onMount } from 'svelte'

  type ToastState = 'hidden' | 'available' | 'downloading' | 'ready' | 'error' | 'up-to-date'

  let state = $state<ToastState>('hidden')
  let version = $state('')
  let percent = $state(0)
  let errorMsg = $state('')
  let manualCheck = $state(false)
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  function autoHide(ms: number) {
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => { state = 'hidden' }, ms)
  }

  onMount(() => {
    const api = window.electronAPI

    api?.onUpdateAvailable?.((info) => {
      version = info.version
      state = 'available'
      manualCheck = false
    })

    api?.onUpdateNotAvailable?.(() => {
      if (manualCheck) {
        state = 'up-to-date'
        autoHide(3000)
      }
      manualCheck = false
    })

    api?.onDownloadProgress?.((progress) => {
      percent = progress.percent
      state = 'downloading'
    })

    api?.onUpdateDownloaded?.(() => {
      state = 'ready'
    })

    api?.onUpdateError?.((msg) => {
      errorMsg = msg
      state = 'error'
      autoHide(5000)
    })

    function handleMenuAction(e: Event) {
      const action = (e as CustomEvent).detail
      if (action === 'check-for-updates') {
        handleCheckManually()
      }
    }
    window.addEventListener('update:check', handleCheckManually)
    window.addEventListener('menu-action-update', handleMenuAction)

    return () => {
      if (hideTimer) clearTimeout(hideTimer)
      window.removeEventListener('update:check', handleCheckManually)
      window.removeEventListener('menu-action-update', handleMenuAction)
    }
  })

  function handleCheckManually() {
    manualCheck = true
    state = 'hidden'
    window.electronAPI?.checkForUpdates?.()
  }

  function handleDownload() {
    state = 'downloading'
    percent = 0
    window.electronAPI?.downloadUpdate?.()
  }

  function handleInstall() {
    window.electronAPI?.installUpdate?.()
  }

  function handleDismiss() {
    state = 'hidden'
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
  }
</script>

{#if state !== 'hidden'}
  <div class="update-toast" class:error={state === 'error'}>
    {#if state === 'available'}
      <div class="toast-content">
        <svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <span class="toast-text">Axon <strong>v{version}</strong> verfügbar</span>
      </div>
      <div class="toast-actions">
        <button class="toast-btn primary" onclick={handleDownload}>Update</button>
        <button class="toast-btn dismiss" onclick={handleDismiss} title="Dismiss">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M2 2l8 8M10 2l-8 8"/>
          </svg>
        </button>
      </div>

    {:else if state === 'downloading'}
      <div class="toast-content">
        <div class="spinner"></div>
        <span class="toast-text">Downloading... {percent}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: {percent}%"></div>
      </div>

    {:else if state === 'ready'}
      <div class="toast-content">
        <svg class="toast-icon ready" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span class="toast-text">Update bereit</span>
      </div>
      <div class="toast-actions">
        <button class="toast-btn primary" onclick={handleInstall}>Neustarten</button>
        <button class="toast-btn dismiss" onclick={handleDismiss} title="Dismiss">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M2 2l8 8M10 2l-8 8"/>
          </svg>
        </button>
      </div>

    {:else if state === 'error'}
      <div class="toast-content">
        <svg class="toast-icon error-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
        <span class="toast-text">Update fehlgeschlagen</span>
      </div>

    {:else if state === 'up-to-date'}
      <div class="toast-content">
        <svg class="toast-icon ready" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span class="toast-text">Axon ist aktuell</span>
      </div>
    {/if}
  </div>
{/if}

<style>
  .update-toast {
    position: fixed;
    bottom: 36px;
    right: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 14px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    z-index: 900;
    min-width: 220px;
    animation: toast-slide-in 0.3s ease-out;
  }

  .update-toast.error {
    border-color: var(--danger);
  }

  @keyframes toast-slide-in {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .toast-content {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .toast-icon {
    color: var(--accent);
    flex-shrink: 0;
  }

  .toast-icon.ready {
    color: #a6e3a1;
  }

  .toast-icon.error-icon {
    color: var(--danger);
  }

  .toast-text {
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    white-space: nowrap;
  }

  .toast-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    justify-content: flex-end;
  }

  .toast-btn {
    padding: 4px 12px;
    font-size: var(--font-size-sm);
    border-radius: var(--radius-sm);
    cursor: pointer;
    border: 1px solid var(--border-color);
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .toast-btn.primary {
    background: var(--accent);
    color: var(--bg-primary);
    border-color: var(--accent);
    font-weight: 600;
  }

  .toast-btn.primary:hover {
    background: var(--accent-hover);
  }

  .toast-btn.dismiss {
    width: 24px;
    height: 24px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-muted);
  }

  .toast-btn.dismiss:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--text-muted);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .progress-bar {
    height: 3px;
    background: var(--bg-tertiary);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    transition: width 0.3s ease;
  }
</style>
