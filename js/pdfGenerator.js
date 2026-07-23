// =========================================================
// Generación de PDF — Acta de compromiso + Instructivo
// Usa pdfmake (cargado vía CDN en index.html)
// =========================================================

const COLOR_NAVY = '#1B3A5C';
const COLOR_SLATE = '#5A5A5A';
const COLOR_INK = '#0E1F30';

// ---------- Utilidades ----------
function fmtFecha(isoDate) {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.split('-');
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}

function sanitizeFilename(str) {
  return (str || 'sin-dato')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim();
}

const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Fecha en formato largo espa\u00f1ol: "16 de abril de 2026"
function fmtFechaLarga(isoDate) {
  if (!isoDate) return '____________________';
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return `${d} de ${MESES_ES[m - 1]} de ${y}`;
}

function fechaHoyLarga() {
  const hoy = new Date();
  return `${hoy.getDate()} de ${MESES_ES[hoy.getMonth()]} de ${hoy.getFullYear()}`;
}

// Nota con un decimal (7 → "7.0")
function fmtNota(n) {
  return (n == null || isNaN(Number(n))) ? '—' : Number(n).toFixed(1);
}

// Descarga el PDF, o lo abre en una pestaña si opts.preview es true.
function outputPdf(docDefinition, filename, opts) {
  const pdf = pdfMake.createPdf(docDefinition);
  if (opts && opts.preview) pdf.open();
  else pdf.download(filename);
}

// Referencia a las actividades de recuperaci\u00f3n asignadas (parte 3).
function referenciaActividades(actividades) {
  const titulos = (actividades || [])
    .map((a) => (a.titulo || '').trim())
    .filter(Boolean);
  if (!titulos.length) return 'la Actividad de Recuperaci\u00f3n asignada';
  if (titulos.length === 1) return `la Actividad de Recuperaci\u00f3n \u00ab${titulos[0]}\u00bb`;
  return `las Actividades de Recuperaci\u00f3n asignadas (${titulos.join('; ')})`;
}

// Límite del lado mayor (en píxeles) según el tamaño elegido en el framework.
const IMG_SIZE_MAX_PX = { xsmall: 140, small: 240, medium: 400, large: 620 };

// Ajusta la imagen a su tope de tamaño sin ampliarla ni deformarla. Devuelve px.
function computeImageDims(natW, natH, size) {
  const max = IMG_SIZE_MAX_PX[size] || IMG_SIZE_MAX_PX.medium;
  if (!natW || !natH) return { w: max, h: max };
  const scale = Math.min(max / natW, max / natH, 1);
  return { w: Math.round(natW * scale), h: Math.round(natH * scale) };
}

function headerCell(text) {
  return { text: (text || '').toUpperCase(), style: 'sectionLabel' };
}

function valueCell(text) {
  return { text: text || '—', style: 'fieldValue' };
}

// ---------- Bloques reutilizables ----------
function buildConfigTable(config) {
  return {
    table: {
      widths: ['*', '*', '*', '*'],
      body: [
        [headerCell('Institución'), headerCell('Código'), headerCell('Docente'), headerCell('Materia')],
        [valueCell(config.institucion), valueCell(config.codigo), valueCell(config.docente), valueCell(config.materia)],
        [headerCell('Ubicación'), headerCell('Trimestre'), headerCell('Año'), headerCell('Fecha límite')],
        [valueCell(config.ubicacion), valueCell(config.trimestre), valueCell(config.anio), valueCell(fmtFecha(config.fechaLimite))],
      ],
    },
    layout: 'noBorders',
    margin: [0, 0, 0, 8],
  };
}

// Tabla compacta de campos clave (Materia/Maestro/Estudiante/NIE/Fecha de
// emisión, etc.) para los documentos formales de incumplimiento, resultado y
// refuerzo — reemplaza las líneas sueltas "Etiqueta: valor" por una tabla,
// igual que en el acta de compromiso.
function buildInfoTable(fields, cols) {
  cols = cols || 3;
  const rows = [];
  for (let i = 0; i < fields.length; i += cols) {
    let slice = fields.slice(i, i + cols);
    while (slice.length < cols) slice = slice.concat([{ label: '', value: '' }]);
    rows.push(slice.map((f) => ({ text: (f.label || '').toUpperCase(), style: 'infoTh' })));
    rows.push(slice.map((f) => ({ text: f.value || '', style: 'infoVal' })));
  }
  return {
    table: { widths: Array(cols).fill('*'), body: rows },
    layout: {
      hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 1 : 0),
      vLineWidth: () => 0,
      hLineColor: () => '#E2E6EA',
      paddingTop: (i) => (i % 2 === 0 ? 4 : 1),
      paddingBottom: (i) => (i % 2 === 0 ? 1 : 5),
      paddingLeft: () => 4,
      paddingRight: () => 4,
    },
    margin: [0, 2, 0, 10],
  };
}

function buildStudentTable(est) {
  return {
    table: {
      widths: ['*', '*', '*', '*'],
      body: [
        [headerCell('Estudiante'), headerCell('NIE'), headerCell('Grado'), headerCell('Nota actual')],
        [
          valueCell(est.name),
          valueCell(est.nie),
          valueCell(est.grade),
          { text: est.calificacion != null ? `${est.calificacion}/10` : 'Sin registrar', style: 'fieldValueAlert' },
        ],
      ],
    },
    layout: {
      hLineWidth: (i) => (i === 0 ? 1 : 0),
      vLineWidth: () => 0,
      hLineColor: () => '#E2E6EA',
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },
    margin: [0, 0, 0, 10],
  };
}

function buildCompromiseText(est, config) {
  const texto =
    `Por medio de la presente, yo, ${est.name || '__________________'}, con Número de ` +
    `Identificación Estudiantil (NIE) ${est.nie || '__________'}, cursante de ${est.grade || '__________'}, ` +
    `en la asignatura de ${config.materia || '__________'}, me comprometo a realizar y entregar las ` +
    `actividades de recuperación académica correspondientes al ${config.trimestre || 'trimestre'} del año ` +
    `${config.anio || '____'}, a más tardar el ${fmtFecha(config.fechaLimite)}. Entiendo que el cumplimiento ` +
    `de este compromiso es indispensable para superar las deficiencias académicas identificadas y continuar ` +
    `mi proceso de aprendizaje de manera satisfactoria. Asimismo, declaro ser conocedor(a) y estar consciente ` +
    `del contenido de esta acta y de las actividades de recuperación que se me asignan.`;
  return { text: texto, style: 'compromiseText', margin: [0, 0, 0, 18] };
}

