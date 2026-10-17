# Internal Preview Acceptance

Use the isolated Supabase project `menucard-preview` (`cdlomavrysdacilakbms`,
`eu-west-1`) with Vercel's Preview environment. Production has separate
configuration. Never copy production rows, users or credentials into Preview.

The Product Owner paused `stockactalert-prod` to free a Free-plan project slot.
The project was preserved, not repurposed or deleted. Resuming it may require
freeing another active Free-plan slot. Preview may be paused by Supabase after
inactivity; do not treat a paused preview as an application regression.

## Configuration

Vercel Preview needs these four project-specific values:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`: browser config.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: server-only Secret variables.

Keep credential values out of Git, issues, screenshots and test reports.
After changing environment values, rebuild the relevant Preview deployment.
Check the deployment's environment and source commit before testing.

The initial empty preview database was bootstrapped with unchanged migrations
`0001` through `0019` from main `d8e3f16` in one transaction using the Supabase
SQL Editor. The exact executed source and versions were recorded in
`supabase_migrations.schema_migrations`. This was a preview bootstrap, not a
production migration run. Future migrations must preserve that history.

## Acceptance Workflow

An authorized preview acceptance run should finish the approved flow in one
round: inspect the contract, test representative imports, fix in-scope defects,
run relevant checks, repeat the affected scenarios, and record evidence in the
same issue/PR. A green deployment alone is insufficient evidence.

Use synthetic preview-only accounts. When the task authorizes preview writes,
test source confirmation, saved concepts, corrections, approval and rejection
there. Keep those actions separate from production release authorization.
Never configure a production GitHub export credential in Preview merely to
make a disabled publication button pass.

Check at least:

- One URL and multiple URLs, invalid input, duplicates and the 10-URL boundary.
- Current results versus reused results, and explicit fresh reanalysis.
- Dish prices, menu variants and full source routes against the original.
- Missing-price and structure blockers, explicit keep/remove decisions.
- Saving, identical-content reuse, a correction as a new immutable version,
  and approval/rejection with a fixed reason.
- Public preview versus current public menu; no public data writes.
- Role restrictions, read-only colleagues, keyboard operation and both themes
  at desktop and mobile widths.

Record source-recognition limitations explicitly. An extracted subset must
never be presented as proof that the entire source menu was recognised.
Rejected supplements must not become the main dish price. Accordion labels
must survive as source routes; an inferred panel association requires review.

Use `npm test`, `npm run test:menu-structure` and `npm run build` from the
actual reviewed head. State any baseline or environment failure with evidence;
do not call a red suite green. Windows checkout paths should be short enough
for Next's nested route output.
