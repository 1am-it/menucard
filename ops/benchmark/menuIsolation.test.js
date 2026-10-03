'use strict'

// BE-22 — structural proof that the menu track stays isolated, offline and
// provider-free: product code never imports ops/benchmark/, and the new
// menu modules import nothing but each other and the existing benchmark
// foundation — no network client, provider SDK, browser tool, child process,
// or environment variable.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO_ROOT = path.join(__dirname, '..', '..')
const MENU_MODULES = ['menuExtractionContract.js', 'htmlMenuStructure.js', 'htmlMenuFixtures.js', 'menuScoring.js', 'menuBenchmark.js']
const ALLOWED_MENU_IMPORTS = new Set(['./menuExtractionContract', './htmlMenuStructure', './htmlMenuFixtures', './menuScoring', './menuBenchmark', './scoring', './adapters'])
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'output'])

function sourceFiles(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(c|m)?(j|t)sx?$/.test(entry.name)) out.push(full)
  }
  return out
}

function importSpecifiers(source) {
  const specifiers = []
  const pattern = /\brequire\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*(?:[^'"()]*?\bfrom\s*)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
  let match
  while ((match = pattern.exec(source))) specifiers.push(match[1] || match[2] || match[3])
  return specifiers
}

test('no product code (src/, app/, components/, lib/, pages/) imports ops/benchmark/', () => {
  const offenders = []
  for (const dir of ['src', 'app', 'components', 'lib', 'pages']) {
    for (const file of sourceFiles(path.join(REPO_ROOT, dir))) {
      const source = fs.readFileSync(file, 'utf8')
      if (importSpecifiers(source).some((s) => /ops[\\/]+benchmark/.test(s)) || /ops\/benchmark/.test(source.replace(/\/\/.*$/gm, ''))) {
        offenders.push(path.relative(REPO_ROOT, file))
      }
    }
  }
  assert.deepEqual(offenders, [])
})

/** The single permitted Node built-in: `node:util` (for `types.isProxy`),
 * and only in the contract module. */
const EXTRA_ALLOWED_IMPORTS = { 'menuExtractionContract.js': new Set(['node:util']) }

test('the menu modules import only each other and the existing benchmark foundation (plus node:util in the contract only)', () => {
  for (const name of MENU_MODULES) {
    const source = fs.readFileSync(path.join(__dirname, name), 'utf8')
    const extra = EXTRA_ALLOWED_IMPORTS[name] || new Set()
    for (const specifier of importSpecifiers(source)) {
      assert.ok(ALLOWED_MENU_IMPORTS.has(specifier) || extra.has(specifier), `${name} imports ${specifier}`)
    }
  }
})

test('node:util is the only non-relative import in the menu modules, used once, in the contract', () => {
  const nonRelative = []
  for (const name of MENU_MODULES) {
    const source = fs.readFileSync(path.join(__dirname, name), 'utf8')
    for (const specifier of importSpecifiers(source)) if (!specifier.startsWith('./')) nonRelative.push(`${name}:${specifier}`)
  }
  assert.deepEqual(nonRelative, ['menuExtractionContract.js:node:util'])
})

test('the menu modules contain no network call, provider, browser, child process or environment access', () => {
  const forbidden = [
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /\bWebSocket\b/,
    /process\.env/,
    /child_process/,
    /require\(\s*['"](?:node:)?(?:http|https|http2|net|tls|dgram|dns)['"]/,
    /undici|axios|node-fetch|got\b|playwright|puppeteer|browserless|@anthropic-ai|openai|tesseract/i,
  ]
  for (const name of MENU_MODULES) {
    const source = fs.readFileSync(path.join(__dirname, name), 'utf8')
    for (const pattern of forbidden) assert.ok(!pattern.test(source), `${name} matches ${pattern}`)
  }
})

test('package.json gained no provider, browser or network dependency for this track', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
  for (const dep of deps) assert.ok(!/anthropic|openai|playwright|puppeteer|browserless|tesseract|cheerio|jsdom|parse5|htmlparser2/i.test(dep), dep)
})
