<script lang="ts">
  import { onMount } from 'svelte'
  import { getActiveTool, setActiveTool, subscribe as toolSubscribe } from '../../lib/stores/tool-store'
  import { getHistory, undo, redo } from '../../lib/stores/history-store'
  import { getZoomPercentLabel, subscribe as uiSubscribe } from '../../lib/stores/ui-store'
  import { getMap, createNewMap } from '../../lib/stores/map-store'
  import { matchesKey, formatKey, getKey, subscribe as kbSubscribe } from '../../lib/stores/keybindings-store'
  import type { ToolType } from '../../lib/stores/tool-store'

  let activeTool = $state<ToolType>('paint')
  let canUndo = $state(false)
  let canRedo = $state(false)
  let zoomLabel = $state('100%')
  let showNewMapDialog = $state(false)

  type ToolDef = { type: ToolType; label: string; bindingId: string; viewBox: string; path: string }

  const tileTools: ToolDef[] = [
    { type: 'paint', label: 'Paint', bindingId: 'tool.paint', viewBox: '0 0 576 512',
      path: 'M339.3 367.1c27.3-3.9 51.9-19.4 67.2-42.9L568.2 74.1c12.6-19.5 9.4-45.3-7.6-61.2S517.7-4.4 499.1 9.6L262.4 187.2c-24 18-38.2 46.1-38.4 76.1L339.3 367.1zm-19.6 25.4l-116-104.4C143.9 290.3 96 339.6 96 400c0 3.9 .2 7.8 .6 11.6C98.4 429.1 86.4 448 68.8 448H64c-17.7 0-32 14.3-32 32s14.3 32 32 32H208c61.9 0 112-50.1 112-112c0-2.5-.1-5-.2-7.5z' },
    { type: 'eraser', label: 'Eraser', bindingId: 'tool.eraser', viewBox: '0 0 576 512',
      path: 'M290.7 57.4L57.4 290.7c-25 25-25 65.5 0 90.5l80 80c12 12 28.3 18.7 45.3 18.7H288h9.4H512c17.7 0 32-14.3 32-32s-14.3-32-32-32H387.9L518.6 285.3c25-25 25-65.5 0-90.5L381.3 57.4c-25-25-65.5-25-90.5 0zM297.4 416H288l-105.4 0-80-80L227.3 211.3 364.7 348.7 297.4 416z' },
    { type: 'fill', label: 'Fill', bindingId: 'tool.fill', viewBox: '0 0 576 512',
      path: 'M41.4 9.4C53.9-3.1 74.1-3.1 86.6 9.4L168 90.7l53.1-53.1c28.1-28.1 73.7-28.1 101.8 0L474.3 189.1c28.1 28.1 28.1 73.7 0 101.8L283.9 481.4c-37.5 37.5-98.3 37.5-135.8 0L30.6 363.9c-37.5-37.5-37.5-98.3 0-135.8L122.7 136 41.4 54.6c-12.5-12.5-12.5-32.8 0-45.3zm176 221.3L168 181.3 75.9 273.4c-4.2 4.2-7 9.3-8.4 14.6H386.7l42.3-42.3c3.1-3.1 3.1-8.2 0-11.3L277.7 82.9c-3.1-3.1-8.2-3.1-11.3 0L213.3 136l49.4 49.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0zM512 512c-35.3 0-64-28.7-64-64c0-25.2 32.6-79.6 51.2-108.7c6-9.4 19.5-9.4 25.5 0C543.4 368.4 576 422.8 576 448c0 35.3-28.7 64-64 64z' },
    { type: 'select', label: 'Select', bindingId: 'tool.select', viewBox: '0 0 320 512',
      path: 'M0 55.2V426c0 12.2 9.9 22 22 22c6.3 0 12.4-2.7 16.6-7.5L121.2 346l58.1 116.3c7.9 15.8 27.1 22.2 42.9 14.3s22.2-27.1 14.3-42.9L179.8 320H297.9c12.2 0 22.1-9.9 22.1-22.1c0-6.3-2.7-12.3-7.4-16.5L38.6 37.9C34.3 34.1 28.9 32 23.2 32C10.4 32 0 42.4 0 55.2z' },
  ]

  const objectTools: ToolDef[] = [
    { type: 'object', label: 'Object', bindingId: 'tool.object', viewBox: '0 0 512 512',
      path: 'M234.5 5.7c13.9-5 29.1-5 43.1 0l192 68.6C495 83.4 512 107.5 512 134.6V377.4c0 27-17 51.2-42.5 60.3l-192 68.6c-13.9 5-29.1 5-43.1 0l-192-68.6C17 428.6 0 404.5 0 377.4V134.6c0-27 17-51.2 42.5-60.3l192-68.6zM256 66L82.3 128 256 190l173.7-62L256 66zm32 368.6l160-57.1v-188L288 246.6v188z' },
    { type: 'zone', label: 'Zone', bindingId: 'tool.zone', viewBox: '0 0 448 512',
      path: 'M96 151.4V360.6c9.7 5.6 17.8 13.7 23.4 23.4H328.6c0-.1 .1-.2 .1-.3l-4.5-7.9-32-56 0 0c-1.4 .1-2.8 .1-4.2 .1c-35.3 0-64-28.7-64-64s28.7-64 64-64c1.4 0 2.8 0 4.2 .1l0 0 32-56 4.5-7.9-.1-.3H119.4c-5.6 9.7-13.7 17.8-23.4 23.4zM384.3 352c35.2 .2 63.7 28.7 63.7 64c0 35.3-28.7 64-64 64c-23.7 0-44.4-12.9-55.4-32H119.4c-11.1 19.1-31.7 32-55.4 32c-35.3 0-64-28.7-64-64c0-23.7 12.9-44.4 32-55.4V151.4C12.9 140.4 0 119.7 0 96C0 60.7 28.7 32 64 32c23.7 0 44.4 12.9 55.4 32H328.6c11.1-19.1 31.7-32 55.4-32c35.3 0 64 28.7 64 64c0 35.3-28.5 63.8-63.7 64l-4.5 7.9-32 56-2.3 4c4.2 8.5 6.5 18 6.5 28.1s-2.3 19.6-6.5 28.1l2.3 4 32 56 4.5 7.9z' },
    { type: 'collision', label: 'Collision', bindingId: 'tool.collision', viewBox: '0 0 512 512',
      path: 'M256 0c4.6 0 9.2 1 13.4 2.9L457.7 82.8c22 9.3 38.4 31 38.3 57.2c-.5 99.2-41.3 280.7-213.6 363.2c-16.7 8-36.1 8-52.8 0C57.3 420.7 16.5 239.2 16 140c-.1-26.2 16.3-47.9 38.3-57.2L242.7 2.9C246.8 1 251.4 0 256 0zm0 66.8V444.8C394 378 431.1 230.1 432 141.4L256 66.8z' },
    { type: 'sketch', label: 'Sketch', bindingId: 'tool.sketch', viewBox: '0 0 512 512',
      path: 'M362.7 19.3L314.3 67.7 444.3 197.7l48.4-48.4c25-25 25-65.5 0-90.5L453.3 19.3c-25-25-65.5-25-90.5 0zm-71 71L58.6 323.5c-10.4 10.4-18 23.3-22.2 37.4L1 481.2C-1.5 489.7 .8 498.8 7 505s15.3 8.5 23.7 6.1l120.3-35.4c14.1-4.2 27-11.8 37.4-22.2L421.7 220.3 291.7 90.3z' },
    { type: 'stamp' as ToolType, label: 'Stamp', bindingId: 'tool.stamp', viewBox: '0 0 512 512',
      path: 'M312 201l-12-1c-26-4-46-26-46-52V32c0-18-14-32-32-32h-32c-18 0-32 14-32 32v116c0 26-20 48-46 52l-12 1C53 209 16 251 16 301v11c0 18 14 32 32 32h104v80H64c-18 0-32 14-32 32v24c0 18 14 32 32 32h288c18 0 32-14 32-32v-24c0-18-14-32-32-32H264v-80h104c18 0 32-14 32-32v-11c0-50-37-92-88-100z' },
  ]

  function selectTool(type: ToolType) {
    setActiveTool(type)
  }

  function handleNewMap() {
    showNewMapDialog = true
    window.dispatchEvent(new CustomEvent('show-new-map-dialog'))
  }

  let toolKeyLabels = $state<Record<string, string>>({})

  function updateKeyLabels() {
    const labels: Record<string, string> = {}
    for (const tool of [...tileTools, ...objectTools]) {
      labels[tool.type] = formatKey(getKey(tool.bindingId))
    }
    toolKeyLabels = labels
  }

  onMount(() => {
    updateKeyLabels()
    const unsub1 = toolSubscribe(() => { activeTool = getActiveTool() })
    const unsub2 = getHistory().subscribe(() => {
      canUndo = getHistory().canUndo
      canRedo = getHistory().canRedo
    })
    const unsub3 = uiSubscribe(() => { zoomLabel = `${getZoomPercentLabel()}%` })
    const unsub4 = kbSubscribe(() => { updateKeyLabels() })

    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if (e.ctrlKey && (e.key === 'Z' || e.key === 'y')) { e.preventDefault(); redo() }
      else if (matchesKey('tool.paint', e)) setActiveTool('paint')
      else if (matchesKey('tool.eraser', e)) setActiveTool('eraser')
      else if (matchesKey('tool.fill', e)) setActiveTool('fill')
      else if (matchesKey('tool.select', e)) setActiveTool('select')
      else if (matchesKey('tool.object', e)) setActiveTool('object')
      else if (matchesKey('tool.zone', e)) setActiveTool('zone')
      else if (matchesKey('tool.collision', e)) setActiveTool('collision')
      else if (matchesKey('tool.sketch', e)) setActiveTool('sketch')
      else if (e.ctrlKey && e.key === 'n') { e.preventDefault(); handleNewMap() }
    }
    window.addEventListener('keydown', handleKeyDown)

    return () => { unsub1(); unsub2(); unsub3(); unsub4(); window.removeEventListener('keydown', handleKeyDown) }
  })
