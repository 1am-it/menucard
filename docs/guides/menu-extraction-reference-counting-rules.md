# Menu-extractie: telregels voor gecontroleerde referenties (#59)

Status: vooraf vastgelegd door de Delivery Lead op 21-10-2026, vóór het opstellen
van enige referentie voor Zuyd, Andalous, Pellens, Chocolat en Senang Makan
(besluit van de Product Owner, #59 issuecomment-6318192386). Deze regels worden
niet achteraf aangepast om een uitkomst te verbeteren. Een wijziging vergt een
nieuwe, gedateerde versie met reden, en een nieuwe meting.

## Bronversie

- Elke referentie hoort bij precies één **vastgezette bronversie**: de URL('s),
  de opgehaalde bytes met SHA-256, de tijd en het content-type. Alleen de
  openbare menupagina('s) of -pdf('s) die de bestaande veilige route leest,
  zonder login, zonder alternatieve vestiging en zonder andere hosts.
- De referentie wordt opgesteld **uit de vastgezette brontekst** en niet uit de
  parseruitvoer. Elk referentie-item draagt een citaat of locator in die
  bronversie. Overeenstemming met de parser maakt een referentie niet correct.
- Als de bron verandert, wordt een nieuwe versie gepind en een nieuwe referentie
  opgesteld. Een referentie wordt nooit "bijgewerkt" naar de nieuwe parseruitvoer.

## Wat telt als gerecht

1. **Gerecht**: een op de bron afzonderlijk benoemde, bestelbare regel met eigen
   naam, met of zonder prijs. Dranken tellen mee als ze in de vastgezette
   menubron staan. Elk gerecht telt **één keer per rubriekpad**.
2. **Varianten** van hetzelfde gerecht (glas/fles, klein/groot, per stuk/per
   portie, lunch/diner-prijs op één regel) vormen **één gerecht met meerdere
   prijsvarianten**. Een ontbrekende of verkeerde variant is een **prijsfout**,
   geen gemist gerecht.
3. **Supplementen en toevoegingen** ("+ €2,50 truffel", "supplement kaas") zijn
   **geen gerechten**. Een supplement dat als gerecht wordt geëxtraheerd, telt
   als **verzonnen gerecht**. Een supplementbedrag als hoofdprijs telt als
   **prijsfout**.
4. **Arrangementen en keuzemenu's** (meerdere gangen voor één prijs, "kies uit")
   tellen apart als **arrangement**, niet als gerecht. Een ontbrekend
   arrangement is een **gedocumenteerde beperking**, geen gemist gerecht, zolang
   de extractie het eerlijk als niet-ondersteund meldt. Onderdelen van een
   arrangement zonder eigen prijs zijn geen losse gerechten.
5. **Duplicaten**: staat hetzelfde gerecht op de bron in twee rubrieken, dan
   zijn dat twee referentie-items. Dezelfde pagina die via www, een slash of een
   redirect twee keer wordt gelezen, telt één keer. Een extra kopie die niet op
   de bron staat, is een verzonnen gerecht.
6. Kopjes, slogans, openingstijden, allergenenlegenda's, nieuws en
   niet-menu-inhoud (zoals geïnjecteerde spam) zijn geen gerechten. Als zo'n
   regel wordt geëxtraheerd, telt die als verzonnen gerecht.

## Matching

- **Naam**: gelijk na normalisatie: hoofd- en kleine letters, witruimte,
  leestekens aan begin en eind, en typografische aanhalingstekens en
  gedachtestreepjes. Een spellingsafwijking die wel op de bron staat, is gelijk.
  Een afgekapte of samengevoegde naam ("Hollands Zwitsers") is geen match: die
  telt als één verzonnen en één of meer gemiste gerechten. De Lead legt
  twijfelgevallen per item met een reden vast.
- **Prijs**: correct als het bedrag exact gelijk is, in euro's met twee
  decimalen, voor elke variant. Een ontbrekende prijs is correct als de bron
  ook geen prijs noemt, of als "op aanvraag" en de extractie dezelfde status
  heeft. Een prijs zonder bewijs op de bron is een prijsfout.
- **Rubriek**: het pad zoals de bron de hiërarchie toont (menutitel › sectie ›
  subsectie), genormaliseerd zoals bij namen. Een gerecht in een ander pad dan
  de referentie is een **rubriekfout**, ook als naam en prijs kloppen.
  Een pad dat de mens in de reviewroute heeft gecorrigeerd, telt volgens de
  bron en niet volgens de correctie.

## Rapportage per bron en totaal (afzonderlijk, nooit samengevoegd)

| Maat | Definitie |
| --- | --- |
| Gemiste gerechten | referentie-item zonder match in de extractie |
| Verzonnen gerechten | extractie-item zonder match in de referentie |
| Prijsfouten | gematchte gerechten met een verkeerde, ontbrekende of extra prijsvariant |
| Rubriekfouten | gematchte gerechten in een ander rubriekpad |
| Precisie / recall | over gerechten, per bron en totaal |
| Beperkingen | arrangementen, afbeeldingen en andere eerlijk gemelde niet-ondersteunde inhoud |

Een uitkomst geldt alleen voor de vijf vastgezette bronversies. Vijf bronnen
bewijzen geen foutloosheid voor toekomstige URL's. Bronnen waarop na deze meting
wordt bijgestuurd, zijn geen ongeziene holdout.

## Controle door de Lead

De Lead controleert iedere referentie onafhankelijk tegen de vastgezette bytes:
volledigheid (geen gemiste bronregels), juistheid van naam, prijs en pad, en
toepassing van deze telregels. Een referentie die niet zo is gecontroleerd,
wordt niet gebruikt voor acceptatie.
