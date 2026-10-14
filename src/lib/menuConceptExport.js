'use strict';

// BE-27 "Maak review-PR" — export an internally approved menu concept to one
// ordinary GitHub review pull request. Never a publication: nothing is
// merged, deployed or written to the database's public data; merging the
// pull request by hand is the publication (decision 016).
//
// Order (every check on the server, before anything is written):
//   1. internal role; the version the client saw is the latest version;
//   2. that version is approved internally, has no blockers, its public
//      menu was never rejected, its source is still confirmed and not
//      blocked;
//   3. an active export of this version is returned as it is (idempotent);
//      another open export for the restaurant blocks a second one;
//   4. the GitHub integration exists (otherwise a clear, non-destructive
//      refusal — no fallback);
//   5. the base on GitHub is not stale: the restaurant's menus on the base
//      branch equal the menus this concept was checked against, and the
//      concept has no blockers against them;
//   6. one complete menu for exactly this restaurant is generated and its
//      scope verified (src/lib/menuExport.js);
//   7. a pending export row claims the version (unique index, 0019), then
//      one new branch, one commit and one pull request are created. A
//      retry first looks for an open pull request carrying this version's
//      marker, so a failure halfway never leads to a second pull request.

const { isInternalOnly } = require('./importInbox');
const { liveMenuLines, buildMenuConcept, storedConceptInput } = require('./menuConcept');
const { loadLineage, wasRejectedBefore } = require('./menuConceptStore');
const { menuKeyFor, restaurantMenuEntries, buildMenuEntry, applyExport, serialize, exportScopeViolations } = require('./menuExport');

const PENDING_TIMEOUT_MS = 10 * 60 * 1000;
const EXPORT_COLUMNS = 'id, snapshot_id, restaurant_id, content_hash, export_hash, status, branch, commit_sha, pr_number, pr_url, error_reason, created_by, created_at, updated_at';
const NOT_PUBLISHED = 'Nog niet gepubliceerd. Handmatig mergen vereist.';

function reply(status, body) {
  return { status, body };
}

/**
 * The exact data/menus.json entry the review pull request writes for this
 * concept version, checked against `menus` (GitHub main at export time, the
 * deployed data/menus.json for the Publicatievoorbeeld). One function for
 * both, so the preview can never differ from what is exported. `entry` is
 * null when the version has blockers against `menus` or is incomplete.
 */
function exportMenuEntry({ snapshot, menus }) {
  const rid = snapshot.restaurant_id;
  const stored = storedConceptInput(snapshot.captured_content);
  const concept = buildMenuConcept({ menus: stored.menus, liveLines: liveMenuLines(menus, rid), edits: stored.edits });
  if (!concept.canSave) return { concept, entry: null };
  try {
    const entry = buildMenuEntry({ content: concept.content, currentEntries: restaurantMenuEntries(menus, rid), sourceUrl: snapshot.source_url, scraped: String(snapshot.created_at || '').slice(0, 10) });
    return { concept, entry };
  } catch {
    return { concept, entry: null };
  }
}

function marker(snapshotId) {
  return `<!-- menucard-export snapshot:${snapshotId} -->`;
}

/** What the page shows about an export row. */
function exportView(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    prUrl: row.pr_url || null,
    prNumber: row.pr_number || null,
    branch: row.branch || null,
    commitSha: row.commit_sha || null,
    contentHash: row.content_hash,
    exportHash: row.export_hash || null,
    createdAt: row.created_at,
    errorReason: row.error_reason || null,
  };
}

async function updateExport(supabase, id, patch, now) {
  return supabase
    .from('menu_snapshot_exports')
    .update({ ...patch, updated_at: now().toISOString() })
    .eq('id', id);
}

/** Bring an opened export up to date with GitHub (merged or closed by a human). Read-only on GitHub. */
async function refreshExport(supabase, github, row, now) {
  if (!row || row.status !== 'opened' || !github) return row;
  try {
    const state = await github.pullRequestState(row.pr_number);
    if (state === 'merged' || state === 'closed') {
      await updateExport(supabase, row.id, { status: state }, now);
      return { ...row, status: state };
    }
  } catch {
    // GitHub unreachable: keep showing the stored status.
  }
  return row;
}

