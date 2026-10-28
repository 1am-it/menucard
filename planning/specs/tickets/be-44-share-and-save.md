# BE-44 — een gerecht delen en bewaren (lijstje) (#105)

Contract: https://github.com/1am-it/menucard/issues/105 (bron van waarheid; deze kopie volgt het issue). Uitvoering in drie rondes: deel 1 = delen + voorvertoning + app-icoon (criteria 1-3), deel 2 = bewaren en lijstje (criterium 4), deel 3 = anonieme tellers met migratiebestand (criterium 5, niet uitvoeren).


**Eigenaarsbesluit (28 okt):** de deelfunctie met lijstje, iconen **A1**: "Delen" met het iPhone-deelicoon, "Bewaren" met een bladwijzer ("Bewaard" als hij aanstaat). De anonieme tellers gaan door; het verdienmodel zelf is geparkeerd (#104).

**Visuele referentie (goedgekeurd):** https://claude.ai/artifact/JWaRewzvehJnmsnW4NxfgT:
- **Iconen:** variant A (Delen) en variant 1 (Bewaren);
- **Schermen:** 1 tot en met 6 en "Op een computer".

Het deelmenu zelf is het systeemmenu van de telefoon: dat bouwen we niet na.

### Acceptatiecriteria
1. **Delen per gerecht.** De gerechtkaart op `/menu/<id>` krijgt een knop **"Delen"** met icoon. Hij staat onder de beschrijving, niet naast de prijs, en het aanraakvlak is ≥ 44 px.
   - **Zo snel mogelijk doorsturen, zonder begeleidende tekst** (eigenaarsbesluit 28 okt): de gebruiker typt zelf in de chat.
   - **Op een telefoon:** `navigator.share({ url, title })` met alleen de bestaande deeplink van het gerecht (BE-12: openen, scrollen, oplichten). `title` is alleen de kop van het deelmenu en geen berichttekst. Er gaat geen `text` mee.
   - **Zonder `navigator.share`:** alleen de link naar het klembord, met de melding "Link gekopieerd" (`role="status"`).
   - **De voorvertoning (criterium 3) moet daarom op zichzelf alles vertellen:** gerecht, prijs, restaurant en waar.
2. **De ontvanger** komt met de deeplink bij het opgelichte gerecht, met de regel "Iemand deelde dit gerecht met je" en de hele kaart eronder.
3. **Voorvertoning (Open Graph).** Een gedeelde gerechtlink heeft eigen `og:title` ("<gerecht> · <prijs>"), `og:description` (restaurant en adres, één regel beschrijving) en `og:url`. Geen foto.
   - **App-icoon:** scherp, minstens 180 × 180 (`apple-touch-icon`), met het bestaande "om"-beeldmerk.
   - **Voorvertoningsafbeelding (`og:image`, 1200 × 630)** (eigenaarsbesluit 28 okt). Referentie: de artboards "Definitief · licht/donker" en "Lijstje · licht/donker" in https://claude.ai/artifact/JGinNNbzssNqikR8jvLhZa.
     - **Indeling D:** een ronde kaart met het restaurant groot bovenaan, het adres, het gerecht met de prijs in een vlak en één regel beschrijving. "onze menukaarten" staat klein rechtsonder.
     - **Kleuren van de app, naar de stand van de deler:**
       - **licht:** de omlijsting in `--accent-fill` #F6C057 en de kaart in `--card-surface` #FFFFFF. De tekst is `--text-primary` #1A1410 en `--text-secondary` #5C5650, de prijs staat in `--surface-soft` #F3F1EC en de lijnen in `--border` #EEEAE2;
       - **donker:** de omlijsting in `--bg` #1F2328 en de kaart in `--bg-card` #2A2F35. De tekst is #F2F3F4 en #B6BCC3, de prijs staat in `--surface-soft` #353A41 met `--text-primary` #F2F3F4, net als de prijs in de app (BE-42 3B), en de lijnen in `--border` #3A4048.

       Lees de waarden uit de themadefinitie in `app/globals.css`, niet als losse kopie, zodat ze meeveranderen als het thema verandert (eigenaar: "zoveel mogelijk de kleuren van de app").

       De stand gaat mee in de gedeelde link (bijvoorbeeld `?stand=donker`) en verandert de pagina voor de ontvanger niet.
     - **Techniek:** met `next/og` (`ImageResponse`), zonder nieuwe dependency en zonder foto. De afbeelding mag gecachet worden.
     - **Lijstje:** een eigen afbeelding in dezelfde indeling, "<n> gerechten om uit te kiezen", met per regel het gerecht, het restaurant en de prijs.
4. **Bewaren en het lijstje.**
   - **Knop:** de gerechtkaart krijgt **"Bewaren"** met een bladwijzer. Staat hij aan, dan toont hij "Bewaard" met een gevulde bladwijzer en `aria-pressed`.
   - **Opslag:** het lijstje staat alleen in de browser (`localStorage`, in try/catch), zonder account en zonder server. De pagina werkt ook als opslag niet kan.
   - **Onderbalk:** zodra er iets bewaard is: "<n> bewaard · Bekijken →".
   - **Pagina "Mijn lijstje":** gerecht, restaurant en prijs, verwijderen per gerecht, en de knop **"Lijstje delen"**.
   - **"Lijstje delen"** stuurt, net als bij één gerecht, alleen de link.
   - **Een gedeeld lijstje** is één link met de gerecht-id's in de URL (geen opslag op de server). De ontvanger ziet "Gedeeld lijstje · <n> gerechten", elk aan te tikken, plus "Zet ze op mijn eigen lijstje".
   - **Grenzen:** hooguit 20 gerechten per lijstje. Onbekende of verdwenen id's worden stil overgeslagen, en de pagina zegt hoeveel.
5. **Anonieme tellers.**
   - **Wat:** per gerecht één teller voor gedeeld, bewaard en klik op een reserveringslink.
   - **Privacy:** geen gebruikers-id, geen cookie, geen IP-adres, geen persoonsgegevens; alleen `+1` op een getal per gerecht per dag.
   - **Fouten:** een mislukte telling mag nooit de knop breken.
   - **Opslag:** een Supabase-migratie (`supabase/migrations/0021_*.sql`) met één tabel: per gerecht per dag drie tellers. Geen identiteit, geen cookies, geen IP-adressen. De schrijfrechten gaan alleen via een serverroute; er komen geen leesrechten voor de buitenwereld.
   - **Eigenaarsbesluit 28 okt:** het migratiebestand mag in deze PR mee. Het wordt **niet** uitgevoerd. De eigenaar past het na de merge toe via de bestaande workflow "Apply production database migrations". De telcode moet veilig falen als de tabel nog niet bestaat: dan niets tellen, de knop blijft werken.
6. **Bewijs:**
   - unit-tests voor de deeldata (alleen `url` en `title`, geen `text`), de lijstje-URL (coderen, decoderen, ongeldige invoer, limiet) en het klembord-alternatief;
   - screenshots op 1280, 390 en 320 px, in licht en donker;
   - `npm run test:stil` en de build groen.

### Niet in scope
- een eigen deelmenu;
- accounts;
- stemmen op gerechten;
- foto's;
- het verdienmodel (#104).

**Volgorde:** na BE-43 (#101). Criterium 5 (de tellers) is een aparte, laatste ronde.




