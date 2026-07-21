// =========================================================
// Generador de Actas de Recuperación — lógica de interfaz
// Todo corre en el navegador. Nada se envía a un servidor.
// =========================================================

const STORAGE_KEY = 'actas-recuperacion:v1';
const THEME_KEY = 'actas-recuperacion:theme';

const DEFAULT_CONFIG = {
  institucion: 'Complejo Educativo Cantón Las Ánimas',
  ubicacion: 'San Lorenzo, San Vicente',
  codigo: '12379',
  docente: '',
  materia: '',
  grado: '',
  trimestre: '',
  anio: '2026',
  fechaLimite: '',
  director: 'Román del Tráncito García Amaya',
  evaluador: 'José Eliseo Martínez Rodríguez',
  tipoRecuperacion: 'ordinaria',   // 'ordinaria' (num. 13.1) | 'extraordinaria' (num. 13.2)
  nivelEducativo: '',              // 'basica' (mínima 5.0) | 'media' (mínima 6.0)
  instrumentoMismaPagina: false,   // imprime instructivo + instrumento juntos (sin salto de página)
};

// ---------- Estado central ----------
const state = {
  configuracion: { ...DEFAULT_CONFIG },
  estudiantes: [],   // { id, nie, name, grade, calificacion, entrego, notaRecup, manual }
  actividades: [],   // { id, titulo, instrucciones, tabla }
  refuerzo: { inicio: '', fin: '', descripcion: '' },
  generados: {},     // { refuerzo|paquete|cierre: fecha ISO de última generación }
  checklist: {},     // { <clave del ítem manual>: fecha ISO en que el docente lo marcó }
};

// Nota mínima de aprobación según nivel (Manual, num. 13.2.c y 34 ss.)
const NOTA_MINIMA = { basica: 5, media: 6 };

// Aplica la regla del Manual al resultado de la recuperación de un estudiante.
// Ordinaria (13.1.c): la nota de recuperación sustituye a la original solo si es
// mayor. Extraordinaria (13.2.c): se promedia con el promedio final reprobado;
// si el promedio alcanza la mínima, la nota final es la mínima fija (5/6).
function calcularResultado(est, config) {
  if (est.notaRecup == null || est.notaRecup === '') return null;
  const notaMin = NOTA_MINIMA[config.nivelEducativo] || 5;
  const orig = est.calificacion != null ? Number(est.calificacion) : 0;
  const rec = Number(est.notaRecup);
  const r = {
    tipo: config.tipoRecuperacion === 'extraordinaria' ? 'extraordinaria' : 'ordinaria',
    nivel: config.nivelEducativo || '',
    notaMinima: notaMin,
    notaOriginal: est.calificacion != null ? orig : null,
    notaRecuperacion: rec,
  };
  if (r.tipo === 'extraordinaria') {
    r.promedio = Math.round(((orig + rec) / 2) * 10) / 10;
    r.aprobado = r.promedio >= notaMin;
    r.notaFinal = r.aprobado ? notaMin : orig;
  } else {
    r.sustituye = rec > orig;
    r.notaFinalActividad = Math.max(orig, rec);
    r.alcanzaMinima = r.notaFinalActividad >= notaMin;
  }
  return r;
}

// ---------- Utilidades ----------
function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalize(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---------- Índice de búsqueda de estudiantes (desde students.js) ----------
const STUDENT_INDEX = Object.entries(window.STUDENTS || {}).map(([nie, info]) => ({
  nie,
  name: info.name,
  grade: info.grade,
  normName: normalize(info.name),
}));

// ---------- Persistencia (localStorage) ----------
function saveStateRaw() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    flashSaveIndicator();
  } catch (e) {
    console.error('No se pudo autoguardar:', e);
  }
}
const saveState = debounce(saveStateRaw, 350);

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    Object.assign(state.configuracion, parsed.configuracion || {});
    // Director/a y representante del Equipo de Evaluación son fijos: si el estado
    // guardado los trae vacíos, se repueblan con el valor por defecto.
    if (!state.configuracion.director) state.configuracion.director = DEFAULT_CONFIG.director;
    if (!state.configuracion.evaluador) state.configuracion.evaluador = DEFAULT_CONFIG.evaluador;
    state.estudiantes = Array.isArray(parsed.estudiantes) ? parsed.estudiantes : [];
    state.actividades = Array.isArray(parsed.actividades) ? parsed.actividades : [];
    Object.assign(state.refuerzo, parsed.refuerzo || {});
    Object.assign(state.generados, parsed.generados || {});
    Object.assign(state.checklist, parsed.checklist || {});
  } catch (e) {
    console.error('No se pudo restaurar el estado guardado:', e);
  }
}

let saveIndicatorTimeout;
function flashSaveIndicator() {
  const el = document.getElementById('save-indicator');
  const text = document.getElementById('save-indicator-text');
  text.textContent = 'Guardado';
  el.classList.remove('opacity-0');
  clearTimeout(saveIndicatorTimeout);
  saveIndicatorTimeout = setTimeout(() => el.classList.add('opacity-0'), 1600);
}

// =========================================================
// CONFIGURACIÓN GENERAL
// =========================================================
const CONFIG_FIELD_IDS = {
  institucion: 'cfg-institucion',
  ubicacion: 'cfg-ubicacion',
  codigo: 'cfg-codigo',
  docente: 'cfg-docente',
  materia: 'cfg-materia',
  grado: 'cfg-grado',
  trimestre: 'cfg-trimestre',
  anio: 'cfg-anio',
  fechaLimite: 'cfg-fecha-limite',
  director: 'cfg-director',
  evaluador: 'cfg-evaluador',
  tipoRecuperacion: 'rec-tipo-recup',
  nivelEducativo: 'rec-nivel',
};

const TEACHERS = [
  'Zulma Elizabeth Palacios Pineda',
  'José Eliseo Martínez Rodríguez',
  'Evelin Antonia Galindo de López',
  'Jessica Yamileth Lozano Arias',
  'Nancy Consuelo Meléndez Abarca',
  'Ulices Dagoberto Alfaro',
  'Claudia del Carmen Campos',
  'Victor Valentín Romero Melara',
];

function populateTeacherOptions() {
  const select = document.getElementById('cfg-docente');
  TEACHERS.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });
}

// Orden pedagógico de los grados (los que no estén aquí van al final).
const ORDEN_GRADOS = ['Séptimo', 'Octavo', 'Noveno', 'Primer Año de Bachillerato', 'Segundo Año de Bachillerato'];

function gradosDisponibles() {
  const grados = [...new Set(STUDENT_INDEX.map((s) => s.grade).filter(Boolean))];
  return grados.sort((a, b) => {
    const ia = ORDEN_GRADOS.indexOf(a), ib = ORDEN_GRADOS.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b, 'es');
  });
}

function populateGradeOptions() {
  const select = document.getElementById('cfg-grado');
  if (!select) return;
  gradosDisponibles().forEach((grado) => {
    const opt = document.createElement('option');
    opt.value = grado;
    opt.textContent = grado;
    select.appendChild(opt);
  });
}

