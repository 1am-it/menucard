'use strict';

// Server-side loader for the one versioned extraction instruction. It reads
// the repository file from the app root (never a chat message or a hardcoded
// machine path), hashes the exact bytes and refuses to load when the versioned
// file is missing or malformed. The text is used only to build the model
// instruction; it is never returned to a browser or written to a log.
//
// No provider is called here. Readiness stays false until a Product Owner has
// approved a provider, budget, DPA/EU processing and retention; a merely
// present environment variable is not approval.

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const PROTOCOL_FILE = 'MENU-EXTRACTION.md';
const PROTOCOL_SCHEMA_VERSION = 'menu-extraction-result/v1';
const PROTOCOL_STATUS = 'CONCEPT';
const MAX_PROTOCOL_BYTES = 64 * 1024;

const DEFAULT_EXTRACTION_LIMITS = Object.freeze({
  callTimeoutMs: 60_000,
  jobDeadlineMs: 180_000,
  maxInputTokens: 50_000,
  maxOutputTokens: 10_000,
  maxDocuments: 5,
  maxPages: 30,
  maxRetries: 1,
  maxCostEurCents: null, // null means refuse, never "unlimited"
  maxConcurrency: 1,
});

class MenuExtractionProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MenuExtractionProtocolError';
    this.code = code;
  }
}

/**
 * The instruction hash must identify the committed instruction, not the
 * checkout that happens to read it. A Windows checkout with core.autocrlf
 * returns CRLF while the Git blob (and every Linux/CI checkout) is LF; hashing
 * the raw working-tree bytes would produce two different hashes for the same
 * protocol version. Normalise line endings before hashing and before handing
 * the text to the model, so the recorded `instructionHash` is reproducible.
 */
function canonicalProtocolText(text) {
  return typeof text === 'string' ? text.replace(/\r\n?/g, '\n') : text;
}

function parseProtocol(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new MenuExtractionProtocolError('protocol_unavailable', 'MENU-EXTRACTION.md is empty.');
  }
  const status = new RegExp(`^Status:\\s*${PROTOCOL_STATUS}\\s+v(\\d+\\.\\d+)`, 'm').exec(text);
  if (!status) {
    throw new MenuExtractionProtocolError('protocol_unversioned', 'MENU-EXTRACTION.md has no CONCEPT vX.Y status line.');
  }
  return { version: status[1], status: PROTOCOL_STATUS };
}

/**
 * Reads and pins the instruction. `readFile`/`root` are injectable for tests;
 * production resolves from the Next.js app root via process.cwd().
 */
function loadMenuExtractionProtocol(options = {}) {
  const root = options.root || process.cwd();
  const file = path.join(root, PROTOCOL_FILE);
  const readFile = options.readFile || fs.readFileSync;
  let text;
  try {
    const stat = options.stat || fs.statSync;
    const info = stat(file);
    if (!info || info.size > MAX_PROTOCOL_BYTES) {
      throw new MenuExtractionProtocolError('protocol_too_large', `${PROTOCOL_FILE} exceeds the ${MAX_PROTOCOL_BYTES}-byte limit.`);
    }
    text = readFile(file, 'utf8');
  } catch (err) {
    if (err instanceof MenuExtractionProtocolError) throw err;
    throw new MenuExtractionProtocolError('protocol_unavailable', `Cannot read ${PROTOCOL_FILE}.`);
  }
  const parsed = parseProtocol(text);
  const canonicalText = canonicalProtocolText(text);
  return {
    version: parsed.version,
    status: parsed.status,
    schemaVersion: PROTOCOL_SCHEMA_VERSION,
    hash: createHash('sha256').update(canonicalText).digest('hex'),
    file: PROTOCOL_FILE,
    text: canonicalText,
  };
}

/** Metadata only — safe to store with a job. Never include the instruction text. */
function protocolMetadata(protocol) {
  if (!protocol) return null;
  return {
    instructionVersion: protocol.version,
    instructionHash: protocol.hash,
    instructionFile: protocol.file,
    schemaVersion: protocol.schemaVersion,
  };
}

/**
 * Readiness is deliberately false even when variables exist: approval is a
 * separate Product Owner decision, and no provider is configured in this
 * build. A missing/unversioned instruction is reported as its own concrete
 * reason instead of being mistaken for an empty menu.
 */
function extractionReadiness(options = {}) {
  let protocol;
  try {
    protocol = loadMenuExtractionProtocol(options);
  } catch (err) {
    return { ready: false, reason: err.code || 'protocol_unavailable', protocol: null, limits: DEFAULT_EXTRACTION_LIMITS };
  }
  const env = options.env || process.env;
  const approved = env.MENU_EXTRACTION_APPROVED === 'true';
  const providerConfigured = Boolean(env.MENU_EXTRACTION_PROVIDER && env.MENU_EXTRACTION_MODEL);
  return {
    ready: false,
    reason: approved && providerConfigured ? 'provider_activation_blocked' : approved ? 'provider_not_configured' : 'provider_not_approved',
    protocol: protocolMetadata(protocol),
    limits: DEFAULT_EXTRACTION_LIMITS,
  };
}

function withProtocolMetadata(extractionResult, protocol) {
  if (!extractionResult || typeof extractionResult !== 'object') return extractionResult;
  return { ...extractionResult, meta: { ...(extractionResult.meta || {}), ...(protocolMetadata(protocol) || {}) } };
}

module.exports = {
  PROTOCOL_FILE,
  PROTOCOL_SCHEMA_VERSION,
  DEFAULT_EXTRACTION_LIMITS,
  MenuExtractionProtocolError,
  loadMenuExtractionProtocol,
  protocolMetadata,
  extractionReadiness,
  withProtocolMetadata,
};
