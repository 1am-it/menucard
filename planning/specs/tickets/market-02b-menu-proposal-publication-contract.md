# MARKET-02B — Menu Proposal & Publication Contract

## Status

Proposed, **not started**. Documentation/schema contract only — no code,
route, migration, database, account, mockup, commit, push, or deploy
action exists yet for anything described here.

## Depends on

`MARKET-02` (`docs/api/canonical-restaurant-menu-schema.md` — the
`CanonicalMenu`/`CanonicalMenuSection`/`CanonicalMenuItem`/`Money`/
`FieldAssertion`/`SourceReference` shapes this ticket reuses, never
redefines), `docs/api/data-trust-model.md` (`PLATFORM-03` — the
`source`/`confidence`/`verified_at`/`verified_by` vocabulary this ticket
reuses exactly), `[[011-market-foundation-and-international-growth]]`
(§5 governance — "users, owners, and community members never mutate
canonical or published data directly," §9 risk-sensitive data, §10 data
separation), `[[002-text-first-no-images]]`.

Reads, but does not modify: `supabase/migrations/0001_field_provenance.sql`,
`0002_pending_changes.sql`, `0003_restaurant_claims.sql`,
`docs/api/restaurant-profile-drafts-schema.md` (`MARKET-05C`),
`docs/api/import-run-schema.md` (`MARKET-04`/`04A`),
`planning/specs/tickets/market-04b-controlled-csv-jsonl-intake.md`,
`planning/specs/tickets/platform-08b-community-evidence-submissions.md`,
`planning/specs/tickets/platform-06-moderation-review-queue.md`,
`planning/specs/tickets/platform-08-community-microtask-contributions.md`,
`data/menus.json`. **Not** dependent on `MARKET-05B` (cross-source
restaurant deduplication — a separate, still-blocked concern; see
"Relationship to `MARKET-05B`" below) — this ticket does not wait for it
and does not touch its scope.

## Problem

MenuCard has four menu-adjacent contentlagen today, and none of them
connect:

- **`data/menus.json`** — the only place a complete, structured menu
  (secties, items, prijzen, allergenen) actually lives. Fully outside the
  trust/provenance system: no `field_provenance` row, no `pending_changes`
  row, no `ImportRun` origin for any of it.
- **`pending_changes`/`field_provenance`** (`PLATFORM-03`/`06`) — a real,
  live, append-only proposal/provenance flow, but its `field_name` check
  constraint is exactly `'price', 'openingHours', 'reservationMethod',
  'itemAvailability', 'allergens'` — five **scalar** restaurant-level
  fields. **No value for "menu" exists**, and no mechanism exists for a
  multi-item, multi-section structure to move through this pipeline as
  one coherent unit.
- **`restaurant_profile_drafts`/`_field_facts`** (`MARKET-05C`) — a real,
  live append-only draft/fact ledger, but scoped to
  `name/category/address/phone/website`: restaurant *identity*, not menu
  *content*. Its `status in ('draft', 'discarded')` model (no
  `published`/`live` value — "publication does not exist yet" per its own
  schema doc) is a directly relevant precedent, not a competing model.
- **`docs/api/canonical-restaurant-menu-schema.md`** (`MARKET-02`) — the
  only design that already models a full menu with item-level provenance
  (`CanonicalMenuItem`, `Money`'s four explicit pricing states,
  `FieldAssertion.field_path`, `SourceReference` as a referenced, never
  copied, factual origin). **Documentation-only** — nothing in the app
  constructs, stores, reads, or moderates this shape today.