function signatureLine(role, name) {
  return {
    width: '*',
    stack: [
      { text: ' ', margin: [0, 20, 0, 0] },   // espacio para firmar sobre la línea
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 150, y2: 0, lineWidth: 1, lineColor: COLOR_SLATE }] },
      name ? { text: name, style: 'signatureName', margin: [0, 2, 0, 0] } : { text: '', margin: [0, 2, 0, 0] },
      { text: role, style: 'signatureLabel' },
    ],
  };
}

// Firmas conforme a la Normativa de Evaluación, num. 15.d: la constancia de
// notificación de recuperación debe ir firmada por el director, el docente
// responsable de grado y un representante del Equipo de Evaluación. Se añade el
// recibido del estudiante y su familia (num. 15.c).
function buildSignatureBlock(config) {
  config = config || {};
  return {
    stack: [
      { text: 'AVAL INSTITUCIONAL — Constancia de notificación (Normativa de Evaluación, num. 15.d)', style: 'sigGroupLabel', margin: [0, 10, 0, 2] },
      {
        columns: [
          signatureLine('Director/a', config.director),
          signatureLine('Docente responsable de grado', config.docente),
          signatureLine('Representante del Equipo de Evaluación', config.evaluador),
        ],
        columnGap: 16,
      },
      { text: 'RECIBIDO Y COMPROMISO', style: 'sigGroupLabel', margin: [0, 14, 0, 2] },
      {
        columns: [
          signatureLine('Firma del estudiante', ''),
          { text: '', width: '*' },
          { text: '', width: '*' },
        ],
        columnGap: 16,
      },
    ],
    margin: [0, 6, 0, 0],
  };
}

// ---------- Recuperación: indicadores no alcanzados + objetivos + instrumento ----------
const EMPTY_RECUP = { indicadores: [], objetivos: [], instrumento: { tipo: 'ninguno', criterios: [] } };

function buildIndicadoresBlock(indicadores, title) {
  if (!indicadores || !indicadores.length) return [];
  return [
    { text: title || 'Indicadores de logro no alcanzados', style: 'sectionHeading' },
    {
      ul: indicadores.map((ind) => ({
        text: [
          ind.codigo && ind.codigo !== '—' ? { text: `${ind.codigo}  `, bold: true } : '',
          ind.texto || '',
        ],
        style: 'listItem',
      })),
      margin: [0, 0, 0, 8],
    },
  ];
}

function buildObjetivosBlock(objetivos) {
  if (!objetivos || !objetivos.length) return [];
  return [
    { text: 'Objetivos de aprendizaje', style: 'sectionHeading' },
    {
      ul: objetivos.map((o) => ({ text: o, style: 'listItem' })),
      margin: [0, 0, 0, 8],
    },
  ];
}

function buildActaContent(est, config, recup) {
  recup = recup || { indicadores: [], objetivos: [] };
  return [
    { text: 'ACTA DE COMPROMISO DE RECUPERACIÓN ACADÉMICA', style: 'actaTitle' },
    buildConfigTable(config),
    buildStudentTable(est),
    ...buildIndicadoresBlock(recup.indicadores),
    ...buildObjetivosBlock(recup.objetivos),
    buildCompromiseText(est, config),
    {
      text: 'El presente documento constituye la constancia de notificación al estudiante y su familia del proceso de recuperación requerido, conforme a la Normativa de Evaluación al Servicio del Aprendizaje y del Desarrollo (num. 15.d).',
      style: 'notificacionNota',
      margin: [0, 0, 0, 4],
    },
    buildSignatureBlock(config),
  ];
}

// ---------- Instrumento de evaluación (3.ª hoja) ----------
function buildInstrumentoContent(instrumento) {
  if (!instrumento || instrumento.tipo === 'ninguno') return [];
  const criterios = (instrumento.criterios || []).filter((c) => (c.texto || '').trim());
  if (!criterios.length) return [];

  const th = (t) => ({ text: (t || '').toUpperCase(), style: 'instTh' });
  const cell = (t, style) => ({ text: t || '', style: style || 'instCell' });

  // Función auxiliar para limpiar saltos de línea y espacios sobrantes
  const cleanText = (t) => (t || '').replace(/\s+/g, ' ').trim();

  let table;
  if (instrumento.tipo === 'rubrica') {
    const escala = instrumento.escala && instrumento.escala.length
      ? instrumento.escala
      : [{ label: 'Excelente', puntos: 4 }, { label: 'Muy bueno', puntos: 3 }, { label: 'Bueno', puntos: 2 }, { label: 'Debe mejorar', puntos: 1 }];
    const header = [th('Criterio'), ...escala.map((n) => th(`${n.label} (${n.puntos})`))];
    const body = criterios.map((c) => [
      cell(cleanText(c.texto), 'instCriterio'),
      ...escala.map((_, i) => cell(cleanText((c.desc && c.desc[i]) || ''), 'instCell')),
    ]);
    table = {
      // 40% para el criterio, el resto (*) se divide equitativamente en la escala
      table: { widths: ['40%', ...escala.map(() => '*')], headerRows: 1, body: [header, ...body] },
      layout: instTableLayout(),
      margin: [0, 6, 0, 0],
    };
  } else {
    const header = [th('Criterio'), th('Sí logra'), th('No logra'), th('Observaciones')];
    const body = criterios.map((c) => [
      cell(cleanText(c.texto), 'instCriterio'), 
      cell('', 'instMark'), 
      cell('', 'instMark'), 
      cell('')
    ]);
    table = {
      // 45% para el criterio, 'auto' ajusta las casillas Sí/No al texto, y el resto para observaciones
      table: { widths: ['45%', 'auto', 'auto', '*'], headerRows: 1, body: [header, ...body] },
      layout: instTableLayout(),
      margin: [0, 6, 0, 0],
    };
  }

  const titulo = instrumento.tipo === 'rubrica' ? 'INSTRUMENTO DE EVALUACIÓN · RÚBRICA' : 'INSTRUMENTO DE EVALUACIÓN · LISTA DE COTEJO';
  return [
    { text: titulo, style: 'instructivoTitle' },
    { text: 'Instrumento con el que se valorará la actividad de recuperación.', style: 'fieldValueMuted', margin: [0, 0, 0, 8] },
    table,
  ];
}

