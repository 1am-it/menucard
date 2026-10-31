# 021 — Eenmalige startvulling van de menukaarten in Breda

**Status:** besloten door de eigenaar, 1 nov 2026. Gebouwd in BE-71.

## Aanleiding
De publieke site leest `data/restaurants.json` en `data/menus.json` (besluit 016).
Op 1 nov 2026 stonden daarin 25 restaurants. Daarvan hadden er 4 een menukaart,
opgehaald op 25 maart 2026. De route van besluit 016 (vinden, activeren,
concept, review-PR) is gebouwd, maar heeft nog geen kaart gepubliceerd. Zonder
gevulde kaarten kan de site bij de lancering niet laten zien wat hij belooft.

## Besluit
1. **Eenmalig, vóór de lancering, alleen voor Breda,** mag een lokaal script de
   kaarten rechtstreeks in `data/menus.json` zetten, buiten de interne
   beoordeling van besluit 016 om. Dat geldt voor de bestaande 25 restaurants:
   de 21 zonder kaart, en een verversing van de 4 met een kaart.
2. **Vangrails:**
   - **Volledigheid zoals in besluit 016 §4.** Elk herkend gerecht heeft een
     prijs en een categorie, en er zijn geen open aandachtspunten. Anders
     wordt het restaurant overgeslagen en gaat het naar de handmatige route.
   - **Geen AI en geen betaalde dienst.** Alleen de bestaande,
     deterministische lezers voor html en pdf.
   - **Netjes ophalen.** Alleen de eigen website van het restaurant, binnen de
     grenzen van `restaurantSourceFetch` en de url-intake: dezelfde host, één
     linkstap en hooguit vijf kandidaten. robots.txt wordt gerespecteerd, er
     zit rust tussen de verzoeken, en de user-agent noemt zichzelf.
   - **Bron en datum bij elke kaart** (`source`, `scraped`). Die zijn zichtbaar
     op de site.
   - **Eén commit per restaurant,** zodat de Lead elke kaart los kan nakijken en
     terugdraaien. De Lead vergelijkt per kaart minstens 10 prijzen en alle
     opvallende prijzen met de echte website.
3. **Het is een uitzondering, geen nieuwe route.** Na de lancering lopen alle
   wijzigingen weer via besluit 016. Nieuwe restaurants en verversingen lopen
   ook via de pijplijn, of via een later besluit (`MARKET-09`, een vaste
   verversingscyclus).
4. **Het script is herbruikbaar.** Ophalen, lezen en de volledigheidseis staan
   los van de uitvoer. Nu schrijft het naar `data/menus.json`; later kan
   dezelfde motor concepten in de pijplijn zetten.
5. **Bezwaar van een restaurant:** de kaart gaat er meteen uit.

## Waarom
- **De site is nog niet publiek.** Een fout bereikt geen bezoekers, en elke kaart
  is terug te draaien.
- **Snelheid.** Er is geen productietoegang nodig, en geen beoordeling per
  restaurant door de eigenaar.
- **Herbruikbaarheid.** De motor is ook de basis voor latere steden.

## Wat het niet doet
- Geen herkomst per veld in de database (`field_provenance`). Dat is bewust
  geaccepteerd voor deze eenmalige vulling.
- Geen nieuwe restaurants buiten de bestaande 25.
- Geen publicatie zonder review: de Lead merget pas na de controle.
