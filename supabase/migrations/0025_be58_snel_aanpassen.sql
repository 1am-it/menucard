-- 0025 — BE-58 snel aanpassen en menukaart bevestigen (#143, eigenaarsakkoord
-- 30 okt).
--
-- NOT YET APPLIED. Additive only; 0001-0022 zijn nooit gewijzigd, 0023 (BE-55)
-- en 0024 (BE-57) horen bij andere, nog niet gemergede branches en worden hier
-- niet aangeraakt. Drie nieuwe tabellen, hun indexen en hun rechten — geen
-- kolom, functie of constraint van een bestaand object verandert.
--
-- Waarom dit nodig is: een houder met een goedgekeurde claim past op
-- /mijn-restaurant/menukaart per gerecht de prijs aan of zet "tijdelijk niet
-- beschikbaar" aan of uit. Zo'n wijziging is pas zichtbaar voor gasten nadat
-- de interne controle hem goedkeurde; de oude kaart blijft intussen bewaard.
-- Een houder kan ook bevestigen dat zijn kaart klopt; dat label geldt 90 dagen
-- en een goedgekeurde snelle wijziging telt ook als bevestiging.
--
-- Drie tabellen:
--   menukaart_wijzigingen     één rij per ingediende wijziging: welk restaurant,
--                             welke kaart, welk gerecht (categorie- en
--                             gerechtindex, dezelfde sleutel als de deeplinks),
--                             de oude prijs, de nieuwe prijs of beschikbaarheid,
--                             de status (in_controle / goedgekeurd / afgewezen),
--                             de markering "grote wijziging" en de beoordeling;
--   menukaart_bevestigingen   één rij per restaurant: wie bevestigde en wanneer.
--                             Ouder dan 90 dagen telt niet meer (de app rekent
--                             dat uit, de rij blijft als geschiedenis staan);
--   menukaart_gebeurtenissen  de geschiedenis: elke inzending, goedkeuring,
--                             afwijzing en bevestiging, met dezelfde gegevens.
--
-- De checks hieronder herhalen de contractregels zodat geen enkele schrijver ze
-- kan omzeilen: prijs 50-15000 cent (€ 0,50 - € 150), alleen de twee soorten,
-- alleen de drie statussen, alleen de vier geschiedenisacties, indices >= 0 en
-- een afwijzing heeft een reden. De 30 wijzigingen per dag, het eigenaarschap
-- (staff_roles owner), het plaatsrecht (daghap_plaatsrecht uit BE-55) en de
-- markering "grote wijziging" rekent de API uit in src/lib/snelAanpassen.js en
-- src/lib/snelAanpassenHandlers.js; die is de enige schrijver.
--
-- Geen foreign key naar daghap_plaatsrecht: die tabel komt uit 0023 (BE-55) en
-- is op deze branch nog niet aanwezig. De API leest hem via een helper die een
-- ontbrekende tabel opvangt (zie snelAanpassenHandlers.js).
--
-- Rechten: row level security aan, en bewust GEEN policy voor anon of
-- authenticated, zodat niemand hier rechtstreeks leest of schrijft. Alles gaat
-- via de serverroutes met de service role. service_role krijgt
-- select/insert/update/delete op de drie tabellen en niets anders.
--
-- Bewaren: geschiedenis en bevestiging blijven staan; een afgewezen wijziging
-- wordt nooit hard verwijderd. Niets wordt automatisch opgeruimd.
--
-- De applicatie moet blijven werken zolang deze migratie niet is toegepast
-- (eigenaarsbesluit 28 oktober: het bestand gaat mee in de PR, de eigenaar past
-- het na de merge toe via "Apply production database migrations"): elke
-- menukaartroute antwoordt dan 503 met één nette melding. Zie
-- src/lib/snelAanpassenHandlers.js.

create table if not exists menukaart_wijzigingen (
  -- Alleen voor ordening en als stabiele sleutel in de routes en geschiedenis.
  wijziging_id    bigint generated always as identity primary key,
  restaurant_id   text not null check (char_length(btrim(restaurant_id)) between 1 and 64),
  -- De kaart zoals in data/menus.json: '<restaurant>-<maaltijd>' (bijv. 1-lunch).
  menu_id         text not null check (char_length(btrim(menu_id)) between 1 and 64),
  -- Dezelfde positie als de deeplink: categorie- en gerechtindex in die kaart.
  categorie_index integer not null check (categorie_index >= 0),
  gerecht_index   integer not null check (gerecht_index >= 0),
  -- Naam van het gerecht op het moment van indienen, voor de controlelijst.
  gerecht_naam    text not null check (char_length(btrim(gerecht_naam)) between 1 and 160),
  -- De houder die de wijziging indiende (staff_roles owner van dit restaurant).
  user_id         uuid not null references auth.users (id) on delete cascade,
  soort           text not null check (soort in ('prijs', 'beschikbaarheid')),
  -- De prijs die de statische kaart op dat moment toonde (mag leeg zijn).
  oude_prijs_cent integer check (oude_prijs_cent between 0 and 100000),
  -- Alleen bij soort 'prijs': de nieuwe prijs in centen.
  prijs_cent      integer check (prijs_cent between 50 and 15000),
  -- Alleen bij soort 'beschikbaarheid': tijdelijk niet beschikbaar ja/nee.
  beschikbaar     boolean,
  status          text not null default 'in_controle'
                    check (status in ('in_controle', 'goedgekeurd', 'afgewezen')),
  -- Meer dan 50% verschil met de huidige prijs: de controlelijst markeert het.
  grote_wijziging boolean not null default false,
  -- Verplicht bij een afwijzing, leeg bij de andere statussen.
  afwijs_reden    text check (afwijs_reden is null or char_length(btrim(afwijs_reden)) between 1 and 280),
  beoordeeld_door uuid,
  beoordeeld_op   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Per soort precies de eigen velden: een prijswijziging heeft een prijs en
  -- geen beschikbaarheid, een beschikbaarheidswijziging juist andersom.
  constraint menukaart_wijzigingen_soort_velden check (
    (soort = 'prijs' and prijs_cent is not null and beschikbaar is null)
    or (soort = 'beschikbaarheid' and beschikbaar is not null and prijs_cent is null)
  ),
  -- Een beoordeling hoort bij een besliste wijziging, een afwijzing altijd
  -- met een reden.
  constraint menukaart_wijzigingen_beoordeling check (
    (status = 'in_controle' and beoordeeld_op is null and afwijs_reden is null)
    or (status = 'goedgekeurd' and beoordeeld_op is not null and afwijs_reden is null)
    or (status = 'afgewezen' and beoordeeld_op is not null and afwijs_reden is not null)
  )
);

