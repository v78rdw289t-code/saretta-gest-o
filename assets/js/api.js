// ============================================================
// API - Comunicação com Google Apps Script
// ============================================================

const API = (() => {
  // Preencha com a URL do Apps Script após o deploy
  const BASE_URL = window.APPS_SCRIPT_URL || '';

  const cache = new Map();
  const CACHE_TTL = 30000; // 30 segundos

  function cacheKey(url) { return url; }

  async function get(action, params = {}, useCache = true) {
    if (!BASE_URL) { showConfigWarning(); return null; }
    const url = new URL(BASE_URL);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== null && v !== undefined) url.searchParams.set(k, v);
    });
    const key = cacheKey(url.toString());
    if (useCache && cache.has(key)) {
      const { data, ts } = cache.get(key);
      if (Date.now() - ts < CACHE_TTL) return data;
    }
    const res = await fetch(url.toString(), { redirect: 'follow' });
    const json = await res.json();
    if (useCache && json.success) cache.set(key, { data: json, ts: Date.now() });
    return json;
  }

  async function post(action, body = {}) {
    if (!BASE_URL) { showConfigWarning(); return null; }
    cache.clear();
    const res = await fetch(BASE_URL, {
      method: 'POST',
      body: JSON.stringify({ action, ...body }),
      redirect: 'follow',
    });
    return res.json();
  }

  let _warnShown = false;
  function showConfigWarning() {
    if (_warnShown) return;
    _warnShown = true;
    Toast.warning('Configure a URL do Apps Script em Configurações');
    setTimeout(() => { _warnShown = false; }, 10000);
  }

  // ─── Métodos de conveniência ─────────────────────────────
  const db = {
    read(sheet, id = null, filters = null) {
      const params = { sheet };
      if (id) params.id = id;
      if (filters) Object.assign(params, filters);
      return get('read', params);
    },
    create(sheet, data) { return post('create', { sheet, data }); },
    update(sheet, id, data) { return post('update', { sheet, id, data }); },
    delete(sheet, id) { return post('delete', { sheet, id }); },
    batch(operations) { return post('batch', { operations }); },
    stats() { return get('stats', {}, false); },
    initDB() { return get('initDB', {}, false); },
    // Operações complexas
    fecharOS(data) { return post('fecharOS', data); },
    registrarCompra(data) { return post('registrarCompra', data); },
    registrarFiado(data) { return post('registrarFiado', data); },
    pagarParcela(data) { return post('pagarParcela', data); },
    excluirOS(id) { return post('excluirOS', { id }); },
  };

  return { get, post, db };
})();

// ─── CONFIG LOCAL ────────────────────────────────────────────
const LocalConfig = {
  KEY: 'saretta_config',
  get() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '{}'); } catch { return {}; }
  },
  set(key, value) {
    const cfg = this.get();
    cfg[key] = value;
    localStorage.setItem(this.KEY, JSON.stringify(cfg));
  },
  getUrl() { return this.get().apps_script_url || ''; },
  setUrl(url) { this.set('apps_script_url', url); window.APPS_SCRIPT_URL = url; }
};

// Inicializar URL do Apps Script do localStorage
window.APPS_SCRIPT_URL = LocalConfig.getUrl();
