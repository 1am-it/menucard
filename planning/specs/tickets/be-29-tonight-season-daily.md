# Ticket #70 — BE-29 slimmere Vanavond op de kaart, seizoen en daghap

Live contract en status: GitHub issue #70.


**Eigenaarsbesluit (2026-10-25):** "akkoord ik volg al jouw adviezen". Dat geldt voor de selectieregels, de seizoensaanpak en het daghap-minimum hieronder, inclusief:
- een lichte voorrang voor "Nieuw op de kaart";
- de sectie verbergen bij minder dan 3 gerechten;
- verlopen daghappen blijven op de menukaart zichtbaar, met de brondatum.

**Volgorde:** start pas na BE-28b (#68). Er is één schrijver tegelijk.

**Visuele referentie:** de bestaande BE-28-stijl (`docs/mockups/be-28-fresh-style-v1/`): dezelfde kaarten, tegels en labels. Er is geen nieuwe pagina, dus geen aparte ontwerpstap nodig. Nieuwe labels volgen het bestaande label-patroon (emoji plus tekst).

### Acceptatiecriteria
1. **Selectie voor "Vanavond op de kaart"** staat in één pure, geteste functie, zonder AI, populariteit, betaling of persoonsgegevens.
   - **Wat mag erin:**
     - een gepubliceerde menukaart;
     - het menutype past bij het moment: lunch vóór 15:00, borrel van 16:00 tot 18:00, daarna diner;
     - het restaurant is vandaag open in dat deel van de dag (`openingStatus`);
     - een echte prijs (geen "op aanvraag" en geen lege prijs);
     - een hoofdgerecht of bestelbaar gerecht, afgeleid uit de rubriek (geen dranken, sauzen of bijgerechten).
   - **Variatie:**
     - hooguit één gerecht per restaurant;
     - zo veel mogelijk verschillende keukens;
     - prijsspreiding: één onder € 15, één van € 15 tot 25, één daarboven;
     - iets vegetarisch als het label er is;
     - één seizoensgerecht als dat er is (criterium 3).
   - **Keuze:**
     - de keuze is vast per dag (de datum als startwaarde), voor iedereen gelijk en dus cachebaar;
     - een recent bijgewerkte menukaart krijgt een lichte voorrang en het label "✨ Nieuw op de kaart".
   - **Titel per moment van de dag:** "Nu op de lunchkaart", "Borrel" of "Vanavond op de kaart".
   - **Minder dan 3 gerechten:** dan verdwijnt de sectie.
2. **Eerlijke prijs:** staat in de bron een prijs voor 2 personen, per kilo of iets dergelijks, dan toont de kaart dat erbij. Anders alleen de prijs.
3. **Seizoen:**
   - de home krijgt seizoenstegels via één geteste kalender: 🌿 Asperges (apr–jun), 🦪 Mosselen (sep–mrt), 🦌 Wild (okt–dec), 🎃 Pompoen (sep–nov);
   - een tegel is een zoekopdracht en verschijnt alleen als die nu echt resultaten heeft;
   - het label "🌿 Seizoen" alleen als de kaart dat zelf zegt (een Wildkaart, Seizoenskaart of de rubriek "Seizoen"), nooit alleen op basis van een woord in de gerechtnaam.
4. **Daghap (minimum):**
   - het label "📅 Daghap" alleen als de bron het zelf noemt (Daghap, Dagschotel, Dagspecial, Vandaag, of het bestaande `Dagspecial`-label);
   - altijd met "volgens de kaart van [brondatum]";
   - alleen in "Vanavond op de kaart" als de bron van vandaag is;
   - een verlopen daghap blijft op de menukaart zichtbaar, met de datum;
   - geen dagelijkse automatische controle van bronnen.
5. **Klik naar het gerecht:** een tik op een gerecht opent de menukaart op dat gerecht, gemarkeerd.
7. **`/restaurants` uitfaseren** (eigenaar 2026-10-25, "3 akkoord"): de oude pagina stuurt permanent door (308) naar `/alle-restaurants`, met behoud van een eventuele zoekterm waar die overeenkomt. Oude code en tests die alleen die pagina dienen, mogen weg; gedeelde componenten blijven.
8. **Bewijs:**
   - unit-tests voor de selectie, de seizoenskalender en het verlopen van de daghap, met een vaste datum en tijd;
   - screenshots van de home op 1280, 390 en 320 px, licht en donker, op drie momenten van de dag;
   - `npm test` en `npm run build` groen.

### Niet in scope
- nieuwe data, migraties of API-routes;
- AI, analytics, accounts of betaalde plaatsing;
- dagelijks automatisch bronnen opnieuw lezen;
- restaurants hun eigen daghap laten invoeren. Dat is later een apart onderzoekstraject en vraagt eerst een ontwerp plus een besluit over moderatie en claim.

**Rollen:** Lead = Claude Code. Developer = DeepSeek via de lokale runner.