comment on table menukaart_wijzigingen is
  'BE-58: snelle wijzigingen van een houder (prijs of tijdelijk niet beschikbaar) per gerecht. Pas zichtbaar voor gasten na goedkeuring; de oude kaart blijft bewaard.';

-- De interne controlelijst leest de open wijzigingen, de houder zijn eigen lijst
-- en de publieke overlay per restaurant alleen de goedgekeurde rijen.
create index if not exists menukaart_wijzigingen_status_idx
  on menukaart_wijzigingen (status, created_at desc);
create index if not exists menukaart_wijzigingen_restaurant_idx
  on menukaart_wijzigingen (restaurant_id, status);
create index if not exists menukaart_wijzigingen_gebruiker_idx
  on menukaart_wijzigingen (user_id, created_at desc);

-- Eén open wijziging per gerecht: twee wachtende wijzigingen voor hetzelfde
-- gerecht zouden de controlelijst en de overlay onvoorspelbaar maken.
create unique index if not exists menukaart_wijzigingen_open_per_gerecht_idx
  on menukaart_wijzigingen (restaurant_id, menu_id, categorie_index, gerecht_index)
  where status = 'in_controle';

create table if not exists menukaart_bevestigingen (
  restaurant_id text primary key check (char_length(btrim(restaurant_id)) between 1 and 64),
  -- De houder die bevestigde dat de kaart klopt.
  user_id       uuid not null references auth.users (id) on delete cascade,
  bevestigd_op  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table menukaart_bevestigingen is
  'BE-58: per restaurant de laatste bevestiging door de houder. Ouder dan 90 dagen telt niet meer; de app vraagt dan opnieuw om bevestiging.';

create table if not exists menukaart_gebeurtenissen (
  gebeurtenis_id bigint generated always as identity primary key,
  wijziging_id   bigint references menukaart_wijzigingen (wijziging_id) on delete cascade,
  restaurant_id  text not null check (char_length(btrim(restaurant_id)) between 1 and 64),
  actie          text not null check (actie in ('ingediend', 'goedgekeurd', 'afgewezen', 'bevestigd')),
  -- De houder of de interne beoordelaar; alleen voor de geschiedenis.
  door           uuid,
  gegevens       jsonb not null default '{}'::jsonb,
  moment         timestamptz not null default now()
);

comment on table menukaart_gebeurtenissen is
  'BE-58: geschiedenis van elke snelle wijziging en elke bevestiging. Wordt nooit opgeruimd.';

create index if not exists menukaart_gebeurtenissen_wijziging_idx
  on menukaart_gebeurtenissen (wijziging_id, moment desc);
create index if not exists menukaart_gebeurtenissen_restaurant_idx
  on menukaart_gebeurtenissen (restaurant_id, moment desc);

alter table menukaart_wijzigingen enable row level security;
alter table menukaart_bevestigingen enable row level security;
alter table menukaart_gebeurtenissen enable row level security;

revoke all on public.menukaart_wijzigingen from public, anon, authenticated;
revoke all on public.menukaart_bevestigingen from public, anon, authenticated;
revoke all on public.menukaart_gebeurtenissen from public, anon, authenticated;

revoke all on public.menukaart_wijzigingen from service_role;
revoke all on public.menukaart_bevestigingen from service_role;
revoke all on public.menukaart_gebeurtenissen from service_role;

grant select, insert, update, delete on public.menukaart_wijzigingen to service_role;
grant select, insert, update, delete on public.menukaart_bevestigingen to service_role;
grant select, insert, update on public.menukaart_gebeurtenissen to service_role;

-- De identity-kolommen hebben hun sequences nodig, niets anders.
grant usage, select on sequence public.menukaart_wijzigingen_wijziging_id_seq to service_role;
grant usage, select on sequence public.menukaart_gebeurtenissen_gebeurtenis_id_seq to service_role;
