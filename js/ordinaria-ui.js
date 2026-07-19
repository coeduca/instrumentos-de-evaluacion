// =========================================================
// Actividad ordinaria — Actividad Integradora / Cotidiana / Prueba
// Genera el instructivo de una actividad de evaluación ordinaria.
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

  const ord = { tipo: 'integradora', ponderacion: 35, titulo: '', instrucciones: '', fechaComunicacion: '' };

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
      ord.ponderacion = (typeof p.ponderacion === 'number') ? p.ponderacion : TIPOS[ord.tipo].ponderacion;
      ord.titulo = p.titulo || '';
      ord.instrucciones = p.instrucciones || '';
      ord.fechaComunicacion = p.fechaComunicacion || '';
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
  if (!titulo) return;

  // ---------- tipo (al cambiar, restablece la ponderación por defecto) ----------
  document.querySelectorAll('input[name="ord-tipo"]').forEach((r) => {
    r.addEventListener('change', () => {
      ord.tipo = r.value;
      ord.ponderacion = TIPOS[r.value].ponderacion;
      if (pond) pond.value = ord.ponderacion;
      updateButtons();
      save();
    });
  });

  // ---------- ponderación editable (negociable) ----------
  if (pond) {
    pond.addEventListener('input', () => {
      const v = parseFloat(pond.value);
      ord.ponderacion = isNaN(v) ? 0 : Math.max(0, Math.min(100, v));
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

  function updateButtons() {
    const ready = !!ord.titulo.trim();
    btnPdf.disabled = !ready;
    btnWord.disabled = !ready;
    if (btnPreview) btnPreview.disabled = !ready;
    hint.textContent = ready
      ? `Se generará el instructivo de: ${TIPOS[ord.tipo].label} (${ord.ponderacion}%).`
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
    }),
  };

  // ---------- init ----------
  load();
  document.querySelectorAll('input[name="ord-tipo"]').forEach((r) => { r.checked = (r.value === ord.tipo); });
  titulo.value = ord.titulo;
  if (pond) pond.value = ord.ponderacion;
  fecha.value = ord.fechaComunicacion;
  editor.innerHTML = ord.instrucciones;
  updateButtons();
})();
