-- 0024 — BE-57 "Mijn restaurant", de anonieme teller "bekeken" (#139,
-- Delivery Lead opdracht 6533069356).
--
-- NOT YET APPLIED. Additive only; 0001-0023 are never edited. One new table,
-- one new function and their grants — no function, column or constraint of an
-- existing object changes.
--
-- Why its own table and not a `viewed` column in dish_counters (0021): a page
-- view is per restaurant per day, not per dish, and the existing
-- increment_dish_counter() accepts only a dish key
-- (<menukaart>-<categorie>-<gerecht>) and only the three BE-44 dish events.
-- Reusing that table would either force a fourth event and a second key shape
-- into a function that is already live, or leave rows that the BE-45 teller
-- table would then show as unknown dishes. A table of (restaurant, UTC day)
-- with one one-line function is therefore the smaller and safer change: the
-- dish counters keep their meaning and "Deze week" reads exactly what it needs.
--
-- One row is (restaurant, day) with one counter. Nothing else is stored: no
-- dish, no user id, no cookie, no IP address, no user agent, no per-event
-- timestamp and no session. A row is an aggregate of a whole day and cannot be
-- traced back to a person.
--
-- Why a function: the app never writes the table directly. The server route
-- POST /api/v1/bekeken calls increment_restaurant_view() with the service role;
-- the function upserts today (UTC) and only accepts a restaurant id of the
-- shape the app uses, so an unknown value can never create a row.
--
-- Rights: row level security on, and deliberately NO policy for anon or
-- authenticated, so neither can read or write anything here. service_role gets
-- select/insert/update on the table and execute on the function, and nothing
-- else. Without the explicit revoke, PostgreSQL would give PUBLIC execute on
-- the new function.
--
-- The application must keep working when this migration has not been applied
-- yet (owner decision 28 October: the file ships with the PR, the owner applies
-- it after the merge via "Apply production database migrations"): the counter
-- then fails safe with 204 and counts nothing, and "Mijn restaurant" shows
-- "nog geen cijfers". See src/lib/restaurantViewHandlers.js and
-- src/lib/ownerStatsHandlers.js.

create table if not exists restaurant_views (
  -- The restaurant id exactly as data/restaurants.json and the routes
  -- /restaurant/<id> and /menu/<id> know it (a short lowercase/numeric id).
  restaurant_id text not null check (restaurant_id ~ '^[a-z0-9]{1,24}$'),
  -- The UTC day of the event. Not the server's local day: one row per
  -- restaurant per calendar day in UTC, so the counts of every visitor land in
  -- the same row.
  day           date not null,
  viewed        integer not null default 0 check (viewed >= 0),
  primary key (restaurant_id, day)
);

comment on table restaurant_views is
  'BE-57 anonieme teller "bekeken": per restaurant per UTC-dag alleen een opgeteld aantal. Geen identiteit, geen IP-adres, geen cookie, geen sessie en geen tijdstip per bezoek.';
comment on column restaurant_views.day is
  'UTC-dag van het bezoek, zodat de tellingen van alle bezoekers in dezelfde rij landen.';

alter table restaurant_views enable row level security;

revoke all on public.restaurant_views from public, anon, authenticated;
revoke all on public.restaurant_views from service_role;

grant select, insert, update on public.restaurant_views to service_role;

-- The one write path: +1 on today's row for one restaurant.
create or replace function increment_restaurant_view(p_restaurant_id text)
returns void
language plpgsql
security definer
-- A fixed search_path, so the function cannot be hijacked through a caller's
-- search_path. Same posture as the 0016, 0021 and 0022 functions.
set search_path = public, pg_temp
as $$
declare
  v_restaurant_id text := btrim(coalesce(p_restaurant_id, ''));
  v_day           date := (now() at time zone 'utc')::date;
begin
  if v_restaurant_id !~ '^[a-z0-9]{1,24}$' then
    raise exception 'invalid restaurant id: %', p_restaurant_id
      using errcode = 'P0052';
  end if;

  insert into restaurant_views as v (restaurant_id, day, viewed)
  values (v_restaurant_id, v_day, 1)
  on conflict (restaurant_id, day) do update set
    viewed = v.viewed + 1;
end;
$$;

-- PostgreSQL grants execute to PUBLIC on every new function; only the server
-- route (service role) may call this one. Anon and authenticated get nothing,
-- so the public API can never write or read the table directly.
revoke all on function public.increment_restaurant_view(text) from public, anon, authenticated;
revoke all on function public.increment_restaurant_view(text) from service_role;
grant execute on function public.increment_restaurant_view(text) to service_role;
