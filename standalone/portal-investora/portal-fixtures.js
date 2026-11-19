(function (root) {
  'use strict';

  const positions = [
    { id: 'MD-101', name: 'Projekt Modrý Dvůr', category: 'Rezidenční výstavba', principal: 250000, status: 'active', maturity: '2028-06-30',
      schedule: [{ date: '2026-12-18', amount: 6250 }, { date: '2027-03-19', amount: 6250 }],
      note: 'Rezidenční výstavba bytových domů v projektu Modrý Dvůr.' },
    { id: 'BT-204', name: 'Byty U Trati', category: 'Obnova budov', principal: 150000, status: 'active', maturity: '2027-09-30',
      schedule: [{ date: '2027-01-22', amount: 3750 }, { date: '2027-04-23', amount: 3750 }],
      note: 'Obnova bytového domu a jeho společných prostor.' },
    { id: 'MS-087', name: 'Mlýn u Sadu', category: 'Obnova budov', principal: 100000, status: 'closed', maturity: '2026-10-30', schedule: [],
      note: 'Pozice splacena 30. 10. 2026.' },
  ];

  const opportunities = [
    { id: 'stran', name: 'Rezidence Na Stráni', category: 'Rezidenční výstavba', horizon: '24 měsíců', phase: 'Příprava první etapy',
      note: 'Dvě etapy bytové výstavby se společným vnitroblokem. Připravuje se staveniště a napojení na sítě.' },
    { id: 'javor', name: 'Areál Javorová', category: 'Obnova budov', horizon: '18 měsíců', phase: 'Příprava rekonstrukce',
      note: 'Obnova dvou komerčních budov. Harmonogram počítá s postupným zprovozněním objektů po jednotlivých etapách.' },
    { id: 'park', name: 'Park U Dubu', category: 'Komerční prostory', horizon: '30 měsíců', phase: 'Projektová příprava',
      note: 'Menší komerční prostory s nájemními jednotkami. Projekt je ve fázi přípravy.' },
  ];

  const baseMessages = [
    { id: 'portfolio-list', date: '2026-11-18', type: 'Reporting', title: 'Listopadový přehled portfolia', text: 'Portfolio má dvě aktivní pozice. Nejbližší plánovaná platba připadá na projekt Modrý Dvůr.' },
    { id: 'mill-close', positionId: 'MS-087', date: '2026-10-30', type: 'Milník', title: 'Mlýn u Sadu byl splacen', text: 'Splacená pozice je dostupná v historii portfolia.' },
    { id: 'courtyard', positionId: 'MD-101', date: '2026-11-09', type: 'Aktualizace', title: 'Modrý Dvůr dokončil přípravu staveniště', text: 'Příprava hotová. Následují práce na první etapě.' },
  ];

  const journeyMessages = [
    { id: 'case-email', step: 2, date: '2026-11-04', type: 'Péče', title: 'Náhled e-mailu k Rezidenci Na Stráni', text: 'Děkujeme za zájem o prohlídku. Máte-li otázky k první etapě, připravíme pro vás podklady k projektu.' },
    { id: 'case-check-in', step: 3, date: '2026-12-03', type: 'Plán péče', title: 'Naplánované kontrolní oslovení', text: 'Při dalším kontaktu ověřit zájem o prohlídku.' },
    { id: 'case-reengaged', step: 4, date: '2026-12-03', type: 'Reaktivace', title: 'Zájem o Rezidenci Na Stráni obnoven', text: 'Obnovený zájem je zaznamenán u poptávky QA-SCENAR-01 v Auditu.' },
  ];

  const caseSummaries = ['QA-SCENAR-01 · následná péče k Rezidenci Na Stráni.', 'QA-SCENAR-01 · obnovený zájem o Rezidenci Na Stráni.'];
  const api = { positions, opportunities, baseMessages, journeyMessages, caseSummaries, read: ['mill-close'] };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InvestorFixtures = api;
})(globalThis);
