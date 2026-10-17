# Gericht Contextgebruik

Doel: correct werken binnen actuele projectafspraken met minder herhaling.
Geen gegarandeerd besparingspercentage; meet per geaccepteerd resultaat.

## Altijd Voldoende Context

Pas bij iedere opdracht de relevante actuele project-MD's toe. Controleer
gewijzigde instructies aan de hand van versie/diff of bestandsinhoud.
Lees bij een nieuwe sessie altijd startpunt, kernveiligheid, rol, contract en
checkpoint; een wijzigingshash vervangt geen ontbrekende inhoud.

## Gericht Lezen

- Lees de toegewezen rol en het relevante werkgebied, niet alle rolpakketten.
- Zoek eerst bestandsnamen/symbolen; lees gerichte stukken daarna volledig
  genoeg om het gedrag en afhankelijkheden te begrijpen.
- Gebruik een kort checkpoint met verwijzingen in plaats van chattranscripten.
- Houd het startbestand kort, maar schrap geen noodzakelijke veiligheidsregel.
- Laad hulpmiddelen alleen voor relevante taken; meerdere werkgebieden mogen
  dezelfde test- of ontwerpskill gebruiken.
- Download niet steeds ongewijzigde upstream-pakketten. Alleen een bewuste
  versie-update verandert de basis van het project.

## Tests En Logs

Draai tijdens bouwen gerichte regressies. Bewaar volledige logs buiten de
modelcontext en toon samenvatting plus concrete fouten. Lees meer log alleen
wanneer dat nodig is. Test bij integratie het afgesproken geheel en vergelijk
de echte interface met de referentie. Kortere logs zijn geen toestemming om
controlewerk over te slaan of fouten te verbergen.

## Meten

Registreer waar de runner dit beschikbaar stelt: input/output/cachetokens,
werkbeurten, looptijd, aantal rondes, testuitkomst en herstelwerk. Ontbrekende
metingen zijn onbekend, niet nul. Een berekende API-prijs bewijst geen extra
afschrijving op een abonnement. Doe geen kostenclaim zonder passende bron.

Minder leesacties betekent niet automatisch minder gefactureerde tokens:
aanwezige gesprekscontext kan blijven meetellen; caching verschilt per provider.
Vergelijk daarom verbruik per geaccepteerd onderdeel, niet alleen per ronde.
