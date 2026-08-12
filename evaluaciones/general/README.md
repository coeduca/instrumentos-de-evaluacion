# Generador de Actas de Recuperación

Sitio estático (sin backend) para gestionar actividades ordinarias y procesos de
recuperación. Genera constancias de refuerzo/notificación, instructivos, instrumentos y,
de forma opcional, actas de compromiso. Todo corre en el navegador del docente — ningún
dato de estudiantes se envía a un servidor.

## Navegación

La app abre en una **página de inicio** con tres opciones: **Generar Actividad Ordinaria**,
**Generar actividad de recuperación** y **Documentos descargables** (esta última, por ahora,
un marcador para los programas de estudio y el Manual). La configuración general (institución,
docente, firmas, etc.) es compartida; cada flujo tiene su **propia** selección de indicadores/
objetivos e instrumento (independientes entre sí).

## Estado actual

- ✅ Configuración general (institución, docente, trimestre, etc.)
- ✅ Búsqueda de estudiantes con autocompletado desde `js/students.js`, con
  opción de agregar manualmente si un estudiante no está en la base de datos.
- ✅ Tabla dinámica de estudiantes con nota y estado (Pendiente / Aprobado / Reprobado).
- ✅ Autoguardado en `localStorage` — si recargas la página no pierdes lo que llevabas.
- ✅ Selector de temas en el menú lateral: **Default**, **Dark**, **Frutiger**
  (Windows 7 / Frutiger Aero), **Skeuo** (skeuomorfismo de los primeros
  iPhone), **Glass** (Glassmorphism con transparencias y desenfoque) y
  **Sketch** (papel, tinta y trazos dibujados a mano). La preferencia queda
  guardada en `localStorage` y también se incluye en los respaldos.
- ✅ Base de datos del currículo nacional (`js/curriculo.js`): 1 790 indicadores de
  logro y objetivos de unidad extraídos de los programas de estudio oficiales del
  MINED, en 8 asignaturas (Matemática, Ciencia y Tecnología, Lengua y Literatura,
  Ciudadanía y Valores, Educación Física, Proyecto de Vida y Carrera, Ciencias de la
  Computación e Inglés), 7.º–9.º y 1.º–2.º bachillerato. Inglés por nivel MCER
  (PreA1/A1/A1+; bachillerato usa A1+); Computación usa el mismo programa en 1.º y
  2.º año. Buscador en cascada (Asignatura → Grado → Unidad), búsqueda por
  palabra clave, selección de indicadores no alcanzados y objetivos, y opción de
  agregar manualmente (`js/curriculo-ui.js`). La selección persiste en `localStorage`
  y se expone en `window.CurriculoSeleccion.get()` para incorporarla a las actas.
- ✅ Sección de actividades de recuperación (agregar/eliminar bloques).
- ✅ Instrumento de evaluación (`js/instrumento-ui.js`): rúbrica (criterios × niveles
  con escala cualitativa+cuantitativa) o lista de cotejo (criterio · sí logra · no
  logra · observaciones), con sembrado automático desde los indicadores no alcanzados
  seleccionados. Puede comenzar en hoja separada o continuar tras el instructivo.
- ✅ Generación de PDF (pdfmake) y Word (docx): por cada estudiante produce
  **Actividad de recuperación** · **Instrumento** (rúbrica o lista de cotejo) y, mediante
  un switch desactivado por defecto, una **Acta de compromiso opcional**. Además genera la
  constancia de refuerzo/notificación; las actas de resultado o incumplimiento quedan como respaldos opcionales.
- ✅ La constancia de refuerzo incorpora el aval institucional del **num. 15.d** de la
  Normativa de Evaluación: Director/a · Docente responsable de grado · Representante del
  Equipo de Evaluación, y deja documentada la notificación del proceso. Los nombres de
  Director/a y del representante se solicitan únicamente en la fase de refuerzo/notificación.
