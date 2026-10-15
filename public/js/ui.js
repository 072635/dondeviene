// Utilidades de interfaz compartidas.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    const e = new Error('Sin conexión. Revisa tu internet e inténtalo de nuevo.');
    e.offline = true;
    throw e;
  }
  let data = {};
  try { data = await res.json(); } catch { /* respuesta vacía */ }
  if (!res.ok) {
    const e = new Error(data.error || 'Algo salió mal. Inténtalo de nuevo.');
    e.status = res.status;
    throw e;
  }
  return data;
}

let toastTimer;
export function toast(msg, ms = 7000) {
  $('#toastTxt').textContent = msg;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, ms);
}
document.addEventListener('click', (e) => { if (e.target.id === 'toastX') $('#toast').hidden = true; });

export const hhmm = (ts) => new Date(ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
export const dateTime = (ts) => new Date(ts).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
export const fmtMin = (s) => Math.max(0, Math.round(s / 60));

export function adviceHTML(cls, ic, title, body) {
  return `<div class="advice ${cls}"><span class="ic" aria-hidden="true">${ic}</span><div><strong>${esc(title)}</strong>${esc(body)}</div></div>`;
}

// Diálogo simple dentro de la página. Devuelve el elemento y una función para cerrarlo.
export function modal(html) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  back.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  setTimeout(() => back.querySelector('input,button,select')?.focus(), 0);
  return { el: back, close };
}

export const LOGO_SVG = '/icons/icon.svg';

export function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch { return null; }
  return value;
}
