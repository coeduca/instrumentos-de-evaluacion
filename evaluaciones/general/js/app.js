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
  director: 'Román del Tránsito García Amaya',
  evaluador: 'José Eliseo Martínez Rodríguez',
  tipoRecuperacion: 'ordinaria',
  nivelEducativo: '',
  instrumentoMismaPagina: false,
  incluirActaCompromiso: false,
  normativaSimpleV2: true,
};

// ---------- Estado central ----------
const state = {
  configuracion: { ...DEFAULT_CONFIG },
  estudiantes: [],
  actividades: [],
  refuerzo: { inicio: '', fin: '', fechaEmision: fechaHoyISO(), descripcion: '' },
  ultimoRecurso: { titulo: '', instrucciones: '', fecha: '', estudiantes: {} },
  generados: {},
  checklist: {},
};

const NOTA_MINIMA = { basica: 5, media: 6 };

function rutaPostExtraPorGrado(grado) {
  const g = normalize(grado);
  if (g.includes('septimo') || g.includes('octavo') || g.includes('noveno')) return 'ultimo_recurso_tercer_ciclo';
  if (g.includes('primer ano de bachillerato')) return 'ultimo_recurso_primero';
  if (g.includes('segundo ano de bachillerato')) return 'suficiencia_segundo';
  return '';
}

function calcularResultado(est, config) {
  if (est.notaRecup == null || est.notaRecup === '') return null;
  const notaMin = NOTA_MINIMA[config.nivelEducativo] || 5;
  const orig = est.calificacion != null && est.calificacion !== '' ? Number(est.calificacion) : null;
  if (orig == null || Number.isNaN(orig)) return null;
  const rec = Number(est.notaRecup);
  const r = {
    tipo: config.tipoRecuperacion === 'extraordinaria' ? 'extraordinaria' : 'ordinaria',
    nivel: config.nivelEducativo || '',
    notaMinima: notaMin,
    notaOriginal: orig,
    notaRecuperacion: rec,
  };
  if (r.tipo === 'extraordinaria') {
    // Norma 13.2.c: promedio exacto entre el promedio final reprobado y
    // la nota de recuperación. NO se redondea antes de decidir si alcanza
    // la mínima; un 4.95 sigue siendo menor que 5.0.
    r.promedio = (orig + rec) / 2;
    r.aprobado = r.promedio >= notaMin;
    r.notaFinal = r.aprobado ? notaMin : orig;
    r.rutaPosterior = r.aprobado ? '' : rutaPostExtraPorGrado(config.grado || est.grade || '');
  } else {
    r.sustituye = rec > orig;
    r.notaFinalActividad = Math.max(orig, rec);
    r.alcanzaMinima = r.notaFinalActividad >= notaMin;
  }
  return r;
}

function fmtNumeroExacto(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  return Number.isInteger(v) ? v.toFixed(1) : v.toFixed(2).replace(/0$/, '');
}

// ---------- Utilidades ----------
function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function fechaHoyISO() {
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const mes = String(hoy.getMonth() + 1).padStart(2, '0');
  const dia = String(hoy.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
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

const ORDEN_GRADOS = ['Séptimo', 'Octavo', 'Noveno', 'Primer Año de Bachillerato', 'Segundo Año de Bachillerato'];

function indiceGrado(grade) {
  const i = ORDEN_GRADOS.indexOf(grade);
  return i === -1 ? 99 : i;
}

const STUDENT_INDEX = Object.entries(window.STUDENTS || {})
  .map(([nie, info]) => ({
    nie,
    name: info.name,
    grade: info.grade,
    order: info.order || 0,
    normName: normalize(info.name),
  }))
  .sort((a, b) => indiceGrado(a.grade) - indiceGrado(b.grade) || a.order - b.order);

function compararEstudiantesTabla(a, b) {
  const cmpGrado = indiceGrado(a.grade) - indiceGrado(b.grade);
  if (cmpGrado) return cmpGrado;
  const infoA = a.nie && window.STUDENTS[a.nie];
  const infoB = b.nie && window.STUDENTS[b.nie];
  if (infoA && infoB) return infoA.order - infoB.order;
  if (infoA) return -1;
  if (infoB) return 1;
  return (a.name || '').localeCompare(b.name || '', 'es');
}

// ---------- Persistencia ultrarrápida (localStorage) ----------
function saveStateRaw() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    flashSaveIndicator();
  } catch (e) {
    console.error('No se pudo autoguardar:', e);
  }
}
const saveState = debounce(saveStateRaw, 50);

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const configGuardada = parsed.configuracion || {};
    Object.assign(state.configuracion, configGuardada);
    // Migración única: versiones anteriores trataban el acta de compromiso como
    // parte normal del paquete. En el flujo normativo simplificado pasa a ser opt-in.
    if (configGuardada.normativaSimpleV2 !== true) {
      state.configuracion.incluirActaCompromiso = false;
      state.configuracion.normativaSimpleV2 = true;
    }
    state.configuracion.materia = normalizarMateria(state.configuracion.materia);
    if (!state.configuracion.director) state.configuracion.director = DEFAULT_CONFIG.director;
    if (!state.configuracion.evaluador) state.configuracion.evaluador = DEFAULT_CONFIG.evaluador;
    state.estudiantes = Array.isArray(parsed.estudiantes) ? parsed.estudiantes : [];
    state.estudiantes.sort(compararEstudiantesTabla);
    state.actividades = Array.isArray(parsed.actividades) ? parsed.actividades : [];
    Object.assign(state.refuerzo, parsed.refuerzo || {});
    if (!state.refuerzo.fechaEmision) state.refuerzo.fechaEmision = fechaHoyISO();
    Object.assign(state.ultimoRecurso, parsed.ultimoRecurso || {});
    if (!state.ultimoRecurso.estudiantes || typeof state.ultimoRecurso.estudiantes !== 'object') state.ultimoRecurso.estudiantes = {};
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

const MATERIAS = [
  'Lengua y Literatura',
  'Ciencia y Tecnología',
  'Ciudadanía y Valores',
  'Matemática y Datos',
  'Precálculo',
  'Inglés',
  'Finanzas y Economía',
  'Educación Física',
  'Proyecto de Vida y Carrera',
  'Ciencias de la Computación',
];

function normalizarMateria(value) {
  const migraciones = { 'Matemática': 'Matemática y Datos', 'Precalculo': 'Precálculo' };
  const materia = migraciones[value] || value || '';
  return MATERIAS.includes(materia) ? materia : '';
}

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
    opt.value = name; opt.textContent = name;
    select.appendChild(opt);
  });
}

function populateMateriaOptions() {
  const select = document.getElementById('cfg-materia');
  MATERIAS.forEach((materia) => {
    const opt = document.createElement('option');
    opt.value = materia; opt.textContent = materia;
    select.appendChild(opt);
  });
}

function gradosDisponibles() {
  const grados = [...new Set(STUDENT_INDEX.map((s) => s.grade).filter(Boolean))];
  return grados.sort((a, b) => indiceGrado(a) - indiceGrado(b) || a.localeCompare(b, 'es'));
}

function populateGradeOptions() {
  const select = document.getElementById('cfg-grado');
  if (!select) return;
  gradosDisponibles().forEach((grado) => {
    const opt = document.createElement('option');
    opt.value = grado; opt.textContent = grado;
    select.appendChild(opt);
  });
}

function estudiantesDelGrado(grado) {
  if (!grado) return [];
  return STUDENT_INDEX.filter((s) => s.grade === grado).map((s) => ({ nie: s.nie, name: s.name, grade: s.grade }));
}

function nivelPorGrado(grado) {
  const g = normalize(grado);
  if (g.includes('bachillerato')) return 'media';
  if (g.includes('septimo') || g.includes('octavo') || g.includes('noveno')) return 'basica';
  return '';
}

function bindConfigFields() {
  populateTeacherOptions();
  populateMateriaOptions();
  populateGradeOptions();
  Object.entries(CONFIG_FIELD_IDS).forEach(([key, id]) => {
    const el = document.getElementById(id);
    el.value = state.configuracion[key] || '';
    const onUpdate = () => {
      state.configuracion[key] = el.value;
      if (key === 'grado') {
        const nivelInferido = nivelPorGrado(el.value);
        if (nivelInferido) {
          state.configuracion.nivelEducativo = nivelInferido;
          const nivelSelect = document.getElementById('rec-nivel');
          if (nivelSelect) nivelSelect.value = nivelInferido;
        }
      }
      if (key === 'tipoRecuperacion' || key === 'nivelEducativo' || key === 'grado') { updateRecoveryModeUI(); renderStudents(); }
      saveState();
    };
    el.addEventListener('input', onUpdate);
    el.addEventListener('change', onUpdate);
  });

  const incluirActa = document.getElementById('cfg-incluir-acta-compromiso');
  if (incluirActa) {
    incluirActa.checked = state.configuracion.incluirActaCompromiso === true;
    incluirActa.addEventListener('change', () => {
      state.configuracion.incluirActaCompromiso = incluirActa.checked;
      updateGenerateButtons(state.estudiantes.length);
      renderChecklist();
      saveState();
    });
  }

  const mismaPag = document.getElementById('cfg-instrumento-misma-pagina');
  if (mismaPag) {
    mismaPag.checked = !!state.configuracion.instrumentoMismaPagina;
    mismaPag.addEventListener('change', () => {
      state.configuracion.instrumentoMismaPagina = mismaPag.checked;
      saveState();
    });
  }

  if (!state.configuracion.nivelEducativo) {
    const inferido = nivelPorGrado(state.configuracion.grado);
    if (inferido) {
      state.configuracion.nivelEducativo = inferido;
      const nivelSelect = document.getElementById('rec-nivel');
      if (nivelSelect) nivelSelect.value = inferido;
    }
  }
  updateRecoveryModeUI();
}

