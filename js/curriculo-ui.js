// =========================================================
// Currículo — buscador de indicadores de logro y objetivos
// Factory reutilizable: createCurriculoPicker(rootEl, storageKey) construye su
// propio DOM (con data-attributes, sin ids globales) y devuelve { get, clear }.
// Permite instanciar selecciones INDEPENDIENTES (ordinaria y recuperación).
// =========================================================
(function () {
  'use strict';

  const CURRICULO = window.CURRICULO || {};

  // ---------- utilidades ----------
  function norm(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`; }

  // ---------- índice plano para búsqueda global (compartido) ----------
  const INDEX = [];
  Object.keys(CURRICULO).forEach((asig) => {
    Object.keys(CURRICULO[asig]).forEach((grado) => {
      CURRICULO[asig][grado].forEach((u) => {
        (u.indicadores || []).forEach((ind) => {
          INDEX.push({
            asignatura: asig, grado, unidad: u.unidad, unidadNombre: u.nombre,
            objetivo: u.objetivo, codigo: ind.codigo, texto: ind.texto, norm: norm(ind.texto),
          });
        });
      });
    });
  });

  const TEMPLATE = `
    <div class="p-6 space-y-5">
      <p class="text-sm text-slate">
        Busca en los programas de estudio oficiales del MINED y selecciona los
        <strong class="text-navy">indicadores de logro</strong> y el
        <strong class="text-navy">objetivo de la unidad</strong>.
      </p>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div><label class="field-label">Asignatura</label>
          <select data-cur="asignatura" class="field-input"><option value="">Seleccionar</option></select></div>
        <div><label class="field-label">Grado / nivel</label>
          <select data-cur="grado" class="field-input" disabled><option value="">Seleccionar</option></select></div>
        <div><label class="field-label">Unidad</label>
          <select data-cur="unidad" class="field-input" disabled><option value="">Seleccionar</option></select></div>
      </div>
      <div>
        <label class="field-label">Buscar indicador por palabra clave</label>
        <input data-cur="search" type="text" autocomplete="off" class="field-input" placeholder="ej. factoriza, ecosistema, oración, greetings…">
        <p class="text-xs text-slate mt-1">Filtra dentro de la asignatura/grado elegidos (o en todo el currículo si no eliges ninguno).</p>
      </div>
      <div data-cur="objetivo-wrap" class="hidden bg-navy-50 border border-navy/10 rounded-sm p-4">
        <div class="flex items-start justify-between gap-3">
          <div><span class="field-label mb-1">Objetivo / competencia de la unidad</span>
            <p data-cur="objetivo-text" class="text-sm text-navy-900"></p></div>
          <button type="button" data-cur="add-objetivo" class="btn-accent shrink-0">+ Usar objetivo</button>
        </div>
      </div>
      <div>
        <div class="flex items-center justify-between mb-2">
          <span class="field-label mb-0">Indicadores de logro</span>
          <div class="flex gap-2">
            <button type="button" data-cur="check-all" class="text-xs text-navy underline underline-offset-2 hover:text-navy-700">Marcar todos</button>
            <span class="text-navy/20">·</span>
            <button type="button" data-cur="add-selected" class="btn-accent">Agregar seleccionados</button>
          </div>
        </div>
        <div data-cur="indicadores" class="border border-navy/10 rounded-sm divide-y divide-navy/5 max-h-72 overflow-y-auto">
          <p class="px-4 py-6 text-sm text-slate text-center">Elige una asignatura, grado y unidad, o escribe una palabra clave.</p>
        </div>
      </div>
      <div class="border-t border-navy/10 pt-4">
        <button type="button" data-cur="toggle-manual" class="text-xs text-navy underline underline-offset-2 hover:text-navy-700">+ Agregar indicador u objetivo manualmente</button>
        <div data-cur="manual" class="hidden mt-3 space-y-2">
          <div class="flex flex-col sm:flex-row gap-2">
            <input data-cur="manual-ind" type="text" class="field-input flex-1" placeholder="Texto del indicador de logro (manual)">
            <button type="button" data-cur="manual-ind-add" class="btn-secondary shrink-0">Agregar indicador</button>
          </div>
          <div class="flex flex-col sm:flex-row gap-2">
            <input data-cur="manual-obj" type="text" class="field-input flex-1" placeholder="Texto del objetivo de aprendizaje (manual)">
            <button type="button" data-cur="manual-obj-add" class="btn-secondary shrink-0">Agregar objetivo</button>
          </div>
        </div>
      </div>
    </div>
    <div class="border-t border-navy/10 bg-paper/60 p-6 space-y-5">
      <div>
        <div class="flex items-center justify-between mb-2">
          <span class="field-label mb-0" data-cur="sel-ind-label">Indicadores de logro seleccionados</span>
          <span data-cur="sel-ind-count" class="text-xs font-mono text-slate">0</span>
        </div>
        <div data-cur="sel-indicadores" class="space-y-1.5"><p class="text-sm text-slate">Aún no has seleccionado indicadores.</p></div>
      </div>
      <div>
        <div class="flex items-center justify-between mb-2">
          <span class="field-label mb-0">Objetivos de aprendizaje seleccionados</span>
          <span data-cur="sel-obj-count" class="text-xs font-mono text-slate">0</span>
        </div>
        <div data-cur="sel-objetivos" class="space-y-1.5"><p class="text-sm text-slate">Aún no has agregado objetivos.</p></div>
      </div>
    </div>`;

  function createCurriculoPicker(rootEl, storageKey, options) {
    options = options || {};
    rootEl.innerHTML = TEMPLATE;
    const q = (sel) => rootEl.querySelector(`[data-cur="${sel}"]`);

    if (options.selLabel) q('sel-ind-label').textContent = options.selLabel;

    const selAsig = q('asignatura'), selGrado = q('grado'), selUnidad = q('unidad');
    const search = q('search'), objWrap = q('objetivo-wrap'), objText = q('objetivo-text');
    const listInd = q('indicadores'), selIndBox = q('sel-indicadores'), selObjBox = q('sel-objetivos');
    const btnAddObjetivo = q('add-objetivo');

    const seleccion = { indicadores: [], objetivos: [] };
    function loadSel() {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        const p = JSON.parse(raw);
        seleccion.indicadores = Array.isArray(p.indicadores) ? p.indicadores : [];
        seleccion.objetivos = Array.isArray(p.objetivos) ? p.objetivos : [];
      } catch (e) { console.error('No se pudo restaurar la selección de currículo:', e); }
    }
    const saveSel = debounce(() => {
      try { localStorage.setItem(storageKey, JSON.stringify(seleccion)); }
      catch (e) { console.error('No se pudo guardar la selección de currículo:', e); }
    }, 250);

    // ---------- selectores ----------
    function fill(select, items, placeholder) {
      select.innerHTML = '';
      const o0 = document.createElement('option'); o0.value = ''; o0.textContent = placeholder; select.appendChild(o0);
      items.forEach((it) => { const o = document.createElement('option'); o.value = it.value; o.textContent = it.label; select.appendChild(o); });
    }
    fill(selAsig, Object.keys(CURRICULO).map((a) => ({ value: a, label: a })), 'Seleccionar');

    selAsig.addEventListener('change', () => {
      const asig = selAsig.value;
      if (!asig) { selGrado.disabled = true; selUnidad.disabled = true; fill(selGrado, [], 'Seleccionar'); fill(selUnidad, [], 'Seleccionar'); renderIndicadores(); return; }
      fill(selGrado, Object.keys(CURRICULO[asig]).map((g) => ({ value: g, label: g })), 'Seleccionar');
      selGrado.disabled = false; selUnidad.disabled = true; fill(selUnidad, [], 'Seleccionar');
      objWrap.classList.add('hidden'); renderIndicadores();
    });
    selGrado.addEventListener('change', () => {
      const asig = selAsig.value, grado = selGrado.value;
      if (!grado) { selUnidad.disabled = true; fill(selUnidad, [], 'Seleccionar'); renderIndicadores(); return; }
      fill(selUnidad, CURRICULO[asig][grado].map((u) => ({ value: String(u.unidad), label: `Unidad ${u.unidad}${u.nombre ? ' · ' + u.nombre : ''}` })), 'Todas las unidades');
      selUnidad.disabled = false; objWrap.classList.add('hidden'); renderIndicadores();
    });
    selUnidad.addEventListener('change', renderIndicadores);
    search.addEventListener('input', debounce(renderIndicadores, 180));

    function currentUnit() {
      const asig = selAsig.value, grado = selGrado.value, u = selUnidad.value;
      if (!asig || !grado || !u) return null;
      return (CURRICULO[asig][grado] || []).find((x) => String(x.unidad) === u) || null;
    }

    function renderIndicadores() {
      const query = norm(search.value.trim());
      const asig = selAsig.value, grado = selGrado.value;
      const unit = currentUnit();
      if (unit && unit.objetivo) { objText.textContent = unit.objetivo; objWrap.classList.remove('hidden'); }
      else objWrap.classList.add('hidden');
      updateObjetivoBtn();

      let rows = [];
      if (query.length >= 2) {
        rows = INDEX.filter((r) => (!asig || r.asignatura === asig) && (!grado || r.grado === grado) && r.norm.includes(query)).slice(0, 200);
      } else if (unit) {
        rows = unit.indicadores.map((ind) => ({ asignatura: asig, grado, unidad: unit.unidad, unidadNombre: unit.nombre, objetivo: unit.objetivo, codigo: ind.codigo, texto: ind.texto }));
      }

      listInd.innerHTML = '';
      if (!rows.length) {
        const p = document.createElement('p');
        p.className = 'px-4 py-6 text-sm text-slate text-center';
        p.textContent = query.length >= 2 ? 'No se encontraron indicadores con esa palabra clave.' : 'Elige una asignatura, grado y unidad, o escribe una palabra clave.';
        listInd.appendChild(p); return;
      }
      rows.forEach((r) => {
        const id = `${r.asignatura}|${r.grado}|${r.codigo}`;
        const already = seleccion.indicadores.some((s) => s.id === id);
        const row = document.createElement('label');
        row.className = 'flex items-start gap-3 px-4 py-2.5 hover:bg-navy-50 cursor-pointer';
        row.innerHTML = `
          <input type="checkbox" class="mt-1 cur-ind-check" ${already ? 'checked disabled' : ''}>
          <span class="text-sm leading-snug">
            <span class="font-mono text-xs text-navy">${esc(r.codigo)}</span>
            <span class="text-navy-900"> ${esc(r.texto)}</span>
            ${query.length >= 2 ? `<span class="block text-xs text-slate mt-0.5">${esc(r.asignatura)} · ${esc(r.grado)} · U${esc(r.unidad)}${r.unidadNombre ? ' ' + esc(r.unidadNombre) : ''}</span>` : ''}
            ${already ? '<span class="text-xs text-ok ml-1">✓ agregado</span>' : ''}
          </span>`;
        row._data = r;
        listInd.appendChild(row);
      });
    }

    q('check-all').addEventListener('click', () => { listInd.querySelectorAll('.cur-ind-check:not(:disabled)').forEach((c) => { c.checked = true; }); });
    q('add-selected').addEventListener('click', () => {
      let added = 0;
      listInd.querySelectorAll('.cur-ind-check:checked:not(:disabled)').forEach((c) => {
        const r = c.closest('label')._data;
        const id = `${r.asignatura}|${r.grado}|${r.codigo}`;
        if (!seleccion.indicadores.some((s) => s.id === id)) {
          seleccion.indicadores.push({ id, codigo: r.codigo, texto: r.texto, asignatura: r.asignatura, grado: r.grado, unidad: r.unidad, unidadNombre: r.unidadNombre, manual: false });
          added++;
        }
      });
      if (added) { saveSel(); renderSeleccion(); renderIndicadores(); }
    });
    function updateObjetivoBtn() {
      const unit = currentUnit();
      const enUso = !!(unit && unit.objetivo && seleccion.objetivos.some((o) => o.texto === unit.objetivo));
      btnAddObjetivo.classList.toggle('is-used', enUso);
      btnAddObjetivo.disabled = enUso;
      btnAddObjetivo.textContent = enUso ? '✓ Objetivo en uso' : '+ Usar objetivo';
    }
    btnAddObjetivo.addEventListener('click', () => { const unit = currentUnit(); if (unit && unit.objetivo) { addObjetivo(unit.objetivo); updateObjetivoBtn(); } });

    q('toggle-manual').addEventListener('click', () => q('manual').classList.toggle('hidden'));
    q('manual-ind-add').addEventListener('click', () => {
      const t = q('manual-ind').value.trim();
      if (!t) { q('manual-ind').focus(); return; }
      seleccion.indicadores.push({ id: uid(), codigo: '—', texto: t, manual: true });
      q('manual-ind').value = ''; saveSel(); renderSeleccion();
    });
    q('manual-obj-add').addEventListener('click', () => {
      const t = q('manual-obj').value.trim();
      if (!t) { q('manual-obj').focus(); return; }
      addObjetivo(t); q('manual-obj').value = '';
    });
    function addObjetivo(texto) {
      const t = (texto || '').trim();
      if (!t || seleccion.objetivos.some((o) => o.texto === t)) return;
      seleccion.objetivos.push({ id: uid(), texto: t }); saveSel(); renderSeleccion();
    }

    function chip(texto, meta, onRemove) {
      const wrap = document.createElement('div');
      wrap.className = 'flex items-start gap-2 bg-white border border-navy/10 rounded-sm px-3 py-2';
      wrap.innerHTML = `<span class="text-sm leading-snug flex-1">${meta ? `<span class="font-mono text-xs text-navy">${esc(meta)}</span> ` : ''}<span class="text-navy-900">${esc(texto)}</span></span>`;
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'text-slate hover:text-alert text-sm shrink-0'; btn.title = 'Quitar'; btn.textContent = '✕';
      btn.addEventListener('click', onRemove);
      wrap.appendChild(btn); return wrap;
    }
    function renderSeleccion() {
      selIndBox.innerHTML = '';
      if (!seleccion.indicadores.length) selIndBox.innerHTML = '<p class="text-sm text-slate">Aún no has seleccionado indicadores.</p>';
      else seleccion.indicadores.forEach((s) => {
        const meta = s.manual ? 'manual' : `${s.codigo}`;
        const sub = s.manual ? '' : ` · ${s.asignatura} ${s.grado}`;
        selIndBox.appendChild(chip(s.texto + '', meta + sub, () => { seleccion.indicadores = seleccion.indicadores.filter((x) => x !== s); saveSel(); renderSeleccion(); renderIndicadores(); }));
      });
      q('sel-ind-count').textContent = String(seleccion.indicadores.length);

      selObjBox.innerHTML = '';
      if (!seleccion.objetivos.length) selObjBox.innerHTML = '<p class="text-sm text-slate">Aún no has agregado objetivos.</p>';
      else seleccion.objetivos.forEach((o) => selObjBox.appendChild(chip(o.texto, '', () => { seleccion.objetivos = seleccion.objetivos.filter((x) => x !== o); saveSel(); renderSeleccion(); updateObjetivoBtn(); })));
      q('sel-obj-count').textContent = String(seleccion.objetivos.length);
      updateObjetivoBtn();
    }

    loadSel(); renderSeleccion(); renderIndicadores();

    return {
      get: () => ({ indicadores: seleccion.indicadores.slice(), objetivos: seleccion.objetivos.map((o) => o.texto) }),
      clear: () => { seleccion.indicadores = []; seleccion.objetivos = []; saveSel(); renderSeleccion(); renderIndicadores(); },
    };
  }

  window.createCurriculoPicker = createCurriculoPicker;
})();
