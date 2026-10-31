# 020 — Een licht bezoekersaccount (fase 2)

**Status:** voorstel, 31 okt 2026. Wacht op een besluit van de eigenaar (#154).
Dit is nog geen bouwcontract.

## Aanleiding
Bezoekers hebben nu geen account. "Geen account nodig" is een kernbelofte.
BE-62 liet bezoekers terugkomen zonder account: het lijstje en de stemmingen
blijven in de browser bewaard. Die oplossing heeft twee grenzen:
- **Het lijstje leeft op één toestel.** Wie op de telefoon bewaart en thuis op
  de laptop kijkt, ziet niets. Wie de browsergegevens wist, is alles kwijt.
- **Wie een stemming start, moet zelf terugkijken.** Er is geen seintje als
  iedereen gestemd heeft.

Een licht account lost die twee op, maar alleen als het nooit verplicht wordt.

## Voorstel in het kort
1. **Een account is een extraatje, geen poort.** Delen, bewaren, stemmen en
   zoeken blijven zonder account precies zo werken als nu.
2. **Inloggen met een e-mailcode van 6 cijfers.** Er is geen wachtwoord, net als
   bij houders (besluit 019). We gebruiken dezelfde Supabase-login en dezelfde
   codeflow, met een eigen bezoekersprofiel.
3. **Wij vragen alleen een e-mailadres.** Geen naam, geen telefoon, geen
   geboortedatum.
4. **Het aanbod verschijnt alleen op het moment dat het iets oplevert.** Er is
   één rustige regel in de pagina. Er komen geen pop-ups, geen banners bij
   binnenkomst en geen "registreer om verder te gaan".
5. **Het bestaande lijstje gaat mee.** Bij de eerste keer inloggen worden het
   lijstje in de browser en het lijstje in het account samengevoegd. Niets gaat
   verloren en dubbele gerechten tellen één keer.

## Momenten en voordelen
| # | Moment | Regel in de pagina | Wat er nodig is |
|---|---|---|---|
| A | Bij 3 of meer bewaarde gerechten, op `/mijn-lijstje` | "Bewaar je lijstje ook op je laptop of andere telefoon" | Alleen de inlogcode per mail |
| B | Na het starten van een stemming, op de bevestiging | "Krijg een mailtje als iedereen gestemd heeft" | Een extra mail per stemming |
| C | Bij een restaurant met een daghap | "Volg dit restaurant: zie zijn daghap als eerste" | Mail per daghap, of een overzicht |
| D | Na een paar bezoeken | Een wekelijks mailtje "Nieuw op de kaart in Breda" | Nieuwsbrief, met aparte toestemming |

**Advies: begin met A, daarna B.**
- A is het kleinste stuk werk. Het vraagt geen nieuwe soort mail: alleen de
  inlogcode, die er voor houders al is.
- B is het meest onderscheidend: geen andere menusite heeft het. Het gebruikt
  dezelfde login, maar vraagt wel een mail op het juiste moment.
- C en D zijn marketingmail. Daarvoor zijn een aparte toestemming per soort
  mail, een afmeldlink in elke mail en een verzendlijst nodig. Die stellen we
  uit tot A en B gebruikt worden.

## Wat het account wel en niet bewaart
**Wel:**
- het e-mailadres;
- het lijstje (de kenmerken van de gerechten, de volgorde en de datum van bewaren);
- de stemmingen die deze persoon zelf startte, en of er een seintje gewenst is;
- per mailsoort of er toestemming is, met de datum.

**Niet:**
- **wie op welk gerecht stemde.** Stemmen blijft anoniem, ook voor wie een
  account heeft. Het account weet alleen welke stemmingen het zelf startte;
- zoekopdrachten, bekeken pagina's of locatie;
- een naam of telefoonnummer.

## Privacy en bewaartermijnen (voorstel)
- **Een eigen privacyverklaring voor bezoekers.** Daarin staan wat we bewaren,
  waarom, hoe lang en hoe je het verwijdert. Die verklaring is er nu nog niet;
  zonder verklaring gaat dit niet live.
- **Verwijderen kan zelf, op elk moment,** vanuit het account, met een nieuwe
  code ter bevestiging. Alles wordt meteen gewist. Het lijstje in de browser
  blijft staan.
- **Na 24 maanden zonder inloggen** krijgt de bezoeker één mail. Wie dan niet
  binnen 30 dagen inlogt, wordt verwijderd.
- **Stemmingen** volgen hun eigen regel: ze worden na 7 dagen opgeruimd, ook als
  er een account bij hoort.
- **Mailtoestemming** staat standaard uit en geldt per soort mail. Het seintje
  bij een stemming (B) is een dienstmail die de bezoeker zelf aanzet bij die ene
  stemming. Nieuws (D) is marketing en vraagt een eigen vinkje.

## Techniek in hoofdlijnen
- **Dezelfde login als houders.** De rol volgt uit een apart profiel. Een houder
  kan ook bezoeker zijn, met hetzelfde adres, maar `/mijn-restaurant` blijft
  alleen voor houders. Bezoekers krijgen een eigen tabel met RLS: ieder ziet
  alleen het eigen lijstje.
- **Inlogscherm.** `/inloggen` (BE-66) krijgt een korte keuze bovenaan:
  "Voor je lijstje" of "Voor je restaurant". Het is dezelfde codeflow met een
  andere bestemming.
- **Laadgewicht.** De login wordt pas geladen als iemand op de regel tikt. De
  zoekpagina, de restaurantpagina en de homepage worden niet zwaarder.
- **Migratie.** Een nieuwe migratie voor het profiel en het lijstje. Die draait
  de eigenaar via de bestaande workflow.

## Afhankelijkheid: een mailaanbieder
De ingebouwde mail van Supabase is bedoeld voor testen. Hij verstuurt maar een
paar mails per uur. Voor houders is dat genoeg; voor bezoekers niet. Voor A is
dus al een eigen mailaanbieder (SMTP) nodig, en voor B en verder zeker. Dit is
dezelfde open keuze als bij de wekelijkse mail voor houders.

Opties (prijzen indicatief, nog controleren bij de keuze):
1. **Resend:** een gratis laag van ongeveer 3.000 mails per maand. Eenvoudig te
   koppelen aan Supabase. **Advies.**
2. **Brevo:** een gratis laag van ongeveer 300 mails per dag. Een Europees
   bedrijf, met nieuwsbrieven erbij (handig voor D).
3. **Postmark:** betaald vanaf ongeveer $15 per maand. De beste aflevering, maar
   kosten vanaf dag één.

Voor alle drie geldt: de domeininstellingen (SPF, DKIM) zijn eigenaarswerk, net
als de sleutel. Die voert de eigenaar zelf in, nooit via de chat.

## Wanneer niet
- **Als het de belofte breekt.** Zodra een functie alleen nog met een account
  werkt, stoppen we en vragen we de eigenaar.
- **Vóór de publieke lancering heeft dit weinig zin.** Zolang de site achter een
  wachtwoord staat, zijn er geen echte bezoekers om te laten terugkomen. Advies:
  besluit nu, en bouw A in de laatste weken vóór de lancering of meteen erna.

## Besluiten voor de eigenaar
1. **Principe:** komen er bezoekersaccounts, als extraatje en nooit verplicht?
2. **Volgorde:** eerst A (lijstje op meerdere toestellen), daarna B (seintje bij
   een stemming)? C en D later?
3. **Mailaanbieder:** Resend, Brevo of Postmark?
4. **Privacyverklaring:** de Lead schrijft een concept. Advies: laat het voor de
   lancering één keer juridisch nalezen.
5. **Moment:** nu bouwen, of vlak voor de lancering?

## Mockup
https://claude.ai/artifact/BqEQ9z5Ytvw9z8hjCd9hyi (5 schermen). Die toont de regel op `/mijn-lijstje`, de keuze op
`/inloggen`, het samenvoegen na het inloggen, de bevestiging van een stemming
met het seintje, en "Mijn account" met verwijderen.
