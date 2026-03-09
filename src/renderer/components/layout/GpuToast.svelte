<script lang="ts">
  import { onMount } from 'svelte'

  let visible = $state(false)
  let accelerated = $state(false)
  let gpuName = $state('')
  let featureDetail = $state('')

  onMount(() => {
    window.electronAPI?.getGpuStatus?.().then((status) => {
      if (!status) return
      accelerated = status.accelerated
      gpuName = status.gpuName || ''

      const parts: string[] = []
      if (status.features.compositing)
        parts.push(`Compositing: ${status.features.compositing}`)
      if (status.features.rasterization)
        parts.push(`Rasterization: ${status.features.rasterization}`)
      if (status.features.canvas && status.features.canvas !== 'unknown')
        parts.push(`Canvas: ${status.features.canvas}`)
      featureDetail = parts.join(' · ')

      visible = true
      setTimeout(() => { visible = false }, 4500)
    })
  })
</script>

{#if visible}
  <div class="gpu-toast" class:gpu={accelerated} class:cpu={!accelerated}>
    <div class="toast-row">
      {#if accelerated}
        <svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="2"/>
          <rect x="9" y="9" width="6" height="6"/>
          <path d="M15 2v2M9 2v2M15 20v2M9 20v2M2 15h2M2 9h2M20 15h2M20 9h2"/>
        </svg>
        <div class="toast-text">
          <span class="toast-title">GPU Beschleunigung aktiv</span>
          {#if gpuName}
            <span class="toast-sub">{gpuName}</span>
          {/if}
        </div>
      {:else}
        <svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="2"/>
          <line x1="8" y1="8" x2="16" y2="16"/>
          <line x1="16" y1="8" x2="8" y2="16"/>
        </svg>
        <div class="toast-text">
          <span class="toast-title">CPU Modus (keine GPU Beschleunigung)</span>
        </div>
      {/if}
    </div>
    {#if featureDetail}
      <span class="toast-features">{featureDetail}</span>
    {/if}
  </div>
{/if}

<style>
  .gpu-toast {
    position: fixed;
    bottom: 36px;
    left: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 14px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    z-index: 900;
    min-width: 200px;
    animation: gpu-toast-in 0.3s ease-out, gpu-toast-out 0.4s ease-in 4.1s forwards;
    pointer-events: none;
  }

  .gpu-toast.gpu {
    border-color: #a6e3a1;
  }

  .gpu-toast.cpu {
    border-color: #f9e2af;
  }

  .toast-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .toast-icon {
    flex-shrink: 0;
  }

  .gpu .toast-icon {
    color: #a6e3a1;
  }

  .cpu .toast-icon {
    color: #f9e2af;
  }

  .toast-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .toast-title {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .toast-sub {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 260px;
  }

  .toast-features {
    font-size: 10px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding-left: 24px;
  }

  @keyframes gpu-toast-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes gpu-toast-out {
    from { opacity: 1; transform: translateY(0); }
    to { opacity: 0; transform: translateY(4px); }
  }
</style>