async function activeExports(supabase, { snapshotId, restaurantId }) {
  const query = supabase.from('menu_snapshot_exports').select(EXPORT_COLUMNS);
  const { data, error } = snapshotId ? await query.eq('snapshot_id', snapshotId) : await query.eq('restaurant_id', restaurantId);
  if (error) return { error };
  return { rows: [...(data || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id) };
}

/** The latest export of a version, refreshed against GitHub, for the review page. */
async function exportForSnapshot(supabase, github, snapshotId, now) {
  const { rows, error } = await activeExports(supabase, { snapshotId });
  if (error) return { error };
  return { export: exportView(await refreshExport(supabase, github, rows[0] || null, now)) };
}

function createMenuConceptExportHandler({ authenticate, getSupabase, restaurants, liveMenus, computeMenuHash, github, sourceStatus, now = () => new Date() }) {
  async function authorize(request) {
    const auth = await authenticate(request);
    if (!auth || !auth.ok) return { denied: reply((auth && auth.status) || 401, { error: (auth && auth.error) || 'Niet ingelogd.' }) };
    if (!isInternalOnly(auth.roles)) return { denied: reply(403, { error: 'Alleen interne medewerkers kunnen een review-PR maken.' }) };
    return { auth };
  }

  /** POST [id]/export — "Maak review-PR". */
  async function exportToReviewPr(request, rawId) {
    const { auth, denied } = await authorize(request);
    if (denied) return denied;
    const id = /^[1-9]\d{0,15}$/.test(String(rawId)) ? Number(rawId) : null;
    if (!id) return reply(404, { error: 'Menuconcept niet gevonden.' });
    let body = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    if (!body || !Number.isInteger(body.expected_version) || body.expected_version < 1) return reply(400, { error: 'Ongeldig verzoek.' });

    const supabase = getSupabase();
    const { data: snapshot, error } = await supabase
      .from('menu_snapshot_proposals')
      .select('id, restaurant_id, menu_context, version, content_hash, captured_content, source_url, origin_receipt_id, created_at')
      .eq('id', id)
      .maybeSingle();
    if (error) return reply(500, { error: 'De review-PR kon niet worden gemaakt.' });
    if (!snapshot) return reply(404, { error: 'Menuconcept niet gevonden.' });
    const rid = snapshot.restaurant_id;
    if (!restaurants || !restaurants[rid]) return reply(409, { error: 'Dit restaurant staat niet in de statische restaurantdata.', reason: 'unknown_restaurant' });

    // 1–2. Latest, approved, complete, never rejected, source still confirmed.
    const lineage = await loadLineage(supabase, { restaurantId: rid, menuContext: snapshot.menu_context });
    if (lineage.error) return reply(500, { error: 'De review-PR kon niet worden gemaakt.' });
    const latest = lineage.versions[0];
    if (snapshot.version !== body.expected_version || (latest && latest.id !== snapshot.id)) {
      return reply(409, { error: 'Er is intussen een nieuwere versie. Laad de pagina opnieuw.', reason: 'stale_version' });
    }
    const current = lineage.versions.find((v) => v.id === snapshot.id);
    if (!current || current.status !== 'approved_internal') {
      return reply(409, { error: 'Alleen een intern goedgekeurd concept kan een review-PR krijgen.', reason: current && current.status === 'rejected' ? 'rejected' : 'not_approved' });
    }
    const stored = storedConceptInput(snapshot.captured_content);
    const deployedLines = liveMenuLines(liveMenus, rid);
    const concept = buildMenuConcept({ menus: stored.menus, liveLines: deployedLines, edits: stored.edits });
    if (!concept.canSave) return reply(409, { error: 'Dit concept heeft blokkades; een gedeeltelijke menukaart wordt nooit geëxporteerd.', reason: 'blockers', blockers: concept.blockers });
    if (wasRejectedBefore(lineage.versions, snapshot.captured_content, computeMenuHash, snapshot.id)) {
      return reply(409, { error: 'Deze menukaart is eerder afgewezen.', reason: 'previously_rejected' });
    }
    let receiptUrl = null;
    if (snapshot.origin_receipt_id) {
      const { data: receipt } = await supabase.from('url_intake_analysis_receipts').select('id, canonical_source_url').eq('id', snapshot.origin_receipt_id).maybeSingle();
      receiptUrl = receipt ? receipt.canonical_source_url : null;
    }
    const source = await sourceStatus(supabase, { restaurantId: rid, sourceUrl: snapshot.source_url, receiptUrl });
    if (source.error) return reply(500, { error: 'De review-PR kon niet worden gemaakt.' });
    if (!source.confirmed) return reply(409, { error: 'De bron van dit concept is niet (meer) bevestigd.', reason: 'source_not_confirmed' });
    if (source.blocked) return reply(409, { error: `De bron is geblokkeerd: ${source.blocked.label}.`, reason: 'source_blocked' });

    // 3. Idempotent: an active export of this version is returned; another open one for the restaurant blocks.
    const own = await activeExports(supabase, { snapshotId: snapshot.id });
    if (own.error) return reply(500, { error: 'De review-PR kon niet worden gemaakt.' });
    for (const row of own.rows) {
      const fresh = await refreshExport(supabase, github, row, now);
      if (fresh.status === 'opened' || fresh.status === 'merged') {
        return reply(200, { export: exportView(fresh), existing: true, message: fresh.status === 'merged' ? 'Deze versie is al via de review-PR gemerged.' : NOT_PUBLISHED });
      }
      if (fresh.status === 'pending') {
        if (now().getTime() - new Date(fresh.updated_at || fresh.created_at).getTime() < PENDING_TIMEOUT_MS) {
          return reply(409, { error: 'Er wordt al een review-PR voor deze versie gemaakt.', reason: 'export_in_progress' });
        }
        await updateExport(supabase, fresh.id, { status: 'failed', error_reason: 'interrupted' }, now);
      }
    }
    const others = await activeExports(supabase, { restaurantId: rid });
    if (others.error) return reply(500, { error: 'De review-PR kon niet worden gemaakt.' });
    for (const row of others.rows.filter((r) => r.snapshot_id !== snapshot.id && (r.status === 'opened' || r.status === 'pending'))) {
      const fresh = await refreshExport(supabase, github, row, now);
      if (fresh.status === 'opened' || fresh.status === 'pending') {
        return reply(409, { error: 'Voor dit restaurant staat al een andere review-PR open. Rond die eerst af.', reason: 'other_export_open', export: exportView(fresh) });
      }
    }

    // 4. The integration must exist; never a fallback.
    if (!github) {
      return reply(503, { error: 'De GitHub-koppeling ontbreekt. Er is niets gewijzigd; een review-PR maken kan pas na configuratie op de server.', reason: 'github_not_configured' });
    }

    // 5–6. Read the base, check it is not stale, generate one complete menu and verify its scope.
    let baseSha;
    let before;
    try {
      baseSha = await github.baseSha();
      const [menusText, restaurantsText] = await Promise.all([github.readFile('data/menus.json', baseSha), github.readFile('data/restaurants.json', baseSha)]);
      before = { menus: JSON.parse(menusText), restaurants: JSON.parse(restaurantsText) };
    } catch {
      return reply(502, { error: 'GitHub kon de huidige menukaart niet leveren. Er is niets gewijzigd.', reason: 'github_error' });
    }
    const baseEntries = restaurantMenuEntries(before.menus, rid);
    if (computeMenuHash(baseEntries) !== computeMenuHash(restaurantMenuEntries(liveMenus, rid))) {
      return reply(409, { error: 'De huidige menukaart op GitHub is gewijzigd sinds dit concept is gecontroleerd. Maak eerst een nieuwe conceptversie.', reason: 'base_changed' });
    }
    const { concept: againstBase, entry } = exportMenuEntry({ snapshot, menus: before.menus });
    if (!againstBase.canSave) return reply(409, { error: 'Tegen de huidige menukaart heeft dit concept blokkades.', reason: 'base_changed', blockers: againstBase.blockers });
    if (!entry) return reply(409, { error: 'Er kon geen volledige menukaart worden gemaakt; er wordt niets geëxporteerd.', reason: 'incomplete' });

    let after;
    try {
      after = applyExport({ menus: before.menus, restaurants: before.restaurants, restaurantId: rid, entry });
    } catch {
      return reply(409, { error: 'Er kon geen volledige menukaart worden gemaakt; er wordt niets geëxporteerd.', reason: 'incomplete' });
    }
    const violations = exportScopeViolations({ before, after, restaurantId: rid });
    if (violations.length > 0) return reply(500, { error: 'De export viel buiten deze ene restaurantmenukaart en is gestopt.', reason: 'scope' });
    const exportHash = computeMenuHash({ [menuKeyFor(rid)]: entry });
    if (computeMenuHash(after.menus) === computeMenuHash(before.menus) && computeMenuHash(after.restaurants) === computeMenuHash(before.restaurants)) {
      return reply(409, { error: 'De menukaart op GitHub is al gelijk aan dit concept.', reason: 'nothing_to_export' });
    }

    // 7. Claim, then one branch + one commit + one pull request.
    const { data: claimed, error: claimError } = await supabase
      .from('menu_snapshot_exports')
      .insert({ snapshot_id: snapshot.id, restaurant_id: rid, content_hash: snapshot.content_hash, export_hash: exportHash, status: 'pending', created_by: auth.userId })
      .select(EXPORT_COLUMNS)
      .maybeSingle();
    if (claimError) {
      if (claimError.code === '23505') return reply(409, { error: 'Er wordt al een review-PR voor dit restaurant gemaakt.', reason: 'export_in_progress' });
      return reply(500, { error: 'De review-PR kon niet worden gemaakt.' });
    }
    const exportId = claimed.id;
    const branch = `menu-export/${rid}-v${snapshot.version}-e${exportId}`;
    const name = restaurants[rid].name || `Restaurant ${rid}`;
    try {
      const existing = (await github.openPullRequests()).find((pr) => pr.body.includes(marker(snapshot.id)));
      let opened;
      if (existing) {
        opened = { branch: existing.branch, commitSha: existing.headSha, number: existing.number, url: existing.url };
      } else {
        const { commitSha } = await github.commitToNewBranch({
          branch,
          parentSha: baseSha,
          message: `feat(menu): ${name} — menukaart uit goedgekeurd concept (versie ${snapshot.version})`,
          files: [
            { path: 'data/menus.json', content: serialize(after.menus) },
            { path: 'data/restaurants.json', content: serialize(after.restaurants) },
          ],
        });
        const pr = await github.openPullRequest({
          branch,
          title: `Menukaart ${name} — conceptversie ${snapshot.version} (review vereist)`,
          body: [
            `Export van het intern goedgekeurde menuconcept voor **${name}** (restaurant \`${rid}\`), conceptversie ${snapshot.version}.`,
            '',
            `- \`data/menus.json\`: de menukaarten \`${Object.keys(baseEntries).join('`, `') || '—'}\` worden vervangen door één volledige \`${menuKeyFor(rid)}\` (${entry.categories.reduce((n, c) => n + c.items.length, 0)} gerechten in ${entry.categories.length} rubrieken).`,
            `- \`data/restaurants.json\`: alleen \`menuLinks\` van dit restaurant.`,
            `- Bron: ${snapshot.source_url}`,
            `- Inhoudshash concept: \`${snapshot.content_hash}\``,
            '',
            '**Nog niet gepubliceerd.** Pas na handmatige review en merge van deze PR wordt de menukaart publiek. Er wordt niets automatisch gemerged.',
            '',
            marker(snapshot.id),
          ].join('\n'),
        });
        opened = { branch, commitSha, number: pr.number, url: pr.url };
      }
      const { error: saveError } = await updateExport(
        supabase,
        exportId,
        { status: 'opened', branch: opened.branch, commit_sha: opened.commitSha, pr_number: opened.number, pr_url: opened.url },
        now
      );
      if (saveError) return reply(500, { error: 'De review-PR is gemaakt, maar niet vastgelegd. Probeer opnieuw; er komt geen tweede PR.', reason: 'record_failed', prUrl: opened.url });
      return reply(201, {
        export: exportView({ ...claimed, status: 'opened', branch: opened.branch, commit_sha: opened.commitSha, pr_number: opened.number, pr_url: opened.url }),
        existing: Boolean(existing),
        message: NOT_PUBLISHED,
      });
    } catch {
      await updateExport(supabase, exportId, { status: 'failed', error_reason: 'github_error' }, now);
      return reply(502, { error: 'GitHub gaf een fout. Er is geen review-PR gemaakt; je kunt het opnieuw proberen zonder dubbele export.', reason: 'github_error' });
    }
  }

  return { exportToReviewPr };
}

module.exports = { createMenuConceptExportHandler, exportForSnapshot, exportMenuEntry, exportView, marker, NOT_PUBLISHED };
