<script lang="ts">
  import { createNewMap, LARGE_MAP_THRESHOLD } from '../../lib/stores/map-store'
  import { getHistory } from '../../lib/stores/history-store'
  import type { Orientation, RenderOrder } from '../../lib/models/map'

  interface Props {
    show: boolean
    onclose: () => void
  }

  let { show = $bindable(), onclose }: Props = $props()

  let name = $state('Untitled Map')
  let gridWidth = $state(32)
  let gridHeight = $state(32)
  let tileWidth = $state(64)
  let tileHeight = $state(32)
  let isoAngle = $state(26.565)
  let orientation = $state<Orientation>('diamond')
  let renderOrder = $state<RenderOrder>('right-down')

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

  function handleCreate() {
    createNewMap({
      name,
      gridWidth: Math.max(1, gridWidth),
      gridHeight: Math.max(1, gridHeight),
      tileWidth: Math.max(8, tileWidth),
      tileHeight: Math.max(8, tileHeight),
      orientation,
      renderOrder
    })
    getHistory().clear()
    window.electronAPI?.setTitle(`Axon - ${name}`)
    window.dispatchEvent(new CustomEvent('title-changed', { detail: `Axon - ${name}` }))
    show = false
    onclose()
  }

  function handleCancel() {
    show = false
    onclose()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') handleCancel()
    if (e.key === 'Enter') handleCreate()
  }
</script>

{#if show}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" onkeydown={handleKeydown}>
    <div class="dialog">
      <h3>New Map</h3>
      <div class="fields">
        <div class="field">
          <label for="map-name">Name</label>
          <input id="map-name" type="text" bind:value={name} />
        </div>
        <div class="field">
          <label for="orientation">Orientation</label>
          <select id="orientation" bind:value={orientation}>
            <option value="diamond">Diamond Isometric</option>
            <option value="staggered">Staggered Isometric</option>
          </select>
          <span class="field-hint">{orientation === 'diamond' ? 'Classic diamond-shaped grid layout' : 'Rectangular grid with staggered rows'}</span>
        </div>
        <div class="field">
          <label for="render-order">Tile Render Order</label>
          <select id="render-order" bind:value={renderOrder}>
            <option value="right-down">Right Down</option>
            <option value="right-up">Right Up</option>
            <option value="left-down">Left Down</option>
            <option value="left-up">Left Up</option>
          </select>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="grid-w">Grid Width</label>
            <input id="grid-w" type="number" min="1" bind:value={gridWidth} oninput={validateSize} />
          </div>
          <div class="field">
            <label for="grid-h">Grid Height</label>
            <input id="grid-h" type="number" min="1" bind:value={gridHeight} oninput={validateSize} />
          </div>
        </div>
        {#if sizeWarning}
          <div class="warning">{sizeWarning}</div>
        {/if}
        <div class="field">
          <label for="iso-angle">Iso Angle (°)</label>
          <input id="iso-angle" type="number" min="1" max="89" step="0.001" bind:value={isoAngle} oninput={handleAngleInput} />
          <span class="field-hint">26.565° = classic 2:1 &bull; 30° = true isometric</span>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="tile-w">Tile Width (px)</label>
            <input id="tile-w" type="number" min="8" max="512" bind:value={tileWidth} oninput={handleTileWidthInput} />
          </div>
          <div class="field">
            <label for="tile-h">Tile Height (px)</label>
            <input id="tile-h" type="number" min="8" max="512" bind:value={tileHeight} oninput={handleTileHeightInput} />
          </div>
        </div>
        <div class="presets">
          <span class="presets-label">Presets:</span>
          <button onclick={() => { tileWidth = 64; tileHeight = 32; isoAngle = 26.565 }}>64×32</button>
          <button onclick={() => { tileWidth = 128; tileHeight = 64; isoAngle = 26.565 }}>128×64</button>
          <button onclick={() => { tileWidth = 256; tileHeight = 128; isoAngle = 26.565 }}>256×128</button>
          <button onclick={() => { isoAngle = 30; syncHeightFromAngle() }}>30° true</button>
        </div>
      </div>
      <div class="buttons">
        <button class="cancel-btn" onclick={handleCancel}>Cancel</button>
        <button class="create-btn" onclick={handleCreate}>Create Map</button>
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