function instTableLayout() {
  return {
    hLineWidth: () => 0.5,
    vLineWidth: () => 0.5,
    hLineColor: () => '#C9D2DA',
    vLineColor: () => '#C9D2DA',
    paddingTop: () => 5,
    paddingBottom: () => 5,
    paddingLeft: () => 6,
    paddingRight: () => 6,
  };
}

// ---------- Texto enriquecido (negrita / cursiva / subrayado) ----------
// Convierte el HTML generado por el editor (contenteditable) en párrafos de
// "runs" que pdfmake entiende como texto con formato mixto.
function parseRichHtml(html) {
  if (!html) return [];
  const container = document.createElement('div');
  container.innerHTML = html;

  const paragraphs = [];
  let currentRuns = [];

  function pushParagraph() {
    if (currentRuns.length) paragraphs.push(currentRuns);
    currentRuns = [];
  }

  function walk(node, style) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) currentRuns.push({ text: node.textContent, ...style });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName.toLowerCase();
    if (tag === 'br') {
      pushParagraph();
      return;
    }

    const newStyle = { ...style };
    if (tag === 'b' || tag === 'strong') newStyle.bold = true;
    if (tag === 'i' || tag === 'em') newStyle.italics = true;
    if (tag === 'u') newStyle.decoration = 'underline';

    const isBlock = tag === 'div' || tag === 'p';
    node.childNodes.forEach((child) => walk(child, newStyle));
    if (isBlock) pushParagraph();
  }

  container.childNodes.forEach((child) => walk(child, {}));
  pushParagraph();

  return paragraphs.filter((p) => p.length > 0);
}

function buildActivityTablePdf(tabla) {
  return {
    table: {
      widths: Array(tabla.columnas).fill('*'),
      body: tabla.celdas.map((row) => row.map((cell) => ({ text: cell || '', style: 'tableCell' }))),
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#C9D2DA',
      vLineColor: () => '#C9D2DA',
      paddingTop: () => 4,
      paddingBottom: () => 4,
      paddingLeft: () => 5,
      paddingRight: () => 5,
    },
    margin: [0, 6, 0, 12],
  };
}

function buildInstructivoContent(est, config, actividades, recup) {
  recup = recup || { objetivos: [] };
  const content = [
    { text: 'INSTRUCTIVO DE ACTIVIDADES DE RECUPERACIÓN', style: 'instructivoTitle' },
    {
      columns: [
        { text: est.name || '—', style: 'fieldValue', bold: true },
        { text: `NIE: ${est.nie || '—'}`, style: 'fieldValue', alignment: 'right' },
      ],
      margin: [0, 0, 0, 6],
    },
    {
      text: `${config.materia || ''} · ${config.trimestre || ''} ${config.anio || ''} · Fecha límite: ${fmtFecha(config.fechaLimite)}`,
      style: 'fieldValueMuted',
      margin: [0, 0, 0, 10],
    },
    ...buildObjetivosBlock(recup.objetivos),
  ];

  if (!actividades.length) {
    content.push({
      text: 'No se definieron actividades de recuperación para este trimestre.',
      style: 'fieldValueMuted',
      italics: true,
    });
  } else {
    actividades.forEach((act, i) => {
      content.push({ text: `${i + 1}. ${act.titulo || 'Actividad sin título'}`, style: 'activityTitle' });

      const paragraphs = parseRichHtml(act.instrucciones);
      if (paragraphs.length) {
        paragraphs.forEach((runs) => {
          content.push({ text: runs, style: 'activityBody', margin: [0, 0, 0, 4] });
        });
      } else {
        content.push({ text: '—', style: 'activityBody' });
      }

      if (act.tabla && act.tabla.celdas && act.tabla.celdas.length) {
        content.push(buildActivityTablePdf(act.tabla));
      }

      if (act.imagen && act.imagen.data) {
        const dims = computeImageDims(act.imagen.w, act.imagen.h, act.imagen.size);
        content.push({
          image: act.imagen.data,
          width: dims.w * 0.75, // px → pt (preserva proporción con el alto automático)
          margin: [0, 6, 0, act.imagen.caption ? 2 : 12],
        });
        if (act.imagen.caption) {
          content.push({ text: act.imagen.caption, style: 'imageCaption', margin: [0, 0, 0, 12] });
        }
      }
    });
  }

  return content;
}

// ---------- Encabezado / pie de página global ----------
const HEADER_LOGO_SIZE = 26;

function buildPageHeader(config, logoBase64) {
  // Centrado vertical aproximado: la línea de texto (fontSize 8, lineHeight ~1)
  // mide ~10pt; se empuja hacia abajo la mitad de la diferencia con el logo.
  const textLineHeight = 10;
  const verticalOffset = Math.max(0, (HEADER_LOGO_SIZE - textLineHeight) / 2);

  return (currentPage, pageCount) => ({
    margin: [40, 18, 40, 0],
    columns: [
      logoBase64
        ? { image: logoBase64, width: HEADER_LOGO_SIZE, height: HEADER_LOGO_SIZE, margin: [0, 0, 8, 0] }
        : { text: '', width: HEADER_LOGO_SIZE },
      {
        text: config.institucion || 'Institución educativa',
        style: 'headerInstitucion',
        width: '*',
        margin: [0, verticalOffset, 0, 0],
      },
      {
        text: `Página ${currentPage} de ${pageCount}`,
        style: 'headerPage',
        alignment: 'right',
        width: 'auto',
        margin: [0, verticalOffset, 0, 0],
      },
    ],
    columnGap: 6,
  });
}

