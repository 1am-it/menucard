#!/usr/bin/env node
'use strict';

// The explicit, tooling-only lifecycle of a manifest-driven holdout (#59
// Delivery Lead review 6316295818):
//
//   unused -> evaluated_once -> used_for_tuning
//
// A source that is used for tuning is representative, no longer unseen. The
// transition is never a hand edit: this script verifies the pinned capture and
// the committed one-shot evaluation first, then writes the next state with the
// evidence that proves it. It never fetches, parses a menu, calls a provider,
// touches a database or publishes anything.
//
// Usage:
//   node ops/scripts/transition-menu-extraction-holdout.js --manifest ops/benchmark/holdout-2-sources.json --step evaluated_once
//   node ops/scripts/transition-menu-extraction-holdout.js --manifest ops/benchmark/holdout-2-sources.json --step used_for_tuning --decision "GitHub #59 issuecomment-..."
//
// Refuses a skipped step, a repeated step, a missing decision and any
// evaluation/reference file that does not belong to the pinned manifest.

const fs = require('node:fs');
const path = require('node:path');

const {
  validateHoldoutManifest,
  holdoutOutputPaths,
  holdoutSelectionDigest,
  repositoryTextSha256,
} = require('../benchmark/holdoutManifest');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STEPS = ['evaluated_once', 'used_for_tuning'];

function sha256(bytes) {
  return repositoryTextSha256(bytes);
}

function relative(file) {
  return path.relative(REPO_ROOT, file).split(path.sep).join('/');
}

