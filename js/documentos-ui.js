// =========================================================
// Documentos descargables — programas de estudio + Manual
// Renderiza tarjetas con miniatura de la 1.ª página + botones Abrir/Descargar.
// Rutas relativas → funciona en GitHub Pages (hosting estático).
// =========================================================
(function () {
  'use strict';

  const grid = document.getElementById('documentos-grid');
  if (!grid || !Array.isArray(window.DOCUMENTOS)) return;

  function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }

  function render() {
    grid.innerHTML = '';
    window.DOCUMENTOS.forEach((doc) => {
      // Los nombres tienen espacios/acentos/paréntesis → se codifican para la URL.
      const href = 'Programas/' + encodeURIComponent(doc.archivo);
      const card = document.createElement('div');
      card.className = 'doc-card';
      // El Manual (retrato) llena el cuadro con recorte; los programas (paisaje) no.
      const thumbFill = doc.categoria === 'Manual' ? ' doc-thumb--fill' : '';
      card.innerHTML = `
        <a class="doc-thumb${thumbFill}" href="${href}" target="_blank" rel="noopener" title="Abrir ${esc(doc.titulo)}">
          <img src="${esc(doc.thumb)}" alt="Portada — ${esc(doc.titulo)}" loading="lazy">
        </a>
        <div class="doc-body">
          <span class="doc-cat">${esc(doc.categoria)}</span>
          <p class="doc-title">${esc(doc.titulo)}</p>
          <div class="doc-actions">
            <a class="doc-btn" href="${href}" target="_blank" rel="noopener">Abrir</a>
            <a class="doc-btn doc-btn-primary" href="${href}" download="${esc(doc.archivo)}">Descargar</a>
          </div>
        </div>`;
      grid.appendChild(card);
    });
  }

  render();
})();