function updateRecoveryModeUI() {
  const extra = state.configuracion.tipoRecuperacion === 'extraordinaria';
  const notaLabel = document.getElementById('nota-base-label');
  if (notaLabel) notaLabel.textContent = extra ? 'Promedio final' : 'Nota original';
  const extraInfo = document.getElementById('extra-requisitos');
  if (extraInfo) extraInfo.classList.toggle('hidden', !extra);
  renderPostExtraordinaria();
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

function isAlreadyAdded(nie) { return state.estudiantes.some((s) => s.nie === nie); }

function renderAutocomplete(matches) {
  currentMatches = matches; activeIndex = -1; autocompleteList.innerHTML = '';
  if (matches.length === 0) { autocompleteList.classList.add('hidden'); return; }
  matches.forEach((m, i) => {
    const added = isAlreadyAdded(m.nie);
    const item = document.createElement('div');
    item.className = `autocomplete-item${added ? ' already-added' : ''}`;
    item.dataset.index = String(i);
    item.innerHTML = `<span class="ac-name">${escapeHtml(m.name)}</span><span class="ac-meta">${escapeHtml(m.grade)} · ${escapeHtml(m.nie)}${added ? ' · agregado' : ''}</span>`;
    item.addEventListener('click', () => { if (!added) selectStudent(m); });
    autocompleteList.appendChild(item);
  });
  autocompleteList.classList.remove('hidden');
}

function escapeHtml(str) {
  const div = document.createElement('div'); div.textContent = str; return div.innerHTML;
}

function selectStudent(match) {
  state.estudiantes.push({ id: match.nie, nie: match.nie, name: match.name, grade: match.grade, calificacion: null, manual: false });
  state.estudiantes.sort(compararEstudiantesTabla);
  searchInput.value = ''; autocompleteList.classList.add('hidden'); manualAddHint.classList.add('hidden');
  renderStudents(); saveState(); searchInput.focus();
}

function addManualStudent(rawName, rawNie = '', rawGrade = '') {
  const name = rawName.trim();
  if (!name) { document.getElementById('manual-name').focus(); return; }
  state.estudiantes.push({ id: uid(), nie: rawNie.trim(), name, grade: rawGrade.trim(), calificacion: null, manual: true });
  state.estudiantes.sort(compararEstudiantesTabla);
  searchInput.value = ''; autocompleteList.classList.add('hidden'); manualAddHint.classList.add('hidden');
  renderStudents(); saveState();
}

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
  manualNameInput.value = ''; manualNieInput.value = ''; manualGradeInput.value = '';
  manualForm.classList.add('hidden');
});

searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim();
  if (query.length < 2) { autocompleteList.classList.add('hidden'); manualAddHint.classList.add('hidden'); return; }
  const q = normalize(query);
  const matches = STUDENT_INDEX.filter((s) => s.normName.includes(q)).slice(0, 8);
  renderAutocomplete(matches);
  manualAddHint.classList.toggle('hidden', matches.length > 0);
});

searchInput.addEventListener('keydown', (e) => {
  if (autocompleteList.classList.contains('hidden')) return;
  const items = autocompleteList.querySelectorAll('.autocomplete-item');
  if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, items.length - 1); updateActiveItem(items); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); updateActiveItem(items); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (activeIndex >= 0 && currentMatches[activeIndex] && !isAlreadyAdded(currentMatches[activeIndex].nie)) selectStudent(currentMatches[activeIndex]);
  } else if (e.key === 'Escape') { autocompleteList.classList.add('hidden'); }
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
  if (!e.target.closest('#student-search') && !e.target.closest('#autocomplete-list')) autocompleteList.classList.add('hidden');
});

// =========================================================
// TABLA DE ESTUDIANTES
// =========================================================
const studentsTbody = document.getElementById('students-tbody');
const studentsEmpty = document.getElementById('students-empty');
const studentRowTemplate = document.getElementById('student-row-template');

function estadoFor(est) {
  if (est.entrego === 'no') return { cls: 'no-entrego', label: 'No entregó' };
  if (est.entrego === 'si') {
    if (est.notaRecup == null || est.notaRecup === '') return { cls: 'falta-nota', label: 'Falta nota' };
    if (est.calificacion == null || est.calificacion === '') return { cls: 'falta-nota', label: 'Falta nota base' };
    const r = calcularResultado(est, state.configuracion);
    if (r.tipo === 'extraordinaria') {
      return r.aprobado ? { cls: 'recupero', label: 'Aprueba' } : { cls: 'no-alcanzo', label: 'No alcanza' };
    }
    return r.sustituye
      ? { cls: 'recupero', label: 'Mejora nota' }
      : { cls: 'registrada', label: 'Se mantiene' };
  }
  return { cls: 'pendiente', label: 'Pendiente' };
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
    const resultDetail = row.querySelector('[data-field="result-detail"]');
    const btnDelete = row.querySelector('[data-action="delete"]');

    const refreshBadge = () => {
      const st = estadoFor(est);
      badge.textContent = st.label; badge.className = `status-badge ${st.cls}`;
      if (resultDetail) {
        const r = est.entrego === 'si' ? calcularResultado(est, state.configuracion) : null;
        if (r && r.tipo === 'extraordinaria') {
          resultDetail.textContent = `(${fmtNumeroExacto(r.notaOriginal)} + ${fmtNumeroExacto(r.notaRecuperacion)}) ÷ 2 = ${fmtNumeroExacto(r.promedio)} · final ${fmtNumeroExacto(r.notaFinal)}`;
        } else if (r) {
          resultDetail.textContent = `Nota final de actividad: ${fmtNumeroExacto(r.notaFinalActividad)}`;
        } else {
          resultDetail.textContent = '';
        }
      }
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
      tdName.addEventListener('input', () => { est.name = tdName.textContent.trim(); saveState(); });
      tdNie.addEventListener('input', () => { est.nie = tdNie.textContent.trim(); saveState(); });
      tdGrade.addEventListener('input', () => { est.grade = tdGrade.textContent.trim(); saveState(); });
    }

    inputCal.value = est.calificacion ?? '';
    inputCal.addEventListener('input', () => {
      let v = inputCal.value === '' ? null : Number(inputCal.value);
      if (v !== null) v = Math.max(0, Math.min(10, v));
      est.calificacion = v; refreshBadge(); updateSummary(); renderPostExtraordinaria(); saveState();
    });

    selEntrego.value = est.entrego || '';
    selEntrego.addEventListener('change', () => {
      est.entrego = selEntrego.value; refreshBadge(); updateSummary(); renderPostExtraordinaria(); saveState();
    });

    inputNotaRecup.value = est.notaRecup ?? '';
    inputNotaRecup.addEventListener('input', () => {
      let v = inputNotaRecup.value === '' ? null : Number(inputNotaRecup.value);
      if (v !== null) v = Math.max(0, Math.min(10, v));
      est.notaRecup = v;
      if (v !== null && !est.entrego) { est.entrego = 'si'; selEntrego.value = 'si'; }
      refreshBadge(); updateSummary(); renderPostExtraordinaria(); saveState();
    });

    refreshBadge();
    btnDelete.addEventListener('click', () => {
      state.estudiantes = state.estudiantes.filter((s) => s.id !== est.id);
      renderStudents(); saveState();
    });

    studentsTbody.appendChild(row);
  });

  updateSummary();
  renderPostExtraordinaria();
}

