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

  // En los campos contenteditable, innerText conserva los Enter escritos por
  // el docente. En cambio, al pegar se eliminan únicamente los saltos que trae
  // el portapapeles antes de insertarlo como texto plano.
  function textoEditable(el) {
    return (el.innerText || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ');
  }

  function limpiarSaltosPegados(texto) {
    return String(texto || '')
      .replace(/[ \t]*[\r\n\u2028\u2029]+[ \t]*/g, ' ');
  }

  function insertarTextoEnCursor(el, texto) {
    const seleccion = window.getSelection();
    if (!seleccion || !seleccion.rangeCount || !el.contains(seleccion.anchorNode)) {
      el.appendChild(document.createTextNode(texto));
      return;
    }
    const rango = seleccion.getRangeAt(0);
    rango.deleteContents();
    const nodo = document.createTextNode(texto);
    rango.insertNode(nodo);
    rango.setStartAfter(nodo);
    rango.collapse(true);
    seleccion.removeAllRanges();
    seleccion.addRange(rango);
  }

  function configurarEditable(el, onInput) {
    const actualizar = () => onInput(textoEditable(el));
    el.addEventListener('input', actualizar);
    el.addEventListener('paste', (e) => {
      e.preventDefault();
      const texto = limpiarSaltosPegados((e.clipboardData || window.clipboardData).getData('text/plain'));
      insertarTextoEnCursor(el, texto);
      actualizar();
    });
  }

  // Iconos en línea (heredan el color del texto, así sirven en claro y oscuro)
  const ICON_COPY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"></path></svg>`;
  const ICON_OPEN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M21 14v5a2 2 0 0 1-2-2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"></path></svg>`;
  const ICON_IMPORT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>`;

  const TEMPLATE = `
    <div class="p-6 space-y-5">
      <p class="text-sm text-slate">
        Define el instrumento y los criterios con los que se evaluará la actividad, vinculados a los
        <strong class="text-navy">indicadores de logro</strong> (nums. 8.2.b y 17). No es un trámite adicional:
        forma parte de la propia actividad de evaluación y puede imprimirse en la misma página si es breve.
      </p>
      <div class="flex flex-wrap gap-2">
        <label class="inst-radio"><input type="radio" name="__NAME__" value="ninguno" class="sr-only"> <span>Pendiente de definir</span></label>
        <label class="inst-radio"><input type="radio" name="__NAME__" value="rubrica" class="sr-only"> <span>Rúbrica</span></label>
        <label class="inst-radio"><input type="radio" name="__NAME__" value="cotejo" class="sr-only"> <span>Lista de cotejo</span></label>
      </div>
      <div data-inst="editor" class="hidden space-y-4">
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" data-inst="seed" class="btn-secondary">↧ Sembrar criterios desde los indicadores seleccionados</button>
          <button type="button" data-inst="add-criterio" class="btn-secondary">+ Agregar criterio</button>
          <div class="ml-auto flex items-center gap-2">
          
          <!-- Botón de Importar Rúbrica con el mismo estilo del chip de Apps Script -->
          <button type="button" data-inst="import-btn" class="btn-secondary" style="padding: 4px 8px; display: flex; align-items: center; gap: 4px;" title="Importar rúbrica generada por IA (JSON o TSV)" aria-label="Importar rúbrica generada por IA">
            <span style="width: 16px; height: 16px;">${ICON_IMPORT}</span>
          </button>
          
          <span data-inst="gs-status" class="text-xs text-slate text-right" role="status"></span>
          <div data-inst="gs" class="gs-chip hidden" title="Genera este instrumento en Google Sheets, uno por estudiante">
            <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener noreferrer"
               class="gs-chip-link" title="Abrir Google Apps Script en una pestaña nueva"
               aria-label="Abrir Google Apps Script en una pestaña nueva">
              <img src="apps_script_1x_48dp.png" alt="Google Apps Script" class="gs-chip-logo">
            </a>
            <span class="gs-chip-sep"></span>
            <button type="button" data-inst="gs-copy" class="gs-chip-btn" title="Copiar el código" aria-label="Copiar el código para Google Apps Script">${ICON_COPY}</button>
            <button type="button" data-inst="gs-open" class="gs-chip-btn" title="Ver el código" aria-label="Ver el código">${ICON_OPEN}</button>
          </div>
          </div>
        </div>
        <p data-inst="escala-hint" class="hidden text-xs text-slate">Toca el nombre de un nivel en el encabezado de la tabla para editarlo.</p>
        <div class="overflow-x-auto border border-navy/10 rounded-sm">
          <table data-inst="tabla" class="inst-tabla w-full text-sm"></table>
        </div>
        <p data-inst="empty" class="text-sm text-slate text-center py-2">Agrega criterios o siémbralos desde los indicadores.</p>
      </div>
    </div>
    
    <!-- Modal de Apps Script -->
    <div data-inst="gs-modal" class="modal-overlay hidden">
      <div class="modal-box gs-modal-box">
        <div class="modal-header">
          <span class="flex items-center gap-2">
            <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener noreferrer"
               class="gs-chip-link" title="Abrir Google Apps Script en una pestaña nueva">
              <img src="apps_script_1x_48dp.png" alt="Google Apps Script" class="gs-chip-logo">
            </a>
            Código para Google Apps Script
          </span>
          <button type="button" data-inst="gs-modal-close" class="modal-close" title="Cerrar">✕</button>
        </div>
        <div class="p-5 space-y-3">
          <p class="text-sm text-slate">
            Pega este código en <span class="font-mono text-navy">script.google.com</span> y ejecuta
            <span class="font-mono text-navy">generarTodos</span>: crea en tu Drive
            <strong class="text-navy">un archivo por estudiante</strong>, con la nota calculada automáticamente.
          </p>
          <p data-inst="gs-resumen" class="text-xs text-slate"></p>
          <textarea data-inst="gs-code" class="field-input font-mono text-xs gs-modal-code" readonly spellcheck="false"></textarea>
          <div class="flex items-center justify-end gap-2">
            <button type="button" data-inst="gs-modal-copy" class="btn-secondary">⧉ Copiar código</button>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Modal de Importar Rúbrica -->
    <div data-inst="import-modal" class="modal-overlay hidden">
      <div class="modal-box gs-modal-box">
        <div class="modal-header">
          <span class="flex items-center gap-2">Importar Rúbrica desde IA</span>
          <button type="button" data-inst="import-modal-close" class="modal-close" title="Cerrar">✕</button>
        </div>
        <div class="p-5 space-y-3">
          <div class="flex items-center justify-between">
            <p class="text-sm text-slate">
              Pega aquí el contenido de tu rúbrica (formato <strong>JSON</strong> o <strong>tabla pegada</strong>).
            </p>
            <button type="button" data-inst="import-prompt-btn" class="btn-secondary prompt-copy-btn" title="Copiar prompt" aria-label="Copiar prompt">${ICON_COPY}</button>
          </div>
          <textarea data-inst="import-code" class="field-input font-mono text-xs" style="min-height: 200px;" placeholder='Ejemplo JSON:
[
  {
    "texto": "Criterio 1",
    "desc": ["Excelente", "Muy bueno", "Bueno", "Debe mejorar"]
  }
]
          
O pega directamente las filas de una tabla.'></textarea>
          <div class="flex items-center justify-between gap-2">
            <span data-inst="import-status" class="text-xs text-alert"></span>
            <div class="flex gap-2">
              <button type="button" data-inst="import-modal-cancel" class="btn-secondary">Cancelar</button>
              <button type="button" data-inst="import-modal-done" class="btn-accent">Importar</button>
            </div>
          </div>
        </div>
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

    // ---------- Modal de Importación ----------
    const importModal = q('import-modal');
    const importTextarea = q('import-code');
    const importStatus = q('import-status');
    
    function abrirImportModal() {
      if (inst.tipo !== 'rubrica') {
        alert('La importación está diseñada principalmente para Rúbricas. Asegúrate de estar en modo Rúbrica.');
        rootEl.querySelector(`input[name="${name}"][value="rubrica"]`).click();
      }
      importTextarea.value = '';
      importStatus.textContent = '';
      importModal.classList.remove('hidden');
      importTextarea.focus();
    }
    
    function cerrarImportModal() {
      importModal.classList.add('hidden');
    }
    
    function procesarImportacion() {
      const rawText = importTextarea.value.trim();
      if (!rawText) {
        importStatus.textContent = 'Pega algún contenido primero.';
        return;
      }
      
      let nuevosCriterios = [];
      
      // Intento 1: Parsear como JSON
      try {
        const parsed = JSON.parse(rawText);
        if (Array.isArray(parsed)) {
          parsed.forEach(item => {
            if (item.texto) {
              let desc = Array.isArray(item.desc) ? item.desc : [];
              // Asegurar que tenga el tamaño de la escala actual
              while (desc.length < inst.escala.length) desc.push('');
              desc = desc.slice(0, inst.escala.length);
              
              nuevosCriterios.push({
                texto: item.texto,
                desc: desc
              });
            }
          });
        }
      } catch (e) {
        // Intento 2: Parsear como TSV (Tabla pegada de Excel/Word)
        const lines = rawText.split('\n');
        lines.forEach(line => {
          const cols = line.split('\t').map(c => c.trim());
          if (cols.length > 1) { // Al menos Criterio y 1 descripción
            let texto = cols[0];
            let desc = cols.slice(1);
            
            // Si la tabla pegada trajo encabezados, y la primera fila es "Criterio", ignorar
            if (texto.toLowerCase() === 'criterio') return;
            
            while (desc.length < inst.escala.length) desc.push('');
            desc = desc.slice(0, inst.escala.length);
            
            nuevosCriterios.push({
              texto: texto,
              desc: desc
            });
          }
        });
      }
      
      if (nuevosCriterios.length === 0) {
        importStatus.textContent = 'No se pudo detectar el formato. Usa JSON válido o pega una tabla con columnas separadas por tabulación.';
        return;
      }
      
      if (inst.criterios.length > 0) {
        if (confirm(`Se detectaron ${nuevosCriterios.length} criterios. ¿Quieres reemplazar los criterios actuales? (Cancelar añadirá al final)`)) {
          inst.criterios = nuevosCriterios;
        } else {
          inst.criterios = inst.criterios.concat(nuevosCriterios);
        }
      } else {
        inst.criterios = nuevosCriterios;
      }
      
      renderTabla();
      save();
      cerrarImportModal();
    }

    q('import-btn').addEventListener('click', abrirImportModal);
    q('import-modal-close').addEventListener('click', cerrarImportModal);
    q('import-modal-cancel').addEventListener('click', cerrarImportModal);
    q('import-modal-done').addEventListener('click', procesarImportacion);
    importModal.addEventListener('click', (e) => { if (e.target === importModal) cerrarImportModal(); });

    // Copiar Prompt de IA
    q('import-prompt-btn').addEventListener('click', async () => {
      const promptBtn = q('import-prompt-btn');
      const numEscalas = inst.escala.length;
      const nombresEscalas = inst.escala.map(e => e.label).join(', ');
      
      const promptText = `Genera una rúbrica de evaluación sobre este tema. Debe tener ${numEscalas} escalas (${nombresEscalas}). Devuélvela estrictamente en este formato JSON, sin texto adicional:
[
  {
    "texto": "Nombre del criterio",
    "desc": ["Descripción 1", "Descripción 2", "Descripción 3", "Descripción 4"]
  }
]`;
      
      try {
        await navigator.clipboard.writeText(promptText);
        promptBtn.classList.add('is-copied');
        promptBtn.title = 'Prompt copiado';
        promptBtn.setAttribute('aria-label', 'Prompt copiado');
        setTimeout(() => {
          promptBtn.classList.remove('is-copied');
          promptBtn.title = 'Copiar prompt';
          promptBtn.setAttribute('aria-label', 'Copiar prompt');
        }, 2500);
      } catch (err) {
        alert('No se pudo copiar al portapapeles. Da permisos a tu navegador.');
      }
    });

    // ---------- código para Google Apps Script ----------
    const gsChip = q('gs'), gsCode = q('gs-code'), gsStatus = q('gs-status');
    const gsModal = q('gs-modal'), gsResumen = q('gs-resumen');
    const puedeGenerar = typeof opts.contexto === 'function' && window.AppsScriptGen;
    gsChip.classList.toggle('hidden', !puedeGenerar);

    let gsStatusTimer;
    function estado(msg, ok) {
      gsStatus.textContent = msg;
      gsStatus.classList.toggle('gs-status-ok', ok === true);
      clearTimeout(gsStatusTimer);
      if (msg) gsStatusTimer = setTimeout(() => { gsStatus.textContent = ''; gsStatus.classList.remove('gs-status-ok'); }, 6000);
    }

    // Devuelve el código o null (avisando) si faltan datos.
    function codigoActual() {
      const r = window.AppsScriptGen.generar(inst, opts.contexto());
      if (!r.ok) { estado(''); alert(r.error); return null; }
      return r;
    }

    // Copia al portapapeles; si el navegador no lo permite, deja el código
    // seleccionado en el modal para copiarlo con Ctrl+C.
    async function copiar(r) {
      try {
        await navigator.clipboard.writeText(r.codigo);
        estado(`✓ Copiado · ${r.totalEstudiantes} estudiante${r.totalEstudiantes === 1 ? '' : 's'} · carpeta «${r.carpeta}»`, true);
        return true;
      } catch (e) {
        abrirModal(r);
        gsCode.focus();
        gsCode.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
        estado(ok ? '✓ Copiado' : 'Cópialo con Ctrl+C.', ok);
        return ok;
      }
    }

    function abrirModal(r) {
      gsCode.value = r.codigo;
      gsResumen.textContent =
        `${r.tituloInstrumento} · ${r.totalEstudiantes} archivo${r.totalEstudiantes === 1 ? '' : 's'} en la carpeta «${r.carpeta}»`;
      gsModal.classList.remove('hidden');
    }
    function cerrarModal() { gsModal.classList.add('hidden'); }

    if (puedeGenerar) {
      q('gs-copy').addEventListener('click', () => {
        const r = codigoActual();
        if (r) copiar(r);
      });

      q('gs-open').addEventListener('click', () => {
        const r = codigoActual();
        if (r) abrirModal(r);
      });

      q('gs-modal-copy').addEventListener('click', () => {
        const r = codigoActual();
        if (r) copiar(r);
      });

      q('gs-modal-close').addEventListener('click', cerrarModal);
      gsModal.addEventListener('click', (e) => { if (e.target === gsModal) cerrarModal(); });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (!gsModal.classList.contains('hidden')) cerrarModal();
            if (!importModal.classList.contains('hidden')) cerrarImportModal();
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
      configurarEditable(label, (texto) => { inst.escala[index].label = texto.trim(); save(); });
      const pts = document.createElement('span');
      pts.className = 'inst-escala-pts'; pts.textContent = `(${nivel.puntos})`;
      el.appendChild(label); el.appendChild(pts);
      return el;
    }
    function tdStatic(text) { const el = document.createElement('td'); el.textContent = text; el.className = 'text-center text-slate'; return el; }
    function tdEditable(value, onInput, cls) {
      const el = document.createElement('td'); el.contentEditable = 'true'; el.className = cls || ''; el.textContent = value || '';
      configurarEditable(el, onInput);
      return el;
    }
    function renderTabla() {
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
