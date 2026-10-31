// BE-67 (#164) — de korte labels die een bezoeker ziet: "Op = op · uitverkocht"
// en de twee prijschips. Een eigen, piepklein bestand zonder afhankelijkheden,
// zodat de eerste lading van de publieke routes niet met het formulier of de
// meldingenlijst groeit (zie commit 6818fba en de laadgrens van 1 KB).

'use strict';

const DAGHAP_PUBLIEK = Object.freeze({
  uitverkocht: 'Op = op · uitverkocht',
  prijs2: '2 gangen',
  prijs3: '3 gangen',
});

module.exports = { DAGHAP_PUBLIEK };