function updateSummary() {
  const total = state.estudiantes.length;
  document.getElementById('students-count').textContent = `${total} estudiante${total === 1 ? '' : 's'} agregado${total === 1 ? '' : 's'}`;
  updateGenerateButtons(total);
}

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

  ['btn-generate-preview', 'btn-generate-pdf', 'btn-generate-word'].forEach((id) => { document.getElementById(id).disabled = !ready; });
  const incluirActa = state.configuracion.incluirActaCompromiso === true;
  const packageTitle = document.getElementById('generate-package-title');
  if (packageTitle) packageTitle.textContent = incluirActa
    ? 'Acta de compromiso (opcional) + actividad e instrumento'
    : 'Actividad e instrumento de recuperación';
  hint.textContent = ready
    ? `Se generará${totalCount === 1 ? '' : 'n'} ${incluirActa ? 'el acta de compromiso, la actividad y el instrumento' : 'la actividad y el instrumento'} para ${totalCount} estudiante${totalCount === 1 ? '' : 's'}.`
    : 'Agrega al menos un estudiante para continuar.';

  const c = getCierre();
  const cierreReady = c.entregados.length + c.noEntregaron.length > 0;
  ['btn-cierre-preview', 'btn-cierre-pdf', 'btn-cierre-word'].forEach((id) => { document.getElementById(id).disabled = !cierreReady; });
  
  const cierreHint = document.getElementById('cierre-hint');
  if (cierreReady) {
    const partes = [];
    if (c.entregados.length) partes.push(`${c.entregados.length} acta${c.entregados.length === 1 ? '' : 's'} de resultado`);
    if (c.noEntregaron.length) partes.push(`${c.noEntregaron.length} de incumplimiento`);
    let txt = `Respaldo opcional: ${partes.join(' · ')}.`;
    if (c.sinNota.length) txt += ` ⚠ ${c.sinNota.length} marcado${c.sinNota.length === 1 ? '' : 's'} «Sí» sin nota de recuperación.`;
    if (c.pendientes.length) txt += ` ${c.pendientes.length} sin marcar quedará${c.pendientes.length === 1 ? '' : 'n'} fuera.`;
    cierreHint.textContent = txt;
  } else {
    cierreHint.innerHTML = 'Estas actas son <strong>opcionales</strong>. Úsalas solo si tu centro desea un respaldo adicional del resultado o del incumplimiento.';
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

const CHECKLIST_ITEMS = [
  { key: 'refuerzo', tipo: 'auto', label: 'Refuerzo educativo documentado y constancia de notificación preparada', ref: 'nums. 12, 15.a y 15.d' },
  { key: 'firmasAval', tipo: 'manual', label: 'Constancia firmada por director/a, docente responsable y Equipo de Evaluación', ref: 'num. 15.d' },
  { key: 'acuseEstudiante', tipo: 'manual', label: 'Estudiante, familia o encargado notificado del proceso', ref: 'nums. 13.1.d y 15.d' },
  { key: 'paquete', tipo: 'auto', label: 'Actividad e instrumento de recuperación preparados según los indicadores no alcanzados', ref: 'nums. 8.2.b y 13.1.b' },
  { key: 'evidencias', tipo: 'manual', label: 'Comprobantes de la recuperación incorporados al expediente', ref: 'num. 15.b' },
  { key: 'notasRegistradas', tipo: 'manual', label: 'Resultado aplicado y nota registrada en el mecanismo oficial', ref: 'nums. 13.1.c / 13.2.c y 18' },
];

function renderChecklist() {
  const panel = document.getElementById('expediente-checklist');
  if (!panel) return;

  let completados = 0;
  const rows = CHECKLIST_ITEMS.map((it) => {
    const fecha = it.tipo === 'auto' ? state.generados[it.key] : state.checklist[it.key];
    const done = !!fecha;
    if (done) completados++;
    const derecha = done ? `<span class="check-date">${fmtFechaCortaApp(fecha)}</span>` : `<span class="check-ref">${it.ref}</span>`;
    if (it.tipo === 'auto') return `<div class="check-item${done ? ' done' : ''}"><span class="check-mark">${done ? '✓' : '○'}</span><span class="flex-1">${it.label}</span>${derecha}</div>`;
    return `<button type="button" class="check-item manual${done ? ' done' : ''}" data-check-key="${it.key}" role="checkbox" aria-checked="${done}" title="${done ? 'Clic para desmarcar' : 'Clic para marcar como cumplido'}"><span class="check-mark">${done ? '✓' : '□'}</span><span class="flex-1">${it.label}</span>${derecha}</button>`;
  }).join('');

  const pct = Math.round((completados / CHECKLIST_ITEMS.length) * 100);
  panel.innerHTML = `
    <div class="checklist-title">Ruta mínima obligatoria — Normativa de Evaluación</div>
    <div class="checklist-progress-row"><div class="checklist-progress"><span style="width:${pct}%"></span></div><span class="checklist-progress-label">${completados} de ${CHECKLIST_ITEMS.length}</span></div>
    ${rows}<p class="checklist-hint">Aquí solo aparecen pasos necesarios para este proceso. Las constancias adicionales no cuentan como requisito.</p>`;

  panel.querySelectorAll('[data-check-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.checkKey;
      if (state.checklist[k]) delete state.checklist[k]; else state.checklist[k] = new Date().toISOString();
      saveState(); renderChecklist();
    });
  });
  if (typeof updateFaseChecks === 'function') updateFaseChecks();
}

function markGenerado(key) {
  state.generados[key] = new Date().toISOString();
  saveState(); renderChecklist();
}

// =========================================================
// RUTA POSTERIOR A RECUPERACIÓN EXTRAORDINARIA NO APROBADA
// =========================================================
function estudiantesNoAprobadosExtra() {
  if (state.configuracion.tipoRecuperacion !== 'extraordinaria') return [];
  return state.estudiantes.filter((est) => {
    if (est.entrego !== 'si' || est.notaRecup == null || est.calificacion == null) return false;
    const r = calcularResultado(est, state.configuracion);
    return !!(r && r.tipo === 'extraordinaria' && !r.aprobado);
  });
}

function getUrRegistro(est) {
  const key = String(est.id || est.nie || est.name || '');
  if (!state.ultimoRecurso.estudiantes[key]) state.ultimoRecurso.estudiantes[key] = { seleccionado: false, nota: null };
  return state.ultimoRecurso.estudiantes[key];
}

function estudiantesUltimoRecursoSeleccionados() {
  return estudiantesNoAprobadosExtra().filter((est) => getUrRegistro(est).seleccionado === true);
}

function actualizarBotonesUltimoRecurso() {
  const seleccionados = estudiantesUltimoRecursoSeleccionados();
  const titulo = (state.ultimoRecurso.titulo || '').trim();
  const ready = seleccionados.length > 0 && !!titulo;
  ['btn-ur-preview', 'btn-ur-pdf', 'btn-ur-word'].forEach((id) => {
    const el = document.getElementById(id); if (el) el.disabled = !ready;
  });
  const hint = document.getElementById('ur-hint');
  if (hint) {
    if (!seleccionados.length) hint.textContent = 'Selecciona al menos un estudiante que cumpla la condición normativa.';
    else if (!titulo) hint.textContent = 'Escribe el título de la actividad para habilitar la generación.';
    else hint.textContent = `Se generará la actividad para ${seleccionados.length} estudiante${seleccionados.length === 1 ? '' : 's'}.`;
  }
}

function renderPostExtraordinaria() {
  const panel = document.getElementById('post-extra-panel');
  const urCard = document.getElementById('ultimo-recurso-card');
  const sufCard = document.getElementById('suficiencia-card');
  const list = document.getElementById('ultimo-recurso-estudiantes');
  if (!panel || !urCard || !sufCard || !list) return;

  const reprobados = estudiantesNoAprobadosExtra();
  const ruta = rutaPostExtraPorGrado(state.configuracion.grado || (reprobados[0] && reprobados[0].grade) || '');
  const mostrar = state.configuracion.tipoRecuperacion === 'extraordinaria' && reprobados.length > 0 && !!ruta;
  panel.classList.toggle('hidden', !mostrar);
  urCard.classList.toggle('hidden', !mostrar || !ruta.startsWith('ultimo_recurso'));
  sufCard.classList.toggle('hidden', !mostrar || ruta !== 'suficiencia_segundo');
  if (!mostrar || !ruta.startsWith('ultimo_recurso')) return;

  const norma = document.getElementById('ultimo-recurso-norma');
  if (norma) {
    norma.innerHTML = ruta === 'ultimo_recurso_tercer_ciclo'
      ? '<strong>Tercer Ciclo · num. 35:</strong> si después de la recuperación extraordinaria el estudiante reprueba <strong>una de las tres asignaturas</strong>, puede desarrollar una actividad como último recurso para alcanzar 5.0. Si no lo logra, no aprueba el grado.'
      : '<strong>1.º Bachillerato · num. 40.1.b:</strong> si después de la recuperación extraordinaria el estudiante reprueba nuevamente <strong>una de las tres asignaturas</strong>, puede desarrollar actividades de evaluación, según criterios de la institución, como último recurso para obtener 6.0. Si no lo logra, reprueba el año.';
  }

  list.innerHTML = '';
  reprobados.forEach((est) => {
    const reg = getUrRegistro(est);
    const r = calcularResultado(est, state.configuracion);
    const row = document.createElement('div');
    row.className = 'ultimo-recurso-row';
    const min = r ? r.notaMinima : (NOTA_MINIMA[state.configuracion.nivelEducativo] || 5);
    row.innerHTML = `
      <label class="ultimo-recurso-check">
        <input type="checkbox" data-ur-select ${reg.seleccionado ? 'checked' : ''}>
        <span><strong>${escapeHtml(est.name || 'Estudiante')}</strong><small>Promedio extraordinario: ${fmtNumeroExacto(r && r.promedio)} · confirma que esta es la única asignatura que continúa reprobada.</small></span>
      </label>
      <div class="ultimo-recurso-nota ${reg.seleccionado ? '' : 'hidden'}">
        <label>Resultado de la actividad <input type="number" min="0" max="10" step="0.1" data-ur-nota value="${reg.nota == null ? '' : reg.nota}" placeholder="—/10"></label>
        <span data-ur-status class="status-badge ${reg.nota == null ? 'pendiente' : (Number(reg.nota) >= min ? 'recupero' : 'no-alcanzo')}">${reg.nota == null ? 'Pendiente' : (Number(reg.nota) >= min ? `Alcanza ${min.toFixed(1)}` : `No alcanza ${min.toFixed(1)}`)}</span>
      </div>`;
    const check = row.querySelector('[data-ur-select]');
    const notaWrap = row.querySelector('.ultimo-recurso-nota');
    const notaInput = row.querySelector('[data-ur-nota]');
    const status = row.querySelector('[data-ur-status]');
    check.addEventListener('change', () => {
      reg.seleccionado = check.checked;
      notaWrap.classList.toggle('hidden', !check.checked);
      actualizarBotonesUltimoRecurso(); saveState();
    });
    notaInput.addEventListener('input', () => {
      reg.nota = notaInput.value === '' ? null : Math.max(0, Math.min(10, Number(notaInput.value)));
      if (reg.nota == null) { status.textContent = 'Pendiente'; status.className = 'status-badge pendiente'; }
      else if (reg.nota >= min) { status.textContent = `Alcanza ${min.toFixed(1)}`; status.className = 'status-badge recupero'; }
      else { status.textContent = `No alcanza ${min.toFixed(1)}`; status.className = 'status-badge no-alcanzo'; }
      saveState();
    });
    list.appendChild(row);
  });
  actualizarBotonesUltimoRecurso();
}