// ---------- Construcción y descarga del PDF ----------
function generarPdf(state, estudiantes, logoBase64, recup, opts) {
  if (!estudiantes.length) return;

  recup = recup || EMPTY_RECUP;

  const body = [];
  estudiantes.forEach((est, index) => {
    if (index > 0) body.push({ text: '', pageBreak: 'before' });
    body.push(...buildActaContent(est, state.configuracion, recup));
    body.push({ text: '', pageBreak: 'before' });
    body.push(...buildInstructivoContent(est, state.configuracion, state.actividades, recup));
    // Se reconstruye para cada estudiante: pdfmake muta los objetos de la tabla
    // durante el layout, así que reutilizar la misma referencia entre páginas
    // deja vacías las tablas de todos los estudiantes salvo el primero.
    const instrumentoContent = buildInstrumentoContent(recup.instrumento);
    if (instrumentoContent.length) {
      // Con la opción activada, el instrumento fluye justo debajo del instructivo
      // (sin salto de página) para aprovechar la hoja cuando ambos son cortos.
      if (!(opts && opts.juntarInstrumento)) {
        body.push({ text: '', pageBreak: 'before' });
      } else {
        body.push({ text: '', margin: [0, 12, 0, 0] });
      }
      body.push(...instrumentoContent);
    }
  });

  const docDefinition = {
    pageSize: 'LETTER',
    pageMargins: [40, 60, 40, 40],
    header: buildPageHeader(state.configuracion, logoBase64),
    content: body,
    defaultStyle: { fontSize: 9, color: COLOR_INK },
    styles: {
      headerInstitucion: { fontSize: 8, bold: true, color: COLOR_SLATE },
      headerPage: { fontSize: 8, color: COLOR_SLATE },
      actaTitle: { fontSize: 13, bold: true, color: COLOR_NAVY, alignment: 'center', margin: [0, 0, 0, 12] },
      sectionLabel: { fontSize: 7, bold: true, color: COLOR_SLATE, margin: [0, 0, 0, 1] },
      fieldValue: { fontSize: 9, color: COLOR_INK, margin: [0, 0, 0, 6] },
      fieldValueAlert: { fontSize: 10, bold: true, color: '#B54708', margin: [0, 0, 0, 6] },
      fieldValueMuted: { fontSize: 8, color: COLOR_SLATE },
      compromiseText: { fontSize: 9, color: COLOR_INK, lineHeight: 1.2, alignment: 'justify' },
      signatureLabel: { fontSize: 7.5, color: COLOR_SLATE, alignment: 'center', margin: [0, 3, 0, 0] },
      signatureName: { fontSize: 8.5, color: COLOR_INK, alignment: 'center' },
      sigGroupLabel: { fontSize: 7, bold: true, color: COLOR_NAVY },
      notificacionNota: { fontSize: 7.5, italics: true, color: COLOR_SLATE, alignment: 'justify' },
      instructivoTitle: { fontSize: 12, bold: true, color: COLOR_NAVY, margin: [0, 0, 0, 8] },
      activityTitle: { fontSize: 10, bold: true, color: COLOR_NAVY, margin: [0, 8, 0, 2] },
      activityBody: { fontSize: 8.5, color: COLOR_INK, lineHeight: 1.2 },
      tableCell: { fontSize: 8.5, color: COLOR_INK },
      imageCaption: { fontSize: 8, italics: true, color: COLOR_SLATE },
      sectionHeading: { fontSize: 9.5, bold: true, color: COLOR_NAVY, margin: [0, 3, 0, 3] },
      listItem: { fontSize: 8.5, color: COLOR_INK, lineHeight: 1.15, margin: [0, 0, 0, 1] },
      instTh: { fontSize: 7.5, bold: true, color: COLOR_SLATE, fillColor: '#EEF2F6' },
      instCell: { fontSize: 8.5, color: COLOR_INK },
      instCriterio: { fontSize: 8.5, bold: true, color: COLOR_INK },
      instMark: { fontSize: 11, color: COLOR_SLATE, alignment: 'center' },
    },
  };

  const filename = `Actas ${sanitizeFilename(state.configuracion.codigo)} - ${sanitizeFilename(state.configuracion.trimestre)} - ${sanitizeFilename(state.configuracion.anio)}.pdf`;
  outputPdf(docDefinition, filename, opts);
}

// =========================================================
// ACTA DE INCUMPLIMIENTO DE ACTIVIDAD DE RECUPERACIÓN
// (documento independiente — un acta por estudiante)
// =========================================================
// Firmas del acta de incumplimiento conforme al num. 15.d (aval institucional:
// director, docente responsable de grado y representante del Equipo de
// Evaluación) + recibido del estudiante. Nombre debajo de la línea.
function buildSignatureIncumplimiento(config) {
  const columna = (role, name) => ({
    width: '*',
    stack: [
      { text: ' ', margin: [0, 22, 0, 0] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 165, y2: 0, lineWidth: 1, lineColor: COLOR_INK }] },
      name ? { text: name, style: 'incSigName', alignment: 'center', margin: [0, 2, 0, 0] } : { text: '', margin: [0, 2, 0, 0] },
      { text: role, style: 'incSigRole', alignment: 'center' },
    ],
  });
  return [
    { text: 'AVAL INSTITUCIONAL — Constancia de notificación (Normativa de Evaluación, num. 15.d)', style: 'incSigGroup', margin: [0, 10, 0, 2] },
    {
      columns: [
        columna('Director/a', config.director),
        columna('Docente responsable de grado', config.docente),
        columna('Representante del Equipo de Evaluación', config.evaluador),
      ],
      columnGap: 16,
    },
    { text: 'RECIBIDO', style: 'incSigGroup', margin: [0, 12, 0, 2] },
    {
      columns: [
        columna('Firma del Estudiante', ''),
        { text: '', width: '*' },
        { text: '', width: '*' },
      ],
      columnGap: 16,
    },
  ];
}

