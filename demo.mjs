import { reportDay } from './client-accounts.mjs';
import { prepareExampleBinding } from './google-ads-example.mjs';

export function createExample(open, token) {
  let seeding = true;
  const store = open({ claimClock: () => Date.now() - (seeding ? 21 * 24 * 60 * 60 * 1000 : 0) });
  try {
    return { store, profiles: populateExample(store, token) };
  } finally { seeding = false; }
}

function populateExample(store, token) {
  const setup = store.bootstrap({
    slug: 'javorova', workspace: 'Javorová projekty', name: 'Adéla Novotná',
    email: 'sprava@javorova.example', password: token(),
  });
  const admin = store.session(store.createSession(setup.user));
  const members = {};
  for (const [key, name, role] of [
    ['marketing', 'Nina Vacková', 'marketing'], ['agent', 'Tomáš Bláha', 'agent'],
    ['care', 'Klára Dvořáková', 'care'], ['investor', 'Eliška Hájková', 'investor'],
    ['otherInvestor', 'Radek Konečný', 'investor'],
  ]) {
    const invite = store.command(admin, 'invite', { email: key.toLowerCase() + '@javorova.example', role });
    members[key] = store.session(store.claimInvite({ token: invite.invite, name, password: token() }));
  }
  for (const [name, project, source, campaign] of [
    ['Eliška Hájková', 'Dům Pod Lípou', 'Google Ads', 'G-301'],
    ['Tereza Louková', 'Park Habr', 'Meta', 'M-118'],
    ['Anna Kopecká', 'Dům Pod Lípou', 'Google Ads', 'G-301'],
    ['Viktor Malý', 'Ateliéry U Nádraží', 'LinkedIn', 'L-041'],
    ['Lucie Švecová', 'Park Habr', 'Sklik', 'S-127'],
  ]) store.command(members.marketing, 'create-lead', {
    name, email: name === members.investor.name ? members.investor.email
      : name.split(' ')[0].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() + '@kontakty.example',
    project, source, campaign,
  });
  store.command(members.agent, 'assign', { id: 1, version: 1 });
  store.command(members.agent, 'change-stage', { id: 1, version: 2, stage: 'contacted' });
  store.command(members.agent, 'change-stage', { id: 1, version: 3, stage: 'qualified' });
  store.command(members.agent, 'add-note', { id: 1, body: 'Zájemce potvrdil zájem o další informace k projektu.' });
  store.command(members.care, 'assign', { id: 1, version: 4 });
  store.command(members.care, 'change-stage', { id: 1, version: 5, stage: 'handed' });
  store.command(members.care, 'link-investor', { id: 1, version: 6 });
  store.command(members.care, 'add-task', { id: 1, title: 'Připravit přehled dalšího postupu', due: '2026-12-18' });
  store.command(admin, 'assign', { id: 2, version: 1, owner: members.agent.id });
  store.command(members.agent, 'change-stage', { id: 2, version: 2, stage: 'contacted' });
  store.command(members.agent, 'assign', { id: 3, version: 1 });
  store.command(members.agent, 'change-stage', { id: 3, version: 2, stage: 'contacted' });
  store.command(members.agent, 'change-stage', { id: 3, version: 3, stage: 'qualified' });
  const investors = [
    [members.investor.id, 'Dům Pod Lípou', '200000', '2028-04-30'],
    [members.investor.id, 'Park Habr', '125000', '2027-09-30'],
    [members.otherInvestor.id, 'Ateliéry U Nádraží', '350000', '2029-06-30'],
  ];
  for (const [investor, project, principal, maturity] of investors) {
    store.command(members.care, 'add-position', { investor, project, principal, maturity });
  }
  const message = store.command(members.care, 'draft-message', {
    investor: members.investor.id, title: 'Podzimní přehled projektu', body: 'Příprava první etapy je hotová. Další aktualizace bude po dokončení projektové dokumentace.',
  });
  store.command(members.care, 'publish-message', { id: message.id });
  store.command(members.care, 'draft-message', {
    investor: members.investor.id, title: 'Harmonogram příští etapy', body: 'Zpráva je připravená ke kontrole před zveřejněním.',
  });
  const profiles = Object.fromEntries([admin, members.marketing, members.agent, members.care, members.investor]
    .map(({ id, role, name }) => [role, { id, role, name }]));
  profiles.client = populateClientExample(store, token, admin.id, members.care.id);
  prepareExampleBinding(store, profiles);
  prepareExampleFeedback(store, profiles.client.id, members.care);
  return profiles;
}

