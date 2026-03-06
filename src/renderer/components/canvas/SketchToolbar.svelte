<script lang="ts">
  import { onMount } from 'svelte'
  import { getActiveTool, subscribe as toolSubscribe } from '../../lib/stores/tool-store'
  import {
    getSketchSettings, setSketchSubTool, setSketchColor,
    setSketchStrokeWidth, setSketchFill, setSketchFontSize,
    subscribe as sketchSubscribe
  } from '../../lib/stores/sketch-store'
  import type { SketchSubTool } from '../../lib/stores/sketch-store'

  let visible = $state(false)
  let subTool = $state<SketchSubTool>('pencil')
  let color = $state('#f38ba8')
  let strokeWidth = $state(3)
  let fill = $state(false)
  let fontSize = $state(24)

  const subTools: { id: SketchSubTool; label: string; icon: string }[] = [
    { id: 'pencil', label: 'Pencil', icon: '✏️' },
    { id: 'line', label: 'Line', icon: '—' },
    { id: 'arrow', label: 'Arrow', icon: '→' },
    { id: 'rect', label: 'Rectangle', icon: '□' },
    { id: 'ellipse', label: 'Ellipse', icon: '○' },
    { id: 'text', label: 'Text', icon: 'T' }
  ]

  onMount(() => {
    const unsub1 = toolSubscribe(() => {
      visible = getActiveTool() === 'sketch'
    })
    const unsub2 = sketchSubscribe(() => {
      const s = getSketchSettings()
      subTool = s.subTool
      color = s.color
      strokeWidth = s.strokeWidth
      fill = s.fill
      fontSize = s.fontSize
    })
    visible = getActiveTool() === 'sketch'
    const s = getSketchSettings()
    subTool = s.subTool
    color = s.color
    strokeWidth = s.strokeWidth
    fill = s.fill
    fontSize = s.fontSize

    return () => { unsub1(); unsub2() }
  })
</script>

{#if visible}
  <div class="sketch-toolbar">
    <div class="sub-tools">
      {#each subTools as st}
        <button
          class="sub-tool-btn"
          class:active={subTool === st.id}
          class:text-btn={st.id === 'text'}
          title={st.label}
          onclick={() => setSketchSubTool(st.id)}
        >
          {st.icon}
        </button>
      {/each}
    </div>

    <div class="separator"></div>

    <label class="color-pick" title="Stroke Color">
      <input
        type="color"
        value={color}
        oninput={(e) => setSketchColor((e.target as HTMLInputElement).value)}
      />
      <span class="color-swatch" style="background:{color}"></span>
    </label>

    {#if subTool === 'text'}
      <div class="separator"></div>
      <label class="width-control" title="Font Size: {fontSize}px">
        <span class="control-icon">A</span>
        <input
          type="range"
          min="8"
          max="200"
          value={fontSize}
          oninput={(e) => setSketchFontSize(parseInt((e.target as HTMLInputElement).value))}
        />
        <span class="width-label">{fontSize}px</span>
      </label>
    {:else}
      <div class="separator"></div>
      <label class="width-control" title="Stroke Width: {strokeWidth}px">
        <span class="stroke-preview" style="width:{Math.max(4, strokeWidth)}px;height:{Math.max(4, strokeWidth)}px;background:{color}"></span>
        <input
          type="range"
          min="1"
          max="20"
          value={strokeWidth}
          oninput={(e) => setSketchStrokeWidth(parseInt((e.target as HTMLInputElement).value))}
        />
        <span class="width-label">{strokeWidth}px</span>
      </label>
    {/if}

    {#if subTool === 'rect' || subTool === 'ellipse'}
      <div class="separator"></div>
      <button
        class="sub-tool-btn"
        class:active={fill}
        title="Fill"
        onclick={() => setSketchFill(!fill)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
        </svg>
      </button>
    {/if}
  </div>
{/if}

<style>
  .sketch-toolbar {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 100;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    -webkit-app-region: no-drag;
  }

  .sub-tools {
    display: flex;
    gap: 2px;
  }

  .sub-tool-btn {
    width: 28px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 14px;
    padding: 0;
  }

  .sub-tool-btn.text-btn {
    font-weight: 700;
    font-family: serif;
  }

  .sub-tool-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .sub-tool-btn.active {
    background: var(--accent);
    color: var(--bg-primary);
    border-color: var(--accent);
  }

  .separator {
    width: 1px;
    height: 20px;
    background: var(--border-color);
    margin: 0 4px;
  }

  .color-pick {
    position: relative;
    cursor: pointer;
    display: flex;
    align-items: center;
  }

  .color-pick input[type="color"] {
    position: absolute;
    opacity: 0;
    width: 24px;
    height: 24px;
    cursor: pointer;
  }

  .color-swatch {
    width: 22px;
    height: 22px;
    border-radius: 4px;
    border: 2px solid var(--border-color);
    display: block;
  }

  .width-control {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  .stroke-preview {
    border-radius: 50%;
    flex-shrink: 0;
    max-width: 20px;
    max-height: 20px;
    min-width: 4px;
    min-height: 4px;
    transition: width 0.1s, height 0.1s;
  }

  .control-icon {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-secondary);
    min-width: 14px;
    text-align: center;
  }

  .width-control input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    width: 80px;
    height: 20px;
    background: transparent;
    cursor: pointer;
  }

  .width-control input[type="range"]::-webkit-slider-runnable-track {
    height: 4px;
    background: var(--border-color);
    border-radius: 2px;
  }

  .width-control input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    background: var(--accent);
    border-radius: 50%;
    border: none;
    margin-top: -5px;
    cursor: pointer;
  }

  .width-control input[type="range"]::-webkit-slider-thumb:hover {
    background: var(--accent-hover, var(--accent));
    transform: scale(1.15);
  }

  .width-label {
    font-size: 11px;
    color: var(--text-secondary);
    min-width: 28px;
    text-align: center;
  }
</style>
