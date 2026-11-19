import { browserDemo, request } from './transport.js';

const $ = (id) => document.getElementById(id);
const screen = $('screen');
const roleNames = { admin: 'Správce', marketing: 'Marketing', agent: 'Kvalifikace', care: 'Péče', investor: 'Investor', client: 'Klient' };
const stageNames = { new: 'Nová', contacted: 'Kontaktována', qualified: 'Kvalifikovaná', handed: 'Předaná', closed: 'Uzavřená' };
const claimReasons = {
  unreachable: 'Kontakt se nedaří zastihnout', invalid_contact: 'Neplatné kontaktní údaje',
  duplicate: 'Duplicitní poptávka', out_of_scope: 'Poptávka neodpovídá zadání', other: 'Jiný důvod',
};
const claimStates = { open: 'Nová reklamace', review: 'V řešení', accepted: 'Uznaná', rejected: 'Zamítnutá' };
const events = {
  workspace_created: 'Založení organizace', lead_created: 'Založení poptávky', lead_assigned: 'Přiřazení poptávky',
  stage_changed: 'Změna stavu', note_added: 'Interní poznámka', task_added: 'Založení úkolu',
  task_done: 'Dokončení úkolu', invite_created: 'Vytvoření pozvánky', invite_accepted: 'Aktivace účtu', investor_linked: 'Propojení s účtem investora',
  user_activated: 'Opětovná aktivace účtu', user_disabled: 'Deaktivace účtu',
  position_created: 'Založení pozice', position_closed: 'Uzavření pozice',
  message_drafted: 'Koncept zprávy', message_published: 'Zveřejnění zprávy', password_changed: 'Změna hesla',
  client_created: 'Založení klienta', campaign_created: 'Založení kampaně', campaign_cost_saved: 'Změna nákladu kampaně',
  campaign_attached: 'Přiřazení klientské kampaně',
  google_ads_configured: 'Napojení kampaně Google Ads', google_ads_sync: 'Synchronizace Google Ads',
  handoff_confirmed: 'Potvrzení převzetí klientem', handoff_claim_filed: 'Podaná reklamace',
  handoff_claim_review: 'Převzetí reklamace', handoff_claim_accepted: 'Uznaná reklamace', handoff_claim_rejected: 'Zamítnutá reklamace',
  handoff_claim_evidence_requested: 'Vyžádání podkladů', handoff_claim_evidence_supplied: 'Doplnění podkladů klientem',
  handoff_calendar_saved: 'Změna pracovního kalendáře reklamací',
};
const available = {
  admin: ['prehled', 'poptavky', 'predani', 'reakce', 'eskalace', 'lhuty', 'kampane', 'ukoly', 'upozorneni', 'investori', 'komunikace', 'uzivatele', 'historie', 'ucet'],
  marketing: ['prehled', 'poptavky', 'kampane', 'ucet'],
  agent: ['prehled', 'poptavky', 'ukoly', 'upozorneni', 'ucet'],
  care: ['prehled', 'poptavky', 'predani', 'reakce', 'eskalace', 'ukoly', 'upozorneni', 'investori', 'komunikace', 'ucet'],
  investor: ['prehled', 'portfolio', 'schranka', 'ucet'],
  client: ['prehled', 'reakce', 'ucet'],
};
const titles = {
  prehled: ['Přehled', 'grid'], poptavky: ['Poptávky', 'list'], ukoly: ['Úkoly', 'check'],
  predani: ['Předání klientům', 'check'],
  reakce: ['Čeká na reakci', 'mail'],
  eskalace: ['Eskalace reklamací', 'clock'],
  lhuty: ['Lhůty reklamací', 'clock'],
  kampane: ['Klienti a kampaně', 'bag'],
  upozorneni: ['Upozornění', 'mail'], investori: ['Investoři', 'bag'], komunikace: ['Zprávy pro investory', 'mail'],
  uzivatele: ['Uživatelé', 'user'], historie: ['Historie změn', 'clock'],
  portfolio: ['Portfolio', 'bag'], schranka: ['Zprávy', 'mail'], ucet: ['Můj účet', 'user'],
};
const kcz = new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const dateOnly = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'UTC' });
const dateTime = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'short', timeStyle: 'short' });
const pragueDateTime = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', dateStyle: 'short', timeStyle: 'short' });
const formatDate = (value) => value ? (value.length === 10 ? dateOnly.format(new Date(value + 'T00:00:00Z')) : dateTime.format(new Date(value))) : '—';
const localDate = () => new Intl.DateTimeFormat('sv-SE').format(new Date());
const reportDate = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(new Date());
const czk = (cents, emptyValue = '—') => cents === null ? emptyValue : kcz.format(cents / 100);
let config;
let state;
let renderNumber = 0;
let busy = false;
let clientQuery = '';
let handoffParams = new URLSearchParams();
let attentionPages = { reakce: 1, eskalace: 1 };
let checkingAttention = false;
let adsFormValues = {};

function node(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs || {})) {
    if (val === false || val === null || val === undefined) continue;
    if (key === 'className') el.className = val;
    else el.setAttribute(key, val === true ? '' : val);
  }
  el.append(...children.flat(Infinity).filter((item) => item !== null && item !== undefined));
  return el;
}
const icon = (kind) => node('span', { className: 'line-icon ' + kind, 'aria-hidden': 'true' });
const card = (title, children, more = '') => node('section', { className: 'card ' + more }, node('h2', {}, title), children);
const empty = (value) => node('p', { className: 'empty' }, value);
const pill = (value, emphasis = '') => node('span', { className: 'pill ' + emphasis }, value);
const link = (label, href, options = {}) => node('a', { href, ...options }, label);
const actionButton = (label, action, style = 'secondary') => {
  const button = node('button', { type: 'button', className: 'button ' + style }, label);
  button.addEventListener('click', () => { void action(); });
  return button;
};
const actions = (...children) => node('div', { className: 'actions' }, children);
const heading = (title, ...children) => node('header', { className: 'page-head' }, node('h1', { tabindex: '-1' }, title), children);
const metrics = (items, variant = '') => node('div', { className: 'metrics ' + variant }, items.map(([key, value]) =>
  node('dl', { className: 'card metric' }, node('dt', {}, key), node('dd', {}, String(value)))));

function table(columns, rows, placeholder) {
  if (!rows.length) return empty(placeholder);
  return node('div', { className: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': columns.join(', ') },
    node('table', {}, node('thead', {}, node('tr', {}, columns.map((title) => node('th', { scope: 'col' }, title)))),
      node('tbody', {}, rows.map((row) => node('tr', {}, row.map((value) => node('td', {}, value || '—')))))));
}

function pagination(page, pages, selectPage) {
  if (pages < 2) return null;
  return actions(
    node('span', { className: 'muted' }, 'Strana ' + page + ' z ' + pages),
    page > 1 ? actionButton('Předchozí', () => selectPage(page - 1)) : null,
    page < pages ? actionButton('Další', () => selectPage(page + 1)) : null,
  );
}

function field(label, name, type = 'text', opts = {}) {
  const base = { name, 'aria-label': label, required: true, ...opts };
  const input = type === 'textarea' ? node('textarea', { ...base, rows: 4 })
    : Array.isArray(type) ? node('select', base, node('option', { value: '' }, 'Vyberte…'),
      type.map(([value, title]) => node('option', { value }, title)))
      : node('input', { ...base, type });
  return node('label', {}, node('span', {}, label), input);
}

function form(label, fields, submit) {
  const element = node('form', {}, node('div', { className: 'fields' }, fields),
    node('button', { type: 'submit', className: 'button primary' }, label));
  element.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;
    const submitter = event.submitter;
    if (submitter) submitter.disabled = true;
    void Promise.resolve(submit(Object.fromEntries(new FormData(element))))
      .finally(() => { if (submitter) submitter.disabled = false; });
  });
  return element;
}

