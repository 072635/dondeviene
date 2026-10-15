import { $, $$, api, esc, toast, hhmm, dateTime, modal } from './ui.js';
import { createMap, subscribe } from './map.js';

const TABS = [['board', 'Tablero'], ['map', 'Mapa'], ['events', 'Avisos'], ['reports', 'Reportes'], ['units', 'Unidades'], ['people', 'Personal'], ['route', 'Ruta']];
const REASON = { no_se_detuvo: 'No se detuvo', manejo_peligroso: 'Manejo peligroso', cobro_incorrecto: 'Cobro incorrecto', sin_aire_sucia: 'Sin aire / sucia', mal_trato: 'Mal trato', otro: 'Otro' };
const OCC = { vacia: 'Vacía', media: 'Media', llena: 'Llena' };

export async function mount(view) {
  const { routes } = await api('/routes');
  const route = routes[0];
  let tab = sessionStorage.getItem('dv-admin-tab') || 'board';
  let mapCtl = null, boardTimer = null;

  view.innerHTML = `
  <div class="page">
    <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}">${l}</button>`).join('')}</div>
    <div id="aView" class="stack"></div>
  </div>`;
  $$('[data-tab]').forEach((b) => b.onclick = () => show(b.dataset.tab));

  // Avisos en vivo para administración (emergencias, incidentes, reportes).
  const unsub = subscribe(route.id, {
    snapshot: (s) => mapCtl?.setBuses(s.units),
    event: (e) => {
      if (e.level === 'crit') toast(`⚠ ${e.text}`, 20000);
      if (tab === 'events') renderEvents();
      if (tab === 'board') renderBoard();
    },
    report: () => { if (tab === 'reports') renderReports(); },
  });

  function show(k) {
    tab = k; sessionStorage.setItem('dv-admin-tab', k);
    $$('[data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === k));
    clearInterval(boardTimer); mapCtl?.destroy(); mapCtl = null;
    ({ board: renderBoard, map: renderMap, events: renderEvents, reports: renderReports, units: renderUnits, people: renderPeople, route: renderRoute })[k]();
    if (k === 'board') boardTimer = setInterval(renderBoard, 5000);
  }

  const fail = (e) => { $('#aView').innerHTML = `<div class="error">${esc(e.message)}</div>`; };

  // ---------- Tablero ----------
  async function renderBoard() {
    let ov;
    try { ov = await api(`/admin/overview?route=${route.id}`); } catch (e) { return fail(e); }
    if (tab !== 'board') return;
    const k = ov.kpis;
    const H = ov.headwayMin;
    const max = Math.max(H * 2, ...ov.pairs.map((p) => p.minutes), 1);
    const pct = (v) => `${(v / max) * 88}%`;
    $('#aView').innerHTML = `
      <div class="card" style="flex-direction:row;justify-content:space-between;align-items:center;flex-wrap:wrap">
        <div class="drv-head"><span class="sign">${esc(ov.route.code)}</span><b>${esc(ov.route.name)}</b></div>
        <label class="check"><input type="checkbox" id="simT" ${ov.simulator ? 'checked' : ''}> Unidades de demostración</label>
      </div>
      <div class="kpis">
        <div class="kpi"><span class="label">Unidades en servicio</span><b>${k.unitsOnline}/${k.totalUnits}</b><span class="sub">con GPS en los últimos 2 min</span></div>
        <div class="kpi ${k.compliance !== null && k.compliance < 60 ? 'alert' : ''}"><span class="label">Cumplimiento de frecuencia</span><b>${k.compliance === null ? '—' : k.compliance + '%'}</b><span class="sub">pares a ${Math.round(H * 0.5)}–${Math.round(H * 1.5)} min</span></div>
        <div class="kpi hl"><span class="label">Km recorridos hoy</span><b>${k.kmToday.toFixed(1)}</b><span class="sub">${k.kmReal.toFixed(1)} km de turnos reales</span></div>
        <div class="kpi"><span class="label">Reportes ciudadanos</span><b>${k.reportsToday}</b><span class="sub">hoy</span></div>
        <div class="kpi ${k.openAlerts ? 'alert' : ''}"><span class="label">Avisos abiertos</span><b>${k.openAlerts}</b><span class="sub">incidentes y emergencias</span></div>
        <div class="kpi"><span class="label">Intervalo ideal</span><b>${H}<small style="font-size:18px"> min</small></b><span class="sub">según unidades en servicio</span></div>
      </div>
      <div class="card">
        <h3 style="font-family:var(--font-display);font-size:21px">Separación entre unidades</h3>
        <p class="sub" style="margin:0">Minutos entre cada unidad y la que va adelante.</p>
        ${ov.pairs.length ? `<div class="bars">${ov.pairs.map((p) => {
          const stc = p.minutes < H * 0.5 ? 'full' : p.minutes > H * 1.5 ? 'mid' : 'ok';
          const word = stc === 'full' ? 'pegadas' : stc === 'mid' ? 'hueco' : 'bien';
          return `<div class="bar" title="Unidad ${esc(p.from)} → ${esc(p.to)}: ${p.minutes} min (${word})"><b>${esc(p.from)} → ${esc(p.to)}</b>
            <div class="track"><div class="band" style="left:${pct(H * 0.5)};width:calc(${pct(H * 1.5)} - ${pct(H * 0.5)})"></div>
            <div class="fill" style="width:max(4px, ${pct(p.minutes)});background:var(--${stc})"></div>
            <span class="val" style="left:calc(${pct(p.minutes)} + 6px)">${Math.round(p.minutes)} · ${word}</span></div></div>`;
        }).join('')}</div>
        <div class="keys"><span><i style="background:var(--ok)"></i>En frecuencia</span><span><i style="background:var(--full)"></i>Pegadas</span><span><i style="background:var(--mid)"></i>Hueco</span><span><i style="background:var(--gold-soft);border:1px solid var(--gold)"></i>Rango aceptable</span></div>`
        : '<div class="empty">Se necesitan al menos 2 unidades en servicio.</div>'}
      </div>
      <div class="card">
        <h3 style="font-family:var(--font-display);font-size:21px">Unidades en servicio</h3>
        ${ov.units.length ? `<div class="tbl"><table>
          <thead><tr><th>Unidad</th><th>Estado</th><th class="n">Km</th><th class="n">Vueltas</th><th>Ocupación</th><th>Última señal</th></tr></thead>
          <tbody>${ov.units.sort((a, b) => a.number.localeCompare(b.number)).map((u) => `<tr>
            <td><span class="unit">${esc(u.number)}</span> ${u.sim ? '<span class="badge demo">demo</span>' : ''}</td>
            <td>${u.stale ? '<span class="pill stale">Sin señal</span>' : `${u.dir === 0 ? '→' : '←'} ${esc(u.nearStop || '')}${u.offRoute ? ' · fuera de ruta' : ''}`}</td>
            <td class="n">${u.km.toFixed(1)}</td><td class="n">${u.trips}</td>
            <td><span class="pill ${u.occ}"><i></i>${OCC[u.occ]}</span></td><td>${hhmm(u.ts)}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">No hay unidades en servicio. Cuando un conductor inicie turno aparecerá aquí.</div>'}
      </div>`;
    $('#simT').onchange = async (e) => {
      try { await api('/admin/simulator', { method: 'POST', body: { on: e.target.checked } }); renderBoard(); } catch (ex) { toast(ex.message); }
    };
  }

  // ---------- Mapa ----------
  function renderMap() {
    $('#aView').innerHTML = `<div class="map" id="aMap" style="height:70vh"></div><p class="sub">Las unidades grises no han enviado señal en más de 2 minutos.</p>`;
    mapCtl = createMap($('#aMap'), route);
    api(`/admin/overview?route=${route.id}`).then((ov) => mapCtl?.setBuses(ov.units)).catch(() => {});
  }

  // ---------- Avisos ----------
  async function renderEvents() {
    let events;
    try { ({ events } = await api('/admin/events?limit=100')); } catch (e) { return fail(e); }
    if (tab !== 'events') return;
    $('#aView').innerHTML = `<div class="card"><h3 style="font-family:var(--font-display);font-size:21px">Avisos de la operación</h3>
      <ul class="feed">${events.map((e) => `<li class="${e.resolved_at ? 'done' : ''}"><time>${hhmm(e.created_at)}</time><span class="lv ${e.level}"></span>
        <span>${esc(e.text)}${e.lat ? ` · <a href="https://www.openstreetmap.org/?mlat=${e.lat}&mlon=${e.lng}#map=17/${e.lat}/${e.lng}" target="_blank" rel="noopener">ver ubicación</a>` : ''}</span>
        ${e.level !== 'info' && !e.resolved_at ? `<button class="ghost" data-res="${e.id}" style="padding:4px 10px">Atendido</button>` : '<span></span>'}</li>`).join('') || '<li><span></span><span></span><span class="sub">Sin avisos.</span><span></span></li>'}</ul></div>`;
    $$('[data-res]').forEach((b) => b.onclick = async () => {
      try { await api(`/admin/events/${b.dataset.res}/resolve`, { method: 'POST', body: {} }); renderEvents(); } catch (e) { toast(e.message); }
    });
  }

  // ---------- Reportes ----------
  async function renderReports() {
    let reports;
    try { ({ reports } = await api('/admin/reports')); } catch (e) { return fail(e); }
    if (tab !== 'reports') return;
    $('#aView').innerHTML = `<div class="card"><h3 style="font-family:var(--font-display);font-size:21px">Reportes ciudadanos</h3>
      ${reports.length ? `<div class="tbl"><table><thead><tr><th>Fecha</th><th>Unidad</th><th>Motivo</th><th>Parada</th><th>Comentario</th><th>Quién</th><th>Estado</th></tr></thead><tbody>
      ${reports.map((r) => `<tr><td>${dateTime(r.created_at)}</td><td><span class="unit">${esc(r.unit_number)}</span></td><td>${esc(REASON[r.reason] || r.reason)}</td>
        <td>${esc(r.stop_name || '—')}</td><td style="white-space:normal;min-width:180px">${esc(r.comment || '')}</td><td>${esc(r.user_name || '')}</td>
        <td><select data-rep="${r.id}" aria-label="Estado del reporte">${['nuevo', 'revisado', 'atendido'].map((s) => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Todavía no hay reportes.</div>'}</div>`;
    $$('[data-rep]').forEach((s) => s.onchange = async () => {
      try { await api(`/admin/reports/${s.dataset.rep}`, { method: 'PATCH', body: { status: s.value } }); toast('Reporte actualizado.'); } catch (e) { toast(e.message); }
    });
  }

  // ---------- Unidades ----------
  async function renderUnits() {
    let units;
    try { ({ units } = await api('/admin/units')); } catch (e) { return fail(e); }
    if (tab !== 'units') return;
    $('#aView').innerHTML = `
      <div class="card"><h3 style="font-family:var(--font-display);font-size:21px">Unidades</h3>
        <div class="tbl"><table><thead><tr><th>Unidad</th><th>Ruta</th><th>Placas</th><th>Rampa</th><th>Activa</th><th>Conductor</th></tr></thead><tbody>
        ${units.map((u) => `<tr><td><span class="unit">${esc(u.number)}</span></td><td>${esc(u.route_code)}</td>
          <td><input data-plate="${u.id}" value="${esc(u.plate || '')}" aria-label="Placas de la unidad ${esc(u.number)}" style="padding:6px 8px;max-width:130px"></td>
          <td><input type="checkbox" data-acc="${u.id}" ${u.accessible ? 'checked' : ''} aria-label="Unidad ${esc(u.number)} con rampa"></td>
          <td><input type="checkbox" data-act="${u.id}" ${u.active ? 'checked' : ''} aria-label="Unidad ${esc(u.number)} activa"></td>
          <td>${esc(u.driver_name || '—')}</td></tr>`).join('')}</tbody></table></div></div>
      <form class="card" id="uForm" novalidate><h3 style="font-family:var(--font-display);font-size:21px">Agregar unidad</h3>
        <div class="form-grid">
          <div class="field"><label class="label" for="uNum">Número</label><input id="uNum" required></div>
          <div class="field"><label class="label" for="uPlate">Placas</label><input id="uPlate"></div>
          <div class="field"><label class="label" for="uRoute">Ruta</label><select id="uRoute">${routes.map((r) => `<option value="${r.id}">${esc(r.code)}</option>`).join('')}</select></div>
          <label class="check"><input type="checkbox" id="uAcc"> Tiene rampa</label>
        </div>
        <div class="error" id="uErr" hidden></div>
        <button class="btn small" type="submit">Agregar unidad</button></form>`;
    const patch = async (id, body) => { try { await api(`/admin/units/${id}`, { method: 'PATCH', body }); toast('Unidad actualizada.'); } catch (e) { toast(e.message); } };
    $$('[data-plate]').forEach((i) => i.onchange = () => patch(i.dataset.plate, { plate: i.value }));
    $$('[data-acc]').forEach((i) => i.onchange = () => patch(i.dataset.acc, { accessible: i.checked }));
    $$('[data-act]').forEach((i) => i.onchange = () => patch(i.dataset.act, { active: i.checked }));
    $('#uForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/admin/units', { method: 'POST', body: { number: $('#uNum').value, plate: $('#uPlate').value, routeId: Number($('#uRoute').value), accessible: $('#uAcc').checked } });
        toast('Unidad agregada.'); renderUnits();
      } catch (ex) { $('#uErr').textContent = ex.message; $('#uErr').hidden = false; }
    };
  }

  // ---------- Personal ----------
  async function renderPeople() {
    let users, units;
    try { [{ users }, { units }] = await Promise.all([api('/admin/users'), api('/admin/units')]); } catch (e) { return fail(e); }
    if (tab !== 'people') return;
    const staff = users.filter((u) => u.role !== 'pasajero'), riders = users.filter((u) => u.role === 'pasajero');
    const unitOpts = (sel) => `<option value="">Sin unidad</option>${units.map((u) => `<option value="${u.id}" ${u.id === sel ? 'selected' : ''}>Unidad ${esc(u.number)}</option>`).join('')}`;
    $('#aView').innerHTML = `
      <div class="card"><h3 style="font-family:var(--font-display);font-size:21px">Conductores y administración</h3>
        <div class="tbl"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Unidad</th><th>Activo</th><th></th></tr></thead><tbody>
        ${staff.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${u.role === 'admin' ? 'Admin' : 'Conductor'}</td>
          <td>${u.role === 'conductor' ? `<select data-unit="${u.id}" aria-label="Unidad de ${esc(u.name)}">${unitOpts(u.unit_id)}</select>` : '—'}</td>
          <td><input type="checkbox" data-active="${u.id}" ${u.active ? 'checked' : ''} aria-label="Cuenta de ${esc(u.name)} activa"></td>
          <td><button class="ghost" data-pw="${u.id}" data-name="${esc(u.name)}" style="padding:5px 10px">Nueva contraseña</button></td></tr>`).join('')}
        </tbody></table></div></div>
      <form class="card" id="pForm" novalidate><h3 style="font-family:var(--font-display);font-size:21px">Dar de alta</h3>
        <div class="form-grid">
          <div class="field"><label class="label" for="pName">Nombre</label><input id="pName"></div>
          <div class="field"><label class="label" for="pEmail">Correo</label><input id="pEmail" type="email"></div>
          <div class="field"><label class="label" for="pPhone">Teléfono</label><input id="pPhone" type="tel"></div>
          <div class="field"><label class="label" for="pPass">Contraseña inicial</label><input id="pPass" type="text" minlength="8"></div>
          <div class="field"><label class="label" for="pRole">Rol</label><select id="pRole"><option value="conductor">Conductor</option><option value="admin">Administración</option></select></div>
          <div class="field"><label class="label" for="pUnit">Unidad</label><select id="pUnit">${unitOpts(null)}</select></div>
        </div>
        <div class="error" id="pErr" hidden></div>
        <button class="btn small" type="submit">Crear cuenta</button>
        <p class="sub" style="margin:0">Entrega al conductor su correo y contraseña inicial; puede cambiarla desde “Mi cuenta”.</p></form>
      <div class="card"><h3 style="font-family:var(--font-display);font-size:21px">Pasajeros registrados</h3>
        <p class="sub" style="margin:0">${riders.length} cuentas</p></div>`;
    const patch = async (id, body, ok) => { try { await api(`/admin/users/${id}`, { method: 'PATCH', body }); toast(ok); } catch (e) { toast(e.message); renderPeople(); } };
    $$('[data-unit]').forEach((s) => s.onchange = () => patch(s.dataset.unit, { unitId: s.value ? Number(s.value) : null }, 'Unidad asignada.'));
    $$('[data-active]').forEach((c) => c.onchange = () => patch(c.dataset.active, { active: c.checked }, c.checked ? 'Cuenta activada.' : 'Cuenta desactivada.'));
    $$('[data-pw]').forEach((b) => b.onclick = () => {
      const m = modal(`<h2 style="font-family:var(--font-display);font-size:24px">Nueva contraseña</h2><p class="sub" style="margin:0">${esc(b.dataset.name)}</p>
        <input id="npw" type="text" minlength="8" aria-label="Nueva contraseña" placeholder="Mínimo 8 caracteres"><div class="error" id="npwErr" hidden></div>
        <div class="two"><button class="ghost" id="npwNo">Cancelar</button><button class="btn small" id="npwOk">Guardar</button></div>`);
      $('#npwNo', m.el).onclick = m.close;
      $('#npwOk', m.el).onclick = async () => {
        try { await api(`/admin/users/${b.dataset.pw}`, { method: 'PATCH', body: { password: $('#npw', m.el).value } }); m.close(); toast('Contraseña cambiada. La persona debe volver a entrar.'); }
        catch (e) { $('#npwErr', m.el).textContent = e.message; $('#npwErr', m.el).hidden = false; }
      };
    });
    $('#pForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/admin/users', { method: 'POST', body: { name: $('#pName').value, email: $('#pEmail').value, phone: $('#pPhone').value, password: $('#pPass').value, role: $('#pRole').value, unitId: $('#pUnit').value ? Number($('#pUnit').value) : null } });
        toast('Cuenta creada.'); renderPeople();
      } catch (ex) { $('#pErr').textContent = ex.message; $('#pErr').hidden = false; }
    };
  }

  // ---------- Ruta ----------
  async function renderRoute() {
    let shifts;
    try { ({ shifts } = await api('/admin/shifts')); } catch (e) { return fail(e); }
    if (tab !== 'route') return;
    const fresh = (await api('/routes')).routes.find((r) => r.id === route.id);
    $('#aView').innerHTML = `
      <div class="card"><h3 style="font-family:var(--font-display);font-size:21px">Paradas de la ${esc(fresh.code)}</h3>
        <p class="sub" style="margin:0">En orden de ida. La primera y la última son las terminales. Trazo actual: ${(fresh.length / 1000).toFixed(1)} km.</p>
        <div class="tbl"><table><thead><tr><th>#</th><th>Nombre</th><th>Km</th><th>Latitud</th><th>Longitud</th><th></th></tr></thead><tbody id="sRows">
        ${fresh.stops.map((s, i) => stopRow(s, i)).join('')}</tbody></table></div>
        <div class="row-actions"><button class="ghost" id="sAdd" type="button">Agregar parada</button><button class="btn small" id="sSave" type="button">Guardar paradas</button></div>
        <div class="error" id="sErr" hidden></div></div>
      <div class="card"><h3 style="font-family:var(--font-display);font-size:21px">Trazo desde un recorrido grabado</h3>
        <p class="sub" style="margin:0">Pide a un conductor que haga una vuelta completa con la app. Luego elige su turno aquí y la ida de ese recorrido se vuelve el trazo de la ruta.</p>
        ${shifts.length ? `<div class="tbl"><table><thead><tr><th>Inicio</th><th>Unidad</th><th>Conductor</th><th class="n">Km</th><th class="n">Puntos GPS</th><th></th></tr></thead><tbody>
        ${shifts.map((s) => `<tr><td>${dateTime(s.started_at)}</td><td><span class="unit">${esc(s.unit_number)}</span></td><td>${esc(s.driver_name)}</td><td class="n">${s.km.toFixed(1)}</td><td class="n">${s.points}</td>
          <td><button class="ghost" data-shift="${s.id}" style="padding:5px 10px" ${s.points < 10 ? 'disabled' : ''}>Usar como trazo</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Todavía no hay turnos grabados.</div>'}</div>`;
    $('#sAdd').onclick = () => { $('#sRows').insertAdjacentHTML('beforeend', stopRow({ name: '', km: '', lat: '', lng: '' }, $$('#sRows tr').length)); bindDel(); };
    const bindDel = () => $$('[data-del]').forEach((b) => b.onclick = () => b.closest('tr').remove());
    bindDel();
    $('#sSave').onclick = async () => {
      const stops = $$('#sRows tr').map((tr) => ({ name: $('[name=n]', tr).value, km: $('[name=k]', tr).value, lat: parseFloat($('[name=la]', tr).value), lng: parseFloat($('[name=lo]', tr).value) }));
      try { await api(`/admin/routes/${route.id}/stops`, { method: 'PUT', body: { stops } }); toast('Paradas guardadas.'); renderRoute(); }
      catch (e) { $('#sErr').textContent = e.message; $('#sErr').hidden = false; }
    };
    $$('[data-shift]').forEach((b) => b.onclick = async () => {
      try { await api(`/admin/routes/${route.id}/path-from-shift`, { method: 'POST', body: { shiftId: Number(b.dataset.shift) } }); toast('Trazo actualizado.'); renderRoute(); }
      catch (e) { toast(e.message); }
    });
  }

  const stopRow = (s, i) => `<tr><td>${i + 1}</td>
    <td><input name="n" value="${esc(s.name)}" aria-label="Nombre de la parada" style="padding:6px 8px;min-width:160px"></td>
    <td><input name="k" value="${esc(s.km || '')}" aria-label="Kilómetro" style="padding:6px 8px;max-width:90px"></td>
    <td><input name="la" value="${s.lat}" inputmode="decimal" aria-label="Latitud" style="padding:6px 8px;max-width:120px"></td>
    <td><input name="lo" value="${s.lng}" inputmode="decimal" aria-label="Longitud" style="padding:6px 8px;max-width:120px"></td>
    <td><button class="ghost" type="button" data-del style="padding:4px 10px" aria-label="Quitar parada">Quitar</button></td></tr>`;

  show(tab);
  return () => { clearInterval(boardTimer); unsub(); mapCtl?.destroy(); };
}
