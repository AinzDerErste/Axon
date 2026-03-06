import type { MapData } from '../models/map'

export interface Command {
  readonly description: string
  execute(map: MapData): void
  undo(map: MapData): void
}