function conditionalFields(trigger, fields, condition) {
  const group = node('fieldset', { className: 'field-group' }, fields);
  const update = () => {
    group.hidden = !condition(trigger.value);
    group.disabled = group.hidden;
  };
  trigger.addEventListener('change', update);
  update();
  return group;
}

function notice(message, error = false) {
  const banner = $('notice');
  banner.textContent = message;
  banner.hidden = !message;
  banner.classList.toggle('error', error);
  if (error) banner.scrollIntoView({ block: 'nearest' });
}

async function api(path, body) {
  const init = body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-CSRF': state?.csrf ?? '' },
    body: JSON.stringify(body),
  };
  const response = await request(path, init);
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function run(work) {
  if (busy) return;
  busy = true;
  screen.inert = true;
  screen.setAttribute('aria-busy', 'true');
  notice('');
  try { await work(); }
  catch (e) {
    if (e.status === 401 && state) {
      state = undefined;
      await render();
    }
    notice(e.message, true);
  } finally {
    busy = false;
    screen.inert = false;
    screen.removeAttribute('aria-busy');
  }
}

const refresh = async () => { state = await api('/api/state'); await render(); };
const command = (name, data, message = 'Změna uložena.') => run(async () => {
  const result = await api('/api/actions/' + name, data);
  await refresh();
  if (result.invite) {
    const invite = new URL('./#pozvanka/' + result.invite, location.href).href;
    const box = node('input', { readonly: true, value: invite, 'aria-label': 'Odkaz pozvánky' });
    const copy = actionButton('Zkopírovat', async () => {
      try { await navigator.clipboard.writeText(invite); copy.textContent = 'Zkopírováno'; }
      catch { box.select(); }
    });
    screen.prepend(card('Odkaz pozvánky', [node('p', { className: 'muted' }, 'Platí 24 hodin. Odkaz předejte pozvanému uživateli.'), actions(box, copy)], 'invite-result'));
    requestAnimationFrame(() => {
      box.focus();
      box.select();
    });
  } else notice(message);
});

function loginScreen(invitation) {
  const submit = (data) => run(async () => {
    await api(invitation ? '/api/invite/accept' : '/api/login', invitation ? { ...data, token: invitation } : data);
    history.replaceState(null, '', '#prehled');
    await refresh();
  });
  const fields = invitation
    ? [field('Jméno', 'name', 'text', { autocomplete: 'name', maxlength: 100 }), field('Nové heslo', 'password', 'password', { minlength: 12, maxlength: 128, autocomplete: 'new-password' })]
    : [field('Organizace', 'slug', 'text', { autocomplete: 'organization', maxlength: 48 }),
      field('E-mail', 'email', 'email', { autocomplete: 'username' }), field('Heslo', 'password', 'password', { autocomplete: 'current-password', maxlength: 128 })];
  const brand = node('div', { className: 'brand login-brand' },
    node('img', { className: 'mark', src: './assets/aardvarkland.png', width: 34, height: 34, alt: '' }), 'Aardvarkland LeadForce');
  const login = node('div', { className: 'login' }, brand, heading(invitation ? 'Přijmout pozvánku' : 'Přihlášení do pracovního prostoru'));
  if (!invitation && config.choices.length) {
    login.append(card('Vyberte roli', node('div', { className: 'profile-list' }, config.choices.map(({ role, name }) =>
      actionButton(roleNames[role] + ' · ' + name, () => run(async () => {
        await api('/api/example/session', { role });
        history.replaceState(null, '', '#prehled');
        await refresh();
      }))))));
  }
  login.append(node('section', { className: 'card' }, form(invitation ? 'Založit účet' : 'Přihlásit se', fields, submit)));
  if (browserDemo && !invitation) login.append(card('Samostatné nástroje', actions(
    link('Audit kampaní', './audit-kampani/', { className: 'button secondary' }),
    link('Kontrola odkazů', './kontrola-pred-spustenim/', { className: 'button secondary' }),
    link('Portál investora', './portal-investora/', { className: 'button secondary' }),
  )));
  if (browserDemo && !invitation) login.append(actionButton('Obnovit výchozí data', () => {
    if (!window.confirm('Zahodit změny této ukázky v prohlížeči?')) return;
    return run(async () => {
      await api('/api/example/reset', {});
      state = undefined;
      history.replaceState(null, '', location.pathname);
      await render();
      notice('Ukázka byla obnovena.');
    });
  }, 'plain'));
  return login;
}

function csvLink(label, path, filename) {
  const exportLink = link(label, '.' + path, { className: 'button secondary' });
  if (browserDemo) exportLink.addEventListener('click', (event) => {
    event.preventDefault();
    void run(async () => {
      const response = await request(path);
      if (!response.ok) throw new Error((await response.json()).error);
      const blob = URL.createObjectURL(await response.blob());
      const download = node('a', { href: blob, download: filename });
      document.body.append(download);
      download.click();
      download.remove();
      setTimeout(() => URL.revokeObjectURL(blob), 1000);
    });
  });
  return exportLink;
}

