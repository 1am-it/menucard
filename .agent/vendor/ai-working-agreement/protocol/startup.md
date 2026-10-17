# Starten En Koppelen

## Expliciete Projectbinding

Start vanuit de aangewezen projectmap of repository. Leg repository, branch,
rol, uitvoerder, taak, contract, referentiecommit en schrijfgrenzen vast.
Als de AI vanuit een algemeen agentpakket start, moet INPUT.md dezelfde
projectbinding ontvangen; het pakket mag niet zelf een project raden.

De projectmap is de werkmap. Agentpakketten zijn instructies, geen alternatieve
applicatiecode. Relatieve projectpaden worden vanuit de projectroot gelezen;
pakketeigen links vanuit dat pakket. Verander niet ongemerkt van repository.

## Leesroute

1. Project-AGENTS.md en .agent/START.md, wanneer aanwezig.
2. Projectwerkafspraken, rollen/assignments en versieregistratie.
3. Vastgepinde algemene werkafspraken en de toegewezen rolhandleiding.
4. Projectaanvulling op die rol, relevante CONTEXT.md en leidende besluiten.
5. Actueel ticket, goedgekeurd contract/ontwerp en laatste checkpoint.
6. Werkelijke bestanden, branch, PR, tests en taakverantwoordelijkheid.

Gebruik in een bestaand project de vastgelegde versie, niet de nieuwste main
van de template. Ontbreekt de inrichting, behoud de bestaande instructies.
Stel noodzakelijke inrichting voor; ontbrekend is niet hetzelfde als toegestaan.

## Nieuwe Inrichting

Neem de gekozen pakketten lokaal over in .agent/vendor/. Registreer naam,
upstream-URL, versie, exacte broncommit en het lokale pad. Optioneel registreer
bestands-hashes voor controle van onbedoelde lokale veranderingen.
Zelfverwijzende commit-SHA's in een pakket zijn niet nodig: het consumerende
project registreert de werkelijk overgenomen commit.

Projectaanvullingen leven buiten vendor, bijvoorbeeld .agent/project/developer.md.
Geen overschrijven van bestaande bestanden of dupliceren van lang beleid.
Een gebruikersinterface vraagt een goedgekeurde referentie voordat de
wezenlijk nieuwe flow wordt gebouwd. Een template is niet dat akkoord.

## Gereedschap

Gebruik de beschikbare tooladapter alleen waar hij nodig is. Een bestand
CLAUDE.md of een ander toolstartbestand verwijst naar de projectleesroute;
het heeft geen afzonderlijk productbeleid. Niet iedere AI herkent dezelfde
bestandsnamen of leest CONTEXT.md automatisch.

Mapgrenzen en MD-instructies zijn geen toegangscontrole. Beperk rechten ook
in de runner. Geen nieuwe credentials, installaties of extra toegang als
stilzwijgend onderdeel van deze startprocedure.
