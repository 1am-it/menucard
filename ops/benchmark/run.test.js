'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const { main, OUTPUT_PATH } = require('./run')

test('run.js main(): writes a valid, disclaimer-carrying machine-readable report and exits without error', async () => {
  if (fs.existsSync(OUTPUT_PATH)) fs.unlinkSync(OUTPUT_PATH)
  await main()
  assert.ok(fs.existsSync(OUTPUT_PATH), 'expected an output report file to be written')
  const report = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'))
  assert.equal(report.manifestValid, true)
  assert.ok(report.disclaimer.includes('FOUNDATION'))
  assert.ok(Array.isArray(report.buckets) && report.buckets.length > 0)
})
