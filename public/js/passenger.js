import { $, $$, api, esc, toast, fmtMin, adviceHTML, store } from './ui.js';
import { t } from './i18n.js';
import { makeRoute, etaTo } from './geo.js';
import { createMap, subscribe } from './map.js';

const REASONS = ['no_se_detuvo', 'manejo_peligroso', 'cobro_incorrecto', 'sin_aire_sucia', 'mal_trato', 'otro'];

export async function mount(view, { user }) {
  const { routes } = await api('/routes');
  if (!routes.length) { view.innerHTML = '<div class="page"><div class="empty">Aún no hay rutas registradas.</div></div>'; return () => {}; }

  const st = {
    route: routes.find((r) => String(r.id) === store('dv-route')) || routes[0],
    stop: Number(store('dv-stop') ?? 5), dir: Number(store('dv-dir') ?? 0),
    units: [], notify: null, reason: null, online: true,
  };
  let geo, mapCtl, unsub;

  view.innerHTML = `
  <div class="page">
    <div class="layout">
      <div class="stack sticky">
        <div class="map" id="pMap" role="region" aria-label="Mapa de la ruta"></div>
        <span class="sub" id="pLive"></span>
      </div>
      <div class="stack">
        <div class="card">
          ${routes.length > 1 ? `<div class="field"><label class="label" for="pRoute">Ruta</label><select id="pRoute">${routes.map((r) => `<option value="${r.id}">${esc(r.code)} · ${esc(r.name)}</option>`).join('')}</select></div>` : `<div class="drv-head"><span class="sign">${esc(st.route.code)}</span><b>${esc(st.route.name)}</b></div>`}
          <div class="field"><label class="label" for="pStop">${esc(t('whereAt'))}</label><select id="pStop"></select></div>
          <div class="field"><span class="label">${esc(t('whereTo'))}</span>
            <div class="two" role="group"><button type="button" class="opt" id="pDir0"></button><button type="button" class="opt" id="pDir1"></button></div>
          </div>
        </div>
        <div class="card" aria-live="polite" id="pNext"></div>
        <div class="card">
          <p class="label">${esc(t('reportT'))}</p>
          ${user ? `
            <div class="field"><label class="sub" for="rUnit">${esc(t('whichUnit'))}</label><select id="rUnit"></select></div>
            <div class="chips" id="rChips" role="group">${REASONS.map((r) => `<button type="button" class="chip" data-r="${r}" aria-pressed="false">${esc(t('r_' + r))}</button>`).join('')}</div>
            <div class="field"><label class="sub" for="rComment">${esc(t('comment'))}</label><textarea id="rComment" maxlength="500"></textarea></div>
            <button type="button" class="btn small" id="rSend">${esc(t('send'))}</button>
            <div id="rMsg" hidden></div>` : `<p class="sub" style="margin:0">${esc(t('loginToReport'))}</p>`}
        </div>
      </div>
    </div>
  </div>`;

  function setRoute(r) {
    st.route = r; store('dv-route', String(r.id));
    geo = makeRoute(r.path, r.stops);
    if (st.stop >= r.stops.length) st.stop = 0;
    $('#pStop').innerHTML = r.stops.map((s, k) => `<option value="${k}">${esc(s.km ? s.km + ' · ' : '')}${esc(s.name)}</option>`).join('');
    $('#pStop').value = st.stop;
    if (user) $('#rUnit').innerHTML = r.units.map((u) => `<option value="${u.id}">${esc(t('unit'))} ${esc(u.number)}</option>`).join('');
    if (mapCtl) mapCtl.setRoute(r); else mapCtl = createMap($('#pMap'), r, { onStopClick: selectStop });
    unsub?.();
    st.units = [];
    unsub = subscribe(r.id, {
      snapshot: (s) => { st.units = s.units; mapCtl.setBuses(s.units); renderNext(); },
      status: (ok) => { st.online = ok; $('#pLive').textContent = ok ? `● ${t('live')}` : t('reconnecting'); },
    });
    selectStop(st.stop);
  }

  function selectStop(k) {
    st.stop = k; store('dv-stop', String(k));
    $('#pStop').value = k;
    const n = st.route.stops.length;
    if (k === 0) st.dir = 0;
    if (k === n - 1) st.dir = 1;
    store('dv-dir', String(st.dir));
    const a = st.route.stops[0].name, b = st.route.stops[n - 1].name;
    $('#pDir0').textContent = t('toB', { b }); $('#pDir1').textContent = t('toA', { a });
    $('#pDir0').setAttribute('aria-pressed', st.dir === 0); $('#pDir1').setAttribute('aria-pressed', st.dir === 1);
    $('#pDir0').disabled = k === n - 1; $('#pDir1').disabled = k === 0;
    mapCtl.selectStop(k, st.route);
    st.notify = null;
    renderNext();
  }

  const pill = (l) => `<span class="pill ${l}"><i></i>${esc(t(l))}</span>`;
  const accTag = (u) => (u.accessible ? `<span class="acc">♿ ${esc(t('acc'))}</span>` : '');

  function etas() {
    return st.units.filter((u) => !u.stale && !u.offRoute)
      .map((u) => ({ u, ...etaTo(geo, u, st.stop, st.dir) }))
      .sort((a, b) => a.eta - b.eta);
  }

  function renderNext() {
    const box = $('#pNext');
    const list = etas();
    if (!list.length) {
      box.innerHTML = `<p class="label">${esc(t('nextBus'))}</p><div class="empty">${esc(t('noBuses'))}</div>`;
      return;
    }
    const n = list[0];
    const arriving = fmtMin(n.eta) === 0;
    const free = list.slice(0, 3).find((x) => x.u.occ !== 'llena');
    let a;
    if (!free) a = adviceHTML('bad', '!', t('allFull'), t('allFullB'));
    else if (free !== n && fmtMin(free.eta) > 12) a = adviceHTML('bad', '!', t('nextFull'), t('nextFullFar', { u: free.u.number, m: fmtMin(free.eta) }));
    else if (free !== n) a = adviceHTML('warn', 'i', t('nextFull'), t('nextFullNear', { u: free.u.number, m: fmtMin(free.eta) }));
    else if (fmtMin(n.eta) > 15) a = adviceHTML('warn', 'i', t('wait'), t('waitB', { m: fmtMin(n.eta) }));
    else a = adviceHTML('good', '✓', t('good'), t('goodB', { u: n.u.number }));
    box.innerHTML = `
      <p class="label">${esc(t('nextBus'))}</p>
      <div class="next">
        <span class="unit">${esc(t('unit'))} ${esc(n.u.number)}</span>
        <div><div class="eta">${arriving ? esc(t('arriving')) : `${fmtMin(n.eta)}<small>min</small>`}</div>
          <div class="sub">${esc(arriving ? t('atStop') : t('kmAway', { km: (n.rel / 1000).toFixed(1) }))}${accTag(n.u)}</div></div>
        ${pill(n.u.occ)}
      </div>
      <div class="list">${list.slice(1, 3).map((x) => `<div class="lrow"><span class="unit">${esc(x.u.number)}</span><span><b>${fmtMin(x.eta)} min</b> <span class="sub">· ${(x.rel / 1000).toFixed(1)} km</span>${accTag(x.u)}</span>${pill(x.u.occ)}</div>`).join('')}</div>
      ${a}
      <button type="button" class="ghost" id="pNotify" aria-pressed="${!!st.notify}">${esc(st.notify ? t('notifyOn', { u: st.notify.number }) : t('notify'))}</button>
      <p class="sub" style="margin:0">${esc(t('freq', { n: list.length }))}</p>`;
    $('#pNotify').onclick = toggleNotify;
    checkNotify(list);
  }

  async function toggleNotify() {
    if (st.notify) { st.notify = null; renderNext(); return; }
    const list = etas();
    const c = list.find((x) => x.eta > 180) || list[0];
    if (!c) return;
    st.notify = { id: c.u.id, number: c.u.number };
    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch { /* el navegador no lo permite */ }
    }
    renderNext();
  }

  function checkNotify(list) {
    if (!st.notify) return;
    const x = list.find((y) => y.u.id === st.notify.id);
    if (!x) return;
    if (x.eta <= 180) {
      const msg = t('notifyMsg', { u: st.notify.number, s: st.route.stops[st.stop].name });
      st.notify = null;
      toast(msg, 15000);
      if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification('¿Dónde Viene?', { body: msg, icon: '/icons/icon-192.png' }); } catch { /* algunos navegadores solo permiten avisos desde el service worker */ }
      }
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      renderNext();
    }
  }

  // Eventos de la vista
  $('#pStop').onchange = (e) => selectStop(Number(e.target.value));
  $('#pDir0').onclick = () => { st.dir = 0; selectStop(st.stop); };
  $('#pDir1').onclick = () => { st.dir = 1; selectStop(st.stop); };
  $('#pRoute')?.addEventListener('change', (e) => setRoute(routes.find((r) => r.id === Number(e.target.value))));
  if (user) {
    $$('#rChips .chip').forEach((c) => c.onclick = () => {
      st.reason = c.dataset.r;
      $$('#rChips .chip').forEach((x) => x.setAttribute('aria-pressed', x === c));
    });
    $('#rSend').onclick = async () => {
      const msg = $('#rMsg'); msg.hidden = false;
      if (!st.reason) { msg.className = 'error'; msg.textContent = t('pick'); return; }
      try {
        await api('/reports', { method: 'POST', body: { unitId: Number($('#rUnit').value), reason: st.reason, comment: $('#rComment').value, stopId: st.route.stops[st.stop].id } });
        msg.className = 'okmsg'; msg.textContent = t('sent');
        st.reason = null; $('#rComment').value = '';
        $$('#rChips .chip').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      } catch (e) { msg.className = 'error'; msg.textContent = e.message; }
    };
  }

  setRoute(st.route);
  if ($('#pRoute')) $('#pRoute').value = st.route.id;
  const tick = setInterval(renderNext, 15000);
  return () => { clearInterval(tick); unsub?.(); mapCtl?.destroy(); };
}
