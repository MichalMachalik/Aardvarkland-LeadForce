(function (root) {
  'use strict';

  const required = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_id'];
  const keys = [...required, 'utm_content', 'utm_term'];
  const slug = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
  const tokenPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
  const templates = Object.freeze({
    google: ['google', 'cpc'], meta: ['meta', 'paid_social'], linkedin: ['linkedin', 'paid_social'],
    sklik: ['sklik', 'cpc'], vlastni: ['vlastni', 'referral'],
  });

  function rules(host, sources, media) {
    const parseList = (raw) => new Set(raw.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
    const hosts = parseList(host);
    const validHost = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
    if (!hosts.size || [...hosts].some((value) => value.length > 253 || !validHost.test(value))) {
      throw new Error('Zadejte doménu bez protokolu nebo cesty. Další domény oddělte čárkou.');
    }
    const permittedSources = parseList(sources);
    const permittedMedia = parseList(media);
    if (!permittedSources.size || !permittedMedia.size || [...permittedSources, ...permittedMedia].some((token) => !tokenPattern.test(token))) {
      throw new Error('Zadejte povolené zdroje a média oddělené čárkou, například google, meta nebo paid_social.');
    }
    return { hosts, sources: permittedSources, media: permittedMedia };
  }

  function inspect(raw, policy) {
    const value = raw.trim();
    const issues = [];
    const add = (code, description) => issues.push({ code, description });
    let url;
    try {
      if (value.length > 4096 || !/^https?:\/\//i.test(value) || /[\s\\\x00-\x1F]/u.test(value) || /%(?![a-f\d]{2})/i.test(value)) throw new Error();
      url = new URL(value);
    } catch {
      add('invalid-url', 'Zadejte úplnou webovou adresu s platnými parametry.');
      return { raw: value, fields: {}, issues, fingerprint: '' };
    }
    if (url.protocol !== 'https:') add('https', 'Adresa musí používat HTTPS.');
    if (!policy.hosts.has(url.hostname)) add('domain', `Doména ${url.hostname} není schválená.`);
    else if (url.port || url.username || url.password) add('domain', 'Adresa nesmí obsahovat nestandardní port ani přihlašovací údaje.');
    const fields = {};
    const tracking = new Map();
    for (const [field, val] of url.searchParams) {
      const key = field.toLowerCase();
      if (!keys.includes(key)) continue;
      if (!tracking.has(key)) tracking.set(key, []);
      tracking.get(key).push({ field, val });
    }
    for (const key of keys) {
      const found = tracking.get(key) || [];
      fields[key] = found[0]?.val || '';
      if (found.length > 1) add('duplicate-parameter', `${key} je v odkazu vícekrát.`);
      if (found.some((item) => item.field !== key)) add('parameter-case', `Název ${key} musí být malými písmeny.`);
      if (required.includes(key) && !fields[key]) add('missing', `Chybí hodnota ${key}.`);
    }
    if (fields.utm_source && !policy.sources.has(fields.utm_source)) add('source', 'Zdroj není mezi povolenými hodnotami nebo má jiné psaní.');
    if (fields.utm_medium && !policy.media.has(fields.utm_medium)) add('medium', 'Médium není mezi povolenými hodnotami nebo má jiné psaní.');
    if (fields.utm_id && !idPattern.test(fields.utm_id)) add('campaign-id', 'ID kampaně smí mít nejvýše 64 písmen, číslic, spojovníků a podtržítek.');
    for (const key of ['utm_campaign', 'utm_content', 'utm_term']) {
      if (fields[key] && !tokenPattern.test(fields[key])) add('slug', `${key} potřebuje malá písmena, číslice a případně spojovník nebo podtržítko (nejvýše 64 znaků).`);
    }
    url.searchParams.sort();
    url.hash = '';
    return { raw: value, fields, issues, fingerprint: url.href };
  }

  function scan(lines, policy) {
    const urls = lines.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!urls.length || urls.length > 500) throw new Error('Vložte 1 až 500 odkazů, každý na samostatný řádek.');
    const seen = new Map();
    const rows = urls.map((raw, index) => {
      const checked = inspect(raw, policy);
      const row = { ...checked, number: index + 1 };
      if (checked.fingerprint) {
        if (seen.has(checked.fingerprint)) row.issues.push({ code: 'duplicate-link', description: `Stejný odkaz už je na řádku ${seen.get(checked.fingerprint)}.` });
        else seen.set(checked.fingerprint, row.number);
      }
      return row;
    });
    const campaigns = new Map();
    for (const row of rows) {
      if (row.issues.length) continue;
      const { utm_source: source, utm_id: id } = row.fields;
      const key = JSON.stringify([source, id]);
      if (!campaigns.has(key)) campaigns.set(key, []);
      campaigns.get(key).push(row);
    }
    for (const group of campaigns.values()) {
      for (const [field, label] of [['utm_campaign', 'Název kampaně'], ['utm_medium', 'Médium']]) {
        const first = group[0];
        const different = group.find((row) => row.fields[field] !== first.fields[field]);
        if (!different) continue;
        for (const row of group) {
          const other = row.fields[field] === first.fields[field] ? different : first;
          row.issues.push({ code: 'campaign-conflict', description: `Stejný zdroj a ID. ${label} se liší od řádku ${other.number} (${other.fields[field]}).` });
        }
      }
    }
    return rows;
  }

  function compose(base, fields, policy) {
    if (!/^https:\/\//i.test(base.trim()) || /[\s\\]/u.test(base.trim())) throw new Error('Zadejte celou HTTPS adresu.');
    let url;
    try { url = new URL(base.trim()); }
    catch { throw new Error('Cílová adresa nemá platný formát.'); }
    for (const param of [...url.searchParams.keys()]) {
      if (keys.includes(param.toLowerCase())) url.searchParams.delete(param);
    }
    for (const key of keys) {
      const val = (fields[key] || '').trim();
      if (!val) continue;
      url.searchParams.set(key, ['utm_campaign', 'utm_content', 'utm_term'].includes(key) ? slug(val) : val);
    }
    const result = inspect(url.href, policy);
    if (result.issues.length) throw new Error(result.issues.map(({ description }) => description).join(' '));
    return result.raw;
  }

  function suggestCampaignId(row, batch) {
    const fields = row.fields;
    if (fields.utm_id || !fields.utm_source || !fields.utm_medium || !fields.utm_campaign) return '';
    const ids = new Set(batch.filter((candidate) => !candidate.issues.length
      && ['utm_source', 'utm_medium', 'utm_campaign'].every((key) => candidate.fields[key] === fields[key]))
      .map((candidate) => candidate.fields.utm_id));
    return ids.size === 1 ? [...ids][0] : '';
  }

  function testLead(checked, id, date) {
    if (checked.issues.length) throw new Error('Nejdřív opravte odkaz.');
    return { id, date, source: checked.fields.utm_source, campaign: checked.fields.utm_id, status: 'Nová' };
  }

  function exportCsv(header, records) {
    const escape = (value) => {
      const text = String(value ?? '');
      const safe = /^[\s\uFEFF]*[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    return '\uFEFF' + [header, ...records].map((row) => row.map(escape).join(';')).join('\r\n') + '\r\n';
  }

  const sample = typeof module === 'object' && module.exports ? require('./launch-fixtures.js') : root.LaunchFixtures;
  const repairedScenarios = new Set(sample?.transferLinks.map((link) => inspect(link, rules(sample.host, sample.sources, sample.media)).fingerprint));
  const isHandoff = (row) => !row.issues.length && repairedScenarios.has(row.fingerprint);

  const api = { keys, rules, inspect, scan, compose, suggestCampaignId, testLead, exportCsv, sample, templates, isHandoff };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LaunchCheck = api;
})(globalThis);
