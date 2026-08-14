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
  const KEY_DEVICE_ID = 'coeduca-drive:device-id';
  const KEY_TOMBSTONES = 'actas-recuperacion:sync-tombstones:v1';
  const KEY_CHECKPOINT = 'coeduca-drive:last-checkpoint';
  const SYNC_DB_NAME = 'coeduca-sync';
  const SYNC_DB_VERSION = 1;
  const SNAPSHOT_LIMIT = 10;

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
  let retryAttempt = 0;
  let retryTimer = null;

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

  function cloneJson(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

  function accountIdentity() {
    const raw = currentAccount && (currentAccount.emailAddress || currentAccount.permissionId || currentAccount.displayName);
    return String(raw || 'sin-cuenta').trim().toLowerCase();
  }

  function accountStorageKey(base) { return `${base}:${encodeURIComponent(accountIdentity())}`; }

  function readSyncedMeta() {
    return readJson(accountStorageKey(KEY_META), null);
  }

  function writeSyncedMeta(meta) { writeJson(accountStorageKey(KEY_META), meta); }

  function getDeviceId() {
    let id = localStorage.getItem(KEY_DEVICE_ID);
    if (!id) {
      id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(KEY_DEVICE_ID, id);
    }
    return id;
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((out, key) => { out[key] = stableValue(value[key]); return out; }, {});
    }
    return value;
  }

  function stableStringify(value) { return JSON.stringify(stableValue(value)); }
  function valuesEqual(a, b) { return stableStringify(a) === stableStringify(b); }

  function canonicalBackup(data) {
    const clean = cloneJson(data || {});
    delete clean.fecha;
    delete clean._metadata;
    if (Array.isArray(clean.procesos)) clean.procesos.sort((a, b) => String((a || {}).id || '').localeCompare(String((b || {}).id || '')));
    if (Array.isArray(clean.expediente)) clean.expediente.sort((a, b) => String((a || {}).key || '').localeCompare(String((b || {}).key || '')));
    return clean;
  }

  async function hashBackup(data) {
    const text = stableStringify(canonicalBackup(data));
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    }
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return `fnv-${(hash >>> 0).toString(16)}`;
  }

  function openSyncDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(SYNC_DB_NAME, SYNC_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('state')) db.createObjectStore('state', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function syncDbGet(storeName, id) {
    const db = await openSyncDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName).objectStore(storeName).get(id);
      request.onsuccess = () => { db.close(); resolve(request.result || null); };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  }

  async function syncDbPut(storeName, value) {
    const db = await openSyncDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => { db.close(); resolve(value); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    });
  }

  async function getBaseState() { return syncDbGet('state', accountIdentity()); }

  async function saveBaseState(file, data, hash) {
    return syncDbPut('state', {
      id: accountIdentity(), fileId: file.id, version: String(file.version || ''),
      modifiedTime: file.modifiedTime || '', hash, data: cloneJson(data), savedAt: new Date().toISOString(),
    });
  }

  async function listSnapshots() {
    const db = await openSyncDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction('snapshots').objectStore('snapshots').getAll();
      request.onsuccess = () => {
        db.close();
        resolve((request.result || []).filter((item) => item.account === accountIdentity()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  }

  async function pruneSnapshots(limit) {
    const snapshots = await listSnapshots();
    const excess = snapshots.slice(limit == null ? SNAPSHOT_LIMIT : limit);
    if (!excess.length) return;
    const db = await openSyncDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite');
      excess.forEach((item) => tx.objectStore('snapshots').delete(item.id));
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function createLocalSnapshot(data, reason) {
    if (!data) return null;
    await pruneSnapshots(SNAPSHOT_LIMIT - 1);
    const createdAt = new Date().toISOString();
    const snapshot = {
      id: `${accountIdentity()}|${createdAt}|${Math.random().toString(36).slice(2)}`,
      account: accountIdentity(), createdAt, reason: reason || 'Copia de seguridad automática',
      hash: await hashBackup(data), data: cloneJson(data),
    };
    await syncDbPut('snapshots', snapshot);
    await pruneSnapshots(SNAPSHOT_LIMIT);
    return snapshot;
  }

  function readTombstones() {
    const value = readJson(KEY_TOMBSTONES, { procesos: {}, expediente: {} });
    value.procesos = value.procesos || {};
    value.expediente = value.expediente || {};
    return value;
  }

  function recordDeletion(kind, id) {
    if (!id || !['procesos', 'expediente'].includes(kind)) return;
    const tombstones = readTombstones();
    tombstones[kind][id] = new Date().toISOString();
    writeJson(KEY_TOMBSTONES, tombstones);
    markDirty('elementos eliminados');
  }

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
    setStatus('pending', 'Guardado en este dispositivo', `${label} Tus datos ya están seguros en este navegador. ${nextStep}`);
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
    const method = String(opts.method || 'GET').toUpperCase();
    const retryable = method === 'GET' || method === 'PUT';
    let attempt = 0;
    while (true) {
      let response;
      try { response = await fetch(url, opts); }
      catch (error) {
        if (retryable && attempt < 3 && navigator.onLine) {
          await new Promise((resolve) => setTimeout(resolve, (2 ** attempt) * 700 + Math.random() * 300));
          attempt++;
          continue;
        }
        throw error;
      }
      if (response.status === 401) {
        clearSessionToken();
        updateAccountUi();
        setStatus('pending', 'Acceso a Drive requerido', 'Pulsa “Reanudar Drive” para continuar la sincronización.');
        throw new Error('AUTH_REQUIRED');
      }
      if (response.ok) return response;
      if (retryable && attempt < 3 && (response.status === 429 || response.status >= 500)) {
        await new Promise((resolve) => setTimeout(resolve, (2 ** attempt) * 700 + Math.random() * 300));
        attempt++;
        continue;
      }
      let detail = '';
      try { detail = (await response.json()).error.message || ''; } catch (e) {}
      throw new Error(detail || `Google Drive respondió con el código ${response.status}.`);
    }
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

  function checkpointDue() {
    const last = Number(localStorage.getItem(accountStorageKey(KEY_CHECKPOINT)) || 0);
    return !last || Date.now() - last > 30 * 24 * 60 * 60 * 1000;
  }

  async function uploadResumable(blob, metadata, existingId, keepRevision) {
    const params = new URLSearchParams({ uploadType: 'resumable', fields: 'id,name,modifiedTime,version,parents,appProperties' });
    if (keepRevision && existingId) params.set('keepRevisionForever', 'true');
    const url = existingId
      ? `${DRIVE_UPLOAD_API}/${encodeURIComponent(existingId)}?${params}`
      : `${DRIVE_UPLOAD_API}?${params}`;
    const start = await driveFetch(url, {
      method: existingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': blob.type || 'application/octet-stream' },
      body: JSON.stringify(metadata),
    });
    const sessionUrl = start.headers.get('Location');
    if (!sessionUrl) throw new Error('Drive no devolvió una sesión reanudable para el respaldo.');
    const response = await driveFetch(sessionUrl, {
      method: 'PUT', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob,
    });
    return response.json();
  }

  async function uploadBlob(blob, metadata, existingId, options) {
    const opts = options || {};
    const keepRevision = Boolean(opts.checkpoint && existingId && checkpointDue());
    if (blob.size > 5 * 1024 * 1024) {
      const result = await uploadResumable(blob, metadata, existingId, keepRevision);
      if (keepRevision) localStorage.setItem(accountStorageKey(KEY_CHECKPOINT), String(Date.now()));
      return result;
    }
    const multipart = multipartBody(metadata, blob);
    const params = new URLSearchParams({ uploadType: 'multipart', fields: 'id,name,modifiedTime,version,parents,appProperties' });
    if (keepRevision) params.set('keepRevisionForever', 'true');
    const url = existingId ? `${DRIVE_UPLOAD_API}/${encodeURIComponent(existingId)}?${params}` : `${DRIVE_UPLOAD_API}?${params}`;
    const response = await driveFetch(url, {
      method: existingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${multipart.boundary}` },
      body: multipart.body,
    });
    const result = await response.json();
    if (keepRevision) localStorage.setItem(accountStorageKey(KEY_CHECKPOINT), String(Date.now()));
    return result;
  }

  async function uploadBackup(existingFile, data) {
    await ensureStructure();
    if (!window.COEducaBackup) throw new Error('El sistema de respaldo todavía no está listo.');
    const packageInfo = await window.COEducaBackup.createBlob(data);
    const syncMeta = packageInfo.data && packageInfo.data._metadata;
    const metadata = {
      name: BACKUP_NAME,
      mimeType: packageInfo.blob.type || 'application/gzip',
      appProperties: {
        coeduca_type: 'backup', coeduca_format: 'v3',
        coeduca_snapshot: syncMeta && syncMeta.snapshotId ? String(syncMeta.snapshotId).slice(0, 124) : '',
        coeduca_hash: syncMeta && syncMeta.contentHash ? String(syncMeta.contentHash).slice(0, 124) : '',
      },
    };
    if (!existingFile) metadata.parents = [backupFolderId];
    return uploadBlob(packageInfo.blob, metadata, existingFile && existingFile.id, { checkpoint: true });
  }

  function sameVersion(remote, localMeta) {
    return Boolean(remote && localMeta && remote.id === localMeta.id && String(remote.version || '') === String(localMeta.version || ''));
  }

  function saveSyncedMeta(file) {
    const meta = { id: file.id, version: String(file.version || ''), modifiedTime: file.modifiedTime || '', syncedAt: new Date().toISOString() };
    writeSyncedMeta(meta);
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

  async function fetchRemoteData(remote) {
    const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(remote.id)}?alt=media`);
    const blob = await response.blob();
    const data = await window.COEducaBackup.parseFile(blob);
    if (window.COEducaBackup.validate) window.COEducaBackup.validate(data);
    const hash = await hashBackup(data);
    if (data._metadata && data._metadata.contentHash && data._metadata.contentHash !== hash) {
      throw new Error('El respaldo de Drive no superó la verificación de integridad. No se aplicó ningún cambio.');
    }
    return { data, hash };
  }

  function simpleHash(value) {
    const text = stableStringify(value); let hash = 2166136261;
    for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(36);
  }

  function recordIdentity(record) {
    if (!record || typeof record !== 'object') return '';
    return String(record.id || record.key || record.nie || '');
  }

  function mergeArray(base, local, remote, path, conflicts) {
    const allObjects = [...(base || []), ...(local || []), ...(remote || [])].every((item) => item && typeof item === 'object' && recordIdentity(item));
    if (!allObjects) { conflicts.push(path); return cloneJson(local); }
    const maps = [base || [], local || [], remote || []].map((items) => new Map(items.map((item) => [recordIdentity(item), item])));
    const keys = new Set([...maps[0].keys(), ...maps[1].keys(), ...maps[2].keys()]);
    const merged = [];
    keys.forEach((key) => {
      const value = mergeValue(maps[0].get(key), maps[1].get(key), maps[2].get(key), `${path}[${key}]`, conflicts);
      if (value !== undefined) merged.push(value);
    });
    return merged;
  }

  function mergeValue(base, local, remote, path, conflicts) {
    if (valuesEqual(local, remote)) return cloneJson(local);
    if (valuesEqual(local, base)) return cloneJson(remote);
    if (valuesEqual(remote, base)) return cloneJson(local);
    if (local === undefined && remote !== undefined) { conflicts.push(path); return cloneJson(remote); }
    if (remote === undefined && local !== undefined) { conflicts.push(path); return cloneJson(local); }
    if (Array.isArray(local) && Array.isArray(remote) && (base === undefined || Array.isArray(base))) {
      return mergeArray(base || [], local, remote, path, conflicts);
    }
    const localObject = local && typeof local === 'object' && !Array.isArray(local);
    const remoteObject = remote && typeof remote === 'object' && !Array.isArray(remote);
    const baseObject = base === undefined || (base && typeof base === 'object' && !Array.isArray(base));
    if (localObject && remoteObject && baseObject) {
      const result = {}; const keys = new Set([...Object.keys(base || {}), ...Object.keys(local), ...Object.keys(remote)]);
      keys.forEach((key) => {
        const value = mergeValue((base || {})[key], local[key], remote[key], `${path}.${key}`, conflicts);
        if (value !== undefined) result[key] = value;
      });
      return result;
    }
    conflicts.push(path);
    return cloneJson(local);
  }

  function parseStoredJson(value) { try { return JSON.parse(value); } catch (e) { return null; } }

  function mergeTombstoneValues(localValue, remoteValue) {
    const local = parseStoredJson(localValue) || { procesos: {}, expediente: {} };
    const remote = parseStoredJson(remoteValue) || { procesos: {}, expediente: {} };
    const result = { procesos: {}, expediente: {} };
    ['procesos', 'expediente'].forEach((kind) => {
      const keys = new Set([...Object.keys(local[kind] || {}), ...Object.keys(remote[kind] || {})]);
      keys.forEach((key) => { result[kind][key] = [local[kind] && local[kind][key], remote[kind] && remote[kind][key]].filter(Boolean).sort().pop(); });
    });
    return JSON.stringify(result);
  }

  function mergeLocalStorage(base, local, remote, conflicts) {
    const result = {}; const keys = new Set([...Object.keys(base || {}), ...Object.keys(local || {}), ...Object.keys(remote || {})]);
    keys.forEach((key) => {
      const b = (base || {})[key]; const l = (local || {})[key]; const r = (remote || {})[key];
      if (key === KEY_TOMBSTONES) { result[key] = mergeTombstoneValues(l, r); return; }
      if (l === r) { if (l !== undefined) result[key] = l; return; }
      if (l === b) { if (r !== undefined) result[key] = r; return; }
      if (r === b) { if (l !== undefined) result[key] = l; return; }
      const parsedLocal = parseStoredJson(l); const parsedRemote = parseStoredJson(r); const parsedBase = parseStoredJson(b);
      if (parsedLocal !== null && parsedRemote !== null) {
        result[key] = JSON.stringify(mergeValue(parsedBase, parsedLocal, parsedRemote, `localStorage.${key}`, conflicts));
      } else {
        conflicts.push(`localStorage.${key}`);
        if (l !== undefined) result[key] = l; else if (r !== undefined) result[key] = r;
      }
    });
    return result;
  }

  function recordTime(record, kind) {
    if (!record) return '';
    return String(record.actualizado || (kind === 'expediente' ? record.fecha : record.creado) || '');
  }

  function conflictCopy(record, kind, key) {
    const copy = cloneJson(record);
    const suffix = `conflict-${simpleHash(record)}`;
    if (kind === 'procesos') {
      copy.id = `${key}-${suffix}`;
      copy.nombre = `${copy.nombre || 'Proceso'} — copia recuperada de otro dispositivo`;
    } else {
      copy.key = `${key}|${suffix}`;
    }
    return copy;
  }

  function mergeRecordCollection(baseItems, localItems, remoteItems, kind, conflicts) {
    const field = kind === 'procesos' ? 'id' : 'key';
    const maps = [baseItems || [], localItems || [], remoteItems || []].map((items) => new Map(items.filter(Boolean).map((item) => [String(item[field] || ''), item])));
    const keys = new Set([...maps[0].keys(), ...maps[1].keys(), ...maps[2].keys()]);
    const result = new Map();
    keys.forEach((key) => {
      const b = maps[0].get(key); const l = maps[1].get(key); const r = maps[2].get(key);
      if (valuesEqual(l, r)) { if (l) result.set(key, cloneJson(l)); return; }
      if (valuesEqual(l, b)) { if (r) result.set(key, cloneJson(r)); return; }
      if (valuesEqual(r, b)) { if (l) result.set(key, cloneJson(l)); return; }
      if (!l && r) { result.set(key, cloneJson(r)); return; }
      if (!r && l) { result.set(key, cloneJson(l)); return; }
      if (l && r) {
        conflicts.push(`${kind}.${key}`);
        const localWins = recordTime(l, kind) >= recordTime(r, kind);
        const winner = localWins ? l : r; const other = localWins ? r : l;
        result.set(key, cloneJson(winner));
        const duplicate = conflictCopy(other, kind, key);
        result.set(String(duplicate[field]), duplicate);
      }
    });
    return Array.from(result.values());
  }

  function applyTombstones(data) {
    const raw = data.localStorage && data.localStorage[KEY_TOMBSTONES];
    const tombstones = parseStoredJson(raw) || { procesos: {}, expediente: {} };
    data.procesos = (data.procesos || []).filter((record) => {
      const deletedAt = (tombstones.procesos || {})[record.id];
      return !deletedAt || recordTime(record, 'procesos') > deletedAt;
    });
    data.expediente = (data.expediente || []).filter((record) => {
      const deletedAt = (tombstones.expediente || {})[record.key];
      return !deletedAt || recordTime(record, 'expediente') > deletedAt;
    });
    return data;
  }

  function addRecoveredWorkspace(data, remoteData, conflicts) {
    if (!conflicts.some((path) => path.startsWith('localStorage.'))) return;
    const workspaceKeys = [
      'actas-recuperacion:v1', 'actas-recuperacion:curriculo:ord:v1', 'actas-recuperacion:curriculo:rec:v1',
      'actas-recuperacion:instrumento:ord:v1', 'actas-recuperacion:instrumento:rec:v1', 'actas-recuperacion:ordinaria:v1', 'actas-recuperacion:fase',
    ];
    const workspace = {}; workspaceKeys.forEach((key) => { if (remoteData.localStorage && remoteData.localStorage[key] != null) workspace[key] = remoteData.localStorage[key]; });
    if (!Object.keys(workspace).length) return;
    const id = `recovered-${simpleHash(workspace)}`;
    if ((data.procesos || []).some((record) => record.id === id)) return;
    const tipo = (remoteData.localStorage && remoteData.localStorage['actas-recuperacion:proceso-activo-tipo']) || (workspace['actas-recuperacion:ordinaria:v1'] ? 'ordinaria' : 'recuperacion');
    data.procesos.push({
      id, tipo, nombre: `Copia recuperada de otro dispositivo · ${new Date(remoteData.fecha || Date.now()).toLocaleString('es-SV')}`,
      creado: remoteData.fecha || new Date().toISOString(), actualizado: remoteData.fecha || new Date().toISOString(), data: workspace, resumen: {},
    });
  }

  function mergeBackups(baseData, localData, remoteData) {
    const base = baseData || { localStorage: {}, procesos: [], expediente: [] }; const conflicts = [];
    const result = {
      formato: localData.formato || remoteData.formato,
      version: Math.max(Number(localData.version || 0), Number(remoteData.version || 0)),
      fecha: new Date().toISOString(),
      localStorage: mergeLocalStorage(base.localStorage, localData.localStorage, remoteData.localStorage, conflicts),
      procesos: mergeRecordCollection(base.procesos, localData.procesos, remoteData.procesos, 'procesos', conflicts),
      expediente: mergeRecordCollection(base.expediente, localData.expediente, remoteData.expediente, 'expediente', conflicts),
    };
    addRecoveredWorkspace(result, remoteData, conflicts);
    applyTombstones(result);
    return { data: result, conflicts };
  }

  async function prepareUploadData(source, baseState) {
    const data = cloneJson(source);
    delete data._metadata;
    data.fecha = new Date().toISOString();
    const hash = await hashBackup(data);
    data._metadata = {
      schemaVersion: 1,
      snapshotId: (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : `snapshot-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      parentSnapshotId: baseState && baseState.data && baseState.data._metadata ? baseState.data._metadata.snapshotId || '' : '',
      createdAt: data.fecha, deviceId: getDeviceId(), contentHash: hash,
    };
    return { data, hash };
  }

  async function acknowledgeSync(file, data, hash) {
    await saveBaseState(file, data, hash);
    saveSyncedMeta(file);
    retryAttempt = 0;
    clearTimeout(retryTimer);
  }

  async function applyRemoteData(remote, remoteData, remoteHash, localData, reason) {
    setStatus('syncing', 'Restaurando desde Drive…', 'Validando y aplicando el respaldo de Google Drive.');
    await createLocalSnapshot(localData, reason || 'Antes de restaurar datos desde Drive');
    suspended = true;
    try {
      await window.COEducaBackup.apply(remoteData, 'reemplazar', { silent: true, reload: false, skipSnapshot: true });
      await acknowledgeSync(remote, remoteData, remoteHash);
    } finally { suspended = false; }
    setStatus('synced', 'Respaldado en Drive', 'Respaldo restaurado y verificado. Recargando la página…');
    location.reload();
  }

  async function downloadBackup(remote) {
    setStatus('syncing', 'Restaurando desde Drive…', 'Descargando el respaldo de Google Drive.');
    const localData = await window.COEducaBackup.collect();
    const downloaded = await fetchRemoteData(remote);
    return applyRemoteData(remote, downloaded.data, downloaded.hash, localData);
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

  async function uploadAndAcknowledge(remote, sourceData, baseState) {
    if (remote) {
      const latestRemote = await getBackupFile();
      if (!latestRemote || latestRemote.id !== remote.id || String(latestRemote.version || '') !== String(remote.version || '')) {
        localStorage.setItem(KEY_DIRTY, '1');
        throw new Error('Drive cambió mientras se preparaba el respaldo. Se volverá a comparar automáticamente antes de subirlo.');
      }
    }
    const prepared = await prepareUploadData(sourceData, baseState);
    const uploaded = await uploadBackup(remote, prepared.data);
    await acknowledgeSync(uploaded, prepared.data, prepared.hash);
    return { file: uploaded, data: prepared.data, hash: prepared.hash };
  }

  async function mergeAndUpload(remote, baseState, localData, remoteData) {
    let merged;
    try { merged = mergeBackups(baseState && baseState.data, localData, remoteData); }
    catch (error) {
      console.error('No se pudo fusionar automáticamente:', error);
      const choice = await openConflict(remote);
      if (choice === 'cloud') return downloadBackup(remote);
      if (choice === 'local') return uploadAndAcknowledge(remote, localData, baseState);
      return null;
    }

    await createLocalSnapshot(localData, 'Antes de combinar cambios de dos dispositivos');
    suspended = true;
    try { await window.COEducaBackup.apply(merged.data, 'reemplazar', { silent: true, reload: false, skipSnapshot: true }); }
    finally { suspended = false; }
    localStorage.setItem(KEY_DIRTY, '1');
    const result = await uploadAndAcknowledge(remote, merged.data, baseState);
    const recovered = merged.conflicts.length;
    setStatus('synced', 'Respaldado en Drive', recovered
      ? `Se combinaron los cambios y se conservaron ${recovered} diferencia(s) sin descartar datos. Recargando…`
      : 'Se combinaron automáticamente los cambios de ambos dispositivos. Recargando…');
    location.reload();
    return result;
  }

  async function syncNowUnlocked(options) {
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
      const localMeta = readSyncedMeta();
      let baseState = await getBaseState();
      if (baseState && remote && baseState.fileId !== remote.id) baseState = null;
      const localData = await window.COEducaBackup.collect();
      const localHash = await hashBackup(localData);
      const dirty = isDirty();
      const localChanged = baseState ? localHash !== baseState.hash : dirty;

      if (!remote) {
        await uploadAndAcknowledge(null, localData, baseState);
      } else if (opts.forceLocal) {
        await createLocalSnapshot(localData, 'Antes de reemplazar el respaldo de Drive');
        await uploadAndAcknowledge(remote, localData, baseState);
      } else if (!localMeta) {
        if (!(dirty || await localHasData())) return downloadBackup(remote);
        const downloaded = await fetchRemoteData(remote);
        if (downloaded.hash === localHash) await acknowledgeSync(remote, downloaded.data, downloaded.hash);
        else return mergeAndUpload(remote, null, localData, downloaded.data);
      } else if (!sameVersion(remote, localMeta)) {
        const downloaded = await fetchRemoteData(remote);
        if (downloaded.hash === localHash) await acknowledgeSync(remote, downloaded.data, downloaded.hash);
        else if (!localChanged && !dirty) return applyRemoteData(remote, downloaded.data, downloaded.hash, localData);
        else return mergeAndUpload(remote, baseState, localData, downloaded.data);
      } else if (localChanged || dirty) {
        await uploadAndAcknowledge(remote, localData, baseState);
      } else if (!baseState) {
        await saveBaseState(remote, localData, localHash);
      }

      retryAttempt = 0;
      setStatus('synced', 'Respaldado en Drive', `Última sincronización: ${new Date().toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}.`);
    } finally {
      syncing = false;
      updateAccountUi();
    }
  }

  async function syncNow(options) {
    if (navigator.locks && typeof navigator.locks.request === 'function') {
      return navigator.locks.request('coeduca-drive-sync', { ifAvailable: true }, (lock) => lock ? syncNowUnlocked(options) : undefined);
    }
    return syncNowUnlocked(options);
  }

  function reportError(error) {
    if (!error || error.message === 'AUTH_REQUIRED' || error.message === 'OFFLINE') return;
    console.error('Error de Google Drive:', error);
    setStatus('error', 'Error al sincronizar', `No se pudo sincronizar: ${error.message || 'error desconocido'}`);
    if (isDirty() && hasValidToken() && navigator.onLine) {
      clearTimeout(retryTimer);
      const delay = Math.min(5 * 60 * 1000, (2 ** Math.min(retryAttempt++, 7)) * 2000 + Math.random() * 1000);
      retryTimer = setTimeout(() => syncNow().catch(reportError), delay);
      setMessage(`No se pudo respaldar todavía. Se intentará de nuevo automáticamente en ${Math.max(2, Math.round(delay / 1000))} segundos.`);
    }
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

  function closeSnapshotsModal() { if (ui.snapshotsModal) ui.snapshotsModal.classList.add('hidden'); }

  async function restoreSnapshot(snapshot) {
    if (!snapshot || !confirm('¿Restaurar esta copia? Antes se guardará una copia del estado actual y después se sincronizará con Drive.')) return;
    const current = await window.COEducaBackup.collect();
    await createLocalSnapshot(current, 'Antes de restaurar una copia de recuperación');
    suspended = true;
    try { await window.COEducaBackup.apply(snapshot.data, 'reemplazar', { silent: true, reload: false, skipSnapshot: true }); }
    finally { suspended = false; }
    localStorage.setItem(KEY_DIRTY, '1');
    closeSnapshotsModal();
    location.reload();
  }

  async function openSnapshotsModal() {
    const snapshots = await listSnapshots();
    ui.snapshotsList.innerHTML = '';
    if (!snapshots.length) {
      ui.snapshotsList.innerHTML = '<p class="text-sm text-slate text-center py-4">Todavía no hay copias automáticas. Se crearán antes de la próxima restauración o fusión.</p>';
    } else {
      snapshots.forEach((snapshot) => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'restore-option snapshot-option';
        const date = new Date(snapshot.createdAt);
        const label = Number.isNaN(date.getTime()) ? snapshot.createdAt : date.toLocaleString('es-SV', { dateStyle: 'medium', timeStyle: 'short' });
        button.innerHTML = `<time datetime="${snapshot.createdAt}">${label}</time><span class="restore-option-desc"></span>`;
        button.querySelector('.restore-option-desc').textContent = snapshot.reason || 'Copia de seguridad automática';
        button.addEventListener('click', () => restoreSnapshot(snapshot).catch(reportError));
        ui.snapshotsList.appendChild(button);
      });
    }
    ui.snapshotsModal.classList.remove('hidden');
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
    ui.snapshotsButton = document.getElementById('btn-drive-snapshots');
    ui.snapshotsModal = document.getElementById('drive-snapshots-modal');
    ui.snapshotsList = document.getElementById('drive-snapshots-list');
  }

  async function init() {
    cacheUi();
    if (!ui.indicator) return;
    ui.uploadDocs.checked = shouldUploadDocuments();
    ui.connect.addEventListener('click', connect);
    ui.syncNow.addEventListener('click', () => syncNow().catch(reportError));
    ui.uploadDocs.addEventListener('change', () => localStorage.setItem(KEY_UPLOAD_DOCS, ui.uploadDocs.checked ? '1' : '0'));
    ui.snapshotsButton.addEventListener('click', () => openSnapshotsModal().catch(reportError));
    document.getElementById('drive-snapshots-close').addEventListener('click', closeSnapshotsModal);
    ui.snapshotsModal.addEventListener('click', (event) => { if (event.target === ui.snapshotsModal) closeSnapshotsModal(); });
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
      if (!ui.snapshotsModal.classList.contains('hidden')) closeSnapshotsModal();
      if (missingModal && !missingModal.classList.contains('hidden')) clearPendingDocumentUpload();
    });
    window.addEventListener('online', () => { if (isDirty() && hasValidToken()) syncNow().catch(reportError); });
    window.addEventListener('offline', () => setStatus('pending', 'Guardado en este dispositivo', 'Sin Internet. Los cambios siguen seguros en esta computadora y se respaldarán en Drive al recuperar la conexión.'));

    if (localStorage.getItem(KEY_DIRTY) == null) localStorage.setItem(KEY_DIRTY, (await localHasData()) ? '1' : '0');
    updateAccountUi();
    if (hasValidToken()) {
      scheduleTokenExpirationNotice();
      setStatus(isDirty() ? 'pending' : 'synced', isDirty() ? 'Guardado en este dispositivo' : 'Drive conectado', isDirty() ? 'Los cambios están guardados localmente. Sincronizando el respaldo pendiente…' : 'La sesión de Drive se restauró automáticamente.');
      setTimeout(() => syncNow().catch(reportError), 0);
    } else if (currentAccount) {
      setStatus(isDirty() ? 'pending' : 'disconnected', isDirty() ? 'Guardado en este dispositivo' : 'Drive en pausa', 'Pulsa “Reanudar Drive” para comprobar y respaldar este equipo.');
    } else {
      setStatus(isDirty() ? 'pending' : 'disconnected', isDirty() ? 'Guardado en este dispositivo' : 'Drive desconectado', 'Conecta tu cuenta para mantener un respaldo actualizado en la nube.');
    }
  }

  window.COEducaDrive = {
    markDirty,
    recordDeletion,
    snapshotCurrent: async (reason) => createLocalSnapshot(await window.COEducaBackup.collect(), reason),
    setSuspended,
    syncNow,
    shouldUploadDocuments,
    uploadGeneratedDocument,
    folderPathLabel,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
