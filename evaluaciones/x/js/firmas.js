// =========================================================
// Firmas automáticas en documentos
// Convierte la firma WebP a PNG para que pdfmake y docx puedan incrustarla.
// =========================================================
(function () {
  'use strict';

  const FIRMA_JOSE_ELISEO = 'firmas/firma-jose-eliseo.webp';
  const NOMBRE_JOSE_ELISEO = 'José Eliseo Martínez Rodríguez';
  let firmaPng = null;
  let cargaFirma = null;

  function normalizarNombre(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function esJoseEliseo(nombre) {
    return normalizarNombre(nombre) === normalizarNombre(NOMBRE_JOSE_ELISEO);
  }

  function estaActiva(config) {
    return !config || config.firmarDocumentos !== false;
  }

  function blobADataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function cargarImagen(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('No se pudo decodificar la firma WebP.'));
      image.src = src;
    });
  }

  async function cargarYConvertirFirma() {
    const response = await fetch(FIRMA_JOSE_ELISEO);
    if (!response.ok) throw new Error(`No se encontró ${FIRMA_JOSE_ELISEO}.`);
    const webpDataUrl = await blobADataUrl(await response.blob());
    const image = await cargarImagen(webpDataUrl);
    const scale = Math.min(1, 600 / image.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return {
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    };
  }

  async function preparar(config) {
    if (!estaActiva(config)) return null;
    if (firmaPng) return firmaPng;
    if (!cargaFirma) {
      cargaFirma = cargarYConvertirFirma()
        .then((firma) => {
          firmaPng = firma;
          return firma;
        })
        .catch((error) => {
          console.warn('Firma de José Eliseo no disponible:', error.message);
          return null;
        });
    }
    return cargaFirma;
  }

  function obtener(nombre, config) {
    if (!estaActiva(config) || !esJoseEliseo(nombre)) return null;
    return firmaPng;
  }

  window.FirmasDocumento = {
    preparar,
    obtener,
    esJoseEliseo,
  };
})();
