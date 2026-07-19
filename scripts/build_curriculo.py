# -*- coding: utf-8 -*-
"""Ensambla js/curriculo.js a partir de todos los programas de estudio."""
import importlib, json, sys, io
import extract_curriculo as E
importlib.reload(E)
sys.stdout.reconfigure(encoding='utf-8')

DL='C:/Users/Chery/Downloads/'
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

def build():
    data={}
    for asig, fn, allowed, dg, ns, eng in JOBS:
        units=E.extract_pdf(DL+fn, allowed, dg, ns, eng)
        d=data.setdefault(asig,{})
        for u in units:
            g=u['grade'] or dg or 'Sin grado'
            arr=d.setdefault(g,[])
            arr.append({
                'unidad':u['unit'],
                'nombre':u['nombre'] if 'nombre' in u else u['name'],
                'objetivo':u['objetivo'],
                'indicadores':[{'codigo':c,'texto':t} for c,t in u['indicadores']],
            })
    # ordenar unidades por numero y grados por orden pedagogico
    for asig in data:
        for g in data[asig]:
            data[asig][g].sort(key=lambda x:x['unidad'])
        data[asig]=dict(sorted(data[asig].items(),
                               key=lambda kv: GRADE_ORDER.index(kv[0]) if kv[0] in GRADE_ORDER else 99))
    return data

def main():
    data=build()
    # resumen
    tot_i=0; tot_u=0
    for asig in data:
        for g in data[asig]:
            us=data[asig][g]; ii=sum(len(u['indicadores']) for u in us)
            tot_u+=len(us); tot_i+=ii
            print(f'{asig:26} {g:18} unidades={len(us):2} indicadores={ii}')
    print(f'--- TOTAL unidades={tot_u} indicadores={tot_i}')
    js='// Base de datos del curriculo nacional (MINED/MINEDUCYT, El Salvador)\n'
    js+='// Generado automaticamente desde los programas de estudio oficiales.\n'
    js+='// Estructura: CURRICULO[asignatura][grado] = [ {unidad, nombre, objetivo, indicadores:[{codigo,texto}]} ]\n'
    js+='window.CURRICULO = '+json.dumps(data, ensure_ascii=False, indent=1)+';\n'
    out='C:/Users/Chery/OneDrive/Desktop/Framework recuperacion/actas-recuperacion/js/curriculo.js'
    io.open(out,'w',encoding='utf-8').write(js)
    print('WROTE',out,len(js),'bytes')

if __name__=='__main__':
    main()
