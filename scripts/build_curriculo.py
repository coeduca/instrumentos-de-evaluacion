# -*- coding: utf-8 -*-
"""Ensambla js/curriculo.js a partir de todos los programas de estudio."""
import importlib, json, sys, io, os, re
import extract_curriculo as E
importlib.reload(E)
sys.stdout.reconfigure(encoding='utf-8')

BASE=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DL=os.path.join(BASE,'Programas')+os.sep
III=['Séptimo','Octavo','Noveno']
BACH=['Primer año','Segundo año']

COMPU='Programa de estudios de Ciencias de la Computación (1er Año).pdf'
INGLES_A1P='Programa de Ingles AI+_Web.pdf'

# (asignatura, archivo, allowed_grades, default_grade, names_summary, english)
JOBS=[
 ('Matemática', 'Programa de estudio III ciclo.pdf', III, None, True, False),
 ('Matemática', 'Programa de estudio bachillerato.pdf', BACH, None, True, False),
 ('Ciencia y Tecnología', 'Programas de estudio_Ciencia y Tecnología_III ciclo.pdf', III, None, False, False),
 ('Ciencia y Tecnología', 'Programas de estudio_Ciencia y Tecnología_Bachillerato.pdf', BACH, None, False, False),
 ('Lengua y Literatura', 'Programas de estudio_Lengua y Literatura_III ciclo.pdf', III, None, False, False),
 ('Lengua y Literatura', 'Programas de estudio_Lengua y Literatura_Bachillerato.pdf', BACH, None, False, False),
 ('Ciudadanía y Valores', 'Programa de estudios Ciudadanía y Valores III ciclo.pdf', III, None, False, False),
 ('Ciudadanía y Valores', 'Programa de estudio Ciudadanía y Valores Educación Media.pdf', BACH, None, False, False),
 ('Educación Física', 'Programa de estudio_Educación Física_III ciclo.pdf', III, None, False, False),
 ('Educación Física', 'Programas de estudio_Educación Física_Bachillerato.pdf', BACH, None, False, False),
 ('Proyecto de Vida y Carrera', 'Programas_de_estudio_Proyecto_de_Vida_y_Carrera.pdf', BACH, None, False, False),
 # Ciencias de la Computación: programa nuevo, mismo contenido para 1.º y 2.º año
 ('Ciencias de la Computación', COMPU, ['Primer año'], 'Primer año', False, False),
 ('Ciencias de la Computación', COMPU, ['Segundo año'], 'Segundo año', False, False),
 # Inglés: III ciclo por nivel MCER; bachillerato 1.º y 2.º usan A1+
 ('Inglés', 'Programa de estudio Inglés III Ciclo y Educación Media.pdf', None, 'Séptimo (PreA1)', False, True),
 ('Inglés', 'Programa de estudio_Inglés_A1_III Ciclo.pdf', None, 'Octavo (A1)', False, True),
 ('Inglés', INGLES_A1P, None, 'Noveno (A1+)', False, True),
 ('Inglés', INGLES_A1P, ['Segundo año (A1+)'], 'Primer año (A1+)', False, True),
 ('Inglés', INGLES_A1P, ['Segundo año (A1+)'], 'Segundo año (A1+)', False, True),
]

GRADE_ORDER=['Séptimo','Octavo','Noveno',
             'Séptimo (PreA1)','Octavo (A1)','Noveno (A1+)',
             'Primer año','Segundo año','Primer año (A1+)','Segundo año (A1+)']

