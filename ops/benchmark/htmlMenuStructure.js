// Promoted to product code (BE-25 fase 2): the recognizer now lives in
// src/lib/htmlMenuStructure.js and is also used by the live analysis for
// menu pages the bounded same-host discovery found. This shim keeps the
// offline benchmark's existing imports working unchanged.

'use strict'

module.exports = require('../../src/lib/htmlMenuStructure')
