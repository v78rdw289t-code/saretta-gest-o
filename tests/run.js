// ============================================================
// Testes node do lote v3.4 (caderneta offline + recorrentes)
// Rodar: node tests/run.js
// Sem framework: node:assert + node:vm com stubs (localStorage,
// fetch, navigator, DOM mínimo, SpreadsheetApp fake p/ Code.gs).
// ============================================================
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let passed = 0;
function test(nome, fn) {
  try { fn(); passed++; console.log('  ✓ ' + nome); }
  catch (e) { console.error('  ✗ ' + nome + '\n    ' + (e && e.message)); process.exitCode = 1; }
}
async function testAsync(nome, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + nome); }
  catch (e) { console.error('  ✗ ' + nome + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

// ─── Stubs comuns ────────────────────────────────────────────
function makeLocalStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
}
const noopEl = { classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
                 style: {}, textContent: '', innerHTML: '', appendChild() {} };
function makeDocument() {
  return {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => ({ ...noopEl, addEventListener() {}, remove() {} }),
    body: { style: {} },
    hidden: false,
  };
}

// ─── Sandbox do FRONTEND (utils + api + outbox) ──────────────
// seedLS (opcional): { chave: valorString } pré-carregado no localStorage ANTES
// de rodar api.js — útil pra testar a hidratação/TTL do cache.
function makeFrontSandbox(seedLS) {
  const fetchCalls = [];
  const sandbox = {
    console, URL, JSON, Math, Date, Promise, Array, Object, String, Number, RegExp, Map, Set,
    setTimeout: (fn) => { fn(); return 0; }, // síncrono nos testes (flush/persist debounce)
    clearTimeout: () => {},
    crypto: { randomUUID: () => require('node:crypto').randomUUID() },
    localStorage: makeLocalStorage(),
    document: makeDocument(),
    navigator: { onLine: true },
    requestAnimationFrame: fn => fn(),
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    __fetchMode: 'ok',
    __fetchResponse: null,
    __fetchCalls: fetchCalls,
    fetch: async (url, opts = {}) => {
      fetchCalls.push({ url: String(url), opts });
      const mode = sandbox.__fetchMode;
      if (mode === 'typeerror') throw new TypeError('Failed to fetch');
      if (mode === 'abort') { const e = new Error('Aborted'); e.name = 'AbortError'; throw e; }
      if (mode === 'apperror') return { json: async () => ({ success: false, error: 'Validação falhou' }) };
      return { json: async () => (sandbox.__fetchResponse || { success: true, data: {} }) };
    },
  };
  sandbox.addEventListener = () => {}; // window.addEventListener (gatilhos de flush)
  sandbox.window = sandbox; // window === globalThis, como no browser
  sandbox.window.APPS_SCRIPT_URL = 'http://fake.test/exec';
  if (seedLS) for (const [k, v] of Object.entries(seedLS)) sandbox.localStorage.setItem(k, v);
  vm.createContext(sandbox);
  // Ordem real do index.html: utils → (api) → (outbox). api usa Outbox via typeof.
  vm.runInContext(src('assets/js/utils.js'), sandbox, { filename: 'utils.js' });
  vm.runInContext(src('assets/js/api.js'), sandbox, { filename: 'api.js' });
  vm.runInContext(src('assets/js/outbox.js'), sandbox, { filename: 'outbox.js' });
  vm.runInContext('window.APPS_SCRIPT_URL = "http://fake.test/exec";', sandbox);
  return sandbox;
}

// ─── Sandbox do BACKEND (Code.gs) ────────────────────────────
function makeGsSandbox() {
  const sheets = {};
  function makeSheet() {
    const rows = [];
    return {
      rows,
      getDataRange() { return { getValues: () => (rows.length ? rows.map(r => r.slice()) : [[]]) }; },
      getRange(r, c) {
        return {
          setValues(vals) { vals.forEach((rv, i) => { rows[r - 1 + i] = rv.slice(); }); return this; },
          setValue(v) { if (!rows[r - 1]) rows[r - 1] = []; rows[r - 1][c - 1] = v; return this; },
          setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; },
        };
      },
      setFrozenRows() {},
      appendRow(row) { rows.push(row.slice()); },
      deleteRow(i) { rows.splice(i - 1, 1); },
    };
  }
  let uuidN = 0;
  const sandbox = {
    console, JSON, Math, Date, Array, Object, String, Number, RegExp,
    __sheets: sheets,
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => sheets[n] || (sheets[n] = makeSheet()) }) },
    Utilities: { getUuid: () => 'srv-uuid-' + (++uuidN), formatDate: () => '2026-07' },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { createTextOutput: t => ({ setMimeType: () => JSON.parse(t) }), MimeType: { JSON: 'json' } },
    DriveApp: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(src('apps-script/Code.gs'), sandbox, { filename: 'Code.gs' });
  return sandbox;
}