function overview() {
  if (state.user.role === 'investor') {
    const active = state.positions.filter((item) => item.status === 'active');
    const total = active.reduce((sum, item) => sum + item.principal_cents, 0) / 100;
    const latest = state.messages[0];
    const next = active.find((item) => item.maturity >= localDate());
    return [heading('Přehled investora'),
      metrics([['Kapitál v aktivních pozicích', kcz.format(total)], ['Aktivní pozice', active.length],
        ['Nepřečtené zprávy', state.messages.filter((item) => !item.read_at).length]], 'investor-metrics'),
      actions(link('Zobrazit portfolio', '#portfolio', { className: 'button primary' }), link('Otevřít zprávy', '#schranka', { className: 'button secondary' })),
      next ? card('Nejbližší splatnost', [link(next.project, '#portfolio'), node('p', { className: 'muted' }, formatDate(next.maturity))], 'investor-section') : null,
      latest ? card('Poslední zpráva', [actionButton(latest.title, () => showMessage(latest, true), 'plain'),
        node('p', { className: 'muted' }, formatDate(latest.published_at))], 'investor-section') : null,
    ].filter(Boolean);
  }
  const counts = new Map(state.stages.map(({ stage, total }) => [stage, total]));
  const metricCards = metrics(Object.entries(stageNames).map(([stage, name]) => [name, counts.get(stage) ?? 0]));
  const output = [heading('Přehled týmu'), metricCards];
  const unread = state.notifications?.filter((item) => !item.read_at).length;
  if (unread) output.push(actions(link('Nepřečtená upozornění (' + unread + ')', '#upozorneni', { className: 'button secondary' })));
  if (state.handoffSummary?.active) output.push(actions(link('Otevřené reklamace (' + state.handoffSummary.active + ')', '#predani',
    { className: 'button secondary' })));
  if (typeof state.handoffAttention === 'number') output.push(actions(attentionLink('eskalace'), attentionLink('reakce')));
  if (state.tasks) {
    const upcoming = state.tasks.filter((task) => !task.done_at).slice(0, 5);
    output.push(card('Otevřené úkoly', table(['Úkol', 'Termín', 'Odpovídá'], upcoming
      .map((item) => [item.title, formatDate(item.due), item.owner]), 'Zatím žádné otevřené úkoly.')));
    const queue = state.leads.filter((row) => row.stage !== 'closed' &&
      (!row.owner_id || (row.stage === 'qualified' && row.owner_role === 'agent' && state.user.role !== 'agent')))
      .slice(-5).reverse();
    output.push(card('K převzetí', table(['Poptávka', 'Projekt', 'Stav'], queue.map((row) =>
      [link(row.name, '#poptavka/' + row.id), row.project, pill(stageNames[row.stage])]), 'Fronta k převzetí je prázdná.')));
  }
  if (['admin', 'marketing'].includes(state.user.role)) {
    output.push(card('Kampaně', actions(
      link('Kontrola odkazů', './tools/kontrola-pred-spustenim/index.html', { className: 'button secondary', target: '_blank', rel: 'noopener' }),
      link('Audit kampaní', './tools/audit-kampani/index.html', { className: 'button secondary', target: '_blank', rel: 'noopener' }),
      csvLink('Export poptávek CSV', '/api/export/leads.csv', 'poptavky.csv'),
    )));
  }
  return output;
}

function leadList() {
  const marketing = state.user.role === 'marketing';
  const query = node('input', { type: 'search', placeholder: 'Hledat projekt, ID nebo jméno…', 'aria-label': 'Hledat poptávku' });
  const filter = node('select', { 'aria-label': 'Stav poptávky' }, node('option', { value: '' }, 'Všechny stavy'),
    Object.entries(stageNames).map(([value, name]) => node('option', { value }, name)));
  const list = node('div');
  const draw = () => {
    const search = query.value.trim().toLowerCase();
    const rows = state.leads.filter((row) => (!filter.value || row.stage === filter.value)
      && [row.project, row.campaign, row.source, row.name ?? '', 'CRM-' + row.id].join(' ').toLowerCase().includes(search));
    list.replaceChildren(table(marketing ? ['ID', 'Projekt', 'Kanál', 'Stav'] : ['Poptávka', 'Projekt', 'Kanál', 'Stav', 'Odpovídá'],
      rows.map((row) => {
        const attrs = [row.project, row.source + ' · ' + row.campaign, pill(stageNames[row.stage], row.stage === 'handed' ? 'positive' : '')];
        return marketing ? ['CRM-' + row.id, ...attrs] : [link(row.name, '#poptavka/' + row.id), ...attrs, row.owner ?? 'Ve frontě'];
      }), 'Tomuto výběru neodpovídá žádná poptávka.'));
  };
  query.addEventListener('input', draw);
  filter.addEventListener('change', draw);
  draw();
  const output = [heading('Poptávky'), node('section', { className: 'card queue' }, actions(query, filter), list)];
  if (state.clientManagement) {
    const options = campaignOptions(state.clientManagement.campaigns);
    const choice = field('Klientská kampaň', 'client_campaign', options, { required: false });
    choice.querySelector('option').textContent = 'Zadat vlastní zdroj';
    const manual = [field('Projekt', 'project'), field('Kanál', 'source'),
      field('ID kampaně', 'campaign', 'text', { maxlength: 64, placeholder: 'G-301' })];
    const campaignFields = options.length ? [choice, conditionalFields(choice.querySelector('select'), manual, (value) => !value)] : manual;
    output.push(card('Nová poptávka', form('Přidat poptávku', [
      field('Jméno', 'name'), field('E-mail', 'email', 'email'), campaignFields,
    ], (data) => command('create-lead', data))));
  }
  return output;
}

function timeline(items) {
  if (!items.length) return empty('Zatím žádné změny.');
  return node('ol', { className: 'timeline' }, items.map((item) => node('li', {},
    node('div', {}, node('strong', {}, events[item.action] || item.action), item.detail ? node('p', {}, item.detail) : null),
    node('span', { className: 'muted' }, item.actor + ' · ' + formatDate(item.created_at)))));
}

async function leadView(id) {
  const { lead, notes, activity, recipients, campaign } = await api('/api/leads/' + id);
  const { role } = state.user;
  const owner = role === 'admin' || lead.owner_id === state.user.id;
  const move = { new: [['contacted', 'Označit jako kontaktovanou'], ['closed', 'Uzavřít']], contacted: [['qualified', 'Kvalifikovat'], ['closed', 'Uzavřít']],
    qualified: [['handed', 'Předat klientovi'], ['closed', 'Uzavřít']], handed: [['closed', 'Uzavřít']] };
  const editable = role === 'admin' || (role === 'agent' && ['new', 'contacted'].includes(lead.stage)) || (role === 'care' && ['qualified', 'handed'].includes(lead.stage));
  const assignment = ['qualified', 'handed'].includes(lead.stage) ? 'care' : 'agent';
  const base = { id: lead.id, version: lead.version };
  const controls = [];
  if (role === 'admin' && lead.stage !== 'closed') controls.push(form('Přiřadit', [
    field('Odpovídá', 'owner', state.users.filter((u) => u.enabled && u.role === assignment).map((u) => [u.id, u.name])),
  ], (data) => command('assign', { ...base, ...data })));
  if (role === 'admin' && !lead.handed_at && lead.stage !== 'closed' && state.clientManagement.campaigns.length) {
    const option = field('Klientská kampaň', 'campaign', campaignOptions(state.clientManagement.campaigns));
    option.querySelector('select').value = campaign?.id ?? '';
    controls.push(form('Přiřadit kampaň', [option], (data) => command('attach-campaign', { ...base, ...data })));
  }
  if (role === assignment && lead.stage !== 'closed' && (!lead.owner_id || (role === 'care' && lead.owner_role === 'agent'))) {
    controls.push(actionButton('Převzít poptávku', () => command('assign', base), 'primary'));
  }
  if (owner && editable && move[lead.stage]) controls.push(actions(move[lead.stage].map(([stage, title]) =>
    actionButton(title, () => command('change-stage', { ...base, stage }), stage === 'closed' ? 'secondary' : 'primary'))));
  if (owner && ['admin', 'care'].includes(role) && lead.stage === 'handed' && !lead.investor_id) {
    controls.push(actionButton('Připojit účet investora', () => command('link-investor', base)));
  }
  const summary = node('dl', { className: 'detail-grid' }, [
    ['E-mail', lead.email], ['Zdroj', lead.source + ' · ' + lead.campaign], ['Projekt', lead.project],
    ['Stav', stageNames[lead.stage]], ['Odpovídá', lead.owner ?? 'Ve frontě'], ['Předání', formatDate(lead.handed_at)],
    ...(campaign ? [['Klient', campaign.client], ['Kampaň', campaign.name]] : []),
    ...(lead.investor_id ? [['Účet investora', 'Propojený']] : []),
  ].map(([key, value]) => node('div', {}, node('dt', {}, key), node('dd', {}, value))));
  const notesList = notes.length ? node('ul', { className: 'notes' }, notes.map((item) => node('li', {}, node('strong', {}, item.author),
    node('time', {}, formatDate(item.created_at)), node('p', { className: 'prose' }, item.body)))) : empty('Zatím žádné interní poznámky.');
  const handoffLink = campaign && lead.handed_at && ['admin', 'care'].includes(role)
    ? link('Klientské předání', '#predani/' + lead.id, { className: 'button secondary' }) : null;
  const result = [heading(lead.name, actions(link('Všechny poptávky', '#poptavky', { className: 'button secondary' }), handoffLink)),
    node('section', { className: 'card detail' }, summary, controls)];
  const notePanel = [notesList];
  if (owner) notePanel.push(form('Přidat poznámku', [
    field('Interní poznámka', 'body', 'textarea', { maxlength: 4000 }),
    ...(recipients.length ? [field('Upozornit kolegu', 'recipient', recipients.map((person) => [person.id, person.name]), { required: false })] : []),
  ],
    (data) => command('add-note', { id: lead.id, ...data })));
  result.push(card('Interní komunikace', notePanel));
  if (owner && lead.stage !== 'closed') result.push(card('Další krok', form('Přidat úkol',
    [field('Úkol', 'title'), field('Termín', 'due', 'date')], (data) => command('add-task', { id: lead.id, ...data }))));
  result.push(card('Historie poptávky', timeline(activity)));
  return result;
}

