# Menucard - Developer Supplement

Read vendor/ai-developer, project work rules, affected CONTEXT.md, actual code
and the approved contract. Preserve app/, src/, data/, supabase/ and ops/
layout; no reorganization merely to match a template.

From package.json on the adoption base: npm test, npm run test:menu-structure,
npm run benchmark:menu-structure and npm run build exist. Verify the actual
checkout before execution. The project targets Node 22.x. Use targeted tests
during rounds and the required full/integration checks before acceptance.
After build, verify the PDF.js packaging check described in ops/CONTEXT.md
when the changed runtime requires it. Docs-only changes need link, scope and
snapshot checks; do not claim an app build ran if it did not.

Keep #53 in existing PR #56; follow its approved v3 reference and preserve the
preview-acceptance fixes already on that branch. The protocol-adoption task
itself did not authorize UI work; the explicitly assigned #53 developer may
now continue its approved contract via checkpoints/issue-53-handoff.md.
Real menu/source/concept writes need
the explicit relevant environment authorization; no automatic production use.

The existing runner has a time/turn limit. This protocol does not raise it,
resume it, or install a checkpoint hook. Save meaningful authorized work early
and report actual preservation. Never switch to a paid API without approval.