</script>

<div class="toolbar">
  <button class="new-map-btn" title="New Map (Ctrl+N)" onclick={handleNewMap}>
    <svg class="new-icon" width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
    New
  </button>

  <div class="separator"></div>

  <div class="tool-group">
    {#each tileTools as tool}
      <button
        class:active={activeTool === tool.type}
        title="{tool.label} ({toolKeyLabels[tool.type] || formatKey(getKey(tool.bindingId))})"
        onclick={() => selectTool(tool.type)}
      >
        <svg class="tool-icon" viewBox={tool.viewBox} fill="currentColor"><path d={tool.path}/></svg>
      </button>
    {/each}
  </div>

  <div class="separator"></div>

  <div class="tool-group">
    {#each objectTools as tool}
      <button
        class:active={activeTool === tool.type}
        title="{tool.label} ({toolKeyLabels[tool.type] || formatKey(getKey(tool.bindingId))})"
        onclick={() => selectTool(tool.type)}
      >
        <svg class="tool-icon" viewBox={tool.viewBox} fill="currentColor"><path d={tool.path}/></svg>
      </button>
    {/each}
  </div>

  <div class="separator"></div>

  <div class="tool-group">
    <button title="Undo (Ctrl+Z)" disabled={!canUndo} onclick={() => undo()}>
      <svg class="tool-icon" viewBox="0 0 512 512" fill="currentColor"><path d="M48.5 224H40c-13.3 0-24-10.7-24-24V72c0-9.7 5.8-18.5 14.8-22.2s19.3-1.7 26.2 5.2L98.6 96.6c87.6-86.5 228.7-86.2 315.8 1c87.5 87.5 87.5 229.3 0 316.8s-229.3 87.5-316.8 0c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0c62.5 62.5 163.8 62.5 226.3 0s62.5-163.8 0-226.3c-62.2-62.2-162.7-62.5-225.3-1L185 183c6.9 6.9 8.9 17.2 5.2 26.2s-12.5 14.8-22.2 14.8H48.5z"/></svg>
    </button>
    <button title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onclick={() => redo()}>
      <svg class="tool-icon" viewBox="0 0 512 512" fill="currentColor"><path d="M463.5 224H472c13.3 0 24-10.7 24-24V72c0-9.7-5.8-18.5-14.8-22.2s-19.3-1.7-26.2 5.2L413.4 96.6c-87.6-86.5-228.7-86.2-315.8 1c-87.5 87.5-87.5 229.3 0 316.8s229.3 87.5 316.8 0c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0c-62.5 62.5-163.8 62.5-226.3 0s-62.5-163.8 0-226.3c62.2-62.2 162.7-62.5 225.3-1L327 183c-6.9 6.9-8.9 17.2-5.2 26.2s12.5 14.8 22.2 14.8H463.5z"/></svg>
    </button>
  </div>

  <div class="spacer"></div>

  <div class="tool-group">
    <span class="zoom-label">{zoomLabel}</span>
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    height: var(--toolbar-height);
    padding: 0 8px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    gap: 4px;
  }

  .tool-group {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .separator {
    width: 1px;
    height: 20px;
    background: var(--border-color);
    margin: 0 6px;
  }

  .spacer {
    flex: 1;
  }

  .toolbar button {
    width: 32px;
    height: 28px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .new-map-btn {
    width: auto !important;
    padding: 0 10px !important;
    gap: 5px;
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--accent);
    background: transparent;
    border: 1px solid var(--accent);
  }

  .new-map-btn:hover {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
  }

  .new-icon {
    flex-shrink: 0;
  }

  .toolbar button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .tool-icon {
    width: 14px;
    height: 14px;
  }

  .zoom-label {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    min-width: 40px;
    text-align: center;
  }
</style>
