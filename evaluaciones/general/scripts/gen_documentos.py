# -*- coding: utf-8 -*-
"""Genera miniaturas de la 1.ª página de cada PDF de Programas/ y emite js/documentos.js."""
import fitz, os, json, sys, re
sys.stdout.reconfigure(encoding='utf-8')

BASE = 'C:/Users/Chery/OneDrive/Desktop/Framework recuperacion/actas-recuperacion'
PROG = os.path.join(BASE, 'Programas')
THUMBS = os.path.join(PROG, 'thumbs')
os.makedirs(THUMBS, exist_ok=True)

# archivo -> (titulo, categoria, slug, orden)
META = {
  'Evaluación al servicio del aprendizaje y desarrollo.pdf':
    ('Manual de Evaluación al Servicio del Aprendizaje y del Desarrollo', 'Manual', 'manual-evaluacion', 0),
  'Programa de estudio III ciclo.pdf':
    ('Matemática — III Ciclo (7.º–9.º)', 'Programa de estudio', 'matematica-iii', 10),
  'Programa de estudio bachillerato.pdf':
    ('Matemática — Bachillerato (1.º–2.º)', 'Programa de estudio', 'matematica-bach', 11),
  'Programas de estudio_Ciencia y Tecnología_III ciclo.pdf':
    ('Ciencia y Tecnología — III Ciclo', 'Programa de estudio', 'ciencia-iii', 20),
  'Programas de estudio_Ciencia y Tecnología_Bachillerato.pdf':
    ('Ciencia y Tecnología — Bachillerato', 'Programa de estudio', 'ciencia-bach', 21),
  'Programas de estudio_Lengua y Literatura_III ciclo.pdf':
    ('Lengua y Literatura — III Ciclo', 'Programa de estudio', 'lengua-iii', 30),
  'Programas de estudio_Lengua y Literatura_Bachillerato.pdf':
    ('Lengua y Literatura — Bachillerato', 'Programa de estudio', 'lengua-bach', 31),
  'Programa de estudios Ciudadanía y Valores III ciclo.pdf':
    ('Ciudadanía y Valores — III Ciclo', 'Programa de estudio', 'ciudadania-iii', 40),
  'Programa de estudio Ciudadanía y Valores Educación Media.pdf':
    ('Ciudadanía y Valores — Educación Media', 'Programa de estudio', 'ciudadania-media', 41),
  'Programa de estudio_Educación Física_III ciclo.pdf':
    ('Educación Física — III Ciclo', 'Programa de estudio', 'edfisica-iii', 50),
  'Programas de estudio_Educación Física_Bachillerato.pdf':
    ('Educación Física — Bachillerato', 'Programa de estudio', 'edfisica-bach', 51),
  'Programas_de_estudio_Proyecto_de_Vida_y_Carrera.pdf':
    ('Proyecto de Vida y Carrera — Bachillerato', 'Programa de estudio', 'proyecto-vida', 60),
  'Programa de estudios de Ciencias de la Computación (1er Año).pdf':
    ('Ciencias de la Computación — Bachillerato', 'Programa de estudio', 'computacion', 70),
  'Programa de estudio Inglés III Ciclo y Educación Media.pdf':
    ('Inglés (PreA1) — III Ciclo y Media', 'Programa de estudio', 'ingles-prea1', 80),
  'Programa de estudio_Inglés_A1_III Ciclo.pdf':
    ('Inglés (A1) — III Ciclo', 'Programa de estudio', 'ingles-a1', 81),
  'Programa de Ingles AI+_Web.pdf':
    ('Inglés (A1+) — III Ciclo y Bachillerato', 'Programa de estudio', 'ingles-a1plus', 82),
}

def render_thumb(pdf_path, out_path, width=420):
    doc = fitz.open(pdf_path)
    page = doc[0]
    zoom = width / page.rect.width
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
    pix.save(out_path)
    doc.close()
    return os.path.getsize(out_path)

items = []
missing = []
for fn in sorted(os.listdir(PROG)):
    if not fn.lower().endswith('.pdf'):
        continue
    meta = META.get(fn)
    if not meta:
        missing.append(fn);
        titulo = os.path.splitext(fn)[0]
        categoria = 'Programa de estudio'
        slug = re.sub(r'[^a-z0-9]+', '-', titulo.lower()).strip('-')[:40]
        orden = 999
    else:
        titulo, categoria, slug, orden = meta
    thumb_rel = f'Programas/thumbs/{slug}.png'
    sz = render_thumb(os.path.join(PROG, fn), os.path.join(THUMBS, f'{slug}.png'))
    items.append({'titulo': titulo, 'categoria': categoria, 'archivo': fn, 'thumb': thumb_rel, 'orden': orden, '_kb': round(sz/1024)})

items.sort(key=lambda x: (x['orden'], x['titulo']))
for it in items:
    print(f"{it['orden']:3} {it['_kb']:4}KB  {it['titulo']}")
if missing:
    print('SIN META (revisar):', missing)

# emitir js/documentos.js
out = items
for it in out:
    del it['orden']; del it['_kb']
js = '// Documentos descargables (programas de estudio + Manual). Rutas relativas para GitHub Pages.\n'
js += '// Estructura: DOCUMENTOS = [ {titulo, categoria, archivo, thumb} ]  — el PDF está en Programas/<archivo>\n'
js += 'window.DOCUMENTOS = ' + json.dumps(out, ensure_ascii=False, indent=1) + ';\n'
open(os.path.join(BASE, 'js', 'documentos.js'), 'w', encoding='utf-8').write(js)
print('WROTE js/documentos.js con', len(out), 'documentos')
