# -*- coding: utf-8 -*-
"""Extractor de indicadores de logro y competencia de unidad de los programas
de estudio del MINED/MINEDUCYT (El Salvador).

Layout comun de las paginas de unidad: 3 columnas
  [Contenidos conceptuales] [Contenidos procedimentales] [Indicadores de logro]
La columna de indicadores es la mas a la derecha; sus items empiezan con un
codigo N.N (unidad.numero). Recorremos todas las paginas manteniendo el grado
(texto rotado en el margen) y la unidad actual (encabezado 'N Unidad Nombre' +
'Competencia:'), y extraemos la columna derecha por posicion."""
import pdfplumber, re, sys, json

CODE_ONLY = re.compile(r'^\d{1,2}\.\d{1,2}\.?$')
CODE_START = re.compile(r'^(\d{1,2})\.(\d{1,2})\.?\s+(.*)$')

def clean(s):
    if not s: return s
    s = s.replace('\xad', '')
    s = re.sub(r'(\w)-\s+(\w)', r'\1\2', s)   # une palabras cortadas por guion
    s = re.sub(r'\s+', ' ', s).strip()
    return s

CANON = ['Séptimo','Octavo','Noveno','Primer año','Segundo año','Tercer año']

def detect_grade(page, allowed=None):
    cands = allowed or CANON
    # 1) texto rotado en el margen (cada palabra puede venir invertida)
    try:
        wrot = [w['text'] for w in page.extract_words(extra_attrs=['upright']) if not w.get('upright', True)]
    except Exception:
        wrot = []
    rev = ' '.join(w[::-1] for w in wrot)
    hay_rot = (' '.join(wrot) + ' ' + rev).lower()
    for g in cands:
        if g.lower() in hay_rot:
            return g
    # 2) encabezado de texto normal
    low = (page.extract_text() or '').lower()
    for g in cands:
        if g.lower() in low:
            return g
    return None

def _fix_unit_num(raw):
    """El encabezado a veces trae el nº de unidad con un '2' espurio (22->2, 62->6).
    Como las unidades son <=8, si sale >8 tomamos el primer digito."""
    n=int(raw)
    if n>8: n=int(str(n)[0])
    return n

def detect_unit(txt, english=False):
    """Devuelve (num, nombre, objetivo) si la pagina abre/continua una unidad."""
    num=name=obj=None
    UWORD = 'Unit' if english else 'Unidad'
    m = re.search(r'(\d{1,2})\s*\n?\s*'+UWORD+r'\s+([A-Za-zÁÉÍÓÚÑ][^\n]+)', txt)
    if not m:
        m = re.search(r'\b'+UWORD+r'\s+(?:N[°º]\s*)?(\d{1,2})[:\.\s]+([A-Za-zÁÉÍÓÚÑ][^\n]+)', txt)
    if m:
        num=_fix_unit_num(m.group(1))
        stops = r'Approximate time|Conceptual Content|Performance' if english else r'Duración|Eje integrador|Competencia|Tiempo probable'
        name=clean(re.split(stops, m.group(2))[0])
        name=re.split(r'\.\s', name)[0].strip()
        if english:
            # quitar prefijos de la pagina-leyenda "number and name of unit"
            name=re.sub(r'(?i)\bnumber and name\b','',name)
            if re.search(r'(?i)\bunit\b', name):
                name=re.split(r'(?i)\bunit\b', name)[-1]
            name=name.strip(' :.-')
        elif name and name[:1].islower():
            # titulo partido (Educación Física): la 1.ª parte va en la línea
            # anterior al número. Ej: 'Estilos de vida...\n1\nUnidad del movimiento'.
            pre=None
            for numstr in {m.group(1), str(_fix_unit_num(m.group(1)))}:
                pre = re.search(r'([A-ZÁÉÍÓÚÑ][^\n]{3,})\n\s*'+re.escape(numstr)+r'\s*\n\s*'+UWORD+r'\b', txt)
                if pre: break
            if pre:
                first=clean(re.split(stops, pre.group(1))[0])
                if first and len(first)>4 and not re.search(r'(?i)nombre de la|\bunidad\b|grado|duración|estructura', first):
                    name=first+' '+name
        if len(name)<3: name=None
    # objetivo / competencia(s) de unidad
    if english:
        # los programas usan 'UNIT COMPETENCES' o 'UNIT COMPETENCIES' segun edicion
        mo = re.search(r'UNIT COMPETENC(?:IE|E)S?\s*(.+?)(?:\d\s*Unit|Conceptual Content|Performance Indicators)', txt, re.S)
        if mo:
            cand=clean(mo.group(1))
            if 8 < len(cand) < 900: obj=cand
    else:
        mo = re.search(r'Competencias?\s+de\s+(?:la\s+)?unidad\s*:?\s*(.+)', txt, re.S|re.I)
        if not mo:
            mo = re.search(r'\bCompetencia\s*:\s*(.+)', txt, re.S|re.I)
        if mo:
            cand=re.split(r'Contenidos|CONTENIDOS|Indicadores de logro|Conceptos claves|Tiempo probable|Eje integrador|Duración\s*:|▪', mo.group(1))[0]
            cand=clean(cand)
            if len(cand) > 2200:   # sin marcador de corte: recorta al último ítem numerado
                mlast = list(re.finditer(r'\b\d\.\s', cand))
                if len(mlast) >= 2:
                    # corta en el punto final de la última competencia numerada
                    tail = cand[mlast[-1].end():]
                    dot = tail.find('. ')
                    cand = cand[:mlast[-1].end()+ (dot+1 if dot>0 else len(tail))].strip()
                else:
                    cand = cand[:900]
            # las unidades con 2-3 competencias numeradas superan facil los 1200
            if 8 < len(cand) < 2600: obj=cand
    return num, name, obj

