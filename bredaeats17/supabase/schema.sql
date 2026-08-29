-- ─────────────────────────────────────────────────────────────────────────────
-- BredaEats — Supabase PostgreSQL Schema
-- Schema.org standaard · EU-14 allergenen · PostGIS locatie · Prijshistorie
-- Voer uit in Supabase SQL Editor (Database → SQL Editor → New query)
-- ─────────────────────────────────────────────────────────────────────────────

-- PostGIS voor locatiezoeken
CREATE EXTENSION IF NOT EXISTS postgis;

-- ── 1. Restaurants ────────────────────────────────────────────────────────────

CREATE TABLE restaurants (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,           -- voor SEO-URLs: /breda/restaurant-wolfslaar
  cuisine         TEXT,
  cuisine_label   TEXT,
  price_level     SMALLINT CHECK (price_level BETWEEN 1 AND 3),
  address         TEXT,
  postcode        TEXT,
  city            TEXT DEFAULT 'Breda',
  phone           TEXT,
  website         TEXT,
  buurt           TEXT,
  color           TEXT,                            -- hex brand color voor card
  badge           TEXT,                            -- emoji + label
  description     TEXT,
  card_description TEXT,
  location        GEOGRAPHY(POINT, 4326),          -- PostGIS: lat/lon voor proximity search
  bag_id          TEXT,                            -- BAG/PDOK kadaster ID
  bag_bouwjaar    SMALLINT,
  bag_oppervlakte SMALLINT,
  service         TEXT DEFAULT 'dine-in',          -- dine-in | takeaway | both
  is_active       BOOLEAN DEFAULT TRUE,
  is_verified     BOOLEAN DEFAULT FALSE,           -- restaurant heeft account aangemaakt
  nvwa_compliant  BOOLEAN DEFAULT FALSE,           -- alle allergenen ingevuld
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Snel zoeken op buurt, slug, active
CREATE INDEX idx_restaurants_buurt    ON restaurants(buurt);
CREATE INDEX idx_restaurants_active   ON restaurants(is_active);
CREATE INDEX idx_restaurants_location ON restaurants USING GIST(location);

-- ── 2. Openingstijden ────────────────────────────────────────────────────────

CREATE TABLE opening_hours (
  id              BIGSERIAL PRIMARY KEY,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  day_of_week     SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7), -- 1=Ma ... 7=Zo
  opens           TIME,                            -- NULL = gesloten
  closes          TIME,
  UNIQUE(restaurant_id, day_of_week)
);

-- ── 3. Tags ──────────────────────────────────────────────────────────────────

CREATE TABLE restaurant_tags (
  id              BIGSERIAL PRIMARY KEY,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  tag             TEXT NOT NULL
);

-- ── 4. Menu's ────────────────────────────────────────────────────────────────

CREATE TABLE menus (
  id              BIGSERIAL PRIMARY KEY,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  meal_type       TEXT NOT NULL CHECK (meal_type IN ('lunch','diner','borrel','specialiteiten')),
  subtitle        TEXT,
  source_url      TEXT,                            -- URL waar menu gescraped is
  scraped_at      DATE,
  notes           TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(restaurant_id, meal_type)
);

-- ── 5. Menu secties ──────────────────────────────────────────────────────────

CREATE TABLE menu_sections (
  id              BIGSERIAL PRIMARY KEY,
  menu_id         BIGINT NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  position        SMALLINT DEFAULT 0,              -- volgorde op pagina
  description     TEXT
);

-- ── 6. Menu items ────────────────────────────────────────────────────────────