function tasks() {
  const rows = state.tasks.map((item) => [item.title, item.lead, item.owner,
    pill(formatDate(item.due), !item.done_at && item.due < localDate() ? 'attention' : ''),
    item.done_at ? 'Hotovo' : actionButton('Dokončit', () => command('complete-task', { id: item.id }))]);
  return [heading('Úkoly'), node('section', { className: 'card' }, table(['Úkol', 'Poptávka', 'Odpovídá', 'Termín', 'Stav'], rows, 'Zatím žádné úkoly.'))];
}

function notificationList() {
  const rows = state.notifications.map((item) => [
    item.kind === 'note' ? 'Interní poznámka' : 'Přiřazená poptávka',
    link(item.project, '#poptavka/' + item.lead_id), item.actor, formatDate(item.created_at),
    item.read_at ? 'Přečtené' : actionButton('Označit jako přečtené', () => command('read-notification', { id: item.id })),
  ]);
  return [heading('Upozornění'), node('section', { className: 'card' },
    table(['Typ', 'Projekt', 'Od', 'Čas', 'Stav'], rows, 'Zatím žádná upozornění.'))];
}

function users() {
  const workspaceUsers = state.users.map((user) => [user.name, user.email, roleNames[user.role], user.client,
    pill(user.enabled ? 'Aktivní' : 'Deaktivovaný', user.enabled ? 'positive' : ''),
    user.id === state.user.id ? 'Můj účet' : actionButton(user.enabled ? 'Deaktivovat' : 'Aktivovat', () => {
      if (user.enabled && !window.confirm('Deaktivovat účet ' + user.name + ' a odhlásit jeho relace?')) return;
      return command('user-status', { id: user.id, enabled: !user.enabled });
    })]);
  const clientChoices = state.clientManagement.clients.map((item) => [item.id, item.name]);
  const roles = Object.entries(roleNames).filter(([role]) => role !== 'client' || clientChoices.length);
  const role = field('Role', 'role', roles);
  const client = conditionalFields(role.querySelector('select'), [field('Klient', 'client', clientChoices)], (value) => value === 'client');
  return [heading('Uživatelé'), node('section', { className: 'card' },
    table(['Jméno', 'E-mail', 'Role', 'Klient', 'Stav', 'Akce'], workspaceUsers, 'Zatím žádní uživatelé.')),
  card('Pozvat uživatele', form('Vytvořit pozvánku', [field('E-mail', 'email', 'email'), role, client],
    (data) => command('invite', data)))];
}

const campaignOptions = (items) => items.map((item) => [item.id, item.name + ' · ' + item.code + (item.client ? ' · ' + item.client : '')]);

function googleAdsPanel(campaigns) {
  const eligible = campaigns.filter((row) => row.source.toLowerCase() === 'google ads');
  const connections = state.googleAds;
  const connected = eligible.filter((row) => connections.some((item) => item.campaign_id === row.id));
  const configurable = eligible.filter((row) => !connections.some((item) => item.campaign_id === row.id && item.last_run));
  if (!eligible.length) return null;
  const mode = config.googleAds;
  const dayAgo = (count) => new Date(Date.parse(reportDate()) - count * 86_400_000).toISOString().slice(0, 10);
  const range = [
    field('Import od', 'from', 'date', { value: adsFormValues.from ?? dayAgo(mode === 'demo' ? 3 : 7), max: dayAgo(1) }),
    field('Import do', 'to', 'date', { value: adsFormValues.to ?? dayAgo(1), max: dayAgo(1) }),
  ];
  const syncFields = [field('Napojená kampaň', 'campaign', campaignOptions(connected)), ...range];
  syncFields[0].querySelector('select').value = adsFormValues.campaign ?? connected[0]?.id ?? '';
  if (mode === 'demo') {
    const scenario = field('Scénář zdroje', 'scenario', [
      ['gap', 'Chybějící den'], ['complete', 'Doplněná data'], ['correction', 'Opravený náklad'],
    ]);
    scenario.querySelector('select').value = adsFormValues.scenario ?? 'gap';
    syncFields.push(scenario);
  }
  const imports = connected.map((item) => {
    const entry = connections.find((row) => row.campaign_id === item.id);
    const last = entry.last_run;
    return node('section', { className: 'sync-result', 'aria-label': 'Výsledek importu ' + item.name },
      node('h3', {}, item.name),
      node('p', { className: 'muted' }, entry.customer_id + ' · ' + entry.external_id),
      last ? [
        node('p', {}, formatDate(last.from) + ' až ' + formatDate(last.to)),
        node('ul', { className: 'sync-counts' }, [
          ['Nové', last.added], ['Opravené', last.updated], ['Beze změny', last.unchanged],
          ['Potvrzená nula', last.zero], ['Chybějící dny', last.missing.length],
        ].map(([label, value]) => node('li', {}, label + ' ', node('strong', {}, String(value))))),
        last.missing.length ? node('p', { className: 'muted' }, 'Nevykázané dny ' + last.missing.map(formatDate).join(', ')) : null,
        last.retained ? node('p', { className: 'muted' }, 'U některých dnů zůstává poslední známý náklad.') : null,
      ] : empty('Čeká na první import.'));
  });
  return card('Import Google Ads', [
    mode === 'demo' ? node('p', { className: 'muted report-note' }, 'Simulovaný zdroj s fiktivními výdaji.') : null,
    mode && connected.length ? form('Synchronizovat náklady', syncFields, (data) => {
      adsFormValues = data;
      return command('sync-google-ads', data, 'Synchronizace dokončena.');
    }) : null,
    !mode ? empty('Synchronizace čeká na konfiguraci zdroje na serveru.') : null,
    imports,
    configurable.length ? node('details', { className: 'sync-config' }, node('summary', {}, 'Napojit kampaň'),
      form('Uložit napojení', [
        field('Kampaň Google Ads', 'campaign', campaignOptions(configurable)),
        field('ID účtu Google Ads', 'customer', 'text', { inputmode: 'numeric', maxlength: 12 }),
        field('ID kampaně Google Ads', 'external', 'text', { inputmode: 'numeric', maxlength: 19 }),
      ], (data) => command('configure-google-ads', data, 'Napojení uloženo.'))) : null,
  ]);
}

