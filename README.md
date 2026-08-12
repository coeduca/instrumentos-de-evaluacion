# COEDUCA · Instrumentos de evaluación

Repositorio unificado para el framework de generación de actas, constancias, instructivos e instrumentos de evaluación.

## Accesos en GitHub Pages

- **Versión general:** https://coeduca.github.io/instrumentos-de-evaluacion/evaluaciones/general/
- **Versión personal (X):** https://coeduca.github.io/instrumentos-de-evaluacion/evaluaciones/x/

La estructura está pensada para poder cambiar rápidamente entre ambas variantes sustituyendo únicamente `general` por `x` en la URL:

```text
https://coeduca.github.io/instrumentos-de-evaluacion/evaluaciones/general/
https://coeduca.github.io/instrumentos-de-evaluacion/evaluaciones/x/
```

La raíz del sitio mantiene un acceso compatible y redirige automáticamente a la versión general:

```text
https://coeduca.github.io/instrumentos-de-evaluacion/
```

## Estructura

```text
instrumentos-de-evaluacion/
├── index.html
├── README.md
├── .nojekyll
└── evaluaciones/
    ├── shared/
    │   └── Programas/       # PDFs y miniaturas compartidos
    ├── general/
    │   └── index.html
    └── x/
        └── index.html
```

### `evaluaciones/general/`
Versión para uso general por los docentes, sin autenticación de Google Drive ni firma personal automática.

### `evaluaciones/x/`
Versión personal con las funciones adicionales ya existentes, incluyendo integración con Google Drive y firma personal.

## Publicación

En **Settings → Pages** del repositorio, publica la rama `main` desde `/ (root)`.

## Recursos compartidos

Los programas de estudio, el Manual de Evaluación y sus miniaturas viven una sola vez en `evaluaciones/shared/Programas/`. Ambas variantes los consumen desde esa carpeta, evitando duplicar los archivos más pesados.
