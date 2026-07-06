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
    gerarRecorrentes:   ()     => ['parcelas', 'recorrentes'],
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

  // Overlay da caderneta offline: leituras de sheet inteira ganham por cima
  // os creates/updates que ainda estão na fila (com _pendente:true) — senão a
  // diária salva offline "some" da tela e o dono lança de novo. Nunca muta o
  // objeto cacheado (Outbox.overlay devolve cópia quando há pendências).
  function withOverlay(sheet, json, filters = null) {
    if (typeof Outbox === 'undefined' || !sheet) return json;
    try { return Outbox.overlay(sheet, json, filters); } catch { return json; }
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
      const out = (json && json.success) ? withOverlay(sheet, json) : json;
      item.resolvers.forEach(r => r(out));
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

    // leituras de lista (sheet inteira OU filtrada, sem id) recebem o overlay
    // da caderneta offline por cima do resultado
    const ovSheet   = (action === 'read' && params.sheet && !params.id) ? params.sheet : null;
    let   ovFilters = null;
    if (ovSheet && !soSheet) {
      ovFilters = { ...params };
      delete ovFilters.sheet;
    }

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
        return ovSheet ? withOverlay(ovSheet, data, ovFilters) : data;
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
      return ovSheet ? withOverlay(ovSheet, json, ovFilters) : json;
    } catch (e) {
      // Rede falhou ou timeout (já com retry). Se tem cache (mesmo velho), usa.
      if (cache.has(key)) {
        showOfflineWarning(netErrorMsg(' — mostrando dados salvos'));
        const data = cache.get(key).data;
        return ovSheet ? withOverlay(ovSheet, data, ovFilters) : data;
      }
      showOfflineWarning(netErrorMsg('. Tente de novo.'));
      return { success: false, error: 'offline', offline: true };
    }
  }

  // Rede de segurança contra clique duplo (além do Guard nos handlers):
  // um POST IDÊNTICO (mesma action + mesmo corpo) disparado enquanto o 1º
  // ainda está em voo recebe a MESMA promise — grava uma vez só.
  const _postsEmVoo = new Map();
  function post(action, body = {}) {
    const sig = action + '|' + JSON.stringify(body);
    if (_postsEmVoo.has(sig)) return _postsEmVoo.get(sig);
    const p = _post(action, body).finally(() => _postsEmVoo.delete(sig));
    _postsEmVoo.set(sig, p);
    return p;
  }

  function invalidateForAction(action, body) {
    const invalidator = POST_INVALIDATES[action];
    if (invalidator) {
      try { invalidateSheets(invalidator(body)); }
      catch { cache.clear(); persistCache(); }
    } else {
      cache.clear();
      persistCache();
    }
  }

  // Ações "pesadas" (muitas escritas na planilha) merecem mais paciência:
  // uma compra com vários itens roda dezenas de operações no Apps Script e
  // passa fácil dos 15s. O id de idempotência (ver registrarCompra) garante
  // que, mesmo se ainda estourar, um reenvio não duplica.
  const POST_TIMEOUT = {
    registrarCompra: 60000,
    fecharOS:        60000,
  };

  // Envio cru do POST — lança erro de rede pro chamador decidir.
  // SEM retry automático: se a 1ª tentativa chegou no servidor e a resposta
  // se perdeu, repetir duplicaria o lançamento.
  async function rawSend(action, body) {
    const token = (typeof LocalConfig !== 'undefined') ? LocalConfig.getToken() : '';
    const res = await fetchWithTimeout(window.APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action, token, ...body }),
    }, POST_TIMEOUT[action] || NET_TIMEOUT);
    const json = await res.json();
    if (json && json.error && /autoriz|token/i.test(json.error)) {
      Toast.error('Acesso negado — confira o token em Configurações');
    }
    return json;
  }

  async function _post(action, body = {}) {
    const base = window.APPS_SCRIPT_URL;
    if (!base) { showConfigWarning(); return null; }

    // Caderneta offline (Outbox): POSTs enfileiráveis ganham id de idempotência
    // e, sem rede (ou com fila esperando — a ordem importa), entram na fila em
    // vez de falhar. O retorno {success:true, queued:true} mantém os handlers
    // de salvar no caminho feliz sem nenhuma mudança neles.
    const queueable = (typeof Outbox !== 'undefined') && Outbox.isQueueable(action, body);
    if (queueable) {
      Outbox.stampIds(action, body);
      if (navigator.onLine === false) return Outbox.enqueue(action, body);
      if (Outbox.pendentes() > 0) {
        const r = Outbox.enqueue(action, body);
        Outbox.flush(); // tenta esvaziar já — pode ser só a fila que ficou pra trás
        return r;
      }
    }

    // Enfileirável NÃO invalida o cache antes do envio: se a rede falhar, é o
    // cache intacto + overlay da fila que mantém a tela viva offline.
    if (!queueable) invalidateForAction(action, body);

    try {
      const json = await rawSend(action, body);
      if (queueable) invalidateForAction(action, body);
      return json;
    } catch (e) {
      if (queueable) {
        // TypeError = o request nem saiu (DNS/conexão) → fila normal.
        // AbortError/parse = ambíguo (PODE ter chegado) → 'incerto', reenvio manual.
        return Outbox.enqueue(action, body, (e && e.name === 'TypeError') ? 'pendente' : 'incerto');
      }
      showOfflineWarning(netErrorMsg(' — não foi possível salvar. Tente de novo.'));
      return { success: false, error: 'offline', offline: true };
    }
  }

  // Caminho interno usado pelo flush da caderneta: sem hooks de fila (evita
  // recursão) e devolvendo o TIPO do erro de rede — o flush decide se para
  // (rede caiu) ou marca 'incerto' (timeout ambíguo).
  async function _postDireto(action, body = {}) {
    try {
      const json = await rawSend(action, body);
      if (json && json.success) invalidateForAction(action, body);
      return json;
    } catch (e) {
      return { success: false, error: 'offline', offline: true, errName: (e && e.name) || '' };
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
    gerarRecorrentes(data) { return post('gerarRecorrentes', data); },
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

  return { get, post, db, clearCache, hasCache, _postDireto };
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
