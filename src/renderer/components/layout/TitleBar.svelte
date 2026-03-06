<script lang="ts">
  import { onMount } from 'svelte'
  import appIcon from '../../assets/icon.png'

  interface MenuItem {
    label: string
    action?: string
    accelerator?: string
    separator?: boolean
    role?: string
  }

  interface Menu {
    label: string
    items: MenuItem[]
  }

  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'New Map', action: 'new-map', accelerator: 'Ctrl+N' },
        { label: 'Open...', action: 'open', accelerator: 'Ctrl+O' },
        { separator: true, label: '' },
        { label: 'Save', action: 'save', accelerator: 'Ctrl+S' },
        { label: 'Save As...', action: 'save-as', accelerator: 'Ctrl+Shift+S' },
        { separator: true, label: '' },
        { label: 'Export as PNG...', action: 'export-png' },
        { label: 'Export as JSON...', action: 'export-json' },
        { label: 'Export as TMX (Tiled)...', action: 'export-tmx' },
        { label: 'Export for Godot (.tscn)...', action: 'export-godot' },
        { separator: true, label: '' },
        { label: 'Quit', role: 'quit', accelerator: 'Ctrl+Q' }
      ]
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', action: 'undo', accelerator: 'Ctrl+Z' },
        { label: 'Redo', action: 'redo', accelerator: 'Ctrl+Shift+Z' },
        { separator: true, label: '' },
        { label: 'Map Properties\u2026', action: 'map-properties' },
        { separator: true, label: '' },
        { label: 'Settings\u2026', action: 'settings' }
      ]
    },
    {
      label: 'View',
      items: [
        { label: 'Toggle Grid', action: 'toggle-grid', accelerator: 'Ctrl+G' },
        { separator: true, label: '' },
        { label: 'Reload', role: 'reload', accelerator: 'Ctrl+R' }
      ]
    }
  ]

  interface Props {
    title?: string
    onaction?: (action: string) => void
  }

  let { title = 'Axon', onaction }: Props = $props()

  let openMenuIndex = $state(-1)
  let isMaximized = $state(false)
  let menuBarEl: HTMLDivElement | undefined = $state()

  onMount(() => {
    window.electronAPI?.isMaximized().then(m => { isMaximized = m })
    window.electronAPI?.onMaximizedChange(m => { isMaximized = m })

    function handleClickOutside(e: MouseEvent) {
      if (openMenuIndex >= 0 && menuBarEl && !menuBarEl.contains(e.target as Node)) {
        openMenuIndex = -1
      }
    }
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') openMenuIndex = -1
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeydown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeydown)
    }
  })

  function toggleMenu(index: number) {
    openMenuIndex = openMenuIndex === index ? -1 : index
  }

  function handleMenuHover(index: number) {
    if (openMenuIndex >= 0) openMenuIndex = index
  }

  function handleItemClick(item: MenuItem) {
    openMenuIndex = -1
    if (item.action && onaction) {
      onaction(item.action)
    } else if (item.role === 'quit') {
      window.electronAPI?.closeWindow()
    }
  }

  function handleMinimize() { window.electronAPI?.minimizeWindow() }
  function handleMaximize() { window.electronAPI?.maximizeWindow() }
  function handleClose() { window.electronAPI?.closeWindow() }
</script>

<div class="titlebar">
  <div class="menu-area" bind:this={menuBarEl}>
    {#each menus as menu, i}
      <div class="menu-wrapper">
        <button
          class="menu-btn"
          class:open={openMenuIndex === i}
          onmousedown={() => toggleMenu(i)}
          onmouseenter={() => handleMenuHover(i)}
        >{menu.label}</button>
        {#if openMenuIndex === i}
          <div class="dropdown">
            {#each menu.items as item}
              {#if item.separator}
                <div class="dropdown-separator"></div>
              {:else}
                <button class="dropdown-item" onmousedown={() => handleItemClick(item)}>
                  <span class="item-label">{item.label}</span>
                  {#if item.accelerator}
                    <span class="item-accel">{item.accelerator}</span>
                  {/if}
                </button>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <div class="title-area">
    <img src={appIcon} alt="" class="title-icon" />
    <span class="title">{title}</span>
  </div>

  <div class="window-controls">
    <button class="win-btn" title="Minimize" onclick={handleMinimize}>
      <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
    </button>
    <button class="win-btn" title={isMaximized ? 'Restore' : 'Maximize'} onclick={handleMaximize}>
      {#if isMaximized}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1">
          <rect x="2" y="0.5" width="7" height="7" rx="0.5"/>
          <rect x="0.5" y="2.5" width="7" height="7" rx="0.5"/>
        </svg>
      {:else}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1">
          <rect x="0.5" y="0.5" width="9" height="9" rx="0.5"/>
        </svg>
      {/if}
    </button>
    <button class="win-btn close-btn" title="Close" onclick={handleClose}>
      <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.2">
        <line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/>
      </svg>
    </button>
  </div>
</div>

<style>
  .titlebar {
    display: flex;
    align-items: center;
    height: 32px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    -webkit-app-region: drag;
    user-select: none;
    flex-shrink: 0;
  }

  .menu-area {
    display: flex;
    -webkit-app-region: no-drag;
    height: 100%;
  }

  .menu-wrapper {
    position: relative;
    height: 100%;
  }

  .menu-btn {
    height: 100%;
    padding: 0 10px;
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    font-family: var(--font-family);
    cursor: pointer;
    border-radius: 0;
  }

  .menu-btn:hover,
  .menu-btn.open {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    min-width: 220px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 0 0 var(--radius-sm) var(--radius-sm);
    padding: 4px 0;
    z-index: 9999;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .dropdown-separator {
    height: 1px;
    background: var(--border-color);
    margin: 4px 8px;
  }

  .dropdown-item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 6px 12px;
    background: none;
    border: none;
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-family: var(--font-family);
    cursor: pointer;
    text-align: left;
    border-radius: 0;
  }

  .dropdown-item:hover {
    background: var(--accent);
    color: var(--bg-primary);
  }

  .item-label {
    flex: 1;
  }

  .item-accel {
    margin-left: 24px;
    color: var(--text-muted);
    font-size: 11px;
  }

  .dropdown-item:hover .item-accel {
    color: var(--bg-primary);
    opacity: 0.7;
  }

  .title-area {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    overflow: hidden;
  }

  .title-icon {
    width: 16px;
    height: 16px;
    object-fit: contain;
    flex-shrink: 0;
  }

  .title {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
  }

  .window-controls {
    display: flex;
    -webkit-app-region: no-drag;
    height: 100%;
  }

  .win-btn {
    width: 46px;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 0;
  }

  .win-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .close-btn:hover {
    background: var(--danger);
    color: #fff;
  }
</style>