function bindUltimoRecurso() {
  const titulo = document.getElementById('ur-titulo');
  const fecha = document.getElementById('ur-fecha');
  const instrucciones = document.getElementById('ur-instrucciones');
  if (!titulo || !fecha || !instrucciones) return;
  titulo.value = state.ultimoRecurso.titulo || '';
  fecha.value = state.ultimoRecurso.fecha || '';
  instrucciones.value = state.ultimoRecurso.instrucciones || '';
  titulo.addEventListener('input', () => { state.ultimoRecurso.titulo = titulo.value; actualizarBotonesUltimoRecurso(); saveState(); });
  fecha.addEventListener('input', () => { state.ultimoRecurso.fecha = fecha.value; saveState(); });
  instrucciones.addEventListener('input', () => { state.ultimoRecurso.instrucciones = instrucciones.value; saveState(); });
}

function generarUltimoRecurso(formato) {
  const estudiantes = estudiantesUltimoRecursoSeleccionados();
  if (!estudiantes.length || !(state.ultimoRecurso.titulo || '').trim()) return;
  const recup = recupFrom(recPicker, recInstr);
  const actividad = {
    id: 'ultimo-recurso',
    titulo: state.ultimoRecurso.titulo.trim(),
    instrucciones: escapeHtml(state.ultimoRecurso.instrucciones || '').replace(/\n/g, '<br>'),
    tabla: null,
    imagen: null,
  };
  const ruta = rutaPostExtraPorGrado(state.configuracion.grado || (estudiantes[0] && estudiantes[0].grade) || '');
  const notaNormativa = ruta === 'ultimo_recurso_tercer_ciclo'
    ? 'Actividad como último recurso conforme al num. 35 de las disposiciones específicas para Segundo y Tercer Ciclo.'
    : 'Actividad de evaluación como último recurso conforme al num. 40.1.b para Primer Año de Educación Media.';
  const tempState = {
    configuracion: { ...state.configuracion, fechaLimite: state.ultimoRecurso.fecha || state.configuracion.fechaLimite },
    actividades: [actividad],
  };
  const preview = formato === 'preview';
  const gen = formato === 'word' ? window.ActasWord : window.ActasPDF;
  if (!gen || typeof gen.generarUltimoRecurso !== 'function') return;
  gen.generarUltimoRecurso(tempState, estudiantes, logoBase64, recup, { preview, juntarInstrumento: !!state.configuracion.instrumentoMismaPagina, notaNormativa });
  if (!preview) {
    archivar('ultimo-recurso', estudiantes, { recup, actividades: [actividad], ultimoRecurso: state.ultimoRecurso });
    state.generados.ultimoRecurso = new Date().toISOString();
    saveState();
  }
}

// =========================================================
// FASES DEL PROCESO DE RECUPERACIÓN (pestañas)
// =========================================================
const FASE_KEY = 'actas-recuperacion:fase';

function setFase(fase) {
  if (!['1', '2', '3'].includes(fase)) fase = '1';
  const view = document.getElementById('view-recuperacion');
  view.setAttribute('data-fase', fase);
  view.querySelectorAll('[data-fase-panel]').forEach((p) => { p.hidden = (p.dataset.fasePanel !== fase); });
  view.querySelectorAll('.fase-tab').forEach((t) => { t.classList.toggle('active', t.dataset.fase === fase); });
  
  const cardEst = document.getElementById('estudiantes-card');
  const slot = document.getElementById(fase === '3' ? 'estudiantes-slot-cierre' : 'estudiantes-slot-main');
  if (cardEst && slot && cardEst.parentElement !== slot) slot.appendChild(cardEst);
  try { localStorage.setItem(FASE_KEY, fase); } catch (e) {}
}

function updateFaseChecks() {
  document.querySelectorAll('[data-fase-check]').forEach((el) => {
    const key = el.dataset.faseCheck;
    const done = key === 'cierre' ? !!state.checklist.notasRegistradas : !!state.generados[key];
    el.textContent = done ? '✓' : '';
  });
}

function initFases() {
  document.querySelectorAll('.fase-tab').forEach((t) => { t.addEventListener('click', () => setFase(t.dataset.fase)); });
  document.querySelectorAll('[data-go-fase]').forEach((b) => { b.addEventListener('click', () => setFase(b.dataset.goFase)); });
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
      td.addEventListener('input', () => { act.tabla.celdas[r][c] = td.textContent; saveState(); });
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
    const positionBtns = block.querySelectorAll('[data-image-position]');
    const btnRemoveImage = block.querySelector('[data-action="remove-image"]');

    label.textContent = `Actividad ${index + 1}`;
    inputTitulo.value = act.titulo || '';
    editor.innerHTML = act.instrucciones || '';

    inputTitulo.addEventListener('input', () => { act.titulo = inputTitulo.value; saveState(); });
    editor.addEventListener('input', () => { act.instrucciones = editor.innerHTML; saveState(); });

    formatBtns.forEach((btn) => {
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        editor.focus();
        document.execCommand(btn.dataset.cmd, false, null);
        act.instrucciones = editor.innerHTML;
        saveState();
      });
    });

    btnToggleTable.addEventListener('click', () => { tableControls.classList.toggle('hidden'); });

    btnCreateTable.addEventListener('click', () => {
      const filas = Math.max(1, Math.min(20, parseInt(inputRows.value, 10) || 1));
      const columnas = Math.max(1, Math.min(10, parseInt(inputCols.value, 10) || 1));
      act.tabla = { filas, columnas, celdas: Array.from({ length: filas }, () => Array.from({ length: columnas }, () => '')) };
      tableContainer.innerHTML = ''; tableContainer.appendChild(buildActivityTableElement(act));
      tableWrapper.classList.remove('hidden'); tableControls.classList.add('hidden');
      saveState();
    });

    btnRemoveTable.addEventListener('click', () => { act.tabla = null; tableWrapper.classList.add('hidden'); tableContainer.innerHTML = ''; saveState(); });

    if (act.tabla) { tableContainer.appendChild(buildActivityTableElement(act)); tableWrapper.classList.remove('hidden'); }

    function refreshImageSection() {
      if (act.imagen && act.imagen.data) {
        imageWrapper.classList.remove('hidden'); imagePreview.src = act.imagen.data; imageCaption.value = act.imagen.caption || '';
        const imageSize = act.imagen.size || 'medium';
        const imagePosition = ['left', 'right'].includes(act.imagen.position) ? act.imagen.position : 'default';
        applyPreviewSize(imagePreview, imageSize);
        sizeBtns.forEach((b) => b.classList.toggle('active', b.dataset.size === imageSize));
        positionBtns.forEach((b) => b.classList.toggle('active', b.dataset.imagePosition === imagePosition));
      } else { imageWrapper.classList.add('hidden'); imagePreview.removeAttribute('src'); }
    }
    refreshImageSection();

    btnAddImage.addEventListener('click', () => openImageModal(act.id));
    sizeBtns.forEach((b) => b.addEventListener('click', () => {
      if (!act.imagen) return; act.imagen.size = b.dataset.size;
      sizeBtns.forEach((x) => x.classList.toggle('active', x === b));
      applyPreviewSize(imagePreview, act.imagen.size); saveState();
    }));
    positionBtns.forEach((b) => b.addEventListener('click', () => {
      if (!act.imagen) return;
      act.imagen.position = b.dataset.imagePosition || 'default';
      positionBtns.forEach((x) => x.classList.toggle('active', x === b));
      saveState();
    }));
    imageCaption.addEventListener('input', () => { if (!act.imagen) return; act.imagen.caption = imageCaption.value; saveState(); });
    btnRemoveImage.addEventListener('click', () => { act.imagen = null; refreshImageSection(); saveState(); });
    btnDelete.addEventListener('click', () => { state.actividades = state.actividades.filter((a) => a.id !== act.id); renderActivities(); saveState(); });

    activitiesList.appendChild(block);
  });
}

document.getElementById('btn-add-activity').addEventListener('click', () => {
  state.actividades.push({ id: uid(), titulo: '', instrucciones: '', tabla: null, imagen: null });
  renderActivities(); saveState();
  const inputs = activitiesList.querySelectorAll('[data-field="titulo"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
});

// =========================================================
// IMAGEN DE ACTIVIDAD — preview, procesamiento y modal
// =========================================================
const PREVIEW_MAXW = { xsmall: '90px', small: '150px', medium: '260px', large: '380px' };

function applyPreviewSize(img, size) { img.style.maxWidth = PREVIEW_MAXW[size] || PREVIEW_MAXW.medium; }

function processImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => {
      const src = reader.result;
      const img = new Image();
      img.onerror = () => reject(new Error('decode'));
      img.onload = () => {
        const natW = img.naturalWidth; const natH = img.naturalHeight; const MAX = 1400; const longest = Math.max(natW, natH);
        const needsResize = longest > MAX; const supported = /^data:image\/(png|jpeg|jpg|gif|bmp);/i.test(src);
        if (!needsResize && supported) { resolve({ data: src, w: natW, h: natH }); return; }
        const scale = needsResize ? MAX / longest : 1; const w = Math.max(1, Math.round(natW * scale)); const h = Math.max(1, Math.round(natH * scale));
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; canvas.getContext('2d').drawImage(img, 0, 0, w, h);
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

function openImageModal(activityId) { currentImageActivityId = activityId; imageModal.classList.remove('hidden'); }
function closeImageModal() { imageModal.classList.add('hidden'); imageDropzone.classList.remove('dragover'); currentImageActivityId = null; }

async function handleImageFiles(files) {
  const file = files && files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { alert('El archivo seleccionado no es una imagen.'); return; }
  const targetId = currentImageActivityId;
  try {
    const processed = await processImageFile(file);
    const act = state.actividades.find((a) => a.id === targetId);
    if (act) { act.imagen = { data: processed.data, w: processed.w, h: processed.h, caption: '', size: 'medium', position: 'default' }; saveState(); renderActivities(); }
  } catch (e) {
    console.error('No se pudo procesar la imagen:', e); alert('No se pudo procesar la imagen. Intenta con otro archivo.');
  } finally { imageFileInput.value = ''; closeImageModal(); }
}

imagePickBtn.addEventListener('click', () => imageFileInput.click());
imageFileInput.addEventListener('change', () => handleImageFiles(imageFileInput.files));
imageModalClose.addEventListener('click', closeImageModal);
imageModal.addEventListener('click', (e) => { if (e.target === imageModal) closeImageModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !imageModal.classList.contains('hidden')) closeImageModal(); });

['dragenter', 'dragover'].forEach((evt) => imageDropzone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); imageDropzone.classList.add('dragover'); }));
['dragleave', 'dragend'].forEach((evt) => imageDropzone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); imageDropzone.classList.remove('dragover'); }));
imageDropzone.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); imageDropzone.classList.remove('dragover'); if (e.dataTransfer && e.dataTransfer.files) handleImageFiles(e.dataTransfer.files); });

