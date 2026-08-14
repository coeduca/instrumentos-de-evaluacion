// =========================================================
// Actividad ordinaria — Actividad Integradora / Cotidiana / Prueba
// Genera la constancia e instructivo de una actividad de evaluación ordinaria.
// Expone window.ActividadOrdinaria.get() para los generadores.
// =========================================================
(function () {
  'use strict';

  const KEY = 'actas-recuperacion:ordinaria:v1';

  // Ponderación oficial (Manual de Evaluación, num. 16, pág. 56)
  const TIPOS = {
    integradora: { label: 'Actividad Integradora', ponderacion: 35 },
    cotidiana: { label: 'Actividad Cotidiana', ponderacion: 35 },
    prueba: { label: 'Prueba', ponderacion: 30 },
  };

  const ord = {
    tipo: 'integradora', ponderacion: 35, titulo: '', instrucciones: '', fechaComunicacion: '',
    tabla: null, imagen: null, instrumentoPaginaSeparada: false,
  };

  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  const save = debounce(() => {
    try { localStorage.setItem(KEY, JSON.stringify(ord)); }
    catch (e) { console.error('No se pudo guardar la actividad ordinaria:', e); }
  }, 250);

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p.tipo && TIPOS[p.tipo]) ord.tipo = p.tipo;
      ord.ponderacion = (typeof p.ponderacion === 'number') ? Math.max(0, Math.min(TIPOS[ord.tipo].ponderacion, p.ponderacion)) : TIPOS[ord.tipo].ponderacion;
      ord.titulo = p.titulo || '';
      ord.instrucciones = p.instrucciones || '';
      ord.fechaComunicacion = p.fechaComunicacion || '';
      ord.tabla = p.tabla && Array.isArray(p.tabla.celdas) ? p.tabla : null;
      ord.imagen = p.imagen && p.imagen.data ? p.imagen : null;
      ord.instrumentoPaginaSeparada = p.instrumentoPaginaSeparada === true;
    } catch (e) { console.error('No se pudo restaurar la actividad ordinaria:', e); }
  }

  const $ = (id) => document.getElementById(id);
  const titulo = $('ord-titulo');
  const fecha = $('ord-fecha-com');
  const editor = $('ord-instrucciones');
  const hint = $('ord-hint');
  const pond = $('ord-ponderacion');
  const btnPdf = $('btn-ordinaria-pdf');
  const btnWord = $('btn-ordinaria-word');
  const btnPreview = $('btn-ordinaria-preview');
  const tableControls = $('ord-table-controls');
  const tableRows = $('ord-table-rows');
  const tableCols = $('ord-table-cols');
  const tableWrapper = $('ord-table-wrapper');
  const tableContainer = $('ord-table-container');
  const imageWrapper = $('ord-image-wrapper');
  const imagePreview = $('ord-image-preview');
  const imageCaption = $('ord-image-caption');
  const instrumentoPaginaSeparada = $('ord-instrumento-pagina-separada');
  if (!titulo) return;

  // ---------- tipo (al cambiar, restablece la ponderación por defecto) ----------
  document.querySelectorAll('input[name="ord-tipo"]').forEach((r) => {
    r.addEventListener('change', () => {
      ord.tipo = r.value;
      ord.ponderacion = TIPOS[r.value].ponderacion;
      if (pond) { pond.max = TIPOS[r.value].ponderacion; pond.value = ord.ponderacion; }
      updateButtons();
      save();
    });
  });

  // ---------- ponderación dentro del porcentaje oficial de la categoría ----------
  if (pond) {
    pond.addEventListener('input', () => {
      const v = parseFloat(pond.value);
      const maximo = TIPOS[ord.tipo].ponderacion;
      ord.ponderacion = isNaN(v) ? 0 : Math.max(0, Math.min(maximo, v));
      if (!isNaN(v) && v > maximo) pond.value = maximo;
      save();
    });
  }

  // ---------- campos ----------
  titulo.addEventListener('input', () => { ord.titulo = titulo.value; updateButtons(); save(); });
  fecha.addEventListener('change', () => { ord.fechaComunicacion = fecha.value; save(); });
  editor.addEventListener('input', () => { ord.instrucciones = editor.innerHTML; save(); });

  // ---------- formato del editor (negrita / cursiva / subrayado) ----------
  document.querySelectorAll('[data-ord-cmd]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      editor.focus();
      document.execCommand(btn.dataset.ordCmd, false, null);
      ord.instrucciones = editor.innerHTML;
      save();
    });
  });

  // ---------- tabla de la actividad ----------
  function renderTable() {
    tableContainer.innerHTML = '';
    if (!ord.tabla || !Array.isArray(ord.tabla.celdas)) {
      tableWrapper.classList.add('hidden');
      return;
    }
    const table = document.createElement('table');
    ord.tabla.celdas.forEach((rowData, r) => {
      const tr = document.createElement('tr');
      rowData.forEach((cellText, c) => {
        const td = document.createElement('td');
        td.contentEditable = 'true';
        td.textContent = cellText || '';
        td.addEventListener('input', () => { ord.tabla.celdas[r][c] = td.textContent; save(); });
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    tableContainer.appendChild(table);
    tableWrapper.classList.remove('hidden');
  }

  $('ord-toggle-table').addEventListener('click', () => tableControls.classList.toggle('hidden'));
  $('ord-create-table').addEventListener('click', () => {
    const filas = Math.max(1, Math.min(20, parseInt(tableRows.value, 10) || 1));
    const columnas = Math.max(1, Math.min(10, parseInt(tableCols.value, 10) || 1));
    ord.tabla = { filas, columnas, celdas: Array.from({ length: filas }, () => Array.from({ length: columnas }, () => '')) };
    tableControls.classList.add('hidden');
    renderTable();
    save();
  });
  $('ord-remove-table').addEventListener('click', () => { ord.tabla = null; renderTable(); save(); });

  // ---------- imagen de la actividad ----------
  const sizeBtns = document.querySelectorAll('[data-ord-image-size]');
  const positionBtns = document.querySelectorAll('[data-ord-image-position]');

  function refreshImage() {
    if (!ord.imagen || !ord.imagen.data) {
      imageWrapper.classList.add('hidden');
      imagePreview.removeAttribute('src');
      return;
    }
    const size = ord.imagen.size || 'medium';
    const position = ['left', 'right'].includes(ord.imagen.position) ? ord.imagen.position : 'default';
    imageWrapper.classList.remove('hidden');
    imagePreview.src = ord.imagen.data;
    imageCaption.value = ord.imagen.caption || '';
    if (window.ActividadMedia) window.ActividadMedia.aplicarTamanoPreview(imagePreview, size);
    sizeBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.ordImageSize === size));
    positionBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.ordImagePosition === position));
  }

  $('ord-add-image').addEventListener('click', () => {
    if (!window.ActividadMedia) return;
    window.ActividadMedia.seleccionarImagen((processed) => {
      ord.imagen = { data: processed.data, w: processed.w, h: processed.h, caption: '', size: 'medium', position: 'default' };
      refreshImage();
      save();
    });
  });
  sizeBtns.forEach((btn) => btn.addEventListener('click', () => {
    if (!ord.imagen) return;
    ord.imagen.size = btn.dataset.ordImageSize;
    refreshImage();
    save();
  }));
  positionBtns.forEach((btn) => btn.addEventListener('click', () => {
    if (!ord.imagen) return;
    ord.imagen.position = btn.dataset.ordImagePosition || 'default';
    refreshImage();
    save();
  }));
  imageCaption.addEventListener('input', () => { if (ord.imagen) { ord.imagen.caption = imageCaption.value; save(); } });
  $('ord-remove-image').addEventListener('click', () => { ord.imagen = null; refreshImage(); save(); });

  instrumentoPaginaSeparada.addEventListener('change', () => {
    ord.instrumentoPaginaSeparada = instrumentoPaginaSeparada.checked;
    save();
  });

  function updateButtons() {
    const ready = !!ord.titulo.trim();
    btnPdf.disabled = !ready;
    btnWord.disabled = !ready;
    if (btnPreview) btnPreview.disabled = !ready;
    hint.textContent = ready
      ? `Se generará la constancia e instructivo de: ${TIPOS[ord.tipo].label} (${ord.ponderacion}%).`
      : 'Escribe un título para habilitar la descarga.';
  }

  // ---------- API pública ----------
  window.ActividadOrdinaria = {
    get: () => ({
      tipo: ord.tipo,
      tipoLabel: TIPOS[ord.tipo].label,
      ponderacion: ord.ponderacion,
      titulo: ord.titulo,
      instrucciones: ord.instrucciones,
      fechaComunicacion: ord.fechaComunicacion,
      tabla: ord.tabla,
      imagen: ord.imagen,
      instrumentoPaginaSeparada: ord.instrumentoPaginaSeparada,
    }),
  };

  // ---------- init ----------
  load();
  document.querySelectorAll('input[name="ord-tipo"]').forEach((r) => { r.checked = (r.value === ord.tipo); });
  titulo.value = ord.titulo;
  if (pond) { pond.max = TIPOS[ord.tipo].ponderacion; pond.value = ord.ponderacion; }
  fecha.value = ord.fechaComunicacion;
  editor.innerHTML = ord.instrucciones;
  instrumentoPaginaSeparada.checked = ord.instrumentoPaginaSeparada;
  renderTable();
  refreshImage();
  updateButtons();
})();