// Lista completa del grado, en orden alfabético (así se numera igual que el registro).
function estudiantesDelGrado(grado) {
  if (!grado) return [];
  return STUDENT_INDEX
    .filter((s) => s.grade === grado)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map((s) => ({ nie: s.nie, name: s.name, grade: s.grade }));
}

function bindConfigFields() {
  populateTeacherOptions();
  populateGradeOptions();
  Object.entries(CONFIG_FIELD_IDS).forEach(([key, id]) => {
    const el = document.getElementById(id);
    el.value = state.configuracion[key] || '';
    const onUpdate = () => {
      state.configuracion[key] = el.value;
      // El tipo de recuperación y el nivel cambian el cálculo del estado de cada fila
      if (key === 'tipoRecuperacion' || key === 'nivelEducativo') renderStudents();
      saveState();
    };
    el.addEventListener('input', onUpdate);
    el.addEventListener('change', onUpdate);
  });

  // Interruptor: instructivo + instrumento en la misma página (casilla, no .value)
  const mismaPag = document.getElementById('cfg-instrumento-misma-pagina');
  if (mismaPag) {
    mismaPag.checked = !!state.configuracion.instrumentoMismaPagina;
    mismaPag.addEventListener('change', () => {
      state.configuracion.instrumentoMismaPagina = mismaPag.checked;
      saveState();
    });
  }
}

// =========================================================
// BÚSQUEDA / AUTOCOMPLETADO DE ESTUDIANTES
// =========================================================
const searchInput = document.getElementById('student-search');
const autocompleteList = document.getElementById('autocomplete-list');
const manualAddHint = document.getElementById('manual-add-hint');
const btnAddManual = document.getElementById('btn-add-manual');

let currentMatches = [];
let activeIndex = -1;

function isAlreadyAdded(nie) {
  return state.estudiantes.some((s) => s.nie === nie);
}

function renderAutocomplete(matches) {
  currentMatches = matches;
  activeIndex = -1;
  autocompleteList.innerHTML = '';

  if (matches.length === 0) {
    autocompleteList.classList.add('hidden');
    return;
  }

  matches.forEach((m, i) => {
    const added = isAlreadyAdded(m.nie);
    const item = document.createElement('div');
    item.className = `autocomplete-item${added ? ' already-added' : ''}`;
    item.dataset.index = String(i);
    item.innerHTML = `
      <span class="ac-name">${escapeHtml(m.name)}</span>
      <span class="ac-meta">${escapeHtml(m.grade)} · ${escapeHtml(m.nie)}${added ? ' · agregado' : ''}</span>
    `;
    item.addEventListener('click', () => {
      if (!added) selectStudent(m);
    });
    autocompleteList.appendChild(item);
  });

  autocompleteList.classList.remove('hidden');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function selectStudent(match) {
  state.estudiantes.push({
    id: match.nie,
    nie: match.nie,
    name: match.name,
    grade: match.grade,
    calificacion: null,
    manual: false,
  });
  searchInput.value = '';
  autocompleteList.classList.add('hidden');
  manualAddHint.classList.add('hidden');
  renderStudents();
  saveState();
  searchInput.focus();
}

function addManualStudent(rawName, rawNie = '', rawGrade = '') {
  const name = rawName.trim();
  if (!name) {
    document.getElementById('manual-name').focus();
    return;
  }
  state.estudiantes.push({
    id: uid(),
    nie: rawNie.trim(),
    name,
    grade: rawGrade.trim(),
    calificacion: null,
    manual: true,
  });
  searchInput.value = '';
  autocompleteList.classList.add('hidden');
  manualAddHint.classList.add('hidden');
  renderStudents();
  saveState();
}

// ---- Formulario persistente de "Agregar estudiante manualmente" ----
const btnToggleManual = document.getElementById('btn-toggle-manual');
const manualForm = document.getElementById('manual-form');
const manualNameInput = document.getElementById('manual-name');
const manualNieInput = document.getElementById('manual-nie');
const manualGradeInput = document.getElementById('manual-grade');
const btnManualSave = document.getElementById('btn-manual-save');

function openManualForm(prefillName = '') {
  manualForm.classList.remove('hidden');
  if (prefillName) manualNameInput.value = prefillName;
  manualNameInput.focus();
}

btnToggleManual.addEventListener('click', () => {
  manualForm.classList.toggle('hidden');
  if (!manualForm.classList.contains('hidden')) manualNameInput.focus();
});

btnManualSave.addEventListener('click', () => {
  addManualStudent(manualNameInput.value, manualNieInput.value, manualGradeInput.value);
  manualNameInput.value = '';
  manualNieInput.value = '';
  manualGradeInput.value = '';
  manualForm.classList.add('hidden');
});

searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim();
  if (query.length < 2) {
    autocompleteList.classList.add('hidden');
    manualAddHint.classList.add('hidden');
    return;
  }
  const q = normalize(query);
  const matches = STUDENT_INDEX.filter((s) => s.normName.includes(q)).slice(0, 8);
  renderAutocomplete(matches);
  manualAddHint.classList.toggle('hidden', matches.length > 0);
});

searchInput.addEventListener('keydown', (e) => {
  if (autocompleteList.classList.contains('hidden')) return;
  const items = autocompleteList.querySelectorAll('.autocomplete-item');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex = Math.min(activeIndex + 1, items.length - 1);
    updateActiveItem(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex = Math.max(activeIndex - 1, 0);
    updateActiveItem(items);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (activeIndex >= 0 && currentMatches[activeIndex]) {
      if (!isAlreadyAdded(currentMatches[activeIndex].nie)) {
        selectStudent(currentMatches[activeIndex]);
      }
    }
  } else if (e.key === 'Escape') {
    autocompleteList.classList.add('hidden');
  }
});

function updateActiveItem(items) {
  items.forEach((it, i) => it.classList.toggle('active', i === activeIndex));
  if (items[activeIndex]) items[activeIndex].scrollIntoView({ block: 'nearest' });
}

btnAddManual.addEventListener('click', () => {
  openManualForm(searchInput.value.trim());
  manualAddHint.classList.add('hidden');
  autocompleteList.classList.add('hidden');
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#student-search') && !e.target.closest('#autocomplete-list')) {
    autocompleteList.classList.add('hidden');
  }
});

// =========================================================
// TABLA DE ESTUDIANTES
// =========================================================
const studentsTbody = document.getElementById('students-tbody');
const studentsEmpty = document.getElementById('students-empty');
const studentRowTemplate = document.getElementById('student-row-template');

// Estado de la fila según el cierre del proceso: pendiente → registrada →
// (no entregó | falta nota | recuperó | no alcanzó).
function estadoFor(est) {
  if (est.entrego === 'no') return { cls: 'no-entrego', label: 'No entregó' };
  if (est.entrego === 'si') {
    if (est.notaRecup == null || est.notaRecup === '') return { cls: 'falta-nota', label: 'Falta nota' };
    const r = calcularResultado(est, state.configuracion);
    const supero = r.tipo === 'extraordinaria' ? r.aprobado : r.alcanzaMinima;
    return supero
      ? { cls: 'recupero', label: 'Recuperó' }
      : { cls: 'no-alcanzo', label: 'No alcanzó' };
  }
  if (est.calificacion === null || est.calificacion === '' || est.calificacion === undefined) {
    return { cls: 'pendiente', label: 'Pendiente' };
  }
  return { cls: 'registrada', label: 'Registrada' };
}

