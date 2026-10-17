# AI Working Agreement

Een gezamenlijke startplek voor projecten met verschillende AI-agents.
Rollen zijn onafhankelijk van het gebruikte model of gereedschap.

**Status: concept v0.1.0.** Dit is het gedeelde documentatieprotocol.
Het is nog geen beproefde v1.0 en installeert geen uitvoerende agent.
Automatische hervatting en kostenbegrenzing zijn niet technisch ingericht.

Repository: https://github.com/1am-it/ai-working-agreement

## Documenten

- [Werkafspraken](AI-WORKING-AGREEMENT.md): rollen, bevoegdheden en waarheid.
- [Startprocedure](protocol/startup.md): van agentpakket naar project.
- [Oplevering](protocol/delivery.md): bouwen, toetsen en overdragen.
- [Contextgebruik](protocol/context-efficiency.md): gericht werken en meten.
- [Checkpoints](protocol/checkpoints.md): bewaren en veilig hervatten.
- [Projectstructuur](templates/project-context.md): projectspecifieke invulling.
- [Versiebeleid](VERSION.md) en [wijzigingen](CHANGELOG.md).

## Kies Je Startpunt

| Situatie | Standaardprompt |
| --- | --- |
| Nieuw project inrichten | [Nieuw project starten](prompts/new-project.md) |
| Bestaand project hervatten of aan een andere AI overdragen | [Project overnemen](prompts/take-over-project.md) |

Open de AI in de bedoelde projectmap of wijs de projectrepository aan.
Je hoeft de volledige prompt niet zelf te bewaren. Verwijs naar het
betreffende bestand in deze map of, na publicatie, naar de GitHub-versie.
Een link opent een document; hij start op zichzelf geen agent of bouwronde.

Korte opdracht voor een nieuw project:

> Gebruik de standaardprompt Nieuw project starten uit ai-working-agreement.
> Het project is [projectmap of repository]. Het gewenste resultaat is [doel].

Korte opdracht voor een bestaand project:

> Gebruik de standaardprompt Project overnemen uit ai-working-agreement.
> Het project is [projectmap of repository], de opdracht is [ticket].

Een AI zonder toegang tot deze documenten moet dat melden, niet doen alsof
de prompt of het protocol is gelezen.

## Van Algemene Basis Naar Project

1. Start vanuit het project en lees de bestaande instructies voordat je iets wijzigt.
2. Gebruik bij een bestaand project de daar vastgelegde protocol- en agentversies.
3. Leg bij nieuwe inrichting de gekozen broncommits en versies expliciet vast.
4. Bewaar lokale kopieen van agentpakketten in `.agent/vendor/`.
5. Bewaar projectaanvullingen apart; overschrijf ze niet met template-updates.
6. Neem algemene updates alleen bewust en controleerbaar over, niet tijdens
   een bouwronde automatisch van de nieuwste branch.

Beoogde projectstructuur, niet een verplicht lijstje lege mappen:

```text
project/
  AGENTS.md                       Kort startpunt en verplichte leesroute
  AI-WORKING-AGREEMENT.md          Projectafspraken en verwijzing naar de basis
  .agent/
    START.md                      Project, opdracht en checkpointverwijzing
    versions.md                   Protocol- en agentversies met broncommits
    assignments.md                Rollen en taakverantwoordelijkheid
    vendor/                       Vastgepinde algemene pakketten
    project/                      Projectspecifieke rolafspraken
  planning/CONTEXT.md              Specificaties, architectuur en besluiten
  src/CONTEXT.md                   Codepatronen en testafspraken
  docs/CONTEXT.md                  Ontwerp- en documentatiebronnen
  ops/CONTEXT.md                   Omgevingen en operationele grenzen
```

## Rollen

- **Product Owner & Release Approver:** de mens beslist over productkeuzes
  en releases. Een AI kan besluiten voorbereiden, niet zelf toestemming geven.
- **AI Delivery Lead:** bewaakt contract, bouwrondes, voortgang en review.
- **AI Product Designer:** levert ontwerp en ontwerpoverdracht.
- **AI Implementation Engineer:** bouwt, test en bewaart checkpoints.

Algemene rolhandleidingen staan in afzonderlijke private repositories:

- https://github.com/1am-it/ai-delivery-lead
- https://github.com/1am-it/ai-product-designer
- https://github.com/1am-it/ai-developer

De rolpakketten verwijzen naar een vaste versie van dit protocol.
Een model wisselen verandert niet automatisch de rol of toegangsrechten.

## Levend Projectkader

Bij iedere opdracht past de AI de actuele relevante project-MD's toe.
Ontbrekende of gewijzigde context wordt eerst gelezen. Herhaal niet onnodig
de volledige documentatie in prompts of logs. Een nieuwe sessie krijgt altijd
de essentiële grenzen en voldoende context om veilig te handelen.

Relevante projectdocumentatie verandert in dezelfde PR als de code.
Nieuwe productkeuzes, kosten, toegang of releasebevoegdheden vereisen eerst
expliciete toestemming; een documentwijziging geeft die toestemming niet.
Een onderwerp heeft een leidende bron; andere documenten verwijzen daarnaar.

## Wat Dit Niet Regelt

Deze bestanden installeren geen model, geven geen rechten, starten geen
workflow en garanderen geen automatische hervatting of tokenbesparing.
Daarvoor zijn een uitvoerende bouwomgeving, passende toegang en afzonderlijk
geteste controles nodig. Bewaar nooit wachtwoorden of tokens in deze bestanden.
