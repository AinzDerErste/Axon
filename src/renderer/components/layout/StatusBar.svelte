<script lang="ts">
  import { onMount } from 'svelte'
  import { getHover, getZoomPercentLabel, subscribe as uiSubscribe } from '../../lib/stores/ui-store'
  import { getMap, getActiveLayer, subscribe as mapSubscribe } from '../../lib/stores/map-store'

  let hoverText = $state('Tile: (-,-)')
  let layerText = $state('Layer: -')
  let zoomText = $state('Zoom: 100%')
  let mapText = $state('No map')
  let tileStats = $state('')

  let cpuText = $state('CPU: --%')
  let ramText = $state('RAM: --MB')
  let gpuText = $state('GPU: --MB')

  let toastVisible = $state(false)
  let toastTimer: ReturnType<typeof setTimeout> | null = null

  function showSaveToast() {
    toastVisible = true
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toastVisible = false }, 2500)
  }

  onMount(() => {
    const unsub1 = uiSubscribe(() => {
      const h = getHover()
      hoverText = h.col >= 0 ? `Tile: (${h.col}, ${h.row})` : 'Tile: (-,-)'
      zoomText = `Zoom: ${getZoomPercentLabel()}%`
    })
    const unsub2 = mapSubscribe(() => {
      const map = getMap()
      const layer = getActiveLayer()
      layerText = layer ? `Layer: ${layer.name}` : 'Layer: -'
      mapText = map ? `Map: ${map.config.gridWidth}×${map.config.gridHeight}` : 'No map'

      // Compute tile/object/zone statistics
      if (map) {
        let tiles = 0, objects = 0, zones = 0
        for (const l of map.layers) {
          if (l.type === 'tile') {
            for (const row of l.data) {
              for (const cell of row) { if (cell) tiles++ }
            }
          } else if (l.type === 'object') {
            objects += l.objects.length
            zones += l.zones.length
          }
        }
        const parts: string[] = []
        parts.push(`Tiles: ${tiles}`)
        if (objects > 0) parts.push(`Obj: ${objects}`)
        if (zones > 0) parts.push(`Zones: ${zones}`)
        tileStats = parts.join(' | ')
      } else {
        tileStats = ''
      }
    })

    function handleProjectSaved() { showSaveToast() }
    window.addEventListener('project-saved', handleProjectSaved)

    async function updateMetrics() {
      try {
        const m = await window.electronAPI?.getSystemMetrics()
        if (!m) return
        cpuText = `CPU: ${m.cpuPercent}%`
        ramText = `RAM: ${m.appMemoryMB}MB / ${Math.round(m.systemMemUsedMB / 1024 * 10) / 10}/${Math.round(m.systemMemTotalMB / 1024 * 10) / 10}GB`
        gpuText = m.gpuMemMB > 0 ? `GPU: ${m.gpuMemMB}MB` : 'GPU: --'
      } catch { /* ignore */ }
    }

    updateMetrics()
    const interval = setInterval(updateMetrics, 2000)

    return () => {
      unsub1(); unsub2(); clearInterval(interval)
      window.removeEventListener('project-saved', handleProjectSaved)
      if (toastTimer) clearTimeout(toastTimer)
    }
  })
</script>

<div class="statusbar">
  <div class="status-left">
    <span class="status-item">{hoverText}</span>
    <span class="status-item">{layerText}</span>
    <span class="status-item">{zoomText}</span>
    <span class="status-item">{mapText}</span>
    {#if tileStats}
      <span class="status-item">{tileStats}</span>
    {/if}
  </div>
  <div class="status-right">
    <span class="status-item metric">{cpuText}</span>
    <span class="status-item metric">{ramText}</span>
    <span class="status-item metric">{gpuText}</span>
  </div>
</div>

{#if toastVisible}
  <div class="save-toast" class:toast-exit={!toastVisible}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
    Project saved
  </div>
{/if}

<style>
  .statusbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--statusbar-height);
    padding: 0 12px;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border-color);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .status-left,
  .status-right {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .status-item {
    white-space: nowrap;
  }

  .metric {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .save-toast {
    position: fixed;
    bottom: 36px;
    left: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    color: #a6e3a1;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    animation: toast-in 0.25s ease-out, toast-out 0.4s ease-in 2.1s forwards;
    pointer-events: none;
    z-index: 900;
  }

  @keyframes toast-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes toast-out {
    from { opacity: 1; transform: translateY(0); }
    to { opacity: 0; transform: translateY(4px); }
  }
</style>
