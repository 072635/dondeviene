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
  if (!state.user && !state.guest) return renderWelcome();
  renderShell();
}

// ---------- Bienvenida: pasajero, chofer o ver sin cuenta ----------
const ICONS = {
  pasajero: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>',
  conductor: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="3"/><path d="M3 11h18M7 20v-3M17 20v-3"/><circle cx="7.5" cy="14" r="1"/><circle cx="16.5" cy="14" r="1"/></svg>',
  guest: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
};

const brandHTML = () => `
  <div class="auth-brand">
    <img src="/icons/icon-192.png" alt="" width="96" height="96">
    <h1><span>¿</span>Dónde Viene<span>?</span></h1>
    <p>${esc(t('tagline'))}</p>
  </div>`;

function renderWelcome() {
  root.innerHTML = `
  <main class="auth">
    <div class="auth-box">
      ${brandHTML()}
      <div class="who">
        <button type="button" class="who-opt" id="wRider">${ICONS.pasajero}<span><b>${esc(t('whoRider'))}</b><small>${esc(t('whoRiderB'))}</small></span></button>
        <button type="button" class="who-opt" id="wDriver">${ICONS.conductor}<span><b>${esc(t('whoDriver'))}</b><small>${esc(t('whoDriverB'))}</small></span></button>
        <button type="button" class="who-opt guest-opt" id="wGuest">${ICONS.guest}<span><b>${esc(t('whoGuest'))}</b><small>${esc(t('whoGuestB'))}</small></span></button>
      </div>
      ${/Android/i.test(navigator.userAgent) && !NATIVE ? `<div class="guest"><a href="/descargas/dondeviene.apk" style="color:var(--gold-light);font-weight:700">Descargar la app para Android</a></div>` : ''}
      <div class="welcome-foot">
        <button type="button" class="link" id="wAdmin">${esc(t('adminLink'))}</button>
        <span><button type="button" class="link" id="lEs" aria-pressed="${getLang() === 'es'}">ES</button> · <button type="button" class="link" id="lEn" aria-pressed="${getLang() === 'en'}">EN</button></span>
      </div>
      ${state.config.demo ? `<div class="demo-accounts">Cuentas de prueba (contraseña demo1234): pasajero@demo.mx · conductor07@demo.mx · admin@dondeviene.mx (admin1234)</div>` : ''}
    </div>
  </main>`;
  $('#wRider').onclick = () => renderAuth('pasajero', 'register');
  $('#wDriver').onclick = () => renderAuth('conductor', 'register');
  $('#wGuest').onclick = () => { state.guest = true; render(); };
  $('#wAdmin').onclick = () => renderAuth('admin', 'login');
  $('#lEs').onclick = () => { setLang('es'); renderWelcome(); };
  $('#lEn').onclick = () => { setLang('en'); renderWelcome(); };
}

// ---------- Registro y entrada (uno para pasajeros, otro para choferes) ----------
function renderAuth(who, mode = 'register', message = '') {
  const reg = mode === 'register' && who !== 'admin', drv = who === 'conductor';
  const title = { pasajero: t('ridersT'), conductor: t('driversT'), admin: t('adminT') }[who];
  root.innerHTML = `
  <main class="auth">
    <div class="auth-box">
      ${brandHTML()}
      <form class="card" id="authForm" novalidate>
        <div class="auth-head"><button type="button" class="link" id="aBack">← ${esc(t('back'))}</button><b>${esc(title)}</b></div>
        ${who !== 'admin' ? `<div class="auth-tabs" role="tablist">
          <button type="button" role="tab" id="tReg" aria-selected="${reg}">${esc(t('register'))}</button>
          <button type="button" role="tab" id="tLogin" aria-selected="${!reg}">${esc(t('haveAccount'))}</button>
        </div>` : ''}
        <div class="field" ${reg ? '' : 'hidden'}><label class="label" for="fName">${esc(t('name'))}</label><input id="fName" autocomplete="name"></div>
        <div class="field"><label class="label" for="fEmail">${esc(t('email'))}</label><input id="fEmail" type="email" autocomplete="email" inputmode="email" required></div>
        <div class="field"><label class="label" for="fPass">${esc(t('password'))}</label><input id="fPass" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required minlength="8"></div>
        <div class="field" ${reg ? '' : 'hidden'}><label class="label" for="fPhone">${esc(drv ? t('phoneReq') : t('phone'))}</label><input id="fPhone" type="tel" autocomplete="tel" ${drv ? 'required' : ''}></div>
        <div class="field" ${reg && drv ? '' : 'hidden'}><label class="label" for="fUnit">${esc(t('unitAsk'))}</label><input id="fUnit" inputmode="numeric" maxlength="10" placeholder="07"></div>
        ${reg && drv ? `<p class="sub" style="margin:0">${esc(t('driverNote'))}</p>` : ''}
        <div class="error" id="authErr" role="alert" ${message ? '' : 'hidden'}>${esc(message)}</div>
        <button class="btn" id="authBtn" type="submit">${esc(reg ? (drv ? t('registerDriver') : t('register')) : t('login'))}</button>
      </form>
      ${who === 'pasajero' ? `<div class="guest">${esc(t('guest'))} <button class="link" id="guestBtn">${esc(t('guestBtn'))}</button></div>` : ''}
    </div>
  </main>`;
  // Cambiar de pestaña conserva el correo y la contraseña ya escritos.
  const go = (m) => {
    const email = $('#fEmail').value, pass = $('#fPass').value;
    renderAuth(who, m);
    $('#fEmail').value = email; $('#fPass').value = pass;
  };
  $('#aBack').onclick = renderWelcome;
  $('#tReg')?.addEventListener('click', () => go('register'));
  $('#tLogin')?.addEventListener('click', () => go('login'));
  $('#guestBtn')?.addEventListener('click', () => { state.guest = true; render(); });
  $('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#authBtn'), err = $('#authErr');
    btn.disabled = true; err.hidden = true;
    try {
      const body = { email: $('#fEmail').value, password: $('#fPass').value };
      if (reg) Object.assign(body, { name: $('#fName').value, phone: $('#fPhone').value, role: drv ? 'conductor' : 'pasajero', unitNumber: drv ? $('#fUnit').value : undefined });
      const r = await api(reg ? '/auth/register' : '/auth/login', { method: 'POST', body });
      if (r.token) setToken(r.token);
      state.user = r.user; state.guest = false;
      render();
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false; btn.disabled = false;
    }
  };
  $(reg ? '#fName' : '#fEmail').focus();
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
  // app.js se carga después del evento "load" (ver boot.js), así que se registra de inmediato si ya pasó.
  const reg = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (document.readyState === 'complete') reg(); else window.addEventListener('load', reg);
}

boot();