# Correcciones manuales: formulas matematicas con exponentes/fracciones que el
# PDF renderiza como glifos apilados y salen desordenadas al extraer el texto.
# Clave: (asignatura, grado, unidad, codigo) -> texto corregido segun el PDF.
FIXES={
 ('Matemática','Séptimo',6,'6.13'): "Representa en la forma y = a/x, dos variables que están en una relación de proporcionalidad inversa, a partir de una tabla.",
 ('Matemática','Séptimo',6,'6.14'): "Representa en la forma y = a/x, dos variables que están en una relación de proporcionalidad inversa, a partir de un par de valores de y y x.",
 ('Matemática','Noveno',3,'3.3'): "Resuelve ecuaciones de la forma x2 = c.",
 ('Matemática','Noveno',4,'4.3'): "Describe las características de la función y = x2 a partir de los puntos ubicados en el plano cartesiano.",
 ('Matemática','Noveno',4,'4.4'): "Elabora la gráfica y = ax2 con a > 1 o 0 < a < 1, a partir de la gráfica y = x2.",
 ('Matemática','Noveno',4,'4.5'): "Elabora la gráfica y = −ax2 con a > 0, a partir de la gráfica y = x2.",
 ('Matemática','Noveno',4,'4.7'): "Describe el cambio en los valores de la función y = ax2.",
 ('Matemática','Noveno',4,'4.10'): "Grafica la función y = ax2 + c, con c > 0, realizando desplazamientos verticales en c unidades, a partir de la gráfica de y = ax2.",
 ('Matemática','Noveno',4,'4.11'): "Grafica la función y = ax2 + c, con c < 0, realizando desplazamientos verticales en c unidades, a partir de la gráfica de y = ax2.",
 ('Matemática','Primer año',4,'4.6'): "Grafica y encuentra el dominio y el rango de la función g(x) = a(x – h)2, para h < 0, usando desplazamientos horizontales de f(x) = ax2.",
 ('Matemática','Primer año',4,'4.8'): "Grafica y encuentra el dominio y el rango de la función g(x) = a(x – h)2 + k, usando desplazamientos horizontales y verticales de f(x) = ax2.",
}

def split_objetivos(text):
    """Divide el bloque de competencia(s) de unidad en items individuales,
    quitando la numeracion '1. 2. ...' o las viñetas '– ' y los rotulos
    'Unit competences' que se cuelan del encabezado."""
    if not text: return []
    t = re.sub(r'\s+', ' ', text).strip()
    t = re.sub(r'(?i)^unit\s+competenc(?:ie|e)s?\s*:?\s*', '', t)
    t = re.sub(r'(?i)^competencias?\s+de\s+(?:la\s+)?unidad\s*:?\s*', '', t)
    items=[]
    if re.match(r'^\s*[–—]\s*|^-\s+', t):
        # viñetas '– ' o '- ' (solo guiones rodeados de espacio, no los internos)
        items=[p.strip() for p in re.split(r'\s*[–—]\s+|(?:^|\s)-\s+', t) if p.strip()]
    elif re.match(r'^\s*1[\.\)]\s', t):
        # partir por numeracion ascendente 1. 2. 3. ...
        n=1; pos=re.match(r'^\s*1[\.\)]\s*', t).end()
        while True:
            nxt=re.search(r'\s%d[\.\)]\s+'%(n+1), t[pos:])
            if not nxt:
                items.append(t[pos:].strip()); break
            items.append(t[pos:pos+nxt.start()].strip())
            pos+=nxt.end(); n+=1
    else:
        items=[t]
    out=[]
    for it in items:
        it=it.strip()
        # encabezado de la tabla que a veces queda pegado al final
        it=re.sub(r'(?i)[.\s]*procedural contents?\.?\s*$', '.', it).strip()
        it=re.sub(r'[,;]\s*$', '.', it)          # nunca terminar en coma
        if it and not re.search(r'[.!?]$', it): it+='.'
        if len(it)>5: out.append(it)
    return out

def load_traducciones():
    p=os.path.join(os.path.dirname(os.path.abspath(__file__)),'traducciones_ingles.json')
    if not os.path.exists(p): return {}
    return json.load(io.open(p,encoding='utf-8'))

def norm_key(s):
    """Clave de busqueda robusta para las traducciones: minusculas, sin
    espacios repetidos ni puntuacion final."""
    s=re.sub(r'\s+',' ',s).strip().lower()
    return s.rstrip('.,; ')

