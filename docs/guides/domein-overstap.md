# Van het Vercel-adres naar onzemenukaarten.nl

Deze lijst is voor de eigenaar. Na deze stappen werkt de site op het eigen
domein, blijven bestaande deel- en QR-links werken en hoeft er geen code meer
te veranderen. Alles wat hier staat gebeurt in Vercel, in Supabase en bij de
domeinnaam-provider; in de app zelf is niets aan te passen.

De app leest één instelling: `NEXT_PUBLIC_SITE_URL`. Daaruit komen de metadata
van de pagina's, `robots.txt` en de sitemap. Staat die instelling er niet of is
hij niet geldig, dan gokt de app niet: de sitemap blijft dan leeg en de
sitemap-regel in `robots.txt` vervalt. Een verkeerd adres is dus nooit "stil
goed".

## 1. Het domein toevoegen in Vercel

1. Open in Vercel het project van de site.
2. Ga naar **Settings → Domains** en voeg `onzemenukaarten.nl` toe.
3. Vercel toont nu de DNS-records die erbij horen (meestal een `A`-record voor
   het kale domein en een `CNAME` voor `www`).
4. Zet die records over bij de partij waar het domein is gekocht (de
   domeinnaam-provider). Neem de waarden over zoals Vercel ze toont; typt u ze
   zelf over, dan gaat het vaak mis met het apenstaartje of de punt aan het eind.
5. Wacht tot Vercel groen laat zien dat het domein klopt. Dat kan enkele uren
   duren; dat is normaal en vraagt geen actie.
6. Kies of `www.onzemenukaarten.nl` hetzelfde moet doen als het kale domein. Eén
   van de twee is de echte; de andere stuurt door. Laat dat in Vercel instellen,
   niet in de app.

## 2. `NEXT_PUBLIC_SITE_URL` instellen

1. Ga in Vercel naar **Settings → Environment Variables**.
2. Voeg toe: naam `NEXT_PUBLIC_SITE_URL`, waarde
   `https://onzemenukaarten.nl` (met `https`, zonder slash aan het eind).
3. Zet hem op **Production**. Voor een preview-omgeving laat u hem leeg, zodat
   een preview naar zijn eigen adres verwijst.
4. Maak daarna een nieuwe productie-uitrol. De waarde wordt bij de bouw
   ingelezen; een bestaande uitrol verandert niet vanzelf.

Let op: deze instelling is bewust openbaar (hij begint met `NEXT_PUBLIC_`). Er
hoort dus nooit een sleutel of wachtwoord in te staan.

## 3. Supabase bijwerken

De inlogmails en de claimmails van houders bevatten een link terug naar de site.
Die link komt uit Supabase, niet uit de app.

1. Open het Supabase-project en ga naar **Authentication → URL Configuration**.
2. Zet **Site URL** op `https://onzemenukaarten.nl`.
3. Zet bij **Redirect URLs** het nieuwe domein erbij, bijvoorbeeld
   `https://onzemenukaarten.nl/**`. Laat het oude Vercel-adres er voorlopig nog
   bij staan, zodat een mail die al onderweg is blijft werken.
4. Controleer de mailsjablonen (**Authentication → Email Templates**) voor de
   inlogmail en de claimmail: daarin moet de link met `{{ .ConfirmationURL }}`
   (of de bestaande variabele) werken en niet als vast tekstadres staan.
5. Verwijder het oude adres pas als de testlijst hieronder helemaal groen is.

## 4. Het oude Vercel-adres laten doorsturen

1. Ga in Vercel naar **Settings → Domains** en open het oude adres.
2. Zet daar een doorverwijzing (**Redirect**) naar `https://onzemenukaarten.nl`.
   Dit is een Vercel-instelling; er is geen middleware en geen code voor nodig.
3. Controleer in het scherm of Vercel dit voor dit adres toestaat. Vercel staat
   een doorverwijzing niet altijd toe op het eigen `*.vercel.app`-adres; is de
   optie er niet, meld dat dan. De app lost niets stil op: bestaande QR-codes
   blijven werken zolang ze naar een bestaand adres wijzen.

## 5. Testen na de overstap

Doe deze lijst in één keer, op het echte domein, en noteer wat u ziet:

1. **Inloggen als houder** — ga naar `https://onzemenukaarten.nl`, log in met
   een houdersaccount en controleer dat u op het eigen domein blijft (geen
   sprong terug naar het Vercel-adres).
2. **Een claimmail** — vraag een claim- of inlogmail aan en open de link. De
   link hoort naar `https://onzemenukaarten.nl` te gaan en te werken.
3. **Een deellink** — open een menukaart, deel één gerecht en plak de link in
   een nieuw venster. Het adres begint met `https://onzemenukaarten.nl` en de
   voorvertoning (titel, beschrijving, afbeelding) klopt.
4. **De sitemap** — open `https://onzemenukaarten.nl/sitemap.xml`. Er staan de
   home, de lijst met restaurants, elke restaurantpagina en elke menukaart in;
   geen enkele regel wijst naar `/internal`, `/api`, `/mijn-restaurant`,
   `/claim`, `/kies` of `/mijn-lijstje`.
5. **`robots.txt`** — open `https://onzemenukaarten.nl/robots.txt`. De zes
   privépaden staan er als `Disallow` in en de laatste regel is
   `Sitemap: https://onzemenukaarten.nl/sitemap.xml`.
6. **`/r/[id]`** — open `https://onzemenukaarten.nl/r/6` en
   `https://onzemenukaarten.nl/r/6-blossem`. Beide horen door te sturen naar
   `https://onzemenukaarten.nl/restaurant/6`. Open daarna
   `https://onzemenukaarten.nl/r/9999`: dat hoort een nette 404-pagina te geven,
   geen doorverwijzing naar de home.
7. **Een bestaande QR-code** — scan een code die nog naar het oude adres wijst.
   Die moet uitkomen op dezelfde restaurantpagina.

## Wat er bewust niet is gedaan

- Geen doorverwijzing in de app zelf (middleware): dat doet Vercel.
- Geen DNS-record, Supabase-instelling of omgevingsvariabele in deze
  repository: dat zijn de stappen hierboven.
- Geen vast domein in de code: alles loopt via `NEXT_PUBLIC_SITE_URL`.
