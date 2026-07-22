// =========================================================
// Procesos guardados — base de datos de procesos (IndexedDB)
// Un "proceso" es todo el espacio de trabajo de una actividad (ordinaria o
// de recuperación): configuración, estudiantes, currículo, instrumento,
// actividades, refuerzo y fase. Se guarda automáticamente mientras el
// docente trabaja, y puede retomarse días después desde "Mis procesos".
// API: window.Procesos { sync, nuevo, abrir, eliminar, renombrar, listar,
//                        exportAll, importAll }
//      window.ProcesosUI { render }
// =========================================================
(function () {
  'use strict';

  const DB_NAME = 'actas-expediente';
  const STORE = 'procesos';
  const ACTIVO_KEY = 'actas-recuperacion:proceso-activo';

  // Claves de localStorage que componen el espacio de trabajo de un proceso.
  const WS_KEYS = [
    'actas-recuperacion:v1',
    'actas-recuperacion:curriculo:ord:v1',
    'actas-recuperacion:curriculo:rec:v1',
    'actas-recuperacion:instrumento:ord:v1',
    'actas-recuperacion:instrumento:rec:v1',
    'actas-recuperacion:ordinaria:v1',
    'actas-recuperacion:fase',
  ];

  // ---------- IndexedDB (misma BD que el expediente, versión 2) ----------
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('documentos')) db.createObjectStore('documentos', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('procesos')) db.createObjectStore('procesos', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function txDone(tx, db) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    });
  }

  async function dbPut(rec) {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(rec);
    return txDone(tx, db);
  }

  async function dbGet(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(id);
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  async function dbAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => { db.close(); resolve(req.result || []); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  async function dbDel(id) {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    return txDone(tx, db);
  }

  // Vacía por completo el almacén de procesos (usado al "Reemplazar" un respaldo).
  async function dbClear() {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    return txDone(tx, db);
  }

  // ---------- utilidades ----------
  function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
  function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
  function norm(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function getActivoId() { return localStorage.getItem(ACTIVO_KEY) || ''; }
  function setActivoId(id) {
    if (id) localStorage.setItem(ACTIVO_KEY, id);
    else localStorage.removeItem(ACTIVO_KEY);
  }

  function fmtFechaCorta(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }

  function snapshotWorkspace() {
    const data = {};
    WS_KEYS.forEach((k) => {
      const v = localStorage.getItem(k);
      if (v != null) data[k] = v;
    });
    return data;
  }

  function parseKey(data, key) {
    try { return JSON.parse(data[key] || 'null'); } catch (e) { return null; }
  }

  // ¿Hay algo que valga la pena guardar en el espacio de trabajo?
  function workspaceTieneDatos() {
    const data = snapshotWorkspace();
    const p = parseKey(data, 'actas-recuperacion:v1');
    if (p && ((p.estudiantes || []).length || (p.actividades || []).length || (p.configuracion && (p.configuracion.materia || '').trim()) || Object.keys(p.checklist || {}).length)) return true;
    const o = parseKey(data, 'actas-recuperacion:ordinaria:v1');
    if (o && (o.titulo || '').trim()) return true;
    const cr = parseKey(data, 'actas-recuperacion:curriculo:rec:v1');
    if (cr && ((cr.indicadores || []).length || (cr.objetivos || []).length)) return true;
    const co = parseKey(data, 'actas-recuperacion:curriculo:ord:v1');
    if (co && ((co.indicadores || []).length || (co.objetivos || []).length)) return true;
    return false;
  }

  // Resumen para mostrar en "Mis procesos" sin abrir el proceso.
  function resumenDe(data) {
    const r = {};
    const p = parseKey(data, 'actas-recuperacion:v1');
    if (p) {
      const c = p.configuracion || {};
      r.materia = c.materia || '';
      r.grado = c.grado || '';
      r.trimestre = c.trimestre || '';
      r.anio = c.anio || '';
      r.nEstudiantes = (p.estudiantes || []).length;
      r.nombres = (p.estudiantes || []).slice(0, 3).map((e) => (e.name || '').split(' ')[0]).filter(Boolean);
      r.generados = Object.keys(p.generados || {});
    }
    const o = parseKey(data, 'actas-recuperacion:ordinaria:v1');
    if (o) r.tituloOrdinaria = o.titulo || '';
    return r;
  }

  function labelDe(rec) {
    if (rec.nombre) return rec.nombre;
    const r = rec.resumen || {};
    const periodo = [r.trimestre, r.anio].filter(Boolean).join(' ');
    const partes = [r.grado, r.materia, periodo].filter(Boolean);
    if (rec.tipo === 'ordinaria' && r.tituloOrdinaria) partes.push(`«${r.tituloOrdinaria}»`);
    return partes.length ? partes.join(' · ') : 'Proceso nuevo (sin datos aún)';
  }

  // ---------- operaciones ----------
  // Guarda el espacio de trabajo actual dentro del proceso activo. Si no hay
  // proceso activo pero sí hay datos (p. ej. usuarios de versiones anteriores),
  // los adopta creando un proceso automáticamente.
  async function sync() {
    let id = getActivoId();
    if (!id && !workspaceTieneDatos()) return;
    const data = snapshotWorkspace();
    let rec = id ? await dbGet(id) : null;
    if (!rec) {
      id = id || uid();
      const enOrdinaria = location.hash === '#ordinaria';
      rec = { id, tipo: enOrdinaria ? 'ordinaria' : 'recuperacion', nombre: null, creado: new Date().toISOString() };
      setActivoId(id);
    }
    rec.data = data;
    rec.resumen = resumenDe(data);
    rec.actualizado = new Date().toISOString();
    await dbPut(rec);
  }

  // Inicia un proceso nuevo: guarda el actual, limpia el espacio de trabajo
  // y recarga la página en la vista correspondiente, lista para datos nuevos.
  async function nuevo(tipo) {
    try { await sync(); } catch (e) { console.error('No se pudo guardar el proceso actual:', e); }
    WS_KEYS.forEach((k) => localStorage.removeItem(k));
    const id = uid();
    await dbPut({
      id, tipo, nombre: null,
      creado: new Date().toISOString(), actualizado: new Date().toISOString(),
      data: {}, resumen: {},
    });
    setActivoId(id);
    location.hash = '#' + (tipo === 'ordinaria' ? 'ordinaria' : 'recuperacion');
    location.reload();
  }

  // Retoma un proceso guardado: vuelca sus datos al espacio de trabajo y recarga.
  async function abrir(id) {
    try { await sync(); } catch (e) { console.error('No se pudo guardar el proceso actual:', e); }
    const rec = await dbGet(id);
    if (!rec) { alert('No se encontró el proceso.'); return; }
    WS_KEYS.forEach((k) => localStorage.removeItem(k));
    Object.entries(rec.data || {}).forEach(([k, v]) => localStorage.setItem(k, v));
    setActivoId(id);
    location.hash = '#' + (rec.tipo === 'ordinaria' ? 'ordinaria' : 'recuperacion');
    location.reload();
  }

  async function eliminar(id) {
    await dbDel(id);
    if (getActivoId() === id) {
      setActivoId('');
      WS_KEYS.forEach((k) => localStorage.removeItem(k));
      location.reload();
      return;
    }
    render();
  }

  async function renombrar(id) {
    const rec = await dbGet(id);
    if (!rec) return;
    const nombre = prompt('Nombre del proceso:', rec.nombre || labelDe(rec));
    if (nombre === null) return;
    rec.nombre = nombre.trim() || null;
    await dbPut(rec);
    render();
  }

  async function importAll(records) {
    if (!Array.isArray(records) || !records.length) return 0;
    let n = 0;
    for (const rec of records) {
      if (rec && rec.id && rec.data) { await dbPut(rec); n++; }
    }
    return n;
  }

  // Marca/desmarca un proceso como favorito (se guarda en el registro mismo).
  async function toggleFavorito(id) {
    const rec = await dbGet(id);
    if (!rec) return;
    rec.favorito = !rec.favorito;
    await dbPut(rec);
    render();
  }

  // ---------- interfaz: "Mis procesos" en el inicio ----------
  const TIPO_LABEL = { ordinaria: 'Ordinaria', recuperacion: 'Recuperación' };
  const FASES_CHIPS = [
    { key: 'refuerzo', label: 'Refuerzo' },
    { key: 'paquete', label: 'Compromiso' },
    { key: 'cierre', label: 'Cierre' },
  ];

  // Repuebla un <select> de filtro conservando la selección actual si sigue
  // existiendo entre los nuevos valores (mismo patrón que Expedientes).
  function fillSelectOptions(select, values) {
    if (!select) return;
    const current = select.value;
    const first = select.querySelector('option');
    select.innerHTML = '';
    if (first) select.appendChild(first);
    values.forEach((v) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      select.appendChild(o);
    });
    if (values.includes(current)) select.value = current;
  }

  function leerFiltros() {
    const $ = (id) => document.getElementById(id);
    const fav = $('mp-filtro-favoritos');
    return {
      q: norm((($('mp-search') || {}).value || '').trim()),
      tipo: ($('mp-filtro-tipo') || {}).value || '',
      grado: ($('mp-filtro-grado') || {}).value || '',
      trimestre: ($('mp-filtro-trimestre') || {}).value || '',
      soloFav: !!(fav && fav.classList.contains('active')),
    };
  }

  function pasaFiltros(rec, f) {
    if (f.soloFav && !rec.favorito) return false;
    if (f.tipo && rec.tipo !== f.tipo) return false;
    const r = rec.resumen || {};
    if (f.grado && r.grado !== f.grado) return false;
    if (f.trimestre && r.trimestre !== f.trimestre) return false;
    if (f.q) {
      const texto = norm([labelDe(rec), r.materia, r.grado, r.trimestre, r.anio, (r.nombres || []).join(' ')].filter(Boolean).join(' '));
      if (!texto.includes(f.q)) return false;
    }
    return true;
  }

  async function render() {
    const wrap = document.getElementById('mis-procesos');
    const list = document.getElementById('mis-procesos-list');
    if (!wrap || !list) return;

    let procesos = [];
    try { procesos = await dbAll(); }
    catch (e) { console.error('No se pudieron leer los procesos:', e); return; }

    procesos.sort((a, b) => (b.actualizado || '').localeCompare(a.actualizado || ''));
    wrap.classList.toggle('hidden', !procesos.length);

    // Opciones de grado/período según lo que exista realmente guardado.
    const grados = [...new Set(procesos.map((p) => (p.resumen || {}).grado).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const trimestres = [...new Set(procesos.map((p) => (p.resumen || {}).trimestre).filter(Boolean))];
    fillSelectOptions(document.getElementById('mp-filtro-grado'), grados);
    fillSelectOptions(document.getElementById('mp-filtro-trimestre'), trimestres);

    const f = leerFiltros();
    const visibles = procesos.filter((rec) => pasaFiltros(rec, f));

    const countEl = document.getElementById('mis-procesos-count');
    if (!procesos.length) countEl.textContent = '';
    else if (visibles.length !== procesos.length) countEl.textContent = `${visibles.length} de ${procesos.length} procesos`;
    else countEl.textContent = `${procesos.length} proceso${procesos.length === 1 ? '' : 's'}`;

    list.innerHTML = '';
    if (!procesos.length) return;
    if (!visibles.length) {
      list.innerHTML = '<p class="text-sm text-slate text-center py-6">Ningún proceso coincide con la búsqueda o los filtros.</p>';
      return;
    }

    const activoId = getActivoId();

    visibles.forEach((rec) => {
      const r = rec.resumen || {};
      const esActivo = rec.id === activoId;
      const esFav = !!rec.favorito;
      const row = document.createElement('div');
      row.className = 'proceso-row';

      const fases = rec.tipo === 'recuperacion'
        ? `<span class="fase-chip">${FASES_CHIPS.map((f2) => {
            const ok = (r.generados || []).includes(f2.key);
            return `<span class="fase-seg ${ok ? 'fase-seg--ok' : 'fase-seg--pendiente'}">${ok ? '✓ ' : ''}${f2.label}</span>`;
          }).join('')}</span>`
        : '';

      const estudiantes = r.nEstudiantes
        ? `${r.nEstudiantes} estudiante${r.nEstudiantes === 1 ? '' : 's'}${r.nombres && r.nombres.length ? ` (${r.nombres.join(', ')}${r.nEstudiantes > r.nombres.length ? '…' : ''})` : ''}`
        : '';

      row.innerHTML = `
        <div class="proceso-main">
          <div class="proceso-titulo-row">
            <button type="button" class="fav-star${esFav ? ' active' : ''}" data-proc="favorito"
              aria-pressed="${esFav ? 'true' : 'false'}" title="${esFav ? 'Quitar de favoritos' : 'Marcar como favorito'}">${esFav ? '★' : '☆'}</button>
            <span class="proceso-tipo ${rec.tipo}">${TIPO_LABEL[rec.tipo] || rec.tipo}</span>
            <span class="proceso-nombre">${esc(labelDe(rec))}</span>
            ${esActivo ? '<span class="proceso-activo-chip">EN USO</span>' : ''}
          </div>
          <div class="proceso-meta">
            ${estudiantes ? `<span>${esc(estudiantes)}</span>` : ''}
            ${fases}
            <span>actualizado ${fmtFechaCorta(rec.actualizado)}</span>
          </div>
        </div>
        <div class="proceso-actions">
          <button type="button" class="exp-btn" data-proc="abrir">${esActivo ? 'Continuar' : 'Retomar'}</button>
          <button type="button" class="exp-btn" data-proc="renombrar" title="Renombrar proceso">✎</button>
          <button type="button" class="exp-btn danger" data-proc="eliminar" title="Eliminar proceso">✕</button>
        </div>`;

      row.querySelector('[data-proc="favorito"]').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorito(rec.id).catch((err) => { console.error(err); alert('No se pudo actualizar el favorito.'); });
      });
      row.querySelector('[data-proc="abrir"]').addEventListener('click', () => abrir(rec.id));
      row.querySelector('[data-proc="renombrar"]').addEventListener('click', () => renombrar(rec.id));
      row.querySelector('[data-proc="eliminar"]').addEventListener('click', () => {
        const aviso = esActivo
          ? `¿Eliminar el proceso EN USO «${labelDe(rec)}»? Se limpiará también el espacio de trabajo. Los expedientes archivados de los estudiantes NO se borran.`
          : `¿Eliminar el proceso «${labelDe(rec)}»? Los expedientes archivados de los estudiantes NO se borran.`;
        if (confirm(aviso)) eliminar(rec.id).catch((e) => { console.error(e); alert('No se pudo eliminar el proceso.'); });
      });

      list.appendChild(row);
    });
  }

  // ---------- filtros y buscador de "Mis procesos" ----------
  function initFiltros() {
    const search = document.getElementById('mp-search');
    if (!search) return; // esta vista no incluye la barra de filtros
    let t;
    search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(render, 200); });
    ['mp-filtro-tipo', 'mp-filtro-grado', 'mp-filtro-trimestre'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', render);
    });
    const favBtn = document.getElementById('mp-filtro-favoritos');
    if (favBtn) {
      favBtn.addEventListener('click', () => {
        const activo = favBtn.classList.toggle('active');
        favBtn.setAttribute('aria-pressed', String(activo));
        render();
      });
    }
  }

  // ---------- auto-guardado ----------
  // Cualquier interacción dentro de las vistas de trabajo re-sincroniza el
  // proceso activo (con retraso, para agrupar cambios). Los módulos internos
  // guardan en localStorage con ~250 ms de debounce, así que 900 ms garantiza
  // capturar el estado ya persistido.
  let syncTimer;
  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { sync().catch((e) => console.error('Auto-guardado del proceso falló:', e)); }, 900);
  }

  ['input', 'change', 'click'].forEach((evt) => {
    document.addEventListener(evt, (e) => {
      if (e.target.closest && (e.target.closest('#view-ordinaria') || e.target.closest('#view-recuperacion') || e.target.closest('#btn-clear-data'))) {
        scheduleSync();
      }
    }, true);
  });

  // Botones "＋ Iniciar nuevo proceso" de las tarjetas del inicio
  document.querySelectorAll('[data-nuevo-proceso]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      nuevo(btn.dataset.nuevoProceso).catch((err) => { console.error(err); alert('No se pudo iniciar el proceso nuevo.'); });
    });
  });

  window.Procesos = { sync, nuevo, abrir, eliminar, renombrar, listar: dbAll, exportAll: dbAll, importAll, clearAll: dbClear, toggleFavorito };
  window.ProcesosUI = { render };

  initFiltros();
  render();
})();
