#!/usr/bin/env node
/**
 * Axon Collab Server — standalone WebSocket collaboration server.
 *
 * Usage:
 *   npx ts-node collab-server.ts [--port 7777] [--password secret]
 *   node collab-server.js [--port 7777] [--password secret]
 */

import { WebSocketServer, WebSocket } from 'ws'
import { randomUUID, timingSafeEqual } from 'crypto'

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

interface ActiveEntityLock {
  userId: string
  color: string
  layerId: string
  entityId: string
}

let users: CollabUser[] = []
let mapSnapshot: string | null = null
let snapshots: Snapshot[] = []
let opCount = 0
let activeEntityLocks: ActiveEntityLock[] = []

/** Largest single message accepted from a client (map snapshots are the big ones). */
const MAX_PAYLOAD_BYTES = 128 * 1024 * 1024
/** Snapshots are full map JSON — cap the list by bytes, not just by count. */
const MAX_SNAPSHOTS = 20
const MAX_SNAPSHOT_BYTES = 512 * 1024 * 1024
/** A client that misses a heartbeat round is dropped. */
const HEARTBEAT_MS = 30_000

type TrackedSocket = WebSocket & { __alive?: boolean }

function snapshotBytes(): number {
  let total = 0
  for (const s of snapshots) total += s.data.length
  return total
}

/** Drop oldest snapshots until both the count and the byte budget fit. */
function trimSnapshots(): void {
  while (snapshots.length > MAX_SNAPSHOTS
    || (snapshots.length > 1 && snapshotBytes() > MAX_SNAPSHOT_BYTES)) {
    snapshots.shift()
  }
}

/** Constant-time password comparison. */
function passwordMatches(expected: string, given: unknown): boolean {
  if (typeof given !== 'string') return false
  const a = Buffer.from(expected, 'utf-8')
  const b = Buffer.from(given, 'utf-8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Server-assigned, unique, bound to one socket — never taken from the message. */
function assignUserId(requested: unknown): string {
  const base = typeof requested === 'string' && /^[\w-]{1,64}$/.test(requested)
    ? requested
    : 'user-' + randomUUID().slice(0, 8)
  if (!users.some(u => u.id === base)) return base
  return `${base}-${randomUUID().slice(0, 8)}`
}

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

const wss = new WebSocketServer({ port, maxPayload: MAX_PAYLOAD_BYTES })

log(`Axon Collab Server started on port ${port}`)
if (password) {
  log(`Password protection: ON`)
} else {
  log(`Password protection: OFF`)
}

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress || 'unknown'
  let userId: string | null = null

  const tracked = ws as TrackedSocket
  tracked.__alive = true
  ws.on('pong', () => { tracked.__alive = true })

  ws.on('message', (raw) => {
    let msg: CollabMessage
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    // ── Join ──
    if (msg.type === 'join') {
      // One join per connection; a second one added a duplicate user and let a
      // client grow the user list without bound.
      if (userId) return

      // Password check
      if (password && !passwordMatches(password, msg.payload?.password)) {
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

      // The id is assigned here and bound to this socket. Taking it straight
      // from the message let any client act as any other user.
      userId = assignUserId(msg.sender)
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
          snapshot: mapSnapshot,
          entityLocks: activeEntityLocks
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

    // ── Forward ops, cursors, chat, lock/unlock ──
    if (msg.type === 'op' || msg.type === 'cursor' || msg.type === 'chat'
        || msg.type === 'lock' || msg.type === 'unlock') {
      // Stamp the connection's own id so a client cannot post as someone else.
      broadcast({ ...msg, sender: userId }, userId)
      if (msg.type === 'op') opCount++
    }

    // Track entity locks server-side for welcome payload
    if (msg.type === 'lock' && msg.payload.entities?.length) {
      const user = users.find(u => u.id === userId)
      for (const e of msg.payload.entities) {
        activeEntityLocks = activeEntityLocks.filter(
          l => !(l.layerId === e.layerId && l.entityId === e.entityId)
        )
        activeEntityLocks.push({
          userId: userId!,
          color: user?.color || '#89b4fa',
          layerId: e.layerId,
          entityId: e.entityId
        })
      }
    }
    if (msg.type === 'unlock' && msg.payload.entities?.length) {
      for (const e of msg.payload.entities) {
        activeEntityLocks = activeEntityLocks.filter(
          l => !(l.layerId === e.layerId && l.entityId === e.entityId)
        )
      }
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
      trimSnapshots()
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
      // Release entity locks held by this user
      const userLocks = activeEntityLocks.filter(l => l.userId === userId)
      activeEntityLocks = activeEntityLocks.filter(l => l.userId !== userId)
      if (userLocks.length > 0) {
        broadcast({
          type: 'unlock',
          sender: 'server',
          ts: Date.now(),
          payload: {
            tiles: [],
            entities: userLocks.map(l => ({ layerId: l.layerId, entityId: l.entityId }))
          }
        })
      }

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

// ── Heartbeat ──
// Without this, half-open connections stay in `users` forever and keep holding
// their entity locks.
const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    const tracked = client as TrackedSocket
    if (tracked.__alive === false) {
      client.terminate()
      continue
    }
    tracked.__alive = false
    try { client.ping() } catch { /* socket already gone */ }
  }
}, HEARTBEAT_MS)

// ── Stats ──
setInterval(() => {
  if (users.length > 0) {
    log(`Stats: ${users.length} user(s), ${opCount} ops total, ${snapshots.length} snapshot(s)`)
  }
}, 60000)

// ── Graceful shutdown ──
function shutdown(): void {
  log('Shutting down...')
  clearInterval(heartbeat)
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
