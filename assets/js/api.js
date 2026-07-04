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
    fecharOSLote:    ()     => ['os', 'parcelas', 'fechamentos', 'fechamento_dias', 'fechamento_os'],
    registrarCompra: ()     => ['compras', 'compras_itens', 'estoque', 'estoque_movimentacoes', 'parcelas', 'fiado', 'fiado_mov'],
    registrarMovEstoque: () => ['estoque', 'estoque_movimentacoes'],
    registrarFiado:  ()     => ['fiado', 'parcelas'],
    registrarEmprestimoSocio: () => ['fiado_mov', 'parcelas', 'contas'],
    registrarFiadoMovManual:  () => ['fiado_mov'],
    acertarFiado:    ()     => ['fiado_mov', 'fiado', 'parcelas', 'contas'],
    pagarParcela:    ()     => ['parcelas', 'fiado', 'contas'],
    excluirOS:          ()     => ['os', 'os_itens', 'diarias', 'fechamentos', 'fechamento_dias', 'fechamento_os', 'estoque', 'estoque_movimentacoes'],
    excluirLancamento:  ()     => ['parcelas', 'fiado', 'fiado_mov'],
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

  // Monta a URL do GET incluindo o token de acesso (se configurado).
  // Centralizado para get() e isCached() usarem EXATAMENTE a mesma chave de cache.
  function buildUrl(action, params = {}) {
    const base = window.APPS_SCRIPT_URL;
    if (!base) return null;
    const url = new URL(base);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== null && v !== undefined) url.searchParams.set(k, v);
    });
    const token = (typeof LocalConfig !== 'undefined') ? LocalConfig.getToken() : '';
    if (token) url.searchParams.set('token', token);
    return url.toString();
  }

  // fetch com timeout (AbortController) — evita travar o app em sinal ruim
  const NET_TIMEOUT       = 15000; // 15s na 1ª tentativa
  const NET_TIMEOUT_RETRY = 25000; // 2ª tentativa mais paciente (Apps Script frio demora)
  async function fetchWithTimeout(url, opts = {}, timeout = NET_TIMEOUT) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      return await fetch(url, { ...opts, redirect: 'follow', signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  // GET com 1 retry: a maioria das "falhas de conexão" é o Apps Script frio ou
  // enfileirado estourando o timeout — não falta de internet — então vale
  // insistir uma vez (com timeout maior) antes de desistir.
  // POST NÃO passa por aqui: repetir uma escrita que chegou duplicaria o lançamento.
  async function fetchJsonGet(url) {
    const tenta = async (timeout) => {
      const res = await fetchWithTimeout(url, {}, timeout);
      // Em erro de quota/instabilidade o Google devolve página HTML → json() lança
      return res.json();
    };
    try {
      return await tenta(NET_TIMEOUT);
    } catch (e) {
      if (navigator.onLine === false) throw e; // sem rede mesmo — retry é inútil
      await new Promise(r => setTimeout(r, 600));
      return tenta(NET_TIMEOUT_RETRY);
    }
  }

  // Mensagem honesta: só fala em internet quando o navegador SABE que está
  // offline; senão o problema é o servidor (lentidão/instabilidade do Google).
  function netErrorMsg(sufixo) {
    const base = (navigator.onLine === false)
      ? 'Sem internet'
      : 'O servidor demorou pra responder';
    return base + (sufixo || '');
  }

  // Aviso de falha de rede — no máximo 1x a cada 8s para não spammar
  let _offlineShown = false;
  function showOfflineWarning(msg) {
    if (_offlineShown) return;
    _offlineShown = true;
    if (typeof Toast !== 'undefined') Toast.warning(msg || 'Sem conexão — verifique a internet');
    setTimeout(() => { _offlineShown = false; }, 8000);
  }

  function isCached(action, params = {}) {
    const urlStr = buildUrl(action, params);
    if (!urlStr) return false;
    const entry = cache.get(urlStr);
    // Stale conta como "cached": com o stale-while-revalidate o render é
    // instantâneo com qualquer cache de até 1h (quem usa isto decide se
    // mostra spinner — com stale não precisa).
    return !!(entry && Date.now() - entry.ts < STORAGE_TTL);
  }

  // Refetches em background — usado para stale-while-revalidate
  // Mantém um Set pra evitar disparar múltiplos refetches do mesmo URL
  const _backgroundFetches = new Set();
  function backgroundRefetch(url, key) {
    if (_backgroundFetches.has(key)) return;
    _backgroundFetches.add(key);
    fetchWithTimeout(url)
      .then(r => r.json())
      .then(json => {
        if (json && json.success) {
          cache.set(key, { data: json, ts: Date.now() });
          persistCache();
        }
      })
      .catch(() => {})  // refetch silencioso — falha não incomoda o usuário
      .finally(() => _backgroundFetches.delete(key));
  }

  // ─── Lote de reads (readMany) ─────────────────────────────
  // Cada chamada ao /exec do Apps Script custa ~1-3s (redirect 302 + partida
  // do script), e as telas pedem 3-8 sheets em Promise.all. Em vez de N GETs
  // brigando entre si (e estourando timeout), os reads de sheet inteira que
  // chegam na mesma janela de 10ms viram UM GET action=readMany. O resultado
  // é fatiado e cacheado sob a MESMA chave do read individual — o resto do
  // app não muda nada.
  // Se o backend ainda não tem readMany (Code.gs não republicado), a resposta
  // é 'Ação inválida' → cai pros reads individuais e não insiste na sessão.
  let _readManyOk = true;
  let _readQueue  = null;        // Map<sheet, {key, resolvers[]}>
  const _inFlightSheets = new Set(); // dedupe de refresh em background

  function enqueueRead(sheet, key, background) {
    if (background && _inFlightSheets.has(sheet)) return Promise.resolve(null);
    if (!_readQueue) {
      _readQueue = new Map();
      setTimeout(flushReadQueue, 10);
    }
    let item = _readQueue.get(sheet);
    if (!item) {
      item = { key, resolvers: [] };
      _readQueue.set(sheet, item);
      _inFlightSheets.add(sheet);
    }
    if (background) return Promise.resolve(null); // só popular o cache
    return new Promise(resolve => item.resolvers.push(resolve));
  }

  async function flushReadQueue() {
    const queue = _readQueue;
    _readQueue = null;
    const sheets = Array.from(queue.keys());

    const finish = (sheet, json) => {
      const item = queue.get(sheet);
      if (json && json.success) cache.set(item.key, { data: json, ts: Date.now() });
      item.resolvers.forEach(r => r(json));
    };
    // Rede falhou de vez: serve o cache que tiver (mesmo velho) — melhor que travar
    const fallback = (sheet) => {
      const item = queue.get(sheet);
      if (cache.has(item.key)) {
        showOfflineWarning(netErrorMsg(' — mostrando dados salvos'));
        return cache.get(item.key).data;
      }
      showOfflineWarning(netErrorMsg('. Tente de novo.'));
      return { success: false, error: 'offline', offline: true };
    };

    try {
      if (_readManyOk && sheets.length > 1) {
        const json = await fetchJsonGet(buildUrl('readMany', { sheets: sheets.join(',') }));
        if (json && json.error && /autoriz|token/i.test(json.error)) {
          Toast.error('Acesso negado — confira o token em Configurações');
          sheets.forEach(s => finish(s, json));
          return;
        }
        if (json && json.success && json.data) {
          sheets.forEach(s => finish(s, { success: true, data: json.data[s] || [] }));
          persistCache();
          return;
        }
        // Backend antigo sem readMany → reads individuais daqui pra frente
        if (json && /inválida/i.test(json.error || '')) _readManyOk = false;
      }
      // 1 sheet só, backend antigo ou readMany devolveu erro de aplicação
      await Promise.all(sheets.map(async (s) => {
        try {
          const json = await fetchJsonGet(buildUrl('read', { sheet: s }));
          if (json && json.error && /autoriz|token/i.test(json.error)) {
            Toast.error('Acesso negado — confira o token em Configurações');
          }
          finish(s, json);
        } catch (e) {
          finish(s, fallback(s));
        }
      }));
      persistCache();
    } catch (e) {
      sheets.forEach(s => finish(s, fallback(s)));
    } finally {
      sheets.forEach(s => _inFlightSheets.delete(s));
    }
  }

  async function get(action, params = {}, useCache = true) {
    const base = window.APPS_SCRIPT_URL;
    if (!base) { showConfigWarning(); return null; }
    const urlStr = buildUrl(action, params);
    const key    = cacheKey(urlStr);

    // read de sheet inteira (sem id/filtros) é elegível pro lote readMany
    const soSheet = action === 'read' && params.sheet && !params.id &&
                    Object.keys(params).length === 1;

    if (useCache && cache.has(key)) {
      const { data, ts } = cache.get(key);
      const age = Date.now() - ts;
      // Stale-while-revalidate: QUALQUER cache de até 1h renderiza na hora;
      // passou de 1min, atualiza em background. Reabrir o app depois de um
      // tempo parado não bloqueia mais a tela esperando a rede.
      if (age < STORAGE_TTL) {
        if (age > REFRESH_AFTER) {
          if (soSheet) enqueueRead(params.sheet, key, true);
          else backgroundRefetch(urlStr, key);
        }
        return data;
      }
    }

    if (soSheet && useCache) return enqueueRead(params.sheet, key, false);

    try {
      const json = await fetchJsonGet(urlStr);
      if (json && json.error && /autoriz|token/i.test(json.error)) {
        Toast.error('Acesso negado — confira o token em Configurações');
      }
      if (useCache && json && json.success) {
        cache.set(key, { data: json, ts: Date.now() });
        persistCache();
      }
      return json;
    } catch (e) {
      // Rede falhou ou timeout (já com retry). Se tem cache (mesmo velho), usa.
      if (cache.has(key)) {
        showOfflineWarning(netErrorMsg(' — mostrando dados salvos'));
        return cache.get(key).data;
      }
      showOfflineWarning(netErrorMsg('. Tente de novo.'));
      return { success: false, error: 'offline', offline: true };
    }
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

    const token = (typeof LocalConfig !== 'undefined') ? LocalConfig.getToken() : '';
    try {
      // SEM retry automático em POST: se a 1ª tentativa chegou no servidor e a
      // resposta se perdeu, repetir duplicaria o lançamento. O usuário decide.
      const res = await fetchWithTimeout(base, {
        method: 'POST',
        body: JSON.stringify({ action, token, ...body }),
      });
      const json = await res.json();
      if (json && json.error && /autoriz|token/i.test(json.error)) {
        Toast.error('Acesso negado — confira o token em Configurações');
      }
      return json;
    } catch (e) {
      showOfflineWarning(netErrorMsg(' — não foi possível salvar. Tente de novo.'));
      return { success: false, error: 'offline', offline: true };
    }
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
    repairDB() { return get('repairDB', {}, false); },
    fecharOS(data) { return post('fecharOS', data); },
    fecharOSLote(data) { return post('fecharOSLote', data); },
    registrarCompra(data) { return post('registrarCompra', data); },
    registrarMovEstoque(data) { return post('registrarMovEstoque', data); },
    registrarFiado(data) { return post('registrarFiado', data); },
    registrarEmprestimoSocio(data) { return post('registrarEmprestimoSocio', data); },
    registrarFiadoMovManual(data) { return post('registrarFiadoMovManual', data); },
    acertarFiado(data) { return post('acertarFiado', data); },
    pagarParcela(data) { return post('pagarParcela', data); },
    excluirOS(id) { return post('excluirOS', { id }); },
    excluirLancamento(parcelaId) { return post('excluirLancamento', { parcela_id: parcelaId }); },
  };

  function clearCache() {
    cache.clear();
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }

  // True se o cache tem ao menos uma entrada aproveitável — usado pelo splash
  // para decidir se mostra o loading inicial. Com o stale-while-revalidate,
  // cache de até 1h já rende uma tela instantânea → splash desnecessário.
  function hasCache() {
    if (cache.size === 0) return false;
    const now = Date.now();
    for (const entry of cache.values()) {
      if (now - entry.ts < STORAGE_TTL) return true;
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
  setUrl(url) { this.set('apps_script_url', url); window.APPS_SCRIPT_URL = url; },
  getToken() { return this.get().api_token || ''; },
  setToken(t) { this.set('api_token', (t || '').trim()); },
};

window.APPS_SCRIPT_URL = LocalConfig.getUrl();