function buildActaIncumplimientoContent(est, config, actividades, fechaEmision, logoBase64) {
  const nombre = est.name || '__________________';
  const nie = est.nie || '__________';
  const ref = referenciaActividades(actividades);

  const parrafo1 =
    `Por medio de la presente se deja constancia formal de que el estudiante ${nombre}, con ` +
    `NIE ${nie}, NO realizó la entrega de ${ref}. Se hace constar que, aunque la fecha límite ` +
    `para la entrega se estableció para el ${fmtFechaLarga(config.fechaLimite)}, el estudiante ` +
    `no realizó la entrega correspondiente dentro del plazo otorgado.`;

  const parrafo2 =
    `Se hace constar que el estudiante fue notificado oportunamente de la actividad de recuperación ` +
    `asignada y del plazo establecido para su entrega, sin que se recibiera el trabajo correspondiente ` +
    `dentro del período estipulado.`;

  const parrafo3 = `En consecuencia, la calificación asignada para esta actividad es de cero (0.0).`;

  const parrafo4 = `Para los usos que se estimen convenientes, se firma la presente acta.`;

  const encabezado = [];
  if (logoBase64) {
    encabezado.push({ image: logoBase64, width: 54, height: 54, alignment: 'center', margin: [0, 0, 0, 6] });
  }
  encabezado.push(
    { text: (config.institucion || 'Institución educativa').toUpperCase(), style: 'incInst' },
    { text: `(${config.ubicacion || ''})`, style: 'incLoc' },
    { text: `Código: ${config.codigo || '—'}`, style: 'incCode' },
  );

  return [
    ...encabezado,
    { text: '', margin: [0, 0, 0, 10] },
    buildInfoTable([
      { label: 'Materia', value: config.materia },
      { label: 'Maestro', value: config.docente },
      { label: 'Fecha de emisión', value: fechaEmision },
      { label: 'Estudiante', value: nombre },
      { label: 'NIE', value: nie },
    ]),
    { text: 'ACTA DE INCUMPLIMIENTO DE ACTIVIDAD DE RECUPERACIÓN', style: 'incTitle' },
    { text: parrafo1, style: 'incBody' },
    { text: parrafo2, style: 'incBody' },
    { text: parrafo3, style: 'incBody' },
    { text: parrafo4, style: 'incBody' },
    ...buildSignatureIncumplimiento(config),
  ];
}

function generarActaIncumplimientoPdf(state, students, logoBase64, opts) {
  if (!students.length) return;
  const fechaEmision = fechaHoyLarga();

  const body = [];
  students.forEach((est, index) => {
    if (index > 0) body.push({ text: '', pageBreak: 'before' });
    body.push(...buildActaIncumplimientoContent(est, state.configuracion, state.actividades, fechaEmision, logoBase64));
  });

  const docDefinition = {
    pageSize: 'LETTER',
    pageMargins: [50, 44, 50, 40],
    content: body,
    defaultStyle: { fontSize: 9, color: COLOR_INK },
    styles: formalDocStyles(),
  };

  const filename = `Actas de Incumplimiento ${sanitizeFilename(state.configuracion.codigo)} - ${sanitizeFilename(state.configuracion.anio)}.pdf`;
  outputPdf(docDefinition, filename, opts);
}

// =========================================================
// ACTA DE RESULTADO DE ACTIVIDAD DE RECUPERACIÓN
// El estudiante SÍ entregó: registra la nota obtenida y aplica la regla
// del Manual — num. 13.1.c (ordinaria: sustituye solo si es mayor) o
// num. 13.2.c (extraordinaria: promedio con el promedio final reprobado).
// =========================================================
const NIVEL_LABEL = { basica: 'Educación Básica', media: 'Educación Media' };

// Encabezado formal compartido (logo centrado + institución + código).
function buildEncabezadoFormal(config, logoBase64) {
  const encabezado = [];
  if (logoBase64) {
    encabezado.push({ image: logoBase64, width: 54, height: 54, alignment: 'center', margin: [0, 0, 0, 6] });
  }
  encabezado.push(
    { text: (config.institucion || 'Institución educativa').toUpperCase(), style: 'incInst' },
    { text: `(${config.ubicacion || ''})`, style: 'incLoc' },
    { text: `Código: ${config.codigo || '—'}`, style: 'incCode' },
  );
  return encabezado;
}

// Tabla de notas del resultado (etiqueta → valor), con la nota mínima al final.
function buildNotasTable(filas) {
  return {
    table: {
      widths: filas.map(() => '*'),
      body: [
        filas.map((f) => ({ text: f.label.toUpperCase(), style: 'instTh', alignment: 'center' })),
        filas.map((f) => ({ text: f.valor, style: 'notaCell', alignment: 'center', bold: !!f.destacar, color: f.color || COLOR_INK })),
      ],
    },
    layout: instTableLayout(),
    margin: [0, 3, 0, 10],
  };
}

