#!/usr/bin/env node
/**
 * Axon Collab Server — standalone WebSocket collaboration server.
 *
 * Usage:
 *   npx ts-node collab-server.ts [--port 7777] [--password secret]
 *   node collab-server.js [--port 7777] [--password secret]
 */

import { WebSocketServer, WebSocket } from 'ws'

// ── CLI args ──

function parseArgs(): { port: number; password: string | null } {
  const args = process.argv.slice(2)
  let port = 7777
  let password: string | null = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10)
      i++
    } else if (args[i] === '--password' && args[i + 1]) {
      password = args[i + 1]
      i++
    }
  }
  return { port, password }
}

// ── Types ──

interface CollabMessage {
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

interface Snapshot {
  id: string
  name: string
  ts: number
  data: string
}

// ── State ──

let users: CollabUser[] = []
let mapSnapshot: string | null = null
let snapshots: Snapshot[] = []
const MAX_SNAPSHOTS = 20
let opCount = 0

// ── Helpers ──

function broadcast(msg: CollabMessage, excludeId?: string): void {
  const data = JSON.stringify(msg)
  for (const user of users) {
    if (user.id !== excludeId && user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(data)
    }
  }
}

function userListPayload(): { id: string; name: string; color: string }[] {
  return users.map(u => ({ id: u.id, name: u.name, color: u.color }))
}

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19)
  console.log(`[${ts}] ${msg}`)
}

// ── Main ──

const { port, password } = parseArgs()

const wss = new WebSocketServer({ port })

log(`Axon Collab Server started on port ${port}`)
if (password) {
  log(`Password protection: ON`)
} else {
  log(`Password protection: OFF`)
}

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress || 'unknown'
  let userId: string | null = null

  ws.on('message', (raw) => {
    let msg: CollabMessage
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    // ── Join ──
    if (msg.type === 'join') {
      // Password check
      if (password && msg.payload.password !== password) {
        ws.send(JSON.stringify({
          type: 'error',
          sender: 'server',
          ts: Date.now(),
          payload: { message: 'Invalid password' }
        }))
        ws.close()
        log(`Rejected ${msg.payload.name || 'Anonymous'} from ${ip} (wrong password)`)
        return
      }

      userId = msg.sender
      const user: CollabUser = {
        id: userId,
        name: msg.payload.name || 'Anonymous',
        color: msg.payload.color || '#89b4fa',
        ws
      }
      users.push(user)

      // Send welcome with current map state
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

      log(`${user.name} joined (${ip}) — ${users.length} user(s) online`)
      return
    }

    if (!userId) return

    // ── Forward ops, cursors, chat ──
    if (msg.type === 'op' || msg.type === 'cursor' || msg.type === 'chat') {
      broadcast(msg, userId)
      if (msg.type === 'op') opCount++
    }

    // ── Upload map (client shares their map as the server state) ──
    if (msg.type === 'upload-map') {
      if (msg.payload?.mapData) {
        mapSnapshot = msg.payload.mapData
        const uploaderName = users.find(u => u.id === userId)?.name || 'Unknown'
        log(`${uploaderName} uploaded map snapshot (${(mapSnapshot!.length / 1024).toFixed(0)} KB)`)

        // Broadcast to all other clients so they load the new map
        broadcast({
          type: 'snapshot-restore',
          sender: 'server',
          ts: Date.now(),
          payload: { snapshotData: mapSnapshot }
        }, userId)
      }
    }

    // ── Snapshot management ──
    if (msg.type === 'snapshot-create') {
      const { name, data } = msg.payload
      const snap: Snapshot = {
        id: 'snap-' + Math.random().toString(36).slice(2, 10),
        name: name || `Snapshot ${snapshots.length + 1}`,
        ts: Date.now(),
        data
      }
      snapshots.push(snap)
      if (snapshots.length > MAX_SNAPSHOTS) snapshots.shift()
      mapSnapshot = data

      ws.send(JSON.stringify({
        type: 'snapshot-created',
        sender: 'server',
        ts: Date.now(),
        payload: { id: snap.id, name: snap.name, ts: snap.ts }
      }))
      log(`Snapshot created: "${snap.name}"`)
    }

    if (msg.type === 'snapshot-list') {
      ws.send(JSON.stringify({
        type: 'snapshot-list',
        sender: 'server',
        ts: Date.now(),
        payload: snapshots.map(s => ({ id: s.id, name: s.name, ts: s.ts }))
      }))
    }

    if (msg.type === 'snapshot-restore') {
      const snap = snapshots.find(s => s.id === msg.payload?.snapshotId)
      if (snap) {
        mapSnapshot = snap.data
        broadcast({
          type: 'snapshot-restore',
          sender: 'server',
          ts: Date.now(),
          payload: { snapshotData: snap.data }
        })
        log(`Snapshot restored: "${snap.name}"`)
      }
    }

    // ── Ping/Pong ──
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', sender: 'server', ts: Date.now(), payload: {} }))
    }
  })

  ws.on('close', () => {
    if (userId) {
      const userName = users.find(u => u.id === userId)?.name || 'Unknown'
      users = users.filter(u => u.id !== userId)
      broadcast({
        type: 'user-left',
        sender: 'server',
        ts: Date.now(),
        payload: { userId }
      })
      log(`${userName} left — ${users.length} user(s) online`)
    }
  })

  ws.on('error', (err) => {
    console.error(`[ws-error] ${err.message}`)
  })
})

wss.on('error', (err) => {
  console.error(`[server-error] ${err.message}`)
})

// ── Stats ──
setInterval(() => {
  if (users.length > 0) {
    log(`Stats: ${users.length} user(s), ${opCount} ops total, ${snapshots.length} snapshot(s)`)
  }
}, 60000)

// ── Graceful shutdown ──
function shutdown(): void {
  log('Shutting down...')
  for (const user of users) {
    try { user.ws.close() } catch { /* ignore */ }
  }
  wss.close(() => {
    log('Server stopped')
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