function campaignManagement() {
  const { clients, campaigns, recentCosts } = state.clientManagement;
  const output = [heading('Klienti a kampaně'),
    googleAdsPanel(campaigns),
    card('Kampaně', table(['Klient', 'Kampaň', 'Projekt', 'Kanál', 'ID kampaně'],
      campaigns.map((item) => [item.client, item.name, item.project, item.source, item.code]), 'Zatím žádné klientské kampaně.'))].filter(Boolean);
  if (state.user.role === 'admin') output.push(card('Klienti', [
    table(['Klient'], clients.map(({ name }) => [name]), 'Zatím žádní klienti.'),
    form('Přidat klienta', [field('Jméno klienta', 'name', 'text', { maxlength: 120 })], (data) => command('create-client', data)),
  ]));
  if (clients.length) output.push(card('Nová kampaň', form('Přidat kampaň', [
    field('Klient', 'client', clients.map((item) => [item.id, item.name])), field('Název kampaně', 'name'), field('Projekt', 'project'),
    field('Kanál', 'source'), field('ID kampaně', 'code', 'text', { maxlength: 64 }),
  ], (data) => command('create-campaign', data))));
  if (!campaigns.length) return output;
  const costForm = form('Uložit denní náklad', [
    field('Kampaň', 'campaign', campaignOptions(campaigns)),
    field('Datum nákladu', 'day', 'date', { value: reportDate(), max: reportDate() }),
    field('Náklad v Kč', 'cost', 'text', { inputmode: 'decimal' }),
  ], (data) => command('save-campaign-cost', data, 'Denní náklad uložen.'));
  output.push(card('Denní náklady', [
    costForm,
    table(['Datum', 'Kampaň', 'Kanál', 'Náklad', 'Akce'], recentCosts.map((row) => [
      formatDate(row.day), row.campaign + ' · ' + row.code, row.source, czk(row.cost_cents),
      actionButton('Upravit', () => {
        costForm.elements.campaign.value = row.campaign_id;
        costForm.elements.day.value = row.day;
        costForm.elements.cost.value = (row.cost_cents / 100).toFixed(2).replace('.', ',');
        costForm.elements.cost.focus();
      }, 'plain'),
    ]), 'Zatím žádné evidované náklady.'),
  ]));
  return output;
}

async function clientOverview() {
  const report = await api('/api/client/report' + clientQuery);
  const { from, to } = report.period;
  const query = new URLSearchParams({ from, to });
  if (report.campaign_id) query.set('campaign', report.campaign_id);
  const choose = field('Kampaň', 'campaign', campaignOptions(report.options), { required: false });
  choose.querySelector('option').textContent = 'Všechny kampaně';
  choose.querySelector('select').value = report.campaign_id ?? '';
  const update = (options) => run(async () => {
    const previous = clientQuery;
    clientQuery = '?' + options.toString();
    try { await render(true); } catch (error) {
      clientQuery = previous;
      throw error;
    }
  });
  const page = (value) => update(new URLSearchParams([...query, ['page', value]]));
  return [
    heading('Klientský přehled', pill(report.client)),
    attentionLink('reakce'),
    metrics([
      ['Předané poptávky', report.totals.handed],
      ['Evidované náklady', czk(report.totals.cost_cents)],
      ['Náklad na předání', czk(report.totals.unit_cents)],
    ], 'client-metrics'),
    card('Období reportu', form('Použít filtry', [
      field('Od', 'from', 'date', { value: from }), field('Do', 'to', 'date', { value: to }), choose,
    ], (data) => update(new URLSearchParams(data)))),
    card('Výkon kampaní', [
      table(['Kampaň', 'Kanál', 'Evidovaný náklad', 'Předáno', 'Náklad na předání'], report.campaigns.map((row) => [
        node('span', {}, node('strong', {}, row.name), node('small', { className: 'line-meta' }, row.code),
          row.import_missing ? node('small', { className: 'line-meta' }, 'Chybějící dny Google Ads ' + row.import_missing) : null),
        row.source, czk(row.cost_cents, 'Bez evidence'), String(row.handed), czk(row.unit_cents),
      ]), 'V účtu zatím nejsou kampaně.'),
      node('p', { className: 'muted report-note' }, 'Náklad na předání vychází z výdajů a předání ve zvoleném období.'),
      report.totals.missing_cost ? node('p', { className: 'muted report-note' }, 'U některé kampaně s předáním chybí evidence nákladů.') : null,
      report.import_missing ? node('p', { className: 'muted report-note' }, 'Google Ads má ve zvoleném období nevykázané dny. U dotčených kampaní a v souhrnu je cena za předání dočasně prázdná.') : null,
      actions(csvLink('Stáhnout report CSV', '/api/client/report.csv?' + query, 'kampane.csv')),
    ]),
    card('Předané poptávky', [
      table(['Kontakt', 'Projekt', 'Kampaň', 'Předáno', 'Převzetí', 'Reklamace'], report.deliveries.map((row) => [
        node('span', {}, link(row.name, '#predani/' + row.id), node('small', { className: 'line-meta' }, row.email)),
        row.project, row.campaign, formatDate(row.handed_day), receiptStatus(row), claimStatus(row.claim_status, row.claim_turn),
      ]), 'Ve zvoleném období nebyla předána žádná poptávka.'),
      pagination(report.page, report.pages, page),
    ]),
  ];
}

const receiptStatus = (row) => pill(row.confirmed_at ? 'Potvrzeno' : 'Čeká na potvrzení', row.confirmed_at ? 'positive' : '');
const claimStatus = (status, turn) => {
  if (status === 'review' && turn === 'request') return pill(state.user.role === 'client' ? 'Čeká na vás' : 'Čeká na klienta', 'attention');
  if (status === 'review' && turn === 'reply') return pill('Podklady doplněny', 'positive');
  return status ? pill(claimStates[status], status === 'accepted' ? 'positive' : '') : '—';
};

const responseTitle = (route) => route === 'eskalace' ? titles.eskalace[0]
  : state.user.role === 'client' ? 'Čeká na vaši odpověď' : 'Čeká na reakci týmu';
const responseCounters = {
  reakce: { stateKey: 'handoffAttention', badge: 'handoff-attention-count', alert: 'handoff-alert' },
  eskalace: { stateKey: 'handoffEscalations', badge: 'handoff-escalations-count', alert: 'handoff-escalations-alert' },
};
const responseLabel = (route, count) => responseTitle(route) + ' (' + count + ')';

function attentionLink(route) {
  const { stateKey, alert } = responseCounters[route];
  const count = state[stateKey] ?? 0;
  return link(responseLabel(route, count), '#' + route, { id: alert, className: 'button secondary attention-link', hidden: !count });
}

