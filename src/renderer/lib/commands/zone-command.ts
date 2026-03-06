import type { Command } from './command'
import type { MapData } from '../models/map'
import type { Zone } from '../models/layer'

export class AddZoneCommand implements Command {
  readonly description: string

  constructor(
    private layerId: string,
    private zone: Zone
  ) {
    this.description = `Add zone "${zone.name}"`
  }

  execute(map: MapData): void {
    const layer = map.layers.find(l => l.id === this.layerId)
    if (!layer || layer.type !== 'object') return
    layer.zones.push(this.zone)
  }

  undo(map: MapData): void {
    const layer = map.layers.find(l => l.id === this.layerId)
    if (!layer || layer.type !== 'object') return
    layer.zones = layer.zones.filter(z => z.id !== this.zone.id)
  }
}

export class DeleteZoneCommand implements Command {
  readonly description: string
  private index: number = 0

  constructor(
    private layerId: string,
    private zone: Zone
  ) {
    this.description = `Delete zone "${zone.name}"`
  }

  execute(map: MapData): void {
    const layer = map.layers.find(l => l.id === this.layerId)
    if (!layer || layer.type !== 'object') return
    this.index = layer.zones.findIndex(z => z.id === this.zone.id)
    layer.zones = layer.zones.filter(z => z.id !== this.zone.id)
  }

  undo(map: MapData): void {
    const layer = map.layers.find(l => l.id === this.layerId)
    if (!layer || layer.type !== 'object') return
    layer.zones.splice(this.index, 0, this.zone)
  }
}

export class ReorderZoneCommand implements Command {
  readonly description = 'Reorder zone'
  private oldIndex: number = 0
  private newIndex: number = 0

  constructor(
    private layerId: string,
    private zoneId: string,
    private direction: 'up' | 'down' | 'front' | 'back'
  ) {}

  execute(map: MapData): void {
    const layer = map.layers.find(l => l.id === this.layerId)
    if (!layer || layer.type !== 'object') return
    this.oldIndex = layer.zones.findIndex(z => z.id === this.zoneId)
    if (this.oldIndex === -1) return

    const [zone] = layer.zones.splice(this.oldIndex, 1)
    switch (this.direction) {
      case 'up':    this.newIndex = Math.min(this.oldIndex + 1, layer.zones.length); break
      case 'down':  this.newIndex = Math.max(this.oldIndex - 1, 0); break
      case 'front': this.newIndex = layer.zones.length; break
      case 'back':  this.newIndex = 0; break
    }
    layer.zones.splice(this.newIndex, 0, zone)
  }

  undo(map: MapData): void {
    const layer = map.layers.find(l => l.id === this.layerId)
    if (!layer || layer.type !== 'object') return
    const [zone] = layer.zones.splice(this.newIndex, 1)
    layer.zones.splice(this.oldIndex, 0, zone)
  }
}