def names_from_summary(pdf, allowed):
    """Para Matematica: los titulos van partidos en la pagina de unidad, pero el
    inicio del programa trae 'Unidad N: Nombre. ...' agrupado por grado en tablas
    'PROGRAMA ACTUAL <GRADO> GRADO'."""
    gmap={'SÉPTIMO':'Séptimo','OCTAVO':'Octavo','NOVENO':'Noveno',
          'PRIMER':'Primer año','SEGUNDO':'Segundo año','PRIMERO':'Primer año'}
    names={}
    grade=None
    for pg in pdf.pages:
        txt=pg.extract_text() or ''
        mh=re.search(r'PROGRAMA\s+ACTUAL\s+(SÉPTIMO|OCTAVO|NOVENO|PRIMER|SEGUNDO|PRIMERO)',txt)
        if mh: grade=gmap.get(mh.group(1))
        gh=re.search(r'programa\s+(?:actual\s+)?de\s+(séptimo|octavo|noveno|primer|segundo)',txt,re.I)
        if gh: grade=gmap.get(gh.group(1).upper())
        for m in re.finditer(r'Unidad\s+(\d{1,2}):\s*([^\n.]+)\.', txt):
            if grade and (not allowed or grade in allowed):
                num=int(m.group(1)); nm=clean(m.group(2))
                if 3<len(nm)<80:
                    names.setdefault((grade,num),nm)
    return names

# frases que solo aparecen en las paginas introductorias de los programas
INTRO_MARKERS = [
    'malla curricular','componentes curriculares','refuerzo académico',
    'competencias de grado','estructura y descripción de una unidad',
    'secuencia didáctica','el estudiantado como protagonista','modelaje docente',
    'tipos de evaluación','el cuaderno de ciencias','el aula como laboratorio',
    'experiencia directa','descripción de una unidad de aprendizaje',
    'enfoque de la asignatura','lineamientos metodológicos','plan de estudio de',
    'estructura de unidad','estructura y organización de la unidad','estructura y organización de la unidad didáctica',
    'ejes integradores','presentación de una unidad',
]

def decorrupt(t):
    """Elimina basura de columnas mezcladas carácter a carácter (firma: muchas
    transiciones minúscula→MAYÚSCULA pegadas, p. ej. 'AsiIgCnaA uDn')."""
    if len(re.findall(r'[a-záéíóúñ][A-ZÁÉÍÓÚÑ]', t)) < 4:
        return t   # <4 transiciones: texto normal (incluye fórmulas como NaCl)
    m = re.search(r'[a-záéíóúñ][A-ZÁÉÍÓÚÑ]', t)
    cut = t[:m.start()+1]
    p = cut.rfind('. ')
    if p >= 10: return cut[:p+1].strip()
    p2 = cut.rstrip().rfind('.')
    if p2 >= 10: return cut[:p2+1].strip()
    return cut.strip()