function updateCounter(route, count) {
  const { stateKey, badge, alert } = responseCounters[route];
  if (!Number.isInteger(count) || count === state[stateKey]) return;
  state[stateKey] = count;
  for (const [key, label] of [[badge, String(count)], [alert, responseLabel(route, count)]]) {
    const element = $(key);
    if (element) {
      element.textContent = label;
      element.hidden = !count;
    }
  }
}

function deadline(due, overdue) {
  if (!due) return '—';
  return node('span', { className: 'claim-deadline' },
    node('time', { datetime: due, title: 'Čas Praha' }, pragueDateTime.format(new Date(due))),
    node('span', { className: 'pill overdue', 'data-claim-deadline': due, hidden: !overdue }, 'Po lhůtě'));
}

function calendarNotice(revision) {
  if (revision == null) return null;
  return node('p', { id: 'claim-calendar-notice', className: 'muted', role: 'status', hidden: true, 'data-calendar-revision': revision },
    'Pracovní kalendář se změnil. Obnovte zobrazení pro nové termíny.');
}

async function refreshAttention() {
  const current = state;
  if (document.hidden || busy || checkingAttention || typeof current?.handoffAttention !== 'number') return;
  checkingAttention = true;
  try {
    const { count, overdue, checkedAt, calendarRevision } = await api('/api/handoff-attention/count');
    if (state !== current) return;
    updateCounter('reakce', count);
    updateCounter('eskalace', overdue);
    const message = $('claim-calendar-notice');
    if (message && Number(message.dataset.calendarRevision) !== calendarRevision) {
      message.hidden = false;
      return;
    }
    for (const status of screen.querySelectorAll('[data-claim-deadline]')) status.hidden = status.dataset.claimDeadline > checkedAt;
  } catch {
    // The next refresh retries without interrupting a draft or changing the current view.
  } finally { checkingAttention = false; }
}

async function handoffAttention(route) {
  const escalations = route === 'eskalace';
  const inbox = await api('/api/handoff-attention?page=' + attentionPages[route] + (escalations ? '&overdue=1' : ''));
  const client = state.user.role === 'client';
  return [
    heading(responseTitle(route), actionButton('Obnovit seznam', () => run(refresh))),
    calendarNotice(inbox.rows[0]?.calendar_revision),
    node('section', { className: 'card' }, [
      table(['Poptávka', 'Kampaň', 'Reklamace', 'Na tahu', 'Termín reakce'], inbox.rows.map((row) => [
        link(row.name, '#predani/' + row.id + '/' + route), row.campaign, claimStatus(row.claim_status, row.claim_turn),
        row.claim_turn === 'request' ? (client ? 'Vy' : 'Klient') : 'Tým', deadline(row.sla_due_at, row.sla_overdue),
      ]), escalations ? 'Žádná otevřená reklamace není po lhůtě.' : 'Žádná reklamace teď nečeká na vaši reakci.'),
      pagination(inbox.page, inbox.pages, (page) => run(async () => {
        const previous = attentionPages[route];
        attentionPages[route] = page;
        try { await render(true); } catch (error) { attentionPages[route] = previous; throw error; }
      })),
    ]),
  ];
}

async function handoffInbox() {
  const inbox = await api('/api/handoffs?' + handoffParams);
  const summary = state.handoffSummary;
  const options = { active: 'Otevřené reklamace', waiting: 'Čeká na potvrzení', confirmed: 'Potvrzená převzetí',
    closed: 'Vyřízené reklamace', client_turn: 'Čeká na podklady klienta', all: 'Všechna předání' };
  const status = field('Stav předání', 'status', Object.entries(options));
  status.querySelector('select').value = inbox.status;
  const update = (params) => run(async () => {
    const previous = handoffParams;
    handoffParams = new URLSearchParams(params);
    try { await render(true); } catch (error) {
      handoffParams = previous;
      throw error;
    }
  });
  return [
    heading('Předání klientům', actionButton('Obnovit seznam', () => run(refresh))),
    calendarNotice(inbox.rows[0]?.calendar_revision),
    metrics([['Předané poptávky', summary.total], ['Potvrzená převzetí', summary.confirmed], ['Otevřené reklamace', summary.active]]),
    card('Přehled předání', [
      form('Použít filtr', [status], ({ status }) => update({ status })),
      table(['Poptávka', 'Klient', 'Předáno', 'Převzetí', 'Reklamace', 'Termín reakce'], inbox.rows.map((row) => [
        node('span', {}, link(row.name, '#predani/' + row.id), node('small', { className: 'line-meta' }, row.campaign)),
        row.client, formatDate(row.handed_day), receiptStatus(row), claimStatus(row.claim_status, row.claim_turn), deadline(row.sla_due_at, row.sla_overdue),
      ]), 'V tomto přehledu zatím nejsou žádné předané poptávky.'),
      pagination(inbox.page, inbox.pages, (page) => update({ status: inbox.status, page })),
    ]),
  ];
}

function newClaimForm(deliveryId) {
  const reason = field('Důvod reklamace', 'reason', Object.entries(claimReasons));
  const description = field('Popis reklamace', 'description', 'textarea', { maxlength: 1600, required: false });
  const select = reason.querySelector('select');
  select.addEventListener('change', () => { description.querySelector('textarea').required = select.value === 'other'; });
  const requestKey = crypto.randomUUID();
  return form('Podat reklamaci', [reason, description], (data) => command('file-handoff-claim', {
    id: deliveryId, request_key: requestKey, ...data,
  }, 'Reklamace byla podána.'));
}

