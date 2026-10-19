# Menu-extractie — v2-integratie (read-only aansluiting)

Status: **read-only lezers en guards aangesloten; geen v2-schrijver, DDL of
publieke wijziging.** Datum: 2026-10-19. Issue #59, branch
`feat/menu-extraction-59`, PR #60.
Ontwerp: [menu-extraction-product-schema-v2.md](../../planning/architecture/menu-extraction-product-schema-v2.md).
Deze pagina beschrijft waar receipt, review, concept, hash, audit, idempotentie
en export nu langs lopen, welke bestaande ingangen een v2-/onbekende envelope
fail-closed weigeren, en wat er **later** exact moet veranderen voordat een
v2-rij door een bestaande route mag worden geschreven.

## Wat in deze ronde is gebouwd

| Onderdeel | Bestand | Aard |
| --- | --- | --- |
| Versiegebonden schema en validator | `src/lib/menuProductSchemaV2.js` | puur; geen I/O |
| Volledig prijsbewijs per token | `src/lib/menuProductSchemaV2.js` (`quoteContainsAmount`) | puur; integerdeel, jaartal, hoeveelheid, label, ambigue notatie, voorloopdecimaal en expliciet teken zijn geen bewijs |
| Fail-closed lezer voor opgeslagen enveloppen | `src/lib/menuProductSchemaV2.js` (`readProductRecord`) | puur; bewaart de onbewerkte rij bij weigering |
| v1 → v2-mapping | `src/lib/menuProductMappingV2.js` (`mapV1ToProductV2`) | puur; verliest geen naam/prijs/pad/volgorde/bewijs |
| Verliesvrije v1-terugprojectie | `src/lib/menuProductMappingV2.js` (`projectProductV2ToV1`) | weigert met `unsupported_v1_projection` |
| Exportgeschiktheidsguard | `src/lib/menuProductMappingV2.js` (`checkProductV2ExportSuitability`) | weigert; schrijft niets |
| Oude lezer blokkeert v2 | `src/lib/menuExtractionMapping.js` | gooit een concrete `unsupported_schema_version` |
| Eén read-only integratielezer en view | `src/lib/menuProductIntegrationV2.js` | puur; detecteert receipt- en conceptenveloppen, saneert en begrenst de weergave, weigert met één concreet actiereden |
| Bestaande conceptlezer is fail-closed | `src/lib/menuConcept.js` (`storedConceptInput`) | gooit `unsupported_product_schema`; geen stille v1-terugval |
| Receipt-, review-, export- en batchguards | `src/lib/menuConceptReviewHandlers.js`, `src/lib/menuConceptExport.js`, `src/lib/menuSnapshotReviewHandlers.js`, `src/lib/batchAnalysisHandlers.js`, `app/api/internal/v1/url-intakes/route.js` | weigeren v2 vóór hash, claim, insert, update, RPC of GitHub |
| Generieke snapshotwrite | `src/lib/menuSnapshotProposals.js` (`validateSnapshotProposalInput`) en de `menu-proposals`-route | weigeren een versioned of v2-vormige `captured_content` vóór de hash en insert; een intakecontext zonder rubrieken wordt eveneens geweigerd |
| Bestaande controle/beoordeling leest v2 | `src/lib/batchAnalysis.js`, `src/lib/sourceWorkqueue.js`, `src/lib/menuConceptReviewHandlers.js`, `app/internal/source-triage/batch/MenuReview.js`, `app/internal/menu-concepts/MenuConceptsView.js` | toont varianten, glas/fles, supplementen, bewijs en dekking; alleen-lezen |
| Regressies | `src/lib/menuProductIntegrationV2.test.js`, `menuConceptV2ReviewHandlers.test.js`, `menuConceptExportV2.test.js`, `menuSnapshotReviewHandlers.test.js`, `sourceWorkqueueV2.test.js`, `menuProductV2Surface.test.js` | fictieve in-memory clients; nul echte netwerk-, database- of GitHubwrites |

De bestaande v1-invoer, routes en klikpaden blijven werken. Er is geen
v2-route, writeflag, dual-write, provider, modelcall, migratie of wijziging aan
`data/menus.json` of de publieke kaart.

## Read-only inventaris van de bestaande paden