(async () => {
  console.log('\n— Outbox: enfileirar offline —');
  {
    const s = makeFrontSandbox();
    await testAsync('POST enfileirável offline → queued:true, id de cliente, sem fetch', async () => {
      s.navigator.onLine = false;
      const r = await vm.runInContext(
        `API.post('create', { sheet: 'diarias', data: { os_id: 'os1', data: '2026-07-05' } })`, s);
      assert.equal(r.success, true);
      assert.equal(r.queued, true);
      assert.match(String(r.data.id), /^[0-9a-f-]{36}$/i);
      assert.equal(s.__fetchCalls.length, 0);
      assert.equal(vm.runInContext('Outbox.total()', s), 1);
    });
    await testAsync('2º POST com fila não-vazia entra na fila mesmo online (FIFO)', async () => {
      s.navigator.onLine = true;
      s.__fetchMode = 'typeerror'; // flush disparado pelo enqueue não pode esvaziar
      const r = await vm.runInContext(
        `API.post('create', { sheet: 'lista_compras', data: { cliente_id: 'c1', descricao: 'Fita' } })`, s);
      assert.equal(r.queued, true);
      assert.equal(vm.runInContext('Outbox.total()', s), 2);
    });
    await testAsync('flush: para no 1º erro de rede e preserva a ordem', async () => {
      s.__fetchMode = 'typeerror';
      s.__fetchCalls.length = 0;
      await vm.runInContext('Outbox.flush()', s);
      assert.equal(vm.runInContext('Outbox.total()', s), 2); // nada removido
      assert.equal(s.__fetchCalls.length, 1);                // tentou só o 1º
    });
    await testAsync('flush: com rede ok esvazia em ordem (diária antes da lista)', async () => {
      s.__fetchMode = 'ok';
      s.__fetchCalls.length = 0;
      await vm.runInContext('Outbox.flush()', s);
      assert.equal(vm.runInContext('Outbox.total()', s), 0);
      assert.equal(s.__fetchCalls.length, 2);
      const b1 = JSON.parse(s.__fetchCalls[0].opts.body);
      const b2 = JSON.parse(s.__fetchCalls[1].opts.body);
      assert.equal(b1.sheet, 'diarias');
      assert.equal(b2.sheet, 'lista_compras');
    });
  }

  console.log('\n— Outbox: erro de aplicação e timeout ambíguo —');
  {
    const s = makeFrontSandbox();
    await testAsync('erro de aplicação no flush marca "erro" e segue pro próximo', async () => {
      s.navigator.onLine = false;
      await vm.runInContext(`API.post('create', { sheet: 'diarias', data: { a: 1 } })`, s);
      await vm.runInContext(`API.post('create', { sheet: 'parcelas', data: { b: 2 } })`, s);
      s.navigator.onLine = true;
      // 1º responde erro de aplicação, 2º ok
      let n = 0;
      s.fetch = async (url, opts) => {
        s.__fetchCalls.push({ url, opts });
        n++;
        return { json: async () => (n === 1 ? { success: false, error: 'Recusado' } : { success: true, data: {} }) };
      };
      await vm.runInContext('Outbox.flush()', s);
      assert.equal(vm.runInContext('Outbox.total()', s), 1);
      assert.equal(vm.runInContext('Outbox.pendentes()', s), 0); // o que sobrou está em "erro"
    });
    await testAsync('AbortError vira "incerto"; flush verifica por leitura e remove se já chegou', async () => {
      // fila limpa (isola do teste anterior)
      vm.runInContext(`localStorage.setItem('saretta_outbox_v1','[]')`, s);
      s.navigator.onLine = true;
      s.fetch = async () => { const e = new Error('Aborted'); e.name = 'AbortError'; throw e; };
      const r = await vm.runInContext(
        `API.post('create', { sheet: 'diarias', data: { c: 3 } })`, s);
      assert.equal(r.queued, true);
      assert.equal(vm.runInContext('Outbox.pendentes()', s), 0); // incerto ≠ pendente
      assert.equal(vm.runInContext('Outbox.total()', s), 1);
      // No flush, a verificação por id LÊ o servidor: achou o registro (chegou)
      // → sai da fila SEM reenviar o POST (a raiz da duplicação some).
      let posts = 0, reads = 0;
      s.fetch = async (url, opts) => {
        const isRead = String(url).includes('action=read');
        if (isRead) { reads++; return { json: async () => ({ success: true, data: [{ id: 'x' }] }) }; }
        posts++; return { json: async () => ({ success: true, data: {} }) };
      };
      await vm.runInContext('Outbox.flush()', s);
      assert.ok(reads >= 1);          // conferiu por leitura
      assert.equal(posts, 0);         // não reenviou (já tinha chegado)
      assert.equal(vm.runInContext('Outbox.total()', s), 0); // saiu da fila sozinho
    });
  }

  console.log('\n— Outbox: overlay otimista —');
  {
    const s = makeFrontSandbox();
    s.navigator.onLine = false;
    await vm.runInContext(
      `API.post('create', { sheet: 'diarias', data: { os_id: 'os1', horas_totais: 4 } })`, s);
    test('create pendente aparece no read da sheet', () => {
      const out = vm.runInContext(`Outbox.overlay('diarias', { success: true, data: [] })`, s);
      assert.equal(out.data.length, 1);
      assert.equal(out.data[0]._pendente, true);
    });
    test('read filtrado só recebe o pendente se os filtros batem', () => {
      const ok  = vm.runInContext(`Outbox.overlay('diarias', { success: true, data: [] }, { os_id: 'os1' })`, s);
      const nao = vm.runInContext(`Outbox.overlay('diarias', { success: true, data: [] }, { os_id: 'os2' })`, s);
      assert.equal(ok.data.length, 1);
      assert.equal(nao.data.length, 0);
    });
    await testAsync('update pendente aplica patch por id (e API.get entrega com overlay)', async () => {
      await vm.runInContext(
        `API.post('update', { sheet: 'os', id: 'os1', data: { data_fim: '2026-07-05' } })`, s);
      const out = vm.runInContext(
        `Outbox.overlay('os', { success: true, data: [{ id: 'os1', data_fim: '' }, { id: 'os2', data_fim: '' }] })`, s);
      assert.equal(out.data[0].data_fim, '2026-07-05');
      assert.equal(out.data[0]._pendente, true);
      assert.equal(out.data[1]._pendente, undefined);
    });
    test('UPDATE enfileirado NUNCA ganha data.id (id no patch reescreveria o id do registro)', () => {
      const fila = JSON.parse(s.localStorage.getItem('saretta_outbox_v1'));
      const upd = fila.find(i => i.action === 'update');
      assert.ok(upd, 'update na fila');
      assert.equal(upd.body.data.id, undefined);
      assert.equal(upd.body.id, 'os1'); // o alvo fica no body.id, não no patch
    });
  }

  console.log('\n— api.js: não-enfileirável mantém o comportamento antigo —');
  {
    const s = makeFrontSandbox();
    await testAsync('fecharOS offline → success:false/offline:true, nada na fila', async () => {
      s.navigator.onLine = false;
      s.__fetchMode = 'typeerror';
      const r = await vm.runInContext(`API.post('fecharOS', { id: 'os1' })`, s);
      assert.equal(r.success, false);
      assert.equal(r.offline, true);
      assert.equal(r.queued, undefined);
      assert.equal(vm.runInContext('Outbox.total()', s), 0);
    });
  }

  console.log('\n— Code.gs: create idempotente —');
  {
    const g = makeGsSandbox();
    const uid = require('node:crypto').randomUUID();
    test('create com id do cliente usa o id e grava 1 linha', () => {
      const r = vm.runInContext(`create('diarias', { id: '${uid}', os_id: 'os1', horas_totais: 4 })`, g);
      assert.equal(r.success, true);
      assert.equal(r.data.id, uid);
      assert.equal(g.__sheets.diarias.rows.length, 2); // header + 1
    });
    test('reenvio do MESMO id → jaExiste, sem duplicar', () => {
      const r = vm.runInContext(`create('diarias', { id: '${uid}', os_id: 'os1', horas_totais: 4 })`, g);
      assert.equal(r.success, true);
      assert.equal(r.jaExiste, true);
      assert.equal(g.__sheets.diarias.rows.length, 2);
    });
    test('create sem id (fluxo antigo) → UUID do servidor', () => {
      const r = vm.runInContext(`create('diarias', { os_id: 'os2' })`, g);
      assert.match(r.data.id, /^srv-uuid-/);
      assert.equal(g.__sheets.diarias.rows.length, 3);
    });
    test('id que não é UUID é ignorado (vira id do servidor)', () => {
      const r = vm.runInContext(`create('diarias', { id: 'meu-id-esquisito', os_id: 'os3' })`, g);
      assert.match(r.data.id, /^srv-uuid-/);
    });
  }

  console.log('\n— Code.gs: gerarRecorrentes —');
  {
    const g = makeGsSandbox();
    test('_mesesEntre: catch-up, sem retroagir e vazio quando em dia', () => {
      assert.deepEqual(vm.runInContext(`_mesesEntre('2026-05', '2026-07')`, g), ['2026-06', '2026-07']);
      assert.deepEqual(vm.runInContext(`_mesesEntre('', '2026-07')`, g), ['2026-07']);
      assert.deepEqual(vm.runInContext(`_mesesEntre(null, '2026-07')`, g), ['2026-07']);
      assert.deepEqual(vm.runInContext(`_mesesEntre('2026-07', '2026-07')`, g), []);
      assert.deepEqual(vm.runInContext(`_mesesEntre('2026-08', '2026-07')`, g), []); // 1º venc futuro
      assert.deepEqual(vm.runInContext(`_mesesEntre('2025-11', '2026-01')`, g), ['2025-12', '2026-01']);
    });
    test('_vencNoMes: clampa dia 31 no último dia do mês', () => {
      assert.equal(vm.runInContext(`_vencNoMes('2026-02', 31)`, g), '2026-02-28');
      assert.equal(vm.runInContext(`_vencNoMes('2026-06', 31)`, g), '2026-06-30');
      assert.equal(vm.runInContext(`_vencNoMes('2026-07', 10)`, g), '2026-07-10');
    });
    test('gera com catch-up + idempotente na 2ª chamada', () => {
      vm.runInContext(`create('recorrentes', { descricao: 'Aluguel', tipo: 'pagar', valor: 1200,
        categoria_id: 'cat1', cliente_id: '', dia_vencimento: 31, ativo: true,
        ultima_geracao: '2026-05', observacoes: '', data_criacao: '2026-05-10' })`, g);
      const r1 = vm.runInContext(`gerarRecorrentes({ mes: '2026-07' })`, g);
      assert.equal(r1.geradas, 2); // jun + jul
      const parcelas = vm.runInContext(`read('parcelas').data`, g);
      assert.deepEqual(parcelas.map(p => p.data_vencimento), ['2026-06-30', '2026-07-31']);
      assert.ok(parcelas.every(p => p.origem === 'recorrente' && p.status === 'pendente'));
      const r2 = vm.runInContext(`gerarRecorrentes({ mes: '2026-07' })`, g);
      assert.equal(r2.geradas, 0); // ultima_geracao avançou
    });
    test('pausada (ativo=false) não gera', () => {
      vm.runInContext(`create('recorrentes', { descricao: 'Luz', tipo: 'pagar', valor: 300,
        categoria_id: '', cliente_id: '', dia_vencimento: 10, ativo: false,
        ultima_geracao: '2026-01', observacoes: '', data_criacao: '2026-01-01' })`, g);
      const r = vm.runInContext(`gerarRecorrentes({ mes: '2026-07' })`, g);
      assert.equal(r.geradas, 0);
    });
    test('1º vencimento em mês futuro não gera nada ainda', () => {
      vm.runInContext(`create('recorrentes', { descricao: 'Internet', tipo: 'pagar', valor: 120,
        categoria_id: '', cliente_id: '', dia_vencimento: 5, ativo: true,
        ultima_geracao: '2026-07', observacoes: '', data_criacao: '2026-07-05' })`, g); // 1º venc: ago
      const r = vm.runInContext(`gerarRecorrentes({ mes: '2026-07' })`, g);
      assert.equal(r.geradas, 0);
      // Em agosto: Internet gera a 1ª (05/08) e o Aluguel segue o catch-up normal (31/08)
      const r2 = vm.runInContext(`gerarRecorrentes({ mes: '2026-08' })`, g);
      assert.equal(r2.geradas, 2);
      const vencs = vm.runInContext(`read('parcelas').data`, g).map(p => p.data_vencimento);
      assert.ok(vencs.includes('2026-08-05'));
      assert.ok(vencs.includes('2026-08-31'));
    });
  }

  console.log('\n— Grupos no estoque —');
  {
    const g = makeGsSandbox();
    test('sheet estoque tem coluna grupo e create/read a preservam', () => {
      assert.ok(vm.runInContext(`SHEET_HEADERS.estoque`, g).includes('grupo'));
      const r = vm.runInContext(`create('estoque', { descricao: 'Parafuso M6', grupo: 'Parafuso',
        quantidade: 10, valor_unit: 0.5, unidade: 'un', ativo: true })`, g);
      assert.equal(vm.runInContext(`read('estoque', '${r.data.id}').data[0]`, g).grupo, 'Parafuso');
    });
  }

  console.log('\n— api.js: OS/sessões/materiais com cache longo (offline) —');
  {
    // Semeia o cache com 2h de idade. Sheets de trabalho da OS (TTL 30d) devem
    // sobreviver ao boot; parcelas (TTL 1h) não. Testa hydrateCache + isCached/ttlFor.
    const now = Date.now();
    const twoH = 2 * 60 * 60 * 1000;
    const mk = sheet => `http://fake.test/exec?action=read&sheet=${sheet}`;
    const seedObj = {};
    ['os', 'diarias', 'os_itens', 'parcelas', 'clientes'].forEach(sh => {
      seedObj[mk(sh)] = { data: { success: true, data: [{ id: sh + '1' }] }, ts: now - twoH };
    });
    const s = makeFrontSandbox({ saretta_api_cache_v1: JSON.stringify(seedObj) });
    test('os/diarias/os_itens seguem cacheados após 2h (TTL longo)', () => {
      assert.equal(vm.runInContext(`API.db.isCached('os')`, s), true);
      assert.equal(vm.runInContext(`API.db.isCached('diarias')`, s), true);
      assert.equal(vm.runInContext(`API.db.isCached('os_itens')`, s), true);
      assert.equal(vm.runInContext(`API.db.isCached('clientes')`, s), true); // referência (já era 30d)
    });
    test('parcelas expira em 1h (não é sheet de trabalho da OS)', () => {
      assert.equal(vm.runInContext(`API.db.isCached('parcelas')`, s), false);
    });
  }

  console.log('\n— OS: tipos (horas/valor) e sessão em aberto —');
  {
    // os.js só declara no load (o IIFE retorna o objeto); osTipo/acharSessaoAberta
    // são puras (Number / Calculator.blocosFromDiaria já em utils) → dá pra testar.
    const s = makeFrontSandbox();
    vm.runInContext(src('assets/js/os.js'), s, { filename: 'os.js' });
    test('osTipo classifica horas/valor (retrocompat orcado_valor)', () => {
      const t = expr => vm.runInContext(`OS.osTipo(${expr})`, s);
      assert.equal(t(`{tipo:'valor'}`), 'valor');
      assert.equal(t(`{tipo:'horas'}`), 'horas');
      assert.equal(t(`{tipo:'normal'}`), 'horas');
      assert.equal(t(`{tipo:'normal', orcado_valor:1500}`), 'valor'); // gerada de orçamento
      assert.equal(t(`{}`), 'horas');
    });
    test('acharSessaoAberta acha a diária com bloco sem fim (ignora fechadas)', () => {
      const diarias = `[
        { id:'d1', os_id:'osX', data:'2026-07-12', blocos_json: JSON.stringify([{inicio:'13:00', fim:'', aberta:true}]) },
        { id:'d2', os_id:'osX', data:'2026-07-11', blocos_json: JSON.stringify([{inicio:'08:00', fim:'11:00'}]) }
      ]`;
      const aberta = vm.runInContext(`OS.acharSessaoAberta(${diarias}, 'osX')`, s);
      assert.ok(aberta, 'deveria achar sessão aberta na osX');
      assert.equal(aberta.diariaId, 'd1');
      assert.equal(aberta.inicio, '13:00');
      const semAberta = vm.runInContext(
        `OS.acharSessaoAberta([{ id:'d2', os_id:'osZ', blocos_json: JSON.stringify([{inicio:'08:00', fim:'11:00'}]) }], 'osZ')`, s);
      assert.equal(semAberta, null);
    });
  }

  console.log('\n— Code.gs: colunas p/ tipos de OS + sessão aberta (sem migração) —');
  {
    const g = makeGsSandbox();
    test('sheet os tem tipo + orcado_valor; diarias tem blocos_json', () => {
      const osH = vm.runInContext(`SHEET_HEADERS.os`, g);
      assert.ok(osH.includes('tipo'), 'os.tipo');
      assert.ok(osH.includes('orcado_valor'), 'os.orcado_valor');
      assert.ok(vm.runInContext(`SHEET_HEADERS.diarias`, g).includes('blocos_json'), 'diarias.blocos_json');
    });
    test('OS de valor fechado: create/read preserva tipo e orcado_valor', () => {
      const r = vm.runInContext(`create('os', { numero:'OS-1', registro:'os', tipo:'valor', orcado_valor:1800, status:'andamento' })`, g);
      const back = vm.runInContext(`read('os', '${r.data.id}').data[0]`, g);
      assert.equal(back.tipo, 'valor');
      assert.equal(Number(back.orcado_valor), 1800);
    });
    test('sessão em aberto: diária com blocos_json sem fim persiste', () => {
      const r = vm.runInContext(`create('diarias', { os_id:'os1', data:'2026-07-12', horas_totais:0, valor_calculado:0, blocos_json: JSON.stringify([{inicio:'13:00',fim:'',aberta:true}]) })`, g);
      const back = vm.runInContext(`read('diarias', '${r.data.id}').data[0]`, g);
      const blocos = JSON.parse(back.blocos_json);
      assert.equal(blocos[0].inicio, '13:00');
      assert.equal(blocos[0].fim, '');
    });
  }

  console.log(`\n${passed} teste(s) OK${process.exitCode ? ' — COM FALHAS' : ''}\n`);
})();