let logoBase64 = null;
async function loadLogo() {
  try {
    const res = await fetch('logo.png');
    if (!res.ok) throw new Error('No se encontró logo.png en la raíz del proyecto');
    const blob = await res.blob();
    logoBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
    });
  } catch (e) { console.warn('Logo no disponible:', e.message); logoBase64 = null; }
}

function getEstudiantesParaActa() { return state.estudiantes.slice(); }

let ordPicker, recPicker, ordInstr, recInstr;
function recupFrom(picker, instr) {
  const s = picker ? picker.get() : { indicadores: [], objetivos: [] };
  return { indicadores: s.indicadores, objetivos: s.objetivos, instrumento: instr ? instr.get() : { tipo: 'ninguno', criterios: [] } };
}

function archivar(tipo, ests, extra) {
  if (!window.Expediente) return;
  const cfg = state.configuracion;
  extra = extra || {};
  ests.forEach((est) => {
    window.Expediente.guardar({
      nie: est.nie || '', name: est.name || '', grade: est.grade || '',
      materia: cfg.materia || '—', trimestre: cfg.trimestre || '—', anio: String(cfg.anio || '—'),
      tipo, fecha: new Date().toISOString(),
      payload: {
        config: { ...cfg },
        est: JSON.parse(JSON.stringify(est)),
        actividades: JSON.parse(JSON.stringify(extra.actividades || state.actividades)),
        recup: extra.recup ? JSON.parse(JSON.stringify(extra.recup)) : null,
        refuerzo: extra.refuerzo ? { ...extra.refuerzo } : null,
        ultimoRecurso: extra.ultimoRecurso ? JSON.parse(JSON.stringify(extra.ultimoRecurso)) : null,
      },
    }).catch((e) => console.error('No se pudo archivar:', e));
  });
}

const missingDataModal = document.getElementById('missing-data-modal');
const missingDataList = document.getElementById('missing-data-list');
const missingDataDownload = document.getElementById('missing-data-download');
const missingDataCancel = document.getElementById('missing-data-cancel');
let pendingDownloadAction = null;
let missingDataPreviousFocus = null;

function cerrarModalDatosFaltantes() {
  missingDataModal.classList.add('hidden'); pendingDownloadAction = null;
  if (missingDataPreviousFocus) missingDataPreviousFocus.focus(); missingDataPreviousFocus = null;
}

function confirmarDescargaConFaltantes(faltantes, descargar) {
  const unicos = [...new Set((faltantes || []).filter(Boolean))];
  if (!unicos.length) { descargar(); return; }
  missingDataList.innerHTML = '';
  unicos.forEach((texto) => { const li = document.createElement('li'); li.textContent = texto; missingDataList.appendChild(li); });
  missingDataPreviousFocus = document.activeElement; pendingDownloadAction = descargar;
  missingDataModal.classList.remove('hidden'); missingDataCancel.focus();
}

missingDataDownload.addEventListener('click', () => { const descargar = pendingDownloadAction; cerrarModalDatosFaltantes(); if (descargar) descargar(); });
missingDataCancel.addEventListener('click', cerrarModalDatosFaltantes);
document.getElementById('missing-data-close').addEventListener('click', cerrarModalDatosFaltantes);
missingDataModal.addEventListener('click', (e) => { if (e.target === missingDataModal) cerrarModalDatosFaltantes(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !missingDataModal.classList.contains('hidden')) cerrarModalDatosFaltantes(); });

function sinContenidoHtml(html) { const el = document.createElement('div'); el.innerHTML = html || ''; return !(el.textContent || '').trim() && !el.querySelector('img, table'); }

function faltantesConfiguracion(config, opciones) {
  opciones = opciones || {};
  const campos = [ ['institucion', 'Configuración general · Institución'], ['ubicacion', 'Configuración general · Ubicación'], ['codigo', 'Configuración general · Código'], ['docente', 'Configuración general · Docente'], ['materia', 'Configuración general · Materia'], ['grado', 'Configuración general · Grado'], ['trimestre', 'Configuración general · Periodo'], ['anio', 'Configuración general · Año'] ];
  if (opciones.fechaLimite) campos.push(['fechaLimite', 'Configuración general · Fecha límite']);
  if (opciones.firmas) campos.push(['director', 'Configuración general · Director/a'], ['evaluador', 'Configuración general · Representante del Equipo de Evaluación']);
  return campos.filter(([key]) => !(String(config[key] || '').trim())).map(([, label]) => label);
}

function faltantesEstudiantes(estudiantes, opciones) {
  opciones = opciones || {}; const faltantes = [];
  (estudiantes || []).forEach((est, index) => {
    const referencia = (est.name || '').trim() || `Estudiante ${index + 1}`;
    if (!(est.name || '').trim()) faltantes.push(`Estudiante ${index + 1} · Nombre`);
    // NIE y grado ayudan a identificar, pero el Manual no los establece como requisito
    // de estos documentos. El grado puede tomarse además de la configuración general.
    if (opciones.notaActual && (est.calificacion == null || est.calificacion === '')) faltantes.push(`${referencia} · Nota base`);
  });
  return faltantes;
}

function faltantesCurriculo(recup, incluirObjetivos) {
  const faltantes = []; recup = recup || {};
  if (!(recup.indicadores || []).length) faltantes.push('Currículo · Indicadores de logro');
  if (incluirObjetivos && !(recup.objetivos || []).length) faltantes.push('Currículo · Objetivos de aprendizaje');
  return faltantes;
}

function faltantesInstrumento(recup) {
  const instrumento = recup && recup.instrumento;
  if (!instrumento || instrumento.tipo === 'ninguno') return ['Instrumento de evaluación · Tipo'];
  if (!(instrumento.criterios || []).some((c) => (c.texto || '').trim())) return ['Instrumento de evaluación · Criterios'];
  return [];
}

function faltantesActividades(actividades) {
  if (!(actividades || []).length) return ['Recuperación · Actividades'];
  const faltantes = [];
  actividades.forEach((actividad, index) => {
    if (!(actividad.titulo || '').trim()) faltantes.push(`Actividad de recuperación ${index + 1} · Título`);
    if (sinContenidoHtml(actividad.instrucciones)) faltantes.push(`Actividad de recuperación ${index + 1} · Instrucciones`);
  });
  return faltantes;
}

function faltantesDocumento(tipo, contexto) {
  contexto = contexto || {}; const config = contexto.config || {}; const estudiantes = contexto.estudiantes || [];
  const recup = contexto.recup || {}; const faltantes = [];

  if (tipo === 'ordinaria') {
    faltantes.push(...faltantesConfiguracion(config, { fechaLimite: true }));
    const ord = contexto.ordinaria || {};
    if (!(ord.titulo || '').trim()) faltantes.push('Actividad ordinaria · Título');
    if (sinContenidoHtml(ord.instrucciones)) faltantes.push('Actividad ordinaria · Indicaciones para el estudiante');
    const maxPond = { integradora: 35, cotidiana: 35, prueba: 30 }[ord.tipo] || 0;
    if (!(Number(ord.ponderacion) > 0) || Number(ord.ponderacion) > maxPond) faltantes.push(`Actividad ordinaria · Porcentaje válido (máximo ${maxPond}%)`);
    faltantes.push(...faltantesCurriculo(recup, false), ...faltantesInstrumento(recup));
  } else if (tipo === 'paquete') {
    faltantes.push(...faltantesConfiguracion(config, { fechaLimite: true, firmas: config.incluirActaCompromiso === true }), ...faltantesEstudiantes(estudiantes), ...faltantesCurriculo(recup, false), ...faltantesInstrumento(recup), ...faltantesActividades(contexto.actividades));
  } else if (tipo === 'refuerzo') {
    faltantes.push(...faltantesConfiguracion(config, { firmas: true }), ...faltantesEstudiantes(estudiantes));
    const refuerzo = contexto.refuerzo || {};
    if (!refuerzo.inicio) faltantes.push('Refuerzo educativo · Fecha de inicio');
    if (!refuerzo.fin) faltantes.push('Refuerzo educativo · Fecha de finalización');
    if (!refuerzo.fechaEmision) faltantes.push('Refuerzo educativo · Fecha de emisión de constancia');
    if (!(refuerzo.descripcion || '').trim()) faltantes.push('Refuerzo educativo · Estrategias y actividades realizadas');
    faltantes.push(...faltantesCurriculo(recup, false));
  } else if (tipo === 'cierre' || tipo === 'resultado' || tipo === 'incumplimiento') {
    faltantes.push(...faltantesConfiguracion(config, { fechaLimite: true }));
    const incluyeResultado = tipo === 'resultado' || tipo === 'cierre' && estudiantes.some((e) => e.cierre === 'resultado');
    faltantes.push(...faltantesEstudiantes(estudiantes));
    const estudiantesResultado = tipo === 'resultado' ? estudiantes : estudiantes.filter((e) => e.cierre === 'resultado');
    estudiantesResultado.forEach((est) => { if (est.calificacion == null || est.calificacion === '') faltantes.push(`${est.name || 'Estudiante'} · Nota base`); });
    faltantes.push(...faltantesActividades(contexto.actividades));
    if (incluyeResultado) { if (!config.nivelEducativo) faltantes.push('Cierre · Nivel educativo y nota mínima'); faltantes.push(...faltantesCurriculo(recup, false)); }
    (contexto.sinNota || []).forEach((est) => { faltantes.push(`${est.name || 'Estudiante'} · Nota de recuperación`); });
    (contexto.pendientes || []).forEach((est) => { faltantes.push(`${est.name || 'Estudiante'} · Indicar si entregó la recuperación`); });
  }
  return [...new Set(faltantes)];
}

