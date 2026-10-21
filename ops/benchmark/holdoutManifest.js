'use strict';

// Shared, pure manifest guard for the #59 holdout tooling (Delivery Lead
// review 6315269210). Both pinned holdouts follow the same rule: a source
// version is captured and hashed first, then evaluated exactly once. Holdout-1
// keeps its existing acceptance-set state machine; holdout-2 carries its own
// explicit `unused` / `evaluated_once` state in the manifest pinned by the
// Lead before any fetch.
//
// This module never fetches, reads a provider, writes a database or publishes.
// It only validates a manifest, derives the two create-only output paths and
// normalises the sources into an evaluation plan. The scripts keep their own
// explicit `safeOutboundFetch` call, so a non-pinned host can never be read.
//
// A source used for tuning is not a holdout any more: `used_for_tuning` is
// refused here instead of being silently accepted.

const path = require('node:path');

const EVALUATION_STATES = ['unused', 'evaluated_once', 'used_for_tuning'];
const DEFAULT_MANIFEST = 'ops/benchmark/holdout-sources.json';
const MANIFEST_SUFFIX = '-sources.json';

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** The approved-host rule every capture/probe hop must pass before a fetch. */
function assertApprovedHost(url, allowedHosts) {
  const parsed = parseUrl(url);
  if (!parsed) throw new Error(`holdout refused: ${url} is not a valid URL`);
  if (parsed.protocol !== 'https:') throw new Error(`holdout refused: ${url} is not https`);
  if (parsed.username || parsed.password) throw new Error(`holdout refused: credentials in ${url}`);
  if (!Array.isArray(allowedHosts) || !allowedHosts.includes(parsed.hostname)) {
    throw new Error(`holdout refused: ${parsed.hostname} is not an approved holdout host`);
  }
}