def looks_intro(text, english=False):
    if not text or not text[0].isalpha():
        return True
    # en espanol un indicador real empieza con verbo en mayuscula
    if not english and not text[0].isupper():
        return True
    low = text.lower()
    return any(m in low for m in INTRO_MARKERS)

def is_unit_page(txt, english=False):
    """Solo las paginas con la tabla de unidad de 3 columnas."""
    low = txt.lower()
    if txt.count('....') >= 3: return False
    if english:
        if 'performance indicator' in low and 'content' in low: return True
        # paginas de continuacion de la tabla: sin encabezado, pero con codigos
        # de indicador N.N seguidos de minuscula ('students can ...')
        return len(re.findall(r'(?m)(?:^|\s)\d{1,2}\.\d{1,2}\s+[a-z]', txt)) >= 1
    if 'indicadores de logro' not in low: return False
    if 'contenidos' not in low: return False
    if any(m in low for m in INTRO_MARKERS): return False
    return True

SIDEBAR_MARKERS = ['Conceptos claves','Notación','Relación y desarrollo','Conceptos clave']

def polish(t, english=False):
    """Quita basura de pie de pagina / cajas laterales del final del indicador."""
    t = decorrupt(t)   # elimina basura de columnas mezcladas
    if english:
        for mk in ['Approximate time','UNIT COMPETENCES','UNIT COMPETENCIES','Keywords','Attitudinal competenc']:
            i=t.find(mk)
            if i>0: t=t[:i]
        # caja lateral de vocabulario con pronunciacion pegada al final del
        # indicador: tras un punto de cierre siguen pares 'palabra /ipa/'.
        # OJO: no cortar menciones legitimas de fonemas a mitad de oracion
        # ('pronounce /t/, /d/, and /ɪd/ sounds...').
        for m in re.finditer(r'[.!?]\s', t):
            tail=t[m.end():]
            if len(re.findall(r'/[^/\s][^/]{0,49}/', tail)) >= 2:
                t=t[:m.start()+1]
                break
        t=re.sub(r'\s+(PreA1|A1\+|A1|A2\+|A2|B1)\s*$','',t)
        t=re.sub(r'[,;]\s*$', '.', t.strip())
        return t.strip()
    for mk in SIDEBAR_MARKERS:
        i = t.find(mk)
        if i > 0: t = t[:i]
    # palabra de encabezado 'Indicadores (de logro)' que se cuela en el texto
    t = re.sub(r'\s*Indicadores(\s+de\s+logro)?\s*', ' ', t)
    t = re.sub(r'\s+de\s+logro\s*$', '', t)   # fragmento residual del encabezado
    # numero de pagina + encabezado de grado al final
    t = re.sub(r'\s+\d{1,4}\s*(Séptimo|Octavo|Noveno|Primer año|Segundo año)?\s*(grado)?\s*$', '', t)
    t = re.sub(r'\s+(Séptimo|Octavo|Noveno|Primer año|Segundo año)\s+grado\s*$', '', t)
    # ningun indicador debe terminar en coma o punto y coma
    t = re.sub(r'[,;]\s*$', '.', t.strip())
    return t.strip()

def competencia_posicional(page):
    """Matemática no rotula 'Unidad N' en la página: el título va en un cajetín
    a la izquierda y la competencia a la derecha bajo 'COMPETENCIA(S) DE UNIDAD',
    entremezclados en el texto plano. Se extrae por posición: palabras a la
    derecha del encabezado, entre este y 'Tiempo probable'/'CONTENIDOS'."""
    words = [w for w in page.extract_words() if w.get('upright', True)]
    # el encabezado a veces sale duplicado y entrelazado caracter a caracter
    # ('COMPCEOTMENPCEITAE...'), por eso basta con el prefijo COMP + longitud
    hdr = [w for w in words if w['text'].upper().startswith('COMPETENCIA')
           or (w['text'].upper().startswith('COMP') and len(w['text']) >= 12)]
    if not hdr: return None
    h = hdr[0]
    x_min = h['x0'] - 8
    top0 = h['bottom']
    stops = [w['top'] for w in words
             if w['text'] in ('Tiempo','CONTENIDOS','Contenidos') and w['top'] > top0]
    bot = min(stops) if stops else page.height
    sel = [w for w in words if w['x0'] >= x_min and top0 - 2 < w['top'] < bot - 2]
    if not sel: return None
    sel.sort(key=lambda w:(round(w['top']), w['x0']))
    lines=[]; cur=[]; last=None
    for w in sel:
        if last is None or abs(w['top']-last) <= 4: cur.append(w)
        else: lines.append(cur); cur=[w]
        last=w['top']
    if cur: lines.append(cur)
    txt=' '.join(' '.join(w['text'] for w in ln) for ln in lines)
    txt=clean(txt)
    # descartar capturas rotas (paginas de estructura/muestra)
    if len(txt) < 40: return None
    if not (txt[:1].isupper() or txt[:1] in '–—-'): return None
    return txt