- ✅ Actividad ordinaria (`js/ordinaria-ui.js`): genera el **instructivo de una actividad
  de evaluación ordinaria** (Actividad Integradora · Cotidiana · Prueba) con tipo,
  ponderación limitada al porcentaje oficial de su categoría (35/35/30), indicadores a
  evaluar, objetivos opcionales, indicaciones, instrumento y firma docente. Respaldo para el expediente.
- ✅ Selecciones independientes: currículo e instrumento son factories reutilizables
  (`createCurriculoPicker`, `createInstrumento`) instanciadas por separado para la vista
  ordinaria y la de recuperación; lo elegido en una no afecta a la otra.
- ✅ Firmas 15.d también en el **acta de incumplimiento** (aval institucional + estudiante).
- ✅ Documentos descargables (`js/documentos.js` + `js/documentos-ui.js`): tarjetas con
  **miniatura de la 1.ª página** (pre-renderizada en `../shared/Programas/thumbs/`) y botones
  **Abrir** (nueva pestaña) y **Descargar** para los 16 PDF (Manual + 15 programas) de
  `../shared/Programas/`. Rutas relativas con `encodeURIComponent` → funciona en GitHub Pages.

## Actualizar los documentos descargables

Los PDF van en `../shared/Programas/`. Las miniaturas y el índice `js/documentos.js` se generan con
`scripts/gen_documentos.py` (usa PyMuPDF: `pip install pymupdf`). Si agregas o cambias un
PDF, añade su entrada al diccionario `META` del script y vuelve a ejecutarlo.

## Cómo probarlo localmente

No necesitas instalar nada, es HTML/CSS/JS puro. Solo necesitas servirlo con un
servidor local (abrir el `index.html` directo con doble clic puede fallar por
restricciones del navegador al cargar `js/students.js`):

```bash
# Opción 1: Python (ya viene instalado en la mayoría de sistemas)
cd actas-recuperacion
python3 -m http.server 8000
# abre http://localhost:8000

# Opción 2: extensión "Live Server" de VS Code
```

## Estructura del proyecto

```
actas-recuperacion/
├── index.html          # Estructura de la página
├── css/
│   └── styles.css       # Estilos base (complementa Tailwind CDN)
├── js/
│   ├── students.js       # Base de datos de estudiantes (la que enviaste)
│   └── app.js             # Toda la lógica: búsqueda, CRUD, autoguardado
├── assets/
│   └── logo.png            # ⚠️ Debes colocar aquí el logo institucional
└── README.md
```

## Pendiente: agregar tu logo

Coloca el archivo del logo institucional en `assets/logo.png`. Ya está
referenciado en el header de `index.html` y quedará listo para reutilizarse en
los PDF/Word cuando conectemos esa fase (se convertirá a base64 una sola vez al
cargar la página).

## Actualizar la base de datos de estudiantes

Cada vez que cambien de trimestre o año, solo reemplaza `js/students.js` por la
versión actualizada — la estructura (`NIE: { name, grade }`) debe mantenerse
igual para que el autocompletado siga funcionando.

## Despliegue en GitHub Pages

1. Sube esta carpeta a un repositorio de GitHub.
2. Ve a **Settings → Pages**.
3. En "Source" selecciona la rama `main` y la carpeta `/ (root)`.
4. Guarda — en un par de minutos el sitio estará publicado en
   `https://tu-usuario.github.io/nombre-del-repo/`.

## Cierre del proceso de recuperación (num. 13.1.c / 13.2.c)

La vista de recuperación se organiza en **3 pestañas de fase** (cada una se
realiza en su propio momento): **1 · Refuerzo educativo → 2 · Recuperación →
3 · Cierre del proceso**, con ✓ en las fases que ya generaron documentos.
Las columnas **¿Entregó?/Nota recup.** de la tabla solo aparecen en la fase 3.

En la fase de cierre se elige **tipo de recuperación** (ordinaria o
extraordinaria) y el nivel se infiere del grado (Básica, mínima 5.0 · Media, mínima 6.0).
En la tabla de estudiantes se marca **¿Entregó?** y la **nota de recuperación**.