function renderStudents() {
  studentsTbody.innerHTML = '';
  studentsEmpty.classList.toggle('hidden', state.estudiantes.length > 0);

  state.estudiantes.forEach((est) => {
    const row = studentRowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.id = est.id;

    const tdName = row.querySelector('[data-field="name"]');
    const tdNie = row.querySelector('[data-field="nie"]');
    const tdGrade = row.querySelector('[data-field="grade"]');
    const inputCal = row.querySelector('[data-field="calificacion"]');
    const selEntrego = row.querySelector('[data-field="entrego"]');
    const inputNotaRecup = row.querySelector('[data-field="nota-recup"]');
    const badge = row.querySelector('[data-field="status"]');
    const btnDelete = row.querySelector('[data-action="delete"]');

    const refreshBadge = () => {
      const st = estadoFor(est);
      badge.textContent = st.label;
      badge.className = `status-badge ${st.cls}`;
    };

    tdName.textContent = est.name || '(sin nombre)';
    tdNie.textContent = est.nie || '—';
    tdGrade.textContent = est.grade || '—';

    if (est.manual) {
      [tdName, tdNie, tdGrade].forEach((td) => {
        td.contentEditable = 'true';
        td.classList.add('outline-none', 'focus:bg-navy-50', 'rounded-sm', 'px-1', '-mx-1');
        td.title = 'Campo manual — editable';
      });
      tdName.addEventListener('blur', () => { est.name = tdName.textContent.trim(); saveState(); });
      tdNie.addEventListener('blur', () => { est.nie = tdNie.textContent.trim(); saveState(); });
      tdGrade.addEventListener('blur', () => { est.grade = tdGrade.textContent.trim(); saveState(); });
    }

    inputCal.value = est.calificacion ?? '';
    inputCal.addEventListener('input', () => {
      let v = inputCal.value === '' ? null : Number(inputCal.value);
      if (v !== null) v = Math.max(0, Math.min(10, v));
      est.calificacion = v;
      refreshBadge();
      updateSummary();
      saveState();
    });

    selEntrego.value = est.entrego || '';
    selEntrego.addEventListener('change', () => {
      est.entrego = selEntrego.value;
      refreshBadge();
      updateSummary();
      saveState();
    });

    inputNotaRecup.value = est.notaRecup ?? '';
    inputNotaRecup.addEventListener('input', () => {
      let v = inputNotaRecup.value === '' ? null : Number(inputNotaRecup.value);
      if (v !== null) v = Math.max(0, Math.min(10, v));
      est.notaRecup = v;
      // Registrar una nota de recuperación implica que el estudiante entregó
      if (v !== null && !est.entrego) { est.entrego = 'si'; selEntrego.value = 'si'; }
      refreshBadge();
      updateSummary();
      saveState();
    });

    refreshBadge();

    btnDelete.addEventListener('click', () => {
      state.estudiantes = state.estudiantes.filter((s) => s.id !== est.id);
      renderStudents();
      saveState();
    });

    studentsTbody.appendChild(row);
  });

  updateSummary();
}

function updateSummary() {
  const total = state.estudiantes.length;

  document.getElementById('students-count').textContent =
    `${total} estudiante${total === 1 ? '' : 's'} agregado${total === 1 ? '' : 's'}`;

  updateGenerateButtons(total);
}

// Reparto del cierre: quién recibe acta de resultado, de incumplimiento,
// a quién le falta la nota y quién sigue sin marcar.
function getCierre() {
  const entregados = state.estudiantes.filter((e) => e.entrego === 'si' && e.notaRecup != null);
  const sinNota = state.estudiantes.filter((e) => e.entrego === 'si' && e.notaRecup == null);
  const noEntregaron = state.estudiantes.filter((e) => e.entrego === 'no');
  const pendientes = state.estudiantes.filter((e) => !e.entrego);
  return { entregados, sinNota, noEntregaron, pendientes };
}

function updateGenerateButtons(totalCount) {
  const hint = document.getElementById('generate-hint');
  const ready = totalCount > 0;

  ['btn-generate-preview', 'btn-generate-pdf', 'btn-generate-word'].forEach((id) => {
    document.getElementById(id).disabled = !ready;
  });
  hint.textContent = ready
    ? `Se generarán actas para ${totalCount} estudiante${totalCount === 1 ? '' : 's'}.`
    : 'Agrega al menos un estudiante para continuar.';

  // Actas de cierre
  const c = getCierre();
  const cierreReady = c.entregados.length + c.noEntregaron.length > 0;
  ['btn-cierre-preview', 'btn-cierre-pdf', 'btn-cierre-word'].forEach((id) => {
    document.getElementById(id).disabled = !cierreReady;
  });
  const cierreHint = document.getElementById('cierre-hint');
  if (cierreReady) {
    const partes = [];
    if (c.entregados.length) partes.push(`${c.entregados.length} acta${c.entregados.length === 1 ? '' : 's'} de resultado`);
    if (c.noEntregaron.length) partes.push(`${c.noEntregaron.length} de incumplimiento`);
    let txt = `Se generará: ${partes.join(' · ')}.`;
    if (c.sinNota.length) txt += ` ⚠ ${c.sinNota.length} marcado${c.sinNota.length === 1 ? '' : 's'} «Sí» sin nota de recuperación.`;
    if (c.pendientes.length) txt += ` ${c.pendientes.length} sin marcar quedará${c.pendientes.length === 1 ? '' : 'n'} fuera.`;
    cierreHint.textContent = txt;
  } else {
    cierreHint.innerHTML = 'Marca en la tabla quién entregó y su nota: se generará automáticamente el acta de ' +
      '<strong>resultado</strong> o de <strong>incumplimiento</strong> según corresponda a cada estudiante.';
  }

  updateRefuerzoButtons();
}

// =========================================================
// CHECKLIST DEL EXPEDIENTE (num. 15 del Manual)
// =========================================================
function fmtFechaCortaApp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

// Lista de verificación del expediente (Manual, num. 15 pág. 55 y num. 34.c).
// 'auto': se marca solo al generar el documento (state.generados).
// 'manual': el docente lo marca con un clic cuando el paso ya está cumplido
// en papel (state.checklist); se guarda con el proceso en la base de datos.
const CHECKLIST_ITEMS = [
  { key: 'refuerzo', tipo: 'auto', label: 'Constancia de refuerzo educativo generada', ref: 'num. 15.a' },
  { key: 'paquete', tipo: 'auto', label: 'Acta de compromiso + instructivo + instrumento generados', ref: 'num. 15.d' },
  { key: 'firmasAval', tipo: 'manual', label: 'Acta de compromiso firmada por director/a, docente y Equipo de Evaluación', ref: 'num. 15.d' },
  { key: 'acuseEstudiante', tipo: 'manual', label: 'Acuse de recibido — firma del estudiante en su acta', ref: 'num. 15.c' },
  { key: 'evidencias', tipo: 'manual', label: 'Trabajos o evidencias de la recuperación archivados', ref: 'num. 15.b' },
  { key: 'cierre', tipo: 'auto', label: 'Acta de cierre generada — resultado o incumplimiento', ref: 'num. 15.b' },
  { key: 'notasRegistradas', tipo: 'manual', label: 'Notas finales registradas en el cuadro oficial', ref: 'num. 13.1.c / 13.2.c' },
  { key: 'justificacion', tipo: 'manual', label: 'Justificación escrita por cada estudiante que reprueba', ref: 'num. 34.c · si reprueba' },
  { key: 'archivoFisico', tipo: 'manual', label: 'Expediente impreso y archivado en el centro educativo', ref: 'num. 15' },
];

