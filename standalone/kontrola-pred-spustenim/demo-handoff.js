(function (root) {
  'use strict';

  const storageKey = 'kampane.demo.predani.v1';
  const fixture = Object.freeze({ id: 'QA-SCENAR-01', date: '2026-11-03', source: 'google', campaign: 'G-202', status: 'Nová' });

  function get(storage) {
    try {
      const raw = storage.getItem(storageKey);
      if (!raw || raw.length > 500) return null;
      const saved = JSON.parse(raw);
      if (!saved || saved.version !== 1 || typeof saved.qualified !== 'boolean' || !saved.lead) return null;
      if (!Object.entries(fixture).every(([key, value]) => saved.lead[key] === value)) return null;
      const step = saved.qualified && Number.isInteger(saved.step) && saved.step >= 0 && saved.step <= 4 ? saved.step : 0;
      return { qualified: saved.qualified, lead: { ...fixture }, step };
    } catch { return null; }
  }

  function save(storage, qualified, step) {
    try {
      const current = get(storage);
      const next = qualified ?? current?.qualified ?? false;
      storage.setItem(storageKey, JSON.stringify({ version: 1, qualified: next, lead: fixture, step: next ? step ?? current?.step ?? 0 : 0 }));
      return get(storage)?.qualified === next;
    } catch { return false; }
  }

  function forget(storage) {
    try { storage.removeItem(storageKey); } catch { /* Storage may be disabled. */ }
  }

  const api = { fixture, get, save, forget };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CampaignDemo = api;
})(globalThis);