| Artefact | Huidige opslag | Huidige schrijf-/leesroute | v2-impact | Nu gewijzigd? |
| --- | --- | --- | --- | --- |
| Receipt | `url_intake_analysis_receipts.candidate_summary` (JSONB), `analysis_result_hash` | tabel `supabase/migrations/0013_be19_url_intakes.sql:37-84`; schrijven `src/lib/batchAnalysisHandlers.js:300-325`; hash `src/lib/urlIntakeReceiptHash.js:51-62`; lezen `src/lib/batchAnalysisHandlers.js:46`, `src/lib/sourceTriageHandlers.js:22`, `src/lib/sourceWorkqueue.js:141` | Een v2-object staat als aparte, versiegebonden sleutel `candidate_summary.menuExtractionV2` naast `menus`. De bestaande lezers selecteren die sleutel nu expliciet; `menus` alleen is niet gezaghebbend meer. De hash dekt de nieuwe sleutel al via de canonieke vorm. | **ja** (lezen/guard; geen schrijver) |
| Receipt → url_intake | `url_intakes.menu_candidate_summary` | SQL `0013_be19_url_intakes.sql:387-392` en `0016_be25_batch_source_analysis.sql:810-815` projecteren letterlijk `candidate_summary -> 'menus'` | De RPC is ongewijzigd. De routes `app/api/internal/v1/url-intakes/route.js` en `app/api/internal/v1/profile-drafts/route.js` weigeren een v2-receipt nu **vóór** de RPC, zodat geen oudere/lege v1-projectie wordt opgeslagen. Versiebewuste SQL blijft een latere beslissing. | **ja** (routeguard; SQL nee) |
| Concept | `menu_snapshot_proposals.captured_content` (JSONB), `content_hash`, `version` | tabel `supabase/migrations/0011_be17_menu_snapshot_foundation.sql:36-75`; schrijven `app/api/internal/v1/menu-snapshots/route.js:104-141`; hash `src/lib/menuSnapshotHash.js:54-57` | `computeCanonicalContentHash` sorteert alle objectkeys en arrays behouden hun volgorde; een `schemaVersion` verandert de hash automatisch. De generieke write weigert nu iedere versioned/v2-vormige inhoud; `storedConceptInput` gooit fail-closed. | **ja** (lezen/guard; geen v2-write) |
| Review | receipt `menus` + `captured_content` | `src/lib/menuConceptReviewHandlers.js` (`conceptSummary`, `loadReceipt`, `detail`); `src/lib/menuProductIntegrationV2.js`; `app/internal/menu-concepts/MenuConceptsView.js` | Een v2-concept gaat door dezelfde gevalideerde lezer en wordt getoond via één begrensde, gesaneerde view. Er is geen tweede samenvatting en geen v1-afplatting; de pagina is alleen-lezen. | **ja** (read-only) |
| Reviewbeslissing | `menu_snapshot_reviews` | RPC `record_menu_snapshot_decision` (`supabase/migrations/0018_be17_menu_concept_review.sql:41`) | Ongewijzigd. `menuConceptReviewHandlers.decide` en `menuSnapshotReviewHandlers.record` weigeren een v2-rij nu vóór de RPC/insert; ook afwijzen is in deze ronde geblokkeerd. | **ja** (guard) |
| Export | `menu_snapshot_exports`, daarna GitHub-PR met `data/menus.json`/`data/restaurants.json` | `src/lib/menuConceptExport.js` (`exportMenuEntry`, `exportToReviewPr`); `src/lib/menuExport.js`; tabel `supabase/migrations/0019_be27_menu_concept_exports.sql:17-40` | De export weigert v2 nu vóór de claim, `menu_snapshot_exports`, branch, commit of GitHub-call. `checkProductV2ExportSuitability` blijft de pure ontwerplaag; geen publiek exportveld is goedgekeurd. | **ja** (guard) |
| Publieke kaart/search | `data/menus.json` → `app/menu`, `app/restaurant`, `app/nvwa`, `src/services/dishSearch` | bestaande lezers | Ongewijzigd; geen additief veld toegevoegd. | nee |
| Audit/provenance | `analysis_result_hash`, `content_hash`, `field_evidence`, `source_inventory` | `src/lib/urlIntakeReceiptHash.js`, `src/lib/menuSnapshotHash.js`, `src/lib/fieldEvidenceHash.js` | Geen nieuwe hashroute en geen extra kolom. Een toekomstige v2-schrijver moet de bestaande canonieke hash gebruiken en de versie in de inhoud dekken. | nee |
| Idempotentie/concurrency | unieke `(restaurant_id, menu_context, version)`, actieve export per snapshot/restaurant, claim/lease-RPC's | `0011:74`, `0019:36-40`, `0016:388-727` | Ongewijzigd; de v2-guards draaien vóór die mechanismen, dus een geweigerde v2-rij verbruikt geen claim, versie of exportrij. | nee |

## Aansluiting: stand en resterende stappen

1. **Compatibele lezers — uitgevoerd in deze ronde.** Receipt-, review-,
   concept-, batch-, workqueue- en exportlezers gebruiken
   `src/lib/menuProductIntegrationV2.js`. Een v2-rij wordt gevalideerd en via
   één begrensde view getoond; een onbekende versie blijft zichtbaar als
   `unsupported_schema_version`/`invalid_product_version`, met bewaarde ruwe
   rij en geblokkeerde acties `save`, `confirm`, `export`, `publish`. Er is
   geen backfill. **Bronverificatie is nog niet mogelijk**: zonder een
   geregistreerde, controleerbare brontekst/hashcontext blijft iedere v2-rij
   `sourceVerification: "unverified"` en is zij niet opslaanbaar of
   publiceerbaar.
