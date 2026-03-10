import { ipcMain, BrowserWindow } from 'electron'
import { WebSocketServer, WebSocket } from 'ws'

// ── Types ──

export interface CollabMessage {
  type: string
  sender: string
  ts: number
  payload: any
}

interface CollabUser {
  id: string
  name: string
  color: string
  ws: WebSocket
}

// ── State ──

interface Snapshot {
  id: string
  name: string
  ts: number
  data: string // serialized MapData JSON
}

let wss: WebSocketServer | null = null
let users: CollabUser[] = []
let hostUserId: string | null = null
let mapSnapshot: string | null = null // serialized MapData JSON from host
let snapshots: Snapshot[] = []
const MAX_SNAPSHOTS = 20

function broadcast(msg: CollabMessage, excludeId?: string): void {
  const data = JSON.stringify(msg)
  for (const user of users) {
    if (user.id !== excludeId && user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(data)
    }
  }
}

function sendToRenderer(channel: string, ...args: any[]): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, ...args)
  }
}

function userListPayload(): { id: string; name: string; color: string }[] {
  return users.map(u => ({ id: u.id, name: u.name, color: u.color }))
}

// ── Server lifecycle ──

function startServer(port: number): { port: number } {
  if (wss) throw new Error('Server already running')

  wss = new WebSocketServer({ port })

  wss.on('connection', (ws) => {
    let userId: string | null = null

    ws.on('message', (raw) => {
      let msg: CollabMessage
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }

      if (msg.type === 'join') {
        userId = msg.sender
        const user: CollabUser = {
          id: userId,
          name: msg.payload.name || 'Anonymous',
          color: msg.payload.color || '#89b4fa',
          ws
        }
        users.push(user)

        // Send welcome with current state
        const welcome: CollabMessage = {
          type: 'welcome',
          sender: 'server',
          ts: Date.now(),
          payload: {
            userId,
            users: userListPayload(),
            snapshot: mapSnapshot
          }
        }
        ws.send(JSON.stringify(welcome))

        // Notify others
        broadcast({
          type: 'user-joined',
          sender: 'server',
          ts: Date.now(),
          payload: { userId, name: user.name, color: user.color }
        }, userId)

        // Notify renderer
        sendToRenderer('collab:user-joined', { id: userId, name: user.name, color: user.color })
        return
      }

      if (!userId) return

      // Forward ops, cursor, chat to all other clients
      if (msg.type === 'op' || msg.type === 'cursor' || msg.type === 'chat') {
        broadcast(msg, userId)
        // Also forward to host renderer (so host sees remote changes)
        sendToRenderer('collab:message', msg)
      }

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', sender: 'server', ts: Date.now(), payload: {} }))
      }
    })

    ws.on('close', () => {
      if (userId) {
        users = users.filter(u => u.id !== userId)
        broadcast({
          type: 'user-left',
          sender: 'server',
          ts: Date.now(),
          payload: { userId }
        })
        sendToRenderer('collab:user-left', { id: userId })
      }
    })

    ws.on('error', (err) => {
      console.error('[collab-server] WebSocket error:', err.message)
    })
  })

  wss.on('error', (err) => {
    console.error('[collab-server] Server error:', err.message)
    sendToRenderer('collab:error', err.message)
  })

  return { port }
}

function stopServer(): void {
  if (!wss) return
  // Close all client connections
  for (const user of users) {
    try { user.ws.close() } catch { /* ignore */ }
  }
  users = []
  hostUserId = null
  mapSnapshot = null
  snapshots = []
  wss.close()
  wss = null
}

function isServerRunning(): boolean {
  return wss !== null
}

// ── IPC Registration ──

export function registerCollabHandlers(): void {
  ipcMain.handle('collab:startServer', (_event, port: number) => {
    try {
      const result = startServer(port)
      return { success: true, port: result.port }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('collab:stopServer', () => {
    stopServer()
    return { success: true }
  })

  ipcMain.handle('collab:isServerRunning', () => {
    return isServerRunning()
  })

  ipcMain.handle('collab:setSnapshot', (_event, snapshot: string) => {
    mapSnapshot = snapshot
  })

  ipcMain.handle('collab:setHostUser', (_event, userId: string) => {
    hostUserId = userId
  })

  ipcMain.handle('collab:getUsers', () => {
    return userListPayload()
  })

  // Host sends an op to broadcast to all clients
  ipcMain.handle('collab:broadcastOp', (_event, msg: CollabMessage) => {
    broadcast(msg)
  })

  // ── Snapshot handlers ──

  ipcMain.handle('collab:createSnapshot', (_event, name: string, data: string) => {
    const snapshot: Snapshot = {
      id: 'snap-' + Math.random().toString(36).slice(2, 10),
      name,
      ts: Date.now(),
      data
    }
    snapshots.push(snapshot)
    if (snapshots.length > MAX_SNAPSHOTS) snapshots.shift()
    // Also update the current map snapshot for new joiners
    mapSnapshot = data
    return { id: snapshot.id, name: snapshot.name, ts: snapshot.ts }
  })

  ipcMain.handle('collab:listSnapshots', () => {
    return snapshots.map(s => ({ id: s.id, name: s.name, ts: s.ts }))
  })

  ipcMain.handle('collab:restoreSnapshot', (_event, snapshotId: string) => {
    const snapshot = snapshots.find(s => s.id === snapshotId)
    if (!snapshot) return { success: false, error: 'Snapshot not found' }

    // Update current state
    mapSnapshot = snapshot.data

    // Broadcast restore to all clients
    broadcast({
      type: 'snapshot-restore',
      sender: 'server',
      ts: Date.now(),
      payload: { snapshotData: snapshot.data }
    })

    // Also notify local renderer
    sendToRenderer('collab:snapshot-restored', snapshot.data)

    return { success: true }
  })
}
