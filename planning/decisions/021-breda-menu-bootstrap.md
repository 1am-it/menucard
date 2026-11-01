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

## Aanvulling, 1 nov 2026: de leerlus (fase 1)
De eigenaar wil via deze route als beheerder zoveel mogelijk data toevoegen. De
lezer moet daarbij steeds beter worden. Afgesproken:
- **Taken:**
  - de **eigenaar** beslist over algemene regels: hoe namen eruitzien, wat de
    houder te zien krijgt, wat we weglaten;
  - de **Lead** kijkt de prijzen na tegen de website en vertaalt besluiten naar
    regels;
  - de **developer** bouwt elke regel met een fixture en een test.

  De eigenaar kijkt geen prijzen na.
- **Review per batch, niet per kaart.** In de chat staan alleen de uitzonderingen
  en de regelvragen, als genummerde keuzes met een advies. Wat klopt, meldt de
  Lead als aantal.
- **Het correctielog:** `ops/scripts/menu-bootstrap/corrections.md`. Daarin staan
  elke regel, het besluit, een voorbeeld en de status, plus het slagingspercentage
  per batch.
- **De stopregel:** geen merge van een kaart zonder de prijscontrole van de Lead.
- **Vervolg** (nog niet besloten, advies van de Lead):
  - **fase 2:** een reviewscherm in `/internal`. De motor levert dan concepten in
    de werkvoorraad van besluit 016, met de uitzonderingen eerst, en een knop "maak
    hier een regel van". Pas zodra de lezer op de 25 stabiel is (15 of meer
    geslaagd).
  - **fase 3:** kaarten die alle regels halen gaan automatisch door. Pas als het
    slagingspercentage ook op de werklijst van BE-72 hoog is, zonder fouten in
    prijzen.
  - **Tips voor de houder** (bijvoorbeeld bij dubbele namen) in Mijn restaurant.
    Dat wordt een apart ticket, na fase 2.

## Aanvulling, 1 nov 2026: reviewronde 2
De eigenaar besliste R4 tot en met R8. Ze staan in het correctielog. Twee
besluiten wijken af van het oorspronkelijke besluit:
- **R6, bijna-complete kaarten.** Een kaart waarvan minstens 90% in orde is, mag
  zonder de twijfelgevallen op de site. Er staat dan een zichtbare melding bij,
  met een link naar de bron. Dit is een uitzondering op besluit 016 §4, alleen
  voor deze startvulling.
- **R8, begrensde AI voor kaarten als afbeelding.** Dit vervangt voor deze
  startvulling de regel "geen AI" uit vangrail 2:
  - alleen `claude-haiku-5-5`, via de bestaande code van BE-33;
  - alleen de restaurants met een kaart als afbeelding;
  - een harde kostengrens van € 1, zonder herpogingen;
  - de eigenaar draait het script in zijn eigen terminal en voert daar de sleutel
    in, liefst een aparte sleutel "startvulling" die hij daarna intrekt. De Lead,
    de runners en DeepSeek zien de sleutel nooit;
  - de Lead controleert elke prijs tegen de afbeelding.

  Dit geldt niet als akkoord voor betaalde AI in de app (BE-21 blijft
  NEEDS_APPROVAL).

## Wat het niet doet
- Geen herkomst per veld in de database (`field_provenance`). Dat is bewust
  geaccepteerd voor deze eenmalige vulling.
- Geen nieuwe restaurants buiten de bestaande 25.
- Geen publicatie zonder review: de Lead merget pas na de controle.
