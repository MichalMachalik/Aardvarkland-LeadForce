(function () {
  'use strict';
  const sidebar = document.getElementById('workspace-nav');
  const toggle = document.getElementById('nav-toggle');
  toggle.addEventListener('click', () => {
    const collapsed = !sidebar.hidden;
    sidebar.hidden = collapsed;
    document.body.classList.toggle('nav-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    const label = collapsed ? 'Zobrazit navigaci' : 'Skrýt navigaci';
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
  });
  toggle.hidden = false;
})();
