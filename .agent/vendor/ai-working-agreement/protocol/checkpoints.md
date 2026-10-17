# Opslaan En Hervatten

Een MD-afspraak alleen kan een proces niet veilig stoppen of herstarten.
Dit protocol schrijft bewijsbare overdracht voor; het claimt geen runnergarantie.

## Checkpoint

Gebruik [het sjabloon](../templates/checkpoint.md). Leg vast:

- Project, rol, taak, branch/PR en exact opgeslagen commit.
- Welke contract-/ontwerpversie gebruikt is.
- Wat af is en welke tests werkelijk zijn uitgevoerd.
- Open wijzigingen, untracked bestanden en waar die bewaard zijn.
- Resterende taak en concrete volgende stap, zonder breed heronderzoek.
- Stopreden, volgende eigenaar en wel/niet beschikbare automatische hervatting.

Geen secrets, persoonsgegevens of volledige uitvoertranscripten. Een link
naar een verdwenen runnerbestand is geen duurzame overdracht. Verifieer
opslag en remote-status voor je zegt dat werk behouden is.

## Beurten En Tijd

Plan bij een ronde met 64 beurten een kleiner deelresultaat en reserveer
bijvoorbeeld ongeveer tien beurten voor gerichte tests, opslaan en overdracht.
Dat is een planning, geen technisch afgedwongen stop. Toolbeurten zijn geen
vaste eenheid werk; de runner bepaalt de telling. Verhoog geen budget of
maximale kosten zonder de geldende toestemming.

Voor een echte runnerverbetering zijn nodig: vroegtijdig persistente opslag,
controleerbare checkpointvalidatie, beperkte retries, taakvergrendeling,
kosten-/tijdgrenzen en bevestigde remote-opslag. Verzamel onaf werk zonder
het automatisch als releasewaardig of definitief te committen. Voorkom dat
een ongecontroleerde eindhook secrets of onbedoelde bestanden publiceert.
Dit zijn nog te implementeren en testen eisen, niet reeds geleverde functies.

## Overname

Controleer code en opgeslagen checkpoint opnieuw. Stop een vorige schrijver
niet ongeautoriseerd en begin niet concurrerend aan dezelfde bestanden.
Een nieuwe agent krijgt alleen de bedoelde rol en bestaande taaktoestemming,
niet automatisch credentials, productierechten of extra budget.

Bij een limietstop onderscheid max-turns, timeout, providerquota en technische
fout. Herhaal niet eindeloos dezelfde mislukte ronde. Een read-only monitor
mag geen startbericht plaatsen tenzij zijn opdracht dat expliciet toestaat.
Zonder geautoriseerde vervolgstart: rapporteer eerlijk dat er geen ronde loopt.