window.ValidacionDescarga = { confirmar: confirmarDescargaConFaltantes, faltantesDocumento };

function generarPaquete(formato) {
  const estudiantes = getEstudiantesParaActa();
  if (!estudiantes.length) return;
  const recup = recupFrom(recPicker, recInstr);
  const preview = formato === 'preview';
  const descargar = () => {
    const juntarInstrumento = !!state.configuracion.instrumentoMismaPagina;
    const incluirActa = state.configuracion.incluirActaCompromiso === true;
    if (formato === 'word') window.ActasWord.generar(state, estudiantes, logoBase64, recup, { juntarInstrumento, incluirActa });
    else window.ActasPDF.generar(state, estudiantes, logoBase64, recup, { preview, juntarInstrumento, incluirActa });
    if (!preview) { archivar('paquete', estudiantes, { recup }); markGenerado('paquete'); }
  };
  if (preview) descargar();
  else confirmarDescargaConFaltantes(faltantesDocumento('paquete', { config: state.configuracion, estudiantes, recup, actividades: state.actividades }), descargar);
}

document.getElementById('btn-generate-pdf').addEventListener('click', () => generarPaquete('pdf'));
document.getElementById('btn-generate-word').addEventListener('click', () => generarPaquete('word'));
document.getElementById('btn-generate-preview').addEventListener('click', () => generarPaquete('preview'));

function generarCierre(formato) {
  const c = getCierre();
  if (!c.entregados.length && !c.noEntregaron.length) return;
  const preview = formato === 'preview';
  const recup = recupFrom(recPicker, recInstr);
  const gen = formato === 'word' ? window.ActasWord : window.ActasPDF;
  const listos = state.estudiantes.map((e) => {
    if (e.entrego === 'no') return { ...e, cierre: 'incumplimiento' };
    if (e.entrego === 'si' && e.notaRecup != null) return { ...e, cierre: 'resultado', resultado: calcularResultado(e, state.configuracion) };
    return null;
  }).filter(Boolean);
  if (!listos.length) return;
  const descargar = () => {
    if (formato === 'word') gen.generarCierre(state, listos, logoBase64, recup);
    else gen.generarCierre(state, listos, logoBase64, recup, { preview });
    if (!preview) { archivar('resultado', listos.filter((e) => e.cierre === 'resultado'), { recup }); archivar('incumplimiento', listos.filter((e) => e.cierre === 'incumplimiento'), {}); markGenerado('cierre'); }
  };
  if (preview) descargar();
  else confirmarDescargaConFaltantes(faltantesDocumento('cierre', { config: state.configuracion, estudiantes: listos, recup, actividades: state.actividades, sinNota: c.sinNota, pendientes: c.pendientes }), descargar);
}

document.getElementById('btn-cierre-pdf').addEventListener('click', () => generarCierre('pdf'));
document.getElementById('btn-cierre-word').addEventListener('click', () => generarCierre('word'));

document.getElementById('btn-ur-preview').addEventListener('click', () => generarUltimoRecurso('preview'));
document.getElementById('btn-ur-pdf').addEventListener('click', () => generarUltimoRecurso('pdf'));
document.getElementById('btn-ur-word').addEventListener('click', () => generarUltimoRecurso('word'));
document.getElementById('btn-cierre-preview').addEventListener('click', () => generarCierre('preview'));

const REFUERZO_FIELDS = { inicio: 'rec-ref-inicio', fin: 'rec-ref-fin', fechaEmision: 'rec-ref-fecha-emision', descripcion: 'rec-ref-desc' };

function bindRefuerzoFields() {
  Object.entries(REFUERZO_FIELDS).forEach(([key, id]) => {
    const el = document.getElementById(id);
    el.value = state.refuerzo[key] || '';
    const onUpdate = () => { state.refuerzo[key] = el.value; updateRefuerzoButtons(); saveState(); };
    el.addEventListener('input', onUpdate); el.addEventListener('change', onUpdate);
  });
}

function updateRefuerzoButtons() {
  const hint = document.getElementById('refuerzo-hint'); if (!hint) return;
  const total = state.estudiantes.length;
  const tieneDatos = !!((state.refuerzo.descripcion || '').trim() || state.refuerzo.inicio || state.refuerzo.fin);
  const ready = total > 0 && tieneDatos;
  ['btn-refuerzo-preview', 'btn-refuerzo-pdf', 'btn-refuerzo-word'].forEach((id) => { document.getElementById(id).disabled = !ready; });
  hint.textContent = ready ? `Se generará una constancia por cada uno de los ${total} estudiante${total === 1 ? '' : 's'} de la tabla.` : 'Agrega estudiantes y describe el refuerzo para habilitar la constancia.';
}

function generarRefuerzo(formato) {
  const estudiantes = getEstudiantesParaActa();
  if (!estudiantes.length) return;
  const recup = recupFrom(recPicker, recInstr);
  const preview = formato === 'preview';
  const descargar = () => {
    if (formato === 'word') window.ActasWord.generarRefuerzo(state, estudiantes, logoBase64, recup);
    else window.ActasPDF.generarRefuerzo(state, estudiantes, logoBase64, recup, { preview });
    if (!preview) { archivar('refuerzo', estudiantes, { recup, refuerzo: state.refuerzo }); markGenerado('refuerzo'); }
  };
  if (preview) descargar();
  else confirmarDescargaConFaltantes(faltantesDocumento('refuerzo', { config: state.configuracion, estudiantes, recup, refuerzo: state.refuerzo }), descargar);
}

document.getElementById('btn-refuerzo-pdf').addEventListener('click', () => generarRefuerzo('pdf'));
document.getElementById('btn-refuerzo-word').addEventListener('click', () => generarRefuerzo('word'));
document.getElementById('btn-refuerzo-preview').addEventListener('click', () => generarRefuerzo('preview'));

document.getElementById('btn-ordinaria-pdf').addEventListener('click', () => {
  const ord = window.ActividadOrdinaria && window.ActividadOrdinaria.get();
  if (!ord || !ord.titulo) return;
  const recup = recupFrom(ordPicker, ordInstr);
  confirmarDescargaConFaltantes(faltantesDocumento('ordinaria', { config: state.configuracion, ordinaria: ord, recup }), () => window.ActasPDF.generarOrdinaria(state, ord, logoBase64, recup));
});

document.getElementById('btn-ordinaria-preview').addEventListener('click', () => {
  const ord = window.ActividadOrdinaria && window.ActividadOrdinaria.get();
  if (!ord || !ord.titulo) return;
  window.ActasPDF.generarOrdinaria(state, ord, logoBase64, recupFrom(ordPicker, ordInstr), { preview: true });
});

document.getElementById('btn-ordinaria-word').addEventListener('click', () => {
  const ord = window.ActividadOrdinaria && window.ActividadOrdinaria.get();
  if (!ord || !ord.titulo) return;
  const recup = recupFrom(ordPicker, ordInstr);
  confirmarDescargaConFaltantes(faltantesDocumento('ordinaria', { config: state.configuracion, ordinaria: ord, recup }), () => window.ActasWord.generarOrdinaria(state, ord, logoBase64, recup));
});

function ctxOrdinaria() {
  const ord = (window.ActividadOrdinaria && window.ActividadOrdinaria.get()) || {};
  const sel = ordPicker ? ordPicker.get() : { indicadores: [], objetivos: [] };
  return { origen: 'ordinaria', config: state.configuracion, grado: state.configuracion.grado, actividad: { tipoLabel: ord.tipoLabel || '', titulo: ord.titulo || '', ponderacion: ord.ponderacion || '' }, estudiantes: estudiantesDelGrado(state.configuracion.grado), indicadores: sel.indicadores, objetivos: sel.objetivos };
}

