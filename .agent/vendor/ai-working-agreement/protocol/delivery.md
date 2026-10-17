# Van Opdracht Naar Bewijs

## Contract

Gebruik [het bouwcontract](../templates/build-contract.md). Leg gewenste
uitkomst, scope, voorbeelden, non-goals, goedkeuring, veiligheidsgrenzen en
meetbare acceptatie vast. Splits een groot resultaat in kleine bouwrondes,
niet automatisch in meerdere PR's. Een opdracht heeft een expliciete eigenaar.

## Bouwronde

Gebruik [de werkkaart](../templates/work-round.md): een resultaat, gerichte
bestanden en tests, duidelijke stopconditie en overdracht. Begin vanaf het
laatste geverifieerde checkpoint; herhaal niet de hele onderzoeksfase.
Een nieuwe sessie controleert wel de essentiële instructies en echte code.

Sla een bruikbaar deelresultaat en checkpoint op zodra het beschikbaar is.
Wacht niet tot de laatste beurt. Voer geen brede repo- of suite-scan uit als
de gerichte volgende stap bekend is. Voer bij integratie wel de vereiste
complete tests en productacceptatie uit.

## Review

De review vergelijkt huidig diff, contract en exact goedgekeurd ontwerp.
Controleer scenario, bestemming/klikpad, rol, leeg/fout/partieel, mobiel,
toetsenbord en thema waar relevant. Een module verplaatsen is niet vanzelf
een kortere gebruikersflow. Bewaak dat bestaande functies bereikbaar blijven.

Controleer rechten ook bij de server, niet uitsluitend via verborgen knoppen.
Vergelijk preview- en exportpaden waar gelijkheid een contractvoorwaarde is.
Leg bewijs en resterende hiaten vast met [het reviewrapport](../templates/review-report.md).
Historische groene checks bewijzen een nieuw head niet.

## Oplevering

READY_FOR_REVIEW alleen als de opdracht toetsbaar is opgeleverd; vermeld
nog ontbrekende operationele of live controles expliciet. Geen onbewezen claim
dat een andere agent is aangestuurd of een scherm werkelijk is bekeken.
Release, merge en productie blijven de menselijke gate tenzij een specifieke
taaktoestemming anders bepaalt. Geen workflow- of credentialwijziging om die
gate te omzeilen. Documenteer status met een volgende eigenaar.