function parseArgs(argv) {
  const args = { manifest: null, step: null, decision: null, at: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = (name) => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`);
      i += 1;
      return value;
    };
    if (arg === '--manifest') args.manifest = take('--manifest');
    else if (arg.startsWith('--manifest=')) args.manifest = arg.slice('--manifest='.length);
    else if (arg === '--step') args.step = take('--step');
    else if (arg.startsWith('--step=')) args.step = arg.slice('--step='.length);
    else if (arg === '--decision') args.decision = take('--decision');
    else if (arg.startsWith('--decision=')) args.decision = arg.slice('--decision='.length);
    else if (arg === '--at') args.at = take('--at');
    else if (arg.startsWith('--at=')) args.at = arg.slice('--at='.length);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.manifest) throw new Error('--manifest is required');
  if (!STEPS.includes(args.step)) throw new Error(`--step must be one of ${STEPS.join(', ')}`);
  const candidate = path.resolve(REPO_ROOT, args.manifest);
  const rel = path.relative(REPO_ROOT, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('--manifest must stay inside the repository');
  if (args.step === 'used_for_tuning' && !args.decision) throw new Error('--decision is required for used_for_tuning');
  if (args.step === 'evaluated_once' && args.decision) throw new Error('--decision belongs to the used_for_tuning step only');
  return { ...args, manifestPath: candidate };
}

function readJson(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} not found: ${relative(file)}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeManifest(manifestPath, manifest) {
  const tmp = `${manifestPath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(tmp, manifestPath);
}


function transitionToEvaluatedOnce({ manifestPath, manifest, manifestBytes, evaluationPath, referencesPath, at }) {
  const validation = validateHoldoutManifest(manifest, { mode: 'evaluation' });
  if (!validation.ok) throw new Error(`transition refused: ${validation.errors.join('; ')}`);

  const evaluationBytes = fs.readFileSync(evaluationPath);
  const evaluation = readJson(evaluationPath, 'evaluation');
  const references = readJson(referencesPath, 'references');
  const manifestHash = sha256(manifestBytes);
  if (!evaluation.manifest || evaluation.manifest.bytesSha256 !== manifestHash) {
    throw new Error('transition refused: the evaluation does not belong to this pinned manifest version');
  }
  if (evaluation.manifest.path !== relative(manifestPath)) {
    throw new Error('transition refused: the evaluation records another manifest path');
  }
  if (!references.manifest || references.manifest.bytesSha256 !== manifestHash) {
    throw new Error('transition refused: the capture does not belong to this pinned manifest version');
  }
  const selectionDigest = holdoutSelectionDigest(manifest);
  const evaluationSha256 = sha256(evaluationBytes);
  const evaluatedAt = typeof evaluation.evaluatedAt === 'string' ? evaluation.evaluatedAt : `${at}T00:00:00.000Z`;

  for (const source of manifest.sources) {
    const reference = references.sources && references.sources[source.id];
    const result = evaluation.results && evaluation.results[source.id];
    if (!reference) throw new Error(`transition refused: no pinned capture for ${source.id}`);
    if (!result) throw new Error(`transition refused: no evaluation result for ${source.id}`);
    if (reference.captureStatus === 'captured') {
      if (!reference.bytesSha256) throw new Error(`transition refused: ${source.id} has no capture hash`);
      if (result.pinnedBytesSha256 !== reference.bytesSha256) {
        throw new Error(`transition refused: ${source.id} was not evaluated against its pinned source version`);
      }
    }
    source.evaluationState = 'evaluated_once';
    source.evaluationCount = 1;
    source.firstEvaluatedAt = evaluatedAt.slice(0, 10);
    source.firstEvaluation = {
      path: relative(evaluationPath),
      sha256: evaluationSha256,
      evaluatedAt,
      manifestBytesSha256: manifestHash,
      selectionDigest,
      sourceBytesSha256: reference.bytesSha256 || null,
      captureStatus: reference.captureStatus || null,
    };
  }
  manifest.evaluation = {
    path: relative(evaluationPath),
    sha256: evaluationSha256,
    evaluatedAt,
    manifestBytesSha256: manifestHash,
  };
  manifest.lifecycle = {
    state: 'evaluated_once',
    decidedAt: at,
    note: 'Exactly one first evaluation per pinned source version. A later tuning use must be recorded with --step used_for_tuning.',
  };
  writeManifest(manifestPath, manifest);
  return { step: 'evaluated_once', sources: manifest.sources.length, selectionDigest, evaluationSha256 };
}



function transitionToUsedForTuning({ manifestPath, manifest, evaluationPath, decision, at }) {
  const sourceCount = Array.isArray(manifest.sources) ? manifest.sources.length : 0;
  if (sourceCount === 0) throw new Error('transition refused: the manifest has no sources');
  for (const source of manifest.sources) {
    if (source.evaluationState !== 'evaluated_once' || source.evaluationCount !== 1) {
      throw new Error(`transition refused: ${source.id} is not evaluated_once; run --step evaluated_once first`);
    }
    if (!source.firstEvaluation || source.firstEvaluation.path !== relative(evaluationPath)) {
      throw new Error(`transition refused: ${source.id} has no firstEvaluation for this evaluation file`);
    }
  }
  const evaluationBytes = fs.readFileSync(evaluationPath);
  const evaluationSha256 = sha256(evaluationBytes);
  const selectionDigest = holdoutSelectionDigest(manifest);
  for (const source of manifest.sources) {
    if (source.firstEvaluation.sha256 !== evaluationSha256) {
      throw new Error(`transition refused: the evaluation file changed since ${source.id} was recorded`);
    }
    if (source.firstEvaluation.selectionDigest !== selectionDigest) {
      throw new Error(`transition refused: the source selection changed since ${source.id} was evaluated`);
    }
    source.evaluationState = 'used_for_tuning';
    source.usedForTuning = true;
    source.tuningDecision = {
      reference: decision,
      decidedAt: at,
      note: 'This source is representative from now on; it is no longer an unseen holdout.',
    };
  }
  manifest.lifecycle = {
    state: 'used_for_tuning',
    decidedAt: at,
    reference: decision,
    note: 'Representative measurement only. A new unseen set needs a separately pinned holdout.',
  };
  manifest.representative = {
    reference: decision,
    decidedAt: at,
    evaluation: { path: relative(evaluationPath), sha256: evaluationSha256 },
    selectionDigest,
  };
  writeManifest(manifestPath, manifest);
  return { step: 'used_for_tuning', sources: manifest.sources.length, selectionDigest, evaluationSha256 };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const at = args.at || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(at)) throw new Error('--at must be an ISO date');
  const manifestBytes = fs.readFileSync(args.manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const paths = holdoutOutputPaths(args.manifestPath);

  const result =
    args.step === 'evaluated_once'
      ? transitionToEvaluatedOnce({ manifestPath: args.manifestPath, manifest, manifestBytes, evaluationPath: paths.evaluation, referencesPath: paths.references, at })
      : transitionToUsedForTuning({ manifestPath: args.manifestPath, manifest, evaluationPath: paths.evaluation, decision: args.decision, at });

  const mode = args.step === 'used_for_tuning' ? 'representative' : 'capture';
  const validation = validateHoldoutManifest(manifest, { mode });
  process.stdout.write(`${JSON.stringify({ manifest: relative(args.manifestPath), ...result, stateValidation: { mode, ok: validation.ok, errors: validation.errors } }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error && error.message ? error.message : 'holdout transition failed'}\n`);
  process.exitCode = 1;
}
