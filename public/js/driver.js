import { $, $$, api, esc, toast, hhmm, adviceHTML } from './ui.js';
import { createMap, subscribe } from './map.js';

const SEND_EVERY_MS = 5000;

export async function mount(view) {
  const me = await api('/driver/me');
  if (!me.unit) {
    view.innerHTML = `<div class="page"><div class="card"><b>Tu cuenta aún no tiene unidad asignada.</b><span class="sub">Pide a la administración que te asigne tu unidad. Después vuelve a entrar.</span></div></div>`;
    return () => {};
  }

  const st = { shift: me.shift, status: me.status, watch: null, lastSent: 0, pending: null, gps: 'off', wake: null, sending: false };
  let mapCtl, unsub, alertsTimer;

  view.innerHTML = `
  <div class="page">
    <div class="layout">
      <div class="stack" id="dMain"></div>
      <div class="stack sticky">
        <div class="map" id="dMap" role="region" aria-label="Mapa de tu ruta"></div>
      </div>
    </div>
  </div>`;

  mapCtl = createMap($('#dMap'), me.route);
  unsub = subscribe(me.route.id, { snapshot: (s) => mapCtl.setBuses(s.units, { mine: me.unit.id }) });

  // ---------- Pantallas ----------
  function renderStart(summary) {
    $('#dMain').innerHTML = `
      <div class="card">
        <div class="drv-head"><span class="sign">${esc(me.route.code)}</span><div><b>Unidad ${esc(me.unit.number)}</b><div class="sub">${esc(me.route.name)}</div></div></div>
        ${summary ? `<div class="okmsg">Turno terminado: ${summary.km} km y ${summary.trips} vueltas.</div>` : ''}
        <p class="sub" style="margin:0">Al iniciar tu turno la app usa el GPS de tu celular para avisarte a cuánto vas de las otras unidades. Deja la app abierta y el celular cargando.</p>
        <div class="error" id="dErr" hidden></div>
        <button class="btn" id="dStart">Iniciar turno</button>
      </div>`;
    $('#dStart').onclick = startShift;
  }

  function renderLive() {
    $('#dMain').innerHTML = `
      <div class="card">
        <div class="drv-head" style="justify-content:space-between;flex-wrap:wrap">
          <div class="drv-head"><span class="sign">${esc(me.route.code)}</span><div><b>Unidad ${esc(me.unit.number)} · en turno</b><div class="sub" id="dWhere">Esperando GPS…</div></div></div>
          <span class="gps off" id="dGps"><i></i><span>GPS</span></span>
        </div>
        <div class="gaps">
          <div class="gap" id="gA"><span class="label">Adelante</span><span class="big" id="gAt">—</span><span class="sub" id="gAu"></span></div>
          <div class="gap" id="gB"><span class="label">Atrás</span><span class="big" id="gBt">—</span><span class="sub" id="gBu"></span></div>
        </div>
        <div id="dAdvice"></div>
      </div>
      <div class="card">
        <p class="label">¿Cómo vas de pasaje? Toca cuando cambie</p>
        <div class="occ" role="group" aria-label="Ocupación">
          <button type="button" data-l="vacia" aria-pressed="false"><i></i>Vacía</button>
          <button type="button" data-l="media" aria-pressed="false"><i></i>Media</button>
          <button type="button" data-l="llena" aria-pressed="false"><i></i>Llena</button>
        </div>
      </div>
      <div class="card">
        <p class="label">Tu turno hoy</p>
        <div class="stats">
          <div><b id="sKm">0.0</b><span class="sub">km recorridos</span></div>
          <div><b id="sTrips">0</b><span class="sub">vueltas</span></div>
        </div>
      </div>
      <div class="card">
        <p class="label">Avisar a la ruta</p>
        <div class="chips">
          <button type="button" class="chip" data-inc="trafico">Tráfico lento</button>
          <button type="button" class="chip" data-inc="accidente">Accidente</button>
          <button type="button" class="chip" data-inc="falla">Falla mecánica</button>
          <button type="button" class="chip" data-inc="gente">Mucha gente en parada</button>
        </div>
        <ul class="feed" id="dAlerts"></ul>
        <button type="button" class="danger" id="sos">Emergencia</button>
        <div class="confirm" id="sosConfirm" hidden>
          <b>¿Enviar alerta de emergencia a la central con tu ubicación?</b>
          <div class="two"><button type="button" class="danger" id="sosYes">Sí, enviar</button><button type="button" class="ghost" id="sosNo">Cancelar</button></div>
        </div>
      </div>
      <button type="button" class="ghost" id="dEnd">Terminar turno</button>`;

    $$('.occ button').forEach((b) => b.onclick = async () => {
      try { const r = await api('/driver/occupancy', { method: 'POST', body: { level: b.dataset.l } }); st.status = r.status; renderStatus(); }
      catch (e) { toast(e.message); }
    });
    $$('[data-inc]').forEach((c) => c.onclick = async () => {
      try { await api('/driver/incident', { method: 'POST', body: { type: c.dataset.inc } }); toast('Aviso enviado a la ruta.'); loadAlerts(); }
      catch (e) { toast(e.message); }
    });
    $('#sos').onclick = () => { $('#sosConfirm').hidden = false; $('#sos').hidden = true; };
    $('#sosNo').onclick = () => { $('#sosConfirm').hidden = true; $('#sos').hidden = false; };
    $('#sosYes').onclick = async () => {
      try { await api('/driver/incident', { method: 'POST', body: { emergency: true } }); toast('Alerta de emergencia enviada a la central.', 12000); }
      catch (e) { toast('No se pudo enviar: ' + e.message); }
      $('#sosConfirm').hidden = true; $('#sos').hidden = false;
    };
    $('#dEnd').onclick = endShift;
    renderStatus();
    loadAlerts();
  }

  function renderStatus() {
    const s = st.status;
    if (!s || !$('#gAt')) return;
    const gps = $('#dGps');
    gps.className = 'gps ' + st.gps;
    gps.querySelector('span').textContent = st.gps === 'on' ? 'GPS activo' : st.gps === 'weak' ? 'GPS débil' : 'Sin GPS';
    $('#dWhere').textContent = s.hasFix ? `${s.dir === 0 ? '→ ' + me.route.stops.at(-1).name : '← ' + me.route.stops[0].name} · cerca de ${s.nearStop}${s.offRoute ? ' · fuera de la ruta' : ''}` : 'Esperando GPS…';
    const H = s.headwayMin;
    const setGap = (id, g) => {
      $(`#${id}t`).innerHTML = g ? `${g.minutes}<small>min</small>` : '—';
      $(`#${id}u`).textContent = g ? `Unidad ${g.number} · ${g.km} km` : 'Sin unidades en servicio';
      $(`#${id}`).classList.toggle('close', !!g && g.minutes < H * 0.5);
    };
    setGap('gA', s.ahead); setGap('gB', s.behind);
    let a;
    if (!s.hasFix) a = adviceHTML('warn', 'i', 'Buscando tu ubicación', ' Revisa que el GPS esté encendido y que diste permiso de ubicación.');
    else if (!s.ahead) a = adviceHTML('good', '✓', 'Eres la única unidad en servicio', ' Cuando otras unidades inicien turno verás la distancia aquí.');
    else if (s.ahead.minutes < H * 0.5 && (!s.behind || s.behind.minutes > s.ahead.minutes + 2)) a = adviceHTML('bad', '!', `Vas pegado a la ${s.ahead.number}`, ` Espera unos ${Math.max(1, Math.round(((s.behind?.minutes ?? H) - s.ahead.minutes) / 2))} min en la próxima parada para recuperar tu distancia.`);
    else if (s.behind && s.behind.minutes < H * 0.5 && s.ahead.minutes > s.behind.minutes + 2) a = adviceHTML('warn', 'i', `La ${s.behind.number} te viene alcanzando`, ' Sigue avanzando sin detenerte de más.');
    else a = adviceHTML('good', '✓', 'Vas bien espaciado', ` Lo ideal ahora es ~${H} min entre unidades.`);
    $('#dAdvice').innerHTML = a;
    $$('.occ button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.l === s.occ));
    $('#sKm').textContent = s.km.toFixed(1);
    $('#sTrips').textContent = s.trips;
  }

  async function loadAlerts() {
    try {
      const { alerts } = await api('/driver/alerts');
      const ul = $('#dAlerts');
      if (ul) ul.innerHTML = alerts.map((e) => `<li><time>${hhmm(e.created_at)}</time><span class="lv ${e.level}"></span><span>${esc(e.text)}</span><span></span></li>`).join('') || '<li><time></time><span></span><span class="sub">Sin avisos en tu ruta.</span><span></span></li>';
    } catch { /* se reintenta en el siguiente ciclo */ }
  }

  // ---------- GPS ----------
  function startGps() {
    if (!('geolocation' in navigator)) { st.gps = 'off'; toast('Este celular no tiene GPS disponible en el navegador.'); return; }
    st.watch = navigator.geolocation.watchPosition(onFix, (err) => {
      st.gps = 'off'; renderStatus();
      if (err.code === 1) toast('Sin permiso de ubicación. Actívalo en la configuración del navegador para esta página.', 15000);
    }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
    requestWakeLock();
  }

  function stopGps() {
    if (st.watch !== null) navigator.geolocation.clearWatch(st.watch);
    st.watch = null;
    st.wake?.release?.().catch(() => {});
    st.wake = null;
  }

  async function onFix(pos) {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    st.gps = accuracy <= 50 ? 'on' : 'weak';
    st.pending = { lat, lng, accuracy, ts: pos.timestamp || Date.now() };
    if (Date.now() - st.lastSent >= SEND_EVERY_MS) flush();
    else renderStatus();
  }

  async function flush() {
    if (!st.pending || st.sending) return;
    const p = st.pending;
    st.sending = true;
    try {
      const r = await api('/driver/position', { method: 'POST', body: p });
      st.lastSent = Date.now();
      if (st.pending === p) st.pending = null;
      st.status = r.status;
    } catch (e) {
      if (!e.offline) toast(e.message);
    } finally {
      st.sending = false;
      renderStatus();
    }
  }

  async function requestWakeLock() {
    try { if ('wakeLock' in navigator) st.wake = await navigator.wakeLock.request('screen'); } catch { /* la pantalla puede apagarse */ }
  }
  const onVisible = () => { if (document.visibilityState === 'visible' && st.watch !== null) requestWakeLock(); };
  document.addEventListener('visibilitychange', onVisible);

  // ---------- Turno ----------
  async function startShift() {
    const btn = $('#dStart'); btn.disabled = true;
    try {
      const r = await api('/driver/shift/start', { method: 'POST', body: {} });
      st.shift = r.shift; st.status = r.status;
      renderLive(); startGps();
    } catch (e) {
      $('#dErr').textContent = e.message; $('#dErr').hidden = false; btn.disabled = false;
    }
  }

  async function endShift() {
    if (!confirmEnd()) return;
    stopGps();
    try {
      const r = await api('/driver/shift/end', { method: 'POST', body: {} });
      st.shift = null; renderStart(r);
    } catch (e) { toast(e.message); startGps(); }
  }

  // Confirmación dentro de la página (sin diálogos del navegador).
  let endArmed = 0;
  function confirmEnd() {
    if (Date.now() - endArmed < 5000) return true;
    endArmed = Date.now();
    $('#dEnd').textContent = 'Toca otra vez para terminar el turno';
    setTimeout(() => { if ($('#dEnd')) $('#dEnd').textContent = 'Terminar turno'; }, 5000);
    return false;
  }

  const flushTimer = setInterval(() => { if (st.pending && Date.now() - st.lastSent >= SEND_EVERY_MS) flush(); }, 2000);
  alertsTimer = setInterval(() => { if (st.shift) loadAlerts(); }, 20000);

  if (st.shift) { renderLive(); startGps(); } else renderStart();

  return () => {
    stopGps(); clearInterval(flushTimer); clearInterval(alertsTimer);
    document.removeEventListener('visibilitychange', onVisible);
    unsub?.(); mapCtl?.destroy();
  };
}
