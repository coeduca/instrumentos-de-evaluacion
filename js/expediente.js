// =========================================================
// Expediente digital del estudiante — IndexedDB (local, sin servidor)
// Cada documento generado se archiva como un registro con todos los datos
// necesarios para volver a producir el PDF/Word idéntico en cualquier momento.
// API: window.Expediente { guardar, listar, eliminar, exportAll, importAll }
//      window.ExpedienteUI { render }
// =========================================================
(function () {
  'use strict';

  const DB_NAME = 'actas-expediente';
  const STORE = 'documentos';

  function openDb() {
    return new Promise((resolve, reject) => {
      // v2: se añadió el almacén 'procesos' (ver js/procesos.js)
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
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

  // Un registro por (estudiante, tipo, materia, período): generar de nuevo
  // el mismo documento actualiza el registro en vez de duplicarlo.
  function buildKey(rec) {
    return [rec.nie || rec.name || 's-n', rec.tipo, rec.materia, rec.trimestre, rec.anio].join('|');
  }

  async function guardar(rec) {
    rec.key = buildKey(rec);
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(rec);
    return txDone(tx, db);
  }

  async function listar() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => { db.close(); resolve(req.result || []); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  async function eliminar(key) {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    return txDone(tx, db);
  }

  async function importAll(records) {
    if (!Array.isArray(records) || !records.length) return 0;
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    let n = 0;
    records.forEach((rec) => {
      if (rec && rec.tipo && rec.payload) {
        rec.key = rec.key || buildKey(rec);
        store.put(rec);
        n++;
      }
    });
    await txDone(tx, db);
    return n;
  }

  window.Expediente = { guardar, listar, eliminar, exportAll: listar, importAll };

  // =========================================================
  // Interfaz — vista "Expedientes de estudiantes"
  // =========================================================
  const TIPO_LABELS = {
    paquete: 'Acta de compromiso + instructivo + instrumento',
    resultado: 'Acta de resultado de recuperación',
    incumplimiento: 'Acta de incumplimiento',
    refuerzo: 'Constancia de refuerzo educativo',
  };

  function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
  function norm(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  function fmtFechaCorta(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }

  function estadoChip(rec) {
    if (rec.tipo === 'incumplimiento') return '<span class="status-badge no-entrego">No entregó</span>';
    if (rec.tipo === 'resultado') {
      const r = rec.payload && rec.payload.est && rec.payload.est.resultado;
      if (!r) return '';
      const ok = r.tipo === 'extraordinaria' ? r.aprobado : r.alcanzaMinima;
      return ok
        ? '<span class="status-badge recupero">Recuperó</span>'
        : '<span class="status-badge no-alcanzo">No alcanzó</span>';
    }
    return '';
  }

  function regenerar(rec, formato) {
    const p = rec.payload || {};
    const fakeState = {
      configuracion: p.config || {},
      actividades: p.actividades || [],
      refuerzo: p.refuerzo || {},
    };
    const logo = (typeof window.AppLogo === 'function') ? window.AppLogo() : null;
    const gen = formato === 'word' ? window.ActasWord : window.ActasPDF;
    const recup = p.recup || { indicadores: [], objetivos: [], instrumento: { tipo: 'ninguno', criterios: [] } };
    const est = p.est || {};
    switch (rec.tipo) {
      case 'paquete': gen.generar(fakeState, [est], logo, recup); break;
      case 'resultado': gen.generarResultado(fakeState, [est], logo, recup); break;
      case 'incumplimiento': gen.generarIncumplimiento(fakeState, [est], logo); break;
      case 'refuerzo': gen.generarRefuerzo(fakeState, [est], logo, recup); break;
      default: alert('Tipo de documento desconocido.');
    }
  }

  const $ = (id) => document.getElementById(id);

  function fillFilter(select, values) {
    const current = select.value;
    const first = select.querySelector('option');
    select.innerHTML = '';
    select.appendChild(first);
    values.forEach((v) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      select.appendChild(o);
    });
    if (values.includes(current)) select.value = current;
  }

  async function render() {
    const list = $('exp-list'), empty = $('exp-empty');
    if (!list) return;

    let docs = [];
    try { docs = await listar(); }
    catch (e) {
      console.error('No se pudo leer el expediente:', e);
      list.innerHTML = '<p class="text-sm text-alert">No se pudo abrir la base de expedientes en este navegador.</p>';
      return;
    }

    // Poblar filtros con los valores existentes
    const materias = [...new Set(docs.map((d) => d.materia).filter((m) => m && m !== '—'))].sort();
    const periodos = [...new Set(docs.map((d) => `${d.trimestre} ${d.anio}`.trim()).filter((p) => p && p !== '— —'))].sort();
    fillFilter($('exp-filter-materia'), materias);
    fillFilter($('exp-filter-periodo'), periodos);

    const q = norm($('exp-search').value.trim());
    const fMateria = $('exp-filter-materia').value;
    const fPeriodo = $('exp-filter-periodo').value;

    const visibles = docs.filter((d) => {
      if (q && !norm(d.name).includes(q) && !norm(d.nie).includes(q)) return false;
      if (fMateria && d.materia !== fMateria) return false;
      if (fPeriodo && `${d.trimestre} ${d.anio}`.trim() !== fPeriodo) return false;
      return true;
    });

    list.innerHTML = '';
    empty.classList.toggle('hidden', docs.length > 0);
    if (!docs.length) return;

    if (!visibles.length) {
      list.innerHTML = '<p class="text-sm text-slate text-center py-8">Ningún expediente coincide con la búsqueda o los filtros.</p>';
      return;
    }

    // Agrupar por estudiante
    const porEstudiante = new Map();
    visibles.forEach((d) => {
      const k = d.nie || d.name;
      if (!porEstudiante.has(k)) porEstudiante.set(k, { name: d.name, nie: d.nie, grade: d.grade, docs: [] });
      porEstudiante.get(k).docs.push(d);
    });

    [...porEstudiante.values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .forEach((st) => {
        const card = document.createElement('details');
        card.className = 'exp-card';
        const n = st.docs.length;
        card.innerHTML = `
          <summary>
            <span>
              <span class="exp-student-name">${esc(st.name || '(sin nombre)')}</span>
              <span class="exp-student-meta block mt-0.5">${esc(st.nie || 'sin NIE')} · ${esc(st.grade || 'sin grado')}</span>
            </span>
            <span class="exp-doc-count">${n} documento${n === 1 ? '' : 's'}</span>
          </summary>`;

        // Agrupar los documentos del estudiante por materia
        const porMateria = new Map();
        st.docs.forEach((d) => {
          if (!porMateria.has(d.materia)) porMateria.set(d.materia, []);
          porMateria.get(d.materia).push(d);
        });

        [...porMateria.entries()]
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'es'))
          .forEach(([materia, mdocs]) => {
            const h = document.createElement('div');
            h.className = 'exp-materia';
            h.textContent = materia === '—' ? 'Sin materia' : materia;
            card.appendChild(h);

            mdocs
              .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
              .forEach((d) => {
                const row = document.createElement('div');
                row.className = 'exp-doc-row';
                row.innerHTML = `
                  <span class="exp-doc-tipo">${esc(TIPO_LABELS[d.tipo] || d.tipo)}</span>
                  ${estadoChip(d)}
                  <span class="exp-doc-meta">${esc(`${d.trimestre} ${d.anio}`.trim())} · archivado ${fmtFechaCorta(d.fecha)}</span>
                  <span class="exp-doc-actions">
                    <button type="button" class="exp-btn" data-exp-action="pdf">PDF</button>
                    <button type="button" class="exp-btn" data-exp-action="word">Word</button>
                    <button type="button" class="exp-btn danger" data-exp-action="delete" title="Eliminar del expediente">✕</button>
                  </span>`;
                row.querySelector('[data-exp-action="pdf"]').addEventListener('click', () => regenerar(d, 'pdf'));
                row.querySelector('[data-exp-action="word"]').addEventListener('click', () => regenerar(d, 'word'));
                row.querySelector('[data-exp-action="delete"]').addEventListener('click', async () => {
                  if (!confirm(`¿Eliminar «${TIPO_LABELS[d.tipo] || d.tipo}» del expediente de ${d.name}? Esta acción no se puede deshacer.`)) return;
                  try { await eliminar(d.key); render(); }
                  catch (e) { console.error(e); alert('No se pudo eliminar el documento.'); }
                });
                card.appendChild(row);
              });
          });

        list.appendChild(card);
      });
  }

  function initFiltros() {
    const search = $('exp-search');
    if (!search) return;
    let t;
    search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(render, 200); });
    $('exp-filter-materia').addEventListener('change', render);
    $('exp-filter-periodo').addEventListener('change', render);
  }

  initFiltros();
  window.ExpedienteUI = { render };
})();