function ctxRecuperacion() {
  const sel = recPicker ? recPicker.get() : { indicadores: [], objetivos: [] };
  const cfg = state.configuracion;
  const actividad = state.actividades.find((a) => (a.titulo || '').trim());
  return { origen: 'recuperacion', config: cfg, grado: cfg.grado || (state.estudiantes[0] && state.estudiantes[0].grade) || '', actividad: { tipoLabel: cfg.tipoRecuperacion === 'extraordinaria' ? 'Recuperación extraordinaria' : 'Recuperación ordinaria', titulo: actividad ? actividad.titulo.trim() : '', ponderacion: '' }, estudiantes: state.estudiantes, indicadores: sel.indicadores, objetivos: sel.objetivos };
}

function initPickers() {
  ordPicker = window.createCurriculoPicker(document.getElementById('ord-curriculo'), 'actas-recuperacion:curriculo:ord:v1');
  recPicker = window.createCurriculoPicker(document.getElementById('rec-curriculo'), 'actas-recuperacion:curriculo:rec:v1', { selLabel: 'Indicadores no alcanzados seleccionados' });
  ordInstr = window.createInstrumento(document.getElementById('ord-instrumento'), 'actas-recuperacion:instrumento:ord:v1', () => ordPicker.get().indicadores, { contexto: ctxOrdinaria });
  recInstr = window.createInstrumento(document.getElementById('rec-instrumento'), 'actas-recuperacion:instrumento:rec:v1', () => recPicker.get().indicadores, { contexto: ctxRecuperacion });

  ['ord-curriculo', 'rec-curriculo'].forEach((rootId) => {
    const sel = document.querySelector(`#${rootId} [data-cur="asignatura"]`);
    if (!sel) return;
    sel.addEventListener('change', () => {
      if (!sel.value || (state.configuracion.materia || '').trim()) return;
      const materia = sel.value === 'Matemática' ? 'Matemática y Datos' : normalizarMateria(sel.value);
      if (!materia) return;
      state.configuracion.materia = materia; document.getElementById('cfg-materia').value = materia; saveState();
    });
  });
}

const VIEWS = ['home', 'ordinaria', 'recuperacion', 'documentos', 'expedientes'];
const SECTION_LABELS = { ordinaria: 'Actividad ordinaria', recuperacion: 'Actividad de recuperación', documentos: 'Documentos descargables', expedientes: 'Expedientes' };
const headerSectionTag = document.getElementById('header-section-tag');
const headerSubtitle = document.getElementById('header-subtitle');
const btnClearData = document.getElementById('btn-clear-data');

function showView(name) {
  if (!VIEWS.includes(name)) name = 'home';
  
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
  document.documentElement.removeAttribute('data-initial-view');
  
  document.querySelectorAll('[data-nav]').forEach((b) => { 
    b.addEventListener('click', (e) => { 
      const nav = b.dataset.nav;
      if (nav === 'ordinaria' || nav === 'recuperacion') {
        e.preventDefault();
        e.stopPropagation();
        if (window.Procesos && typeof window.Procesos.nuevo === 'function') {
          window.Procesos.nuevo(nav);
        }
      } else {
        showView(nav); 
      }
    }); 
  });
  
  window.addEventListener('hashchange', () => showView((location.hash || '#home').slice(1)));
  showView((location.hash || '#home').slice(1));
}

function initInfoButtons() {
  document.querySelectorAll('[data-info-target]').forEach((btn) => {
    const msg = document.getElementById(btn.dataset.infoTarget);
    if (!msg) return;
    btn.addEventListener('click', () => { const oculto = msg.classList.toggle('hidden'); btn.setAttribute('aria-expanded', String(!oculto)); });
  });
}

const drawer = document.getElementById('drawer');
const drawerOverlay = document.getElementById('drawer-overlay');
function openDrawer() { drawer.classList.add('open'); drawerOverlay.classList.remove('hidden'); drawer.setAttribute('aria-hidden', 'false'); }
function closeDrawer() { drawer.classList.remove('open'); drawerOverlay.classList.add('hidden'); drawer.setAttribute('aria-hidden', 'true'); }
document.getElementById('btn-drawer').addEventListener('click', openDrawer);
document.getElementById('drawer-close').addEventListener('click', closeDrawer);
drawerOverlay.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer(); });
document.getElementById('btn-export-backup').addEventListener('click', closeDrawer);
document.getElementById('btn-import-backup').addEventListener('click', closeDrawer);

const THEME_NAMES = { default: 'Default', dark: 'Dark', frutiger: 'Frutiger', skeuo: 'Skeuo', glass: 'Glass', sketch: 'Sketch' };
const btnTheme = document.getElementById('btn-theme');
const themeModal = document.getElementById('theme-modal');
const themeModalClose = document.getElementById('theme-modal-close');
const themeModalDone = document.getElementById('theme-modal-done');
const themeSelectionStatus = document.getElementById('theme-selection-status');
const themeRadios = [...document.querySelectorAll('input[name="app-theme"]')];
let themePreviousFocus = null;

function normalizeTheme(theme) { return Object.prototype.hasOwnProperty.call(THEME_NAMES, theme) ? theme : 'default'; }
function applyTheme(theme, persist) {
  const normalized = normalizeTheme(theme);
  document.body.classList.remove('dark', 'frutiger', 'skeuo', 'glass', 'sketch');
  if (normalized !== 'default') document.body.classList.add(normalized);
  document.body.dataset.theme = normalized;
  document.documentElement.style.colorScheme = normalized === 'dark' ? 'dark' : 'light';
  themeRadios.forEach((radio) => {
    radio.checked = radio.value === normalized;
    const option = radio.closest('.theme-option');
    if (option) option.classList.toggle('is-selected', radio.checked);
  });
  if (themeSelectionStatus) themeSelectionStatus.textContent = `Tema ${THEME_NAMES[normalized]} seleccionado.`;
  if (persist) { try { localStorage.setItem(THEME_KEY, normalized); } catch (e) { console.error('No se pudo guardar el tema:', e); } }
  return normalized;
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) { console.error('No se pudo leer el tema guardado:', e); }
  const normalized = applyTheme(saved);
  if (saved && saved !== normalized) { try { localStorage.setItem(THEME_KEY, normalized); } catch (e) {} }
}

function openThemeModal() { themePreviousFocus = document.getElementById('btn-drawer'); closeDrawer(); themeModal.classList.remove('hidden'); applyTheme(document.body.dataset.theme); const selected = themeRadios.find((radio) => radio.checked); requestAnimationFrame(() => { if (selected) selected.focus(); }); }
function closeThemeModal() { if (themeModal.classList.contains('hidden')) return; themeModal.classList.add('hidden'); if (themePreviousFocus) themePreviousFocus.focus(); themePreviousFocus = null; }
function trapThemeModalFocus(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeThemeModal(); return; }
  if (e.key !== 'Tab') return;
  const focusable = [...themeModal.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
  if (!focusable.length) return;
  const first = focusable[0]; const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
btnTheme.addEventListener('click', openThemeModal);
themeModalClose.addEventListener('click', closeThemeModal);
themeModalDone.addEventListener('click', closeThemeModal);
themeModal.addEventListener('click', (e) => { if (e.target === themeModal) closeThemeModal(); });
themeModal.addEventListener('keydown', trapThemeModalFocus);
themeRadios.forEach((radio) => { radio.addEventListener('change', () => { if (radio.checked) applyTheme(radio.value, true); }); });

// =========================================================
// RESPALDOS COMPRIMIDOS (.coeduca)
// - v3: deduplica imágenes Base64 repetidas antes de comprimir con GZIP.
// - Sigue importando los respaldos .json v2 anteriores.
// =========================================================
const BACKUP_FORMAT_LEGACY = 'actas-recuperacion-respaldo';
const BACKUP_FORMAT_COMPRESSED = 'actas-recuperacion-respaldo-comprimido';
const BACKUP_VERSION = 3;
function createBackupImageTokenPrefix() {
  const nonce = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `__COEDUCA_IMG_${nonce}_`;
}

function backupImageToken(prefix, index) {
  return `${prefix}${index}__`;
}

function buildCompressedBackupPackage(data) {
  // Trabajamos sobre el JSON serializado completo para encontrar imágenes incluso
  // dentro de snapshots guardados como strings en localStorage/IndexedDB.
  const imageToIndex = new Map();
  const imagenes = [];
  const tokenPrefix = createBackupImageTokenPrefix();
  const imageDataUrlRe = /data:image\/[a-z0-9.+-]+(?:;[^,\"\\]+)*;base64,[A-Za-z0-9+/=]+/gi;

  const payload = JSON.stringify(data).replace(imageDataUrlRe, (dataUrl) => {
    let index = imageToIndex.get(dataUrl);
    if (index === undefined) {
      index = imagenes.length;
      imageToIndex.set(dataUrl, index);
      imagenes.push(dataUrl);
    }
    return backupImageToken(tokenPrefix, index);
  });

  return {
    formato: BACKUP_FORMAT_COMPRESSED,
    version: BACKUP_VERSION,
    codec: 'gzip-json-dedup-v1',
    fecha: data.fecha,
    tokenPrefix,
    imagenes,
    payload,
  };
}

function restoreCompressedBackupPackage(pkg) {
  if (!pkg || pkg.formato !== BACKUP_FORMAT_COMPRESSED || typeof pkg.payload !== 'string') {
    throw new Error('Paquete de respaldo comprimido inválido.');
  }

  const imagenes = Array.isArray(pkg.imagenes) ? pkg.imagenes : [];
  const tokenPrefix = typeof pkg.tokenPrefix === 'string' ? pkg.tokenPrefix : '';
  if (!tokenPrefix.startsWith('__COEDUCA_IMG_')) throw new Error('Tabla de imágenes del respaldo inválida.');

  const escapedPrefix = tokenPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokenRe = new RegExp(`${escapedPrefix}(\\d+)__`, 'g');
  const payload = pkg.payload.replace(tokenRe, (token, rawIndex) => {
    const index = Number(rawIndex);
    const dataUrl = imagenes[index];
    if (!Number.isInteger(index) || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
      throw new Error(`Referencia de imagen inválida: ${token}`);
    }
    return dataUrl;
  });

  const data = JSON.parse(payload);
  if (!data || data.formato !== BACKUP_FORMAT_LEGACY) {
    throw new Error('El contenido interno del respaldo no es válido.');
  }
  return data;
}

async function gzipText(text) {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('Este navegador no admite CompressionStream.');
  }
  const stream = new Blob([text], { type: 'application/json' })
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Blob([buffer], { type: 'application/gzip' });
}

async function gunzipFile(file) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Este navegador no admite DecompressionStream.');
  }
  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

async function fileIsGzip(file) {
  const header = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  return header.length === 2 && header[0] === 0x1f && header[1] === 0x8b;
}

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
      formato: BACKUP_FORMAT_LEGACY,
      version: BACKUP_VERSION,
      fecha: new Date().toISOString(),
      localStorage: ls,
      expediente,
      procesos,
    };

    const pkg = buildCompressedBackupPackage(data);
    const blob = await gzipText(JSON.stringify(pkg));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const hoy = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `Respaldo_COEDUCA_${hoy}.coeduca`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    console.error('No se pudo exportar el respaldo comprimido:', e);

    // Compatibilidad con navegadores antiguos: no se pierde la función de respaldo.
    if (typeof CompressionStream === 'undefined') {
      try {
        const ls = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('actas-recuperacion:')) ls[k] = localStorage.getItem(k);
        }
        const expediente = window.Expediente ? await window.Expediente.exportAll() : [];
        const procesos = window.Procesos ? await window.Procesos.exportAll() : [];
        const data = { formato: BACKUP_FORMAT_LEGACY, version: 2, fecha: new Date().toISOString(), localStorage: ls, expediente, procesos };
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
        alert('Tu navegador no admite compresión nativa. Se descargó un respaldo JSON compatible.');
        return;
      } catch (fallbackError) {
        console.error('También falló el respaldo JSON de compatibilidad:', fallbackError);
      }
    }

    alert('No se pudo exportar el respaldo. Revisa la consola para más detalles.');
  }
}

