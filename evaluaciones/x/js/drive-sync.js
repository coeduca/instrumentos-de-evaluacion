// Sincronización de COEDUCA con Google Drive usando Google Identity Services.
// El acceso se limita a archivos creados por esta aplicación (drive.file).
(function () {
  'use strict';

  const CLIENT_ID = '458052686123-acg35q9poj9ir3hgjgnhtcqavutrrv2h.apps.googleusercontent.com';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const DRIVE_API = 'https://www.googleapis.com/drive/v3';
  const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  const BACKUP_NAME = 'Respaldo_COEDUCA.coeduca';
  const KEY_DIRTY = 'coeduca-drive:dirty';
  const KEY_META = 'coeduca-drive:last-meta';
  const KEY_ACCOUNT = 'coeduca-drive:account';
  const KEY_UPLOAD_DOCS = 'coeduca-drive:upload-documents';
  const KEY_SESSION_TOKEN = 'coeduca-drive:session-token';

  let tokenClient = null;
  let accessToken = '';
  let tokenExpiresAt = 0;
  let tokenExpiryTimer = null;
  let currentAccount = readJson(KEY_ACCOUNT, null);
  let suspended = false;
  let syncing = false;
  let syncTimer = null;
  let rootFolderId = '';
  let backupFolderId = '';
  let conflictResolver = null;
  let pendingSaveButton = null;
  let bypassClickButton = null;
  let suppressClickButton = null;
  let pendingFolderOverride = null;
  let pendingUploadMode = '';
  let longPressTimer = null;

  const ui = {};

  restoreSessionToken();

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function restoreSessionToken() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY_SESSION_TOKEN) || 'null');
      if (saved && saved.accessToken && Number(saved.expiresAt) > Date.now() + 30000) {
        accessToken = saved.accessToken;
        tokenExpiresAt = Number(saved.expiresAt);
      } else {
        sessionStorage.removeItem(KEY_SESSION_TOKEN);
      }
    } catch (e) {
      try { sessionStorage.removeItem(KEY_SESSION_TOKEN); } catch (ignore) {}
    }
  }

  function rememberSessionToken(token, expiresInSeconds) {
    accessToken = token || '';
    tokenExpiresAt = Date.now() + (Number(expiresInSeconds || 3600) * 1000);
    try { sessionStorage.setItem(KEY_SESSION_TOKEN, JSON.stringify({ accessToken, expiresAt: tokenExpiresAt })); } catch (e) {}
    scheduleTokenExpirationNotice();
  }

  function clearSessionToken() {
    accessToken = '';
    tokenExpiresAt = 0;
    clearTimeout(tokenExpiryTimer);
    try { sessionStorage.removeItem(KEY_SESSION_TOKEN); } catch (e) {}
  }

  function scheduleTokenExpirationNotice() {
    clearTimeout(tokenExpiryTimer);
    if (!accessToken || !tokenExpiresAt) return;
    const delay = Math.max(0, tokenExpiresAt - Date.now() - 30000);
    tokenExpiryTimer = setTimeout(() => {
      clearSessionToken();
      updateAccountUi();
      setStatus('pending', 'Renovar acceso a Drive', 'La autorización temporal venció. Pulsa “Reanudar Drive” para renovarla.');
    }, delay);
  }

  function isDirty() { return localStorage.getItem(KEY_DIRTY) === '1'; }
  function hasValidToken() { return Boolean(accessToken) && Date.now() < tokenExpiresAt - 30000; }

  function setMessage(message) {
    if (ui.message) ui.message.textContent = message;
  }

  function setStatus(status, text, message) {
    if (ui.indicator) {
      ui.indicator.className = `drive-sync-pill is-${status}`;
      ui.indicator.title = text;
    }
    if (ui.indicatorText) ui.indicatorText.textContent = text;
    if (message) setMessage(message);
  }

  function updateAccountUi() {
    if (ui.account) ui.account.textContent = currentAccount
      ? (currentAccount.emailAddress || currentAccount.displayName || 'Cuenta conectada')
      : 'Sin conectar';
    if (ui.connect) ui.connect.textContent = hasValidToken() ? 'Cambiar cuenta' : (currentAccount ? 'Reanudar Drive' : 'Conectar cuenta');
    if (ui.syncNow) ui.syncNow.classList.toggle('hidden', !hasValidToken());
  }

  function markDirty(reason) {
    if (suspended) return;
    localStorage.setItem(KEY_DIRTY, '1');
    const label = reason ? `Cambios pendientes: ${reason}.` : 'Hay cambios pendientes de guardar.';
    const nextStep = hasValidToken() ? 'Se sincronizarán automáticamente.' : 'Se sincronizarán al reanudar Drive.';
    setStatus('pending', 'Cambios sin guardar', `${label} ${nextStep}`);
    clearTimeout(syncTimer);
    if (hasValidToken() && navigator.onLine) syncTimer = setTimeout(() => syncNow().catch(reportError), 15000);
  }

  function setSuspended(value) { suspended = Boolean(value); }

  function shouldUploadDocuments() {
    return localStorage.getItem(KEY_UPLOAD_DOCS) === '1';
  }

  function escapeQueryValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  async function driveFetch(url, options) {
    if (!hasValidToken()) {
      clearSessionToken();
      updateAccountUi();
      setStatus('pending', 'Acceso a Drive requerido', 'Tu sesión de Drive venció. Pulsa “Reanudar Drive” para continuar.');
      throw new Error('AUTH_REQUIRED');
    }
    if (!navigator.onLine) {
      setStatus('pending', 'Sin conexión', 'No hay conexión a Internet. Los cambios siguen seguros en esta computadora.');
      throw new Error('OFFLINE');
    }
    const opts = Object.assign({}, options || {});
    opts.headers = Object.assign({}, opts.headers || {}, { Authorization: `Bearer ${accessToken}` });
    const response = await fetch(url, opts);
    if (response.status === 401) {
      clearSessionToken();
      updateAccountUi();
      setStatus('pending', 'Acceso a Drive requerido', 'Pulsa “Reanudar Drive” para continuar la sincronización.');
      throw new Error('AUTH_REQUIRED');
    }
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).error.message || ''; } catch (e) {}
      throw new Error(detail || `Google Drive respondió con el código ${response.status}.`);
    }
    return response;
  }

  async function listFiles(query, orderBy) {
    const fields = 'files(id,name,mimeType,modifiedTime,version,appProperties,parents,size)';
    const params = new URLSearchParams({ q: query, spaces: 'drive', fields, pageSize: '100' });
    if (orderBy) params.set('orderBy', orderBy);
    const response = await driveFetch(`${DRIVE_API}/files?${params}`);
    return (await response.json()).files || [];
  }

  async function createFolder(name, parentId, kind) {
    const metadata = {
      name,
      mimeType: FOLDER_MIME,
      appProperties: { coeduca_type: kind },
    };
    if (parentId) metadata.parents = [parentId];
    const response = await driveFetch(`${DRIVE_API}/files?fields=id,name,mimeType,appProperties`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    });
    return response.json();
  }

  async function ensureFolder(name, parentId, kind) {
    const parts = [
      'trashed = false',
      `mimeType = '${FOLDER_MIME}'`,
      `appProperties has { key='coeduca_type' and value='${escapeQueryValue(kind)}' }`,
    ];
    if (parentId) parts.push(`'${escapeQueryValue(parentId)}' in parents`);
    const found = await listFiles(parts.join(' and '));
    return found[0] || createFolder(name, parentId, kind);
  }

  async function ensureStructure() {
    if (rootFolderId && backupFolderId) return;
    const root = await ensureFolder('COEDUCA', '', 'root');
    rootFolderId = root.id;
    const backup = await ensureFolder('Respaldo', root.id, 'backup_folder');
    backupFolderId = backup.id;
  }

  async function getBackupFile() {
    await ensureStructure();
    const query = [
      'trashed = false',
      `'${escapeQueryValue(backupFolderId)}' in parents`,
      "appProperties has { key='coeduca_type' and value='backup' }",
    ].join(' and ');
    const files = await listFiles(query, 'modifiedTime desc');
    return files[0] || null;
  }

  function multipartBody(metadata, blob) {
    const boundary = `coeduca_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const before = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`;
    const after = `\r\n--${boundary}--`;
    return { boundary, body: new Blob([before, blob, after], { type: `multipart/related; boundary=${boundary}` }) };
  }

  async function uploadBlob(blob, metadata, existingId) {
    const multipart = multipartBody(metadata, blob);
    const url = existingId
      ? `${DRIVE_UPLOAD_API}/${encodeURIComponent(existingId)}?uploadType=multipart&fields=id,name,modifiedTime,version,parents,appProperties`
      : `${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,name,modifiedTime,version,parents,appProperties`;
    const response = await driveFetch(url, {
      method: existingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${multipart.boundary}` },
      body: multipart.body,
    });
    return response.json();
  }

  async function uploadBackup(existingFile) {
    await ensureStructure();
    if (!window.COEducaBackup) throw new Error('El sistema de respaldo todavía no está listo.');
    const packageInfo = await window.COEducaBackup.createBlob();
    const metadata = {
      name: BACKUP_NAME,
      mimeType: packageInfo.blob.type || 'application/gzip',
      appProperties: { coeduca_type: 'backup', coeduca_format: 'v3' },
    };
    if (!existingFile) metadata.parents = [backupFolderId];
    return uploadBlob(packageInfo.blob, metadata, existingFile && existingFile.id);
  }

  function sameVersion(remote, localMeta) {
    return Boolean(remote && localMeta && remote.id === localMeta.id && String(remote.version || '') === String(localMeta.version || ''));
  }

  function saveSyncedMeta(file) {
    const meta = { id: file.id, version: String(file.version || ''), modifiedTime: file.modifiedTime || '', syncedAt: new Date().toISOString() };
    writeJson(KEY_META, meta);
    localStorage.setItem(KEY_DIRTY, '0');
    return meta;
  }

  async function localHasData() {
    if (!window.COEducaBackup) return false;
    const data = await window.COEducaBackup.collect();
    if ((data.expediente || []).length || (data.procesos || []).length) return true;
    return Object.keys(data.localStorage || {}).some((key) => {
      if (key.endsWith(':fase') || key.includes('proceso-activo')) return false;
      const value = data.localStorage[key];
      return value != null && value !== '' && value !== '{}' && value !== '[]';
    });
  }

  async function downloadBackup(remote) {
    setStatus('syncing', 'Restaurando desde Drive…', 'Descargando el respaldo de Google Drive.');
    const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(remote.id)}?alt=media`);
    const blob = await response.blob();
    const data = await window.COEducaBackup.parseFile(blob);
    suspended = true;
    saveSyncedMeta(remote);
    await window.COEducaBackup.apply(data, 'reemplazar', { silent: true, reload: false });
    setStatus('synced', 'Guardado en Drive', 'Respaldo restaurado. Recargando la página…');
    location.reload();
  }

  function openConflict(remote) {
    setStatus('conflict', 'Revisar conflicto', 'Drive y esta computadora tienen cambios diferentes. Elige cuál conservar.');
    if (ui.conflictModal) ui.conflictModal.classList.remove('hidden');
    return new Promise((resolve) => { conflictResolver = { resolve, remote }; });
  }

  function closeConflict(choice) {
    if (ui.conflictModal) ui.conflictModal.classList.add('hidden');
    if (conflictResolver) {
      const resolver = conflictResolver;
      conflictResolver = null;
      resolver.resolve(choice || 'cancel');
    }
  }

  async function syncNow(options) {
    const opts = options || {};
    if (syncing) return;
    if (!hasValidToken()) {
      setStatus('pending', 'Acceso a Drive requerido', 'Pulsa “Reanudar Drive” para guardar los cambios pendientes.');
      updateAccountUi();
      return;
    }
    syncing = true;
    clearTimeout(syncTimer);
    setStatus('syncing', 'Sincronizando…', 'Comprobando el respaldo de Google Drive.');
    try {
      const remote = await getBackupFile();
      const localMeta = readJson(KEY_META, null);
      const dirty = isDirty();

      if (!remote) {
        const uploaded = await uploadBackup(null);
        saveSyncedMeta(uploaded);
      } else if (opts.forceLocal) {
        const uploaded = await uploadBackup(remote);
        saveSyncedMeta(uploaded);
      } else if (!localMeta) {
        if (dirty || await localHasData()) {
          const choice = await openConflict(remote);
          if (choice === 'cloud') return downloadBackup(remote);
          if (choice === 'local') {
            const uploaded = await uploadBackup(remote);
            saveSyncedMeta(uploaded);
          } else return;
        } else return downloadBackup(remote);
      } else if (!sameVersion(remote, localMeta)) {
        if (dirty) {
          const choice = await openConflict(remote);
          if (choice === 'cloud') return downloadBackup(remote);
          if (choice === 'local') {
            const uploaded = await uploadBackup(remote);
            saveSyncedMeta(uploaded);
          } else return;
        } else return downloadBackup(remote);
      } else if (dirty) {
        const uploaded = await uploadBackup(remote);
        saveSyncedMeta(uploaded);
      }

      setStatus('synced', 'Guardado en Drive', `Última sincronización: ${new Date().toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}.`);
    } catch (error) {
      reportError(error);
      throw error;
    } finally {
      syncing = false;
      updateAccountUi();
    }
  }

  function reportError(error) {
    if (!error || error.message === 'AUTH_REQUIRED' || error.message === 'OFFLINE') return;
    console.error('Error de Google Drive:', error);
    setStatus('error', 'Error al sincronizar', `No se pudo sincronizar: ${error.message || 'error desconocido'}`);
  }

  function waitForGoogleIdentity() {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const check = () => {
        if (window.google && google.accounts && google.accounts.oauth2) return resolve();
        if (++attempts > 80) return reject(new Error('No se pudo cargar el acceso de Google. Revisa tu conexión.'));
        setTimeout(check, 100);
      };
      check();
    });
  }

  async function connect() {
    try {
      await waitForGoogleIdentity();
      if (!tokenClient) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPE,
          callback: async (response) => {
            if (response.error) return reportError(new Error(response.error_description || response.error));
            rememberSessionToken(response.access_token, response.expires_in);
            rootFolderId = '';
            backupFolderId = '';
            try {
              const aboutResponse = await driveFetch(`${DRIVE_API}/about?fields=user(displayName,emailAddress,photoLink)`);
              currentAccount = (await aboutResponse.json()).user || currentAccount;
              writeJson(KEY_ACCOUNT, currentAccount);
              updateAccountUi();
              await syncNow();
            } catch (error) { reportError(error); }
          },
          error_callback: (error) => reportError(new Error(error.message || error.type || 'No se pudo abrir el acceso de Google.')),
        });
      }
      tokenClient.requestAccessToken({ prompt: currentAccount ? '' : 'consent' });
    } catch (error) { reportError(error); }
  }

  function sanitizeFolderPart(value, fallback) {
    const clean = String(value || '').replace(/[\\/\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
    return clean || fallback;
  }

  function numberedPeriod(value) {
    const period = sanitizeFolderPart(value, 'Sin periodo');
    if (/^\d+\.\s/.test(period) || period === 'Sin periodo') return period;
    const normalized = period.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const numbers = {
      'primer trimestre': 1, 'segundo trimestre': 2, 'tercer trimestre': 3,
      'primer periodo': 1, 'segundo periodo': 2, 'tercer periodo': 3, 'cuarto periodo': 4,
    };
    return numbers[normalized] ? `${numbers[normalized]}. ${period}` : period;
  }

  function currentWorkspaceContext() {
    try {
      const state = JSON.parse(localStorage.getItem('actas-recuperacion:v1') || '{}');
      return state.configuracion || {};
    } catch (e) { return {}; }
  }

  function contextFromButton(button) {
    const workspace = currentWorkspaceContext();
    const data = button && button.dataset ? button.dataset : {};
    return {
      anio: data.driveAnio || workspace.anio || new Date().getFullYear(),
      grado: data.driveGrado || workspace.grado || '',
      trimestre: data.driveTrimestre || workspace.trimestre || '',
      materia: data.driveMateria || workspace.materia || '',
    };
  }

  function normalizeFolderContext(context) {
    const source = context || {};
    return {
      anio: sanitizeFolderPart(source.anio, String(new Date().getFullYear())),
      grado: sanitizeFolderPart(source.grado, 'Sin grado'),
      trimestre: numberedPeriod(source.trimestre),
      materia: sanitizeFolderPart(source.materia, 'Sin materia'),
    };
  }

  function folderParts(context) {
    const clean = normalizeFolderContext(context);
    return [clean.anio, 'Evaluaciones', clean.grado, `${clean.trimestre} - ${clean.materia}`];
  }

  function folderPathLabel(context) {
    return ['COEDUCA', ...folderParts(context)].join('/');
  }

  async function ensureNamedFolder(name, parentId, kind) {
    const query = [
      'trashed = false',
      `mimeType = '${FOLDER_MIME}'`,
      `name = '${escapeQueryValue(name)}'`,
      `'${escapeQueryValue(parentId)}' in parents`,
    ].join(' and ');
    const found = await listFiles(query);
    return found[0] || createFolder(name, parentId, kind);
  }

  async function ensureDocumentsFolder(context) {
    await ensureStructure();
    let parentId = rootFolderId;
    for (const [index, name] of folderParts(context).entries()) {
      const folder = await ensureNamedFolder(name, parentId, `documents_level_${index + 1}`);
      parentId = folder.id;
    }
    return parentId;
  }

  async function uploadGeneratedDocument(blob, filename, mimeType, context) {
    if (!shouldUploadDocuments()) return;
    const mode = pendingUploadMode;
    pendingUploadMode = '';
    if (mode === 'local') { pendingFolderOverride = null; return; }
    if (!hasValidToken()) {
      pendingFolderOverride = null;
      setStatus('pending', 'Documento no subido', 'El documento se descargó, pero debes reanudar Drive para subirlo a la nube.');
      return;
    }
    try {
      const targetContext = pendingFolderOverride || context || currentWorkspaceContext();
      pendingFolderOverride = null;
      const parentId = await ensureDocumentsFolder(targetContext);
      const safeName = filename || `Documento_${Date.now()}`;
      const query = `trashed = false and '${escapeQueryValue(parentId)}' in parents and name = '${escapeQueryValue(safeName)}'`;
      const existing = (await listFiles(query, 'modifiedTime desc'))[0] || null;
      const metadata = {
        name: safeName,
        mimeType: mimeType || blob.type || 'application/octet-stream',
        appProperties: { coeduca_type: 'generated_document' },
      };
      if (!existing) metadata.parents = [parentId];
      await uploadBlob(blob, metadata, existing && existing.id);
      setMessage(`Documento “${safeName}” guardado en ${folderPathLabel(targetContext)}.`);
    } catch (error) { reportError(error); }
  }

  function isGeneratedDocumentButton(button) {
    if (!button || button.disabled) return false;
    const action = (button.dataset && button.dataset.expAction) || '';
    const idAndText = `${button.id || ''} ${button.textContent || ''}`.toLowerCase();
    return action === 'pdf' || action === 'word' || (/\b(pdf|word)\b/.test(idAndText) && !idAndText.includes('preview'));
  }

  function setPeriodField(value) {
    const select = ui.folderPeriod;
    const target = value || '';
    if (target && !Array.from(select.options).some((option) => option.value === target)) {
      const option = document.createElement('option'); option.value = target; option.textContent = target; select.appendChild(option);
    }
    select.value = target;
  }

  function modalContext() {
    return {
      anio: ui.folderYear.value,
      grado: ui.folderGrade.value,
      trimestre: ui.folderPeriod.value,
      materia: ui.folderSubject.value,
    };
  }

  function updateFolderPreview() {
    ui.folderPreview.textContent = folderPathLabel(modalContext());
  }

  function openSaveModal(button) {
    if (!isGeneratedDocumentButton(button)) return;
    pendingSaveButton = button;
    const context = normalizeFolderContext(contextFromButton(button));
    ui.folderYear.value = context.anio;
    ui.folderGrade.value = context.grado === 'Sin grado' ? '' : context.grado;
    setPeriodField(context.trimestre === 'Sin periodo' ? '' : context.trimestre.replace(/^\d+\.\s*/, ''));
    ui.folderSubject.value = context.materia === 'Sin materia' ? '' : context.materia;
    ui.saveConfirm.disabled = !hasValidToken();
    ui.saveIntro.textContent = hasValidToken()
      ? 'El documento se descargará normalmente y también se guardará en esta ubicación de tu Drive.'
      : 'Drive necesita conectarse nuevamente. Puedes descargar el documento ahora o cerrar esta ventana y reanudar Drive desde el menú.';
    updateFolderPreview();
    ui.saveModal.classList.remove('hidden');
    requestAnimationFrame(() => ui.folderYear.focus());
  }

  function closeSaveModal(clearPending) {
    ui.saveModal.classList.add('hidden');
    if (clearPending !== false) pendingSaveButton = null;
  }

  function continueDocumentClick(mode) {
    const button = pendingSaveButton;
    if (!button) return;
    pendingFolderOverride = mode === 'drive' ? modalContext() : null;
    pendingUploadMode = mode;
    if (mode === 'drive') {
      localStorage.setItem(KEY_UPLOAD_DOCS, '1');
      if (ui.uploadDocs) ui.uploadDocs.checked = true;
    }
    bypassClickButton = button;
    closeSaveModal(false);
    pendingSaveButton = null;
    button.click();
  }

  function clearPendingDocumentUpload() {
    pendingFolderOverride = null;
    pendingUploadMode = '';
  }

  function bindDocumentDestinationPicker() {
    document.addEventListener('click', (event) => {
      const button = event.target.closest && event.target.closest('button');
      if (!isGeneratedDocumentButton(button)) return;
      if (suppressClickButton === button) {
        suppressClickButton = null;
        event.preventDefault(); event.stopImmediatePropagation(); return;
      }
      if (bypassClickButton === button) { bypassClickButton = null; return; }
      if (!shouldUploadDocuments()) return;
      event.preventDefault(); event.stopImmediatePropagation();
      openSaveModal(button);
    }, true);

    document.addEventListener('contextmenu', (event) => {
      const button = event.target.closest && event.target.closest('button');
      if (!isGeneratedDocumentButton(button)) return;
      event.preventDefault();
      openSaveModal(button);
    });

    document.addEventListener('pointerdown', (event) => {
      const button = event.target.closest && event.target.closest('button');
      if (!isGeneratedDocumentButton(button) || event.pointerType === 'mouse') return;
      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => {
        suppressClickButton = button;
        openSaveModal(button);
      }, 550);
    }, true);
    ['pointerup', 'pointercancel', 'pointermove'].forEach((name) => document.addEventListener(name, () => clearTimeout(longPressTimer), true));
  }

  function cacheUi() {
    ui.indicator = document.getElementById('drive-sync-indicator');
    ui.indicatorText = document.getElementById('drive-sync-indicator-text');
    ui.account = document.getElementById('drive-account-label');
    ui.message = document.getElementById('drive-panel-message');
    ui.connect = document.getElementById('btn-drive-connect');
    ui.syncNow = document.getElementById('btn-drive-sync-now');
    ui.uploadDocs = document.getElementById('drive-upload-documents');
    ui.conflictModal = document.getElementById('drive-conflict-modal');
    ui.saveModal = document.getElementById('drive-save-modal');
    ui.saveIntro = ui.saveModal.querySelector('.drive-save-intro');
    ui.saveClose = document.getElementById('drive-save-close');
    ui.saveLocalOnly = document.getElementById('drive-save-local-only');
    ui.saveConfirm = document.getElementById('drive-save-confirm');
    ui.folderYear = document.getElementById('drive-folder-year');
    ui.folderGrade = document.getElementById('drive-folder-grade');
    ui.folderPeriod = document.getElementById('drive-folder-period');
    ui.folderSubject = document.getElementById('drive-folder-subject');
    ui.folderPreview = document.getElementById('drive-folder-preview');
  }

  async function init() {
    cacheUi();
    if (!ui.indicator) return;
    ui.uploadDocs.checked = shouldUploadDocuments();
    ui.connect.addEventListener('click', connect);
    ui.syncNow.addEventListener('click', () => syncNow().catch(reportError));
    ui.uploadDocs.addEventListener('change', () => localStorage.setItem(KEY_UPLOAD_DOCS, ui.uploadDocs.checked ? '1' : '0'));
    ui.indicator.addEventListener('click', () => document.getElementById('btn-drawer').click());
    document.getElementById('drive-conflict-close').addEventListener('click', () => closeConflict('cancel'));
    document.getElementById('drive-conflict-use-cloud').addEventListener('click', () => closeConflict('cloud'));
    document.getElementById('drive-conflict-use-local').addEventListener('click', () => closeConflict('local'));
    ui.conflictModal.addEventListener('click', (event) => { if (event.target === ui.conflictModal) closeConflict('cancel'); });
    ui.saveClose.addEventListener('click', () => closeSaveModal(true));
    ui.saveLocalOnly.addEventListener('click', () => continueDocumentClick('local'));
    ui.saveConfirm.addEventListener('click', () => continueDocumentClick('drive'));
    ui.saveModal.addEventListener('click', (event) => { if (event.target === ui.saveModal) closeSaveModal(true); });
    [ui.folderYear, ui.folderGrade, ui.folderPeriod, ui.folderSubject].forEach((field) => {
      field.addEventListener('input', updateFolderPreview);
      field.addEventListener('change', updateFolderPreview);
    });
    bindDocumentDestinationPicker();
    ['missing-data-cancel', 'missing-data-close'].forEach((id) => {
      const button = document.getElementById(id); if (button) button.addEventListener('click', clearPendingDocumentUpload);
    });
    const missingModal = document.getElementById('missing-data-modal');
    if (missingModal) missingModal.addEventListener('click', (event) => { if (event.target === missingModal) clearPendingDocumentUpload(); });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!ui.saveModal.classList.contains('hidden')) closeSaveModal(true);
      if (missingModal && !missingModal.classList.contains('hidden')) clearPendingDocumentUpload();
    });
    window.addEventListener('online', () => { if (isDirty() && hasValidToken()) syncNow().catch(reportError); });
    window.addEventListener('offline', () => setStatus('pending', 'Sin conexión', 'Los cambios siguen seguros en esta computadora y se guardarán al volver Internet.'));

    if (localStorage.getItem(KEY_DIRTY) == null) localStorage.setItem(KEY_DIRTY, (await localHasData()) ? '1' : '0');
    updateAccountUi();
    if (hasValidToken()) {
      scheduleTokenExpirationNotice();
      setStatus(isDirty() ? 'pending' : 'synced', isDirty() ? 'Cambios sin guardar' : 'Drive conectado', isDirty() ? 'La sesión de Drive se restauró. Sincronizando cambios pendientes…' : 'La sesión de Drive se restauró automáticamente.');
      setTimeout(() => syncNow().catch(reportError), 0);
    } else if (currentAccount) {
      setStatus(isDirty() ? 'pending' : 'disconnected', isDirty() ? 'Cambios sin guardar' : 'Drive en pausa', 'Pulsa “Reanudar Drive” para comprobar y sincronizar este equipo.');
    } else {
      setStatus(isDirty() ? 'pending' : 'disconnected', isDirty() ? 'Cambios sin guardar' : 'Drive desconectado', 'Conecta tu cuenta para mantener un único respaldo actualizado en la nube.');
    }
  }

  window.COEducaDrive = {
    markDirty,
    setSuspended,
    syncNow,
    shouldUploadDocuments,
    uploadGeneratedDocument,
    folderPathLabel,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
