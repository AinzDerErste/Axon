// Collaboration store — same pub/sub pattern as other stores

export interface CollabMessage {
  type: string
  sender: string
  ts: number
  payload: any
}

export interface CollabUser {
  id: string
  name: string
  color: string
}

export interface RemoteCursor {
  userId: string
  col: number
  row: number
  layerId: string
  lastUpdate: number
}

export interface ChatMessage {
  sender: string
  name: string
  text: string
  ts: number
  mapCoord?: { col: number; row: number }
}

export type CollabRole = 'host' | 'client' | null

interface CollabState {
  role: CollabRole
  connected: boolean
  connecting: boolean
  wasConnected: boolean
  users: CollabUser[]
  remoteCursors: Map<string, RemoteCursor>
  chatMessages: ChatMessage[]
  serverPort: number
  serverAddress: string
  error: string | null
  incomingSnapshot: string | null
  incomingOps: any[]
}

// ── State ──

const state: CollabState = {
  role: null,
  connected: false,
  connecting: false,
  wasConnected: false,
  users: [],
  remoteCursors: new Map(),
  chatMessages: [],
  serverPort: 7777,
  serverAddress: '',
  error: null,
  incomingSnapshot: null,
  incomingOps: []
}

let listeners: Array<() => void> = []

// ── Pub/Sub ──

function notify(): void {
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void): () => void {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter(l => l !== fn)
  }
}

// ── Getters ──

function getState(): CollabState {
  return state
}

function getUsers(): CollabUser[] {
  return state.users
}

function getRemoteCursors(): Map<string, RemoteCursor> {
  return state.remoteCursors
}

function getChatMessages(): ChatMessage[] {
  return state.chatMessages
}

function isActive(): boolean {
  return state.role !== null
}

// ── Mutations ──

function setRole(role: CollabRole): void {
  state.role = role
  notify()
}

function setConnected(connected: boolean): void {
  state.connected = connected
  if (connected) state.wasConnected = true
  state.connecting = false
  state.error = null
  notify()
}

function setConnecting(connecting: boolean): void {
  state.connecting = connecting
  notify()
}

function setError(error: string | null): void {
  state.error = error
  state.connecting = false
  notify()
}

function setServerPort(port: number): void {
  state.serverPort = port
  notify()
}

function setServerAddress(address: string): void {
  state.serverAddress = address
  notify()
}

function setUsers(users: CollabUser[]): void {
  state.users = users
  notify()
}

function addUser(user: CollabUser): void {
  if (!state.users.find(u => u.id === user.id)) {
    state.users = [...state.users, user]
    notify()
  }
}

function removeUser(userId: string): void {
  state.users = state.users.filter(u => u.id !== userId)
  state.remoteCursors.delete(userId)
  notify()
}

function updateRemoteCursor(userId: string, cursor: { col: number; row: number; layerId: string }): void {
  state.remoteCursors.set(userId, {
    userId,
    col: cursor.col,
    row: cursor.row,
    layerId: cursor.layerId,
    lastUpdate: Date.now()
  })
  notify()
}

function addChatMessage(msg: ChatMessage): void {
  state.chatMessages = [...state.chatMessages, msg]
  // Keep last 200 messages
  if (state.chatMessages.length > 200) {
    state.chatMessages = state.chatMessages.slice(-200)
  }
  notify()
}

function setIncomingSnapshot(snapshot: string): void {
  state.incomingSnapshot = snapshot
  notify()
}

function consumeIncomingSnapshot(): string | null {
  const snap = state.incomingSnapshot
  state.incomingSnapshot = null
  return snap
}

function addIncomingOp(op: any): void {
  state.incomingOps.push(op)
  notify()
}

function consumeIncomingOps(): any[] {
  const ops = state.incomingOps
  state.incomingOps = []
  return ops
}

function reset(): void {
  state.role = null
  state.connected = false
  state.connecting = false
  state.wasConnected = false
  state.users = []
  state.remoteCursors.clear()
  state.chatMessages = []
  state.error = null
  state.incomingSnapshot = null
  state.incomingOps = []
  notify()
}

// ── Export store object ──

export const collabStore = {
  subscribe,
  notify,
  getState,
  getUsers,
  getRemoteCursors,
  getChatMessages,
  isActive,
  setRole,
  setConnected,
  setConnecting,
  setError,
  setServerPort,
  setServerAddress,
  setUsers,
  addUser,
  removeUser,
  updateRemoteCursor,
  addChatMessage,
  setIncomingSnapshot,
  consumeIncomingSnapshot,
  addIncomingOp,
  consumeIncomingOps,
  reset
}