- En la **ordinaria**, la nota sustituye a la original **solo si es mayor** (num. 13.1.c).
- En la **extraordinaria**, el framework calcula exactamente
  **(promedio final reprobado + nota de recuperación) / 2**. No redondea antes de
  decidir. Si el resultado exacto alcanza la mínima, registra como nota final 5.0
  en Básica o 6.0 en Media; si no, conserva el promedio final reprobado (num. 13.2.c).
- Si no existe una nota de recuperación, el framework **no inventa 0.0**; conserva
  la calificación o promedio previo que corresponda.

Las actas de resultado/incumplimiento son respaldos **opcionales**. La tabla muestra
la operación realizada para que el docente pueda verificar visualmente el cálculo.

Cuando una extraordinaria no alcanza la mínima, el framework muestra una ruta
condicional según el grado: en 7.º–9.º y 1.º Bachillerato habilita la **actividad de
último recurso** prevista por los nums. 35 y 40.1.b; en 2.º Bachillerato muestra la
vía de **examen de suficiencia** del num. 40.2.d, porque el Manual no establece ahí
una actividad de último recurso.

También hay **constancia de refuerzo educativo** (sección 03, norms. 12/31/39),
**checklist del expediente** (num. 15), **vista previa** de los PDF y
**validación amable** que avisa qué falta antes de generar.

## Mis procesos (guardado automático)

Un proceso de recuperación dura días o semanas, así que cada espacio de trabajo
vive como un **proceso guardado**: las tarjetas del inicio tienen un botón
**«＋ Iniciar nuevo proceso»** que guarda el actual, limpia todo y arranca en
blanco. La sección **«Mis procesos»** del inicio lista todos los procesos con
resumen automático (materia · período, estudiantes, fases ✓) y permite
**Retomar** (restaura estudiantes, indicadores, actividades, instrumento,
refuerzo y hasta la fase en la que ibas), renombrar ✎ o eliminar ✕. Todo se
auto-guarda mientras trabajas (IndexedDB, almacén `procesos`).

## Expediente digital y respaldo

Cada documento generado se archiva automáticamente por estudiante en
**IndexedDB** (local, sin servidor): vista «Expedientes» con perfil por
estudiante, secciones por materia, filtro por período y regeneración de
PDF/Word idénticos desde el registro. Los botones **⬇ Respaldo / ⬆ Restaurar**
del encabezado exportan/importan todo (configuración + expedientes) en un
archivo JSON para compartir entre docentes o cambiar de computadora.


## Criterio de simplificación normativa

El flujo de recuperación prioriza únicamente los pasos exigidos por el Manual de Evaluación incluido en `../shared/Programas/`:

1. refuerzo educativo documentado y constancia de notificación (nums. 12, 15.a y 15.d);
2. actividad de recuperación vinculada a los aprendizajes/actividades no alcanzados, con criterios e instrumento (nums. 8.2.b y 13.1.b);
3. conservación de comprobantes en el expediente (num. 15.b);
4. aplicación de la regla de sustitución/promedio y registro en el mecanismo oficial (nums. 13.1.c, 13.2.c y 18).

El acta de compromiso y las actas de resultado/incumplimiento se conservan únicamente como documentos opcionales de uso interno. No forman parte de la ruta mínima obligatoria. Los objetivos de aprendizaje son contexto opcional; los indicadores de logro son el referente principal.

### Principio de mínima carga administrativa

El flujo de recuperación está diseñado para pedir primero únicamente lo necesario según el Manual incluido en el proyecto:

1. Documentar el refuerzo y la notificación.
2. Preparar la actividad de recuperación vinculada a los indicadores no alcanzados, con sus criterios e instrumento de evaluación.
3. Aplicar la regla de sustitución/promedio que corresponda y registrar la nota en el mecanismo oficial.

El **acta de compromiso** está desactivada por defecto y las **actas de resultado/incumplimiento** se muestran como respaldos opcionales. NIE, objetivos de aprendizaje y otros datos auxiliares no bloquean la generación cuando el Manual no los establece como requisito del documento.
