// =========================================================
// Generador de código para Google Apps Script
// Construye un archivo .gs listo para pegar en script.google.com
// que crea —en una carpeta de Drive— un instrumento de evaluación
// (rúbrica o lista de cotejo) por cada estudiante, con todos los
// datos ya configurados en el framework.
//   window.AppsScriptGen.generar(instrumento, ctx) -> { ok, codigo, ... }
// =========================================================
(function () {
  'use strict';

  const NOTA_MAXIMA = 10;

  // ---------- utilidades ----------
  // Literal JavaScript seguro (comillas, saltos de línea, acentos).
  function lit(v) { return JSON.stringify(v == null ? '' : String(v)); }

  function stripHtml(html) {
    const d = document.createElement('div');
    d.innerHTML = html || '';
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // Drive acepta casi todo, pero los nombres con / o \ se vuelven confusos.
  function limpiarNombre(t) {
    return String(t || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function fechaCorta(iso) {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  }

  function hoy() {
    try { return new Date().toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' }); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }

  // ---------- nombre de la carpeta de destino ----------
  // «Actividad Integradora - Los volcanes (Rúbrica)»
  function nombreCarpeta(ctx, tituloInstrumento) {
    const act = ctx.actividad || {};
    const partes = [limpiarNombre(act.tipoLabel) || 'Actividad'];
    const titulo = limpiarNombre(act.titulo);
    if (titulo) partes.push(titulo);
    return `${partes.join(' - ')} (${tituloInstrumento})`;
  }

  // =========================================================
  // BLOQUE DE CONSTANTES (los datos que vienen del framework)
  // =========================================================
  function bloqueConstantes(datos) {
    const d = datos;
    const L = [];
    L.push('// ===================== CONFIGURACIÓN =====================');
    L.push('// Todo esto ya viene con los datos del framework. Puedes editarlo aquí');
    L.push('// si necesitas un ajuste de última hora.');
    L.push('');
    L.push('// Deja vacío para crear la carpeta en la raíz de tu Drive, o pega el ID');
    L.push('// de una carpeta existente para crearla dentro de ella.');
    L.push('var CARPETA_DESTINO_ID = "";');
    L.push(`var CARPETA_NOMBRE     = ${lit(d.carpeta)};`);
    L.push('');
    L.push(`var INSTRUMENTO        = ${lit(d.instrumento)};   // "rubrica" | "cotejo"`);
    L.push(`var TITULO_INSTRUMENTO = ${lit(d.tituloInstrumento)};`);
    L.push(`var TITULO_HOJA        = ${lit(d.tituloHoja)};`);
    L.push(`var PLURAL             = ${lit(d.plural)};`);
    L.push(`var NOTA_MAXIMA        = ${NOTA_MAXIMA};`);
    L.push('');
    L.push(`var ESCUELA         = ${lit(d.escuela)};`);
    L.push(`var UBICACION       = ${lit(d.ubicacion)};`);
    L.push(`var CODIGO_CENTRO   = ${lit(d.codigo)};`);
    L.push(`var MAESTRO         = ${lit(d.maestro)};`);
    L.push(`var MATERIA         = ${lit(d.materia)};`);
    L.push(`var GRADO           = ${lit(d.grado)};`);
    L.push(`var PERIODO         = ${lit(d.periodo)};`);
    L.push(`var ANIO            = ${lit(d.anio)};`);
    L.push('');
    L.push(`var TIPO_ACTIVIDAD  = ${lit(d.tipoActividad)};`);
    L.push(`var TEMA            = ${lit(d.tema)};`);
    L.push(`var PONDERACION     = ${lit(d.ponderacion)};`);
    L.push(`var FECHA_LIMITE    = ${lit(d.fechaLimite)};`);
    L.push(`var OBJETIVO        = ${lit(d.objetivo)};`);
    L.push('');
    L.push('// Indicadores de logro evaluados (Manual de Evaluación, num. 15).');
    L.push(`var INDICADORES = ${d.indicadores.length ? '[\n  ' + d.indicadores.map(lit).join(',\n  ') + ',\n]' : '[]'};`);
    L.push('');
    L.push('// Lista de estudiantes:  [N° de lista, nombre, NIE]');
    L.push('var ESTUDIANTES = [');
    d.estudiantes.forEach((e) => {
      L.push(`  [${e.n}, ${lit(e.name)}, ${lit(e.nie)}],`);
    });
    L.push('];');
    L.push('');
    if (d.instrumento === 'rubrica') {
      L.push('// Niveles de desempeño y su puntaje (tal como se definieron en el framework).');
      L.push('var NIVELES = [');
      d.niveles.forEach((n) => {
        L.push(`  { nombre: ${lit(n.label)}, puntos: ${n.puntos} },`);
      });
      L.push('];');
      L.push('');
      L.push(`// ¿Cada celda lleva su descriptor? (se detectó automáticamente)`);
      L.push(`var HAY_DESCRIPTORES = ${d.hayDescriptores};`);
      L.push('');
      L.push('var CRITERIOS = [');
      d.criterios.forEach((c) => {
        if (d.hayDescriptores) {
          L.push(`  { texto: ${lit(c.texto)},`);
          L.push(`    desc: [${(c.desc || []).map(lit).join(', ')}] },`);
        } else {
          L.push(`  { texto: ${lit(c.texto)} },`);
        }
      });
      L.push('];');
    } else {
      L.push('var NIVELES = [];');
      L.push('var HAY_DESCRIPTORES = false;');
      L.push('');
      L.push('// Cada criterio logrado vale 1 punto.');
      L.push('var CRITERIOS = [');
      d.criterios.forEach((c) => { L.push(`  { texto: ${lit(c.texto)} },`); });
      L.push('];');
    }
    return L.join('\n');
  }

  // =========================================================
  // MOTOR (idéntico en todos los códigos generados)
  // =========================================================
  const MOTOR = `
// ============================================================
//  MOTOR — normalmente no necesitas editar nada debajo de aquí
// ============================================================

var C = {
  BLANCO: "#FFFFFF", FONDO: "#FAFAFA", CLARO: "#F2F2F2", MEDIO: "#E6E6E6",
  FUERTE: "#BFBFBF", BORDE: "#7F7F7F", TEXTO: "#333333", TENUE: "#888888"
};
var SEP = "     ·     ";

// ---------- puntos de entrada ----------
function generarTodos() {
  var carpeta = obtenerCarpeta();
  var ok = 0, errores = [];
  for (var i = 0; i < ESTUDIANTES.length; i++) {
    var est = ESTUDIANTES[i];
    try {
      Logger.log("► " + (i + 1) + "/" + ESTUDIANTES.length + ": " + est[1]);
      crearInstrumento(carpeta, est[0], est[1], est[2]);
      ok++;
      Utilities.sleep(600);
    } catch (e) {
      errores.push(est[0] + ". " + est[1] + " → " + e.message);
      Logger.log("ERROR: " + e.toString());
    }
  }
  var msg = "✅ Proceso finalizado\\n" +
            PLURAL + " creadas: " + ok + " de " + ESTUDIANTES.length +
            "\\nCarpeta: " + carpeta.getName() + "\\n" + carpeta.getUrl();
  if (errores.length) msg += "\\n\\n⚠️ Errores:\\n" + errores.join("\\n");
  Logger.log("\\n====================\\n" + msg + "\\n====================\\n");
}

function probarConUno() {
  var carpeta = obtenerCarpeta();
  var e = ESTUDIANTES[0];
  crearInstrumento(carpeta, e[0], e[1], e[2]);
  Logger.log("✅ Prueba creada para: " + e[1] + "\\nCarpeta: " + carpeta.getUrl());
}

// ---------- Drive ----------
function obtenerCarpeta() {
  var padre = CARPETA_DESTINO_ID ? DriveApp.getFolderById(CARPETA_DESTINO_ID) : DriveApp.getRootFolder();
  var it = padre.getFoldersByName(CARPETA_NOMBRE);
  if (it.hasNext()) return it.next();
  return padre.createFolder(CARPETA_NOMBRE);
}

function crearInstrumento(carpeta, numLista, nombre, nie) {
  var numStr = numLista < 10 ? "0" + numLista : "" + numLista;
  var ss = SpreadsheetApp.create(numStr + ". " + nombre + " - " + TITULO_INSTRUMENTO);
  var hoja = ss.getActiveSheet();
  hoja.setName(TITULO_INSTRUMENTO);
  hoja.setHiddenGridlines(true);

  var archivo = DriveApp.getFileById(ss.getId());
  try {
    archivo.moveTo(carpeta);
  } catch (e) {
    carpeta.addFile(archivo);
    if (carpeta.getId() !== DriveApp.getRootFolder().getId()) DriveApp.getRootFolder().removeFile(archivo);
  }

  construir(hoja, numLista, nombre, nie);
  ocultarSobrante(hoja);
}

// ---------- construcción de la hoja ----------
function construir(hoja, numLista, nombre, nie) {
  var esRubrica = (INSTRUMENTO === "rubrica");
  var totalCols = esRubrica ? (NIVELES.length + 2) : 5;

  anchos(hoja, esRubrica);
  var fila = encabezado(hoja, totalCols, numLista, nombre, nie);
  var r = esRubrica ? tablaRubrica(hoja, fila) : tablaCotejo(hoja, fila);
  fila = notaFinal(hoja, r.fila, totalCols, r.celdaSubtotal, r.puntosMaximos);
  fila = observaciones(hoja, fila, totalCols);
  pie(hoja, fila, totalCols);
}

function anchos(hoja, esRubrica) {
  hoja.setColumnWidth(1, 12);
  if (esRubrica) {
    hoja.setColumnWidth(2, 250);
    var ancho = HAY_DESCRIPTORES ? 118 : 80;
    for (var i = 0; i < NIVELES.length; i++) hoja.setColumnWidth(3 + i, ancho);
    hoja.setColumnWidth(3 + NIVELES.length, 54);
    hoja.setColumnWidth(4 + NIVELES.length, 12);
  } else {
    hoja.setColumnWidth(2, 300);
    hoja.setColumnWidth(3, 68);
    hoja.setColumnWidth(4, 68);
    hoja.setColumnWidth(5, 190);
    hoja.setColumnWidth(6, 54);
    hoja.setColumnWidth(7, 12);
  }
}

function encabezado(hoja, totalCols, numLista, nombre, nie) {
  var fila = 1, rng;

  hoja.setRowHeight(fila, 6); fila++;

  hoja.setRowHeight(fila, 22);
  rng = hoja.getRange(fila, 2, 1, totalCols).merge();
  rng.setValue(ESCUELA).setFontFamily("Arial").setFontSize(12).setFontWeight("bold")
     .setHorizontalAlignment("center").setVerticalAlignment("middle");
  fila++;

  hoja.setRowHeight(fila, 16);
  var sub = [];
  if (UBICACION) sub.push(UBICACION);
  if (CODIGO_CENTRO) sub.push("Código: " + CODIGO_CENTRO);
  if (MAESTRO) sub.push("Docente: " + MAESTRO);
  rng = hoja.getRange(fila, 2, 1, totalCols).merge();
  rng.setValue(sub.join("   |   ")).setFontFamily("Arial").setFontSize(9).setFontColor(C.TEXTO)
     .setHorizontalAlignment("center").setVerticalAlignment("middle");
  fila++;

  hoja.setRowHeight(fila, 3);
  hoja.getRange(fila, 2, 1, totalCols).setBackground(C.FUERTE);
  fila++;

  hoja.setRowHeight(fila, 22);
  rng = hoja.getRange(fila, 2, 1, totalCols).merge();
  rng.setValue(TITULO_HOJA)
     .setFontFamily("Arial").setFontSize(11).setFontWeight("bold")
     .setHorizontalAlignment("center").setVerticalAlignment("middle").setBackground(C.MEDIO);
  bordes(rng);
  fila++;

  hoja.setRowHeight(fila, 5); fila++;

  var materia = MATERIA + (PONDERACION ? " (" + PONDERACION + ")" : "");
  fila = filaInfo(hoja, fila, totalCols, [["Materia", materia], ["Grado", GRADO], ["Período", PERIODO]], 18, 8);
  fila = filaInfo(hoja, fila, totalCols, [["Actividad", TIPO_ACTIVIDAD], ["Tema", TEMA]], 18, 8);
  fila = filaInfo(hoja, fila, totalCols, [
    ["N° de lista", String(numLista)],
    ["NIE", nie],
    ["Fecha límite", FECHA_LIMITE || "—"],
    ["Fecha de evaluación", "____ / ____ / " + ANIO]
  ], 18, 8);
  fila = filaInfo(hoja, fila, totalCols, [["Estudiante", nombre]], 20, 10);

  if (OBJETIVO) fila = filaInfo(hoja, fila, totalCols, [["Objetivo", OBJETIVO]], 32, 7.5);
  if (INDICADORES.length) {
    fila = filaInfo(hoja, fila, totalCols, [["Indicadores de logro", INDICADORES.join("   •   ")]], 32, 7.5);
  }

  hoja.setRowHeight(fila, 8); fila++;
  return fila;
}

// Una línea de "Etiqueta: valor" (varios pares por fila), con la etiqueta en negrita.
function filaInfo(hoja, fila, totalCols, pares, altura, tamano) {
  var texto = "", marcas = [];
  for (var i = 0; i < pares.length; i++) {
    if (i > 0) texto += SEP;
    var etiqueta = pares[i][0] + ": ";
    marcas.push([texto.length, texto.length + etiqueta.length]);
    texto += etiqueta + (pares[i][1] || "—");
  }
  var normal = SpreadsheetApp.newTextStyle().setFontFamily("Arial").setFontSize(tamano).setBold(false).setForegroundColor(C.TEXTO).build();
  var negrita = SpreadsheetApp.newTextStyle().setFontFamily("Arial").setFontSize(tamano).setBold(true).setForegroundColor("#000000").build();
  var rt = SpreadsheetApp.newRichTextValue().setText(texto).setTextStyle(0, texto.length, normal);
  for (var k = 0; k < marcas.length; k++) rt.setTextStyle(marcas[k][0], marcas[k][1], negrita);

  hoja.setRowHeight(fila, altura);
  var rng = hoja.getRange(fila, 2, 1, totalCols).merge();
  rng.setRichTextValue(rt.build()).setVerticalAlignment("middle").setWrap(true);
  return fila + 1;
}

// ---------- tabla: RÚBRICA ----------
function tablaRubrica(hoja, fila) {
  var nNiv = NIVELES.length;
  var totalCols = nNiv + 2;
  var colPts = 3 + nNiv;
  var rng;

  hoja.setRowHeight(fila, 20);
  rng = hoja.getRange(fila, 2, 1, totalCols).merge();
  rng.setValue("CRITERIOS DE EVALUACIÓN").setFontFamily("Arial").setFontSize(9).setFontWeight("bold")
     .setHorizontalAlignment("center").setVerticalAlignment("middle").setBackground(C.MEDIO).setFontColor(C.TEXTO);
  bordes(rng);
  fila++;

  hoja.setRowHeight(fila, 28);
  celdaCabecera(hoja, fila, 2, "CRITERIO");
  for (var i = 0; i < nNiv; i++) {
    var p = NIVELES[i].puntos;
    celdaCabecera(hoja, fila, 3 + i, NIVELES[i].nombre + "\\n(" + p + (p === 1 ? " pt)" : " pts)"));
  }
  celdaCabecera(hoja, fila, colPts, "Pts");
  fila++;

  var filaPrimera = fila, filasCasillas = [];

  for (var k = 0; k < CRITERIOS.length; k++) {
    var cr = CRITERIOS[k];
    var fondo = (k % 2 === 1) ? C.FONDO : C.BLANCO;
    var alto = HAY_DESCRIPTORES ? 2 : 1;
    var filaDesc = fila;
    var filaChk = HAY_DESCRIPTORES ? fila + 1 : fila;

    // Criterio (fusionado en vertical cuando hay descriptores)
    var celdaCrit = hoja.getRange(filaDesc, 2, alto, 1);
    if (alto > 1) celdaCrit.merge();
    hoja.getRange(filaDesc, 2).setValue(cr.texto)
        .setFontFamily("Arial").setFontSize(7.5).setFontWeight("bold");
    celdaCrit.setWrap(true).setVerticalAlignment("middle").setBackground(fondo);
    bordes(celdaCrit);

    if (HAY_DESCRIPTORES) {
      hoja.setRowHeight(filaDesc, 36);
      for (i = 0; i < nNiv; i++) {
        var cd = hoja.getRange(filaDesc, 3 + i);
        cd.setValue((cr.desc && cr.desc[i]) || "")
          .setFontFamily("Arial").setFontSize(6.5).setFontColor("#555555")
          .setWrap(true).setVerticalAlignment("top").setHorizontalAlignment("center").setBackground(fondo);
        bordes(cd);
      }
    }

    hoja.setRowHeight(filaChk, HAY_DESCRIPTORES ? 20 : 30);
    for (i = 0; i < nNiv; i++) {
      var cc = hoja.getRange(filaChk, 3 + i);
      cc.insertCheckboxes().setValue(false)
        .setHorizontalAlignment("center").setVerticalAlignment("middle").setBackground(fondo);
      bordes(cc);
    }

    // Puntos del criterio = suma de la casilla marcada
    var celdaPts = hoja.getRange(filaDesc, colPts, alto, 1);
    if (alto > 1) celdaPts.merge();
    var partes = [];
    for (i = 0; i < nNiv; i++) partes.push("IF(" + letra(3 + i) + filaChk + "," + NIVELES[i].puntos + ",0)");
    hoja.getRange(filaDesc, colPts).setFormula("=" + partes.join("+"))
        .setFontFamily("Arial").setFontSize(9).setFontWeight("bold").setNumberFormat("0");
    celdaPts.setHorizontalAlignment("center").setVerticalAlignment("middle").setBackground(fondo);
    bordes(celdaPts);

    filasCasillas.push(filaChk);
    fila = filaChk + 1;
  }

  var filaUltima = fila - 1;
  var puntosMaximos = maxPuntos() * CRITERIOS.length;

  // Subtotal
  hoja.setRowHeight(fila, 22);
  rng = hoja.getRange(fila, 2, 1, totalCols - 1).merge();
  rng.setValue("SUBTOTAL DE CRITERIOS (máximo " + puntosMaximos + " pts)")
     .setFontFamily("Arial").setFontSize(8).setFontWeight("bold")
     .setHorizontalAlignment("right").setVerticalAlignment("middle").setBackground(C.MEDIO);
  bordes(rng);
  var celdaSub = hoja.getRange(fila, colPts);
  celdaSub.setFormula("=SUM(" + letra(colPts) + filaPrimera + ":" + letra(colPts) + filaUltima + ")")
          .setFontFamily("Arial").setFontSize(10).setFontWeight("bold")
          .setHorizontalAlignment("center").setVerticalAlignment("middle")
          .setNumberFormat("0").setBackground(C.MEDIO);
  bordes(celdaSub);
  var celdaSubtotal = letra(colPts) + fila;
  fila++;

  // Aviso si se marca más de un nivel en el mismo criterio
  var reglas = [];
  for (k = 0; k < filasCasillas.length; k++) {
    var f = filasCasillas[k];
    var rango = hoja.getRange(f, 3, 1, nNiv);
    reglas.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied("=COUNTIF($" + letra(3) + f + ":$" + letra(2 + nNiv) + f + ",TRUE)>1")
      .setBackground("#FFE082").setRanges([rango]).build());
  }
  hoja.setConditionalFormatRules(reglas);

  return { fila: fila, celdaSubtotal: celdaSubtotal, puntosMaximos: puntosMaximos };
}

function maxPuntos() {
  var m = 0;
  for (var i = 0; i < NIVELES.length; i++) if (NIVELES[i].puntos > m) m = NIVELES[i].puntos;
  return m || 1;
}

// ---------- tabla: LISTA DE COTEJO ----------
function tablaCotejo(hoja, fila) {
  var totalCols = 5;   // criterio | sí | no | observaciones | pts
  var colPts = 6;
  var rng;

  hoja.setRowHeight(fila, 20);
  rng = hoja.getRange(fila, 2, 1, totalCols).merge();
  rng.setValue("CRITERIOS A VERIFICAR").setFontFamily("Arial").setFontSize(9).setFontWeight("bold")
     .setHorizontalAlignment("center").setVerticalAlignment("middle").setBackground(C.MEDIO).setFontColor(C.TEXTO);
  bordes(rng);
  fila++;

  hoja.setRowHeight(fila, 26);
  celdaCabecera(hoja, fila, 2, "CRITERIO");
  celdaCabecera(hoja, fila, 3, "SÍ LOGRA\\n(1 pt)");
  celdaCabecera(hoja, fila, 4, "NO LOGRA\\n(0 pts)");
  celdaCabecera(hoja, fila, 5, "OBSERVACIONES");
  celdaCabecera(hoja, fila, 6, "Pts");
  fila++;

  var filaPrimera = fila, filasCasillas = [];

  for (var k = 0; k < CRITERIOS.length; k++) {
    var fondo = (k % 2 === 1) ? C.FONDO : C.BLANCO;
    hoja.setRowHeight(fila, 30);

    var celdaCrit = hoja.getRange(fila, 2);
    celdaCrit.setValue(CRITERIOS[k].texto).setFontFamily("Arial").setFontSize(7.5)
             .setWrap(true).setVerticalAlignment("middle").setBackground(fondo);
    bordes(celdaCrit);

    for (var col = 3; col <= 4; col++) {
      var cc = hoja.getRange(fila, col);
      cc.insertCheckboxes().setValue(false)
        .setHorizontalAlignment("center").setVerticalAlignment("middle").setBackground(fondo);
      bordes(cc);
    }

    var obs = hoja.getRange(fila, 5);
    obs.setValue("").setFontFamily("Arial").setFontSize(7)
       .setWrap(true).setVerticalAlignment("middle").setBackground(fondo);
    bordes(obs);

    var pts = hoja.getRange(fila, colPts);
    pts.setFormula("=IF(C" + fila + ",1,0)")
       .setFontFamily("Arial").setFontSize(9).setFontWeight("bold")
       .setHorizontalAlignment("center").setVerticalAlignment("middle")
       .setNumberFormat("0").setBackground(fondo);
    bordes(pts);

    filasCasillas.push(fila);
    fila++;
  }

  var filaUltima = fila - 1;
  var puntosMaximos = CRITERIOS.length;

  hoja.setRowHeight(fila, 22);
  rng = hoja.getRange(fila, 2, 1, totalCols - 1).merge();
  rng.setValue("CRITERIOS LOGRADOS (máximo " + puntosMaximos + ")")
     .setFontFamily("Arial").setFontSize(8).setFontWeight("bold")
     .setHorizontalAlignment("right").setVerticalAlignment("middle").setBackground(C.MEDIO);
  bordes(rng);
  var celdaSub = hoja.getRange(fila, colPts);
  celdaSub.setFormula("=SUM(" + letra(colPts) + filaPrimera + ":" + letra(colPts) + filaUltima + ")")
          .setFontFamily("Arial").setFontSize(10).setFontWeight("bold")
          .setHorizontalAlignment("center").setVerticalAlignment("middle")
          .setNumberFormat("0").setBackground(C.MEDIO);
  bordes(celdaSub);
  var celdaSubtotal = letra(colPts) + fila;
  fila++;

  // Aviso si se marcan "Sí" y "No" a la vez
  var reglas = [];
  for (k = 0; k < filasCasillas.length; k++) {
    var f = filasCasillas[k];
    reglas.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied("=COUNTIF($C" + f + ":$D" + f + ",TRUE)>1")
      .setBackground("#FFE082").setRanges([hoja.getRange(f, 3, 1, 2)]).build());
  }
  hoja.setConditionalFormatRules(reglas);

  return { fila: fila, celdaSubtotal: celdaSubtotal, puntosMaximos: puntosMaximos };
}

// ---------- nota final, observaciones y pie ----------
function notaFinal(hoja, fila, totalCols, celdaSubtotal, puntosMaximos) {
  hoja.setRowHeight(fila, 8); fila++;

  hoja.setRowHeight(fila, 36);
  var rng = hoja.getRange(fila, 2, 1, totalCols - 1).merge();
  rng.setValue("NOTA FINAL (0 – " + NOTA_MAXIMA + ")")
     .setFontFamily("Arial").setFontSize(13).setFontWeight("bold")
     .setHorizontalAlignment("right").setVerticalAlignment("middle")
     .setBackground(C.MEDIO).setFontColor(C.TEXTO);
  bordes(rng);

  var celda = hoja.getRange(fila, totalCols + 1);
  celda.setFormula("=ROUND(" + celdaSubtotal + "/" + puntosMaximos + "*" + NOTA_MAXIMA + ",2)")
       .setFontFamily("Arial").setFontSize(18).setFontWeight("bold")
       .setHorizontalAlignment("center").setVerticalAlignment("middle")
       .setNumberFormat("0.00").setBackground(C.BLANCO);
  bordes(celda);
  fila++;

  hoja.setRowHeight(fila, 8);
  return fila + 1;
}

function observaciones(hoja, fila, totalCols) {
  hoja.setRowHeight(fila, 18);
  var rng = hoja.getRange(fila, 2, 1, totalCols).merge();
  rng.setValue("OBSERVACIONES / RETROALIMENTACIÓN")
     .setFontFamily("Arial").setFontSize(9).setFontWeight("bold")
     .setHorizontalAlignment("center").setVerticalAlignment("middle")
     .setBackground(C.MEDIO).setFontColor(C.TEXTO);
  bordes(rng);
  fila++;

  hoja.setRowHeight(fila, 46);
  rng = hoja.getRange(fila, 2, 1, totalCols).merge().setValue("");
  rng.setFontFamily("Arial").setFontSize(8).setWrap(true).setVerticalAlignment("top");
  bordes(rng);
  return fila + 2;
}

function pie(hoja, fila, totalCols) {
  hoja.setRowHeight(fila, 26);
  var rng = hoja.getRange(fila, 2, 1, totalCols).merge();
  rng.setValue("Instrumento de evaluación conforme al Manual «Evaluación al Servicio del Aprendizaje y del Desarrollo» (MINED). " +
               "La nota se calcula automáticamente al marcar las casillas.")
     .setFontFamily("Arial").setFontSize(7).setFontColor(C.TENUE)
     .setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);
}

// ---------- utilidades de formato ----------
function celdaCabecera(hoja, fila, col, texto) {
  var celda = hoja.getRange(fila, col);
  celda.setValue(texto).setFontFamily("Arial").setFontSize(7).setFontWeight("bold")
       .setHorizontalAlignment("center").setVerticalAlignment("middle")
       .setWrap(true).setBackground(C.CLARO);
  bordes(celda);
}

function letra(col) {
  var s = "";
  while (col > 0) {
    var r = (col - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}

function bordes(rango) {
  rango.setBorder(true, true, true, true, true, true, C.BORDE, SpreadsheetApp.BorderStyle.SOLID);
}

function ocultarSobrante(hoja) {
  try {
    var esRubrica = (INSTRUMENTO === "rubrica");
    var ultimaCol = esRubrica ? (NIVELES.length + 3) : 7;
    var maxCol = hoja.getMaxColumns();
    if (maxCol > ultimaCol) hoja.hideColumns(ultimaCol + 1, maxCol - ultimaCol);
    var maxRow = hoja.getMaxRows(), lastRow = hoja.getLastRow();
    if (maxRow > lastRow + 2) hoja.hideRows(lastRow + 3, maxRow - lastRow - 2);
  } catch (e) { /* si falla, la hoja igual queda usable */ }
}
`;

  // =========================================================
  // API
  // =========================================================
  function generar(instrumento, ctx) {
    instrumento = instrumento || {};
    ctx = ctx || {};
    const cfg = ctx.config || {};
    const act = ctx.actividad || {};

    const tipo = instrumento.tipo;
    if (tipo !== 'rubrica' && tipo !== 'cotejo') {
      return { ok: false, error: 'Primero elige el instrumento: rúbrica o lista de cotejo.' };
    }

    const criterios = (instrumento.criterios || [])
      .map((c) => ({ texto: (c.texto || '').trim(), desc: (c.desc || []).map((d) => (d || '').trim()) }))
      .filter((c) => c.texto);
    if (!criterios.length) {
      return { ok: false, error: 'El instrumento no tiene criterios. Agrégalos o siémbralos desde los indicadores seleccionados.' };
    }

    const estudiantes = (ctx.estudiantes || [])
      .filter((e) => (e.name || '').trim())
      .map((e, i) => ({ n: i + 1, name: e.name.trim(), nie: e.nie || '' }));
    if (!estudiantes.length) {
      return {
        ok: false,
        error: ctx.origen === 'ordinaria'
          ? 'No hay estudiantes. Elige el grado en «Configuración general» para tomar la lista completa.'
          : 'No hay estudiantes en la tabla (sección 01 · Estudiantes).',
      };
    }

    const niveles = (instrumento.escala || [])
      .map((n) => ({ label: (n.label || '').trim() || 'Nivel', puntos: Number(n.puntos) || 0 }))
      .filter((n) => n.puntos > 0);
    if (tipo === 'rubrica' && !niveles.length) {
      return { ok: false, error: 'La rúbrica no tiene niveles de desempeño con puntaje.' };
    }

    const hayDescriptores = tipo === 'rubrica' &&
      criterios.some((c) => c.desc.some((d) => d));

    // Los indicadores solo se imprimen aparte si NO son ya los criterios
    // (cuando se sembraron desde el currículo, repetirlos alarga la hoja).
    const indicadores = (ctx.indicadores || []).map((ind) => {
      const codigo = (ind.codigo || '').trim();
      const texto = (ind.texto || '').trim();
      return codigo ? `${codigo} ${texto}` : texto;
    }).filter(Boolean);
    const textosInd = (ctx.indicadores || []).map((i) => (i.texto || '').trim());
    const sembrados = criterios.every((c) => textosInd.indexOf(c.texto) !== -1);

    const tituloInstrumento = tipo === 'rubrica' ? 'Rúbrica' : 'Lista de cotejo';
    const tituloHoja = tipo === 'rubrica' ? 'RÚBRICA DE EVALUACIÓN' : 'LISTA DE COTEJO';
    const plural = tipo === 'rubrica' ? 'Rúbricas' : 'Listas de cotejo';
    const carpeta = nombreCarpeta(ctx, tituloInstrumento);
    const periodo = [cfg.trimestre, cfg.anio].filter(Boolean).join(' ');
    const ponderacion = act.ponderacion ? `${act.ponderacion}%` : '';

    const datos = {
      carpeta,
      instrumento: tipo,
      tituloInstrumento,
      tituloHoja,
      plural,
      escuela: cfg.institucion || '',
      ubicacion: cfg.ubicacion || '',
      codigo: cfg.codigo || '',
      maestro: cfg.docente || '',
      materia: cfg.materia || '',
      grado: ctx.grado || cfg.grado || '',
      periodo,
      anio: cfg.anio || '',
      tipoActividad: act.tipoLabel ? `${act.tipoLabel}${ponderacion ? ' (' + ponderacion + ')' : ''}` : '',
      tema: act.titulo || '',
      ponderacion,
      fechaLimite: fechaCorta(cfg.fechaLimite),
      objetivo: (ctx.objetivos || []).map(stripHtml).filter(Boolean).join('  '),
      indicadores: sembrados ? [] : indicadores,
      estudiantes,
      niveles,
      hayDescriptores,
      criterios,
    };

    const escala = niveles.map((n) => `${n.label} (${n.puntos})`).join(' · ');
    const cabecera = [
      '/**',
      ' * ============================================================',
      ` * ${tituloInstrumento.toUpperCase()} DE EVALUACIÓN — ${datos.tema || datos.materia || 'Actividad'}`,
      ` * ${datos.tipoActividad || 'Actividad de evaluación'}${datos.grado ? ' · ' + datos.grado : ''}`,
      ' * ------------------------------------------------------------',
      ` * Generado por el Framework de Actas el ${hoy()}.`,
      ` * ${estudiantes.length} estudiante${estudiantes.length === 1 ? '' : 's'}` +
        `${tipo === 'rubrica' ? ' · escala: ' + escala : ' · 1 punto por criterio logrado'}`,
      ' *',
      ' * CÓMO USARLO',
      ' *   1. Entra a https://script.google.com y crea un proyecto nuevo.',
      ' *   2. Borra todo lo que traiga el editor y pega este código.',
      ' *   3. Arriba selecciona la función  probarConUno  y pulsa ▷ Ejecutar.',
      ' *      (La primera vez Google pedirá autorización: acéptala.)',
      ' *   4. Revisa en Drive que el formato te guste; luego ejecuta  generarTodos.',
      ' *',
      ' * Los archivos se crean dentro de la carpeta:',
      ` *   «${carpeta}»`,
      ' * ============================================================',
      ' */',
      '',
    ].join('\n');

    return {
      ok: true,
      codigo: `${cabecera}${bloqueConstantes(datos)}\n${MOTOR}`,
      carpeta,
      totalEstudiantes: estudiantes.length,
      tituloInstrumento,
    };
  }

  window.AppsScriptGen = { generar };
})();
