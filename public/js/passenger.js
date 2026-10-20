import { $, $$, api, esc, toast, fmtMin, adviceHTML, store, NATIVE } from './ui.js';
import { t } from './i18n.js';
import { makeRoute, etaToPoint, nearestStop } from './geo.js';
import { createMap, subscribe } from './map.js';

const REASONS = ['no_se_detuvo', 'manejo_peligroso', 'cobro_incorrecto', 'sin_aire_sucia', 'mal_trato', 'otro'];
const WAIT_REFRESH_MS = 60e3;
const TERMINAL_M = 120;

// Identificador anónimo de este teléfono para el aviso de "estoy esperando" (no está ligado a la cuenta).
function waitId() {
  let id = store('dv-wid');
  if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    id = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    store('dv-wid', id);
  }
  return id;
}

// Notificaciones push del servidor (versión web). En iPhone solo funcionan con la app agregada a la pantalla de inicio.
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const STANDALONE = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = () => !NATIVE && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(b64) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function pushSubscription() {
  const { pushKey } = await api('/config');
  if (!pushKey) return null;
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error('sw')), 8000))]);
  const key = keyBytes(pushKey);
  let sub = await reg.pushManager.getSubscription();
  // Si el servidor cambió sus llaves, la suscripción vieja ya no sirve.
  const old = sub?.options?.applicationServerKey && new Uint8Array(sub.options.applicationServerKey);
  if (sub && old && (old.length !== key.length || old.some((b, i) => b !== key[i]))) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return sub.toJSON();
}