function prepareExampleFeedback(store, clientId, care) {
  const session = store.createSession(clientId);
  try {
    const client = store.session(session);
    const delivered = store.clientReport(client, new URLSearchParams()).deliveries;
    const received = delivered.find((lead) => lead.email === 'roman@leadforce.example');
    const duplicate = delivered.find((lead) => lead.email === 'hana@leadforce.example');
    if (received) store.command(client, 'confirm-handoff', { id: received.id });
    if (duplicate) {
      const { id } = store.command(client, 'file-handoff-claim', {
        id: duplicate.id, reason: 'duplicate', description: 'Stejný kontakt už máme v evidenci k Rezidenci U Háje.',
        request_key: '7277fc78-0d24-4ac8-8ddd-efcacb54eba7',
      });
      store.command(care, 'review-handoff-claim', { id, version: 1 });
      store.command(care, 'request-claim-evidence', {
        id, version: 2, request_key: 'a4089c00-6440-44aa-a022-1189d356fd57',
        message: 'Doplňte prosím datum a referenci původního záznamu, ať oba kontakty porovnáme.',
      });
    }
  } finally {
    store.signOut(session);
  }
}
export function populateClientExample(store, token, adminId, careId) {
  const session = store.createSession(adminId);
  try {
    const admin = store.session(session);
    if (!admin) return null;
    const client = store.command(admin, 'create-client', { name: 'Lípové bydlení' }).id;
    const other = store.command(admin, 'create-client', { name: 'Modřínová výstavba' }).id;
    const campaigns = [
      [client, 'Byty pod Lípou', 'Dům Pod Lípou', 'Google Ads', 'LPF-601', '1890'],
      [client, 'Rezidence U Háje', 'Rezidence U Háje', 'Meta', 'LPF-602', '940'],
      [client, 'Brandová kampaň', 'Dům Pod Lípou', 'Sklik', 'LPF-603', '0'],
      [other, 'Ateliéry u Řeky', 'Ateliéry u Řeky', 'Google Ads', 'LPF-699', '4400'],
    ].map(([client, name, project, source, code, cost]) => {
      const campaign = store.command(admin, 'create-campaign', { client, name, project, source, code }).id;
      store.command(admin, 'save-campaign-cost', { campaign, day: reportDay(), cost });
      return campaign;
    });
    const careSession = store.createSession(careId);
    const care = store.session(careSession);
    try {
      for (const [index, fullName, box, handed] of [
        [0, 'Zuzana Šedá', 'zuzana', true], [0, 'Roman Kadlec', 'roman', true],
        [1, 'Hana Vítová', 'hana', true], [1, 'Petr Skála', 'petr', false],
        [3, 'David Koutný', 'david', true],
      ]) {
        const { id } = store.command(admin, 'create-lead', { name: fullName, email: box + '@leadforce.example', client_campaign: campaigns[index] });
        if (!handed || !care) continue;
        store.command(admin, 'change-stage', { id, version: 1, stage: 'contacted' });
        store.command(admin, 'change-stage', { id, version: 2, stage: 'qualified' });
        store.command(admin, 'assign', { id, version: 3, owner: care.id });
        store.command(care, 'change-stage', { id, version: 4, stage: 'handed' });
      }
    } finally {
      store.signOut(careSession);
    }
    const { invite } = store.command(admin, 'invite', { email: 'prehlad@lipove-bydleni.example', role: 'client', client });
    const raw = store.claimInvite({ token: invite, name: 'Marek Plachý', password: token() });
    const { id, role, name } = store.session(raw);
    store.signOut(raw);
    return { id, role, name };
  } finally {
    store.signOut(session);
  }
}
