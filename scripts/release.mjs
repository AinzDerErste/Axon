#!/usr/bin/env node

/**
 * Axon Release Script
 *
 * Usage:
 *   node scripts/release.mjs <patch|minor|major|x.y.z>
 *
 * Example:
 *   node scripts/release.mjs patch    → 1.2.0 → 1.2.1
 *   node scripts/release.mjs minor    → 1.2.0 → 1.3.0
 *   node scripts/release.mjs major    → 1.2.0 → 2.0.0
 *   node scripts/release.mjs 1.5.0   → sets to 1.5.0
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const GH = 'C:\\Program Files\\GitHub CLI\\gh.exe'

// ── Helpers ──────────────────────────────────────────────

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`)
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: opts.silent ? 'pipe' : 'inherit', ...opts })
}

function runSilent(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: 'pipe' }).trim()
}

function bumpVersion(current, type) {
  const [major, minor, patch] = current.split('.').map(Number)
  switch (type) {
    case 'patch': return `${major}.${minor}.${patch + 1}`
    case 'minor': return `${major}.${minor + 1}.0`
    case 'major': return `${major + 1}.0.0`
    default:
      if (/^\d+\.\d+\.\d+$/.test(type)) return type
      console.error(`Invalid version: ${type}`)
      console.error('Usage: node scripts/release.mjs <patch|minor|major|x.y.z>')
      process.exit(1)
  }
}

// ── Main ─────────────────────────────────────────────────

const arg = process.argv[2]
if (!arg) {
  console.error('Usage: node scripts/release.mjs <patch|minor|major|x.y.z>')
  process.exit(1)
}

// 1. Read current version
const pkgPath = join(ROOT, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
const oldVersion = pkg.version
const newVersion = bumpVersion(oldVersion, arg)

console.log(`\n🚀 Axon Release: v${oldVersion} → v${newVersion}\n`)

// 2. Bump version in package.json
pkg.version = newVersion
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(`✅ Version bumped in package.json`)

// 3. Build
console.log(`\n📦 Building dist...\n`)
run('npm run dist')

// 4. Verify build output
const setupExe = join(ROOT, 'dist', `Axon-${newVersion}-setup.exe`)
const portableExe = join(ROOT, 'dist', `Axon-${newVersion}-portable.exe`)
const distYml = join(ROOT, 'dist', 'latest.yml')

if (!existsSync(setupExe)) {
  console.error(`❌ Setup exe not found: ${setupExe}`)
  process.exit(1)
}
if (!existsSync(portableExe)) {
  console.error(`❌ Portable exe not found: ${portableExe}`)
  process.exit(1)
}
if (!existsSync(distYml)) {
  console.error(`❌ latest.yml not found`)
  process.exit(1)
}
console.log(`\n✅ Build successful`)

// 5. Update updates/latest.yml with GitHub release download URL
const ymlContent = readFileSync(distYml, 'utf-8')
const ghUrl = `https://github.com/AinzDerErste/Axon/releases/download/v${newVersion}`

// Replace relative URLs with absolute GitHub release URLs
const updatedYml = ymlContent
  .replace(/url: Axon-/g, `url: ${ghUrl}/Axon-`)
  .replace(/^path: Axon-/m, `path: ${ghUrl}/Axon-`)

const updatesDir = join(ROOT, 'updates')
if (!existsSync(updatesDir)) {
  const { mkdirSync } = await import('fs')
  mkdirSync(updatesDir, { recursive: true })
}
writeFileSync(join(updatesDir, 'latest.yml'), updatedYml)
console.log(`✅ updates/latest.yml updated`)

// 6. Git commit & push
console.log(`\n📤 Committing and pushing...\n`)
run(`git add package.json updates/latest.yml`)
run(`git commit -m "v${newVersion}"`)
run(`git push`)

// 7. Create GitHub Release (only exe files)
console.log(`\n🏷️  Creating GitHub Release v${newVersion}...\n`)

const notes = `## Download

- **Axon-${newVersion}-setup.exe** — Installer (recommended, supports auto-updates)
- **Axon-${newVersion}-portable.exe** — Portable version (no installation required)`

const notesFile = join(ROOT, 'dist', '.release-notes.tmp')
writeFileSync(notesFile, notes)

try {
  run(`"${GH}" release create v${newVersion} --title "Axon v${newVersion}" --notes-file "${notesFile}" "${setupExe}" "${portableExe}"`)
} catch (e) {
  console.error(`❌ Release creation failed. You may need to create it manually.`)
  process.exit(1)
}

console.log(`
╔══════════════════════════════════════════════════════╗
║  ✅ Axon v${newVersion} released!${' '.repeat(34 - newVersion.length)}║
║                                                      ║
║  GitHub: https://github.com/AinzDerErste/Axon        ║
║  Release: .../releases/tag/v${newVersion}${' '.repeat(25 - newVersion.length)}║
╚══════════════════════════════════════════════════════╝
`)
