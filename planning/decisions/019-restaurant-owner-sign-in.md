# 019 — Inloggen voor restauranthouders

**Status:** besloten door de eigenaar, 30 okt 2026 (gebouwd in BE-47, #111)

## Besluit
Restauranthouders loggen in met alleen een **e-mailcode van 6 cijfers**:
- geen wachtwoord;
- geen authenticator-app;
- geen Google of Apple.

Ze blijven lang ingelogd op hun eigen toestel. Gevoelige acties, zoals het account verwijderen, vragen opnieuw een code.

## Waarom
- **Authenticator-apps** zijn voor horeca-ondernemers onpraktisch: velen hebben er geen, en wie zijn toestel verliest, komt niet meer binnen.
- **E-mail** heeft iedereen, kost niets en is al gebouwd voor het claimen (BE-48).
- **Google of Apple** heeft niet iedereen. Het maakt het scherm drukker voor een gemak dat maar een deel van de houders heeft.

## Wel voorbereid, nog niet aan
- **Sms-login:** de code ondersteunt een telefoonnummer, achter de vlag `NEXT_PUBLIC_OWNER_SMS_LOGIN`.
  - **Kosten:** ongeveer €0,07-0,10 per sms bij Twilio, MessageBird, CM.com of Spryng, via de Supabase-provider of de Send SMS hook.
  - **Risico:** misbruik door massaal sms'jes laten versturen (sms pumping). Aanzetten vraagt dus limieten, een botcontrole en een eigenaarsbesluit over de aanbieder en de kosten.
  - **Let op:** een restaurantnummer is vaak een vast nummer, en dat kan geen sms ontvangen.

## Later, aparte besluiten
- Een mail bij inloggen op een nieuw toestel. Daarvoor is een mailaanbieder nodig.
- Google of Apple als extra knop, als houders daarom vragen.
- Passkeys, zodra Supabase die als gewone login ondersteunt.
- Zelf de menukaart bewerken als houder. Dat vraagt een database- en ontwerpbesluit.

## Medewerkers
Medewerkers (`internal`, `editor`) houden de verplichte tweede stap met een authenticator-app (BE-48, #112).
