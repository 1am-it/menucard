'use strict';

// BE-62 (#153, review ronde 2, punt 3) — de eerste laadgrootte van de vier
// routes uit de review, tegen origin/main.
//
// De grens is +1 KB per route. Het getal is de som van de gzip-grootte van de
// JS-bestanden die de route volgens de eigen build-manifesten als eerste laadt
// (`.next/app-build-manifest.json`), met dezelfde helper als de budgettest:
// ops/perf/lib/first-load-js.js. Zo meet je de afgeleverde bestanden zelf.
//
// De basisstand komt uit origin/main. Die wordt **niet** als git-worktree
// opgezet (review ronde 2): `git archive` pakt de commit uit in een gewone map
// buiten deze werkkopie en `node_modules` hangt daar als junction naar de
// bestaande map. Er wordt niets aan deze branch, aan `main`, aan een worktree
// of aan productie veranderd.
//
// Bewijs: ops/browser/evidence/be62-build-size-evidence.json (in git), plus de
// verse cijfers voor de drie routes van ronde 1 in
// ops/perf/evidence/be62-first-load.json.
//
// Lokaal alleen: `next build` in de basismap en in deze werkkopie.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const { firstLoadJsFromBuild } = require('../perf/lib/first-load-js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const NEXT_BIN = path.join(REPO_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const NODE_MODULES = path.join(REPO_ROOT, 'node_modules');

const EVIDENCE_PATH = path.join(__dirname, 'evidence', 'be62-build-size-evidence.json');
const PERF_EVIDENCE_PATH = path.join(REPO_ROOT, 'ops', 'perf', 'evidence', 'be62-first-load.json');

const BUDGET_BYTES = 1024;

const ROUTES = [
  { route: '/page', label: '/', perf: true },
  { route: '/menu/[id]/page', label: '/menu/[id]', perf: true },
  { route: '/r/[id]/page', label: '/r/[id]', perf: false },
  { route: '/kies/[code]/page', label: '/kies/[code]', perf: true },
];

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const found = args.filter((value) => value.startsWith(`${flag}=`)).pop();
  return found ? found.slice(flag.length + 1) : fallback;
}

const BASE_REF = argValue('--basis', 'origin/main');
const BASE_DIR = path.resolve(REPO_ROOT, '..', `be62-basis-${BASE_REF.replace(/[^a-z0-9.-]+/gi, '-')}`);

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd || REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  if (result.status !== 0) {
    const staart = `${result.stdout || ''}\n${result.stderr || ''}`.trim().slice(-2000);
    throw new Error(`${command} ${commandArgs.join(' ')} faalde (${result.status})\n${staart}`);
  }
  return result.stdout || '';
}

/** De basismap vullen zonder worktree: uitpakken uit git en een junction ernaast. */
function prepareBase(baseSha) {
  const klaar = path.join(BASE_DIR, '.git-archive-sha');
  const huidig = fs.existsSync(klaar) ? fs.readFileSync(klaar, 'utf8').trim() : null;
  if (huidig !== baseSha) {
    fs.rmSync(BASE_DIR, { recursive: true, force: true });
    fs.mkdirSync(BASE_DIR, { recursive: true });
    const tar = path.resolve(BASE_DIR, '..', `be62-basis-${baseSha.slice(0, 10)}.tar`);
    run('git', ['archive', '--format=tar', '-o', tar, baseSha]);
    run('tar', ['-xf', tar, '-C', BASE_DIR]);
    fs.rmSync(tar, { force: true });
    fs.writeFileSync(klaar, `${baseSha}\n`);
  }
  const modules = path.join(BASE_DIR, 'node_modules');
  if (!fs.existsSync(modules)) fs.symlinkSync(NODE_MODULES, modules, 'junction');
}

function build(cwd, label, { sha = null, reuseMarker = null } = {}) {
  // Hergebruik een bestaande opbouw van exact deze commit: een build van twee
  // minuten twee keer doen voegt niets toe en de review vroeg om een zuinige
  // meting.
  if (sha && reuseMarker && fs.existsSync(path.join(cwd, '.next', 'BUILD_ID')) && fs.existsSync(reuseMarker)) {
    const mark = JSON.parse(fs.readFileSync(reuseMarker, 'utf8'));
    if (mark && mark.sha === sha) {
      console.log(`hergebruik: ${label} (${cwd}) is al van ${sha.slice(0, 10)}`);
      return;
    }
  }
  console.log(`bouwen: ${label} (${cwd})`);
  const result = spawnSync(process.execPath, [NEXT_BIN, 'build'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', NEXT_DIST_DIR: '' },
  });
  if (result.status !== 0) {
    const staart = `${result.stdout || ''}\n${result.stderr || ''}`.trim().slice(-2500);
    throw new Error(`next build faalde voor ${label} (${result.status})\n${staart}`);
  }
  if (sha && reuseMarker) fs.writeFileSync(reuseMarker, `${JSON.stringify({ sha })}\n`);
}

/** Alle CSS van een build, als beeld van wat de pagina's aan stijlen meenemen. */
function cssBytes(root) {
  const dir = path.join(root, '.next', 'static', 'css');
  if (!fs.existsSync(dir)) return { files: 0, gzipBytes: 0 };
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.css'));
  const gzipBytes = files.reduce((sum, file) => sum + zlib.gzipSync(fs.readFileSync(path.join(dir, file))).length, 0);
  return { files: files.length, gzipBytes };
}