def build():
    trad=load_traducciones()
    tmap={norm_key(k):v for k,v in trad.items()}
    faltantes=set()
    def traducir(txt):
        v=tmap.get(norm_key(txt))
        if v is None:
            faltantes.add(txt)
            return txt
        return v
    data={}
    for asig, fn, allowed, dg, ns, eng in JOBS:
        units=E.extract_pdf(DL+fn, allowed, dg, ns, eng)
        d=data.setdefault(asig,{})
        for u in units:
            g=u['grade'] or dg or 'Sin grado'
            arr=d.setdefault(g,[])
            objetivos=split_objetivos(u['objetivo'])
            inds=[(c,t) for c,t in u['indicadores']]
            if eng:
                # errata del programa A1+ (U1): el codigo '1.6' salio impreso
                # como '16', por lo que 1.5 y 1.6 llegan fusionados
                fixed=[]
                for c,t in inds:
                    m=re.search(r'[,.]\s*16\s+(recognize\s.+)$', t)
                    if m:
                        fixed.append((c, re.sub(r'[,.]\s*16\s+recognize\s.+$', '.', t)))
                        fixed.append(('1.6', m.group(1).strip()))
                    else:
                        fixed.append((c,t))
                inds=fixed
            if eng:
                objetivos=[traducir(o) for o in objetivos]
                inds=[(c,traducir(t)) for c,t in inds]
            objetivos=[re.sub(r'[,;]\s*$','.',o) for o in objetivos]
            inds=[(c,re.sub(r'[,;]\s*$','.',t)) for c,t in inds]
            inds=[(c,FIXES.get((asig,g,u['unit'],c),t)) for c,t in inds]
            arr.append({
                'unidad':u['unit'],
                'nombre':u['nombre'] if 'nombre' in u else u['name'],
                'objetivos':objetivos,
                'indicadores':[{'codigo':c,'texto':t} for c,t in inds],
            })
    # ordenar unidades por numero y grados por orden pedagogico
    for asig in data:
        for g in data[asig]:
            data[asig][g].sort(key=lambda x:x['unidad'])
        data[asig]=dict(sorted(data[asig].items(),
                               key=lambda kv: GRADE_ORDER.index(kv[0]) if kv[0] in GRADE_ORDER else 99))
    if faltantes:
        print(f'AVISO: {len(faltantes)} textos de Inglés SIN traduccion:')
        for t in sorted(faltantes): print('   -', t[:110])
    return data

def main():
    data=build()
    # resumen
    tot_i=0; tot_u=0; sin_obj=[]
    for asig in data:
        for g in data[asig]:
            us=data[asig][g]; ii=sum(len(u['indicadores']) for u in us)
            tot_u+=len(us); tot_i+=ii
            for u in us:
                if not u['objetivos']: sin_obj.append(f'{asig} {g} U{u["unidad"]}')
            print(f'{asig:26} {g:18} unidades={len(us):2} indicadores={ii}')
    print(f'--- TOTAL unidades={tot_u} indicadores={tot_i}')
    if sin_obj:
        print(f'--- UNIDADES SIN OBJETIVO ({len(sin_obj)}):')
        for s in sin_obj: print('   ', s)
    js='// Base de datos del curriculo nacional (MINED/MINEDUCYT, El Salvador)\n'
    js+='// Generado automaticamente desde los programas de estudio oficiales.\n'
    js+='// Estructura: CURRICULO[asignatura][grado] = [ {unidad, nombre, objetivos:[str], indicadores:[{codigo,texto}]} ]\n'
    js+='window.CURRICULO = '+json.dumps(data, ensure_ascii=False, indent=1)+';\n'
    out=os.path.join(BASE,'js','curriculo.js')
    io.open(out,'w',encoding='utf-8').write(js)
    print('WROTE',out,len(js),'bytes')

if __name__=='__main__':
    main()
