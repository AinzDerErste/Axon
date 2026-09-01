/**
 * End-to-end checks for the standalone collab server.
 *
 * Starts a real server on a loopback port and talks to it over WebSocket, so
 * the identity and join rules are verified against the running process rather
 * than by reading the source.
 *
 * Run with:  npm test
 */

import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import WebSocket from 'ws'

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'server')
const PORT = 7911
const PASSWORD = 'test-secret'

let failures = 0
function check(name, ok) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`)
  if (!ok) failures++
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

const server = spawn(
  process.execPath,
  ['--experimental-strip-types', '--no-warnings', 'collab-server.ts', '--port', String(PORT), '--password', PASSWORD],
  { cwd: serverDir, stdio: ['ignore', 'ignore', 'pipe'] }
)
server.stderr.on('data', (d) => process.stderr.write(`[collab-server] ${d}`))

try {
  await sleep(900)
  const received = []

  // Wrong password
  const intruder = await connect()
  let rejected = false
  intruder.on('message', (m) => { if (JSON.parse(m).type === 'error') rejected = true })
  intruder.send(JSON.stringify({ type: 'join', sender: 'mallory', ts: Date.now(), payload: { name: 'Mallory', password: 'wrong' } }))
  await sleep(300)
  check('a wrong password is rejected', rejected)

  // First client
  const alice = await connect()
  let aliceId = null
  alice.on('message', (m) => {
    const msg = JSON.parse(m)
    if (msg.type === 'welcome') aliceId = msg.payload.userId
    received.push(msg)
  })
  alice.send(JSON.stringify({ type: 'join', sender: 'alice', ts: Date.now(), payload: { name: 'Alice', password: PASSWORD } }))
  await sleep(300)
  check('a free id is granted as requested', aliceId === 'alice')

  // Second client claiming the same id
  const bob = await connect()
  let bobId = null
  bob.on('message', (m) => { const msg = JSON.parse(m); if (msg.type === 'welcome') bobId = msg.payload.userId })
  bob.send(JSON.stringify({ type: 'join', sender: 'alice', ts: Date.now(), payload: { name: 'Bob', password: PASSWORD } }))
  await sleep(300)
  check('a taken id is not handed out twice', Boolean(bobId) && bobId !== aliceId)

  // Impersonation attempt
  bob.send(JSON.stringify({ type: 'op', sender: 'alice', ts: Date.now(), payload: { opType: 'tile-paint' } }))
  await sleep(300)
  const forwarded = received.filter((m) => m.type === 'op').pop()
  check('a forwarded op carries the connection id, not the claimed one', forwarded?.sender === bobId)

  // Repeated join on one socket
  const joinsBefore = received.filter((m) => m.type === 'user-joined').length
  bob.send(JSON.stringify({ type: 'join', sender: 'carol', ts: Date.now(), payload: { name: 'Carol', password: PASSWORD } }))
  await sleep(300)
  const joinsAfter = received.filter((m) => m.type === 'user-joined').length
  check('a second join on the same socket is ignored', joinsBefore === joinsAfter)

  alice.close(); bob.close(); intruder.close()
  await sleep(200)
} finally {
  server.kill('SIGTERM')
  await sleep(300)
}

console.log('')
if (failures > 0) {
  console.log(`${failures} test(s) failed`)
  process.exit(1)
}
console.log('all collab server tests passed')
