import type { Command } from './command'
import type { MapData } from '../models/map'
import type { Path } from '../models/layer'

export class AddPathCommand implements Command {
  readonly description: string

  constructor(
    private layerId: string,
    private path: Path
  ) {
    this.description = `Add path "${path.name}"`
  }

  execute(map: MapData): void {
    const layer = map.layers.find(l => l.id === this.layerId)
    if (!layer || layer.type !== 'object') return
    layer.paths.push(this.path)
  }

  undo(map: MapData): void {
    const layer = map.layers.find(l => l.id === this.layerId)
    if (!layer || layer.type !== 'object') return
    layer.paths = layer.paths.filter(p => p.id !== this.path.id)
  }
}

export class DeletePathCommand implements Command {
  readonly description: string
  private index: number = 0

  constructor(
    private layerId: string,
    private path: Path
  ) {
    this.description = `Delete path "${path.name}"`
  }

  execute(map: MapData): void {
    const layer = map.layers.find(l => l.id === this.layerId)
    if (!layer || layer.type !== 'object') return
    this.index = layer.paths.findIndex(p => p.id === this.path.id)
    layer.paths = layer.paths.filter(p => p.id !== this.path.id)
  }

  undo(map: MapData): void {
    const layer = map.layers.find(l => l.id === this.layerId)
    if (!layer || layer.type !== 'object') return
    layer.paths.splice(this.index, 0, this.path)
  }
}

export class ReorderPathCommand implements Command {
  readonly description = 'Reorder path'
  private oldIndex: number = 0
  private newIndex: number = 0

  constructor(
    private layerId: string,
    private pathId: string,
    private direction: 'up' | 'down' | 'front' | 'back'
  ) {}

  execute(map: MapData): void {
    const layer = map.layers.find(l => l.id === this.layerId)
    if (!layer || layer.type !== 'object') return
    this.oldIndex = layer.paths.findIndex(p => p.id === this.pathId)
    if (this.oldIndex === -1) return

    const [path] = layer.paths.splice(this.oldIndex, 1)
    switch (this.direction) {
      case 'up':    this.newIndex = Math.min(this.oldIndex + 1, layer.paths.length); break
      case 'down':  this.newIndex = Math.max(this.oldIndex - 1, 0); break
      case 'front': this.newIndex = layer.paths.length; break
      case 'back':  this.newIndex = 0; break
    }
    layer.paths.splice(this.newIndex, 0, path)
  }

  undo(map: MapData): void {
    const layer = map.layers.find(l => l.id === this.layerId)
    if (!layer || layer.type !== 'object') return
    const [path] = layer.paths.splice(this.newIndex, 1)
    layer.paths.splice(this.oldIndex, 0, path)
  }
}
