# Menu-extractie — v2-integratie-inventaris (read-only)

Status: **inventaris en pure laag; geen route, geen DDL, geen schrijfactie.**
Datum: 2026-10-19. Issue #59, branch `feat/menu-extraction-59`, PR #60.
Ontwerp: [menu-extraction-product-schema-v2.md](../../planning/architecture/menu-extraction-product-schema-v2.md).
Deze pagina is de read-only inventaris die de Delivery Lead in de goedgekeurde
ronde vroeg: waar receipt, review, concept, hash, audit, idempotentie en export
nu langs lopen, en wat er **later** exact moet veranderen voordat een v2-rij
door een bestaande route mag.

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
| Regressies | `src/lib/menuProductSchemaV2.test.js`, `src/lib/menuProductMappingV2.test.js` | fictieve round-trip-, weigerings- en rollbackfixtures |

Niets hiervan is aangesloten op een route, provider, database, `data/menus.json`
of publieke kaart. De bestaande v1-invoer en routes zijn ongewijzigd.

## Read-only inventaris van de bestaande paden

| Artefact | Huidige opslag | Huidige schrijf-/leesroute | v2-impact | Nu gewijzigd? |
| --- | --- | --- | --- | --- |
| Receipt | `url_intake_analysis_receipts.candidate_summary` (JSONB), `analysis_result_hash` | tabel `supabase/migrations/0013_be19_url_intakes.sql:37-84`; schrijven `src/lib/batchAnalysisHandlers.js:300-325`; hash `src/lib/urlIntakeReceiptHash.js:51-62`; lezen `src/lib/batchAnalysisHandlers.js:46`, `src/lib/sourceTriageHandlers.js:22`, `src/lib/sourceWorkqueue.js:141` | Een v2-object hoort als aparte, versiegebonden sleutel naast `menus`, niet in het bestaande `menus`-array. De hash moet de nieuwe sleutel meenemen. | nee |
| Receipt → url_intake | `url_intakes.menu_candidate_summary` | SQL `0013_be19_url_intakes.sql:387-392` en `0016_be25_batch_source_analysis.sql:810-815` projecteren letterlijk `candidate_summary -> 'menus'` | Deze projectie mag een v2-rij niet als v1 lezen. Zij moet ofwel alleen v1-geprojecteerd blijven, ofwel een expliciete versie meekrijgen; dat is een latere beslissing. | nee |
| Concept | `menu_snapshot_proposals.captured_content` (JSONB), `content_hash`, `version` | tabel `supabase/migrations/0011_be17_menu_snapshot_foundation.sql:36-75`; schrijven `app/api/internal/v1/menu-snapshots/route.js:104-141`; hash `src/lib/menuSnapshotHash.js:54-57` | `computeCanonicalContentHash` sorteert alle objectkeys en arrays behouden hun volgorde; een `schemaVersion` in `captured_content` verandert de hash dus automatisch. Geen kolomwijziging nodig, wel een expliciete test en een leesguard. | nee |
| Review | receipt `menus` + `captured_content` | `src/lib/menuConceptReviewHandlers.js:53-55` (`conceptSummary`), `:111-112` (snapshotselect), `:268-270` (`storedConceptInput`); `src/lib/menuConcept.js:296` en `:386` | Een v2-concept moet door dezelfde gevalideerde lezer en dezelfde reviewregels gaan; geen tweede samenvatting. De bestaande `buildMenuConcept` begrijpt alleen v1. | nee |
| Reviewbeslissing | `menu_snapshot_reviews` | RPC `record_menu_snapshot_decision` (`supabase/migrations/0018_be17_menu_concept_review.sql:41`) | Ongewijzigd; een v2-rij zonder compatibele reader mag deze RPC niet bereiken. | nee |
| Export | `menu_snapshot_exports`, daarna GitHub-PR met `data/menus.json`/`data/restaurants.json` | `src/lib/menuConceptExport.js:47-58` (`exportMenuEntry`), `:142` (snapshotselect), `:241` (exportrij); `src/lib/menuExport.js:51` (`buildMenuEntry`); tabel `supabase/migrations/0019_be27_menu_concept_exports.sql:17-40` | Vóór de eerste GitHub-schrijfactie moet `checkProductV2ExportSuitability` blokkeren met `unsupported_export_construct`. Geen publiek exportveld is goedgekeurd. | nee |
| Publieke kaart/search | `data/menus.json` → `app/menu`, `app/restaurant`, `app/nvwa`, `src/services/dishSearch` | bestaande lezers | Ongewijzigd; geen additief veld toegevoegd. | nee |
| Audit/provenance | `analysis_result_hash`, `content_hash`, `field_evidence`, `source_inventory` | `src/lib/urlIntakeReceiptHash.js`, `src/lib/menuSnapshotHash.js`, `src/lib/fieldEvidenceHash.js` | Geen nieuwe hashroute; iedere toekomstige v2-schrijver moet de bestaande canonieke hash gebruiken en de versie in de inhoud dekken. | nee |
| Idempotentie/concurrency | unieke `(restaurant_id, menu_context, version)`, actieve export per snapshot/restaurant, claim/lease-RPC's | `0011:74`, `0019:36-40`, `0016:388-727` | Ongewijzigd; een v2-schrijver mag geen tweede concept of dubbele modelcall introduceren. | nee |

## Later vereiste aansluiting (in deze volgorde)

1. **Compatibele lezers eerst.** Laat receipt-, review- en exportlezers
   `readProductRecord` gebruiken. Een v2-rij wordt gevalideerd en via dezelfde
   reviewregels getoond; een onbekende versie blijft zichtbaar als
   `unsupported_schema_version`, met bewaarde ruwe rij en geblokkeerde acties
   `save`, `confirm`, `export`, `publish`. Geen backfill.
2. **Daarna opt-in schrijvers.** Een expliciete, apart goedgekeurde v2-writeflag
   schrijft `candidate_summary.menuExtractionV2` (receipt) en
   `captured_content.schemaVersion` (concept). De bestaande `menus`-sleutel
   blijft voor v1-lezers staan; een v2-schrijver schrijft nooit een v2-object in
   `menus`.
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

- Geen v2-route, writeflag, dual-read of dual-write in bestaande routes.
- Geen databasewrite, DDL, RLS-, RPC-, backfill- of migratiewijziging.
- Geen wijziging aan `data/menus.json`, de publieke kaart of het exportcontract.
- Geen bronbevestiging, conceptopslag, export-PR of publicatie.
- Geen provider/model/OCR/browserplatform, geen betaalde app-AI en geen retentie-
  of privacybesluit.
- Geen claim dat een schema/mappinglaag met fictieve tests een echte
  bron → conceptopslag of browseracceptatie is.

## Resterende eigenaar-besluiten

1. Provider/model, maximaal kostenbudget, DPA/EU-retentie en app-side
   AI-activering (Product Owner).
2. Een publieke allergenenstatus en een additief exportcontract
   (`priceVariants`/`allergenStatus`) of blijvend blokkeren (Product Owner).
3. De v2-writeflag, dual-read-uitrol en eventuele latere normalisatie/migratie
   (Product Owner + Delivery Lead).
4. Een nieuwe ongeziene holdout en de toegang daarvoor (Product Owner).
5. Onafhankelijke review van de uiteindelijke codehead (Delivery Lead).