function buildActaResultadoContent(est, config, actividades, recup, fechaEmision, logoBase64) {
  const r = est.resultado || {};
  const nombre = est.name || '__________________';
  const nie = est.nie || '__________';
  const ref = referenciaActividades(actividades);
  const minima = fmtNota(r.notaMinima);
  const nivelTxt = NIVEL_LABEL[r.nivel] ? ` (${NIVEL_LABEL[r.nivel]})` : '';
  const instrumentoTxt = recup && recup.instrumento && recup.instrumento.tipo === 'rubrica'
    ? 'la rúbrica definida para el proceso'
    : (recup && recup.instrumento && recup.instrumento.tipo === 'cotejo'
      ? 'la lista de cotejo definida para el proceso'
      : 'los criterios de evaluación establecidos');

  const parrafo1 =
    `Por medio de la presente se deja constancia formal de que el estudiante ${nombre}, con NIE ${nie}, ` +
    `SÍ realizó y entregó ${ref}, dentro del plazo establecido (${fmtFechaLarga(config.fechaLimite)}), ` +
    `siendo esta valorada con ${instrumentoTxt}.`;

  let tabla;
  let parrafoRegla;
  let parrafoResultado;

  if (r.tipo === 'extraordinaria') {
    tabla = buildNotasTable([
      { label: 'Promedio final reprobado', valor: fmtNota(r.notaOriginal) },
      { label: 'Nota de recuperación', valor: fmtNota(r.notaRecuperacion) },
      { label: 'Promedio resultante', valor: fmtNota(r.promedio), destacar: true },
      { label: 'Nota mínima', valor: minima },
    ]);
    parrafoRegla =
      `Conforme al num. 13.2.c de la Normativa de Evaluación, la nota obtenida en la recuperación ` +
      `extraordinaria (${fmtNota(r.notaRecuperacion)}) se promedió con el promedio final reprobado de la ` +
      `asignatura (${fmtNota(r.notaOriginal)}), resultando un promedio de ${fmtNota(r.promedio)}. ` +
      `La nota mínima de aprobación aplicable es ${minima}${nivelTxt}.`;
    parrafoResultado = r.aprobado
      ? `Por ser dicho promedio igual o mayor que la nota mínima, el estudiante tiene derecho a la nota ` +
        `mínima de aprobación final: la nota final de la asignatura es ${minima} — ASIGNATURA APROBADA.`
      : `Por ser dicho promedio menor que la nota mínima de aprobación, se mantiene el promedio final ` +
        `reprobado (${fmtNota(r.notaOriginal)}) — LA ASIGNATURA PERMANECE REPROBADA. Se deja constancia de que el ` +
        `proceso de refuerzo y recuperación se desarrolló conforme a la normativa y de que persisten los ` +
        `indicadores de logro no alcanzados que se detallan en la presente acta, lo cual fundamenta ` +
        `técnicamente la calificación registrada.`;
  } else {
    tabla = buildNotasTable([
      { label: 'Nota original de la actividad', valor: fmtNota(r.notaOriginal) },
      { label: 'Nota de recuperación', valor: fmtNota(r.notaRecuperacion) },
      { label: 'Nota final de la actividad', valor: fmtNota(r.notaFinalActividad), destacar: true },
      { label: 'Nota mínima', valor: minima },
    ]);
    parrafoRegla = r.sustituye
      ? `Conforme al num. 13.1.c de la Normativa de Evaluación, la nota obtenida en la actividad de ` +
        `recuperación (${fmtNota(r.notaRecuperacion)}) SUSTITUYE la nota original de la actividad ` +
        `(${fmtNota(r.notaOriginal)}), por ser mayor, debiéndose realizar un nuevo promedio del ` +
        `${config.trimestre || 'período'}.`
      : `Conforme al num. 13.1.c de la Normativa de Evaluación, la nota obtenida en la actividad de ` +
        `recuperación (${fmtNota(r.notaRecuperacion)}) NO sustituye la nota original de la actividad ` +
        `(${fmtNota(r.notaOriginal)}), por no ser mayor; en consecuencia, se mantiene la nota original.`;
    parrafoResultado = r.alcanzaMinima
      ? `Con la nota final de la actividad (${fmtNota(r.notaFinalActividad)}), el estudiante ALCANZA la nota ` +
        `mínima aplicable (${minima}${nivelTxt}) en la actividad objeto de recuperación.`
      : `Aun habiendo realizado la actividad de recuperación, la nota final de la actividad ` +
        `(${fmtNota(r.notaFinalActividad)}) NO ALCANZA la nota mínima aplicable (${minima}${nivelTxt}). ` +
        `Se deja constancia de que el proceso de refuerzo y recuperación se desarrolló conforme a la ` +
        `normativa y de que persisten los indicadores de logro no alcanzados que se detallan en la ` +
        `presente acta, lo cual fundamenta técnicamente la calificación registrada.`;
  }

  const parrafoCierre =
    `La presente acta constituye el comprobante de las actividades de recuperación exigido para el ` +
    `expediente del estudiante (Normativa de Evaluación, num. 15.b) y respaldo técnico de la decisión ` +
    `de evaluación adoptada. Para los usos que se estimen convenientes, se firma la presente acta.`;

  const tipoTitulo = r.tipo === 'extraordinaria' ? 'RECUPERACIÓN EXTRAORDINARIA' : 'RECUPERACIÓN';

  const content = [
    ...buildEncabezadoFormal(config, logoBase64),
    { text: '', margin: [0, 0, 0, 10] },
    buildInfoTable([
      { label: 'Materia', value: config.materia },
      { label: 'Maestro', value: config.docente },
      { label: 'Grado', value: est.grade },
      { label: 'Estudiante', value: nombre },
      { label: 'NIE', value: nie },
      { label: 'Fecha de emisión', value: fechaEmision },
    ]),
    { text: `ACTA DE RESULTADO DE ${tipoTitulo}`, style: 'incTitle' },
    { text: parrafo1, style: 'incBody' },
    tabla,
    { text: parrafoRegla, style: 'incBody' },
    { text: parrafoResultado, style: 'incBody' },
  ];

  if (recup && recup.indicadores && recup.indicadores.length) {
    content.push({ text: 'Indicadores de logro objeto del proceso de recuperación', style: 'incHeading' });
    content.push({
      ul: recup.indicadores.map((ind) => ({
        text: [
          ind.codigo && ind.codigo !== '—' ? { text: `${ind.codigo}  `, bold: true } : '',
          ind.texto || '',
        ],
        style: 'incListItem',
      })),
      margin: [0, 0, 0, 12],
    });
  }

  content.push({ text: parrafoCierre, style: 'incBody' });
  content.push(...buildSignatureIncumplimiento(config));
  return content;
}

// Estilos compartidos de los documentos formales (incumplimiento / resultado / refuerzo).
function formalDocStyles() {
  return {
    incInst: { fontSize: 11, bold: true, alignment: 'center', color: COLOR_INK, margin: [0, 0, 0, 2] },
    incLoc: { fontSize: 9.5, bold: true, alignment: 'center', color: COLOR_INK },
    incCode: { fontSize: 9.5, alignment: 'center', color: COLOR_INK, margin: [0, 2, 0, 0] },
    infoTh: { fontSize: 6.5, bold: true, color: COLOR_SLATE },
    infoVal: { fontSize: 8.5, color: COLOR_INK },
    incTitle: { fontSize: 11, bold: true, alignment: 'center', color: COLOR_INK, margin: [0, 8, 0, 10] },
    incBody: { fontSize: 9.5, color: COLOR_INK, alignment: 'justify', lineHeight: 1.22, margin: [0, 0, 0, 8] },
    incHeading: { fontSize: 9.5, bold: true, color: COLOR_INK, margin: [0, 2, 0, 4] },
    incListItem: { fontSize: 8.5, color: COLOR_INK, lineHeight: 1.15, margin: [0, 0, 0, 1] },
    incSigName: { fontSize: 8.5, color: COLOR_INK },
    incSigRole: { fontSize: 7.5, color: COLOR_SLATE },
    incSigGroup: { fontSize: 7.5, bold: true, color: COLOR_NAVY },
    instTh: { fontSize: 7.5, bold: true, color: COLOR_SLATE, fillColor: '#EEF2F6' },
    notaCell: { fontSize: 11, color: COLOR_INK },
  };
}

