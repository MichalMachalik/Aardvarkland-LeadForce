(function (root) {
  'use strict';
  function sampleCsv() {
    const spend = ['date;source;campaign_id;campaign_name;spend_czk;currency'];
    const leads = ['lead_id;created_date;source;campaign_id;status;handed_off_date'];
    const campaigns = [
      ['Meta', 'M-101', 'Rezidence Na Stráni · akvizice', [3000, 3500, 2500], 36, 6],
      ['Google Ads', 'G-202', 'Rezidence Na Stráni · vyhledávání', [3200, 3600, 2800], 24, 12],
      ['Sklik', 'S-303', 'Rezidence Na Stráni · remarketing', [1800, 2300, 1900], 12, 5],
    ];
    campaigns.forEach(([source, id, name, daily, count, qualified]) => {
      daily.forEach((value, index) => spend.push(`2026-11-0${index + 1};${source};${id};${name};${value};CZK`));
      for (let n = 1; n <= count; n++) {
        const status = n <= qualified ? 'Kvalifikovaná' : n % 3 ? 'Kontaktována' : 'Nová';
        const handoff = n <= Math.floor(qualified / 3) ? '2026-11-05' : '';
        leads.push(`${id}-${String(n).padStart(2, '0')};2026-11-0${(n % 3) + 1};${source};${id};${status};${handoff}`);
      }
    });
    leads.push(leads[1], 'QA-401;2026-11-01;;;Nová;', 'QA-402;2026-11-03;Google Ads;NEZNAMA;;');
    return { spend: spend.join('\r\n'), leads: leads.join('\r\n') };
  }

  const journeyNotes = ['Poptávka přijata po ověření CRM.', 'Předání zaznamenáno.', 'Náhled e-mailu je dostupný v portálu.',
    'Další kontakt naplánován na 3. 12. 2026.', 'Obnovený zájem zaznamenán.'];
  const opportunities = [
    { id: 'stran', name: 'Rezidence Na Stráni', type: 'Rezidenční výstavba', note: 'Dvě etapy bytové výstavby se společným vnitroblokem.' },
    { id: 'javor', name: 'Areál Javorová', type: 'Obnova komerčního areálu', note: 'Obnova dvou komerčních budov po jednotlivých etapách.' },
  ];
  const investorUpdates = [[0, '3. 11. 2026', 'Přehled portfolia je dostupný.'],
    [2, '4. 11. 2026', 'Náhled e-mailu · další informace o Rezidenci Na Stráni.'], [3, '3. 12. 2026', 'Plánované kontrolní oslovení.'],
    [4, '3. 12. 2026', 'Zájem o Rezidenci Na Stráni obnoven.']];
  const api = { sampleCsv, journeyNotes, opportunities, investorUpdates, handedOffDate: '2026-11-04' };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AuditFixtures = api;
})(globalThis);