function claimCard(claim, team, delivery) {
  const take = claim.status === 'open' || (claim.status === 'review' && claim.reviewer_id !== state.user.id);
  const canResolve = claim.status === 'review' && (state.user.role === 'admin' || claim.reviewer_id === state.user.id);
  const args = { id: claim.id, version: claim.version };
  const turn = claim.messages.at(-1)?.kind;
  const request = team && canResolve && turn !== 'request';
  const reply = !team && claim.status === 'review' && turn === 'request';
  const thread = claim.messages.length ? [
    node('h3', {}, 'Vlákno reklamace'),
    node('ol', { className: 'claim-thread' }, claim.messages.map((message) => node('li', {},
      node('div', { className: 'actions' },
        node('strong', {}, message.kind === 'request' ? 'Požadavek týmu' : 'Doplnění klienta'),
        node('span', { className: 'muted' }, message.author + ' · ' + formatDate(message.created_at))),
      node('p', { className: 'prose' }, message.body)))),
  ] : null;
  const evidenceForm = (label, fieldLabel, action, message) => {
    const requestKey = crypto.randomUUID();
    return form(label, [field(fieldLabel, 'message', 'textarea', { maxlength: 1600 })],
      (data) => command(action, { ...args, ...data, request_key: requestKey }, message));
  };
  return card('Reklamace #' + claim.id, [
    actions(claimStatus(claim.status, turn), node('span', { className: 'muted' }, formatDate(claim.filed_at) + ' · ' + claim.reporter)),
    delivery?.sla_due_at ? node('dl', { className: 'claim-term' }, node('dt', {},
      turn === 'request' ? (team ? 'Termín klienta' : 'Váš termín') : 'Termín týmu'),
    node('dd', {}, deadline(delivery.sla_due_at, delivery.sla_overdue))) : null,
    node('p', { className: 'claim-reason' }, claimReasons[claim.reason]),
    claim.description ? node('p', { className: 'prose' }, claim.description) : null,
    team && claim.reviewer ? node('p', { className: 'muted' }, 'Řeší ' + claim.reviewer + ' · ' + formatDate(claim.reviewed_at)) : null,
    thread,
    claim.resolution ? [
      node('h3', {}, 'Vyjádření týmu'), node('p', { className: 'prose' }, claim.resolution),
      node('p', { className: 'muted' }, formatDate(claim.resolved_at) + (team && claim.resolver ? ' · ' + claim.resolver : '')),
    ] : null,
    team && take ? actions(actionButton(claim.status === 'open' ? 'Převzít reklamaci' : 'Převzít řešení',
      () => command('review-handoff-claim', args, 'Reklamace je v řešení.'))) : null,
    request ? evidenceForm('Vyžádat podklady', 'Požadované podklady', 'request-claim-evidence', 'Požadavek je ve vlákně reklamace.') : null,
    reply ? evidenceForm('Doplnit podklady', 'Doplnění podkladů', 'reply-claim-evidence', 'Podklady byly doplněny.') : null,
    team && canResolve ? form('Uložit rozhodnutí', [
      field('Výsledek reklamace', 'outcome', [['accepted', 'Uznat reklamaci'], ['rejected', 'Zamítnout reklamaci']]),
      field('Vyjádření pro klienta', 'resolution', 'textarea', { maxlength: 1600 }),
    ], (data) => command('resolve-handoff-claim', { ...args, ...data }, 'Rozhodnutí bylo uloženo.')) : null,
  ], 'claim-card');
}

async function handoffView(id, route) {
  const { delivery, claims } = await api('/api/handoffs/' + id);
  const team = state.user.role !== 'client';
  const backLabel = { reakce: 'Zpět k upozorněním', eskalace: 'Zpět k eskalacím', predani: 'Zpět k předáním', prehled: 'Zpět do přehledu' };
  const summary = node('dl', { className: 'detail-grid' }, [
    ['Kontakt', delivery.email], ['Projekt', delivery.project], ['Kampaň', delivery.campaign + ' · ' + delivery.code],
    ['Předáno', formatDate(delivery.handed_at)], ['Klient', delivery.client], ['Převzetí', receiptStatus(delivery)],
  ].map(([label, value]) => node('div', {}, node('dt', {}, label), node('dd', {}, value))));
  const receipt = delivery.confirmed_at ? node('p', { className: 'muted' },
    'Potvrzení převzetí · ' + delivery.confirmed_by + ' · ' + formatDate(delivery.confirmed_at)) : null;
  return [
    heading(delivery.name, actions(actionButton('Obnovit detail', () => run(refresh)),
      link(backLabel[route], '#' + route, { className: 'button secondary' }))),
    calendarNotice(delivery.sla_due_at ? delivery.calendar_revision : null),
    card('Předaná poptávka', [
      summary, receipt,
      !team && !delivery.confirmed_at ? actions(actionButton('Potvrdit převzetí',
        () => command('confirm-handoff', { id }, 'Převzetí bylo potvrzeno.'), 'primary')) : null,
    ], 'handoff-detail'),
    claims.length ? claims.map((claim, index) => claimCard(claim, team, index === 0 ? delivery : null))
      : team ? card('Reklamace', empty('K tomuto předání není podaná reklamace.')) : null,
    !team && !claims.some((claim) => ['open', 'review'].includes(claim.status))
      ? card('Podání reklamace', newClaimForm(id)) : null,
  ].flat().filter(Boolean);
}

function positions(isInvestor) {
  const rows = state.positions.map((row) => [row.project, ...(isInvestor ? [] : [row.investor]), kcz.format(row.principal_cents / 100),
    formatDate(row.maturity), pill(row.status === 'active' ? 'Aktivní' : 'Splacená', row.status === 'active' ? 'positive' : ''),
    ...(isInvestor ? [] : [row.status === 'active' ? actionButton('Uzavřít', () => {
      if (window.confirm('Označit pozici jako splacenou?')) return command('close-position', { id: row.id });
    }) : '—'])]);
  const columns = ['Projekt', ...(isInvestor ? [] : ['Investor']), 'Kapitál', 'Splatnost', 'Stav', ...(isInvestor ? [] : ['Akce'])];
  const output = [heading(isInvestor ? 'Moje portfolio' : 'Pozice investorů'), node('section', { className: 'card' }, table(columns, rows, 'Zatím žádné pozice.'))];
  if (!isInvestor) output.push(card('Přidat pozici', state.investors.length ? form('Uložit pozici', [
    field('Investor', 'investor', state.investors.map((row) => [row.id, row.name + ' · ' + row.email])),
    field('Projekt', 'project'), field('Kapitál v Kč', 'principal', 'text', { inputmode: 'decimal' }), field('Splatnost', 'maturity', 'date'),
  ], (data) => command('add-position', data)) : empty('Pozici lze přidat po založení účtu investora.')));
  return output;
}

function showMessage(item, receipt) {
  const dialog = node('dialog', { 'aria-label': item.title }, heading(item.title),
    node('p', { className: 'muted' }, formatDate(item.published_at || item.created_at)), node('p', { className: 'prose' }, item.body),
    node('form', { method: 'dialog' }, node('button', { className: 'button secondary', type: 'submit' }, 'Zavřít')));
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
  if (receipt && !item.read_at) void run(async () => {
    await api('/api/actions/read-message', { id: item.id });
    const refreshAfter = () => { void run(refresh); };
    if (dialog.open) dialog.addEventListener('close', refreshAfter, { once: true });
    else await refresh();
  });
}

function messages(isInvestor) {
  const visible = state.messages.map((item) => [
    actionButton(item.title, () => showMessage(item, isInvestor), 'plain'), ...(isInvestor ? [] : [item.investor]),
    item.published_at ? formatDate(item.published_at) : '—',
    pill(!item.published_at ? 'Koncept' : item.read_at ? 'Přečtená' : 'Nepřečtená', item.published_at && !item.read_at ? 'positive' : ''),
    ...(isInvestor ? [] : [item.published_at ? '—' : actionButton('Zveřejnit', () => {
      if (window.confirm('Zveřejnit tuto zprávu v účtu ' + item.investor + '?')) return command('publish-message', { id: item.id });
    })]),
  ]);
  const columns = ['Zpráva', ...(isInvestor ? [] : ['Příjemce']), 'Zveřejněno', 'Stav', ...(isInvestor ? [] : ['Akce'])];
  const output = [heading(isInvestor ? 'Moje zprávy' : 'Zprávy pro investory'), node('section', { className: 'card' }, table(columns, visible, 'Zatím žádné zprávy.'))];
  if (!isInvestor) output.push(card('Nový koncept', state.investors.length ? form('Uložit koncept', [
    field('Investor', 'investor', state.investors.map((row) => [row.id, row.name + ' · ' + row.email])),
    field('Předmět', 'title', 'text', { maxlength: 160 }), field('Zpráva', 'body', 'textarea', { maxlength: 6000 }),
  ], (data) => command('draft-message', data)) : empty('Zprávu lze připravit po založení účtu investora.')));
  return output;
}

