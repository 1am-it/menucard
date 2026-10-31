-- 0026 — BE-67 daghap stap B (#164, eigenaarsakkoord 31 okt): het dagmenu, de
-- herhaling per weekdag en de stand "uitverkocht".
--
-- NOT YET APPLIED. Additive and idempotent; 0001-0025 are never edited. Only
-- daghap_aanbod (the table 0023 created) gains columns and checks, plus one new
-- helper function. No existing column, row or grant is removed.
--
-- Why this is needed: next to the daghap and the seizoensgerecht comes a third
-- kind, the dagmenu: two or three courses, each with its own name, with a price
-- for two courses and — only when there are three — a price for three courses.
-- A placement can repeat on chosen weekdays until an end date, and the holder
-- can put any placement on "sold out for today" with one button; the next day
-- that state lapses by itself.
--
-- The smallest addition that carries all of it:
--   soort             'dagmenu' joins the existing check ('daghap',
--                     'dagmenu', 'seizoensgerecht');
--   gangen            jsonb array of {gang: 'voor'|'hoofd'|'na', naam}, 2 or 3
--                     items, only for a dagmenu and null for the other kinds;
--   prijs_3_cent      the third price only. A dagmenu's prijs_cent (0023, the
--                     existing price column, 50-15000 cents) is its two-course
--                     price; that is one column instead of two, so the smaller
--                     of the two options the contract allows. Null when there
--                     are two courses and always null outside a dagmenu;
--   herhaal_weekdagen smallint[] of ISO weekdays 1-7 (1 = Monday), one to seven
--                     values, deduplicated and sorted by the API before writing;
--   herhaal_tot       the last day of the repetition. The 90-day boundary is the
--                     API's rule (it needs "today" in Europe/Amsterdam), exactly
--                     like verloopt_op in 0023;
--   uitverkocht_op    the Amsterdam date (never a timestamp) on which the holder
--                     marked the placement sold out. Null means available. The
--                     state lapses because every read compares this date with
--                     today in Europe/Amsterdam; nothing has to be reset at
--                     midnight, so a repetition shows as available again the
--                     next day.
--
-- The checks repeat the contract rules so that no writer can bypass them: the
-- courses (2 or 3, each with a known course and a name of 1-80 characters,
-- exactly one main course, no duplicate course), the third price only with
-- three courses and only inside a dagmenu, the weekday range and the pairing of
-- weekdays with an end date. The "vandaag online" rule, the maximum per kind
-- per day and the 90-day boundary stay in the API (src/lib/daghapAanbod.js),
-- which is the only writer.
--
-- The history table (0023) learns two actions, 'uitverkocht' and 'beschikbaar',
-- so the Op = op button can leave its trail without a third migration, and the
-- three daily counters 'bekeken', 'bewaard' and 'gedeeld' per offer (the holder's
-- overview counts today's rows; no new table). Nothing else on that table
-- changes.
--
-- Without this migration the app keeps working exactly as it does now: no
-- dagmenu, no repetition and no sold-out state appear, and no route answers 500
-- (see src/lib/daghapAanbod.js and src/lib/daghapHandlers.js). The file ships
-- with the PR; the owner applies it, not the developer or the Lead.

alter table daghap_aanbod
  add column if not exists gangen jsonb,
  add column if not exists prijs_3_cent integer,
  add column if not exists herhaal_weekdagen smallint[],
  add column if not exists herhaal_tot date,
  add column if not exists uitverkocht_op date;

comment on column daghap_aanbod.gangen is
  'BE-67: de gangen van een dagmenu als [{gang: voor|hoofd|na, naam}]. 2 of 3 items, alleen bij soort = dagmenu; anders leeg.';
comment on column daghap_aanbod.prijs_3_cent is
  'BE-67: de prijs voor drie gangen. Bij een dagmenu is prijs_cent de prijs voor twee gangen. Alleen gevuld bij een dagmenu met drie gangen.';
comment on column daghap_aanbod.herhaal_weekdagen is
  'BE-67: de ISO-weekdagen (1 = maandag t/m 7 = zondag) waarop dit aanbod terugkomt. Leeg betekent alleen vandaag.';
comment on column daghap_aanbod.herhaal_tot is
  'BE-67: de laatste dag van de herhaling, in Europe/Amsterdam. Hoort bij herhaal_weekdagen.';
comment on column daghap_aanbod.uitverkocht_op is
  'BE-67: de Amsterdamse datum waarop de houder dit aanbod op uitverkocht zette. Leeg betekent beschikbaar; de stand vervalt vanzelf de volgende dag.';


-- The course list is small but has real rules; a check constraint cannot hold a
-- subquery, so one immutable helper does the counting. Fixed search_path, the
-- same posture as the 0016, 0021, 0022 and 0023 functions.
create or replace function daghap_gangen_geldig(gangen jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_typeof(gangen) = 'array'
    and jsonb_array_length(gangen) between 2 and 3
    and (
      select count(*) = jsonb_array_length(gangen)
         and count(distinct element ->> 'gang') = count(*)
         and count(*) filter (where element ->> 'gang' = 'hoofd') = 1
        from jsonb_array_elements(gangen) as element
       where jsonb_typeof(element) = 'object'
         and element ->> 'gang' in ('voor', 'hoofd', 'na')
         and char_length(btrim(coalesce(element ->> 'naam', ''))) between 1 and 80
    ),
    false
  );
$$;

comment on function daghap_gangen_geldig(jsonb) is
  'BE-67: waar als dit een geldige gangenlijst van een dagmenu is (2-3 gangen, één hoofdgerecht, elke gang met een naam van 1-80 tekens).';

revoke all on function public.daghap_gangen_geldig(jsonb) from public, anon, authenticated;
revoke all on function public.daghap_gangen_geldig(jsonb) from service_role;
grant execute on function public.daghap_gangen_geldig(jsonb) to service_role;

-- The kind gains 'dagmenu'. The inline check from 0023 is auto-named
-- daghap_aanbod_soort_check; dropping and re-adding keeps this file idempotent.
alter table daghap_aanbod drop constraint if exists daghap_aanbod_soort_check;
alter table daghap_aanbod add constraint daghap_aanbod_soort_check
  check (soort in ('daghap', 'dagmenu', 'seizoensgerecht'));

alter table daghap_aanbod drop constraint if exists daghap_aanbod_gangen_check;
alter table daghap_aanbod add constraint daghap_aanbod_gangen_check
  check (
    case
      when soort = 'dagmenu' then daghap_gangen_geldig(gangen)
      else gangen is null
    end
  );

alter table daghap_aanbod drop constraint if exists daghap_aanbod_prijs_3_check;
alter table daghap_aanbod add constraint daghap_aanbod_prijs_3_check
  check (
    case
      when soort = 'dagmenu' then (
        jsonb_array_length(gangen) = 2 and prijs_3_cent is null
      ) or (
        jsonb_array_length(gangen) = 3 and prijs_3_cent between 50 and 15000
      )
      else prijs_3_cent is null
    end
  );

alter table daghap_aanbod drop constraint if exists daghap_aanbod_herhaling_check;
alter table daghap_aanbod add constraint daghap_aanbod_herhaling_check
  check (
    case
      when herhaal_weekdagen is null then herhaal_tot is null
      else (
        array_ndims(herhaal_weekdagen) = 1
        and array_length(herhaal_weekdagen, 1) between 1 and 7
        and herhaal_weekdagen <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
        and herhaal_tot is not null
      )
    end
  );

-- The actions of Op = op ('uitverkocht', 'beschikbaar') and the three daily
-- counters of an offer ('bekeken', 'bewaard', 'gedeeld'). The counters live in
-- this existing history table, so there is no new table: the holder's overview
-- counts today's rows per offer. Everything else stays the same list, so the
-- older rows keep passing this check.
alter table daghap_gebeurtenissen drop constraint if exists daghap_gebeurtenissen_actie_check;
alter table daghap_gebeurtenissen add constraint daghap_gebeurtenissen_actie_check
  check (actie in (
    'geplaatst', 'gewijzigd', 'offline', 'in_controle', 'gemeld',
    'goedgekeurd', 'verwijderd', 'verlopen', 'recht_afgenomen',
    'recht_teruggegeven', 'uitverkocht', 'beschikbaar',
    'bekeken', 'bewaard', 'gedeeld'
  ));

-- Same posture as 0023: row level security on, deliberately no policy for anon
-- or authenticated, and only the service role (the server routes) may read and
-- write. Repeated here so this file states its own rights.
alter table daghap_aanbod enable row level security;

revoke all on public.daghap_aanbod from public, anon, authenticated;
revoke all on public.daghap_aanbod from service_role;
grant select, insert, update, delete on public.daghap_aanbod to service_role;
