(function () {
  'use strict';
  const demo = window.InvestorDemo;
  const fixtures = window.InvestorFixtures;
  const $ = (id) => document.getElementById(id);
  const views = { prehled: 'Přehled', portfolio: 'Portfolio', prilezitosti: 'Příležitosti', komunikace: 'Komunikace' };
  const cash = new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const days = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'UTC' });
  const formatDate = (value) => days.format(new Date(`${value}T00:00:00Z`));
  const showCurrency = (value) => cash.format(value);
  const messageCount = (value, unread = false) => {
    if (value === 1) return unread ? '1 nepřečtená zpráva' : '1 zpráva';
    if (value >= 2 && value <= 4) return `${value} ${unread ? 'nepřečtené ' : ''}zprávy`;
    return `${value} ${unread ? 'nepřečtených ' : ''}zpráv`;
  };
  const isCase = Boolean(fixtures) && new URLSearchParams(location.search).get('predani') === '1';
  const preferences = fixtures ? storage('localStorage') : null;
  let state = demo.load(preferences) ?? demo.defaultState();
  let hasSavedState = true;
  let caseStep = 0;
  let announcementTimer;
  let returnFocus;
  let updateDialog;

  function storage(name) {
    try { return window[name]; } catch { return null; }
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function control(label, action, className = 'button secondary') {
    const node = element('button', label, className);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }

  function date(value) {
    const node = element('time', formatDate(value));
    node.dateTime = value;
    return node;
  }

  function announce(text) {
    window.clearTimeout(announcementTimer);
    $('notice').textContent = '';
    announcementTimer = window.setTimeout(() => { $('notice').textContent = text; }, 20);
  }

  function download(content, type, filename) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = element('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function alter(callback) {
    if (hasSavedState) state = demo.load(preferences) ?? state;
    callback(state);
    hasSavedState = demo.save(preferences, state);
    render();
  }

  function openDetails(title, children, focus, onUpdate) {
    returnFocus = focus;
    updateDialog = onUpdate;
    $('details-title').textContent = title;
    $('details-body').replaceChildren(...children);
    $('details').showModal();
  }

  function detailValues(entries) {
    const list = element('dl', undefined, 'detail-values');
    for (const [label, value] of entries) {
      const cell = element('dd');
      cell.append(value);
      list.append(element('dt', label), cell);
    }
    return list;
  }

  function openPosition(position, focus) {
    const values = detailValues([['ID pozice', position.id], ['Stav', demo.positionStatus[position.status]],
      ['Vložená částka', showCurrency(position.principal)], ['Splatnost', date(position.maturity)]]);
    const children = position.note ? [element('p', position.note), values] : [values];
    if (position.schedule.length) {
      const list = element('ul', undefined, 'payment-list');
      for (const entry of position.schedule) {
        const row = element('li');
        row.append(date(entry.date), element('strong', showCurrency(entry.amount)));
        list.append(row);
      }
      children.push(element('h3', 'Plánované platby'), list);
    } else children.push(element('p', 'K této pozici nejsou naplánované platby.', 'callout'));
    if (demo.messages(caseStep).some((item) => item.positionId === position.id)) {
      children.push(control('Zprávy k pozici', () => {
        $('details').close();
        showMessages('all', position.id);
        location.hash = 'komunikace';
      }));
    }
    openDetails(position.name, children, focus);
  }

  function filteredPositions() {
    const filter = $('position-filter').value;
    const query = demo.normalize($('position-query').value);
    return demo.positions.filter((position) => (filter === 'all' || position.status === filter)
      && demo.normalize(`${position.name} ${position.id} ${position.category}`).includes(query));
  }

  function renderPositions() {
    const positions = filteredPositions();
    $('position-list').hidden = !positions.length;
    $('positions-empty').hidden = Boolean(positions.length);
    $('payments').hidden = !positions.length;
    $('export-portfolio').disabled = !positions.length;
    $('position-list').replaceChildren(...positions.map((position) => {
      const row = element('article', undefined, 'position-row');
      const title = element('div');
      title.append(element('h2', position.name), element('p', position.category, 'muted'));
      const open = control('Otevřít detail', () => openPosition(position, () => open));
      open.setAttribute('aria-label', `Otevřít detail · ${position.name}`);
      row.append(title, element('span', showCurrency(position.principal), 'position-value'),
        element('span', demo.positionStatus[position.status], position.status === 'active' ? 'pill on' : 'pill'), open);
      return row;
    }));
    const payments = demo.paymentSchedule(positions);
    const total = demo.sumMoney(payments, 'amount');
    $('schedule-summary').textContent = payments.length ? `Plánovaný součet ${showCurrency(total)} · počet plateb ${payments.length}` : 'Zobrazené pozice nemají plánované platby.';
    $('export-calendar').disabled = !payments.length;
    $('scheduled-payments').replaceChildren(...payments.map((entry) => {
      const row = element('li');
      const project = element('div');
      project.append(element('strong', entry.position.name), date(entry.date));
      const open = control('Detail pozice', () => openPosition(entry.position, () => open));
      open.setAttribute('aria-label', `Detail platby · ${entry.position.name} · ${formatDate(entry.date)}`);
      row.append(project, element('span', showCurrency(entry.amount), 'payment-value'), open);
      return row;
    }));
  }

  function openOpportunity(item) {
    const actions = element('div', undefined, 'dialog-actions');
    const result = element('p', undefined, 'callout');
    result.setAttribute('aria-live', 'polite');
    const save = control('', () => toggle('saved'));
    const interest = control('', () => toggle('interest'), 'button primary');
    actions.append(save, interest);
    function update() {
      save.textContent = state.saved.has(item.id) ? 'Odebrat z uložených' : 'Uložit příležitost';
      interest.textContent = state.interest.has(item.id) ? 'Zrušit zájem' : 'Zaznamenat zájem';
      result.hidden = !state.interest.has(item.id);
      result.textContent = result.hidden ? '' : 'Zájem zaznamenán.';
    }
    function toggle(key) {
      const enabled = !state[key].has(item.id);
      alter((current) => {
        if (enabled) current[key].add(item.id);
        else current[key].delete(item.id);
      });
      if (key === 'saved') announce(state.saved.has(item.id) ? 'Příležitost je uložená.' : 'Příležitost byla odebraná z uložených.');
    }
    update();
    openDetails(item.name, [element('p', item.note), detailValues([['Kategorie', item.category], ['Horizont', item.horizon], ['Fáze', item.phase]]), result, actions],
      () => $(`detail-${item.id}`) || ($('opportunity-empty').hidden ? $('opportunity-query') : $('clear-filters')), update);
  }

  function renderOpportunities() {
    const savedOnly = $('saved-only').checked;
    const matches = demo.filterOpportunities($('opportunity-query').value, $('opportunity-category').value, savedOnly, state.saved);
    $('opportunity-list').replaceChildren(...matches.map((item) => {
      const row = element('article', undefined, 'card opportunity');
      const category = element('div', undefined, 'opportunity-top');
      category.append(element('span', item.category, 'pill'));
      const open = control('Otevřít detail', () => openOpportunity(item));
      open.id = `detail-${item.id}`;
      open.setAttribute('aria-label', `Otevřít detail · ${item.name}`);
      row.append(category, element('h2', item.name), element('p', item.phase, 'muted'));
      if (state.saved.has(item.id) || state.interest.has(item.id)) {
        const tags = element('div', undefined, 'tags');
        if (state.saved.has(item.id)) tags.append(element('span', 'Uloženo', 'pill on'));
        if (state.interest.has(item.id)) tags.append(element('span', 'Zájem zaznamenán', 'pill on'));
        row.append(tags);
      }
      row.append(open);
      return row;
    }));
    $('opportunity-empty').hidden = matches.length > 0;
    $('opportunity-empty-text').textContent = savedOnly && !state.saved.size ? 'Zatím nemáte žádné uložené příležitosti.' : 'Tomuto filtru neodpovídá žádná příležitost.';
  }

  function openMessage(item, list) {
    alter((current) => current.read.add(item.id));
    const unread = control('Označit jako nepřečtenou', () => {
      alter((current) => current.read.delete(item.id));
      announce('Zpráva je označená jako nepřečtená.');
      $('details').close();
    });
    const position = demo.positions.find(({ id }) => id === item.positionId);
    const meta = [item.type, formatDate(item.date), position?.name].filter(Boolean).join(' · ');
    openDetails(item.title, [element('p', meta, 'muted'), element('p', item.text), unread],
      () => $(`${list}-${item.id}`) || (list === 'inbox' ? $('message-filter') : $('overview-title')));
  }

  function messageRow(item, list, position) {
    const row = element('li');
    const unread = !state.read.has(item.id);
    const open = control(undefined, () => openMessage(item, list), unread ? 'message-open unread' : 'message-open');
    open.id = `${list}-${item.id}`;
    const meta = element('span', position ? `${item.type} · ${position}` : item.type, 'meta');
    if (unread) meta.append(element('span', 'Nepřečtená', 'pill on'));
    const title = element('strong', item.title);
    title.id = `${open.id}-title`;
    open.setAttribute('aria-labelledby', title.id);
    open.append(title, date(item.date), meta);
    if (list === 'inbox') open.append(element('span', item.text, 'message-preview'));
    row.append(open);
    return row;
  }

  function renderMessages() {
    const items = demo.messages(caseStep);
    const unread = items.filter((item) => !state.read.has(item.id));
    const mode = $('message-filter').value;
    const scoped = mode === 'unread' ? unread : mode === 'case' ? items.filter(({ step }) => Boolean(step)) : items;
    const query = demo.normalize($('message-query').value);
    const position = $('message-position').value;
    const names = new Map(demo.positions.map((item) => [item.id, item.name]));
    const shown = scoped.filter((item) => (!position || item.positionId === position)
      && demo.normalize(`${item.title} ${item.type} ${item.text} ${names.get(item.positionId) || ''}`).includes(query));
    $('inbox-badge').hidden = !unread.length;
    $('inbox-badge').textContent = String(unread.length);
    $('inbox-badge').setAttribute('aria-label', messageCount(unread.length, true));
    $('recent-summary').textContent = unread.length ? messageCount(unread.length, true) : items.length ? 'Všechny zprávy jsou přečtené.' : 'Žádné zprávy.';
    $('recent-messages').replaceChildren(...items.slice(0, 3).map((item) => messageRow(item, 'recent', names.get(item.positionId))));
    $('inbox-list').replaceChildren(...shown.map((item) => messageRow(item, 'inbox', names.get(item.positionId))));
    $('inbox-list').hidden = !shown.length;
    $('inbox-empty').hidden = Boolean(shown.length);
    $('message-count').textContent = messageCount(shown.length);
  }

  function render() {
    $('saved-count').textContent = String(state.saved.size);
    renderOpportunities();
    renderMessages();
    updateDialog?.();
  }

  function syncCase() {
    if (!fixtures) return;
    const transfer = isCase && window.CampaignDemo.get(storage('sessionStorage'));
    caseStep = transfer?.step ?? 0;
    $('case-card').hidden = caseStep < 2;
    $('case-summary').textContent = fixtures.caseSummaries[caseStep >= 4 ? 1 : 0];
    const filter = $('message-filter');
    const option = filter.querySelector('[value="case"]');
    option.hidden = caseStep < 2;
    option.disabled = caseStep < 2;
    if (caseStep < 2 && filter.value === 'case') filter.value = 'all';
    const back = $('case-back');
    back.hidden = caseStep < 2 || !['https:', 'http:'].includes(location.protocol);
    back.closest('.topbar').classList.toggle('topbar-return', !back.hidden);
  }

  function route(focus) {
    const requested = location.hash.slice(1);
    const name = Object.hasOwn(views, requested) ? requested : 'prehled';
    if ($('details').open) $('details').close();
    for (const view of Object.keys(views)) $(view).hidden = name !== view;
    document.querySelectorAll('[data-route]').forEach((link) => {
      if (link.dataset.route === name) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    $('view-name').textContent = views[name];
    if (focus) {
      $(name).querySelector('h1').focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }

  function resetFilters() {
    $('opportunity-query').value = '';
    $('opportunity-category').value = '';
    $('saved-only').checked = false;
    $('position-filter').value = 'all';
    $('position-query').value = '';
    $('message-filter').value = 'all';
    $('message-position').value = '';
    $('message-query').value = '';
  }

  function showMessages(mode, position = '') {
    $('message-filter').value = mode;
    $('message-position').value = position;
    $('message-query').value = '';
    renderMessages();
  }

  function renderDashboard() {
    const summary = demo.portfolio();
    $('portfolio-total').textContent = showCurrency(summary.invested);
    $('active-count').textContent = String(summary.active.length);
    $('payment-amount').textContent = summary.next ? showCurrency(summary.next.amount) : '—';
    $('payment-project').replaceChildren(...(summary.next
      ? [date(summary.next.date), element('span', summary.next.position.name)]
      : ['Žádná nadcházející platba.']));
    $('payment-detail').hidden = !summary.next;
  }

  function renderCategories() {
    const filter = $('opportunity-category');
    filter.replaceChildren(new Option('Všechny kategorie', ''));
    for (const category of new Set(demo.opportunities.map((item) => item.category))) filter.add(new Option(category, category));
    const messagePositions = new Set(demo.messages(caseStep).map(({ positionId }) => positionId));
    const positions = demo.positions.filter(({ id }) => messagePositions.has(id));
    const messageFilter = $('message-position');
    messageFilter.replaceChildren(new Option('Všechny pozice', ''), ...positions.map(({ name, id }) => new Option(name, id)));
    messageFilter.hidden = !positions.length;
  }

  $('close-details').addEventListener('click', () => $('details').close());
  $('details').addEventListener('close', () => {
    const target = returnFocus?.();
    if (target && !target.closest('[hidden]') && target.isConnected) target.focus({ preventScroll: true });
    returnFocus = undefined;
    updateDialog = undefined;
  });
  document.querySelector('.skip').addEventListener('click', (event) => { event.preventDefault(); $('main-content').focus(); });
  $('payment-detail').addEventListener('click', () => {
    const next = demo.portfolio().next;
    if (next) openPosition(next.position, () => $('payment-detail'));
  });
  $('position-filter').addEventListener('change', renderPositions);
  $('position-query').addEventListener('input', renderPositions);
  $('clear-position-filters').addEventListener('click', () => {
    $('position-query').value = '';
    $('position-filter').value = 'all';
    renderPositions();
    $('position-query').focus();
  });
  $('export-portfolio').addEventListener('click', () => {
    download(demo.exportPortfolio(filteredPositions()), 'text/csv;charset=utf-8', 'portfolio.csv');
    announce('CSV s vybranými pozicemi je připravené ke stažení.');
  });
  $('export-calendar').addEventListener('click', () => {
    const payments = demo.paymentSchedule(filteredPositions());
    if (payments.length) download(demo.exportCalendar(payments), 'text/calendar;charset=utf-8', 'harmonogram-plateb.ics');
  });
  $('opportunity-query').addEventListener('input', renderOpportunities);
  $('opportunity-category').addEventListener('change', renderOpportunities);
  $('saved-only').addEventListener('change', renderOpportunities);
  $('clear-filters').addEventListener('click', () => {
    $('opportunity-query').value = '';
    $('opportunity-category').value = '';
    $('saved-only').checked = false;
    renderOpportunities();
    $('opportunity-query').focus();
  });
  $('message-filter').addEventListener('change', renderMessages);
  $('message-position').addEventListener('change', renderMessages);
  $('message-query').addEventListener('input', renderMessages);
  $('case-history')?.addEventListener('click', () => showMessages('case'));
  $('show-all-messages').addEventListener('click', () => { showMessages('all'); $('message-query').focus(); });
  $('reset-demo').addEventListener('click', () => {
    const actions = element('div', undefined, 'dialog-actions');
    actions.append(control('Zrušit', () => $('details').close()), control('Vymazat', () => {
      resetFilters();
      alter((current) => Object.assign(current, demo.defaultState()));
      renderPositions();
      $('details').close();
      announce('Uložený stav vymazán.');
    }, 'button primary'));
    openDetails('Vymazat uložený stav?', [element('p', 'Vymažou se uložené příležitosti, zaznamenaný zájem a stav přečtení zpráv v tomto prohlížeči.'), actions], () => $('reset-demo'));
  });

  syncCase();
  if (caseStep >= 2 && location.hash === '#komunikace') $('message-filter').value = 'case';
  renderCategories();
  renderDashboard();
  renderPositions();
  render();
  route(false);
  window.addEventListener('hashchange', () => route(true));
  window.addEventListener('pageshow', (event) => { if (event.persisted) { syncCase(); render(); } });
  window.addEventListener('storage', (event) => {
    if (preferences && hasSavedState && (event.key === demo.stateKey || event.key === null)) {
      state = demo.load(preferences) ?? demo.defaultState();
      render();
    }
  });
  $('load-data')?.addEventListener('click', () => $('data-file').click());
  let importVersion = 0;
  $('data-file')?.addEventListener('change', async (event) => {
    const ticket = ++importVersion;
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const status = $('data-status');
    try {
      if (file.size > 8_000_000) throw new Error('Soubor může mít nejvýše 8 MB.');
      const snapshot = demo.parsePortfolio(await file.text());
      if (ticket !== importVersion) return;
      demo.usePortfolio(snapshot);
      state = demo.defaultState();
      resetFilters();
      renderCategories();
      renderDashboard();
      renderPositions();
      render();
      status.classList.remove('error');
      status.textContent = 'Portfolio načteno.';
    } catch (error) {
      if (ticket !== importVersion) return;
      status.classList.add('error');
      status.textContent = error.message;
    }
    status.hidden = false;
  });
})();