export async function mount(view, { user }) {
  const { routes } = await api('/routes');
  if (!routes.length) { view.innerHTML = '<div class="page"><div class="empty">Aún no hay rutas registradas.</div></div>'; return () => {}; }

  // mode 'gps': el punto es la ubicación del pasajero (las combis paran donde les hacen la parada).
  // mode 'stop': el pasajero elige una parada de la lista.
  const st = {
    route: routes.find((r) => String(r.id) === store('dv-route')) || routes[0],
    mode: store('dv-mode') === 'stop' ? 'stop' : 'gps',
    stop: Number(store('dv-stop') ?? 5), dir: Number(store('dv-dir') ?? 0),
    me: null, gpsMsg: '', watch: null, centered: false,
    units: [], notify: null, reason: null, online: true,
    wait: { on: false, timer: null, msg: '' },
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
          <div class="field"><span class="label">${esc(t('whereAt'))}</span>
            <div class="two" role="group"><button type="button" class="opt" id="pModeGps"></button><button type="button" class="opt" id="pModeStop"></button></div>
          </div>
          <p class="sub" id="pWhere" style="margin:0" aria-live="polite"></p>
          <div class="field" id="pStopField"><label class="sub" for="pStop">${esc(t('modeStop'))}</label><select id="pStop"></select></div>
          <div class="field"><span class="label">${esc(t('whereTo'))}</span>
            <div class="two" role="group"><button type="button" class="opt" id="pDir0"></button><button type="button" class="opt" id="pDir1"></button></div>
          </div>
        </div>
        <div class="card" aria-live="polite" id="pNext"></div>
        <div class="card" id="pWaitCard">
          <button type="button" class="btn small" id="pWait"></button>
          <p class="sub" id="pWaitMsg" style="margin:0"></p>
        </div>
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
  $('#pModeGps').textContent = t('modeGps');
  $('#pModeStop').textContent = t('modeStop');

  // ---------- Punto del pasajero ----------
  // Devuelve el punto sobre la ruta donde el pasajero espera: { d, lat, lng, label, stopIdx }.
  function target() {
    if (st.mode === 'stop') {
      const s = st.route.stops[st.stop];
      return { d: geo.stopD[st.stop], lat: s.lat, lng: s.lng, label: s.name, stopIdx: st.stop };
    }
    if (!st.me) return null;
    return { d: st.me.d, lat: st.me.lat, lng: st.me.lng, label: t('yourPoint'), stopIdx: nearestStop(geo, st.me.d) };
  }

  function effectiveDir(d) {
    if (d < TERMINAL_M) return 0;
    if (d > geo.L - TERMINAL_M) return 1;
    return st.dir;
  }

  function renderPlace() {
    const gps = st.mode === 'gps';
    $('#pModeGps').setAttribute('aria-pressed', gps); $('#pModeStop').setAttribute('aria-pressed', !gps);
    $('#pStopField').hidden = gps;
    const n = st.route.stops.length;
    const a = st.route.stops[0].name, b = st.route.stops[n - 1].name;
    $('#pDir0').textContent = t('toB', { b }); $('#pDir1').textContent = t('toA', { a });
    const tg = target();
    const dir = tg ? effectiveDir(tg.d) : st.dir;
    $('#pDir0').setAttribute('aria-pressed', dir === 0); $('#pDir1').setAttribute('aria-pressed', dir === 1);
    $('#pDir0').disabled = !!tg && tg.d > geo.L - TERMINAL_M; $('#pDir1').disabled = !!tg && tg.d < TERMINAL_M;
    let where = '';
    if (gps) {
      if (st.gpsMsg) where = st.gpsMsg;
      else if (!st.me) where = t('locating');
      else {
        const near = st.route.stops[nearestStop(geo, st.me.d)].name;
        where = st.me.off > 300 ? t('farRoute', { km: (st.me.off / 1000).toFixed(1), stop: near }) : t('nearRoute', { stop: near, m: Math.round(st.me.off) });
      }
    }
    $('#pWhere').textContent = where;
    $('#pWhere').hidden = !gps;
    mapCtl.selectStop(gps ? -1 : st.stop, st.route);
  }

  function setMode(mode) {
    st.mode = mode; store('dv-mode', mode);
    clearNotify();
    if (mode === 'gps') startGps(); else stopGps();
    renderPlace(); renderNext(); if (st.wait.on) sendWaiting();
  }

  function startGps() {
    if (st.watch !== null) return;
    if (!('geolocation' in navigator)) { st.gpsMsg = t('gpsNone'); return; }
    st.gpsMsg = '';
    st.watch = navigator.geolocation.watchPosition((pos) => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      const { d, off } = geo.project(lat, lng);
      const first = !st.me;
      st.me = { lat, lng, accuracy, d, off };
      st.gpsMsg = '';
      mapCtl.setMe(lat, lng, accuracy, { center: !st.centered });
      st.centered = true;
      renderPlace(); renderNext();
      if (st.wait.on && first) sendWaiting();
    }, (err) => {
      st.gpsMsg = err.code === 1 ? t('gpsDenied') : t('gpsNone');
      renderPlace(); renderNext();
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
  }

  function stopGps() {
    if (st.watch !== null) navigator.geolocation.clearWatch(st.watch);
    st.watch = null; st.me = null; st.centered = false;
    mapCtl.setMe(null);
  }

  function setRoute(r) {
    st.route = r; store('dv-route', String(r.id));
    geo = makeRoute(r.path, r.stops);
    if (st.stop >= r.stops.length) st.stop = 0;
    $('#pStop').innerHTML = r.stops.map((s, k) => `<option value="${k}">${esc(s.km ? s.km + ' · ' : '')}${esc(s.name)}</option>`).join('');
    $('#pStop').value = st.stop;
    if (user) $('#rUnit').innerHTML = r.units.map((u) => `<option value="${u.id}">${esc(t('unit'))} ${esc(u.number)}</option>`).join('');
    if (mapCtl) mapCtl.setRoute(r); else mapCtl = createMap($('#pMap'), r, { onStopClick: (k) => { selectStop(k); if (st.mode !== 'stop') setMode('stop'); } });
    if (st.me) { const p = geo.project(st.me.lat, st.me.lng); Object.assign(st.me, p); }
    unsub?.();
    st.units = [];
    unsub = subscribe(r.id, {
      snapshot: (s) => { st.units = s.units; mapCtl.setBuses(s.units); mapCtl.setWaiting(s.waiting); renderNext(); },
      status: (ok) => { st.online = ok; $('#pLive').textContent = ok ? `● ${t('live')}` : t('reconnecting'); $('#pLive').classList.toggle('live-on', ok); },
    });
    renderPlace(); renderNext();
  }

  function selectStop(k) {
    st.stop = k; store('dv-stop', String(k));
    $('#pStop').value = k;
    clearNotify();
    renderPlace(); renderNext();
    if (st.wait.on) sendWaiting();
  }

  function setDir(dir) {
    st.dir = dir; store('dv-dir', String(dir));
    clearNotify();
    renderPlace(); renderNext();
    if (st.wait.on) sendWaiting();
  }

  // ---------- Próximas unidades ----------
  const pill = (l) => `<span class="pill ${l}"><i></i>${esc(t(l))}</span>`;
  const accTag = (u) => (u.accessible ? `<span class="acc">♿ ${esc(t('acc'))}</span>` : '');

  function etas() {
    const tg = target();
    if (!tg) return null;
    const dir = effectiveDir(tg.d);
    return st.units.filter((u) => !u.stale && !u.offRoute)
      .map((u) => ({ u, ...etaToPoint(geo, u, tg.d, dir) }))
      .sort((a, b) => a.eta - b.eta);
  }

  function renderNext() {
    const box = $('#pNext');
    const list = etas();
    if (!list) {
      box.innerHTML = `<p class="label">${esc(t('nextBus'))}</p><div class="empty">${esc(st.gpsMsg || t('locating'))}</div>`;
      renderWait();
      return;
    }
    if (!list.length) {
      box.innerHTML = `<p class="label">${esc(t('nextBus'))}</p><div class="empty">${esc(t('noBuses'))}</div>`;
      renderWait();
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
    const atLabel = st.mode === 'gps' ? t('atPoint') : t('atStop');
    box.innerHTML = `
      <p class="label">${esc(t('nextBus'))}</p>
      <div class="next">
        <span class="unit">${esc(t('unit'))} ${esc(n.u.number)}</span>
        <div><div class="eta">${arriving ? esc(t('arriving')) : `${fmtMin(n.eta)}<small>min</small>`}</div>
          <div class="sub">${esc(arriving ? atLabel : t('kmAway', { km: (n.rel / 1000).toFixed(1) }))}${accTag(n.u)}</div></div>
        ${pill(n.u.occ)}
      </div>
      <div class="list">${list.slice(1, 3).map((x) => `<div class="lrow"><span class="unit">${esc(x.u.number)}</span><span><b>${fmtMin(x.eta)} min</b> <span class="sub">· ${(x.rel / 1000).toFixed(1)} km</span>${accTag(x.u)}</span>${pill(x.u.occ)}</div>`).join('')}</div>
      ${a}
      <button type="button" class="ghost" id="pNotify" aria-pressed="${!!st.notify}">${esc(st.notify ? t('notifyOn', { u: st.notify.number }) : t('notify'))}</button>
      <p class="sub" style="margin:0">${esc(list.length === 1 ? t('freq1') : t('freq', { n: list.length }))}</p>`;
    $('#pNotify').onclick = toggleNotify;
    checkNotify(list);
    renderWait();
  }

  function clearNotify() {
    if (st.notify?.push) api('/push/cancel', { method: 'POST', body: { id: waitId() } }).catch(() => {});
    st.notify = null;
  }

  async function toggleNotify() {
    if (st.notify) { clearNotify(); renderNext(); return; }
    const list = etas() || [];
    const c = list.find((x) => x.eta > 180) || list[0];
    const tg = target();
    if (!c || !tg) return;
    st.notify = { id: c.u.id, number: c.u.number, push: false };
    renderNext();
    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch { /* el navegador no lo permite */ }
    }
    if (pushSupported() && Notification.permission === 'granted') {
      try {
        const subscription = await pushSubscription();
        if (subscription && st.notify?.id === c.u.id) {
          await api('/push/watch', { method: 'POST', body: {
            id: waitId(), subscription, routeId: st.route.id, d: tg.d, dir: effectiveDir(tg.d), unitId: c.u.id, minutes: 3, label: tg.label,
          } });
          st.notify.push = true;
          toast(t('pushOn'));
        }
      } catch { /* sin push: el aviso sigue funcionando con la app abierta */ }
    } else if (IOS && !STANDALONE && !NATIVE) toast(t('pushIos'), 15000);
    else if ('Notification' in window && Notification.permission === 'denied') toast(t('pushDenied'));
  }

  function checkNotify(list) {
    if (!st.notify) return;
    const x = list.find((y) => y.u.id === st.notify.id);
    if (!x) return;
    if (x.eta <= 180) {
      const msg = t('notifyMsg', { u: st.notify.number, s: target()?.label || '' });
      const viaPush = st.notify.push;
      st.notify = null; // si era push, el servidor manda la notificación
      toast(msg, 15000);
      if (!viaPush && 'Notification' in window && Notification.permission === 'granted') {
        try { new Notification('¿Dónde Viene?', { body: msg, icon: '/icons/icon-192.png' }); } catch { /* algunos navegadores solo permiten avisos desde el service worker */ }
      }
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      renderNext();
    }
  }

  // ---------- "Estoy esperando aquí" ----------
  function renderWait() {
    const btn = $('#pWait');
    if (!btn) return;
    const tg = target();
    btn.disabled = !tg;
    btn.textContent = st.wait.on ? t('waitOn') : t('waitBtn');
    btn.className = st.wait.on ? 'ghost' : 'btn small';
    btn.setAttribute('aria-pressed', st.wait.on);
    $('#pWaitMsg').textContent = st.wait.msg || t('waitHint');
  }

  async function sendWaiting() {
    const tg = target();
    if (!tg) return;
    try {
      const r = await api('/waiting', { method: 'POST', body: { id: waitId(), routeId: st.route.id, lat: tg.lat, lng: tg.lng, dir: effectiveDir(tg.d) } });
      if (r.served) {
        stopWaiting(false);
        st.wait.msg = t('waitServed', { u: r.number });
        toast(st.wait.msg);
      } else st.wait.msg = '';
    } catch (e) {
      if (!e.offline) { stopWaiting(false); st.wait.msg = e.message; }
    }
    renderWait();
  }

  function startWaiting() {
    st.wait.on = true; st.wait.msg = '';
    clearInterval(st.wait.timer);
    st.wait.timer = setInterval(sendWaiting, WAIT_REFRESH_MS);
    sendWaiting();
  }

  function stopWaiting(tellServer = true) {
    st.wait.on = false;
    clearInterval(st.wait.timer);
    if (tellServer) api('/waiting/cancel', { method: 'POST', body: { id: waitId() } }).catch(() => {});
    renderWait();
  }

  // ---------- Eventos ----------
  $('#pModeGps').onclick = () => setMode('gps');
  $('#pModeStop').onclick = () => setMode('stop');
  $('#pStop').onchange = (e) => selectStop(Number(e.target.value));
  $('#pDir0').onclick = () => setDir(0);
  $('#pDir1').onclick = () => setDir(1);
  $('#pWait').onclick = () => { if (st.wait.on) { st.wait.msg = ''; stopWaiting(); } else startWaiting(); };
  $('#pRoute')?.addEventListener('change', (e) => { if (st.wait.on) stopWaiting(); setRoute(routes.find((r) => r.id === Number(e.target.value))); });
  if (user) {
    $$('#rChips .chip').forEach((c) => c.onclick = () => {
      st.reason = c.dataset.r;
      $$('#rChips .chip').forEach((x) => x.setAttribute('aria-pressed', x === c));
    });
    $('#rSend').onclick = async () => {
      const msg = $('#rMsg'); msg.hidden = false;
      if (!st.reason) { msg.className = 'error'; msg.textContent = t('pick'); return; }
      try {
        const tg = target();
        const stopIdx = tg ? tg.stopIdx : st.stop;
        await api('/reports', { method: 'POST', body: { unitId: Number($('#rUnit').value), reason: st.reason, comment: $('#rComment').value, stopId: st.route.stops[stopIdx].id } });
        msg.className = 'okmsg'; msg.textContent = t('sent');
        st.reason = null; $('#rComment').value = '';
        $$('#rChips .chip').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      } catch (e) { msg.className = 'error'; msg.textContent = e.message; }
    };
  }

  setRoute(st.route);
  if ($('#pRoute')) $('#pRoute').value = st.route.id;
  if (st.mode === 'gps') { startGps(); renderPlace(); renderNext(); }
  const tick = setInterval(renderNext, 15000);
  return () => {
    clearInterval(tick); stopGps();
    if (st.wait.on) stopWaiting();
    unsub?.(); mapCtl?.destroy();
  };
}