function generarActaResultadoPdf(state, students, logoBase64, recup, opts) {
  if (!students.length) return;
  const fechaEmision = fechaHoyLarga();

  const body = [];
  students.forEach((est, index) => {
    if (index > 0) body.push({ text: '', pageBreak: 'before' });
    body.push(...buildActaResultadoContent(est, state.configuracion, state.actividades, recup, fechaEmision, logoBase64));
  });

  const docDefinition = {
    pageSize: 'LETTER',
    pageMargins: [50, 44, 50, 40],
    content: body,
    defaultStyle: { fontSize: 9, color: COLOR_INK },
    styles: formalDocStyles(),
  };

  const filename = `Actas de Resultado ${sanitizeFilename(state.configuracion.codigo)} - ${sanitizeFilename(state.configuracion.anio)}.pdf`;
  outputPdf(docDefinition, filename, opts);
}

// =========================================================
// ACTAS DE CIERRE — UN SOLO ARCHIVO
// Cada estudiante recibe el acta que le corresponde (resultado si entregó,
// incumplimiento si no) en un único PDF: los navegadores bloquean la segunda
// descarga automática, así que dos archivos separados perdían actas.
// =========================================================
function generarActasCierrePdf(state, students, logoBase64, recup, opts) {
  if (!students.length) return;
  const fechaEmision = fechaHoyLarga();
  const cfg = state.configuracion;

  const body = [];
  students.forEach((est, index) => {
    if (index > 0) body.push({ text: '', pageBreak: 'before' });
    if (est.cierre === 'incumplimiento') {
      body.push(...buildActaIncumplimientoContent(est, cfg, state.actividades, fechaEmision, logoBase64));
    } else {
      body.push(...buildActaResultadoContent(est, cfg, state.actividades, recup, fechaEmision, logoBase64));
    }
  });

  const docDefinition = {
    pageSize: 'LETTER',
    pageMargins: [50, 44, 50, 40],
    content: body,
    defaultStyle: { fontSize: 9, color: COLOR_INK },
    styles: formalDocStyles(),
  };

  const filename = `Actas de Cierre ${sanitizeFilename(cfg.codigo)} - ${sanitizeFilename(cfg.trimestre)} - ${sanitizeFilename(cfg.anio)}.pdf`;
  outputPdf(docDefinition, filename, opts);
}

// =========================================================
// CONSTANCIA DE REFUERZO EDUCATIVO
// El refuerzo debe darse ANTES de la recuperación y anotarse en el
// expediente (norms. 12, 31 y 39; num. 15.a).
// =========================================================
function buildConstanciaRefuerzoContent(est, config, refuerzo, recup, fechaEmision, logoBase64) {
  const nombre = est.name || '__________________';
  const nie = est.nie || '__________';
  const periodo = (refuerzo.inicio || refuerzo.fin)
    ? `durante el período comprendido entre el ${fmtFechaLarga(refuerzo.inicio)} y el ${fmtFechaLarga(refuerzo.fin)}`
    : `durante el ${config.trimestre || 'período'} del año ${config.anio || '____'}`;

  const parrafo1 =
    `Por medio de la presente se deja constancia de que el estudiante ${nombre}, con NIE ${nie}, ` +
    `cursante de ${est.grade || '__________'}, recibió refuerzo educativo en la asignatura de ` +
    `${config.materia || '__________'}, ${periodo}, previo al registro de los resultados de las ` +
    `evaluaciones del ${config.trimestre || 'período'}, conforme a lo establecido en los numerales ` +
    `12, 31 y 39 de la Normativa de Evaluación al Servicio del Aprendizaje y del Desarrollo.`;

  const parrafoCierre =
    `La presente constancia se anota en el expediente de evaluación del estudiante (num. 15.a) ` +
    `como respaldo del proceso de refuerzo desarrollado. Para los usos que se estimen convenientes, ` +
    `se firma la presente constancia.`;

  const content = [
    ...buildEncabezadoFormal(config, logoBase64),
    { text: '', margin: [0, 0, 0, 10] },
    buildInfoTable([
      { label: 'Materia', value: config.materia },
      { label: 'Maestro', value: config.docente },
      { label: 'Fecha de emisión', value: fechaEmision },
      { label: 'Estudiante', value: nombre },
      { label: 'NIE', value: nie },
    ]),
    { text: 'CONSTANCIA DE REFUERZO EDUCATIVO', style: 'incTitle' },
    { text: parrafo1, style: 'incBody' },
  ];

  const descripcion = (refuerzo.descripcion || '').trim();
  if (descripcion) {
    content.push({ text: 'Estrategias y actividades de refuerzo desarrolladas', style: 'incHeading' });
    descripcion.split(/\n+/).map((l) => l.trim()).filter(Boolean).forEach((linea) => {
      content.push({ text: linea, style: 'incBody', margin: [0, 0, 0, 6] });
    });
    content.push({ text: '', margin: [0, 0, 0, 6] });
  }

  if (recup && recup.indicadores && recup.indicadores.length) {
    content.push({ text: 'Indicadores de logro reforzados', style: 'incHeading' });
    content.push({
      ul: recup.indicadores.map((ind) => ({
        text: [
          ind.codigo && ind.codigo !== '—' ? { text: `${ind.codigo}  `, bold: true } : '',
          ind.texto || '',
        ],
        style: 'incListItem',
      })),
      margin: [0, 0, 0, 12],
    });
  }

  content.push({ text: parrafoCierre, style: 'incBody' });
  content.push(...buildSignatureIncumplimiento(config));
  return content;
}

