import type { Command } from './command'
import type { MapData } from '../models/map'
import type { MapObject, ObjectLayer } from '../models/layer'

/** Wraps multiple commands into a single undoable operation */
export class BatchCommand implements Command {
  readonly description: string

  constructor(description: string, private commands: Command[]) {
    this.description = description
  }

  execute(map: MapData): void {
    for (const cmd of this.commands) cmd.execute(map)
  }

  undo(map: MapData): void {
    for (let i = this.commands.length - 1; i >= 0; i--) {
      this.commands[i].undo(map)
    }
  }
}

export class PlaceObjectCommand implements Command {
  readonly description: string

  constructor(
    private layerId: string,
    private object: MapObject
  ) {
    this.description = `Place object "${object.name}"`
  }

  execute(map: MapData): void {
    const layer = map.layers.find(l => l.id === this.layerId)
    if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return
    layer.objects.push(this.object)
  }

  undo(map: MapData): void {
    const layer = map.layers.find(l => l.id === this.layerId)
    if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return
    layer.objects = layer.objects.filter(o => o.id !== this.object.id)
  }
}

export class MoveObjectCommand implements Command {
  readonly description = 'Move object'

  constructor(
    private layerId: string,
    private objectId: string,
    private oldX: number,
    private oldY: number,
    private newX: number,
    private newY: number
  ) {}

  execute(map: MapData): void {
    const layer = map.layers.find(l => l.id === this.layerId)
    if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return
    const obj = layer.objects.find(o => o.id === this.objectId)
    if (obj) { obj.x = this.newX; obj.y = this.newY }
  }

  undo(map: MapData): void {
    const layer = map.layers.find(l => l.id === this.layerId)
    if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return
    const obj = layer.objects.find(o => o.id === this.objectId)
    if (obj) { obj.x = this.oldX; obj.y = this.oldY }
  }
}

export class DeleteObjectCommand implements Command {
  readonly description: string
  private index: number = 0

  constructor(
    private layerId: string,
    private object: MapObject
  ) {
    this.description = `Delete object "${object.name}"`
  }

  execute(map: MapData): void {
    const layer = map.layers.find(l => l.id === this.layerId)
    if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return
    this.index = layer.objects.findIndex(o => o.id === this.object.id)
    layer.objects = layer.objects.filter(o => o.id !== this.object.id)
  }

  undo(map: MapData): void {
    const layer = map.layers.find(l => l.id === this.layerId)
    if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return
    layer.objects.splice(this.index, 0, this.object)
  }
}

export class ReorderObjectCommand implements Command {
  readonly description = 'Reorder object'
  private oldIndex: number = 0
  private newIndex: number = 0

  constructor(
    private layerId: string,
    private objectId: string,
    private direction: 'up' | 'down' | 'front' | 'back'
  ) {}

  execute(map: MapData): void {
    const layer = map.layers.find(l => l.id === this.layerId)
    if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return
    this.oldIndex = layer.objects.findIndex(o => o.id === this.objectId)
    if (this.oldIndex === -1) return

    const [obj] = layer.objects.splice(this.oldIndex, 1)
    switch (this.direction) {
      case 'up':    this.newIndex = Math.min(this.oldIndex + 1, layer.objects.length); break
      case 'down':  this.newIndex = Math.max(this.oldIndex - 1, 0); break
      case 'front': this.newIndex = layer.objects.length; break
      case 'back':  this.newIndex = 0; break
    }
    layer.objects.splice(this.newIndex, 0, obj)
  }

  undo(map: MapData): void {
    const layer = map.layers.find(l => l.id === this.layerId)
    if (!layer || (layer.type !== 'object' && layer.type !== 'drawing')) return
    const [obj] = layer.objects.splice(this.newIndex, 1)
    layer.objects.splice(this.oldIndex, 0, obj)
  }
}