2. **Daarna opt-in schrijvers.** Een expliciete, apart goedgekeurde v2-writeflag
   schrijft `candidate_summary.menuExtractionV2` (receipt) en
   `captured_content.schemaVersion` (concept). De bestaande `menus`-sleutel
   blijft voor v1-lezers staan; een v2-schrijver schrijft nooit een v2-object in
   `menus`. Deze flag is **niet** gebouwd of geactiveerd.
3. **Rollback.** Eerst de writer uitzetten en de compatibele reader aan laten.
   Bestaande v2-rijen blijven leesbaar en geblokkeerd waar nodig. Er is **geen
   bewezen veilige rollback naar een oude v1-only binary**: zo'n binary zou een
   v2-rij als v1 kunnen interpreteren. Daarom mag een oude binary pas terug als
   hij de versie detecteert en fail-closed blokkeert (zoals de guard in
   `src/lib/menuExtractionMapping.js` nu doet).

## Exacte SQL-aanpassingen die later nodig zijn (niet uitgevoerd)

Deze wijzigingen zijn een ontwerp van de aansluiting, geen DDL in deze ronde.
Geen migratie, backfill, RLS- of RPC-wijziging is toegepast.

- `0013_be19_url_intakes.sql:387-392` en
  `0016_be25_batch_source_analysis.sql:810-815`: de letterlijke projectie
  `candidate_summary -> 'menus'` moet versiebewust worden. Een latere migratie
  voegt bijvoorbeeld `url_intakes.product_schema_version` toe (of een
  gelijkwaardige expliciete markering) en kiest:
  - v1/geen versie → bestaande `menus`-projectie;
  - v2 → alleen de gevalideerde v2-projectie, of weigeren met een concrete
    fout. Nooit stil `menus` lezen als het object v2 is.
- `0013_be19_url_intakes.sql:362` vergelijkt `analysis_result_hash`. Zolang een
  v2-sleutel binnen `candidate_summary` valt, dekt de bestaande canonieke hash
  hem; de RPC moet dezelfde canonieke vorm blijven gebruiken. Een aparte
  kolom buiten `candidate_summary` zou een nieuwe hashbinding vragen.
- `0011_be17_menu_snapshot_foundation.sql:74`: de unieke
  `(restaurant_id, menu_context, version)` blijft leidend; een v2-concept is
  een nieuwe versie, geen overschrijving. `content_hash` dekt al de volledige
  `captured_content`, inclusief een toekomstige `schemaVersion`.
- `0019_be27_menu_concept_exports.sql:36-40`: de actieve-export-idempotentie
  blijft ongewijzigd. De exportroute moet vóór de claim/PR
  `checkProductV2ExportSuitability` aanroepen en bij een blocker geen rij,
  branch of PR maken.
- Geen nieuwe genormaliseerde tabellen, geen kolom voor
  confidence/reviewReady/approved/publicationReady, geen publieke
  `allergenStatus`/`priceVariants`-velden.

## Wat deze ronde expliciet niet doet

- Geen v2-writeflag, dual-write of nieuwe v2-route; alleen read-only
  dual-read en fail-closed guards in bestaande routes.
- Geen databasewrite, DDL, RLS-, RPC-, backfill- of migratiewijziging. De
  bestaande `url_intakes`-RPC blijft ongewijzigd; een v2-receipt wordt ervoor
  geweigerd.
- Geen wijziging aan `data/menus.json`, de publieke kaart of het exportcontract.
- Geen bronbevestiging, conceptopslag, export-PR of publicatie.
- Geen provider/model/OCR/browserplatform, geen betaalde app-AI en geen retentie-
  of privacybesluit.
- Geen claim dat de fictieve tests, de lokale browserfixture of dit document een
  echte bron → database → authenticated browseracceptatie zijn.
- Geen bewijs dat een structureel geldige v2-kaart bronbevestigd is. Die vraag
  vereist een geregistreerde brontekst/hashcontext en blijft open.

## Resterende eigenaar-besluiten

1. Provider/model, maximaal kostenbudget, DPA/EU-retentie en app-side
   AI-activering (Product Owner).
2. Een publieke allergenenstatus en een additief exportcontract
   (`priceVariants`/`allergenStatus`) of blijvend blokkeren (Product Owner).
3. De v2-writeflag, een versiebewuste `url_intakes`-RPC, eventuele latere
   normalisatie/migratie en het exportcontract (Product Owner + Delivery Lead).
   De read-only dual-read is op `0f9ea9d` gebouwd; de writer is dat niet.
4. Een nieuwe ongeziene holdout en de toegang daarvoor (Product Owner).
5. Een echte geïsoleerde preview-/schrijfronde: bron → v2-receipt → concept →
   authenticated browser, met expliciete schrijfautorisatie (Product Owner/ops).
6. Onafhankelijke review van codehead `0f9ea9d` en deze documentatie (Delivery
   Lead).

