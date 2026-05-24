// ============================================================
// API - Comunicação com Google Apps Script
// ============================================================

const API = (() => {
  // Preencha com a URL do Apps Script após o deploy
  const BASE_URL = window.APPS_SCRIPT_URL || '';

  // ─── Cache em memória ─────────────────────────────────────
  // TTL de 5 min: Sheets é lento e os dados não mudam toda hora.
  // Quando o usuário escreve algo, invalidamos apenas as sheets afetadas.
  const cache = new Map();
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

  // Mapa de quais sheets cada POST invalida.
  // Se uma action não está aqui, conservadoramente limpamos tudo (segurança).
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
      for (const sheet of sheets) {
        // Match `sheet=<name>` como parâmetro de query string (boundary com & ou fim)
        if (new RegExp('[?&]sheet=' + sheet + '(&|$)').test(key)) {
          cache.delete(key);
          break;
        }
      }
    }
  }

  function cacheKey(url) { return url; }

  // True se já temos a resposta dessa requisição em cache válido — útil
  // para módulos pularem o Loading.show() quando souberem que vai vir
  // instantâneo.
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

  async function get(action, params = {}, useCache = true) {
    const base = window.APPS_SCRIPT_URL;
    if (!base) { showConfigWarning(); return null; }
    const url = new URL(base);
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
    const base = window.APPS_SCRIPT_URL;
    if (!base) { showConfigWarning(); return null; }

    // Invalidação seletiva: só limpa o cache dos sheets afetados pela ação.
    // Antes era cache.clear() em todo POST — agora só joga fora o necessário.
    const invalidator = POST_INVALIDATES[action];
    if (invalidator) {
      try { invalidateSheets(invalidator(body)); }
      catch { cache.clear(); }
    } else {
      // Action desconhecida → comportamento antigo (limpa tudo, seguro).
      cache.clear();
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

  // ─── Métodos de conveniência ─────────────────────────────
  const db = {
    read(sheet, id = null, filters = null) {
      const params = { sheet };
      if (id) params.id = id;
      if (filters) Object.assign(params, filters);
      return get('read', params);
    },
    // Checa se um read específico já está em cache (sem disparar request)
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
    stats() { return get('stats', {}, false); },
    initDB() { return get('initDB', {}, false); },
    // Operações complexas
    fecharOS(data) { return post('fecharOS', data); },
    registrarCompra(data) { return post('registrarCompra', data); },
    registrarFiado(data) { return post('registrarFiado', data); },
    pagarParcela(data) { return post('pagarParcela', data); },
    excluirOS(id) { return post('excluirOS', { id }); },
  };

  // Esvazia o cache inteiro (debug / "atualizar dados" manual)
  function clearCache() { cache.clear(); }

  return { get, post, db, clearCache };
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
