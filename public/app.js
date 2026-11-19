import { browserDemo, request } from './transport.js';

const $ = (id) => document.getElementById(id);
const screen = $('screen');
const roleNames = { admin: 'Správce', marketing: 'Marketing', agent: 'Kvalifikace', care: 'Péče', investor: 'Investor', client: 'Klient' };
const stageNames = { new: 'Nová', contacted: 'Kontaktována', qualified: 'Kvalifikovaná', handed: 'Předaná', closed: 'Uzavřená' };
const events = {
  workspace_created: 'Založení organizace', lead_created: 'Založení poptávky', lead_assigned: 'Přiřazení poptávky',
  stage_changed: 'Změna stavu', note_added: 'Interní poznámka', task_added: 'Založení úkolu',
  task_done: 'Dokončení úkolu', invite_created: 'Vytvoření pozvánky', invite_accepted: 'Aktivace účtu', investor_linked: 'Propojení s účtem investora',
  user_activated: 'Opětovná aktivace účtu', user_disabled: 'Deaktivace účtu',
  position_created: 'Založení pozice', position_closed: 'Uzavření pozice',
  message_drafted: 'Koncept zprávy', message_published: 'Zveřejnění zprávy', password_changed: 'Změna hesla',
  client_created: 'Založení klienta', campaign_created: 'Založení kampaně', campaign_cost_saved: 'Změna nákladu kampaně',
  campaign_attached: 'Přiřazení klientské kampaně',
};
const available = {
  admin: ['prehled', 'poptavky', 'kampane', 'ukoly', 'upozorneni', 'investori', 'komunikace', 'uzivatele', 'historie', 'ucet'],
  marketing: ['prehled', 'poptavky', 'kampane', 'ucet'],
  agent: ['prehled', 'poptavky', 'ukoly', 'upozorneni', 'ucet'],
  care: ['prehled', 'poptavky', 'ukoly', 'upozorneni', 'investori', 'komunikace', 'ucet'],
  investor: ['prehled', 'portfolio', 'schranka', 'ucet'],
  client: ['prehled', 'ucet'],
};
const titles = {
  prehled: ['Přehled', 'grid'], poptavky: ['Poptávky', 'list'], ukoly: ['Úkoly', 'check'],
  kampane: ['Klienti a kampaně', 'bag'],
  upozorneni: ['Upozornění', 'mail'], investori: ['Investoři', 'bag'], komunikace: ['Zprávy pro investory', 'mail'],
  uzivatele: ['Uživatelé', 'user'], historie: ['Historie změn', 'clock'],
  portfolio: ['Portfolio', 'bag'], schranka: ['Zprávy', 'mail'], ucet: ['Můj účet', 'user'],
};
const kcz = new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const dateOnly = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'UTC' });
const dateTime = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'short', timeStyle: 'short' });
const formatDate = (value) => value ? (value.length === 10 ? dateOnly.format(new Date(value + 'T00:00:00Z')) : dateTime.format(new Date(value))) : '—';
const localDate = () => new Intl.DateTimeFormat('sv-SE').format(new Date());
const reportDate = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(new Date());
const czk = (cents, emptyValue = '—') => cents === null ? emptyValue : kcz.format(cents / 100);
let config;
let state;
let renderNumber = 0;
let busy = false;
let clientQuery = '';

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
  const result = [heading(lead.name, link('Všechny poptávky', '#poptavky', { className: 'button secondary' })), node('section', { className: 'card detail' }, summary, controls)];
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

function campaignManagement() {
  const { clients, campaigns, recentCosts } = state.clientManagement;
  const output = [heading('Klienti a kampaně'),
    card('Kampaně', table(['Klient', 'Kampaň', 'Projekt', 'Kanál', 'ID kampaně'],
      campaigns.map((item) => [item.client, item.name, item.project, item.source, item.code]), 'Zatím žádné klientské kampaně.'))];
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
        node('span', {}, node('strong', {}, row.name), node('small', { className: 'line-meta' }, row.code)),
        row.source, czk(row.cost_cents, 'Bez evidence'), String(row.handed), czk(row.unit_cents),
      ]), 'V účtu zatím nejsou kampaně.'),
      node('p', { className: 'muted report-note' }, 'Náklad na předání vychází z výdajů a předání ve zvoleném období.'),
      report.totals.missing_cost ? node('p', { className: 'muted report-note' }, 'U některé kampaně s předáním chybí evidence nákladů.') : null,
      actions(csvLink('Stáhnout report CSV', '/api/client/report.csv?' + query, 'kampane.csv')),
    ]),
    card('Předané poptávky', [
      table(['Kontakt', 'Projekt', 'Kampaň', 'Předáno'], report.deliveries.map((row) => [
        node('span', {}, node('strong', {}, row.name), node('small', { className: 'line-meta' }, row.email)),
        row.project, row.campaign, formatDate(row.handed_day),
      ]), 'Ve zvoleném období nebyla předána žádná poptávka.'),
      report.pages > 1 ? actions(
        node('span', { className: 'muted' }, 'Strana ' + report.page + ' z ' + report.pages),
        report.page > 1 ? actionButton('Předchozí', () => page(report.page - 1)) : null,
        report.page < report.pages ? actionButton('Další', () => page(report.page + 1)) : null,
      ) : null,
    ]),
  ];
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

const views = {
  prehled: overview, poptavky: leadList, kampane: campaignManagement, ukoly: tasks, upozorneni: notificationList, uzivatele: users, investori: () => positions(false),
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
    return node('a', { href: '#' + route, 'aria-current': route === active ? 'page' : null }, icon(glyph), label);
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
  const route = lead ? 'poptavky' : hash;
  const active = available[state.user.role].includes(route) ? route : 'prehled';
  const report = active === 'prehled' && state.user.role === 'client';
  navigation(active);
  try {
    const content = report ? await clientOverview()
      : lead && active === 'poptavky' && state.user.role !== 'marketing' ? await leadView(lead[1]) : views[active]();
    if (revision === renderNumber) screen.replaceChildren(...content);
  } catch (e) {
    if (propagateError) throw e;
    if (revision !== renderNumber) return;
    if (report) screen.replaceChildren(heading('Klientský přehled'), empty(e.message), actionButton('Obnovit přehled', () => run(refresh)));
    else screen.replaceChildren(heading('Poptávka'), empty(e.message), link('Zpět k poptávkám', '#poptavky'));
  }
}

$('logout').addEventListener('click', () => void run(async () => {
  await api('/api/logout', {});
  state = undefined;
  clientQuery = '';
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

try {
  config = await api('/api/config');
  try { state = await api('/api/state'); } catch (error) { if (error.status !== 401) throw error; }
  await render();
} catch (error) {
  notice(error.message, true);
}