function generarConstanciaRefuerzoPdf(state, students, logoBase64, recup, opts) {
  if (!students.length) return;
  const fechaEmision = fechaHoyLarga();
  const refuerzo = state.refuerzo || {};

  const body = [];
  students.forEach((est, index) => {
    if (index > 0) body.push({ text: '', pageBreak: 'before' });
    body.push(...buildConstanciaRefuerzoContent(est, state.configuracion, refuerzo, recup, fechaEmision, logoBase64));
  });

  const docDefinition = {
    pageSize: 'LETTER',
    pageMargins: [50, 44, 50, 40],
    content: body,
    defaultStyle: { fontSize: 9, color: COLOR_INK },
    styles: formalDocStyles(),
  };

  const filename = `Constancias de Refuerzo ${sanitizeFilename(state.configuracion.codigo)} - ${sanitizeFilename(state.configuracion.anio)}.pdf`;
  outputPdf(docDefinition, filename, opts);
}

// =========================================================
// INSTRUCTIVO DE ACTIVIDAD DE EVALUACIÓN ORDINARIA
// (Actividad Integradora / Cotidiana / Prueba)
// =========================================================
function buildActividadOrdinariaContent(config, ordinaria, recup) {
  const content = [
    { text: 'INSTRUCTIVO DE ACTIVIDAD DE EVALUACIÓN', style: 'actaTitle' },
    buildConfigTable(config),
    {
      columns: [
        { text: [{ text: 'Tipo de actividad: ', bold: true }, `${ordinaria.tipoLabel}`], style: 'fieldValue' },
        { text: [{ text: 'Ponderación: ', bold: true }, `${ordinaria.ponderacion}%`], style: 'fieldValue', alignment: 'right' },
      ],
      margin: [0, 0, 0, 2],
    },
  ];

  if (ordinaria.fechaComunicacion) {
    content.push({
      text: [
        'Actividad dada a conocer a los estudiantes de ',
        { text: (config.grado || '—').toLowerCase(), bold: true },
        ` el ${fmtFecha(ordinaria.fechaComunicacion)}.`
      ],
      style: 'fieldValueMuted', margin: [0, 0, 0, 10],
    });
  }

  content.push({ text: ordinaria.titulo || 'Actividad sin título', style: 'activityTitle', margin: [0, 4, 0, 6] });

  content.push(...buildObjetivosBlock(recup.objetivos));
  content.push(...buildIndicadoresBlock(recup.indicadores, 'Indicadores de logro a evaluar'));

  const paragraphs = parseRichHtml(ordinaria.instrucciones);
  if (paragraphs.length) {
    content.push({ text: 'Indicaciones para el estudiante', style: 'sectionHeading' });
    paragraphs.forEach((runs) => content.push({ text: runs, style: 'activityBody', margin: [0, 0, 0, 4] }));
  }

  const instrumento = buildInstrumentoContent(recup.instrumento);
  if (instrumento.length) {
    content.push({ text: '', margin: [0, 6, 0, 0] });
    content.push(...instrumento);
  }

  content.push({
    columns: [
      signatureLine('Docente', config.docente),
      { text: '', width: '*' },
      { text: '', width: '*' },
    ],
    margin: [0, 16, 0, 0],
  });

  return content;
}

function generarActividadOrdinariaPdf(state, ordinaria, logoBase64, recup, opts) {
  if (!ordinaria || !ordinaria.titulo) return;
  recup = recup || EMPTY_RECUP;

  const docDefinition = {
    pageSize: 'LETTER',
    pageMargins: [40, 60, 40, 40],
    header: buildPageHeader(state.configuracion, logoBase64),
    content: buildActividadOrdinariaContent(state.configuracion, ordinaria, recup),
    defaultStyle: { fontSize: 9, color: COLOR_INK },
    styles: {
      headerInstitucion: { fontSize: 8, bold: true, color: COLOR_SLATE },
      headerPage: { fontSize: 8, color: COLOR_SLATE },
      actaTitle: { fontSize: 13, bold: true, color: COLOR_NAVY, alignment: 'center', margin: [0, 0, 0, 12] },
      sectionLabel: { fontSize: 7, bold: true, color: COLOR_SLATE, margin: [0, 0, 0, 1] },
      fieldValue: { fontSize: 9, color: COLOR_INK, margin: [0, 0, 0, 6] },
      fieldValueMuted: { fontSize: 8, color: COLOR_SLATE },
      activityTitle: { fontSize: 11, bold: true, color: COLOR_NAVY },
      activityBody: { fontSize: 8.5, color: COLOR_INK, lineHeight: 1.2 },
      sectionHeading: { fontSize: 9.5, bold: true, color: COLOR_NAVY, margin: [0, 5, 0, 3] },
      listItem: { fontSize: 8.5, color: COLOR_INK, lineHeight: 1.15, margin: [0, 0, 0, 1] },
      instructivoTitle: { fontSize: 12, bold: true, color: COLOR_NAVY, margin: [0, 0, 0, 8] },
      instTh: { fontSize: 7.5, bold: true, color: COLOR_SLATE, fillColor: '#EEF2F6' },
      instCell: { fontSize: 8.5, color: COLOR_INK },
      instCriterio: { fontSize: 8.5, bold: true, color: COLOR_INK },
      instMark: { fontSize: 11, color: COLOR_SLATE, alignment: 'center' },
      signatureName: { fontSize: 8.5, color: COLOR_INK, alignment: 'center' },
      signatureLabel: { fontSize: 7.5, color: COLOR_SLATE, alignment: 'center', margin: [0, 3, 0, 0] },
    },
  };

  const filename = `${sanitizeFilename(ordinaria.tipoLabel)} - ${sanitizeFilename(ordinaria.titulo)} (${ordinaria.ponderacion}%).pdf`;
  outputPdf(docDefinition, filename, opts);
}

window.ActasPDF = {
  generar: generarPdf,
  generarIncumplimiento: generarActaIncumplimientoPdf,
  generarResultado: generarActaResultadoPdf,
  generarCierre: generarActasCierrePdf,
  generarRefuerzo: generarConstanciaRefuerzoPdf,
  generarOrdinaria: generarActividadOrdinariaPdf,
};
