// ============================================================
// API - Comunicação com Google Apps Script
// ============================================================

const API = (() => {
  const BASE_URL = window.APPS_SCRIPT_URL || '';

  // ─── Cache em memória + localStorage ──────────────────────
  // Em memória: TTL curto (rápido, sempre fresco)
  // localStorage: TTL longo (sobrevive entre sessões, dados ficam pré-prontos)
  // Background refresh: se cache > REFRESH_AFTER, dispara refetch silencioso
  const cache = new Map();
  const CACHE_TTL     = 5  * 60 * 1000;  // 5 min — depois disso, refetch obrigatório
  const STORAGE_TTL   = 60 * 60 * 1000;  // 1h   — TTL no localStorage
  const REFRESH_AFTER = 1  * 60 * 1000;  // 1min — depois disso, refetch em background
  const STORAGE_KEY   = 'saretta_api_cache_v1';

  const POST_INVALIDATES = {
    create:          (body) => [body.sheet],
    update:          (body) => [body.sheet],
    delete:          (body) => [body.sheet],
    batch:           (body) => Array.from(new Set((body.operations || []).map(op => op.sheet).filter(Boolean))),
    fecharOS:        ()     => ['os', 'parcelas', 'fechamentos', 'fechamento_dias'],
    registrarCompra: ()     => ['compras', 'compras_itens', 'estoque', 'parcelas'],
    registrarFiado:  ()     => ['fiado', 'parcelas'],
    pagarParcela:    ()     => ['parcelas', 'fiado'],
    excluirOS:       ()     => ['os', 'os_itens', 'diarias', 'fechamentos', 'fechamento_dias', 'estoque'],
  };

  function invalidateSheets(sheets) {
    if (!sheets || sheets.length === 0) return;
    for (const key of Array.from(cache.keys())) {
      // stats agregada também é invalidada — depende de TODOS os sheets
      if (key.includes('action=stats')) { cache.delete(key); continue; }
      for (const sheet of sheets) {
        if (new RegExp('[?&]sheet=' + sheet + '(&|$)').test(key)) {
          cache.delete(key);
          break;
        }
      }
    }
    persistCache();
  }

  // ─── Hidratação do cache do localStorage ──────────────────
  function hydrateCache() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      const now = Date.now();
      let restored = 0;
      for (const [key, entry] of Object.entries(obj)) {
        if (entry && entry.ts && now - entry.ts < STORAGE_TTL) {
          cache.set(key, { data: entry.data, ts: entry.ts });
          restored++;
        }
      }
      if (restored > 0) console.log(`[API] Cache hidratado: ${restored} entradas do localStorage`);
    } catch (e) {
      // localStorage corrompido — limpa
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
    }
  }

  // Persiste cache no localStorage (debounced — evita escritas repetidas)
  let _persistTimer = null;
  function persistCache() {
    if (_persistTimer) clearTimeout(_persistTimer);
    _persistTimer = setTimeout(() => {
      _persistTimer = null;
      _doPersist();
    }, 400);
  }
  function _doPersist() {
    try {
      const obj = {};
      for (const [key, entry] of cache.entries()) {
        obj[key] = { data: entry.data, ts: entry.ts };
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {
      // Quota excedido → remove metade das entradas mais antigas e tenta de novo
      if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
        const entries = Array.from(cache.entries()).sort((a, b) => a[1].ts - b[1].ts);
        const toRemove = Math.ceil(entries.length / 2);
        for (let i = 0; i < toRemove; i++) cache.delete(entries[i][0]);
        try {
          const obj = {};
          for (const [key, entry] of cache.entries()) obj[key] = { data: entry.data, ts: entry.ts };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
        } catch {}
      }
    }
  }

  function cacheKey(url) { return url; }

  function isCached(action, params = {}) {
    const base = window.APPS_SCRIPT_URL;
    if (!base) return false;
    const url = new URL(base);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== null && v !== undefined) url.searchParams.set(k, v);
    });
    const entry = cache.get(url.toString());
    return !!(entry && Date.now() - entry.ts < CACHE_TTL);
  }

  // Refetches em background — usado para stale-while-revalidate
  // Mantém um Set pra evitar disparar múltiplos refetches do mesmo URL
  const _backgroundFetches = new Set();
  function backgroundRefetch(url, key) {
    if (_backgroundFetches.has(key)) return;
    _backgroundFetches.add(key);
    fetch(url, { redirect: 'follow' })
      .then(r => r.json())
      .then(json => {
        if (json && json.success) {
          cache.set(key, { data: json, ts: Date.now() });
          persistCache();
        }
      })
      .catch(() => {})
      .finally(() => _backgroundFetches.delete(key));
  }

  async function get(action, params = {}, useCache = true) {
    const base = window.APPS_SCRIPT_URL;
    if (!base) { showConfigWarning(); return null; }
    const url = new URL(base);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== null && v !== undefined) url.searchParams.set(k, v);
    });
    const urlStr = url.toString();
    const key    = cacheKey(urlStr);

    if (useCache && cache.has(key)) {
      const { data, ts } = cache.get(key);
      const age = Date.now() - ts;
      if (age < CACHE_TTL) {
        // Cache fresco o suficiente para retornar de imediato.
        // Se passou do "refresh window" (1min), dispara refetch silencioso
        // para o cache estar atualizado na PRÓXIMA chamada.
        if (age > REFRESH_AFTER) backgroundRefetch(urlStr, key);
        return data;
      }
    }
    const res  = await fetch(urlStr, { redirect: 'follow' });
    const json = await res.json();
    if (useCache && json && json.success) {
      cache.set(key, { data: json, ts: Date.now() });
      persistCache();
    }
    return json;
  }

  async function post(action, body = {}) {
    const base = window.APPS_SCRIPT_URL;
    if (!base) { showConfigWarning(); return null; }

    const invalidator = POST_INVALIDATES[action];
    if (invalidator) {
      try { invalidateSheets(invalidator(body)); }
      catch { cache.clear(); persistCache(); }
    } else {
      cache.clear();
      persistCache();
    }

    const res = await fetch(base, {
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

  const db = {
    read(sheet, id = null, filters = null) {
      const params = { sheet };
      if (id) params.id = id;
      if (filters) Object.assign(params, filters);
      return get('read', params);
    },
    isCached(sheet, id = null, filters = null) {
      const params = { sheet };
      if (id) params.id = id;
      if (filters) Object.assign(params, filters);
      return isCached('read', params);
    },
    create(sheet, data) { return post('create', { sheet, data }); },
    update(sheet, id, data) { return post('update', { sheet, id, data }); },
    delete(sheet, id) { return post('delete', { sheet, id }); },
    batch(operations) { return post('batch', { operations }); },
    // Cacheado agora — é invalidado pela invalidateSheets() em todo POST
    stats() { return get('stats', {}, true); },
    initDB() { return get('initDB', {}, false); },
    fecharOS(data) { return post('fecharOS', data); },
    registrarCompra(data) { return post('registrarCompra', data); },
    registrarFiado(data) { return post('registrarFiado', data); },
    pagarParcela(data) { return post('pagarParcela', data); },
    excluirOS(id) { return post('excluirOS', { id }); },
  };

  function clearCache() {
    cache.clear();
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }

  // True se o cache tem ao menos uma entrada válida — usado pelo splash
  // para decidir se mostra o loading inicial.
  function hasCache() {
    if (cache.size === 0) return false;
    const now = Date.now();
    for (const entry of cache.values()) {
      if (now - entry.ts < CACHE_TTL) return true;
    }
    return false;
  }

  // Hidrata cache do localStorage assim que o módulo carrega
  hydrateCache();

  return { get, post, db, clearCache, hasCache };
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

window.APPS_SCRIPT_URL = LocalConfig.getUrl();