function renderChecklist() {
  const panel = document.getElementById('expediente-checklist');
  if (!panel) return;

  let completados = 0;
  const rows = CHECKLIST_ITEMS.map((it) => {
    const fecha = it.tipo === 'auto' ? state.generados[it.key] : state.checklist[it.key];
    const done = !!fecha;
    if (done) completados++;
    const derecha = done
      ? `<span class="check-date">${fmtFechaCortaApp(fecha)}</span>`
      : `<span class="check-ref">${it.ref}</span>`;
    if (it.tipo === 'auto') {
      return `<div class="check-item${done ? ' done' : ''}">
        <span class="check-mark">${done ? '✓' : '○'}</span>
        <span class="flex-1">${it.label}</span>
        ${derecha}
      </div>`;
    }
    return `<button type="button" class="check-item manual${done ? ' done' : ''}" data-check-key="${it.key}"
      role="checkbox" aria-checked="${done}" title="${done ? 'Clic para desmarcar' : 'Clic para marcar como cumplido'}">
      <span class="check-mark">${done ? '✓' : '□'}</span>
      <span class="flex-1">${it.label}</span>
      ${derecha}
    </button>`;
  }).join('');

  const pct = Math.round((completados / CHECKLIST_ITEMS.length) * 100);
  panel.innerHTML = `
    <div class="checklist-title">Lista de verificación del expediente — Normativa de Evaluación, num. 15</div>
    <div class="checklist-progress-row">
      <div class="checklist-progress"><span style="width:${pct}%"></span></div>
      <span class="checklist-progress-label">${completados} de ${CHECKLIST_ITEMS.length}</span>
    </div>
    ${rows}
    <p class="checklist-hint">Los pasos con casilla □ se marcan con un clic cuando ya están cumplidos en papel; quedan guardados con el proceso.</p>`;

  panel.querySelectorAll('[data-check-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.checkKey;
      if (state.checklist[k]) delete state.checklist[k];
      else state.checklist[k] = new Date().toISOString();
      saveState();
      renderChecklist();
    });
  });

  if (typeof updateFaseChecks === 'function') updateFaseChecks();
}

function markGenerado(key) {
  state.generados[key] = new Date().toISOString();
  saveState();
  renderChecklist();
}

// =========================================================
// FASES DEL PROCESO DE RECUPERACIÓN (pestañas)
// Fase 1 Refuerzo · Fase 2 Recuperación · Fase 3 Cierre — cada una se
// realiza en su propio momento, así que solo se muestra la fase activa.
// =========================================================
const FASE_KEY = 'actas-recuperacion:fase';

function setFase(fase) {
  if (!['1', '2', '3'].includes(fase)) fase = '1';
  const view = document.getElementById('view-recuperacion');
  view.setAttribute('data-fase', fase);
  view.querySelectorAll('[data-fase-panel]').forEach((p) => {
    p.hidden = (p.dataset.fasePanel !== fase);
  });
  view.querySelectorAll('.fase-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.fase === fase);
  });
  // En la fase de cierre la card de Estudiantes se muestra al inicio de la
  // pestaña (ahí se marcan entregas y notas); en las demás, en su lugar normal.
  const cardEst = document.getElementById('estudiantes-card');
  const slot = document.getElementById(fase === '3' ? 'estudiantes-slot-cierre' : 'estudiantes-slot-main');
  if (cardEst && slot && cardEst.parentElement !== slot) slot.appendChild(cardEst);
  try { localStorage.setItem(FASE_KEY, fase); } catch (e) { /* no-op */ }
}

function updateFaseChecks() {
  document.querySelectorAll('[data-fase-check]').forEach((el) => {
    el.textContent = state.generados[el.dataset.faseCheck] ? '✓' : '';
  });
}

function initFases() {
  document.querySelectorAll('.fase-tab').forEach((t) => {
    t.addEventListener('click', () => setFase(t.dataset.fase));
  });
  setFase(localStorage.getItem(FASE_KEY) || '1');
  updateFaseChecks();
}

// =========================================================
// ACTIVIDADES
// =========================================================
const activitiesList = document.getElementById('activities-list');
const activityTemplate = document.getElementById('activity-block-template');