def right_col_indicators(page, english=False):
    h = page.height
    ws = [w for w in page.extract_words() if w.get('upright', True)
          and 26 < w['top'] < h - 26]          # excluir bandas de encabezado y pie
    if not ws: return []
    code_x = sorted(w['x0'] for w in ws if CODE_ONLY.match(w['text']))
    if not code_x: return []
    # separar codigos en clusters por saltos > 60; el cluster mas a la derecha es indicadores
    clusters=[[code_x[0]]]
    for x in code_x[1:]:
        if x-clusters[-1][-1] > 60: clusters.append([x])
        else: clusters[-1].append(x)
    right = clusters[-1]
    boundary = min(right) - 14
    col = [w for w in ws if w['x0'] >= boundary]
    col.sort(key=lambda w:(round(w['top']), w['x0']))
    # agrupar en lineas por 'top'
    lines=[]; cur=[]; last=None
    for w in col:
        if last is None or abs(w['top']-last) <= 5:
            cur.append(w)
        else:
            lines.append(cur); cur=[w]
        last=w['top']
    if cur: lines.append(cur)
    text_lines=[' '.join(w['text'] for w in ln) for ln in lines]
    # separar en indicadores por codigo al inicio
    inds=[]; code=None; buf=[]
    for ln in text_lines:
        s=ln.strip()
        m=CODE_START.match(s)
        if m:
            if code: inds.append((code, clean(' '.join(buf))))
            code=f"{int(m.group(1))}.{int(m.group(2))}"; buf=[m.group(3)]
        elif re.match(r'^(Indicadores\s+de\s+logro|Performance\s+Indicators|Students\s+can)', s, re.I):
            continue
        else:
            if code: buf.append(s)
    if code: inds.append((code, clean(' '.join(buf))))
    # recuperar indicadores fusionados: un codigo N.M incrustado a mitad de texto
    letter = r'[A-Za-zÁÉÍÓÚÑ]' if english else r'[A-ZÁÉÍÓÚÑ]'
    EMB = re.compile(r'\s(\d{1,2}\.\d{1,2})\s+'+letter)
    split=[]
    for c,t in inds:
        m=EMB.search(t)
        while m:
            split.append((c, t[:m.start()].strip()))
            c=m.group(1); t=t[m.start():].strip()
            t=re.sub(r'^\d{1,2}\.\d{1,2}\s+', '', t)
            m=EMB.search(t)
        split.append((c,t))
    inds=split
    inds = [(c, polish(t, english)) for c, t in inds]
    ok = (lambda t: t[:1].isalpha()) if english else (lambda t: t[:1].isupper())
    return [(c,t) for c,t in inds if len(t)>=8 and ok(t)]

