<script lang="ts">
  import LayerPanel from '../panels/LayerPanel.svelte'
  import TilePalette from '../panels/TilePalette.svelte'
  import ObjectPanel from '../panels/ObjectPanel.svelte'
  import PropertiesPanel from '../panels/PropertiesPanel.svelte'
</script>

<div class="sidebar">
  <LayerPanel />
  <TilePalette />
  <ObjectPanel />
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