let pendingBackup = null;
function resumenBackup(data) {
  const nDocs = Array.isArray(data.expediente) ? data.expediente.length : 0;
  const nProcs = Array.isArray(data.procesos) ? data.procesos.length : 0;
  return `Respaldo del ${fmtFechaCortaApp(data.fecha) || 'sin fecha'} con ${nDocs} documento(s) de expediente y ${nProcs} proceso(s) guardado(s). Elige cómo aplicarlo:`;
}
function openRestoreModal(data) { pendingBackup = data; document.getElementById('restore-modal-summary').textContent = resumenBackup(data); document.getElementById('restore-modal').classList.remove('hidden'); }
function closeRestoreModal() { document.getElementById('restore-modal').classList.add('hidden'); pendingBackup = null; }

async function aplicarBackup(data, modo) {
  try {
    if (modo === 'reemplazar') {
      for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith('actas-recuperacion:')) localStorage.removeItem(k); }
      if (window.Expediente) await window.Expediente.clearAll(); if (window.Procesos) await window.Procesos.clearAll();
    }
    Object.entries(data.localStorage || {}).forEach(([k, v]) => { if (k.startsWith('actas-recuperacion:')) localStorage.setItem(k, v); });
    const nDocs = Array.isArray(data.expediente) ? data.expediente.length : 0; const nProcs = Array.isArray(data.procesos) ? data.procesos.length : 0;
    if (window.Expediente && nDocs) await window.Expediente.importAll(data.expediente);
    if (window.Procesos && nProcs) await window.Procesos.importAll(data.procesos);
    alert('Respaldo restaurado. La página se recargará para aplicar los cambios.'); location.reload();
  } catch (e) { console.error('No se pudo importar el respaldo:', e); alert('Ocurrió un error al restaurar el respaldo. Revisa la consola.'); }
}

async function importBackup(file) {
  let parsed;
  try {
    const isGzip = await fileIsGzip(file);
    const text = isGzip ? await gunzipFile(file) : await file.text();
    parsed = JSON.parse(text);
  } catch (e) {
    console.error('No se pudo leer el respaldo:', e);
    const detail = typeof DecompressionStream === 'undefined'
      ? 'Este navegador no admite la descompresión del nuevo formato.'
      : 'El archivo está dañado o no tiene un formato reconocido.';
    alert(`No se pudo leer el respaldo. ${detail}`);
    return;
  }

  let data = parsed;
  try {
    if (parsed && parsed.formato === BACKUP_FORMAT_COMPRESSED) {
      data = restoreCompressedBackupPackage(parsed);
    }
  } catch (e) {
    console.error('No se pudo reconstruir el respaldo comprimido:', e);
    alert('El respaldo comprimido está incompleto o dañado.');
    return;
  }

  if (!data || data.formato !== BACKUP_FORMAT_LEGACY) {
    alert('El archivo no es un respaldo de esta plataforma.');
    return;
  }
  openRestoreModal(data);
}

document.getElementById('restore-modal-unir').addEventListener('click', () => { const data = pendingBackup; closeRestoreModal(); if (data) aplicarBackup(data, 'unir'); });
document.getElementById('restore-modal-reemplazar').addEventListener('click', () => { const data = pendingBackup; if (!data) return; if (!confirm('Esto BORRARÁ todos tus procesos y expedientes actuales y los sustituirá por los del archivo. Esta acción no se puede deshacer. ¿Continuar?')) return; closeRestoreModal(); aplicarBackup(data, 'reemplazar'); });
document.getElementById('restore-modal-close').addEventListener('click', closeRestoreModal);
document.getElementById('restore-modal').addEventListener('click', (e) => { if (e.target.id === 'restore-modal') closeRestoreModal(); });
document.addEventListener('keydown', (e) => { const rm = document.getElementById('restore-modal'); if (e.key === 'Escape' && rm && !rm.classList.contains('hidden')) closeRestoreModal(); });

document.getElementById('btn-export-backup').addEventListener('click', exportBackup);
const importInput = document.getElementById('import-backup-input');
document.getElementById('btn-import-backup').addEventListener('click', () => importInput.click());
importInput.addEventListener('change', () => { if (importInput.files && importInput.files[0]) importBackup(importInput.files[0]); importInput.value = ''; });

document.getElementById('btn-clear-data').addEventListener('click', () => {
  const confirmado = confirm('¿Seguro que deseas borrar todos los datos ingresados (configuración, estudiantes, actividades y refuerzo)? Los expedientes archivados NO se borran. Esta acción no se puede deshacer.');
  if (!confirmado) return;
  localStorage.removeItem(STORAGE_KEY);
  ['actas-recuperacion:instrumento:ord:v1', 'actas-recuperacion:instrumento:rec:v1', 'actas-recuperacion:ordinaria:v1'].forEach((k) => localStorage.removeItem(k));
  if (ordPicker) ordPicker.clear(); if (recPicker) recPicker.clear();
  state.configuracion = { ...DEFAULT_CONFIG }; state.estudiantes = []; state.actividades = []; state.refuerzo = { inicio: '', fin: '', fechaEmision: fechaHoyISO(), descripcion: '' }; state.ultimoRecurso = { titulo: '', instrucciones: '', fecha: '', estudiantes: {} }; state.generados = {}; state.checklist = {};
  const actaSwitch = document.getElementById('cfg-incluir-acta-compromiso'); if (actaSwitch) actaSwitch.checked = false;
  const paginaSwitch = document.getElementById('cfg-instrumento-misma-pagina'); if (paginaSwitch) paginaSwitch.checked = false;
  updateRecoveryModeUI();
  Object.entries(CONFIG_FIELD_IDS).forEach(([key, id]) => { document.getElementById(id).value = state.configuracion[key] || ''; });
  Object.entries(REFUERZO_FIELDS).forEach(([key, id]) => { document.getElementById(id).value = state.refuerzo[key] || ''; });
  const urTitulo = document.getElementById('ur-titulo'); if (urTitulo) urTitulo.value = '';
  const urFecha = document.getElementById('ur-fecha'); if (urFecha) urFecha.value = '';
  const urInstr = document.getElementById('ur-instrucciones'); if (urInstr) urInstr.value = '';
  renderStudents(); renderActivities(); renderChecklist(); setFase('1'); saveState();
});


// =========================================================
// ESTADO VISUAL DEL STICKY HEADER DE FASES
// =========================================================
function initStickyFaseNav() {
  const nav = document.querySelector('.fase-nav-sticky');
  const flow = nav && nav.closest('.fase-flow');
  if (!nav || !flow) return;

  let ticking = false;
  const update = () => {
    ticking = false;
    const navRect = nav.getBoundingClientRect();
    const flowRect = flow.getBoundingClientRect();
    const isStuck = flowRect.top <= 0.5 && navRect.top <= 0.5 && flowRect.bottom > navRect.height;
    nav.classList.toggle('is-stuck', isStuck);
  };
  const requestUpdate = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };

  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate, { passive: true });
  requestUpdate();
}

loadState(); bindConfigFields(); bindRefuerzoFields(); bindUltimoRecurso(); renderStudents(); renderActivities(); renderChecklist(); initFases(); initStickyFaseNav(); initPickers(); initInfoButtons(); initRouter(); loadLogo(); initTheme();
window.AppLogo = () => logoBase64;
try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}
