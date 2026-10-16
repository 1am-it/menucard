'use client'

// Nieuwe import — "Websites importeren" (issue #53). The single entry for
// importing restaurant websites: one field, one "Import starten" action.
// One URL and 2–10 URLs both run through the existing, unchanged safe
// batch analysis (BE-25); staff never pick a technical mode. The batch
// page at /internal/source-triage/batch stays as a working alias.
export { default } from '../source-triage/batch/page'
