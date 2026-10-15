import { $, api, esc, modal, toast, setToken, NATIVE } from './ui.js';
import { t, getLang, setLang } from './i18n.js';

const root = $('#app');
let cleanup = null;
let state = { user: null, guest: false, config: { demo: false } };

async function boot() {
  try {
    const [me, config] = await Promise.all([api('/auth/me'), api('/config')]);
    state.user = me.user;
    state.config = config;
  } catch (e) {
    root.innerHTML = `<div class="loading"><div class="card" style="max-width:360px"><b>No pudimos conectar.</b><span class="sub">${esc(e.message)}</span><button class="btn small" id="retry">Reintentar</button></div></div>`;
    $('#retry').onclick = boot;
    return;
  }
  render();
}

function render() {
  cleanup?.();
  cleanup = null;
  if (!state.user && !state.guest) return renderAuth();
  renderShell();
}

// ---------- Inicio de sesión y registro ----------
function renderAuth(mode = 'login', message = '') {
  root.innerHTML = `
  <main class="auth">
    <div class="auth-box">
      <div class="auth-brand">
        <img src="/icons/icon-192.png" alt="" width="96" height="96">
        <h1><span>¿</span>Dónde Viene<span>?</span></h1>
        <p>${esc(t('tagline'))}</p>
      </div>
      <form class="card" id="authForm" novalidate>
        <div class="auth-tabs" role="tablist">
          <button type="button" role="tab" id="tLogin" aria-selected="${mode === 'login'}">${esc(t('login'))}</button>
          <button type="button" role="tab" id="tReg" aria-selected="${mode === 'register'}">${esc(t('register'))}</button>
        </div>
        <div class="field" ${mode === 'login' ? 'hidden' : ''}><label class="label" for="fName">${esc(t('name'))}</label><input id="fName" autocomplete="name"></div>
        <div class="field"><label class="label" for="fEmail">${esc(t('email'))}</label><input id="fEmail" type="email" autocomplete="email" inputmode="email" required></div>
        <div class="field"><label class="label" for="fPass">${esc(t('password'))}</label><input id="fPass" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required minlength="8"></div>
        <div class="field" ${mode === 'login' ? 'hidden' : ''}><label class="label" for="fPhone">${esc(t('phone'))}</label><input id="fPhone" type="tel" autocomplete="tel"></div>
        <div class="error" id="authErr" role="alert" ${message ? '' : 'hidden'}>${esc(message)}</div>
        <button class="btn" id="authBtn" type="submit">${esc(mode === 'login' ? t('login') : t('register'))}</button>
        <div class="row-actions" style="justify-content:space-between;align-items:center">
          <span class="sub">Idioma</span>
          <div class="row-actions"><button type="button" class="ghost" id="lEs" aria-pressed="${getLang() === 'es'}">ES</button><button type="button" class="ghost" id="lEn" aria-pressed="${getLang() === 'en'}">EN</button></div>
        </div>
      </form>
      <div class="guest">${esc(t('guest'))} <button class="link" id="guestBtn">${esc(t('guestBtn'))}</button></div>
      ${state.config.demo ? `<div class="demo-accounts">Cuentas de prueba (contraseña demo1234): pasajero@demo.mx · conductor07@demo.mx · admin@dondeviene.mx (admin1234)</div>` : ''}
    </div>
  </main>`;
  $('#tLogin').onclick = () => renderAuth('login');
  $('#tReg').onclick = () => renderAuth('register');
  $('#lEs').onclick = () => { setLang('es'); renderAuth(mode); };
  $('#lEn').onclick = () => { setLang('en'); renderAuth(mode); };
  $('#guestBtn').onclick = () => { state.guest = true; render(); };
  $('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#authBtn'), err = $('#authErr');
    btn.disabled = true; err.hidden = true;
    try {
      const body = { email: $('#fEmail').value, password: $('#fPass').value };
      if (mode === 'register') Object.assign(body, { name: $('#fName').value, phone: $('#fPhone').value });
      const r = await api(mode === 'login' ? '/auth/login' : '/auth/register', { method: 'POST', body });
      if (r.token) setToken(r.token);
      state.user = r.user; state.guest = false;
      render();
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false; btn.disabled = false;
    }
  };
}

// ---------- Estructura principal ----------
const ROLE_LABEL = { pasajero: 'Pasajero', conductor: 'Conductor', admin: 'Administración' };

function renderShell() {
  const u = state.user;
  const role = u?.role || 'pasajero';
  root.innerHTML = `
  <header class="topbar">
    <img class="logo" src="/icons/icon-192.png" alt="">
    <div class="grow">
      <div class="title"><span>¿</span>Dónde Viene<span>?</span></div>
      <div class="sub" id="tbSub">${esc(u ? (u.name === ROLE_LABEL[role] ? u.name : `${u.name} · ${ROLE_LABEL[role]}`) : t('tagline'))}</div>
    </div>
    ${role === 'pasajero' ? `<button class="tb-btn" id="tbLang" aria-label="Cambiar idioma">${getLang() === 'es' ? 'EN' : 'ES'}</button>` : ''}
    <button class="tb-btn" id="tbUser">${esc(u ? t('account') : t('login'))}</button>
  </header>
  <div id="view"></div>`;
  $('#tbLang')?.addEventListener('click', () => { setLang(getLang() === 'es' ? 'en' : 'es'); render(); });
  $('#tbUser').onclick = () => (u ? accountMenu() : (state.guest = false, render()));
  mountView(role);
}

async function mountView(role) {
  const view = $('#view');
  const mod = role === 'admin' ? await import('./admin.js') : role === 'conductor' ? await import('./driver.js') : await import('./passenger.js');
  cleanup = await mod.mount(view, { user: state.user, rerender: render });
}

function accountMenu() {
  const u = state.user;
  const m = modal(`
    <h2 style="font-family:var(--font-display);font-size:26px">${esc(t('account'))}</h2>
    <div><b>${esc(u.name)}</b><div class="sub">${esc(u.email)} · ${esc(ROLE_LABEL[u.role])}</div></div>
    <form id="pwForm" class="stack" novalidate>
      <p class="label">Cambiar contraseña</p>
      <input id="pwCur" type="password" placeholder="Contraseña actual" autocomplete="current-password" aria-label="Contraseña actual">
      <input id="pwNew" type="password" placeholder="Nueva contraseña (mínimo 8)" autocomplete="new-password" aria-label="Nueva contraseña">
      <div class="error" id="pwErr" hidden></div>
      <button class="ghost" type="submit">Guardar contraseña</button>
    </form>
    <div class="two">
      <button class="ghost" id="mClose" type="button">Cerrar</button>
      <button class="danger" id="mOut" type="button">${esc(t('logout'))}</button>
    </div>`);
  $('#mClose', m.el).onclick = m.close;
  $('#mOut', m.el).onclick = async () => {
    try { await api('/auth/logout', { method: 'POST', body: {} }); } catch { /* sin conexión: igual salimos */ }
    setToken(null);
    m.close(); state.user = null; state.guest = false; render();
  };
  $('#pwForm', m.el).onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#pwErr', m.el); err.hidden = true;
    try {
      await api('/auth/password', { method: 'POST', body: { current: $('#pwCur', m.el).value, password: $('#pwNew', m.el).value } });
      m.close(); toast('Contraseña actualizada.');
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  };
}

if ('serviceWorker' in navigator && !NATIVE && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

boot();