function buildActivityTableElement(act) {
  const table = document.createElement('table');
  act.tabla.celdas.forEach((rowData, r) => {
    const tr = document.createElement('tr');
    rowData.forEach((cellText, c) => {
      const td = document.createElement('td');
      td.contentEditable = 'true';
      td.textContent = cellText;
      td.addEventListener('input', () => {
        act.tabla.celdas[r][c] = td.textContent;
        saveState();
      });
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  return table;
}

function renderActivities() {
  activitiesList.innerHTML = '';
  state.actividades.forEach((act, index) => {
    const block = activityTemplate.content.firstElementChild.cloneNode(true);
    block.dataset.id = act.id;

    const label = block.querySelector('[data-field="label"]');
    const inputTitulo = block.querySelector('[data-field="titulo"]');
    const editor = block.querySelector('[data-field="instrucciones"]');
    const btnDelete = block.querySelector('[data-action="delete-activity"]');
    const formatBtns = block.querySelectorAll('[data-cmd]');
    const btnToggleTable = block.querySelector('[data-action="toggle-table"]');
    const tableControls = block.querySelector('[data-field="table-controls"]');
    const inputRows = block.querySelector('[data-field="table-rows"]');
    const inputCols = block.querySelector('[data-field="table-cols"]');
    const btnCreateTable = block.querySelector('[data-action="create-table"]');
    const tableWrapper = block.querySelector('[data-field="table-wrapper"]');
    const tableContainer = block.querySelector('[data-field="table-container"]');
    const btnRemoveTable = block.querySelector('[data-action="remove-table"]');
    const btnAddImage = block.querySelector('[data-action="add-image"]');
    const imageWrapper = block.querySelector('[data-field="image-wrapper"]');
    const imagePreview = block.querySelector('[data-field="image-preview"]');
    const imageCaption = block.querySelector('[data-field="image-caption"]');
    const sizeBtns = block.querySelectorAll('[data-size]');
    const btnRemoveImage = block.querySelector('[data-action="remove-image"]');

    label.textContent = `Actividad ${index + 1}`;
    inputTitulo.value = act.titulo || '';
    editor.innerHTML = act.instrucciones || '';

    inputTitulo.addEventListener('input', () => { act.titulo = inputTitulo.value; saveState(); });
    editor.addEventListener('input', () => { act.instrucciones = editor.innerHTML; saveState(); });

    // Botones de formato (negrita / cursiva / subrayado) sobre la selección activa
    formatBtns.forEach((btn) => {
      btn.addEventListener('mousedown', (e) => e.preventDefault()); // conserva la selección de texto
      btn.addEventListener('click', () => {
        editor.focus();
        document.execCommand(btn.dataset.cmd, false, null);
        act.instrucciones = editor.innerHTML;
        saveState();
      });
    });

    btnToggleTable.addEventListener('click', () => {
      tableControls.classList.toggle('hidden');
    });

    btnCreateTable.addEventListener('click', () => {
      const filas = Math.max(1, Math.min(20, parseInt(inputRows.value, 10) || 1));
      const columnas = Math.max(1, Math.min(10, parseInt(inputCols.value, 10) || 1));
      act.tabla = {
        filas,
        columnas,
        celdas: Array.from({ length: filas }, () => Array.from({ length: columnas }, () => '')),
      };
      tableContainer.innerHTML = '';
      tableContainer.appendChild(buildActivityTableElement(act));
      tableWrapper.classList.remove('hidden');
      tableControls.classList.add('hidden');
      saveState();
    });

    btnRemoveTable.addEventListener('click', () => {
      act.tabla = null;
      tableWrapper.classList.add('hidden');
      tableContainer.innerHTML = '';
      saveState();
    });

    if (act.tabla) {
      tableContainer.appendChild(buildActivityTableElement(act));
      tableWrapper.classList.remove('hidden');
    }

    // ---- Imagen de la actividad ----
    function refreshImageSection() {
      if (act.imagen && act.imagen.data) {
        imageWrapper.classList.remove('hidden');
        imagePreview.src = act.imagen.data;
        imageCaption.value = act.imagen.caption || '';
        applyPreviewSize(imagePreview, act.imagen.size);
        sizeBtns.forEach((b) => b.classList.toggle('active', b.dataset.size === (act.imagen.size || 'medium')));
      } else {
        imageWrapper.classList.add('hidden');
        imagePreview.removeAttribute('src');
      }
    }
    refreshImageSection();

    btnAddImage.addEventListener('click', () => openImageModal(act.id));

    sizeBtns.forEach((b) => b.addEventListener('click', () => {
      if (!act.imagen) return;
      act.imagen.size = b.dataset.size;
      sizeBtns.forEach((x) => x.classList.toggle('active', x === b));
      applyPreviewSize(imagePreview, act.imagen.size);
      saveState();
    }));

    imageCaption.addEventListener('input', () => {
      if (!act.imagen) return;
      act.imagen.caption = imageCaption.value;
      saveState();
    });

    btnRemoveImage.addEventListener('click', () => {
      act.imagen = null;
      refreshImageSection();
      saveState();
    });

    btnDelete.addEventListener('click', () => {
      state.actividades = state.actividades.filter((a) => a.id !== act.id);
      renderActivities();
      saveState();
    });

    activitiesList.appendChild(block);
  });
}

document.getElementById('btn-add-activity').addEventListener('click', () => {
  state.actividades.push({ id: uid(), titulo: '', instrucciones: '', tabla: null, imagen: null });
  renderActivities();
  saveState();
  const inputs = activitiesList.querySelectorAll('[data-field="titulo"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
});

// =========================================================
// IMAGEN DE ACTIVIDAD — preview, procesamiento y modal
// =========================================================
const PREVIEW_MAXW = { xsmall: '90px', small: '150px', medium: '260px', large: '380px' };

function applyPreviewSize(img, size) {
  img.style.maxWidth = PREVIEW_MAXW[size] || PREVIEW_MAXW.medium;
}

// Lee un archivo de imagen; reescala si supera 1400px (lado mayor) y normaliza
// formatos no soportados por Word (p. ej. WEBP) a PNG/JPEG. Devuelve { data, w, h }.
function processImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => {
      const src = reader.result;
      const img = new Image();
      img.onerror = () => reject(new Error('decode'));
      img.onload = () => {
        const natW = img.naturalWidth;
        const natH = img.naturalHeight;
        const MAX = 1400;
        const longest = Math.max(natW, natH);
        const needsResize = longest > MAX;
        const supported = /^data:image\/(png|jpeg|jpg|gif|bmp);/i.test(src);
        if (!needsResize && supported) {
          resolve({ data: src, w: natW, h: natH });
          return;
        }
        const scale = needsResize ? MAX / longest : 1;
        const w = Math.max(1, Math.round(natW * scale));
        const h = Math.max(1, Math.round(natH * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const outType = /^data:image\/jpeg/i.test(src) ? 'image/jpeg' : 'image/png';
        resolve({ data: canvas.toDataURL(outType, 0.85), w, h });
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

const imageModal = document.getElementById('image-modal');
const imageDropzone = document.getElementById('image-dropzone');
const imagePickBtn = document.getElementById('image-pick-btn');
const imageFileInput = document.getElementById('image-file-input');
const imageModalClose = document.getElementById('image-modal-close');
let currentImageActivityId = null;

function openImageModal(activityId) {
  currentImageActivityId = activityId;
  imageModal.classList.remove('hidden');
}

function closeImageModal() {
  imageModal.classList.add('hidden');
  imageDropzone.classList.remove('dragover');
  currentImageActivityId = null;
}

async function handleImageFiles(files) {
  const file = files && files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('El archivo seleccionado no es una imagen.');
    return;
  }
  const targetId = currentImageActivityId;
  try {
    const processed = await processImageFile(file);
    const act = state.actividades.find((a) => a.id === targetId);
    if (act) {
      act.imagen = { data: processed.data, w: processed.w, h: processed.h, caption: '', size: 'medium' };
      saveState();
      renderActivities();
    }
  } catch (e) {
    console.error('No se pudo procesar la imagen:', e);
    alert('No se pudo procesar la imagen. Intenta con otro archivo.');
  } finally {
    imageFileInput.value = '';
    closeImageModal();
  }
}

imagePickBtn.addEventListener('click', () => imageFileInput.click());
imageFileInput.addEventListener('change', () => handleImageFiles(imageFileInput.files));
imageModalClose.addEventListener('click', closeImageModal);
imageModal.addEventListener('click', (e) => { if (e.target === imageModal) closeImageModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !imageModal.classList.contains('hidden')) closeImageModal();
});

['dragenter', 'dragover'].forEach((evt) =>
  imageDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    imageDropzone.classList.add('dragover');
  })
);
['dragleave', 'dragend'].forEach((evt) =>
  imageDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    imageDropzone.classList.remove('dragover');
  })
);
imageDropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  imageDropzone.classList.remove('dragover');
  if (e.dataTransfer && e.dataTransfer.files) handleImageFiles(e.dataTransfer.files);
});

// =========================================================
// LOGO INSTITUCIONAL (se convierte a base64 una sola vez)
// =========================================================
let logoBase64 = null;

async function loadLogo() {
  try {
    const res = await fetch('logo.png');
    if (!res.ok) throw new Error('No se encontró logo.png en la raíz del proyecto');
    const blob = await res.blob();
    logoBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn('Logo no disponible, los documentos se generarán sin él:', e.message);
    logoBase64 = null;
  }
}

// =========================================================
// GENERACIÓN DE DOCUMENTOS
// =========================================================
function getEstudiantesParaActa() {
  return state.estudiantes.slice();
}

// Pickers de currículo e instrumento (independientes: ordinaria vs recuperación).
// Se instancian en la inicialización.
let ordPicker, recPicker, ordInstr, recInstr;
function recupFrom(picker, instr) {
  const s = picker ? picker.get() : { indicadores: [], objetivos: [] };
  return { indicadores: s.indicadores, objetivos: s.objetivos, instrumento: instr ? instr.get() : { tipo: 'ninguno', criterios: [] } };
}

// Archiva cada documento generado en el expediente digital del estudiante
// (IndexedDB). Un registro por estudiante+tipo+materia+período: regenerar
// actualiza en vez de duplicar.
function archivar(tipo, ests, extra) {
  if (!window.Expediente) return;
  const cfg = state.configuracion;
  extra = extra || {};
  ests.forEach((est) => {
    window.Expediente.guardar({
      nie: est.nie || '', name: est.name || '', grade: est.grade || '',
      materia: cfg.materia || '—', trimestre: cfg.trimestre || '—', anio: String(cfg.anio || '—'),
      tipo,
      fecha: new Date().toISOString(),
      payload: {
        config: { ...cfg },
        est: JSON.parse(JSON.stringify(est)),
        actividades: JSON.parse(JSON.stringify(state.actividades)),
        recup: extra.recup ? JSON.parse(JSON.stringify(extra.recup)) : null,
        refuerzo: extra.refuerzo ? { ...extra.refuerzo } : null,
      },
    }).catch((e) => console.error('No se pudo archivar en el expediente:', e));
  });
}

// Validación amable: lista lo que falta y deja decidir al docente.
function confirmarConAvisos(avisos) {
  if (!avisos.length) return true;
  return confirm(`Antes de generar, revisa:\n\n• ${avisos.join('\n• ')}\n\n¿Generar de todos modos?`);
}

function avisosPaquete(recup) {
  const avisos = [];
  if (!recup.indicadores.length) avisos.push('No has seleccionado indicadores de logro no alcanzados (sección 02).');
  if (!recup.objetivos.length) avisos.push('No has agregado objetivos de aprendizaje (sección 02).');
  if (!state.actividades.length) avisos.push('No has definido actividades de recuperación (sección 04).');
  if (!recup.instrumento || recup.instrumento.tipo === 'ninguno') avisos.push('No has definido el instrumento de evaluación (sección 05).');
  if (!state.configuracion.fechaLimite) avisos.push('No has establecido la fecha límite (Configuración general).');
  return avisos;
}

// ---- Acta de compromiso + instructivo + instrumento (paquete) ----
function generarPaquete(formato) {
  const estudiantes = getEstudiantesParaActa();
  if (!estudiantes.length) return;
  const recup = recupFrom(recPicker, recInstr);
  const preview = formato === 'preview';
  if (!preview && !confirmarConAvisos(avisosPaquete(recup))) return;

  const juntarInstrumento = !!state.configuracion.instrumentoMismaPagina;
  if (formato === 'word') window.ActasWord.generar(state, estudiantes, logoBase64, recup, { juntarInstrumento });
  else window.ActasPDF.generar(state, estudiantes, logoBase64, recup, { preview, juntarInstrumento });

  if (!preview) {
    archivar('paquete', estudiantes, { recup });
    markGenerado('paquete');
  }
}

document.getElementById('btn-generate-pdf').addEventListener('click', () => generarPaquete('pdf'));
document.getElementById('btn-generate-word').addEventListener('click', () => generarPaquete('word'));
document.getElementById('btn-generate-preview').addEventListener('click', () => generarPaquete('preview'));

// ---- Actas de cierre: resultado (entregó) + incumplimiento (no entregó) ----
function generarCierre(formato) {
  const c = getCierre();
  if (!c.entregados.length && !c.noEntregaron.length) return;
  const preview = formato === 'preview';

  if (c.entregados.length && !state.configuracion.nivelEducativo) {
    alert('Selecciona el nivel educativo (nota mínima) en la sección 01 antes de generar las actas de resultado: la regla del Manual depende de si es Básica (5.0) o Media (6.0).');
    return;
  }

  const avisos = [];
  if (c.sinNota.length) avisos.push(`${c.sinNota.length} estudiante(s) marcados «Sí entregó» sin nota de recuperación — quedarán FUERA del cierre.`);
  if (c.pendientes.length) avisos.push(`${c.pendientes.length} estudiante(s) sin marcar si entregaron — quedarán fuera del cierre.`);
  if (!state.configuracion.fechaLimite && c.noEntregaron.length) avisos.push('No has establecido la fecha límite; el acta de incumplimiento la imprimirá en blanco.');
  if (!preview && !confirmarConAvisos(avisos)) return;

  const recup = recupFrom(recPicker, recInstr);
  const gen = formato === 'word' ? window.ActasWord : window.ActasPDF;

  // UN SOLO archivo con el acta que corresponde a cada estudiante, en el orden
  // de la tabla (dos descargas separadas hacían que el navegador bloqueara la
  // segunda y se perdieran actas).
  const listos = state.estudiantes
    .map((e) => {
      if (e.entrego === 'no') return { ...e, cierre: 'incumplimiento' };
      if (e.entrego === 'si' && e.notaRecup != null) {
        return { ...e, cierre: 'resultado', resultado: calcularResultado(e, state.configuracion) };
      }
      return null;
    })
    .filter(Boolean);
  if (!listos.length) return;

  if (formato === 'word') gen.generarCierre(state, listos, logoBase64, recup);
  else gen.generarCierre(state, listos, logoBase64, recup, { preview });

  if (!preview) {
    archivar('resultado', listos.filter((e) => e.cierre === 'resultado'), { recup });
    archivar('incumplimiento', listos.filter((e) => e.cierre === 'incumplimiento'), {});
    markGenerado('cierre');
  }
}

document.getElementById('btn-cierre-pdf').addEventListener('click', () => generarCierre('pdf'));
document.getElementById('btn-cierre-word').addEventListener('click', () => generarCierre('word'));
document.getElementById('btn-cierre-preview').addEventListener('click', () => generarCierre('preview'));

// ---- Constancia de refuerzo educativo ----
const REFUERZO_FIELDS = { inicio: 'rec-ref-inicio', fin: 'rec-ref-fin', descripcion: 'rec-ref-desc' };

function bindRefuerzoFields() {
  Object.entries(REFUERZO_FIELDS).forEach(([key, id]) => {
    const el = document.getElementById(id);
    el.value = state.refuerzo[key] || '';
    const onUpdate = () => { state.refuerzo[key] = el.value; updateRefuerzoButtons(); saveState(); };
    el.addEventListener('input', onUpdate);
    el.addEventListener('change', onUpdate);
  });
}

function updateRefuerzoButtons() {
  const hint = document.getElementById('refuerzo-hint');
  if (!hint) return;
  const total = state.estudiantes.length;
  const tieneDatos = !!((state.refuerzo.descripcion || '').trim() || state.refuerzo.inicio || state.refuerzo.fin);
  const ready = total > 0 && tieneDatos;
  ['btn-refuerzo-preview', 'btn-refuerzo-pdf', 'btn-refuerzo-word'].forEach((id) => {
    document.getElementById(id).disabled = !ready;
  });
  hint.textContent = ready
    ? `Se generará una constancia por cada uno de los ${total} estudiante${total === 1 ? '' : 's'} de la tabla.`
    : 'Agrega estudiantes y describe el refuerzo para habilitar la constancia.';
}

function generarRefuerzo(formato) {
  const estudiantes = getEstudiantesParaActa();
  if (!estudiantes.length) return;
  const recup = recupFrom(recPicker, recInstr);
  const preview = formato === 'preview';

  if (formato === 'word') window.ActasWord.generarRefuerzo(state, estudiantes, logoBase64, recup);
  else window.ActasPDF.generarRefuerzo(state, estudiantes, logoBase64, recup, { preview });

  if (!preview) {
    archivar('refuerzo', estudiantes, { recup, refuerzo: state.refuerzo });
    markGenerado('refuerzo');
  }
}

document.getElementById('btn-refuerzo-pdf').addEventListener('click', () => generarRefuerzo('pdf'));
document.getElementById('btn-refuerzo-word').addEventListener('click', () => generarRefuerzo('word'));
document.getElementById('btn-refuerzo-preview').addEventListener('click', () => generarRefuerzo('preview'));

// ---- Actividad ordinaria (instructivo de actividad de evaluación) ----
document.getElementById('btn-ordinaria-pdf').addEventListener('click', () => {
  const ord = window.ActividadOrdinaria && window.ActividadOrdinaria.get();
  if (!ord || !ord.titulo) return;
  window.ActasPDF.generarOrdinaria(state, ord, logoBase64, recupFrom(ordPicker, ordInstr));
});

document.getElementById('btn-ordinaria-preview').addEventListener('click', () => {
  const ord = window.ActividadOrdinaria && window.ActividadOrdinaria.get();
  if (!ord || !ord.titulo) return;
  window.ActasPDF.generarOrdinaria(state, ord, logoBase64, recupFrom(ordPicker, ordInstr), { preview: true });
});

document.getElementById('btn-ordinaria-word').addEventListener('click', () => {
  const ord = window.ActividadOrdinaria && window.ActividadOrdinaria.get();
  if (!ord || !ord.titulo) return;
  window.ActasWord.generarOrdinaria(state, ord, logoBase64, recupFrom(ordPicker, ordInstr));
});

// =========================================================
// CONTEXTO PARA EL CÓDIGO DE GOOGLE APPS SCRIPT
// (lo consume el botón «Copiar código» del instrumento de evaluación)
// =========================================================

// Ordinaria: la lista completa del grado elegido en Configuración general.
function ctxOrdinaria() {
  const ord = (window.ActividadOrdinaria && window.ActividadOrdinaria.get()) || {};
  const sel = ordPicker ? ordPicker.get() : { indicadores: [], objetivos: [] };
  return {
    origen: 'ordinaria',
    config: state.configuracion,
    grado: state.configuracion.grado,
    actividad: { tipoLabel: ord.tipoLabel || '', titulo: ord.titulo || '', ponderacion: ord.ponderacion || '' },
    estudiantes: estudiantesDelGrado(state.configuracion.grado),
    indicadores: sel.indicadores,
    objetivos: sel.objetivos,
  };
}

// Recuperación: solo los estudiantes de la tabla (los que están en proceso).
function ctxRecuperacion() {
  const sel = recPicker ? recPicker.get() : { indicadores: [], objetivos: [] };
  const cfg = state.configuracion;
  const actividad = state.actividades.find((a) => (a.titulo || '').trim());
  return {
    origen: 'recuperacion',
    config: cfg,
    grado: cfg.grado || (state.estudiantes[0] && state.estudiantes[0].grade) || '',
    actividad: {
      tipoLabel: cfg.tipoRecuperacion === 'extraordinaria' ? 'Recuperación extraordinaria' : 'Recuperación ordinaria',
      titulo: actividad ? actividad.titulo.trim() : '',
      ponderacion: '',
    },
    estudiantes: state.estudiantes,
    indicadores: sel.indicadores,
    objetivos: sel.objetivos,
  };
}

// =========================================================
// PICKERS INDEPENDIENTES + ROUTER DE VISTAS
// =========================================================
function initPickers() {
  ordPicker = window.createCurriculoPicker(
    document.getElementById('ord-curriculo'), 'actas-recuperacion:curriculo:ord:v1');
  recPicker = window.createCurriculoPicker(
    document.getElementById('rec-curriculo'), 'actas-recuperacion:curriculo:rec:v1',
    { selLabel: 'Indicadores no alcanzados seleccionados' });
  ordInstr = window.createInstrumento(
    document.getElementById('ord-instrumento'), 'actas-recuperacion:instrumento:ord:v1',
    () => ordPicker.get().indicadores,
    { contexto: ctxOrdinaria });
  recInstr = window.createInstrumento(
    document.getElementById('rec-instrumento'), 'actas-recuperacion:instrumento:rec:v1',
    () => recPicker.get().indicadores,
    { contexto: ctxRecuperacion });

  // Autollenar "Materia" con la asignatura elegida en el buscador de currículo
  // (solo si el campo está vacío, para no pisar lo que escribió el docente).
  ['ord-curriculo', 'rec-curriculo'].forEach((rootId) => {
    const sel = document.querySelector(`#${rootId} [data-cur="asignatura"]`);
    if (!sel) return;
    sel.addEventListener('change', () => {
      if (!sel.value || (state.configuracion.materia || '').trim()) return;
      state.configuracion.materia = sel.value;
      document.getElementById('cfg-materia').value = sel.value;
      saveState();
    });
  });
}

const VIEWS = ['home', 'ordinaria', 'recuperacion', 'documentos', 'expedientes'];
const SECTION_LABELS = {
  ordinaria: 'Actividad ordinaria',
  recuperacion: 'Actividad de recuperación',
  documentos: 'Documentos descargables',
  expedientes: 'Expedientes',
};
const headerSectionTag = document.getElementById('header-section-tag');
const headerSubtitle = document.getElementById('header-subtitle');
const btnClearData = document.getElementById('btn-clear-data');

function showView(name) {
  if (!VIEWS.includes(name)) name = 'home';
  // El bloque de configuración general se monta al inicio de la vista activa
  // (ordinaria o recuperación); es un único bloque con estado compartido.
  if (name === 'ordinaria' || name === 'recuperacion') {
    const mount = document.querySelector('#view-' + name + ' .config-mount');
    const block = document.getElementById('config-block');
    if (mount && block && block.parentElement !== mount) mount.appendChild(block);
  }
  document.querySelectorAll('[data-view]').forEach((v) => { v.hidden = (v.id !== 'view-' + name); });

  const sectionLabel = SECTION_LABELS[name];
  headerSectionTag.textContent = sectionLabel || '';
  headerSectionTag.classList.toggle('hidden', !sectionLabel);
  headerSubtitle.classList.toggle('hidden', !!sectionLabel);
  btnClearData.classList.toggle('hidden', name !== 'ordinaria' && name !== 'recuperacion');

  if (name === 'expedientes' && window.ExpedienteUI) window.ExpedienteUI.render();
  if (name === 'home' && window.ProcesosUI) window.ProcesosUI.render();

  if (('#' + name) !== location.hash) history.replaceState(null, '', '#' + name);
  window.scrollTo(0, 0);
}
function initRouter() {
  // El CSS mostró la vista destino vía [data-initial-view] para evitar el parpadeo
  // de "Inicio" al recargar; a partir de aquí la navegación la gobierna showView.
  document.documentElement.removeAttribute('data-initial-view');
  document.querySelectorAll('[data-nav]').forEach((b) => {
    b.addEventListener('click', () => showView(b.dataset.nav));
  });
  window.addEventListener('hashchange', () => showView((location.hash || '#home').slice(1)));
  showView((location.hash || '#home').slice(1));
}

// =========================================================
// DRAWER DE OPCIONES (respaldo · restaurar · tema)
// =========================================================
const drawer = document.getElementById('drawer');
const drawerOverlay = document.getElementById('drawer-overlay');

function openDrawer() {
  drawer.classList.add('open');
  drawerOverlay.classList.remove('hidden');
  drawer.setAttribute('aria-hidden', 'false');
}

function closeDrawer() {
  drawer.classList.remove('open');
  drawerOverlay.classList.add('hidden');
  drawer.setAttribute('aria-hidden', 'true');
}

document.getElementById('btn-drawer').addEventListener('click', openDrawer);
document.getElementById('drawer-close').addEventListener('click', closeDrawer);
drawerOverlay.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
});
// Al usar respaldo o restaurar se cierra el drawer (abren diálogos propios)
document.getElementById('btn-export-backup').addEventListener('click', closeDrawer);
document.getElementById('btn-import-backup').addEventListener('click', closeDrawer);

