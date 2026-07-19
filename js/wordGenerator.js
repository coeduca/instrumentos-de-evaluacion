// =========================================================
// Generación de Word (.docx) — Acta de compromiso + Instructivo
// Usa la librería docx (cargada vía CDN en index.html, global `docx`)
// Replica el contenido y la estructura del PDF (pdfGenerator.js).
// =========================================================

(function () {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    WidthType, BorderStyle, AlignmentType, HeadingLevel, ImageRun,
    Header, PageBreak, VerticalAlign,
  } = window.docx || {};

  // ---------- Colores (sin '#', como pide docx) ----------
  const NAVY = '1B3A5C';
  const SLATE = '5A5A5A';
  const INK = '0E1F30';
  const ALERT = 'B54708';
  const LINE = 'C9D2DA';

  // ---------- Utilidades ----------
  function fmtFecha(isoDate) {
    if (!isoDate) return '—';
    const [y, m, d] = isoDate.split('-');
    if (!y || !m || !d) return isoDate;
    return `${d}/${m}/${y}`;
  }

  function sanitizeFilename(str) {
    return (str || 'sin-dato')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

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

  const IMG_SIZE_MAX_PX = { xsmall: 140, small: 240, medium: 400, large: 620 };

  function computeImageDims(natW, natH, size) {
    const max = IMG_SIZE_MAX_PX[size] || IMG_SIZE_MAX_PX.medium;
    if (!natW || !natH) return { w: max, h: max };
    const scale = Math.min(max / natW, max / natH, 1);
    return { w: Math.round(natW * scale), h: Math.round(natH * scale) };
  }

  function referenciaActividades(actividades) {
    const titulos = (actividades || [])
      .map((a) => (a.titulo || '').trim())
      .filter(Boolean);
    if (!titulos.length) return 'la Actividad de Recuperación asignada';
    if (titulos.length === 1) return `la Actividad de Recuperación «${titulos[0]}»`;
    return `las Actividades de Recuperación asignadas (${titulos.join('; ')})`;
  }

  const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const NO_BORDERS = {
    top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER,
    insideHorizontal: NO_BORDER, insideVertical: NO_BORDER,
  };
  const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: LINE };
  const CELL_BORDERS = {
    top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER,
  };

  // ---------- Celdas de configuración / datos ----------
  function labelParagraph(text) {
    return new Paragraph({
      spacing: { after: 16 },
      children: [new TextRun({ text: (text || '').toUpperCase(), bold: true, size: 13, color: SLATE })],
    });
  }

  function valueParagraph(text, opts = {}) {
    return new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: text || '—', size: 18, color: opts.color || INK, bold: !!opts.bold })],
    });
  }

  function plainCell(children, widthPct) {
    return new TableCell({
      width: { size: widthPct, type: WidthType.PERCENTAGE },
      borders: {
        top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER,
      },
      margins: { top: 30, bottom: 30, left: 30, right: 30 },
      children: Array.isArray(children) ? children : [children],
    });
  }

  function buildConfigTable(config) {
    const row = (cells) => new TableRow({ children: cells.map((c) => plainCell(c, 25)) });
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: NO_BORDERS,
      rows: [
        row([labelParagraph('Institución'), labelParagraph('Código'), labelParagraph('Docente'), labelParagraph('Materia')]),
        row([valueParagraph(config.institucion), valueParagraph(config.codigo), valueParagraph(config.docente), valueParagraph(config.materia)]),
        row([labelParagraph('Ubicación'), labelParagraph('Trimestre'), labelParagraph('Año'), labelParagraph('Fecha límite')]),
        row([valueParagraph(config.ubicacion), valueParagraph(config.trimestre), valueParagraph(config.anio), valueParagraph(fmtFecha(config.fechaLimite))]),
      ],
    });
  }

  function buildStudentTable(est) {
    const row = (cells) => new TableRow({ children: cells.map((c) => plainCell(c, 25)) });
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        ...NO_BORDERS,
        top: { style: BorderStyle.SINGLE, size: 4, color: 'E2E6EA' },
      },
      rows: [
        row([labelParagraph('Estudiante'), labelParagraph('NIE'), labelParagraph('Grado'), labelParagraph('Nota actual')]),
        row([
          valueParagraph(est.name),
          valueParagraph(est.nie),
          valueParagraph(est.grade),
          valueParagraph(est.calificacion != null ? `${est.calificacion}/10` : 'Sin registrar', { color: ALERT, bold: true }),
        ]),
      ],
    });
  }

  // Tabla compacta de campos clave (Materia/Maestro/Estudiante/NIE/Fecha de
  // emisión, etc.) para los documentos formales de incumplimiento, resultado y
  // refuerzo — reemplaza las líneas sueltas "Etiqueta: valor" por una tabla,
  // igual que en el acta de compromiso.
  function buildInfoTable(fields, cols) {
    cols = cols || 3;
    const widthPct = Math.floor(100 / cols);
    const row = (cells) => new TableRow({ children: cells.map((c) => plainCell(c, widthPct)) });
    const rows = [];
    for (let i = 0; i < fields.length; i += cols) {
      let slice = fields.slice(i, i + cols);
      while (slice.length < cols) slice = slice.concat([{ label: '', value: '' }]);
      rows.push(row(slice.map((f) => labelParagraph(f.label))));
      rows.push(row(slice.map((f) => valueParagraph(f.value))));
    }
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        ...NO_BORDERS,
        top: { style: BorderStyle.SINGLE, size: 4, color: 'E2E6EA' },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E6EA' },
      },
      rows,
    });
  }

  function buildCompromiseParagraph(est, config) {
    const texto =
      `Por medio de la presente, yo, ${est.name || '__________________'}, con Número de ` +
      `Identificación Estudiantil (NIE) ${est.nie || '__________'}, cursante de ${est.grade || '__________'}, ` +
      `en la asignatura de ${config.materia || '__________'}, me comprometo a realizar y entregar las ` +
      `actividades de recuperación académica correspondientes al ${config.trimestre || 'trimestre'} del año ` +
      `${config.anio || '____'}, a más tardar el ${fmtFecha(config.fechaLimite)}. Entiendo que el cumplimiento ` +
      `de este compromiso es indispensable para superar las deficiencias académicas identificadas y continuar ` +
      `mi proceso de aprendizaje de manera satisfactoria. Asimismo, declaro ser conocedor(a) y estar consciente ` +
      `del contenido de esta acta y de las actividades de recuperación que se me asignan.`;
    return new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 360, line: 250 },
      children: [new TextRun({ text: texto, size: 18, color: INK })],
    });
  }

  function signatureCell(role, name) {
    const kids = [
      new Paragraph({ spacing: { before: 400 }, children: [] }), // espacio para firmar sobre la línea
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: SLATE } },
        children: [],
      }),
    ];
    if (name) {
      kids.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 30 },
        children: [new TextRun({ text: name, size: 17, color: INK })],
      }));
    }
    kids.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: name ? 15 : 45 },
      children: [new TextRun({ text: role, size: 15, color: SLATE })],
    }));
    return new TableCell({
      width: { size: 33, type: WidthType.PERCENTAGE },
      borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
      margins: { left: 80, right: 80 },
      children: kids,
    });
  }

  function emptySigCell() {
    return new TableCell({
      width: { size: 33, type: WidthType.PERCENTAGE },
      borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
      children: [new Paragraph({ children: [] })],
    });
  }

  function sigGroupLabel(text) {
    return new Paragraph({
      spacing: { before: 160, after: 30 },
      children: [new TextRun({ text, bold: true, size: 14, color: NAVY })],
    });
  }

  function sigRow(cells) {
    return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: NO_BORDERS, rows: [new TableRow({ children: cells })] });
  }

  // Firmas conforme a la Normativa de Evaluación num. 15.d (aval institucional)
  // + recibido del estudiante y familia (num. 15.c).
  function buildSignatureBlock(config) {
    config = config || {};
    return [
      sigGroupLabel('AVAL INSTITUCIONAL — Constancia de notificación (Normativa de Evaluación, num. 15.d)'),
      sigRow([
        signatureCell('Director/a', config.director),
        signatureCell('Docente responsable de grado', config.docente),
        signatureCell('Representante del Equipo de Evaluación', config.evaluador),
      ]),
      sigGroupLabel('RECIBIDO Y COMPROMISO'),
      sigRow([
        signatureCell('Firma del estudiante', ''),
        emptySigCell(),
        emptySigCell(),
      ]),
    ];
  }

  // ---------- Recuperación: indicadores + objetivos + instrumento ----------
  const EMPTY_RECUP = { indicadores: [], objetivos: [], instrumento: { tipo: 'ninguno', criterios: [] } };

  function sectionHeading(text) {
    return new Paragraph({
      spacing: { before: 60, after: 40 },
      children: [new TextRun({ text, bold: true, size: 19, color: NAVY })],
    });
  }

  function bulletLine(runs) {
    return new Paragraph({
      spacing: { after: 25, line: 235 },
      indent: { left: 220, hanging: 160 },
      children: [new TextRun({ text: '•  ', color: NAVY }), ...runs],
    });
  }

  function buildIndicadoresBlockWord(indicadores, title) {
    if (!indicadores || !indicadores.length) return [];
    return [sectionHeading(title || 'Indicadores de logro no alcanzados'),
      ...indicadores.map((ind) => bulletLine([
        (ind.codigo && ind.codigo !== '—')
          ? new TextRun({ text: `${ind.codigo}  `, bold: true, size: 17, color: INK })
          : new TextRun({ text: '', size: 17 }),
        new TextRun({ text: ind.texto || '', size: 17, color: INK }),
      ])),
      new Paragraph({ spacing: { after: 60 }, children: [] })];
  }

  function buildObjetivosBlockWord(objetivos) {
    if (!objetivos || !objetivos.length) return [];
    return [sectionHeading('Objetivos de aprendizaje'),
      ...objetivos.map((o) => bulletLine([new TextRun({ text: o, size: 17, color: INK })])),
      new Paragraph({ spacing: { after: 60 }, children: [] })];
  }

  function buildActaContent(est, config, recup) {
    recup = recup || { indicadores: [], objetivos: [] };
    return [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [new TextRun({ text: 'ACTA DE COMPROMISO DE RECUPERACIÓN ACADÉMICA', bold: true, size: 26, color: NAVY })],
      }),
      buildConfigTable(config),
      new Paragraph({ spacing: { after: 40 }, children: [] }),
      buildStudentTable(est),
      new Paragraph({ spacing: { after: 80 }, children: [] }),
      ...buildIndicadoresBlockWord(recup.indicadores),
      ...buildObjetivosBlockWord(recup.objetivos),
      buildCompromiseParagraph(est, config),
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 40 },
        children: [new TextRun({
          text: 'El presente documento constituye la constancia de notificación al estudiante y su familia del proceso de recuperación requerido, conforme a la Normativa de Evaluación al Servicio del Aprendizaje y del Desarrollo (num. 15.d).',
          italics: true, size: 16, color: SLATE,
        })],
      }),
      ...buildSignatureBlock(config),
    ];
  }

  // ---------- Instrumento de evaluación (3.ª hoja) ----------
  function instHeaderCell(text) {
    return new TableCell({
      borders: CELL_BORDERS,
      shading: { fill: 'EEF2F6' },
      margins: { top: 35, bottom: 35, left: 55, right: 55 },
      children: [new Paragraph({ children: [new TextRun({ text: (text || '').toUpperCase(), bold: true, size: 14, color: SLATE })] })],
    });
  }

  function instCell(text, opts = {}) {
    return new TableCell({
      borders: CELL_BORDERS,
      margins: { top: 35, bottom: 35, left: 55, right: 55 },
      children: [new Paragraph({
        alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
        children: [new TextRun({ text: text || '', bold: !!opts.bold, size: opts.size || 16, color: opts.color || INK })],
      })],
    });
  }

  function buildInstrumentoContentWord(instrumento) {
    if (!instrumento || instrumento.tipo === 'ninguno') return [];
    const criterios = (instrumento.criterios || []).filter((c) => (c.texto || '').trim());
    if (!criterios.length) return [];

    let rows;
    if (instrumento.tipo === 'rubrica') {
      const escala = instrumento.escala && instrumento.escala.length
        ? instrumento.escala
        : [{ label: 'Excelente', puntos: 4 }, { label: 'Muy bueno', puntos: 3 }, { label: 'Bueno', puntos: 2 }, { label: 'Debe mejorar', puntos: 1 }];
      const header = new TableRow({ tableHeader: true, children: [instHeaderCell('Criterio'), ...escala.map((n) => instHeaderCell(`${n.label} (${n.puntos})`))] });
      rows = [header, ...criterios.map((c) => new TableRow({
        children: [instCell(c.texto, { bold: true }), ...escala.map((_, i) => instCell((c.desc && c.desc[i]) || '', { size: 14, color: SLATE }))],
      }))];
    } else {
      const header = new TableRow({ tableHeader: true, children: [instHeaderCell('Criterio'), instHeaderCell('Sí logra'), instHeaderCell('No logra'), instHeaderCell('Observaciones')] });
      rows = [header, ...criterios.map((c) => new TableRow({
        children: [instCell(c.texto, { bold: true }), instCell('☐', { center: true, size: 20 }), instCell('☐', { center: true, size: 20 }), instCell('')],
      }))];
    }

    const titulo = instrumento.tipo === 'rubrica' ? 'INSTRUMENTO DE EVALUACIÓN · RÚBRICA' : 'INSTRUMENTO DE EVALUACIÓN · LISTA DE COTEJO';
    return [
      new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: titulo, bold: true, size: 24, color: NAVY })] }),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'Instrumento con el que se valorará la actividad de recuperación.', size: 16, color: SLATE })] }),
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
    ];
  }

  // ---------- Texto enriquecido (negrita / cursiva / subrayado) ----------
  // Convierte el HTML del editor (contenteditable) en párrafos de "runs" docx.
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
      if (tag === 'u') newStyle.underline = true;

      const isBlock = tag === 'div' || tag === 'p';
      node.childNodes.forEach((child) => walk(child, newStyle));
      if (isBlock) pushParagraph();
    }

    container.childNodes.forEach((child) => walk(child, {}));
    pushParagraph();

    return paragraphs.filter((p) => p.length > 0);
  }

  function runsToTextRuns(runs, base = {}) {
    return runs.map((r) =>
      new TextRun({
        text: r.text,
        bold: r.bold || base.bold,
        italics: r.italics || base.italics,
        underline: r.underline ? {} : undefined,
        size: base.size || 17,
        color: base.color || INK,
      })
    );
  }

  function buildActivityTableDocx(tabla) {
    const rows = tabla.celdas.map((row) =>
      new TableRow({
        children: row.map((cell) =>
          new TableCell({
            borders: CELL_BORDERS,
            margins: { top: 30, bottom: 30, left: 45, right: 45 },
            width: { size: Math.floor(100 / tabla.columnas), type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: cell || '', size: 16, color: INK })] })],
          })
        ),
      })
    );
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows,
    });
  }

  function buildInstructivoContent(est, config, actividades, recup) {
    recup = recup || { objetivos: [] };
    const content = [];

    content.push(new Paragraph({
      spacing: { after: 180 },
      children: [new TextRun({ text: 'INSTRUCTIVO DE ACTIVIDADES DE RECUPERACIÓN', bold: true, size: 24, color: NAVY })],
    }));

    // Nombre (izq., negrita) + NIE (der.) usando una tabla de 2 columnas sin bordes
    content.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: NO_BORDERS,
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 60, type: WidthType.PERCENTAGE },
              borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
              children: [new Paragraph({ children: [new TextRun({ text: est.name || '—', bold: true, size: 18, color: INK })] })],
            }),
            new TableCell({
              width: { size: 40, type: WidthType.PERCENTAGE },
              borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
              children: [new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: `NIE: ${est.nie || '—'}`, size: 18, color: INK })],
              })],
            }),
          ],
        }),
      ],
    }));

    content.push(new Paragraph({
      spacing: { before: 40, after: 200 },
      children: [new TextRun({
        text: `${config.materia || ''} · ${config.trimestre || ''} ${config.anio || ''} · Fecha límite: ${fmtFecha(config.fechaLimite)}`,
        size: 16, color: SLATE,
      })],
    }));

    buildObjetivosBlockWord(recup.objetivos).forEach((p) => content.push(p));

    if (!actividades.length) {
      content.push(new Paragraph({
        children: [new TextRun({ text: 'No se definieron actividades de recuperación para este trimestre.', italics: true, size: 16, color: SLATE })],
      }));
    } else {
      actividades.forEach((act, i) => {
        content.push(new Paragraph({
          spacing: { before: 140, after: 30 },
          children: [new TextRun({ text: `${i + 1}. ${act.titulo || 'Actividad sin título'}`, bold: true, size: 19, color: NAVY })],
        }));

        const paragraphs = parseRichHtml(act.instrucciones);
        if (paragraphs.length) {
          paragraphs.forEach((runs) => {
            content.push(new Paragraph({
              spacing: { after: 60, line: 235 },
              children: runsToTextRuns(runs),
            }));
          });
        } else {
          content.push(new Paragraph({ children: [new TextRun({ text: '—', size: 17, color: INK })] }));
        }

        if (act.tabla && act.tabla.celdas && act.tabla.celdas.length) {
          content.push(buildActivityTableDocx(act.tabla));
          content.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
        }

        if (act.imagen && act.imagen.data) {
          const m = /^data:image\/(\w+);base64,(.+)$/.exec(act.imagen.data);
          if (m) {
            const dims = computeImageDims(act.imagen.w, act.imagen.h, act.imagen.size);
            content.push(new Paragraph({
              spacing: { before: 80, after: act.imagen.caption ? 15 : 140 },
              children: [new ImageRun({
                type: m[1] === 'jpeg' ? 'jpg' : m[1],
                data: m[2],
                transformation: { width: dims.w, height: dims.h },
              })],
            }));
            if (act.imagen.caption) {
              content.push(new Paragraph({
                spacing: { after: 140 },
                children: [new TextRun({ text: act.imagen.caption, italics: true, size: 15, color: SLATE })],
              }));
            }
          }
        }
      });
    }

    return content;
  }

  // ---------- Encabezado de página (logo + institución) ----------
  function buildHeader(config, logoBase64) {
    const children = [];

    if (logoBase64) {
      const match = /^data:image\/(\w+);base64,(.+)$/.exec(logoBase64);
      if (match) {
        children.push(new TextRun({
          children: [new ImageRun({
            type: match[1] === 'jpeg' ? 'jpg' : match[1],
            data: match[2],
            transformation: { width: 20, height: 20 },
          })],
        }));
        children.push(new TextRun({ text: '  ' }));
      }
    }

    children.push(new TextRun({ text: config.institucion || 'Institución educativa', bold: true, size: 16, color: SLATE }));

    return new Header({
      children: [new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: NAVY } },
        spacing: { after: 120 },
        children,
      })],
    });
  }

  // ---------- Descarga del blob ----------
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- Construcción y descarga del .docx ----------
  function generarWord(state, estudiantes, logoBase64, recup, opts) {
    if (!window.docx) {
      alert('No se pudo cargar la librería de Word (docx). Verifica tu conexión a internet e intenta de nuevo.');
      return;
    }
    if (!estudiantes.length) return;

    const config = state.configuracion;
    recup = recup || EMPTY_RECUP;
    const children = [];

    estudiantes.forEach((est, index) => {
      if (index > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
      children.push(...buildActaContent(est, config, recup));
      children.push(new Paragraph({ children: [new PageBreak()] }));
      children.push(...buildInstructivoContent(est, config, state.actividades, recup));
      // Se reconstruye para cada estudiante: reutilizar las mismas instancias de
      // Table/Paragraph en varios puntos del documento puede dejarlas vacías o
      // corruptas al empaquetar el .docx (mismo problema que en pdfGenerator.js).
      const instrumentoContent = buildInstrumentoContentWord(recup.instrumento);
      if (instrumentoContent.length) {
        // Con la opción activada, el instrumento continúa en la misma página que
        // el instructivo (sin salto), útil cuando ambos son cortos.
        if (!(opts && opts.juntarInstrumento)) {
          children.push(new Paragraph({ children: [new PageBreak()] }));
        } else {
          children.push(new Paragraph({ spacing: { before: 240 }, children: [] }));
        }
        children.push(...instrumentoContent);
      }
    });

    const doc = new Document({
      styles: {
        default: {
          document: { run: { font: 'Calibri', size: 18, color: INK } },
        },
      },
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 }, // LETTER (twips)
            margin: { top: 900, right: 700, bottom: 650, left: 700 },
          },
        },
        headers: { default: buildHeader(config, logoBase64) },
        children,
      }],
    });

    const filename = `Actas_${sanitizeFilename(config.codigo)}_${sanitizeFilename(config.trimestre)}_${sanitizeFilename(config.anio)}.docx`;

    Packer.toBlob(doc).then((blob) => {
      downloadBlob(blob, filename);
    }).catch((e) => {
      console.error('Error al generar el documento Word:', e);
      alert('Ocurrió un error al generar el documento Word. Revisa la consola para más detalles.');
    });
  }

  // =========================================================
  // ACTA DE INCUMPLIMIENTO DE ACTIVIDAD DE RECUPERACIÓN (.docx)
  // =========================================================
  function centeredRun(text, opts = {}) {
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: opts.after != null ? opts.after : 40 },
      children: [new TextRun({ text: text || '', bold: !!opts.bold, size: opts.size || 20, color: INK })],
    });
  }

  function bodyParagraph(text) {
    return new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 160, line: 250 },
      children: [new TextRun({ text, size: 19, color: INK })],
    });
  }

  // Firmas en fila (dos columnas) mediante una tabla sin bordes; cada línea
  // de firma ocupa la mitad del ancho para que no aparezca a lo ancho completo.
  function buildSignatureRowWord(config) {
    const cell = (children, isLeft) => new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
      margins: { top: 0, bottom: 0, left: isLeft ? 0 : 300, right: isLeft ? 300 : 0 },
      children,
    });
    const sigLine = () => new Paragraph({
      spacing: { before: 700 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: INK } },
      children: [],
    });
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: NO_BORDERS,
      rows: [
        new TableRow({
          children: [
            cell([
              sigLine(),
              new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: config.docente || '____________________', size: 20, color: INK })] }),
              new Paragraph({ children: [new TextRun({ text: `Docente${config.materia ? ' de ' + config.materia : ''}`, size: 18, color: SLATE })] }),
            ], true),
            cell([
              sigLine(),
              new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: 'Firma del Estudiante', size: 20, color: INK })] }),
            ], false),
          ],
        }),
      ],
    });
  }

  function buildActaIncumplimientoWord(est, config, actividades, fechaEmision, logoBase64) {
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

    const content = [];

    if (logoBase64) {
      const match = /^data:image\/(\w+);base64,(.+)$/.exec(logoBase64);
      if (match) {
        content.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new ImageRun({
            type: match[1] === 'jpeg' ? 'jpg' : match[1],
            data: match[2],
            transformation: { width: 64, height: 64 },
          })],
        }));
      }
    }

    content.push(
      centeredRun((config.institucion || 'Institución educativa').toUpperCase(), { bold: true, size: 22, after: 16 }),
      centeredRun(`(${config.ubicacion || ''})`, { bold: true, size: 19, after: 30 }),
      centeredRun(`Código: ${config.codigo || '—'}`, { size: 19, after: 160 }),
      buildInfoTable([
        { label: 'Materia', value: config.materia },
        { label: 'Maestro', value: config.docente },
        { label: 'Fecha de emisión', value: fechaEmision },
        { label: 'Estudiante', value: nombre },
        { label: 'NIE', value: nie },
      ]),
      new Paragraph({ spacing: { after: 160 }, children: [] }),
      centeredRun('ACTA DE INCUMPLIMIENTO DE ACTIVIDAD DE RECUPERACIÓN', { bold: true, size: 22, after: 200 }),
      bodyParagraph(parrafo1),
      bodyParagraph(parrafo2),
      bodyParagraph(parrafo3),
      bodyParagraph(parrafo4),
      ...buildSignatureBlock(config),
    );

    return content;
  }

  function generarActaIncumplimientoWord(state, students, logoBase64) {
    if (!window.docx) {
      alert('No se pudo cargar la librería de Word (docx). Verifica tu conexión a internet e intenta de nuevo.');
      return;
    }
    if (!students.length) return;

    const config = state.configuracion;
    const fechaEmision = fechaHoyLarga();
    const children = [];

    students.forEach((est, index) => {
      if (index > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
      children.push(...buildActaIncumplimientoWord(est, config, state.actividades, fechaEmision, logoBase64));
    });

    const doc = new Document({
      styles: { default: { document: { run: { font: 'Calibri', size: 19, color: INK } } } },
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 900, right: 1000, bottom: 850, left: 1000 },
          },
        },
        children,
      }],
    });

    const filename = `Actas_Incumplimiento_${sanitizeFilename(config.codigo)}_${sanitizeFilename(config.anio)}.docx`;

    Packer.toBlob(doc).then((blob) => {
      downloadBlob(blob, filename);
    }).catch((e) => {
      console.error('Error al generar el acta de incumplimiento (Word):', e);
      alert('Ocurrió un error al generar el acta de incumplimiento en Word. Revisa la consola.');
    });
  }

  // =========================================================
  // ACTA DE RESULTADO DE ACTIVIDAD DE RECUPERACIÓN (.docx)
  // Reglas del Manual: num. 13.1.c (ordinaria) / num. 13.2.c (extraordinaria).
  // =========================================================
  const NIVEL_LABEL = { basica: 'Educación Básica', media: 'Educación Media' };

  function fmtNota(n) {
    return (n == null || isNaN(Number(n))) ? '—' : Number(n).toFixed(1);
  }

  function buildEncabezadoFormalWord(config, logoBase64) {
    const content = [];
    if (logoBase64) {
      const match = /^data:image\/(\w+);base64,(.+)$/.exec(logoBase64);
      if (match) {
        content.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new ImageRun({
            type: match[1] === 'jpeg' ? 'jpg' : match[1],
            data: match[2],
            transformation: { width: 64, height: 64 },
          })],
        }));
      }
    }
    content.push(
      centeredRun((config.institucion || 'Institución educativa').toUpperCase(), { bold: true, size: 22, after: 16 }),
      centeredRun(`(${config.ubicacion || ''})`, { bold: true, size: 19, after: 30 }),
      centeredRun(`Código: ${config.codigo || '—'}`, { size: 19, after: 160 }),
    );
    return content;
  }

  function buildNotasTableWord(filas) {
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: filas.map((f) => instHeaderCell(f.label)) }),
        new TableRow({ children: filas.map((f) => instCell(f.valor, { center: true, bold: !!f.destacar, size: 22 })) }),
      ],
    });
  }

  function buildActaResultadoWord(est, config, actividades, recup, fechaEmision, logoBase64) {
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

    let tabla, parrafoRegla, parrafoResultado;
    if (r.tipo === 'extraordinaria') {
      tabla = buildNotasTableWord([
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
      tabla = buildNotasTableWord([
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
      ...buildEncabezadoFormalWord(config, logoBase64),
      buildInfoTable([
        { label: 'Materia', value: config.materia },
        { label: 'Maestro', value: config.docente },
        { label: 'Grado', value: est.grade },
        { label: 'Estudiante', value: nombre },
        { label: 'NIE', value: nie },
        { label: 'Fecha de emisión', value: fechaEmision },
      ]),
      new Paragraph({ spacing: { after: 160 }, children: [] }),
      centeredRun(`ACTA DE RESULTADO DE ${tipoTitulo}`, { bold: true, size: 22, after: 200 }),
      bodyParagraph(parrafo1),
      tabla,
      new Paragraph({ spacing: { after: 120 }, children: [] }),
      bodyParagraph(parrafoRegla),
      bodyParagraph(parrafoResultado),
    ];

    if (recup && recup.indicadores && recup.indicadores.length) {
      content.push(sectionHeading('Indicadores de logro objeto del proceso de recuperación'));
      recup.indicadores.forEach((ind) => content.push(bulletLine([
        (ind.codigo && ind.codigo !== '—')
          ? new TextRun({ text: `${ind.codigo}  `, bold: true, size: 17, color: INK })
          : new TextRun({ text: '', size: 17 }),
        new TextRun({ text: ind.texto || '', size: 17, color: INK }),
      ])));
      content.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
    }

    content.push(bodyParagraph(parrafoCierre));
    content.push(...buildSignatureBlock(config));
    return content;
  }

  function generarActaResultadoWord(state, students, logoBase64, recup) {
    if (!window.docx) {
      alert('No se pudo cargar la librería de Word (docx). Verifica tu conexión a internet e intenta de nuevo.');
      return;
    }
    if (!students.length) return;

    const config = state.configuracion;
    const fechaEmision = fechaHoyLarga();
    const children = [];
    students.forEach((est, index) => {
      if (index > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
      children.push(...buildActaResultadoWord(est, config, state.actividades, recup, fechaEmision, logoBase64));
    });

    const doc = new Document({
      styles: { default: { document: { run: { font: 'Calibri', size: 19, color: INK } } } },
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 900, right: 1000, bottom: 850, left: 1000 },
          },
        },
        children,
      }],
    });

    const filename = `Actas_Resultado_${sanitizeFilename(config.codigo)}_${sanitizeFilename(config.anio)}.docx`;
    Packer.toBlob(doc).then((blob) => downloadBlob(blob, filename)).catch((e) => {
      console.error('Error al generar el acta de resultado (Word):', e);
      alert('Ocurrió un error al generar el acta de resultado en Word. Revisa la consola.');
    });
  }

  // =========================================================
  // ACTAS DE CIERRE — UN SOLO ARCHIVO (.docx)
  // Resultado o incumplimiento por estudiante, en un único documento.
  // =========================================================
  function generarActasCierreWord(state, students, logoBase64, recup) {
    if (!window.docx) {
      alert('No se pudo cargar la librería de Word (docx). Verifica tu conexión a internet e intenta de nuevo.');
      return;
    }
    if (!students.length) return;

    const config = state.configuracion;
    const fechaEmision = fechaHoyLarga();
    const children = [];
    students.forEach((est, index) => {
      if (index > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
      if (est.cierre === 'incumplimiento') {
        children.push(...buildActaIncumplimientoWord(est, config, state.actividades, fechaEmision, logoBase64));
      } else {
        children.push(...buildActaResultadoWord(est, config, state.actividades, recup, fechaEmision, logoBase64));
      }
    });

    const doc = new Document({
      styles: { default: { document: { run: { font: 'Calibri', size: 19, color: INK } } } },
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 900, right: 1000, bottom: 850, left: 1000 },
          },
        },
        children,
      }],
    });

    const filename = `Actas_Cierre_${sanitizeFilename(config.codigo)}_${sanitizeFilename(config.trimestre)}_${sanitizeFilename(config.anio)}.docx`;
    Packer.toBlob(doc).then((blob) => downloadBlob(blob, filename)).catch((e) => {
      console.error('Error al generar las actas de cierre (Word):', e);
      alert('Ocurrió un error al generar las actas de cierre en Word. Revisa la consola.');
    });
  }

  // =========================================================
  // CONSTANCIA DE REFUERZO EDUCATIVO (.docx)
  // =========================================================
  function buildConstanciaRefuerzoWord(est, config, refuerzo, recup, fechaEmision, logoBase64) {
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
      ...buildEncabezadoFormalWord(config, logoBase64),
      buildInfoTable([
        { label: 'Materia', value: config.materia },
        { label: 'Maestro', value: config.docente },
        { label: 'Fecha de emisión', value: fechaEmision },
        { label: 'Estudiante', value: nombre },
        { label: 'NIE', value: nie },
      ]),
      new Paragraph({ spacing: { after: 160 }, children: [] }),
      centeredRun('CONSTANCIA DE REFUERZO EDUCATIVO', { bold: true, size: 22, after: 200 }),
      bodyParagraph(parrafo1),
    ];

    const descripcion = (refuerzo.descripcion || '').trim();
    if (descripcion) {
      content.push(sectionHeading('Estrategias y actividades de refuerzo desarrolladas'));
      descripcion.split(/\n+/).map((l) => l.trim()).filter(Boolean).forEach((linea) => {
        content.push(bodyParagraph(linea));
      });
    }

    if (recup && recup.indicadores && recup.indicadores.length) {
      content.push(sectionHeading('Indicadores de logro reforzados'));
      recup.indicadores.forEach((ind) => content.push(bulletLine([
        (ind.codigo && ind.codigo !== '—')
          ? new TextRun({ text: `${ind.codigo}  `, bold: true, size: 17, color: INK })
          : new TextRun({ text: '', size: 17 }),
        new TextRun({ text: ind.texto || '', size: 17, color: INK }),
      ])));
      content.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
    }

    content.push(bodyParagraph(parrafoCierre));
    content.push(...buildSignatureBlock(config));
    return content;
  }

  function generarConstanciaRefuerzoWord(state, students, logoBase64, recup) {
    if (!window.docx) {
      alert('No se pudo cargar la librería de Word (docx). Verifica tu conexión a internet e intenta de nuevo.');
      return;
    }
    if (!students.length) return;

    const config = state.configuracion;
    const refuerzo = state.refuerzo || {};
    const fechaEmision = fechaHoyLarga();
    const children = [];
    students.forEach((est, index) => {
      if (index > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
      children.push(...buildConstanciaRefuerzoWord(est, config, refuerzo, recup, fechaEmision, logoBase64));
    });

    const doc = new Document({
      styles: { default: { document: { run: { font: 'Calibri', size: 19, color: INK } } } },
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 900, right: 1000, bottom: 850, left: 1000 },
          },
        },
        children,
      }],
    });

    const filename = `Constancias_Refuerzo_${sanitizeFilename(config.codigo)}_${sanitizeFilename(config.anio)}.docx`;
    Packer.toBlob(doc).then((blob) => downloadBlob(blob, filename)).catch((e) => {
      console.error('Error al generar la constancia de refuerzo (Word):', e);
      alert('Ocurrió un error al generar la constancia de refuerzo en Word. Revisa la consola.');
    });
  }

  // =========================================================
  // INSTRUCTIVO DE ACTIVIDAD DE EVALUACIÓN ORDINARIA (.docx)
  // =========================================================
  function buildActividadOrdinariaWord(config, ordinaria, recup) {
    const content = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [new TextRun({ text: 'INSTRUCTIVO DE ACTIVIDAD DE EVALUACIÓN', bold: true, size: 26, color: NAVY })],
      }),
      buildConfigTable(config),
      new Paragraph({ spacing: { after: 40 }, children: [] }),
      new Paragraph({
        spacing: { after: 30 },
        children: [
          new TextRun({ text: 'Tipo de actividad: ', bold: true, size: 18, color: INK }),
          new TextRun({ text: ordinaria.tipoLabel, size: 18, color: INK }),
          new TextRun({ text: '     Ponderación: ', bold: true, size: 18, color: INK }),
          new TextRun({ text: `${ordinaria.ponderacion}%`, size: 18, color: INK }),
        ],
      }),
    ];

    if (ordinaria.fechaComunicacion) {
      content.push(new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: `Actividad dada a conocer a los estudiantes el ${fmtFecha(ordinaria.fechaComunicacion)}.`, size: 16, color: SLATE })],
      }));
    }

    content.push(new Paragraph({
      spacing: { before: 40, after: 90 },
      children: [new TextRun({ text: ordinaria.titulo || 'Actividad sin título', bold: true, size: 22, color: NAVY })],
    }));

    buildObjetivosBlockWord(recup.objetivos).forEach((p) => content.push(p));
    buildIndicadoresBlockWord(recup.indicadores, 'Indicadores de logro a evaluar').forEach((p) => content.push(p));

    const paragraphs = parseRichHtml(ordinaria.instrucciones);
    if (paragraphs.length) {
      content.push(sectionHeading('Indicaciones para el estudiante'));
      paragraphs.forEach((runs) => content.push(new Paragraph({ spacing: { after: 60, line: 235 }, children: runsToTextRuns(runs) })));
    }

    buildInstrumentoContentWord(recup.instrumento).forEach((el) => content.push(el));

    // Firma del docente
    content.push(sigGroupLabel(' '));
    content.push(sigRow([signatureCell('Docente', config.docente), emptySigCell(), emptySigCell()]));

    return content;
  }

  function generarActividadOrdinariaWord(state, ordinaria, logoBase64, recup) {
    if (!window.docx) {
      alert('No se pudo cargar la librería de Word (docx). Verifica tu conexión a internet e intenta de nuevo.');
      return;
    }
    if (!ordinaria || !ordinaria.titulo) return;

    const config = state.configuracion;
    recup = recup || EMPTY_RECUP;

    const doc = new Document({
      styles: { default: { document: { run: { font: 'Calibri', size: 18, color: INK } } } },
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 900, right: 700, bottom: 650, left: 700 },
          },
        },
        headers: { default: buildHeader(config, logoBase64) },
        children: buildActividadOrdinariaWord(config, ordinaria, recup),
      }],
    });

    const filename = `Actividad_${sanitizeFilename(ordinaria.tipoLabel)}_${sanitizeFilename(ordinaria.titulo)}.docx`;

    Packer.toBlob(doc).then((blob) => {
      downloadBlob(blob, filename);
    }).catch((e) => {
      console.error('Error al generar la actividad ordinaria (Word):', e);
      alert('Ocurrió un error al generar la actividad ordinaria en Word. Revisa la consola.');
    });
  }

  window.ActasWord = {
    generar: generarWord,
    generarIncumplimiento: generarActaIncumplimientoWord,
    generarResultado: generarActaResultadoWord,
    generarCierre: generarActasCierreWord,
    generarRefuerzo: generarConstanciaRefuerzoWord,
    generarOrdinaria: generarActividadOrdinariaWord,
  };
})();