def extract_pdf(path, allowed=None, default_grade=None, names_summary=False, english=False):
    units={}  # (grade,num) -> dict
    order=[]
    with pdfplumber.open(path) as pdf:
        pages=list(pdf.pages)
        texts=[pg.extract_text() or '' for pg in pages]
        # --- grado por pagina: relleno HACIA DELANTE, inicializado con el primer
        # grado detectado. Así las páginas de apertura de unidad iniciales (que no
        # traen el sidebar de grado, este aparece en la página siguiente) heredan
        # el grado correcto, sin alterar los límites entre grados.
        raw=[detect_grade(pg, allowed) for pg in pages]
        first_detected=next((g for g in raw if g), default_grade)
        pg_grade=[]; grade=first_detected or default_grade
        for g in raw:
            if g: grade=g
            pg_grade.append(grade)
        # --- pasada 1: mapa de nombres/objetivos por (grado, unidad) ---
        namemap={}; objmap={}
        for i,pg in enumerate(pages):
            grade=pg_grade[i]; txt=texts[i]
            if txt.count('....')>=3: continue
            low=txt.lower()
            if not english and any(mk in low for mk in INTRO_MARKERS): continue
            num,name,obj = detect_unit(txt, english)
            if num is not None and grade is not None:
                k=(grade,num)
                if name and len(name)>len(namemap.get(k,'')): namemap[k]=name
                if obj and k not in objmap: objmap[k]=obj
        if names_summary:
            # la tabla resumen del inicio es la fuente autoritativa de nombres en
            # Matemática (la pasada 1 puede confundir términos como 'Unidad imaginaria')
            for k,nm in names_from_summary(pdf, allowed).items():
                namemap[k]=nm
        # --- pasada 2: indicadores ---
        for i,pg in enumerate(pages):
            grade=pg_grade[i]; txt=texts[i]
            if not is_unit_page(txt, english):
                continue
            inds=right_col_indicators(pg, english)
            if inds:
                # asignar al bloque cuya unidad coincide con el prefijo del codigo
                pref=int(inds[0][0].split('.')[0])
                key=(grade,pref)
                if key not in units:
                    units[key]={'grade':grade,'unit':pref,'name':namemap.get(key),'objetivo':objmap.get(key),'indicadores':[]}
                    order.append(key)
                # Matemática: la competencia esta en la misma pagina de la tabla,
                # sin encabezado 'Unidad N' -> extraccion por posicion (la propia
                # funcion localiza el encabezado COMPETENCIA(S) y devuelve None si no hay)
                if not units[key]['objetivo'] and not english:
                    cp=competencia_posicional(pg)
                    if cp: units[key]['objetivo']=cp
                lst=units[key]['indicadores']
                idx={c:i for i,(c,_) in enumerate(lst)}
                for c,t in inds:
                    if looks_intro(t, english):
                        continue
                    if c in idx:
                        # si el existente parece intro y el nuevo no, reemplazar
                        if looks_intro(lst[idx[c]][1]):
                            lst[idx[c]]=(c,t)
                    else:
                        idx[c]=len(lst); lst.append((c,t))
    # fusionar bloques de grado None (primera pagina de unidad sin grado detectado
    # aun) en el siguiente bloque real de la misma unidad
    def merge_into(dst, src):
        have={c for c,_ in dst['indicadores']}
        for c,t in src['indicadores']:
            if c not in have and not looks_intro(t):
                dst['indicadores'].append((c,t)); have.add(c)
        if not dst['name'] and src['name']: dst['name']=src['name']
        if not dst['objetivo'] and src['objetivo']: dst['objetivo']=src['objetivo']
    for nk in [k for k in list(order) if k[0] is None]:
        target=None; seen=False
        for k in order:
            if k==nk: seen=True; continue
            if seen and k[0] is not None and k[1]==nk[1]: target=k; break
        if target is None:
            for k in order:
                if k[0] is not None and k[1]==nk[1]: target=k; break
        if target:
            merge_into(units[target], units[nk])
            del units[nk]; order.remove(nk)
    # descartar bloques sin indicadores y ordenar indicadores por codigo
    result=[]
    for k in order:
        u=units[k]
        if not u['indicadores']: continue
        u['indicadores'].sort(key=lambda ci:[int(x) for x in ci[0].split('.')])
        result.append(u)
    return result

if __name__=='__main__':
    path=sys.argv[1]
    data=extract_pdf(path)
    import sys as _s; _s.stdout.reconfigure(encoding='utf-8')
    for u in sorted(data, key=lambda u:(str(u['grade']), u['unit'])):
        print(f"[{u['grade']}] U{u['unit']} {str(u['name'])[:40]!r} inds={len(u['indicadores'])} obj={'Y' if u['objetivo'] else '-'}")
        for c,t in u['indicadores'][:2]:
            print('     ',c, t[:75])
    print('TOTAL blocks',len(data),'indicadores',sum(len(u['indicadores']) for u in data))
