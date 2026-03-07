<script lang="ts">
  import LayerPanel from '../panels/LayerPanel.svelte'
  import TilePalette from '../panels/TilePalette.svelte'
  import ObjectPanel from '../panels/ObjectPanel.svelte'
  import PresetsPanel from '../panels/PresetsPanel.svelte'
  import PropertiesPanel from '../panels/PropertiesPanel.svelte'

  interface Props {
    width?: number
  }

  let { width }: Props = $props()
</script>

<div class="sidebar" style={width ? `width: ${width}px; min-width: ${width}px;` : ''}>
  <LayerPanel />
  <TilePalette />
  <ObjectPanel />
  <PresetsPanel />
  <PropertiesPanel />
</div>

<style>
  .sidebar {
    width: var(--sidebar-width);
    min-width: var(--sidebar-width);
    background: var(--bg-secondary);
    border-left: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }
</style>