// =========================================================
// TEMA CLARO / OSCURO
// =========================================================
const btnToggleTheme = document.getElementById('btn-toggle-theme');

function applyTheme(theme) {
  document.body.classList.toggle('dark', theme === 'dark');
  const label = document.getElementById('theme-label');
  const icon = document.getElementById('theme-icon');
  if (label) label.textContent = theme === 'dark' ? 'Modo claro' : 'Modo oscuro';
  if (icon) icon.src = theme === 'dark' ? 'sun-svgrepo-com.svg' : 'moon-svgrepo-com.svg';
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || 'light';
  applyTheme(saved);
}

btnToggleTheme.addEventListener('click', () => {
  const next = document.body.classList.contains('dark') ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

// =========================================================
// RESPALDO — EXPORTAR / IMPORTAR (JSON)
// Permite llevarse todo (configuración, selecciones y expedientes) a otra
// computadora o compartirlo con otro docente. Los datos nunca salen a un
// servidor: el archivo se descarga y se restaura localmente.
// =========================================================
async function exportBackup() {
  try {
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('actas-recuperacion:')) ls[k] = localStorage.getItem(k);
    }
    const expediente = window.Expediente ? await window.Expediente.exportAll() : [];
    const procesos = window.Procesos ? await window.Procesos.exportAll() : [];
    const data = {
      formato: 'actas-recuperacion-respaldo',
      version: 2,
      fecha: new Date().toISOString(),
      localStorage: ls,
      expediente,
      procesos,
    };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const hoy = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `Respaldo_Actas_${hoy}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    console.error('No se pudo exportar el respaldo:', e);
    alert('No se pudo exportar el respaldo. Revisa la consola para más detalles.');
  }
}

async function importBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (e) {
    alert('El archivo no es un respaldo válido (no se pudo leer como JSON).');
    return;
  }
  if (!data || data.formato !== 'actas-recuperacion-respaldo') {
    alert('El archivo no es un respaldo de esta plataforma.');
    return;
  }
  const nDocs = Array.isArray(data.expediente) ? data.expediente.length : 0;
  const nProcs = Array.isArray(data.procesos) ? data.procesos.length : 0;
  const confirmado = confirm(
    `Respaldo del ${fmtFechaCortaApp(data.fecha) || 'sin fecha'} con ${nDocs} documento(s) de expediente y ${nProcs} proceso(s).\n\n` +
    'Esto REEMPLAZARÁ tu configuración y selecciones actuales, y COMBINARÁ los expedientes y procesos ' +
    '(los del respaldo se agregan a los tuyos). ¿Continuar?'
  );
  if (!confirmado) return;

  try {
    Object.entries(data.localStorage || {}).forEach(([k, v]) => {
      if (k.startsWith('actas-recuperacion:')) localStorage.setItem(k, v);
    });
    if (window.Expediente && nDocs) await window.Expediente.importAll(data.expediente);
    if (window.Procesos && nProcs) await window.Procesos.importAll(data.procesos);
    alert('Respaldo restaurado. La página se recargará para aplicar los cambios.');
    location.reload();
  } catch (e) {
    console.error('No se pudo importar el respaldo:', e);
    alert('Ocurrió un error al restaurar el respaldo. Revisa la consola.');
  }
}

document.getElementById('btn-export-backup').addEventListener('click', exportBackup);
const importInput = document.getElementById('import-backup-input');
document.getElementById('btn-import-backup').addEventListener('click', () => importInput.click());
importInput.addEventListener('change', () => {
  if (importInput.files && importInput.files[0]) importBackup(importInput.files[0]);
  importInput.value = '';
});

// =========================================================
// LIMPIAR DATOS
// =========================================================
document.getElementById('btn-clear-data').addEventListener('click', () => {
  const confirmado = confirm(
    '¿Seguro que deseas borrar todos los datos ingresados (configuración, estudiantes, actividades y refuerzo)? ' +
    'Los expedientes archivados NO se borran. Esta acción no se puede deshacer.'
  );
  if (!confirmado) return;

  localStorage.removeItem(STORAGE_KEY);
  ['actas-recuperacion:instrumento:ord:v1', 'actas-recuperacion:instrumento:rec:v1',
   'actas-recuperacion:ordinaria:v1'].forEach((k) => localStorage.removeItem(k));
  if (ordPicker) ordPicker.clear();
  if (recPicker) recPicker.clear();
  state.configuracion = { ...DEFAULT_CONFIG };
  state.estudiantes = [];
  state.actividades = [];
  state.refuerzo = { inicio: '', fin: '', descripcion: '' };
  state.generados = {};
  state.checklist = {};

  Object.entries(CONFIG_FIELD_IDS).forEach(([key, id]) => {
    document.getElementById(id).value = state.configuracion[key] || '';
  });
  Object.entries(REFUERZO_FIELDS).forEach(([key, id]) => {
    document.getElementById(id).value = state.refuerzo[key] || '';
  });
  renderStudents();
  renderActivities();
  renderChecklist();
  setFase('1');
  saveState();
});

// =========================================================
// INICIALIZACIÓN
// =========================================================
loadState();
bindConfigFields();
bindRefuerzoFields();
renderStudents();
renderActivities();
renderChecklist();
initFases();
initPickers();
initRouter();
loadLogo();
initTheme();

// El módulo de expedientes necesita el logo para regenerar documentos.
window.AppLogo = () => logoBase64;
try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* no-op en navegadores que no lo soportan */ }