function account() {
  return [heading('Můj účet'), card(state.user.name, [node('p', {}, state.user.email), node('p', { className: 'muted' }, roleNames[state.user.role] + ' · ' + (state.client ?? state.user.workspace))]),
    card('Změnit heslo', form('Uložit nové heslo', [
      field('Aktuální heslo', 'current', 'password', { autocomplete: 'current-password', maxlength: 128 }),
      field('Nové heslo', 'next', 'password', { autocomplete: 'new-password', minlength: 12, maxlength: 128 }),
    ], (data) => run(async () => { await api('/api/password', data); await refresh(); notice('Heslo bylo změněno.'); })))];
}

function claimCalendarSettings() {
  const calendar = state.claimCalendar;
  const hours = { min: 1, max: 240, step: 1 };
  const closures = field('Dny volna navíc', 'closures', 'textarea', {
    required: false, maxlength: 4096, placeholder: 'RRRR-MM-DD', 'aria-describedby': 'claim-closures-help',
  });
  closures.querySelector('textarea').value = calendar.closures.join('\n');
  return [heading('Lhůty reklamací', actionButton('Obnovit nastavení', () => run(refresh))), card('Pracovní kalendář', [
    node('p', { className: 'muted' }, 'Pondělí až pátek · čas Praha. České svátky se vynechávají automaticky.'),
    node('p', { className: 'muted', id: 'claim-closures-help' }, 'Dny volna navíc zadejte po jednom na řádek ve formátu RRRR-MM-DD.'),
    form('Uložit pracovní kalendář', [
      field('Začátek pracovní doby', 'opens', 'time', { value: calendar.opens }),
      field('Konec pracovní doby', 'closes', 'time', { value: calendar.closes }),
      field('Lhůta týmu v pracovních hodinách', 'teamHours', 'number', { ...hours, value: calendar.teamHours }),
      field('Lhůta klienta v pracovních hodinách', 'clientHours', 'number', { ...hours, value: calendar.clientHours }),
      closures,
    ], (data) => command('save-claim-calendar', { ...data, version: calendar.version }, 'Pracovní kalendář byl uložen.')),
  ])];
}

const views = {
  prehled: overview, poptavky: leadList, kampane: campaignManagement, ukoly: tasks, upozorneni: notificationList, uzivatele: users, investori: () => positions(false),
  predani: handoffInbox,
  reakce: () => handoffAttention('reakce'), eskalace: () => handoffAttention('eskalace'), lhuty: claimCalendarSettings,
  komunikace: () => messages(false), portfolio: () => positions(true), schranka: () => messages(true),
  historie: () => [heading('Historie změn'), card('Aktivita organizace', timeline(state.activity))], ucet: account,
};

function navigation(active) {
  const show = Boolean(active && state);
  $('sidebar').hidden = !show;
  $('toolbar').hidden = !show;
  document.body.classList.toggle('signed-in', show);
  if (!show) return;
  const { role, workspace, name } = state.user;
  $('workspace-name').textContent = state.client ?? workspace;
  $('toolbar-name').textContent = name;
  $('toolbar-role').textContent = roleNames[role];
  const links = available[role].map((route) => {
    const [label, glyph] = titles[route];
    const counter = responseCounters[route];
    const count = counter ? state[counter.stateKey] ?? 0 : 0;
    const badge = counter ? node('span', { id: counter.badge,
      className: route === 'eskalace' ? 'attention-count overdue' : 'attention-count',
      hidden: !count, 'aria-live': 'polite' }, String(count)) : null;
    return node('a', { href: '#' + route, 'aria-current': route === active ? 'page' : null }, icon(glyph), label, badge);
  });
  if (browserDemo) links.push(node('a', { href: './', target: '_blank', rel: 'noopener' }, icon('user'), 'Otevřít další roli'));
  $('navigation').replaceChildren(...links);
}

async function render(propagateError = false) {
  const revision = ++renderNumber;
  const hash = location.hash.slice(1);
  const invite = /^pozvanka\/([A-Za-z0-9_-]{43})$/.exec(hash);
  if (!state || invite) {
    navigation(null);
    screen.replaceChildren(loginScreen(invite?.[1]));
    return;
  }
  const lead = /^poptavka\/(\d{1,12})$/.exec(hash);
  const handoff = /^predani\/(\d{1,12})(?:\/(reakce|eskalace))?$/.exec(hash);
  const role = state.user.role;
  const maySeeHandoff = ['admin', 'care', 'client'].includes(role);
  const route = handoff && maySeeHandoff ? (handoff[2] || (role === 'client' ? 'prehled' : 'predani')) : lead ? 'poptavky' : hash;
  const active = available[role].includes(route) ? route : 'prehled';
  const report = active === 'prehled' && state.user.role === 'client';
  navigation(active);
  try {
    const content = handoff && maySeeHandoff ? await handoffView(handoff[1], active) : report ? await clientOverview()
      : lead && active === 'poptavky' && state.user.role !== 'marketing' ? await leadView(lead[1]) : await views[active]();
    if (revision === renderNumber) screen.replaceChildren(...content);
  } catch (e) {
    if (propagateError) throw e;
    if (revision !== renderNumber) return;
    if (handoff && maySeeHandoff) screen.replaceChildren(heading('Předaná poptávka'), empty(e.message),
      link('Zpět do přehledu', '#' + active));
    else if (report || active === 'predani') screen.replaceChildren(heading(report ? 'Klientský přehled' : 'Předání klientům'),
      empty(e.message), actionButton('Obnovit přehled', () => run(refresh)));
    else if (responseCounters[active]) screen.replaceChildren(heading(responseTitle(active)), empty(e.message), actionButton('Obnovit seznam', () => run(refresh)));
    else screen.replaceChildren(heading('Poptávka'), empty(e.message), link('Zpět k poptávkám', '#poptavky'));
  }
}

$('logout').addEventListener('click', () => void run(async () => {
  await api('/api/logout', {});
  state = undefined;
  clientQuery = '';
  handoffParams = new URLSearchParams();
  attentionPages = { reakce: 1, eskalace: 1 };
  adsFormValues = {};
  document.body.classList.remove('menu-open');
  $('menu-toggle').setAttribute('aria-expanded', 'false');
  history.replaceState(null, '', location.pathname);
  await render();
}));
$('menu-toggle').addEventListener('click', () => {
  const open = document.body.classList.toggle('menu-open');
  $('menu-toggle').setAttribute('aria-expanded', String(open));
});
window.addEventListener('hashchange', () => {
  document.body.classList.remove('menu-open');
  $('menu-toggle').setAttribute('aria-expanded', 'false');
  notice('');
  void render().then(() => screen.querySelector('h1')?.focus({ preventScroll: true }));
});
window.addEventListener('focus', refreshAttention);
document.addEventListener('visibilitychange', refreshAttention);
setInterval(refreshAttention, 15000);

try {
  config = await api('/api/config');
  try { state = await api('/api/state'); } catch (error) { if (error.status !== 401) throw error; }
  await render();
} catch (error) {
  notice(error.message, true);
}