function measure(root, label) {
  const rows = ROUTES.map((entry) => {
    const measured = firstLoadJsFromBuild({ root, route: entry.route });
    if (measured.missing.length > 0) {
      throw new Error(`${label} ${entry.label}: bestanden ontbreken (${measured.missing.join(', ')})`);
    }
    if (measured.gzipBytes === 0) throw new Error(`${label} ${entry.label}: geen eerste lading gevonden`);
    return { route: entry.label, routeKey: entry.route, gzipBytes: measured.gzipBytes, files: measured.files.length };
  });
  return { rows, css: cssBytes(root) };
}


function main() {
  const baseSha = run('git', ['rev-parse', BASE_REF]).trim();
  const headSha = run('git', ['rev-parse', 'HEAD']).trim();

  prepareBase(baseSha);
  build(BASE_DIR, `basis ${BASE_REF} (${baseSha.slice(0, 7)})`, {
    sha: baseSha,
    reuseMarker: path.join(BASE_DIR, '.next', '.be62-build.json'),
  });
  build(REPO_ROOT, 'kop (HEAD)', {
    sha: headSha,
    reuseMarker: path.join(REPO_ROOT, '.next', '.be62-build.json'),
  });

  const base = measure(BASE_DIR, 'basis');
  const head = measure(REPO_ROOT, 'kop');

  const rows = ROUTES.map((entry) => {
    const baseRow = base.rows.find((row) => row.route === entry.label);
    const headRow = head.rows.find((row) => row.route === entry.label);
    const deltaBytes = headRow.gzipBytes - baseRow.gzipBytes;
    return {
      route: entry.label,
      routeKey: entry.route,
      baseGzipBytes: baseRow.gzipBytes,
      headGzipBytes: headRow.gzipBytes,
      deltaBytes,
      withinLimit: deltaBytes <= BUDGET_BYTES,
    };
  });

  const withinLimit = rows.every((row) => row.withinLimit === true);
  const record = {
    ticket: 'BE-62 (#153), review ronde 2',
    criterion: `de eerste laadgrootte groeit hooguit ${BUDGET_BYTES} bytes (1 KB) per route ten opzichte van ${BASE_REF}`,
    category: 'developer-meting uit de eigen build-manifesten van twee lokale productieopbouwen; geen browseroverdracht en geen echte acceptatie',
    method: `firstLoadJsFromBuild() uit ops/perf/lib/first-load-js.js: som van de gzip-grootte van de JS-bestanden die de route volgens .next/app-build-manifest.json als eerste laadt. Basis ${BASE_REF}: uitgepakt met "git archive" in ${path.basename(BASE_DIR)} buiten de werkkopie, node_modules als junction; geen git-worktree. Kop: next build in deze werkkopie.`,
    ranAt: new Date().toISOString().slice(0, 10),
    baseRef: BASE_REF,
    baseSha,
    headSha,
    limitBytes: BUDGET_BYTES,
    routes: rows,
    css: {
      note: 'informatie: alle CSS-bestanden van de build, niet per route. De CSS van het terugkomvlak (zoek-gerecht-block.css) zit hierin; de JS-grens hierboven is de afgesproken maat.',
      baseGzipBytes: base.css.gzipBytes,
      headGzipBytes: head.css.gzipBytes,
      deltaBytes: head.css.gzipBytes - base.css.gzipBytes,
      baseFiles: base.css.files,
      headFiles: head.css.files,
    },
    passed: withinLimit,
  };

  fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
  fs.writeFileSync(EVIDENCE_PATH, `${JSON.stringify(record, null, 2)}\n`);

  // De verse cijfers van de drie routes uit ronde 1, zodat
  // ops/perf/be62-first-load.test.js bij de nieuwste meting blijft horen.
  const perf = JSON.parse(fs.readFileSync(PERF_EVIDENCE_PATH, 'utf8'));
  perf.method = `firstLoadJsFromBuild() uit ops/perf/lib/first-load-js.js op twee productieopbouwen: ${BASE_REF} (${baseSha.slice(0, 7)}, uitgepakt met git archive en een junction naar node_modules, geen worktree) en deze branch (\`next build\`, standaard .next). Getal = som van de gzip-grootte van de JS-bestanden die de route volgens app-build-manifest.json als eerste laadt.`;
  perf.base = { commit: baseSha.slice(0, 7), note: `${BASE_REF}, uitgepakt zonder worktree, met een junction naar node_modules` };
  perf.head = { note: 'deze branch, `next build` in de eigen checkout (.next)' };
  perf.routes = ROUTES.filter((entry) => entry.perf).map((entry) => {
    const row = rows.find((item) => item.route === entry.label);
    return {
      route: entry.route,
      label: row.route,
      baseGzipBytes: row.baseGzipBytes,
      headGzipBytes: row.headGzipBytes,
      deltaBytes: row.deltaBytes,
      withinLimit: row.withinLimit,
    };
  });
  fs.writeFileSync(PERF_EVIDENCE_PATH, `${JSON.stringify(perf, null, 2)}\n`);

  console.log(JSON.stringify({ evidence: EVIDENCE_PATH, passed: withinLimit }));
  for (const row of rows) {
    console.log(`${row.withinLimit ? 'ok  ' : 'FOUT'} ${row.route}: ${row.baseGzipBytes} → ${row.headGzipBytes} bytes (${row.deltaBytes >= 0 ? '+' : ''}${row.deltaBytes})`);
  }
  if (!withinLimit) process.exitCode = 1;
}

main();
