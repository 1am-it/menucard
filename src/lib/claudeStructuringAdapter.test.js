'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const { isClaudeAdapterEnabled, runClaudeStructuringAdapter } = require('./claudeStructuringAdapter')

test('isClaudeAdapterEnabled: always false — no real vendor integration exists in this build', () => {
  assert.equal(isClaudeAdapterEnabled(), false)
})

test('runClaudeStructuringAdapter: resolves { enabled: false } and never throws, regardless of input', async () => {
  assert.deepEqual(await runClaudeStructuringAdapter(undefined), { enabled: false })
  assert.deepEqual(await runClaudeStructuringAdapter({ html: '<html></html>' }), { enabled: false })
  assert.deepEqual(await runClaudeStructuringAdapter(null), { enabled: false })
})

// ─── Structural safety net ───────────────────────────────────────────────

test('structural safety net: never performs any network call or reads any secret/environment variable', () => {
  const source = fs.readFileSync(require.resolve('./claudeStructuringAdapter.js'), 'utf8')
  assert.doesNotMatch(source, /fetch\(|http\.|https\.|process\.env|require\(['"]node:https?['"]\)/)
})

test('structural safety net: never imports safeOutboundFetch or any HTTP client module', () => {
  const source = fs.readFileSync(require.resolve('./claudeStructuringAdapter.js'), 'utf8')
  assert.doesNotMatch(source, /safeOutboundFetch/)
})

test('structural safety net: contains no API key, secret, or vendor SDK import', () => {
  const source = fs.readFileSync(require.resolve('./claudeStructuringAdapter.js'), 'utf8')
  assert.doesNotMatch(source, /api[_-]?key/i)
  assert.doesNotMatch(source, /require\(['"]@anthropic-ai/)
})
