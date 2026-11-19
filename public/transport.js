export const browserDemo = document.querySelector('meta[name="workspace-mode"]')?.content === 'browser';
const sessionKey = 'aardvarkland-leadforce-session';
const pending = new Map();
let sequence = 0;
let worker;

function startWorker() {
  const runtime = new Worker(new URL('./workspace-worker.js', import.meta.url), { type: 'module' });
  runtime.addEventListener('message', ({ data }) => {
    const complete = pending.get(data.id);
    if (!complete) return;
    pending.delete(data.id);
    complete.resolve(data.reply);
  });
  runtime.addEventListener('error', () => {
    for (const complete of pending.values()) complete.reject(new Error('Ukázku se nepodařilo spustit. Obnovte stránku.'));
    pending.clear();
    runtime.terminate();
    worker = undefined;
  });
  return runtime;
}

export async function request(path, init = {}) {
  if (!browserDemo) return fetch(path, init);
  worker ??= startWorker();
  const id = ++sequence;
  const input = {
    path,
    method: init.method ?? 'GET',
    body: init.body ? JSON.parse(init.body) : {},
    session: sessionStorage.getItem(sessionKey),
    csrf: init.headers?.['X-Workspace-CSRF'],
  };
  const reply = await new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, input });
  });
  if ('session' in reply) {
    if (reply.session) sessionStorage.setItem(sessionKey, reply.session);
    else sessionStorage.removeItem(sessionKey);
  }
  return new Response(reply.contentType ? reply.body : JSON.stringify(reply.body), {
    status: reply.status,
    headers: { 'Content-Type': reply.contentType ?? 'application/json' },
  });
}
