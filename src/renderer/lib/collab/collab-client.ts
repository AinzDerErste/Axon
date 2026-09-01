import type { CollabMessage, CollabUser } from './collab-store'
import { collabStore } from './collab-store'
import { lockStore } from './lock-store'

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let pingTimer: ReturnType<typeof setInterval> | null = null
let userId: string = ''
let userName: string = ''
let userColor: string = ''

function generateUserId(): string {
  return 'u-' + Math.random().toString(36).slice(2, 10)
}

const USER_COLORS = [
  '#89b4fa', '#f38ba8', '#a6e3a1', '#fab387',
  '#cba6f7', '#f9e2af', '#94e2d5', '#f5c2e7'
]

function randomColor(): string {
  return USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)]
}

export function connect(address: string, name: string, password?: string): void {
  if (ws) disconnect()

  userId = generateUserId()
  userName = name || 'Anonymous'
  userColor = randomColor()

  collabStore.setConnecting(true)

  try {
    ws = new WebSocket(address)
  } catch (err: any) {
    collabStore.setConnecting(false)
    collabStore.setError('Connection failed: ' + err.message)
    return
  }

  ws.onopen = () => {
    collabStore.setConnecting(false)
    // Send join message
    send({
      type: 'join',
      sender: userId,
      ts: Date.now(),
      payload: { name: userName, color: userColor, password }
    })

    // Start keepalive
    pingTimer = setInterval(() => {
      send({ type: 'ping', sender: userId, ts: Date.now(), payload: {} })
    }, 30000)
  }

  ws.onmessage = (event) => {
    let msg: CollabMessage
    try {
      msg = JSON.parse(event.data as string)
    } catch {
      return
    }
    handleMessage(msg)
  }

  ws.onclose = () => {
    cleanup()
    collabStore.setConnected(false)

    // Auto-reconnect after 3 seconds if we were connected
    if (collabStore.getState().wasConnected) {
      reconnectTimer = setTimeout(() => {
        if (!ws) connect(address, userName)
      }, 3000)
    }
  }

  ws.onerror = () => {
    collabStore.setError('WebSocket connection error')
  }
}

export function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (ws) {
    ws.onclose = null // prevent auto-reconnect
    ws.close()
    cleanup()
  }
  lockStore.reset()
  collabStore.reset()
}

export function send(msg: CollabMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

export function sendOp(opType: string, layerId: string, data: any): void {
  send({
    type: 'op',
    sender: userId,
    ts: Date.now(),
    payload: { opType, layerId, data }
  })
}

export function sendCursor(col: number, row: number, layerId: string): void {
  send({
    type: 'cursor',
    sender: userId,
    ts: Date.now(),
    payload: { col, row, layerId }
  })
}

export function sendUploadMap(mapDataJson: string): void {
  send({
    type: 'upload-map',
    sender: userId,
    ts: Date.now(),
    payload: { mapData: mapDataJson }
  })
}

export function sendLock(
  tiles: { layerId: string; col: number; row: number }[],
  entities: { layerId: string; entityId: string }[]
): void {
  if (tiles.length === 0 && entities.length === 0) return
  send({
    type: 'lock',
    sender: userId,
    ts: Date.now(),
    payload: { tiles, entities }
  })
}

export function sendUnlock(
  tiles: { layerId: string; col: number; row: number }[],
  entities: { layerId: string; entityId: string }[]
): void {
  if (tiles.length === 0 && entities.length === 0) return
  send({
    type: 'unlock',
    sender: userId,
    ts: Date.now(),
    payload: { tiles, entities }
  })
}

export function sendChat(text: string, mapCoord?: { col: number; row: number }): void {
  const msg: CollabMessage = {
    type: 'chat',
    sender: userId,
    ts: Date.now(),
    payload: { text, name: userName, mapCoord }
  }
  send(msg)
  // Also add to local chat
  collabStore.addChatMessage({
    sender: userId,
    name: userName,
    text,
    ts: Date.now(),
    mapCoord
  })
}

export function getUserId(): string {
  return userId
}

export function getUserName(): string {
  return userName
}

export function getUserColor(): string {
  return userColor
}

export function isConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN
}

// ── Internal ──

function handleMessage(msg: CollabMessage): void {
  switch (msg.type) {
    case 'welcome': {
      const { userId: assignedId, users, snapshot, entityLocks: remoteLocks } = msg.payload
      // The server owns the id: it may hand back a different one if the
      // requested one was already taken. Everything we send from here on has
      // to carry the id the server actually bound to this connection.
      if (typeof assignedId === 'string' && assignedId) userId = assignedId
      collabStore.setConnected(true)
      collabStore.setUsers(users as CollabUser[])
      if (snapshot) {
        collabStore.setIncomingSnapshot(snapshot)
      }
      // Restore entity locks from server state
      if (remoteLocks && Array.isArray(remoteLocks)) {
        for (const l of remoteLocks) {
          lockStore.claimEntityLock(l.userId, l.color, l.layerId, l.entityId)
        }
      }
      break
    }

    case 'user-joined': {
      const { userId: uid, name, color } = msg.payload
      collabStore.addUser({ id: uid, name, color })
      break
    }

    case 'user-left': {
      lockStore.releaseAllForUser(msg.payload.userId)
      collabStore.removeUser(msg.payload.userId)
      break
    }

    case 'op': {
      collabStore.addIncomingOp(msg.payload)
      break
    }

    case 'cursor': {
      collabStore.updateRemoteCursor(msg.sender, msg.payload)
      break
    }

    case 'chat': {
      collabStore.addChatMessage({
        sender: msg.sender,
        name: msg.payload.name || 'Unknown',
        text: msg.payload.text,
        ts: msg.ts,
        mapCoord: msg.payload.mapCoord
      })
      break
    }

    case 'lock': {
      const user = collabStore.getUsers().find(u => u.id === msg.sender)
      const color = user?.color || '#89b4fa'
      if (msg.payload.tiles?.length) {
        lockStore.claimTileLocks(msg.sender, color, msg.payload.tiles)
      }
      if (msg.payload.entities?.length) {
        for (const e of msg.payload.entities) {
          lockStore.claimEntityLock(msg.sender, color, e.layerId, e.entityId)
        }
      }
      break
    }

    case 'unlock': {
      if (msg.payload.tiles?.length) {
        lockStore.releaseTileLocks(msg.payload.tiles)
      }
      if (msg.payload.entities?.length) {
        for (const e of msg.payload.entities) {
          lockStore.releaseEntityLock(e.layerId, e.entityId)
        }
      }
      break
    }

    case 'snapshot-restore': {
      if (msg.payload?.snapshotData) {
        collabStore.setIncomingSnapshot(msg.payload.snapshotData)
      }
      break
    }

    case 'error': {
      collabStore.setError(msg.payload?.message || 'Server error')
      disconnect()
      break
    }

    case 'pong':
      break
  }
}

function cleanup(): void {
  if (pingTimer) {
    clearInterval(pingTimer)
    pingTimer = null
  }
  ws = null
}