CREATE TABLE menu_items (
  id              BIGSERIAL PRIMARY KEY,
  section_id      BIGINT NOT NULL REFERENCES menu_sections(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  supplement      TEXT,                            -- bijgerecht / supplement info
  wine_pairing    TEXT,
  price           NUMERIC(8,2),                    -- NULL = op aanvraag
  currency        TEXT DEFAULT 'EUR',
  is_available    BOOLEAN DEFAULT TRUE,
  position        SMALLINT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_menu_items_section ON menu_items(section_id);
CREATE INDEX idx_menu_items_name    ON menu_items USING GIN(to_tsvector('dutch', name));
CREATE INDEX idx_menu_items_desc    ON menu_items USING GIN(to_tsvector('dutch', COALESCE(description,'')));

-- ── 7. Allergenen (EU-14 referentietabel) ────────────────────────────────────

CREATE TABLE allergens (
  id              SMALLINT PRIMARY KEY,            -- 1–14 conform EU 1169/2011
  code            TEXT UNIQUE NOT NULL,
  name_nl         TEXT NOT NULL,
  name_en         TEXT NOT NULL,
  icon            TEXT
);

-- Seed data: 14 verplichte allergenen
INSERT INTO allergens (id, code, name_nl, name_en, icon) VALUES
  (1,  'gluten',    'Gluten',            'Gluten',          '🌾'),
  (2,  'schaal',    'Schaaldieren',      'Crustaceans',     '🦞'),
  (3,  'ei',        'Eieren',            'Eggs',            '🥚'),
  (4,  'vis',       'Vis',               'Fish',            '🐟'),
  (5,  'pinda',     'Pinda''s',          'Peanuts',         '🥜'),
  (6,  'soja',      'Soja',              'Soybeans',        '🫘'),
  (7,  'melk',      'Melk / Lactose',    'Milk',            '🥛'),
  (8,  'noten',     'Noten',             'Tree nuts',       '🌰'),
  (9,  'selderij',  'Selderij',          'Celery',          '🥬'),
  (10, 'mosterd',   'Mosterd',           'Mustard',         '🌿'),
  (11, 'sesam',     'Sesamzaad',         'Sesame',          '🌱'),
  (12, 'so2',       'Zwaveldioxide',     'Sulphur dioxide', '🍇'),
  (13, 'lupine',    'Lupine',            'Lupin',           '🌻'),
  (14, 'week',      'Weekdieren',        'Molluscs',        '🦑');

-- ── 8. Item-allergenen koppeltabel ────────────────────────────────────────────

CREATE TABLE item_allergens (
  item_id         BIGINT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  allergen_id     SMALLINT NOT NULL REFERENCES allergens(id),
  status          TEXT NOT NULL DEFAULT 'contains'
                  CHECK (status IN ('contains','may_contain','free')),
  verified_by     TEXT,                            -- 'staff' | 'ai_inference' | 'nvwa_audit'
  verified_at     TIMESTAMPTZ,
  PRIMARY KEY (item_id, allergen_id)
);

CREATE INDEX idx_item_allergens_item     ON item_allergens(item_id);
CREATE INDEX idx_item_allergens_allergen ON item_allergens(allergen_id);

-- ── 9. Dieet-tags ────────────────────────────────────────────────────────────

CREATE TABLE item_dietary_tags (
  item_id         BIGINT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  tag             TEXT NOT NULL CHECK (tag IN (
                    'vegetarisch','vegan','glutenvrij','lactosevrij',
                    'halal','kosher','nootvrij','aanbevolen','dagspecial'
                  )),
  PRIMARY KEY (item_id, tag)
);

-- ── 10. Prijshistorie ────────────────────────────────────────────────────────

CREATE TABLE price_history (
  id              BIGSERIAL PRIMARY KEY,
  item_id         BIGINT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  price           NUMERIC(8,2) NOT NULL,
  recorded_at     TIMESTAMPTZ DEFAULT NOW(),
  source          TEXT DEFAULT 'scrape'            -- 'scrape' | 'manual' | 'api'
);

-- Trigger: sla automatisch prijswijzigingen op
CREATE OR REPLACE FUNCTION log_price_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.price IS DISTINCT FROM NEW.price AND NEW.price IS NOT NULL THEN
    INSERT INTO price_history (item_id, price, source)
    VALUES (NEW.id, NEW.price, 'update');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_price_history
  AFTER UPDATE ON menu_items
  FOR EACH ROW EXECUTE FUNCTION log_price_change();

-- ── 11. Menu snapshots (voor historische vergelijking) ───────────────────────

CREATE TABLE menu_snapshots (
  id              BIGSERIAL PRIMARY KEY,
  menu_id         BIGINT NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  snapshot_json   JSONB NOT NULL,                  -- volledige menu op dat moment
  taken_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── 12. Restaurant accounts (Supabase Auth koppeling) ────────────────────────

CREATE TABLE restaurant_accounts (
  id              BIGSERIAL PRIMARY KEY,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES auth.users(id),  -- Supabase Auth
  role            TEXT DEFAULT 'owner' CHECK (role IN ('owner','manager','staff')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(restaurant_id, user_id)
);

-- ── Row Level Security (RLS) ──────────────────────────────────────────────────

ALTER TABLE restaurants        ENABLE ROW LEVEL SECURITY;
ALTER TABLE menus              ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_sections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_allergens     ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_dietary_tags  ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_accounts ENABLE ROW LEVEL SECURITY;

-- Publiek: iedereen mag restaurants en menu's lezen
CREATE POLICY "public_read_restaurants" ON restaurants FOR SELECT USING (is_active = TRUE);
CREATE POLICY "public_read_menus"       ON menus       FOR SELECT USING (is_active = TRUE);
CREATE POLICY "public_read_sections"    ON menu_sections FOR SELECT USING (TRUE);
CREATE POLICY "public_read_items"       ON menu_items   FOR SELECT USING (is_available = TRUE);
CREATE POLICY "public_read_allergens"   ON item_allergens FOR SELECT USING (TRUE);
CREATE POLICY "public_read_dietary"     ON item_dietary_tags FOR SELECT USING (TRUE);

-- Restaurants mogen hun eigen data aanpassen
CREATE POLICY "owner_update_restaurant" ON restaurants
  FOR UPDATE USING (
    id IN (
      SELECT restaurant_id FROM restaurant_accounts
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "owner_manage_menus" ON menus
  FOR ALL USING (
    restaurant_id IN (
      SELECT restaurant_id FROM restaurant_accounts
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "owner_manage_items" ON menu_items
  FOR ALL USING (
    section_id IN (
      SELECT ms.id FROM menu_sections ms
      JOIN menus m ON ms.menu_id = m.id
      JOIN restaurant_accounts ra ON m.restaurant_id = ra.restaurant_id
      WHERE ra.user_id = auth.uid()
    )
  );

CREATE POLICY "owner_manage_allergens" ON item_allergens
  FOR ALL USING (
    item_id IN (
      SELECT mi.id FROM menu_items mi
      JOIN menu_sections ms ON mi.section_id = ms.id
      JOIN menus m ON ms.menu_id = m.id
      JOIN restaurant_accounts ra ON m.restaurant_id = ra.restaurant_id
      WHERE ra.user_id = auth.uid()
    )
  );

-- ── Handige views ─────────────────────────────────────────────────────────────

-- Volledige allergeenstatus per restaurant (voor NVWA compliance check)
CREATE VIEW restaurant_nvwa_status AS
SELECT
  r.id,
  r.name,
  r.buurt,
  COUNT(DISTINCT mi.id)                                    AS total_items,
  COUNT(DISTINCT CASE WHEN ia.item_id IS NOT NULL
        THEN mi.id END)                                    AS items_with_allergens,
  ROUND(
    COUNT(DISTINCT CASE WHEN ia.item_id IS NOT NULL
          THEN mi.id END)::NUMERIC /
    NULLIF(COUNT(DISTINCT mi.id), 0) * 100
  )                                                        AS compliance_pct,
  COUNT(DISTINCT mi.id) = COUNT(DISTINCT CASE
    WHEN ia.item_id IS NOT NULL THEN mi.id END)            AS is_nvwa_compliant
FROM restaurants r
LEFT JOIN menus m       ON m.restaurant_id = r.id
LEFT JOIN menu_sections ms ON ms.menu_id = m.id
LEFT JOIN menu_items mi ON mi.section_id = ms.id
LEFT JOIN item_allergens ia ON ia.item_id = mi.id
WHERE r.is_active = TRUE
GROUP BY r.id, r.name, r.buurt;

-- Zoekview: gerechten met restaurant info (voor ingrediëntenzoeker)
CREATE VIEW menu_item_search AS
SELECT
  mi.id,
  mi.name,
  mi.description,
  mi.price,
  ms.name                AS section_name,
  m.meal_type,
  m.subtitle             AS menu_subtitle,
  r.id                   AS restaurant_id,
  r.name                 AS restaurant_name,
  r.address,
  r.buurt,
  r.slug,
  ARRAY_AGG(DISTINCT ia.allergen_id) FILTER (WHERE ia.status = 'contains') AS allergen_ids
FROM menu_items mi
JOIN menu_sections ms ON mi.section_id = ms.id
JOIN menus m          ON ms.menu_id = m.id
JOIN restaurants r    ON m.restaurant_id = r.id
LEFT JOIN item_allergens ia ON ia.item_id = mi.id
WHERE mi.is_available = TRUE AND m.is_active = TRUE AND r.is_active = TRUE
GROUP BY mi.id, mi.name, mi.description, mi.price, ms.name,
         m.meal_type, m.subtitle, r.id, r.name, r.address, r.buurt, r.slug;
