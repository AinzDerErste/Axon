import type { Command } from '../commands/command'
import { getMap, notify as notifyMap } from './map-store'

class HistoryManager {
  undoStack: Command[] = []
  redoStack: Command[] = []
  maxSize: number = 100
  private listeners: Array<() => void> = []

  subscribe(fn: () => void): () => void {
    this.listeners.push(fn)
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn)
    }
  }

  private notify() {
    for (const fn of this.listeners) fn()
  }

  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }

  /** Push a command that was already applied (e.g. during drag painting) */
  pushExecuted(cmd: Command): void {
    this.undoStack.push(cmd)
    if (this.undoStack.length > this.maxSize) this.undoStack.shift()
    this.redoStack = []
    this.notify()
  }

  /** Execute a command and push it to the stack */
  execute(cmd: Command): void {
    const map = getMap()
    if (!map) return
    cmd.execute(map)
    this.pushExecuted(cmd)
    notifyMap()
  }

  undo(): void {
    const map = getMap()
    if (!map) return
    const cmd = this.undoStack.pop()
    if (!cmd) return
    cmd.undo(map)
    this.redoStack.push(cmd)
    this.notify()
    notifyMap()
  }

  redo(): void {
    const map = getMap()
    if (!map) return
    const cmd = this.redoStack.pop()
    if (!cmd) return
    cmd.execute(map)
    this.undoStack.push(cmd)
    this.notify()
    notifyMap()
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
    this.notify()
  }
}

const history = new HistoryManager()

export function getHistory(): HistoryManager {
  return history
}

export function executeCommand(cmd: Command): void {
  history.execute(cmd)
}

export function undo(): void {
  history.undo()
}

export function redo(): void {
  history.redo()
}
