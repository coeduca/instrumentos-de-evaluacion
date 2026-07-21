// =========================================================
// Instrumento de evaluación — rúbrica o lista de cotejo
// Factory reutilizable: createInstrumento(rootEl, storageKey, getIndicadores, opts)
// construye su propio DOM y devuelve { get }. Instanciable de forma
// independiente (ordinaria y recuperación).
// opts.contexto: función que devuelve los datos (config, actividad,
// estudiantes, indicadores…) para generar el código de Google Apps Script.
// =========================================================
(function () {
  'use strict';

  const ESCALA_DEFAULT = [
    { label: 'Excelente', puntos: 4 },
    { label: 'Muy bueno', puntos: 3 },
    { label: 'Bueno', puntos: 2 },
    { label: 'Debe mejorar', puntos: 1 },
  ];

  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  let counter = 0;

  const TEMPLATE = `
    <div class="p-6 space-y-5">
      <p class="text-sm text-slate">
        Elige el instrumento con el que se evaluará la actividad. Se adjunta como
        <strong class="text-navy">tercera hoja</strong> del documento. Puedes sembrar los criterios
        desde los <strong class="text-navy">indicadores</strong> que seleccionaste arriba.
      </p>
      <div class="flex flex-wrap gap-2">
        <label class="inst-radio"><input type="radio" name="__NAME__" value="ninguno" class="sr-only"> <span>Sin instrumento</span></label>
        <label class="inst-radio"><input type="radio" name="__NAME__" value="rubrica" class="sr-only"> <span>Rúbrica</span></label>
        <label class="inst-radio"><input type="radio" name="__NAME__" value="cotejo" class="sr-only"> <span>Lista de cotejo</span></label>
      </div>
      <div data-inst="editor" class="hidden space-y-4">
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" data-inst="seed" class="btn-secondary">↧ Sembrar criterios desde los indicadores seleccionados</button>
          <button type="button" data-inst="add-criterio" class="btn-secondary">+ Agregar criterio</button>
        </div>
        <p data-inst="escala-hint" class="hidden text-xs text-slate">Toca el nombre de un nivel en el encabezado de la tabla para editarlo.</p>
        <div class="overflow-x-auto border border-navy/10 rounded-sm">
          <table data-inst="tabla" class="inst-tabla w-full text-sm"></table>
        </div>
        <p data-inst="empty" class="text-sm text-slate text-center py-2">Agrega criterios o siémbralos desde los indicadores.</p>
      </div>
      <div data-inst="gs" class="hidden border-t border-navy/10 pt-4 space-y-2">
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" data-inst="gs-copy" class="btn-secondary">⧉ Copiar código para Google Apps Script</button>
          <button type="button" data-inst="gs-toggle" class="text-xs text-navy underline underline-offset-2 hover:text-navy-700">Ver código</button>
          <span data-inst="gs-status" class="text-xs text-slate" role="status"></span>
        </div>
        <p class="text-xs text-slate">
          Copia el código y pégalo en <span class="font-mono">script.google.com</span>: crea en tu Drive
          <strong class="text-navy">un archivo por estudiante</strong> con este instrumento y la nota calculada
          automáticamente. Toma la lista del grado, los criterios, el objetivo y los datos de la actividad.
        </p>
        <textarea data-inst="gs-code" class="hidden field-input font-mono text-xs h-64 whitespace-pre" readonly spellcheck="false"></textarea>
      </div>
    </div>`;

  function createInstrumento(rootEl, storageKey, getIndicadores, opts) {
    opts = opts || {};
    const name = `inst-tipo-${++counter}`;
    rootEl.innerHTML = TEMPLATE.replace(/__NAME__/g, name);
    const q = (sel) => rootEl.querySelector(`[data-inst="${sel}"]`);

    const inst = { tipo: 'ninguno', escala: ESCALA_DEFAULT.map((n) => ({ ...n })), criterios: [] };

    const save = debounce(() => {
      try { localStorage.setItem(storageKey, JSON.stringify(inst)); }
      catch (e) { console.error('No se pudo guardar el instrumento:', e); }
      invalidarCodigo();
    }, 250);
    function load() {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        const p = JSON.parse(raw);
        if (p.tipo) inst.tipo = p.tipo;
        if (Array.isArray(p.escala) && p.escala.length) inst.escala = p.escala;
        if (Array.isArray(p.criterios)) inst.criterios = p.criterios;
      } catch (e) { console.error('No se pudo restaurar el instrumento:', e); }
    }

    const editor = q('editor'), escalaHint = q('escala-hint'), tabla = q('tabla'), empty = q('empty');

    rootEl.querySelectorAll(`input[name="${name}"]`).forEach((r) => {
      r.addEventListener('change', () => { inst.tipo = r.value; syncTipo(); save(); });
    });
    function syncTipo() {
      rootEl.querySelectorAll(`input[name="${name}"]`).forEach((r) => { r.checked = (r.value === inst.tipo); });
      const activo = inst.tipo === 'rubrica' || inst.tipo === 'cotejo';
      editor.classList.toggle('hidden', !activo);
      escalaHint.classList.toggle('hidden', inst.tipo !== 'rubrica');
      if (activo) renderTabla();
    }

    // ---------- código para Google Apps Script ----------
    const gsBox = q('gs'), gsCode = q('gs-code'), gsStatus = q('gs-status'), gsToggle = q('gs-toggle');
    const puedeGenerar = typeof opts.contexto === 'function' && window.AppsScriptGen;
    gsBox.classList.toggle('hidden', !puedeGenerar);

    let gsStatusTimer;
    function estado(msg, ok) {
      gsStatus.textContent = msg;
      gsStatus.classList.toggle('text-green-700', ok === true);
      clearTimeout(gsStatusTimer);
      if (msg) gsStatusTimer = setTimeout(() => { gsStatus.textContent = ''; gsStatus.classList.remove('text-green-700'); }, 6000);
    }

    // Devuelve el código o null (avisando) si faltan datos.
    function codigoActual() {
      const r = window.AppsScriptGen.generar(inst, opts.contexto());
      if (!r.ok) { estado(''); alert(r.error); return null; }
      return r;
    }

    if (puedeGenerar) {
      q('gs-copy').addEventListener('click', async () => {
        const r = codigoActual();
        if (!r) return;
        gsCode.value = r.codigo;
        let copiado = false;
        try {
          await navigator.clipboard.writeText(r.codigo);
          copiado = true;
        } catch (e) {
          // Sin permiso de portapapeles (p. ej. al abrir el archivo con file://):
          // se muestra el código ya seleccionado para copiarlo con Ctrl+C.
          gsCode.classList.remove('hidden');
          gsToggle.textContent = 'Ocultar código';
          gsCode.focus();
          gsCode.select();
          try { copiado = document.execCommand('copy'); } catch (e2) { copiado = false; }
        }
        estado(copiado
          ? `✓ Copiado · ${r.totalEstudiantes} estudiante${r.totalEstudiantes === 1 ? '' : 's'} · carpeta «${r.carpeta}»`
          : 'Selecciona el código de abajo y cópialo con Ctrl+C.', copiado);
      });

      gsToggle.addEventListener('click', () => {
        if (gsCode.classList.contains('hidden')) {
          const r = codigoActual();
          if (!r) return;
          gsCode.value = r.codigo;
          gsCode.classList.remove('hidden');
          gsToggle.textContent = 'Ocultar código';
        } else {
          gsCode.classList.add('hidden');
          gsToggle.textContent = 'Ver código';
        }
      });
    }

    q('seed').addEventListener('click', () => {
      const indicadores = (typeof getIndicadores === 'function' ? getIndicadores() : []) || [];
      const textos = indicadores.map((s) => s.texto).filter(Boolean);
      if (!textos.length) { alert('No hay indicadores seleccionados en el buscador de currículo. Selecciónalos primero.'); return; }
      if (inst.criterios.length && !confirm('Esto reemplazará los criterios actuales con los indicadores seleccionados. ¿Continuar?')) return;
      inst.criterios = textos.map((t) => ({ texto: t, desc: inst.escala.map(() => '') }));
      renderTabla(); save();
    });
    q('add-criterio').addEventListener('click', () => { inst.criterios.push({ texto: '', desc: inst.escala.map(() => '') }); renderTabla(); save(); });

    function th(text) { const el = document.createElement('th'); el.textContent = text; return el; }
    function thEscala(nivel, index) {
      const el = document.createElement('th'); el.className = 'inst-escala-th';
      const label = document.createElement('span');
      label.className = 'inst-escala-label'; label.contentEditable = 'true';
      label.title = 'Editar nombre del nivel'; label.textContent = nivel.label;
      label.addEventListener('input', () => { inst.escala[index].label = label.textContent.trim(); save(); });
      const pts = document.createElement('span');
      pts.className = 'inst-escala-pts'; pts.textContent = `(${nivel.puntos})`;
      el.appendChild(label); el.appendChild(pts);
      return el;
    }
    function tdStatic(text) { const el = document.createElement('td'); el.textContent = text; el.className = 'text-center text-slate'; return el; }
    function tdEditable(value, onInput, cls) {
      const el = document.createElement('td'); el.contentEditable = 'true'; el.className = cls || ''; el.textContent = value || '';
      el.addEventListener('input', () => onInput(el.textContent)); return el;
    }
    // El código mostrado deja de ser válido al tocar los criterios: se colapsa
    // para que nadie copie una versión vieja.
    function invalidarCodigo() {
      if (!gsCode || gsCode.classList.contains('hidden')) return;
      gsCode.classList.add('hidden');
      gsToggle.textContent = 'Ver código';
      estado('El instrumento cambió: vuelve a copiar el código.');
    }

    function renderTabla() {
      invalidarCodigo();
      tabla.innerHTML = '';
      empty.classList.toggle('hidden', inst.criterios.length > 0);
      const thead = document.createElement('thead'); const htr = document.createElement('tr');
      if (inst.tipo === 'rubrica') {
        htr.appendChild(th('Criterio'));
        inst.escala.forEach((n, i) => htr.appendChild(thEscala(n, i)));
        htr.appendChild(th(''));
      } else {
        ['Criterio', 'Sí logra', 'No logra', 'Observaciones', ''].forEach((t) => htr.appendChild(th(t)));
      }
      thead.appendChild(htr); tabla.appendChild(thead);

      const tbody = document.createElement('tbody');
      inst.criterios.forEach((c, idx) => {
        const tr = document.createElement('tr');
        tr.appendChild(tdEditable(c.texto, (v) => { c.texto = v; save(); }, 'font-medium'));
        if (inst.tipo === 'rubrica') {
          if (!Array.isArray(c.desc) || c.desc.length !== inst.escala.length) c.desc = inst.escala.map((_, i) => (c.desc && c.desc[i]) || '');
          inst.escala.forEach((_, ni) => tr.appendChild(tdEditable(c.desc[ni], (v) => { c.desc[ni] = v; save(); }, 'text-xs text-slate')));
        } else {
          tr.appendChild(tdStatic('☐')); tr.appendChild(tdStatic('☐')); tr.appendChild(tdStatic(''));
        }
        const tdDel = document.createElement('td'); tdDel.className = 'text-center';
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'inst-del-row'; btn.title = 'Quitar criterio'; btn.textContent = '✕';
        btn.addEventListener('click', () => { inst.criterios.splice(idx, 1); renderTabla(); save(); });
        tdDel.appendChild(btn); tr.appendChild(tdDel);
        tbody.appendChild(tr);
      });
      tabla.appendChild(tbody);
    }

    load(); syncTipo();

    return {
      get: () => ({
        tipo: inst.tipo,
        escala: inst.escala.map((n) => ({ ...n })),
        criterios: inst.criterios.map((c) => ({ texto: c.texto, desc: (c.desc || []).slice() })),
      }),
    };
  }

  window.createInstrumento = createInstrumento;
})();