function validateHoldoutManifest(manifest, { mode = 'evaluation' } = {}) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: ['manifest: not an object'] };
  }
  if (!nonEmptyString(manifest.version)) errors.push('manifest: version is required');
  if (!isDate(manifest.pinnedAt)) errors.push('manifest: pinnedAt must be an ISO date');
  const authorization = manifest.authorization;
  if (!authorization || typeof authorization !== 'object') {
    errors.push('manifest: authorization is required');
  } else {
    if (authorization.appProviderActivation !== false) {
      errors.push('manifest: app provider activation must remain false');
    }
    if (!nonEmptyString(authorization.reference)) errors.push('manifest: authorization reference is required');
  }
  const sources = Array.isArray(manifest.sources) ? manifest.sources : [];
  if (sources.length === 0) errors.push('manifest: at least one pinned source is required');

  const ids = new Set();
  const urls = new Set();
  for (const [index, source] of sources.entries()) {
    const where = source && nonEmptyString(source.id) ? `source ${source.id}` : `source #${index + 1}`;
    if (!source || typeof source !== 'object') {
      errors.push(`${where}: not an object`);
      continue;
    }
    if (!nonEmptyString(source.id) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/.test(source.id)) {
      errors.push(`${where}: id must be a short stable identifier`);
    } else if (ids.has(source.id)) {
      errors.push(`${where}: duplicate source id`);
    } else {
      ids.add(source.id);
    }
    if (!nonEmptyString(source.label)) errors.push(`${where}: label is required`);
    const parsed = parseUrl(source.url);
    if (!parsed) {
      errors.push(`${where}: url must be absolute`);
    } else {
      if (parsed.protocol !== 'https:') errors.push(`${where}: url must be https`);
      if (parsed.username || parsed.password) errors.push(`${where}: url must not carry credentials`);
      if (!Array.isArray(source.allowedHosts) || !source.allowedHosts.includes(parsed.hostname)) {
        errors.push(`${where}: the entry host must be one of the pinned allowedHosts`);
      }
      if (urls.has(parsed.href)) errors.push(`${where}: duplicate source url`);
      urls.add(parsed.href);
    }
    for (const host of Array.isArray(source.allowedHosts) ? source.allowedHosts : []) {
      if (!nonEmptyString(host) || host.includes('/') || host.includes(':')) {
        errors.push(`${where}: allowedHosts may only contain bare host names`);
      }
    }

    // Legacy holdout-1 sources carry no state here; holdout-2 must.
    const hasState = Object.prototype.hasOwnProperty.call(source, 'evaluationState');
    if (!hasState) continue;
    if (!EVALUATION_STATES.includes(source.evaluationState)) {
      errors.push(`${where}: evaluationState must be one of ${EVALUATION_STATES.join(', ')}`);
    }
    if (source.usedForTuning !== false) {
      errors.push(`${where}: a holdout may not be used for tuning`);
    }
    if (!Number.isInteger(source.evaluationCount) || source.evaluationCount < 0) {
      errors.push(`${where}: evaluationCount must be a non-negative integer`);
    }
    if (source.evaluationState === 'used_for_tuning') {
      errors.push(`${where}: a tuned source is no longer a holdout; pin a new holdout`);
    }
    if (mode === 'capture' && (source.evaluationState !== 'unused' || source.evaluationCount !== 0)) {
      errors.push(`${where}: capture must precede the first evaluation`);
    }
    if (mode === 'evaluation') {
      if (source.evaluationState !== 'unused') {
        errors.push(`${where}: only an unused source may be evaluated; a second evaluation is refused`);
      }
      if (source.evaluationCount !== 0) {
        errors.push(`${where}: a holdout is evaluated at most once per pinned source version`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/** True when the manifest carries its own evaluation state (holdout-2 shape). */
function isManifestDriven(manifest) {
  return (Array.isArray(manifest && manifest.sources) ? manifest.sources : [])
    .some((source) => source && Object.prototype.hasOwnProperty.call(source, 'evaluationState'));
}

/**
 * The sources to evaluate, or `null` for the legacy holdout-1 shape whose plan
 * still comes from the acceptance set. Never invents an entry: every entry
 * keeps its own pinned id, label and approved hosts.
 */
function evaluationEntriesFromManifest(manifest) {
  if (!isManifestDriven(manifest)) return null;
  return manifest.sources.map((source) => ({
    id: source.id,
    referenceId: source.id,
    label: source.label,
    url: source.url,
    allowedHosts: source.allowedHosts,
  }));
}

/**
 * Output paths are derived from the pinned manifest, never guessed per call:
 *   ops/benchmark/holdout-sources.json   -> holdout-references / -evaluation
 *   ops/benchmark/holdout-2-sources.json -> holdout-2-references / -evaluation
 * Both writers open with `flag: 'wx'`, so the pinned version cannot be
 * silently replaced by a second run.
 */
function holdoutOutputPaths(manifestPath) {
  const dir = path.dirname(manifestPath);
  const base = path.basename(manifestPath);
  const prefix = base.endsWith(MANIFEST_SUFFIX) ? base.slice(0, -MANIFEST_SUFFIX.length) : base.replace(/\.json$/i, '');
  return {
    references: path.join(dir, `${prefix}-references.json`),
    evaluation: path.join(dir, `${prefix}-evaluation.json`),
  };
}

/** Resolves `--manifest <path>` inside the repository only. */
function resolveManifestArgument(argv, repoRoot) {
  const args = Array.isArray(argv) ? argv : [];
  let value = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--manifest') {
      if (value !== null) throw new Error('--manifest may be given only once');
      value = args[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error('--manifest requires a path');
      i += 1;
    } else if (arg.startsWith('--manifest=')) {
      if (value !== null) throw new Error('--manifest may be given only once');
      value = arg.slice('--manifest='.length);
      if (!value) throw new Error('--manifest requires a path');
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  const candidate = path.resolve(repoRoot, value || DEFAULT_MANIFEST);
  const root = path.resolve(repoRoot);
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('--manifest must stay inside the repository');
  }
  return candidate;
}

module.exports = {
  DEFAULT_MANIFEST,
  EVALUATION_STATES,
  assertApprovedHost,
  validateHoldoutManifest,
  isManifestDriven,
  evaluationEntriesFromManifest,
  holdoutOutputPaths,
  resolveManifestArgument,
};

