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
  const TIPO_KEY = 'actas-recuperacion:proceso-activo-tipo';

  function markDriveDirty(reason) {
    if (window.COEducaDrive) window.COEducaDrive.markDirty(reason);
  }

  const WS_KEYS = [
    'actas-recuperacion:v1', 'actas-recuperacion:curriculo:ord:v1', 'actas-recuperacion:curriculo:rec:v1',
    'actas-recuperacion:instrumento:ord:v1', 'actas-recuperacion:instrumento:rec:v1', 'actas-recuperacion:ordinaria:v1', 'actas-recuperacion:fase'
  ];

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

  async function dbPut(rec) { const db = await openDb(); const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(rec); await txDone(tx, db); markDriveDirty('procesos guardados'); return rec; }
  async function dbGet(id) { const db = await openDb(); return new Promise((res, rej) => { const req = db.transaction(STORE).objectStore(STORE).get(id); req.onsuccess = () => { db.close(); res(req.result || null); }; req.onerror = () => { db.close(); rej(req.error); }; }); }
  async function dbDel(id) { const db = await openDb(); const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); await txDone(tx, db); markDriveDirty('procesos guardados'); }
  async function dbClear() { const db = await openDb(); const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).clear(); await txDone(tx, db); markDriveDirty('procesos guardados'); }
  async function dbAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = async () => { 
        const result = req.result || []; db.close(); 
        for (const rec of result) {
          if (rec.tipo === 'ordinaria' && rec.data) {
            const v1 = parseKey(rec.data, 'actas-recuperacion:v1');
            if (v1 && ((v1.estudiantes && v1.estudiantes.length > 0) || (v1.actividades && v1.actividades.length > 0))) {
              rec.tipo = 'recuperacion'; await dbPut(rec);
            }
          }
        }
        resolve(result); 
      };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
  function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
  function norm(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  
  function getActivoId() { return localStorage.getItem(ACTIVO_KEY) || ''; }
  function getActivoTipo() { return localStorage.getItem(TIPO_KEY) || ''; }
  function setActivoId(id, tipo) {
    if (id) { localStorage.setItem(ACTIVO_KEY, id); if (tipo) localStorage.setItem(TIPO_KEY, tipo); } 
    else { localStorage.removeItem(ACTIVO_KEY); localStorage.removeItem(TIPO_KEY); }
  }

  function fmtFechaCorta(iso) {
    if (!iso) return ''; const d = new Date(iso); if (isNaN(d.getTime())) return '';
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }

  function snapshotWorkspace() { const data = {}; WS_KEYS.forEach((k) => { const v = localStorage.getItem(k); if (v != null) data[k] = v; }); return data; }
  function parseKey(data, key) { try { return JSON.parse(data[key] || 'null'); } catch (e) { return null; } }

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

  function resumenDe(data) {
    const r = {}; const p = parseKey(data, 'actas-recuperacion:v1');
    if (p) {
      const c = p.configuracion || {}; r.materia = c.materia || ''; r.grado = c.grado || ''; r.trimestre = c.trimestre || ''; r.anio = c.anio || '';
      r.nEstudiantes = (p.estudiantes || []).length; r.nombres = (p.estudiantes || []).slice(0, 3).map((e) => (e.name || '').split(' ')[0]).filter(Boolean); r.generados = Object.keys(p.generados || {});
    }
    const o = parseKey(data, 'actas-recuperacion:ordinaria:v1'); if (o) r.tituloOrdinaria = o.titulo || '';
    return r;
  }

  function labelDe(rec) {
    if (rec.nombre) return rec.nombre;
    const r = rec.resumen || {}; const periodo = [r.trimestre, r.anio].filter(Boolean).join(' '); const partes = [r.materia, periodo].filter(Boolean);
    if (rec.tipo === 'ordinaria' && r.tituloOrdinaria) partes.push(`«${r.tituloOrdinaria}»`);
    return partes.length ? partes.join(' · ') : 'Proceso nuevo (sin datos aún)';
  }

  async function sync() {
    let id = getActivoId(); let tipo = getActivoTipo();
    const enOrdinaria = location.hash === '#ordinaria'; const enRecuperacion = location.hash === '#recuperacion';
    const currentViewType = enOrdinaria ? 'ordinaria' : (enRecuperacion ? 'recuperacion' : null);
    if (!currentViewType) return; 

    if (id && tipo && tipo !== currentViewType) { id = uid(); tipo = currentViewType; setActivoId(id, tipo); }
    if (!id && !workspaceTieneDatos()) return;

    const data = snapshotWorkspace(); let rec = id ? await dbGet(id) : null;
    // Navegar o pulsar un botón dentro del generador no debe crear una nueva
    // versión del respaldo. Solo actualizamos el proceso si su contenido cambió.
    if (rec && rec.tipo === tipo && JSON.stringify(rec.data || {}) === JSON.stringify(data)) return rec;
    if (!rec) { id = id || uid(); tipo = tipo || currentViewType; rec = { id, tipo, nombre: null, creado: new Date().toISOString() }; setActivoId(id, tipo); }
    
    rec.tipo = tipo; rec.data = data; rec.resumen = resumenDe(data); rec.actualizado = new Date().toISOString();
    await dbPut(rec);
  }

  async function nuevo(tipo) {
    try { await sync(); } catch (e) { console.error('No se pudo guardar el proceso actual:', e); }
    WS_KEYS.forEach((k) => localStorage.removeItem(k));
    const id = uid();
    await dbPut({ id, tipo, nombre: null, creado: new Date().toISOString(), actualizado: new Date().toISOString(), data: {}, resumen: {} });
    setActivoId(id, tipo); location.hash = '#' + tipo; location.reload();
  }

  async function abrir(id) {
    try { await sync(); } catch (e) { console.error('No se pudo guardar el proceso actual:', e); }
    const rec = await dbGet(id); if (!rec) { alert('No se encontró el proceso.'); return; }
    WS_KEYS.forEach((k) => localStorage.removeItem(k));
    Object.entries(rec.data || {}).forEach(([k, v]) => localStorage.setItem(k, v));
    setActivoId(id, rec.tipo); location.hash = '#' + rec.tipo; location.reload();
  }

  async function eliminar(id) {
    await dbDel(id);
    if (window.COEducaDrive && typeof window.COEducaDrive.recordDeletion === 'function') {
      window.COEducaDrive.recordDeletion('procesos', id);
    }
    if (getActivoId() === id) { setActivoId('', ''); WS_KEYS.forEach((k) => localStorage.removeItem(k)); location.reload(); return; }
    render();
  }

  async function renombrar(id) {
    const rec = await dbGet(id); if (!rec) return;
    const nombre = prompt('Nombre del proceso:', rec.nombre || labelDe(rec)); if (nombre === null) return;
    rec.nombre = nombre.trim() || null; await dbPut(rec); render();
  }

  async function importAll(records) {
    if (!Array.isArray(records) || !records.length) return 0; let n = 0;
    for (const rec of records) { if (rec && rec.id && rec.data) { await dbPut(rec); n++; } }
    return n;
  }

  async function toggleFavorito(id) { const rec = await dbGet(id); if (!rec) return; rec.favorito = !rec.favorito; await dbPut(rec); render(); }

  const TIPO_LABEL = { ordinaria: 'Ordinaria', recuperacion: 'Recuperación' };
  const FASES_CHIPS = [{ key: 'refuerzo', label: 'Refuerzo' }, { key: 'paquete', label: 'Recuperación' }, { key: 'cierre', label: 'Cierre' }];

  function fillSelectOptions(select, values) {
    if (!select) return; const current = select.value; const first = select.querySelector('option');
    select.innerHTML = ''; if (first) select.appendChild(first);
    values.forEach((v) => { const o = document.createElement('option'); o.value = v; o.textContent = v; select.appendChild(o); });
    if (values.includes(current)) select.value = current;
  }

  function leerFiltros() {
    const $ = (id) => document.getElementById(id); const fav = $('mp-filtro-favoritos');
    return { q: norm((($('mp-search') || {}).value || '').trim()), tipo: ($('mp-filtro-tipo') || {}).value || '', grado: ($('mp-filtro-grado') || {}).value || '', trimestre: ($('mp-filtro-trimestre') || {}).value || '', soloFav: !!(fav && fav.classList.contains('active')) };
  }

  function pasaFiltros(rec, f) {
    if (f.soloFav && !rec.favorito) return false; if (f.tipo && rec.tipo !== f.tipo) return false;
    const r = rec.resumen || {}; if (f.grado && r.grado !== f.grado) return false; if (f.trimestre && r.trimestre !== f.trimestre) return false;
    if (f.q) { const texto = norm([labelDe(rec), r.materia, r.grado, r.trimestre, r.anio, (r.nombres || []).join(' ')].filter(Boolean).join(' ')); if (!texto.includes(f.q)) return false; }
    return true;
  }

  async function render() {
    const wrap = document.getElementById('mis-procesos'); const list = document.getElementById('mis-procesos-list');
    if (!wrap || !list) return;

    let procesos = []; try { procesos = await dbAll(); } catch (e) { console.error('No se pudieron leer los procesos:', e); return; }
    procesos.sort((a, b) => (b.actualizado || '').localeCompare(a.actualizado || ''));
    wrap.classList.toggle('hidden', !procesos.length);

    const grados = [...new Set(procesos.map((p) => (p.resumen || {}).grado).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const trimestres = [...new Set(procesos.map((p) => (p.resumen || {}).trimestre).filter(Boolean))];
    fillSelectOptions(document.getElementById('mp-filtro-grado'), grados); fillSelectOptions(document.getElementById('mp-filtro-trimestre'), trimestres);

    const f = leerFiltros(); const visibles = procesos.filter((rec) => pasaFiltros(rec, f));
    const countEl = document.getElementById('mis-procesos-count');
    if (!procesos.length) countEl.textContent = ''; else if (visibles.length !== procesos.length) countEl.textContent = `${visibles.length} de ${procesos.length} procesos`; else countEl.textContent = `${procesos.length} proceso${procesos.length === 1 ? '' : 's'}`;

    list.innerHTML = ''; if (!procesos.length) return;
    if (!visibles.length) { list.innerHTML = '<p class="text-sm text-slate text-center py-6">Ningún proceso coincide con la búsqueda o los filtros.</p>'; return; }

    // Función auxiliar para obtener la imagen de la materia
    function getMateriaThumb(materia) {
      const mapa = {
        'ciencia y tecnologia': 'ciencia-y-tecnologia.webp',
        'ciudadania y valores': 'ciudadania-y-valores.webp',
        'educacion fisica': 'educacion-fisica.webp',
        'ingles': 'ingles.webp',
		'ciencias de la computacion': 'ciencias-computacion.webp',
        'lengua y literatura': 'lengua-y-literatura.webp',
        'matematica y datos': 'matematica-y-datos.webp',
        'precalculo': 'precalculo.webp',
        'proyecto de vida y carrera': 'proyecto-de-vida-y-carrera.webp'
      };
      // Normalizamos el texto (sin tildes y en minúsculas)
      const normal = (materia || '').normalize('NFD').replace(/[\u0300-\u036f]/g, "").toLowerCase();
      
      for (const [clave, archivo] of Object.entries(mapa)) {
        if (normal.includes(clave)) return archivo;
      }
      return 'otra.webp'; // Fallback
    }

    visibles.forEach((rec) => {
      const r = rec.resumen || {}; 
      const esFav = !!rec.favorito; 
      const row = document.createElement('div'); 
      row.className = 'proceso-row';
      
      // Lógica de datos
      const thumbImg = getMateriaThumb(r.materia);
      const gradoTxt = r.grado || 'S/G';
      const gradoCorto = gradoTxt.length > 8 ? gradoTxt.substring(0, 8) + '…' : gradoTxt;
      
      let tituloActividad = rec.nombre;
      if (!tituloActividad) {
         if (rec.tipo === 'ordinaria' && r.tituloOrdinaria) tituloActividad = r.tituloOrdinaria;
         else if (r.materia) tituloActividad = r.materia;
         else tituloActividad = 'Proceso nuevo';
      }

      const listEst = r.nombres && r.nombres.length 
        ? r.nombres.join(', ') + (r.nEstudiantes > r.nombres.length ? ` y ${r.nEstudiantes - r.nombres.length} más` : '') 
        : 'Sin estudiantes agregados';

      // Lógica para la barra de información (Fases o Trimestre)
      let infoBar = '';
      if (rec.tipo === 'recuperacion') {
        infoBar = `<div class="fase-chip-card mt-3">${FASES_CHIPS.map((f2) => { const ok = (r.generados || []).includes(f2.key); return `<span class="fase-seg ${ok ? 'fase-seg--ok' : 'fase-seg--pendiente'}">${ok ? '✓ ' : ''}${f2.label}</span>`; }).join('')}</div>`;
      } else {
        const periodoTxt = r.trimestre || 'Sin periodo asignado';
        infoBar = `<div class="fase-chip-card mt-3"><span class="fase-seg fase-seg--ord">${esc(periodoTxt)}</span></div>`;
      }

      // Nueva estructura HTML de la Card
      row.innerHTML = `
        <div class="proc-card-thumb">
           <img src="procesos-thumbs/${thumbImg}" alt="Miniatura materia" onerror="this.src='procesos-thumbs/otra.webp'">
        </div>
        <div class="proc-card-content">
           <div class="proc-card-header">
              <span class="proc-card-tipo ${rec.tipo}">${TIPO_LABEL[rec.tipo] || rec.tipo}</span>
              <button type="button" class="proc-info-btn" data-proc="info" title="Información adicional">
                 <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
              </button>
           </div>
           <h4 class="proc-card-titulo" title="${esc(tituloActividad)}">${esc(tituloActividad)}</h4>
           
           <div class="proc-card-chips">
              <span class="proc-chip" title="${esc(gradoTxt)}">${esc(gradoCorto)}</span>
              <button type="button" class="proc-chip btn-estudiantes" data-proc="estudiantes" title="Ver estudiantes">
                 <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                 ${r.nEstudiantes || 0}
              </button>
           </div>
           
           ${infoBar}
           
           <div class="proc-card-actions">
              <button type="button" class="proc-btn proc-btn--primary" data-proc="abrir">Retomar</button>
              <button type="button" class="proc-btn proc-btn--icon fav-icon-btn ${esFav ? 'active' : ''}" data-proc="favorito" title="${esFav ? 'Quitar de favoritos' : 'Marcar como favorito'}">${esFav ? '★' : '☆'}</button>
              <button type="button" class="proc-btn proc-btn--icon" data-proc="renombrar" title="Editar nombre">✎</button>
              <button type="button" class="proc-btn proc-btn--icon proc-btn--danger" data-proc="eliminar" title="Eliminar proceso">✕</button>
           </div>
        </div>`;

      // Eventos de los botones de la tarjeta
      row.querySelector('[data-proc="info"]').addEventListener('click', (e) => { 
          e.stopPropagation(); 
          alert(`Periodo / Trimestre: ${r.trimestre || 'No asignado'}\nÚltima actualización: ${fmtFechaCorta(rec.actualizado)}`); 
      });
      row.querySelector('[data-proc="estudiantes"]').addEventListener('click', (e) => { 
          e.stopPropagation(); 
          alert(`Listado de estudiantes:\n\n${listEst}`); 
      });
      row.querySelector('[data-proc="favorito"]').addEventListener('click', (e) => { e.stopPropagation(); toggleFavorito(rec.id).catch((err) => { console.error(err); alert('No se pudo actualizar el favorito.'); }); });
      row.querySelector('[data-proc="abrir"]').addEventListener('click', () => abrir(rec.id));
      row.querySelector('[data-proc="renombrar"]').addEventListener('click', () => renombrar(rec.id));
      row.querySelector('[data-proc="eliminar"]').addEventListener('click', () => {
        const aviso = `¿Eliminar el proceso «${labelDe(rec)}»? Los expedientes archivados de los estudiantes NO se borran.`;
        if (confirm(aviso)) eliminar(rec.id).catch((e) => { console.error(e); alert('No se pudo eliminar el proceso.'); });
      });
      
      list.appendChild(row);
    });
  }

  function initFiltros() {
    const search = document.getElementById('mp-search'); if (!search) return; let t;
    search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(render, 200); });
    ['mp-filtro-tipo', 'mp-filtro-grado', 'mp-filtro-trimestre'].forEach((id) => { const el = document.getElementById(id); if (el) el.addEventListener('change', render); });
    const favBtn = document.getElementById('mp-filtro-favoritos');
    if (favBtn) { favBtn.addEventListener('click', () => { const activo = favBtn.classList.toggle('active'); favBtn.setAttribute('aria-pressed', String(activo)); render(); }); }
  }

  let syncTimer;
  function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(() => { sync().catch((e) => console.error('Auto-guardado falló:', e)); }, 200); }

  ['input', 'change', 'click'].forEach((evt) => {
    document.addEventListener(evt, (e) => { if (e.target.closest && (e.target.closest('#view-ordinaria') || e.target.closest('#view-recuperacion') || e.target.closest('#btn-clear-data'))) scheduleSync(); }, true);
  });

  document.querySelectorAll('[data-nuevo-proceso]').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); nuevo(btn.dataset.nuevoProceso).catch((err) => { console.error(err); alert('No se pudo iniciar el proceso nuevo.'); }); });
  });

  window.Procesos = { sync, nuevo, abrir, eliminar, renombrar, listar: dbAll, exportAll: dbAll, importAll, clearAll: dbClear, toggleFavorito };
  window.ProcesosUI = { render };

  initFiltros(); render();
})();
