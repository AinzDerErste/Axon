#!/usr/bin/env node

/**
 * Axon Release Script
 *
 * Bumps version, collects release notes, commits, tags, and pushes.
 * CI pipeline handles building, uploading artifacts, and updating latest.yml.
 *
 * Usage:
 *   node scripts/release.mjs              → Interactive mode
 *   node scripts/release.mjs patch        → 1.2.0 → 1.2.1
 *   node scripts/release.mjs minor        → 1.2.0 → 1.3.0
 *   node scripts/release.mjs major        → 1.2.0 → 2.0.0
 *   node scripts/release.mjs 1.5.0        → sets to 1.5.0
 */

import { readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createInterface } from 'readline'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const GH = 'C:\\Program Files\\GitHub CLI\\gh.exe'

// ── Helpers ──────────────────────────────────────────────

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`)
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: opts.silent ? 'pipe' : 'inherit', ...opts })
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
      process.exit(1)
  }
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function collectReleaseNotes() {
  const categories = [
    { key: '1', label: "✨ What's New",    emoji: '✨' },
    { key: '2', label: '🐛 Bug Fixes',     emoji: '🐛' },
    { key: '3', label: '⚡ Improvements',   emoji: '⚡' },
    { key: '4', label: '🔧 Under the Hood', emoji: '🔧' },
  ]
  const entries = {}

  console.log(`\n📝 Release Notes\n`)
  console.log(`  Categories:`)
  for (const c of categories) {
    console.log(`  [${c.key}] ${c.label}`)
  }
  console.log(`  [0] Done\n`)

  while (true) {
    const choice = await ask('  Category (0 = done): ')
    if (choice === '0') break

    const cat = categories.find(c => c.key === choice)
    if (!cat) {
      console.log('  ❌ Invalid category')
      continue
    }

    console.log(`  → ${cat.label} (empty line = done with category)`)
    while (true) {
      const item = await ask('    - ')
      if (!item) break
      if (!entries[cat.label]) entries[cat.label] = []
      entries[cat.label].push(item)
    }
  }

  let md = ''
  for (const cat of categories) {
    if (entries[cat.label]?.length) {
      md += `### ${cat.label}\n`
      for (const item of entries[cat.label]) {
        md += `- ${item}\n`
      }
      md += '\n'
    }
  }

  return md.trim()
}

async function selectReleaseType(currentVersion) {
  const [major, minor, patch] = currentVersion.split('.').map(Number)

  console.log(`\n╔══════════════════════════════════════════════════╗`)
  console.log(`║           🚀 Axon Release Tool                   ║`)
  console.log(`╚══════════════════════════════════════════════════╝`)
  console.log(`\n  Current version: v${currentVersion}\n`)
  console.log(`  [1] patch  →  v${major}.${minor}.${patch + 1}`)
  console.log(`  [2] minor  →  v${major}.${minor + 1}.0`)
  console.log(`  [3] major  →  v${major + 1}.0.0`)
  console.log(`  [4] custom version`)
  console.log(`  [0] cancel\n`)

  const choice = await ask('  Select option: ')

  switch (choice) {
    case '1': return 'patch'
    case '2': return 'minor'
    case '3': return 'major'
    case '4': {
      const custom = await ask('  Enter version (x.y.z): ')
      if (!/^\d+\.\d+\.\d+$/.test(custom)) {
        console.error('  ❌ Invalid version format. Use x.y.z')
        process.exit(1)
      }
      return custom
    }
    case '0':
      console.log('  Aborted.')
      process.exit(0)
    default:
      console.error('  ❌ Invalid option.')
      process.exit(1)
  }
}

// ── Main ─────────────────────────────────────────────────

const pkgPath = join(ROOT, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
const oldVersion = pkg.version

// Get release type: from CLI arg or interactive menu
let arg = process.argv[2]
if (!arg) {
  arg = await selectReleaseType(oldVersion)
}

// 1. Calculate new version
const newVersion = bumpVersion(oldVersion, arg)

console.log(`\n🚀 Axon Release: v${oldVersion} → v${newVersion}\n`)

// 2. Collect release notes
const changelog = await collectReleaseNotes()

if (changelog) {
  console.log(`\n  Preview:\n`)
  for (const line of changelog.split('\n')) {
    console.log(`    ${line}`)
  }
}

// 3. Confirm
const confirm = await ask('\n  Start release? (y/n): ')
if (confirm.toLowerCase() !== 'y') {
  console.log('  Aborted.')
  process.exit(0)
}

// 4. Bump version in package.json
pkg.version = newVersion
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(`✅ Version bumped in package.json`)

// 5. Git commit, tag & push
console.log(`\n📤 Committing, tagging and pushing...\n`)
run(`git add package.json`)
run(`git commit -m "v${newVersion}"`)
run(`git tag v${newVersion}`)
run(`git push`)
run(`git push origin v${newVersion}`)

// 6. Create GitHub Release with notes (CI will attach .exe artifacts)
console.log(`\n🏷️  Creating GitHub Release v${newVersion}...\n`)

const downloadSection = `## Download

- **Axon-${newVersion}-setup.exe** — Installer (recommended, supports auto-updates)
- **Axon-${newVersion}-portable.exe** — Portable version (no installation required)

> Build artifacts are attached automatically by CI.`

const notes = changelog
  ? `${changelog}\n\n---\n\n${downloadSection}`
  : downloadSection

const notesFile = join(ROOT, 'dist', '.release-notes.tmp')
writeFileSync(notesFile, notes)

try {
  const ghCmd = `& '${GH}' release create v${newVersion} --title 'Axon v${newVersion}' --notes-file '${notesFile}'`
  run(`powershell -Command "${ghCmd}"`)
} catch (e) {
  console.error(`❌ Release creation failed. You may need to create it manually.`)
  process.exit(1)
}

console.log(`
╔══════════════════════════════════════════════════════╗
║  ✅ Axon v${newVersion} released!${' '.repeat(34 - newVersion.length)}║
║                                                      ║
║  CI is now building & attaching artifacts...          ║
║  GitHub: https://github.com/AinzDerErste/Axon        ║
║  Release: .../releases/tag/v${newVersion}${' '.repeat(25 - newVersion.length)}║
╚══════════════════════════════════════════════════════╝
`)
