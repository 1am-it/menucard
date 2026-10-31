'use strict';

// BE-66 (#162) — de zware helft van de houder-inlog, pas bij het versturen.
//
// /inloggen had een eerste lading van 177 kB, terwijl de andere publieke
// pagina's op 109-121 kB zitten. De oorzaak was één statische import: het
// formulier trok via src/lib/supabaseBrowser.js de complete
// @supabase/supabase-js mee, ook als een bezoeker alleen maar keek.
//
// Daarom staan de twee Supabase-aanroepen van de houder-inlog sinds deze ronde
// hier: src/components/OwnerLoginCodeForm.js laadt dit bestand pas bij een tik op
// "Stuur mij een inlogcode" (of bij het inloggen met de code), met `import()`.
// Deze module laadt op zijn beurt de bestaande, ongewijzigde logica
// (src/lib/claimEmailCodeFlow.js) en de bestaande client
// (src/lib/supabaseBrowser.js). Er is dus geen tweede kopie van de flow en geen
// tweede client: alleen het moment van laden is veranderd.
//
// Geen sessieopslag en geen eigen token hier: de client regelt dat zoals altijd
// (zie de toelichting in src/lib/supabaseBrowser.js). Deze module gooit niets
// zelf: de flow vertaalt fouten, het formulier vangt een ontbrekende
// configuratie af met zijn eigen eerlijke melding.

/** Named export of `default`-export, afhankelijk van hoe de bundel het bestand inleest. */
function pick(module, name) {
  if (module && typeof module[name] === 'function') return module[name];
  if (module && module.default && typeof module.default[name] === 'function') return module.default[name];
  throw new Error(`Ontbrekende inlogfunctie: ${name}`);
}

/** Laadt de flow en de client één keer, als één chunk, en geeft de functies terug.
 * De expliciete `.js` is nodig zodat dezelfde module ook buiten de bundel
 * (in `node --test`) te laden is. */
async function loadFlow() {
  const [flowModule, clientModule] = await Promise.all([
    import('./claimEmailCodeFlow.js'),
    import('./supabaseBrowser.js'),
  ]);
  return {
    requestOwnerSignInCode: pick(flowModule, 'requestOwnerSignInCode'),
    verifyOwnerSignInCode: pick(flowModule, 'verifyOwnerSignInCode'),
    getSupabaseBrowser: pick(clientModule, 'getSupabaseBrowser'),
  };
}

/** Verstuurt de inlogcode; zie requestOwnerSignInCode in claimEmailCodeFlow.js. */
async function sendOwnerSignInCode(options) {
  const flow = await loadFlow();
  const supabase = flow.getSupabaseBrowser();
  return flow.requestOwnerSignInCode(supabase.auth, options);
}

/** Controleert de code van zes cijfers; zie verifyOwnerSignInCode in claimEmailCodeFlow.js. */
async function confirmOwnerSignInCode(options) {
  const flow = await loadFlow();
  const supabase = flow.getSupabaseBrowser();
  return flow.verifyOwnerSignInCode(supabase.auth, options);
}

module.exports = { confirmOwnerSignInCode, loadFlow, sendOwnerSignInCode };