The result: a registered import source (`MARKET-04B`), a verified owner
(`PLATFORM-07`'s `restaurant_claims`), or a moderator acting on community
evidence (`PLATFORM-08B`) can each, today, produce at most a handful of
*scalar* proposals — never a coherent, reviewable, publishable menu.
There is no schema, status model, or moderation surface for "here is a
whole menu (or a bounded revision to one), please review it as one
unit," and no canonical, provenance-bearing storage location for the
result once approved. This ticket closes that specific, named gap —
contract only, per this project's own `MARKET-01`–`05C` precedent of
deciding the shape before any implementation.

## Objective

Define, contract-first, a schrijfbaar, modereerbaar, en auditbaar
`MenuProposal`-model plus een canonieke publicatielaag voor complete,
gestructureerde menukaarten — zodat een geregistreerde bron, een
geverifieerde eigenaar, of een moderator met communitybewijs een
volledige kaart (of een afgebakende wijziging erop) kan voorstellen,
laten beoordelen, en pas na een expliciete menselijke beslissing laten
publiceren. Geen implementatie, geen migratie, geen UI — alleen het
contract en de bijbehorende overgangs-/beleidsbeslissingen.

De harde productregel, letterlijk overgenomen uit
`[[011-market-foundation-and-international-growth]]` §5 en ongewijzigd
van toepassing op menu-inhoud:

> Bronnen, eigenaren en communityleden dienen voorstellen in. Alleen een
> expliciete, menselijke moderatie/publicatiestap kan canonieke publieke
> menu-inhoud wijzigen.

## User story

Als moderator die een geregistreerde bron, een eigenaaraanlevering, of
een uit communitybewijs geëxtraheerde kaart beoordeelt, wil ik één
coherente kaart (secties, items, prijzen, allergenen, bronvermelding) in
zijn geheel kunnen zien, goedkeuren of afwijzen — niet veertig losse
veldwijzigingen die onafhankelijk van elkaar goedgekeurd kunnen worden en
zo een innerlijk inconsistente kaart kunnen opleveren.

## Non-goals (expliciet buiten scope voor dit ticket)

- **Geen migratie, tabel, RPC, route, of Supabase-wijziging.** Dit ticket
  **is** het schemacontract, net als `MARKET-02` dat voor het canonical
  restaurant/menu-schema was — geen implementatie hier, exact dezelfde
  discipline.
- **Geen directe of stille wijziging aan `data/menus.json`.** Zie
  "Verhouding tot `data/menus.json`" — alleen contract- en
  overgangsbeslissingen worden hier vastgelegd, geen migratiescript.
- **Geen wijziging aan `MARKET-05B`'s scope.** Cross-source
  restaurant-deduplicatie blijft een apart, ongewijzigd vraagstuk — zie
  "Relationship to `MARKET-05B`."
- **Geen nieuwe UI, mockup, OCR, uploadflow, externe dienst, of
  dependency.** Zie "Mockupgrens."
- **Geen automatische publicatie, publieke menufoto's, of publieke PDF's
  in deze fase.** Zie "Harde grenzen."
- **Geen scraping of extractie zonder vooraf geregistreerde bron.** Dit
  ticket voegt geen nieuwe bronrechten toe — het hergebruikt exact
  `MARKET-03`'s bestaande bronregistratie-eis.
- **Geen wijziging aan de bestaande scalaire velden.** `price`,
  `openingHours`, `reservationMethod`, `itemAvailability`, `allergens` op
  restaurantniveau blijven precies zoals `pending_changes`/
  `field_provenance` ze vandaag al ondersteunen — dit ticket voegt een
  *nieuw*, apart menu-niveau contract toe, het overschrijft of vervangt
  het bestaande scalaire model niet.

## Relationship to `MARKET-05B`

`MARKET-05B` (nog steeds een niet-ontworpen, geblokkeerde placeholder —
zie `market-05-normalization-deduplication.md`) gaat over het matchen en
samenvoegen van **restaurant-kandidaten** over meerdere bronnen heen, vóór
een canoniek restaurant bestaat. `MARKET-02B` gaat over **menu-inhoud**
voor een reeds bestaand, geïdentificeerd restaurant. Deze twee raken
elkaar niet: een menuvoorstel veronderstelt een reeds bekend
`restaurant_id` (statisch vandaag, canoniek zodra `MARKET-02`/`05B` ooit
geïmplementeerd worden) en wacht niet op `05B`'s eigen, ongerelateerde
deduplicatielogica. Dit ticket voegt aan `05B` niets toe en neemt er
niets van weg.

## Contractvragen

### 1. `MenuProposal` als coherente eenheid

Een `MenuProposal` bundelt, als één record (niet als losse rijen die
onafhankelijk goedgekeurd kunnen worden):

| Veld | Doel | Herkomst van het patroon |
|---|---|---|
| `id` | Immutable identiteit | Zelfde discipline als elk canoniek id in dit project |
| `restaurant_id` | Welk restaurant | Zelfde vorm als `pending_changes.restaurant_id`/`restaurant_claims.restaurant_id` — vandaag tekst (statische json-id), canoniek zodra `MARKET-01`/`02` bestaan |
| `proposal_scope` | `full_menu_snapshot` \| `bounded_revision` | Zie "Atomiciteit" hieronder — een expliciet, benoemd onderscheid, geen impliciete aanname |
| `sections[]` → `items[]` | De eigenlijke menu-inhoud, als een geneste, in-document structuur binnen het voorstel (niet losse rijen per item op het moment van *voorstellen* — zie "Atomiciteit") | `CanonicalMenuSection`/`CanonicalMenuItem` (`MARKET-02`), ongewijzigd hergebruikt qua veldvorm |
| `price` per item | `Money` — alle vier bestaande expliciete staten (`known`/`multiple_undecomposed`/`on_request`/`unknown`) | `MARKET-02` §4a, letterlijk hergebruikt, geen nieuwe staat |
| `allergens[]` per item | `{scheme, code}[]` | `MARKET-02` §4b, letterlijk hergebruikt — zie de "Allergenen-adapter"-paragraaf direct onder deze tabel voor de vereiste drie-statenbetekenis die de toekomstige adapter moet kunnen behouden |
| `availability` per item | `{status, valid_from?, valid_to?}` | `MARKET-02` §4, letterlijk hergebruikt |
| `source_references[]` | Verwijzingen naar `SourceReference`-identiteiten, nooit kopieën | `MARKET-02` §5/§6, letterlijk hergebruikt — inclusief het bestaande vereiste dat `source_id` een geregistreerde `MARKET-03`-bron moet zijn |
| `status` | `pending` \| `approved` \| `rejected` \| `superseded` \| `stale` | Zie "Moderatie" hieronder — `superseded`/`stale` zijn nieuw ten opzichte van `pending_changes`'s drieledige model, expliciet gemotiveerd daar |
| `proposed_source` | `owner` \| `community` \| `editor` \| `imported` \| `unknown` | Exact `data-trust-model.md`'s bestaande enum, geen nieuwe waarde |
| `proposed_by` | Nullable actor-referentie | Zelfde vorm als `pending_changes.proposed_by`/`restaurant_claims.user_id` — nullable omdat een moderator-ingevoerd voorstel (uit communitybewijs, zonder account, per `PLATFORM-08B`) geen `auth.users`-rij heeft om naar te verwijzen |
| `version` | Monotoon oplopend per restaurant | Zie "Atomiciteit" — voorkomt een race tussen twee gelijktijdige voorstellen op dezelfde actieve kaart |
| `idempotency_key` | Voorkomt dubbele inzending van exact dezelfde bron-batch | Zelfde patroon als `ImportRun.idempotency_key` (`MARKET-04`), toegepast op een enkel voorstel in plaats van een hele run |
| `created_at`/`decided_at`/`decided_by`/`decision_note` | Audit | Letterlijk `pending_changes`'s bestaande vorm |

**Wat dit ticket bewust niet doet**: een fysieke tabellenstructuur
voorschrijven (één brede jsonb-kolom versus genormaliseerde
sectie-/itemrijen is een implementatiekeuze, niet hier beslist — exact
dezelfde "logical, not physical"-discipline als `MARKET-02` zelf al
hanteert).

**Allergenen-adapter — drie semantische toestanden, niet hier opgelost.**
De huidige, live allergenenweergave (`data/menus.json`/
`app/nvwa/[id]/NvwaView.js`) draagt vandaag al drie te onderscheiden
betekenissen per item: `null` (onbekend/nog niet vastgelegd, getoond als
`?`), een gevulde array (één of meer expliciet geregistreerde
allergenen), en een leeg array `[]` (vandaag ambigu — zie hieronder
waarom dat een probleem is). Wanneer een adapter/migratie tussen deze
weergave en de canonieke `{scheme, code}[]`-vorm ooit wordt ontworpen,
moet die drie semantische toestanden per item kunnen behouden: (a)
onbekend of nog niet vastgelegd, (b) expliciet gecontroleerd en geen
allergenen geregistreerd, en (c) één of meer expliciet geregistreerde
allergenen. Een kale `{scheme, code}[]`-array kan dit onderscheid niet
uit zichzelf dragen. Zie "Harde grenzen" voor de bijbehorende
veiligheidsgrens en "Open questions" voor waar de exacte
adapteroplossing wordt opengelaten. **Dit ticket ontwerpt die adapter
niet** — het legt uitsluitend vast welke betekenis hij verplicht moet
kunnen behouden; de bestaande consumentweergave, berekening, en
legacydata blijven hierdoor ongewijzigd en buiten scope.

### 2. Voorkomen van een half-goedgekeurde kaart

**Atomiciteit.** Eén `MenuProposal` is één ondeelbare beoordelingseenheid:
een moderator keurt de hele kaart (of de hele afgebakende wijziging) goed
of af, nooit sectie-voor-sectie of item-voor-item los. Dit is een directe
consequentie van `[[011-market-foundation-and-international-growth]]`
§9's risicogevoelige-velden-principe toegepast op een structuur in plaats
van een los veld: een kaart waarin de helft van de prijzen is
goedgekeurd en de andere helft nog "pending" is, is een reëel,
gebruikersgevaar (te vertrouwen prijs naast een nog-onbevestigde), niet
een acceptabele tussentoestand.

**`proposal_scope`-onderscheid**:
- `full_menu_snapshot` — een compleet vervangend voorstel voor de hele
  actieve kaart van een restaurant (bijv. eerste digitalisering, of een
  seizoenswissel). Bij goedkeuring vervangt dit de volledige actieve
  canonieke menuversie.
- `bounded_revision` — een afgebakende wijziging op de reeds actieve
  kaart (bijv. "twee nieuwe gerechten," "één prijswijziging op itemniveau
  binnen een bestaande sectie"). Bij goedkeuring wordt dit toegepast
  bovenop de actieve versie, niet als vervanging ervan — vergelijkbaar
  met hoe `restaurant_profile_draft_field_facts` losse feiten toevoegt
  aan een bestaand draft zonder het geheel te vervangen.

Een `bounded_revision` mag alleen worden ingediend tegen de op dat moment
actieve `version` van de kaart van dat restaurant; een `full_menu_snapshot`
vervangt de actieve versie in zijn geheel bij goedkeuring. Beide typen
delen dezelfde moderatie-workflow (zie punt 4) — het onderscheid zit
alleen in *wat er gebeurt bij goedkeuring*, nooit in het beoordelingspad.

**Oude kaarten worden nooit stil overschreven.** Elke goedgekeurde
`MenuProposal` produceert een nieuwe, genummerde canonieke menuversie
(`version`, monotoon oplopend); de vorige actieve versie krijgt een
expliciete `superseded_by`-verwijzing en blijft leesbaar als historisch
record — hetzelfde "nooit muteren, altijd een nieuwe rij" principe als
`import_candidate_reviews`/`import_candidate_enrichments` (`MARKET-05A`)
al bewijzen te werken voor append-only auditlogs. Precies één versie per
restaurant is op enig moment "actief" (analoog aan
`restaurant_profile_drafts`'s partial-unique-index-patroon voor "hoogstens
één actieve draft per kandidaat").

### 3. De canonieke publicatielaag

Vier duidelijk gescheiden concepten, nooit vermengd:

| Concept | Wat het is | Wie het ziet |
|---|---|---|
| **`MenuProposal`** | Het voorstel zelf, in elke status | Alleen internal/editor (moderatie), nooit consumenten |
| **Moderatiebesluit** | `approved`/`rejected` + `decided_by`/`decided_at`/`decision_note` | Alleen internal/editor — hetzelfde append-only besluitpatroon als `approve_pending_change`/`approve_restaurant_claim`'s RPC's |
| **Actieve canonieke menuversie** | De laatst goedgekeurde, samengestelde staat van de kaart van één restaurant | Server-side, niet direct publiek — de laag waar een consumentroute uit leest |
| **Publicatiestatus** | Of de actieve canonieke versie daadwerkelijk zichtbaar is voor consumenten (bijv. een `published_at`/`unpublished`-vlag, los van "goedgekeurd") | Publiek, via de consumentroute |

**Waarom moderatiebesluit en publicatiestatus apart blijven**: een
goedgekeurde menuversie hoeft niet automatisch, op hetzelfde moment,
publiek zichtbaar te worden (bijv. een embargo tot een geplande opening,
of een laatste handmatige controle) — exact dezelfde reden waarom
`restaurant_profile_drafts`'s eigen schemadocument een `published`/`live`
waarde bewust nog niet heeft toegevoegd ("publication does not exist yet
in this phase"). Dit ticket volgt diezelfde terughoudendheid: het
*contract* voor een publicatiestatus wordt hier vastgelegd, het
*mechanisme* (wanneer/hoe iets automatisch of handmatig publiceert) is
een latere, aparte implementatiebeslissing.

**Consumentroutes lezen uitsluitend de actieve, gepubliceerde canonieke
versie** — nooit `MenuProposal`-rijen in welke status dan ook, en nooit
een `rejected`/`superseded`/`stale` versie. Dit is dezelfde harde
scheiding die `MARKET-05A`'s eigen pipeline-tabel al vastlegt voor
importkandidaten ("Never: canonical tables, public snapshots") toegepast
op menu-inhoud.

**Per-sectie/item provenance zonder interne informatie te lekken**: de
publieke laag toont `source`/`confidence`/`verified_at` per risicogevoelig
veld (prijs, allergenen, beschikbaarheid) — exact `data-trust-model.md`'s
bestaande statuslabel-mapping (Owner verified / Community confirmed /
Editor verified / Imported / Stale), nooit de onderliggende
`SourceReference.source_locator` wanneer die een privaat evidence-asset is
(bijv. een communityfoto, per `PLATFORM-08B`) — alleen het feit dat een
bron bestaat en wanneer die is geverifieerd, nooit een link naar of kopie
van het brondocument zelf wanneer dat niet publiek toegankelijk is.

### 4. Verhouding tot `data/menus.json`

**Geen directe of stille vervanging.** `data/menus.json` blijft de
huidige, werkende consumentendatabron totdat een expliciet, apart
goedgekeurd overgangsbesluit iets anders bepaalt — exact dezelfde
terughoudendheid als `planning/decisions/010-platform-persistence-and-api.md`
al vastlegt voor de bestaande Supabase-migratie ("data/restaurants.json
and data/menus.json are explicitly untouched/unmigrated by this
decision").

**Compatibiliteitsrichting, niet een migratieplan**: dit ticket legt vast
*dat* een toekomstige, aparte migratieronde nodig is om (a) elk bestaand
`data/menus.json`-record een `legacy_ids`-vermelding te geven (zelfde
patroon als `MARKET-02`'s eigen Breda-retroactieve-mapping-sectie), en (b)
een conservatieve, eerlijke retroactieve `MenuProposal`/canonieke-versie
voor elk bestaand menu te construeren zonder verzonnen zekerheid over
bron of verificatie toe te voegen — maar **stelt geen migratiescript, geen
tijdlijn, en geen automatische conversie voor**. Dat blijft, net als
`MARKET-02`'s eigen Breda-mapping ooit deed, een expliciete, latere,
apart goedgekeurde stap.

**Cutover is een expliciete schakelaar, geen geleidelijke sluipende
overgang**: totdat een canonieke, gepubliceerde menuversie voor een
gegeven restaurant bestaat, blijft de consumentroute voor dat restaurant
uit `data/menus.json` lezen; zodra een canonieke versie voor dat
restaurant is gepubliceerd, leest de consumentroute daarvandaan. Beide
databronnen bestaan dus tijdelijk naast elkaar, per restaurant, nooit
gemengd binnen één restaurant se kaart. De precieze routeringslogica
hiervoor is een implementatiedetail voor een latere ticket, niet hier
uitgewerkt.

### 5. Behandeling van bronnen

- **Geregistreerde importbronnen** (`MARKET-04`/`04B`): een
  `MenuProposal` met `proposed_source: 'imported'` kan alleen ontstaan uit
  data die via een geregistreerde `Source`/`SourceAuthorizationVersion`
  is binnengekomen — dezelfde `MARKET-03`-registratie-eis die
  `MARKET-04B` al hard afdwingt. Dit ticket voegt geen nieuwe
  bronrechten toe; het definieert alleen hoe zulke data, eenmaal binnen,
  een menuvoorstel kan worden in plaats van dood te lopen op
  `pending_changes`'s scalaire beperking.
- **Geverifieerde eigenaren** (`PLATFORM-07`): een `owner`-`staff_roles`-rij
  geeft, exact zoals vandaag, geen enkel direct publicatierecht — een
  eigenaar die een eigen kaart aanlevert dient een `MenuProposal` in met
  `proposed_source: 'owner'`, die **hetzelfde moderatietraject** doorloopt
  als elke andere bron. Het enige verschil is trust-niveau/snelheid van
  beoordeling (`owner` → hoge confidence, per `data-trust-model.md`'s
  bestaande mapping), nooit een omzeiling van moderatie.
- **Communitybewijs — menukaartlink (`PLATFORM-08B`), het lichte,
  geprefereerde pad**: een goedgekeurde, officiële `https://`-menukaartlink
  blijft, ook na beoordeling, uitsluitend **bronbewijs** — nooit
  automatische content-invoer en nooit vanzelf een `MenuProposal`. Een
  moderator mag de link wél **handmatig bezoeken** en de daar aangetroffen,
  gestructureerde menu-inhoud zelf overtypen als een nieuw `MenuProposal`
  (`proposed_source: 'community'`), met die URL als `SourceReference` —
  exact hetzelfde "mens typt een waarde over, met de bron-URL erbij"-patroon
  dat `import_candidate_enrichments` (`MARKET-05A`) al bewijst te werken
  voor restaurantvelden, hier toegepast op menu-inhoud in plaats van een
  foto. Dit pad wacht **niet** op enige fotobewijs-, opslag-, of
  OCR-capability — het heeft die nooit nodig, omdat er geen bestand, geen
  EXIF, en geen privacygevoelig beeldmateriaal bij komt kijken. Net als
  elk ander `MenuProposal` doorloopt het dezelfde moderatie-workflow (zie
  "Moderatie" hieronder): geen automatische fetch, preview, scraping,
  kopie, extractie, PDF-herpublicatie, of directe publicatie. Zie "Fase 1"
  hieronder voor waar dit pad qua fasering hoort.
- **Communitybewijs — fotobewijs (`PLATFORM-08B`), het zwaardere, latere
  pad**: blijft **uitsluitend privaat bewijs** — nooit een publieke
  menufoto, nooit een automatische publicatiebron. Een `MenuProposal` met
  `proposed_source: 'community'` kan hier ook alleen ontstaan via een
  **moderator die het bewijs interpreteert en handmatig invoert** —
  hetzelfde patroon als hierboven, nu toegepast op een foto in plaats van
  een link. Er is geen geautomatiseerd of AI-gegenereerd pad van foto naar
  `MenuProposal` in dit ticket. Anders dan de menukaartlink hierboven
  blijft dit pad afhankelijk van `PLATFORM-08B`'s eigen private-opslag-/
  EXIF-/privacycapability voor fotobewijs — zie "Fase 2" hieronder voor dat
  afzonderlijke, zwaardere traject.
- **Geen kopie van een bronbestand.** Een `SourceReference` binnen een
  `MenuProposal` verwijst naar een bron-identiteit en (waar van
  toepassing) een privaat evidence-asset — nooit een gekopieerde tekst,
  lay-out, of afbeelding uit het brondocument zelf. Dit is `MARKET-02`
  §6's bestaande principe ("a set of references, never copies"),
  hier expliciet herbevestigd voor menu-inhoud specifiek omdat dat de
  plek is waar de verleiding tot kopiëren het grootst is (een volledig
  gefotografeerde kaart "overtypen" is geen kopiëren, maar het brondocument
  zelf publiceren wel).
- **Een bron-URL, publieke toegankelijkheid, of eigenaarclaim geeft op
  zichzelf geen publicatierecht.** Dat een menupagina, PDF, of foto
  publiek raadpleegbaar is, geeft het recht om de erin voorkomende
  *feiten* te verifiëren en als eigen gestructureerde data voor te
  stellen — nooit het recht om de tekst, lay-out, PDF, of afbeelding zelf
  opnieuw te publiceren. Een goedgekeurde eigenaarclaim geeft evenmin
  automatisch dat recht — zie hieronder.
- **Publieke beeldweergave is een aparte, expliciete opt-in op
  assetniveau.** Een eigenaar mag toestemming geven om een specifieke
  foto/PDF ooit publiek te tonen, maar dat is een los,
  `consent_for_public_display`-achtig veld op het evidence-asset zelf —
  nooit impliciet afgeleid uit "deze eigenaar heeft een goedgekeurde
  claim" of "dit voorstel is goedgekeurd." Extractie-toestemming (mag dit
  bewijs gebruikt worden om feiten uit te halen) en
  weergave-toestemming (mag het beeld zelf getoond worden) zijn twee
  losse beslissingen, nooit aan elkaar gekoppeld.

### 6. Moderatie

- **Statussen**: `pending` (net ingediend, nog niet beoordeeld),
  `approved` (menselijk goedgekeurd, is of wordt de actieve canonieke
  versie), `rejected` (afgewezen, met verplichte reden), `superseded`
  (was ooit `approved`, inmiddels vervangen door een nieuwere goedgekeurde
  versie voor hetzelfde restaurant — nooit verwijderd), `stale` (een
  `pending` voorstel dat is achterhaald doordat de kaart waartegen het was
  ingediend inmiddels is vervangen door een ander, later goedgekeurd
  voorstel — zie "Bronconflict" hieronder).
- **Afwijsredenen**: een vaste, benoemde set (bijv.
  `incomplete_data`/`unauthorized_source`/`duplicate_submission`/
  `quality_concerns`/`other`) — zelfde discipline als
  `import_candidate_reviews`'s vaste `rejection_reason`-set, exacte
  waarden een latere implementatiebeslissing.
- **Bronconflict**: twee gelijktijdig `pending` voorstellen voor
  hetzelfde restaurant worden nooit beide stilzwijgend verwerkt — het
  goedkeuren van het ene zet elk ander, nog-`pending` voorstel voor
  dezelfde kaart automatisch op `stale` (nooit `rejected` — het was niet
  inhoudelijk fout, het is alleen ingehaald), zodat een moderator het
  expliciet opnieuw moet beoordelen tegen de nieuwe actieve versie in
  plaats van een verouderd voorstel per ongeluk goed te keuren.
- **Veroudering**: een `pending` voorstel dat lang genoeg onbehandeld
  blijft, wordt gemarkeerd als aandachtspunt voor reviewschaal (dezelfde
  "technische capaciteit versus menselijke reviewcapaciteit"-discipline
  als `MARKET-04B`/`MARKET-11` al benoemen) — geen automatische afwijzing
  of goedkeuring op basis van tijd.
- **Auditlog**: elk moderatiebesluit is een append-only rij, nooit een
  mutatie van het voorstel zelf — exact `approve_pending_change`/
  `approve_restaurant_claim`'s bestaande RPC-patroon (één atomaire
  transactie: voorstelstatus + eventuele publicatie/versie-omzetting
  slagen of falen samen).
- **Geen automatische goedkeuring, OCR-publicatie, of directe
  eigenaarspublicatie.** 100% menselijke moderatie voor elk
  `MenuProposal`, ongeacht bron of trust-niveau — zelfde principe als
  `PLATFORM-08`/`08B` al hard vastleggen voor scalaire/evidence-voorstellen,
  hier ongewijzigd toegepast op menu-niveau.

## Harde grenzen

- Geen automatische publicatie van welk voorstel dan ook, ongeacht bron
  of trust-niveau.
- Geen publieke menufoto's of PDF's in deze fase.
- Geen scraping of extractie zonder vooraf geregistreerde bron
  (`MARKET-03`), bronvoorwaardencontrole, en expliciet toegestane
  gebruiksdoelen.
- Geen aanname dat individuele menufeiten, openbare menu-URL's, of een
  restaurantclaim onbeperkte herpublicatie toestaan.
- Geen wijziging aan `MARKET-05B`'s scope.
- Geen nieuwe UI, OCR, uploadflow, externe dienst, of dependency in deze
  ticketfase.
- Geen restaurantfoto's op primaire discovery-oppervlakken
  (`[[002-text-first-no-images]]`, ongewijzigd).
- Geen directe wijziging aan `field_provenance`, `pending_changes`,
  `restaurant_profile_drafts`, of `data/menus.json` zonder een later,
  apart goedgekeurde implementatiefase.
- **Een bestaand legacy leeg allergenenarray-veld (`[]`) mag nooit
  stilzwijgend worden geïnterpreteerd als "bevestigd geen allergenen"
  wanneer de herkomst van die waarde dat onderscheid niet bewijst.** Waar
  de herkomst niet aantoont dat een expliciete, menselijke controle heeft
  plaatsgevonden, behandelt de toekomstige allergenen-adapter zo'n waarde
  als onbekend, nooit als een geverifieerde nul-staat — onzekerheid mag
  nooit stilzwijgend verdwijnen. Een expliciete "bevestigd geen
  allergenen"-staat vereist een geaudite beslissing met een eigen
  bron-/provenance-verwijzing (`SourceReference`/`FieldAssertion`), niet
  alleen een leeg array. De bestaande consumentweergave, berekening
  (`app/nvwa/[id]/NvwaView.js`), en legacydata (`data/menus.json`) blijven
  door deze regel ongewijzigd en buiten scope — dit is een eis aan een
  toekomstige adapter, geen wijziging aan wat vandaag al bestaat.

## Gefaseerde roadmap — met expliciete go/no-go per fase

### Fase 0 — Contract en beleid

`MenuProposal`-vorm, canonieke publicatielaag, versiegedrag
(`full_menu_snapshot`/`bounded_revision`, `superseded`/`stale`),
bron-/rechtenstatus (extractie- versus weergave-toestemming), veroudering,
en de overgangsrichting vanaf `data/menus.json` zijn expliciet besloten —
dit ticket zelf.

**Go/no-go**: geen implementatie zonder deze beslissingen — hard, zonder
uitzondering, zelfde discipline als elke eerdere `MARKET-*`/`PLATFORM-*`
Fase 0.

### Fase 1 — Interne owner-, geregistreerde-bron, of menukaartlink pilot

Alleen gestructureerde tekstdata (geen beeldmateriaal), altijd
voorstel → menselijke beoordeling → publicatie, voor een klein aantal
restaurants met een reeds geverifieerde eigenaar, een reeds
geregistreerde importbron, **of een reeds goedgekeurde, officiële
`https://`-menukaartlink (`PLATFORM-08B`) die een moderator handmatig
heeft getranscribeerd** — zie "Behandeling van bronnen" hierboven. Dit
derde pad vereist, net als de eerste twee, uitsluitend tekst en een mens
die typt, dus geen van `PLATFORM-08B`'s fotobewijs-specifieke
capabilities (opslag, EXIF, moderatorweergave van beeldmateriaal) — dat
afzonderlijke, zwaardere pad is Fase 2 hieronder.

**Go/no-go**: Fase 0's contract is vastgelegd; een reële `MenuProposal`
kan end-to-end worden ingediend, beoordeeld, en als canonieke versie
opgeslagen zonder de actieve `data/menus.json`-consumentroute te raken.

### Fase 2 — Interne moderator-extractie uit geautoriseerd bewijs

Communitybewijs kan alleen door een moderator worden omgezet naar een
`MenuProposal` — nooit automatisch, nooit door de inzender zelf. Dit
veronderstelt dat `PLATFORM-08B`'s **private-fotobewijscapability**
(opslag, EXIF-/privacybehandeling, moderatorweergave) daadwerkelijk
operationeel is — niet slechts dat `PLATFORM-08B`'s beleidsfase is
afgerond, en niet dat diens losstaande, niet-foto-gerelateerde publieke
flows (ontbrekend restaurant, correctie, menukaartlink) al draaien; die
laatste leveren geen fotobewijs op en voldoen dus niet aan deze
afhankelijkheid. Deze afhankelijkheid verwijst bewust naar de concrete
capability, nooit naar een specifiek fasenummer van `PLATFORM-08B`.

**Go/no-go**: `PLATFORM-08B`'s private evidence-opslag, EXIF-/
privacybehandeling en moderatorweergave voor fotobewijs zijn aantoonbaar
werkend tegen echte inzendingen, en Fase 1 van dit ticket heeft al
minstens één echte, goedgekeurde `MenuProposal` opgeleverd.

### Fase 3 — Gesloten community evidence pilot

Alleen nadat `PLATFORM-08B`'s privacy-, opslag-, en misbruikgrenzen **voor
fotobewijs specifiek** in de praktijk bewezen zijn — een reële
gebruiksperiode zonder privacy- of misbruikincidenten, met
reviewcapaciteit die het volume bijhoudt. Dit is niet hetzelfde als
`PLATFORM-08B`'s beleidsfase zijn afgerond, en niet hetzelfde als diens
overige, niet-foto-gerelateerde flows al live zijn.

**Go/no-go**: gemeten, niet aangenomen — dezelfde discipline die
`PLATFORM-08B` zelf hanteert vóór het verbreden van een beperkte naar een
bredere fotobewijs-inzet.

### Fase 4 — Eventuele OCR-assistentie

Alleen intern, voorstelgenererend (nooit publicerend), en altijd
menselijk geverifieerd tegen het originele bewijs — zelfde beperking als
`PLATFORM-08B`'s eigen moderator-assist-OCR-capability.

**Go/no-go**: alleen na een apart kosten-, privacy-, en
kwaliteitsbesluit; nooit vóórdat Fase 3 volwassen is.

### Fase 5 — Eventuele publieke foto/PDF-weergave

Alleen na een afzonderlijk rechten-, privacy-, performance-, en
productbesluit met expliciete, per-asset toestemming
(`consent_for_public_display`) — nooit een impliciet gevolg van een
eerdere fase, en altijd herevalueerd tegen
`[[002-text-first-no-images]]`'s principes.

**Go/no-go**: een apart, expliciet goedgekeurd beleidsbesluit — niet dit
ticket, niet een technische mijlpaal.

## Mockupgrens

**Nu geen mockup.** Vóór enige UI-implementatie moet eerst het
contractbesluit (dit ticket, Fase 0) zijn goedgekeurd. Daarna zijn
foto-vrije mockups verplicht, elk voor desktop én mobiel, light én dark,
zonder nepknoppen of automatische publicatiepaden — dezelfde conventie
als `docs/mockups/README.md`, voor minimaal:

1. interne beoordeling van een volledige menuvoorstel-diff (secties,
   items, prijzen, allergenen, bronvermelding, oud-versus-nieuw waar van
   toepassing);
2. owner- of bronaangeleverde gestructureerde menu-inhoud (het
   invoer-/aanlevertraject zelf);
3. consumentweergave van een goedgekeurde, actieve menukaart (inclusief
   zichtbare provenance-labels per risicogevoelig veld);
4. eventuele community-evidence-moderatie met een neutrale,
   roterende evidence-placeholder — nooit een echte menufoto, zelfde
   regel als `PLATFORM-08B`'s eigen mockupgrens.

## Risks

- **Sluipende scope-uitbreiding richting automatische publicatie** —
  mitigatie: elke sectie hierboven herhaalt expliciet dat een
  `MenuProposal` nooit zelfstandig canonieke data wordt zonder een
  menselijk moderatiebesluit.
- **Half-goedgekeurde kaarten** als atomiciteit niet strikt wordt
  afgedwongen bij implementatie — mitigatie: "Voorkomen van een
  half-goedgekeurde kaart" hierboven legt het principe nu al vast, vóór
  enige database-implementatie de kans krijgt dit per ongeluk los te
  laten.
- **Verwarring tussen extractie-toestemming en weergave-toestemming**
  voor eigenaars-/communitybewijs — mitigatie: expliciet als twee losse
  velden gedefinieerd, nooit gekoppeld, in "Behandeling van bronnen."
  bovenop.
- **`data/menus.json` en de nieuwe canonieke laag raken uit sync** tijdens
  de overgangsperiode waarin beide naast elkaar bestaan — mitigatie: de
  cutover-regel is per-restaurant expliciet en binair (nooit gemengd
  binnen één kaart), niet geleidelijk of impliciet.
- **Auteursrechtrisico bij bronvermelding** — een `SourceReference` die
  per ongeluk een publiek leesbare kopie van een brondocument wordt in
  plaats van een verwijzing — mitigatie: expliciet herbevestigd in
  "Behandeling van bronnen" dat een `SourceReference` nooit een kopie is.
- **Reviewcapaciteit** — een volledige-kaart-voorstel kost een moderator
  aantoonbaar meer tijd dan een los scalair veld — zelfde, nog niet
  opgeloste risico als `PLATFORM-08`/`08B` al benoemen, hier niet
  opnieuw opgelost, alleen erkend.

## Open questions (expliciet niet hier beslist)

- **Exacte vorm van de allergenen-adapter** tussen de huidige
  numerieke/tristate weergave (`null`/leeg array/gevuld array) en
  `{scheme, code}[]` — hier alleen vastgelegd **dát** de adapter drie
  betekenissen moet kunnen onderscheiden (onbekend of nog niet
  vastgelegd; expliciet gecontroleerd en geen allergenen geregistreerd;
  één of meer expliciet geregistreerde allergenen) en dat een legacy leeg
  array nooit stilzwijgend als "bevestigd geen allergenen" mag gelden
  zonder bewijs van herkomst (zie "Contractvragen §1" en "Harde
  grenzen") — niet **hoe** (een extra veld,
  een sentinel-waarde, een verplicht begeleidende `FieldAssertion`, of een
  andere oplossing); een latere, aparte implementatiebeslissing.
- Fysieke opslagvorm van `MenuProposal`/de canonieke menuversie (één
  brede jsonb-structuur versus genormaliseerde sectie-/itemtabellen) —
  een implementatiekeuze, niet hier beslist, zelfde terughoudendheid als
  `MARKET-02` zelf al toont voor het onderliggende canonieke schema.
- Exacte vaste set afwijsredenen voor een `MenuProposal`.
- Exacte veroudering-drempel (tijd of volume) voordat een `pending`
  voorstel als reviewschaal-aandachtspunt wordt gemarkeerd.
- Exacte vorm van `consent_for_public_display` op assetniveau (wie mag
  het zetten, is het herroepbaar, geldt het per asset of per voorstel) —
  hier alleen het principe vastgelegd dat het los van extractie-toestemming
  moet staan.
- Exacte migratie-/cutoverimplementatie vanaf `data/menus.json` — hier
  alleen de richting en de "nooit gemengd binnen één kaart"-regel
  vastgelegd, geen script of tijdlijn.
- Of/hoe `operational_status` (nog steeds een open vraag in `MARKET-02`
  zelf) ooit meedoet in een menuvoorstel — niet hier opnieuw geopend of
  beslist.

## Acceptance criteria

- [ ] Een `MenuProposal`-schemacontract is vastgelegd met alle velden uit
      "Contractvragen §1," inclusief `proposal_scope`,
      `source_references[]`, `status` (inclusief `superseded`/`stale`),
      `version`, en `idempotency_key`.
- [ ] Atomiciteit is expliciet vastgelegd: een voorstel wordt in zijn
      geheel goedgekeurd of afgewezen, nooit sectie- of itemsgewijs.
- [ ] Het onderscheid tussen `full_menu_snapshot` en `bounded_revision`,
      en het effect van elk bij goedkeuring, is vastgelegd.
- [ ] Oude kaartversies worden nooit stil overschreven — een
      `superseded_by`-achtig historisch spoor is vastgelegd.
- [ ] De canonieke publicatielaag onderscheidt expliciet: voorstel,
      moderatiebesluit, actieve canonieke versie, en publicatiestatus.
- [ ] Vastgelegd dat consumentroutes uitsluitend de actieve, gepubliceerde
      canonieke versie lezen — nooit een voorstel in welke status dan ook.
- [ ] Vastgelegd hoe per-sectie/item provenance publiek zichtbaar is
      zonder een privaat evidence-asset (bijv. een communityfoto) bloot
      te leggen.
- [ ] Een expliciete, niet-migratie-voorstellende overgangsrichting vanaf
      `data/menus.json` is vastgelegd, inclusief de "nooit gemengd binnen
      één kaart"-cutoverregel.
- [ ] Vastgelegd dat een bron-URL, publieke toegankelijkheid, of
      eigenaarclaim op zichzelf geen publicatierecht voor tekst, PDF,
      vormgeving, of afbeelding oplevert.
- [ ] Vastgelegd dat extractie-toestemming en publieke
      weergave-toestemming twee losse, nooit gekoppelde beslissingen zijn,
      en dat weergave-toestemming een expliciete opt-in op assetniveau is.
- [ ] Moderatiestatussen, afwijsredenen, bronconflictbehandeling
      (`stale`), veroudering, en het append-only auditpatroon zijn
      vastgelegd, aantoonbaar hergebruikmakend van bestaande patronen
      (`approve_pending_change`/`approve_restaurant_claim`/
      `import_candidate_reviews`).
- [ ] Geen automatische goedkeuring, OCR-publicatie, of directe
      eigenaarspublicatie is toegestaan door dit contract.
- [ ] Geen migratie, tabel, route, UI, of mockup is voorgesteld of
      gebouwd door dit ticket.
- [ ] `MARKET-05B`'s scope is ongewijzigd en expliciet buiten dit ticket
      gehouden.
- [ ] Vastgelegd dat de toekomstige allergenen-adapter naar
      `{scheme, code}[]` drie semantische toestanden per item moet kunnen
      behouden (onbekend/nog niet vastgelegd; expliciet gecontroleerd en
      geen allergenen; één of meer expliciet geregistreerde allergenen),
      en dat een legacy leeg allergenenarray nooit stilzwijgend als
      "bevestigd geen allergenen" mag gelden zonder bewijs van herkomst.
- [ ] Vastgelegd dat een moderator een goedgekeurde, officiële
      menukaartlink (`PLATFORM-08B`) handmatig kan omzetten in een
      `MenuProposal` — met die URL als `SourceReference` — zonder te
      wachten op fotobewijsopslag, EXIF-verwerking, of OCR-capability, en
      dat dit lichte pad dezelfde brongebonden, menselijke
      moderatiediscipline volgt als bestaande handmatige verrijking, apart
      van het zwaardere, latere fotobewijspad.

## Suggested order

Uitbreiding van `MARKET-02` binnen Wave 1 ("Market dimension & canonical
schema") van `planning/architecture/market-data-foundation-plan.md` — een
tweede, apart schemacontract op dezelfde canonieke basis, geen nieuwe
golf. Logisch stroomopwaarts van elke fase van `MARKET-04B` (Fase 2+, waar
CSV/JSONL-brondata ooit menu-achtige velden zou kunnen dragen) en
`PLATFORM-08B` — zowel diens lichte, geprefereerde menukaartlink-bijdrage
(waarna een moderator de link handmatig kan omzetten in een
`MenuProposal`, al vanaf dit ticket se eigen Fase 1 — zie "Behandeling
van bronnen" en "Fase 1" hierboven, zonder te wachten op fotobewijs) als
diens zwaardere private-fotobewijscapability (waarna een moderator dat
bewijs pas via dit ticket se eigen Fase 2 tot een `MenuProposal` kan
omzetten — zie dit ticket's eigen "Fase 2" hierboven) — die menu-inhoud
specifiek raakt — geen van beide tickets is geblokkeerd
op dit ticket voor hun eigen huidige, kortetermijnscope (respectievelijk
brondata-intake en de niet-foto-gerelateerde publieke flows), maar beide
lopen tegen dit ticket se ontbrekende contract aan zodra ze menu-inhoud
proberen te dragen in plaats van restaurant-identiteit. Niet
gepland; oppakbaar zodra Fase 0 van dit ticket expliciet is goedgekeurd.
