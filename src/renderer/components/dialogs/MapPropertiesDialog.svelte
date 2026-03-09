<script lang="ts">
  import { getMap, updateMapConfig, LARGE_MAP_THRESHOLD } from '../../lib/stores/map-store'
  import { getHistory } from '../../lib/stores/history-store'
  import type { Orientation, RenderOrder } from '../../lib/models/map'

  interface Props {
    show: boolean
  }

  let { show = $bindable() }: Props = $props()

  let name = $state('')
  let gridWidth = $state(32)
  let gridHeight = $state(32)
  let tileWidth = $state(64)
  let tileHeight = $state(32)
  let isoAngle = $state(26.565)
  let orientation = $state<Orientation>('diamond')
  let renderOrder = $state<RenderOrder>('right-down')
  let gridChanged = $state(false)

  $effect(() => {
    if (show) {
      const map = getMap()
      if (map) {
        name = map.config.name
        gridWidth = map.config.gridWidth
        gridHeight = map.config.gridHeight
        tileWidth = map.config.tileWidth
        tileHeight = map.config.tileHeight
        isoAngle = parseFloat((Math.atan(map.config.tileHeight / map.config.tileWidth) * 180 / Math.PI).toFixed(3))
        orientation = map.config.orientation || 'diamond'
        renderOrder = map.config.renderOrder || 'right-down'
        gridChanged = false
      }
    }
  })

  function syncHeightFromAngle() {
    const rad = isoAngle * Math.PI / 180
    tileHeight = Math.max(8, Math.round(tileWidth * Math.tan(rad)))
  }

  function syncAngleFromTiles() {
    isoAngle = parseFloat((Math.atan(tileHeight / tileWidth) * 180 / Math.PI).toFixed(3))
  }

  function handleAngleInput() {
    if (isoAngle > 0 && isoAngle < 90) syncHeightFromAngle()
  }

  function handleTileWidthInput() {
    syncHeightFromAngle()
  }

  function handleTileHeightInput() {
    syncAngleFromTiles()
  }

  let sizeWarning = $state('')

  function validateSize() {
    const cells = Math.max(1, gridWidth) * Math.max(1, gridHeight)
    if (cells > LARGE_MAP_THRESHOLD) {
      sizeWarning = `Large map (${cells.toLocaleString()} cells). Grid lines and tile stats will be simplified at far zoom levels.`
    } else {
      sizeWarning = ''
    }
  }

  function checkGridChanged() {
    const map = getMap()
    if (!map) return
    gridChanged = gridWidth !== map.config.gridWidth || gridHeight !== map.config.gridHeight
    validateSize()
  }

  function handleApply() {
    const map = getMap()
    if (!map) return
    const w = Math.max(1, gridWidth)
    const h = Math.max(1, gridHeight)
    const sizeChanged = w !== map.config.gridWidth || h !== map.config.gridHeight
    updateMapConfig({
      name,
      gridWidth: w,
      gridHeight: h,
      tileWidth: Math.max(8, tileWidth),
      tileHeight: Math.max(8, tileHeight),
      orientation,
      renderOrder
    })
    if (sizeChanged) {
      getHistory().clear()
    }
    window.electronAPI?.setTitle(`Axon - ${name}`)
    window.dispatchEvent(new CustomEvent('title-changed', { detail: `Axon - ${name}` }))
    show = false
  }

  function handleCancel() {
    show = false
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') handleCancel()
    if (e.key === 'Enter') handleApply()
  }
</script>

{#if show}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" onkeydown={handleKeydown}>
    <div class="dialog">
      <h3>Map Properties</h3>
      <div class="fields">
        <div class="field">
          <label for="prop-name">Name</label>
          <input id="prop-name" type="text" bind:value={name} />
        </div>
        <div class="field">
          <label for="prop-orientation">Orientation</label>
          <select id="prop-orientation" bind:value={orientation}>
            <option value="diamond">Diamond Isometric</option>
            <option value="staggered">Staggered Isometric</option>
          </select>
        </div>
        <div class="field">
          <label for="prop-render-order">Tile Render Order</label>
          <select id="prop-render-order" bind:value={renderOrder}>
            <option value="right-down">Right Down</option>
            <option value="right-up">Right Up</option>
            <option value="left-down">Left Down</option>
            <option value="left-up">Left Up</option>
          </select>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="prop-grid-w">Grid Width</label>
            <input id="prop-grid-w" type="number" min="1" bind:value={gridWidth} oninput={checkGridChanged} />
          </div>
          <div class="field">
            <label for="prop-grid-h">Grid Height</label>
            <input id="prop-grid-h" type="number" min="1" bind:value={gridHeight} oninput={checkGridChanged} />
          </div>
        </div>
        {#if sizeWarning}
          <div class="warning">{sizeWarning}</div>
        {/if}
        <div class="field">
          <label for="prop-iso-angle">Iso Angle (°)</label>
          <input id="prop-iso-angle" type="number" min="1" max="89" step="0.001" bind:value={isoAngle} oninput={handleAngleInput} />
          <span class="field-hint">26.565° = classic 2:1 &bull; 30° = true isometric</span>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="prop-tile-w">Tile Width (px)</label>
            <input id="prop-tile-w" type="number" min="8" max="512" bind:value={tileWidth} oninput={handleTileWidthInput} />
          </div>
          <div class="field">
            <label for="prop-tile-h">Tile Height (px)</label>
            <input id="prop-tile-h" type="number" min="8" max="512" bind:value={tileHeight} oninput={handleTileHeightInput} />
          </div>
        </div>
        <div class="presets">
          <span class="presets-label">Presets:</span>
          <button onclick={() => { tileWidth = 64; tileHeight = 32; isoAngle = 26.565 }}>64×32</button>
          <button onclick={() => { tileWidth = 128; tileHeight = 64; isoAngle = 26.565 }}>128×64</button>
          <button onclick={() => { tileWidth = 256; tileHeight = 128; isoAngle = 26.565 }}>256×128</button>
          <button onclick={() => { isoAngle = 30; syncHeightFromAngle() }}>30° true</button>
        </div>
        {#if gridChanged}
          <div class="warning">Changing grid size will clear undo history. Tiles outside the new bounds will be removed.</div>
        {/if}
      </div>
      <div class="buttons">
        <button class="cancel-btn" onclick={handleCancel}>Cancel</button>
        <button class="create-btn" onclick={handleApply}>Apply</button>
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
    width: 380px;
  }

  h3 {
    margin: 0 0 20px;
    font-size: 16px;
    color: var(--text-primary);
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 20px;
  }

  .field-row {
    display: flex;
    gap: 12px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
  }

  .field label {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .field input {
    width: 100%;
  }

  .field-hint {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 2px;
  }

  .presets {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .presets-label {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
  }

  .presets button {
    padding: 2px 8px;
    font-size: var(--font-size-sm);
  }

  .warning {
    font-size: var(--font-size-sm);
    color: #fab387;
    background: rgba(250, 179, 135, 0.1);
    padding: 8px 10px;
    border-radius: var(--radius-sm);
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .create-btn {
    background: var(--accent);
    color: var(--bg-primary);
    border-color: var(--accent);
    font-weight: 600;
    padding: 6px 16px;
  }

  .create-btn:hover {
    background: var(--accent-hover);
  }

  .cancel-btn {
    padding: 6px 16px;
  }
</style>
