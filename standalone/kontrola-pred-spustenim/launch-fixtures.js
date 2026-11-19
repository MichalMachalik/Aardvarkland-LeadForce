(function (root) {
  'use strict';
  const sample = {
    host: 'rezidence-nastrani.example',
    sources: 'google, meta, linkedin, sklik, vlastni',
    media: 'cpc, paid_social, display, referral',
    title: 'Rezidence Na Stráni',
    campaignId: 'G-202',
    date: '2026-11-03',
    links: [
      'https://rezidence-nastrani.example/prohlidka?utm_source=google&utm_medium=cpc&utm_campaign=rezidence-na-strani&utm_id=G-202',
      'https://rezidence-nastrani.example/prohlidka?utm_source=meta&utm_medium=paid_social&utm_campaign=rezidence-na-strani',
      'https://rezidence-nastrani.example/byty?utm_source=sklik&utm_medium=cpc&utm_campaign=rezidence-na-strani&utm_id=S-303&utm_id=S-404',
      'http://stara-rezidence.example/byt?utm_source=meta&utm_medium=paid_social&utm_campaign=rezidence-na-strani&utm_id=M-101',
      'https://rezidence-nastrani.example/prohlidka?utm_source=google&utm_medium=cpc&utm_campaign=rezidence-na-strani&utm_content=prohlidka-b',
    ],
  };
  const last = sample.links.at(-1);
  sample.transferLinks = [last, last.replace('prohlidka-b', 'zkusebni-prohlidka')].map((link) => `${link}&utm_id=${sample.campaignId}`);
  if (typeof module === 'object' && module.exports) module.exports = sample;
  else root.LaunchFixtures = sample;
})(globalThis);
