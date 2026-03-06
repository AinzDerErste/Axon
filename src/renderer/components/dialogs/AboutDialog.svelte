<script lang="ts">
  import { onMount } from 'svelte'
  import appIcon from '../../assets/icon.png'

  interface Props {
    show: boolean
  }

  let { show = $bindable() }: Props = $props()

  let appVersion = $state('...')

  $effect(() => {
    if (show) {
      window.electronAPI?.getAppVersion?.().then((v: string) => {
        appVersion = v
      }).catch(() => {
        appVersion = 'dev'
      })
    }
  })

  function handleClose() {
    show = false
  }

  function handleCheckUpdates() {
    window.dispatchEvent(new CustomEvent('update:check'))
    show = false
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') handleClose()
  }
</script>

{#if show}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" onkeydown={handleKeydown}>
    <div class="dialog">
      <div class="about-header">
        <img src={appIcon} alt="Axon" class="about-logo" />
        <div class="about-title-block">
          <span class="about-name">Axon</span>
          <span class="about-version">v{appVersion}</span>
        </div>
      </div>

      <div class="about-description">
        A powerful 2D map editor for game developers.
      </div>

      <div class="separator"></div>

      <div class="about-actions">
        <button class="about-update-btn" onclick={handleCheckUpdates}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 1v4l2 1"/>
            <path d="M1.5 7a5.5 5.5 0 1 0 1-3.2"/>
            <path d="M1 1v3h3"/>
          </svg>
          Nach Updates suchen
        </button>
      </div>

      <div class="separator"></div>

      <div class="about-info">
        <div class="about-info-row">
          <span class="about-info-label">Electron</span>
          <span class="about-info-value">{(window as any).electronAPI?.versions?.electron ?? '—'}</span>
        </div>
        <div class="about-info-row">
          <span class="about-info-label">Chrome</span>
          <span class="about-info-value">{(window as any).electronAPI?.versions?.chrome ?? '—'}</span>
        </div>
        <div class="about-info-row">
          <span class="about-info-label">Node</span>
          <span class="about-info-value">{(window as any).electronAPI?.versions?.node ?? '—'}</span>
        </div>
      </div>

      <div class="separator"></div>

      <div class="about-footer">
        <span class="about-copyright">&copy; {new Date().getFullYear()} AinzDerErste</span>
        <button class="close-btn" onclick={handleClose}>Close</button>
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
    width: 360px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .about-header {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .about-logo {
    width: 48px;
    height: 48px;
    border-radius: var(--radius-md);
    object-fit: contain;
  }

  .about-title-block {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .about-name {
    font-size: 20px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .about-version {
    font-size: var(--font-size-sm);
    color: var(--accent);
    font-family: monospace;
    font-weight: 600;
  }

  .about-description {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .separator {
    height: 1px;
    background: var(--border-color);
  }

  .about-actions {
    display: flex;
    gap: 8px;
  }

  .about-update-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .about-update-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .about-info {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .about-info-row {
    display: flex;
    justify-content: space-between;
    font-size: var(--font-size-sm);
  }

  .about-info-label {
    color: var(--text-muted);
  }

  .about-info-value {
    color: var(--text-secondary);
    font-family: monospace;
  }

  .about-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .about-copyright {
    font-size: 11px;
    color: var(--text-muted);
  }

  .close-btn {
    padding: 6px 16px;
    font-size: var(--font-size-sm);
  }
</style>
