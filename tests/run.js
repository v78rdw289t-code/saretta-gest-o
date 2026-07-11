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
function makeFrontSandbox() {
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
    await testAsync('AbortError no POST direto vira item "incerto"', async () => {
      s.fetch = async () => { const e = new Error('Aborted'); e.name = 'AbortError'; throw e; };
      const r = await vm.runInContext(
        `API.post('create', { sheet: 'diarias', data: { c: 3 } })`, s);
      assert.equal(r.queued, true);
      assert.equal(vm.runInContext('Outbox.pendentes()', s), 0); // incerto ≠ pendente
      assert.equal(vm.runInContext('Outbox.total()', s), 2);     // o "erro" anterior + o incerto
    });
    // v3.6: o flush VERIFICA o incerto por leitura (id do cliente) em vez de
    // deixar parado esperando decisão manual.
    await testAsync('flush verifica incerto: linha CHEGOU → sai da fila sem novo POST', async () => {
      const chamadas = [];
      s.fetch = async (url, opts) => {
        chamadas.push(opts && opts.method === 'POST' ? 'POST' : 'GET');
        // GET read?id=... responde que a linha existe
        return { json: async () => ({ success: true, data: [{ id: 'achou' }] }) };
      };
      await vm.runInContext('Outbox.flush()', s);
      assert.equal(vm.runInContext('Outbox.total()', s), 1); // sobrou só o "erro"
      assert.ok(!chamadas.includes('POST'), 'não reenviou às cegas: ' + chamadas.join(','));
    });
    await testAsync('flush verifica incerto: linha NÃO chegou → volta pendente e reenvia', async () => {
      // recria um incerto
      s.fetch = async () => { const e = new Error('Aborted'); e.name = 'AbortError'; throw e; };
      await vm.runInContext(`API.post('create', { sheet: 'diarias', data: { c: 4 } })`, s);
      const chamadas = [];
      s.fetch = async (url, opts) => {
        const post = !!(opts && opts.method === 'POST');
        chamadas.push(post ? 'POST' : 'GET');
        return { json: async () => (post ? { success: true, data: {} } : { success: true, data: [] }) };
      };
      await vm.runInContext('Outbox.flush()', s);
      assert.deepEqual(chamadas.filter(c => c === 'POST').length, 1, 'reenviou 1 POST');
      assert.equal(vm.runInContext('Outbox.total()', s), 1); // só o "erro" de novo
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

  console.log('\n— v3.6: estoque (saldo inicial, negativo, ajuste direcionado) —');
  {
    const g = makeGsSandbox();
    test('novo item (fluxo v3.6): create qtd 0 + entrada = saldo certo, SEM dobrar', () => {
      const r = vm.runInContext(`create('estoque', { descricao: 'Fita isolante', quantidade: 0,
        valor_unit: 5, unidade: 'un', ativo: true })`, g);
      vm.runInContext(`registrarMovEstoque({ estoque_id: '${r.data.id}', tipo: 'entrada',
        motivo: 'ajuste', quantidade: 10, valor_unit: 5, origem: 'manual', observacoes: 'Saldo inicial' })`, g);
      const e = vm.runInContext(`read('estoque', '${r.data.id}').data[0]`, g);
      assert.equal(Number(e.quantidade), 10); // era 20 com o bug (create 10 + entrada 10)
      assert.equal(Number(e.valor_unit), 5);
    });
    test('saída maior que o disponível → saldo NEGATIVO e razão batendo', () => {
      const r = vm.runInContext(`create('estoque', { descricao: 'Cabo 2mm', quantidade: 5,
        valor_unit: 10, unidade: 'm', ativo: true })`, g);
      const s = vm.runInContext(`registrarMovEstoque({ estoque_id: '${r.data.id}', tipo: 'saida',
        motivo: 'perda', quantidade: 8, origem: 'manual' })`, g);
      assert.equal(s.quantidade, -3); // antes clampava em 0 e a perda inflava
      const mov = vm.runInContext(`read('estoque_movimentacoes').data`, g)
        .filter(m => m.estoque_id === r.data.id)[0];
      assert.equal(Number(mov.quantidade), 8);
      assert.equal(Number(mov.valor_total), 80);
    });
    test('ajuste grava direção: diminuir = saída, aumentar = entrada (motivo ajuste)', () => {
      const r = vm.runInContext(`create('estoque', { descricao: 'Parafuso', quantidade: 10,
        valor_unit: 1, unidade: 'un', ativo: true })`, g);
      vm.runInContext(`registrarMovEstoque({ estoque_id: '${r.data.id}', tipo: 'ajuste',
        nova_quantidade: 7, origem: 'inventario' })`, g);
      vm.runInContext(`registrarMovEstoque({ estoque_id: '${r.data.id}', tipo: 'ajuste',
        nova_quantidade: 12, origem: 'inventario' })`, g);
      const movs = vm.runInContext(`read('estoque_movimentacoes').data`, g)
        .filter(m => m.estoque_id === r.data.id);
      assert.deepEqual(movs.map(m => [m.tipo, Number(m.quantidade), m.motivo]),
        [['saida', 3, 'ajuste'], ['entrada', 5, 'ajuste']]);
      const e = vm.runInContext(`read('estoque', '${r.data.id}').data[0]`, g);
      assert.equal(Number(e.quantidade), 12);
    });
  }

  console.log('\n— v3.6: vencimento mensal com clamp de dia —');
  {
    const g = makeGsSandbox();
    test('_addMesesClamp: 31/01 + 1 = 28/02 (29/02 em bissexto), + 2 = 31/03', () => {
      assert.equal(vm.runInContext(`_addMesesClamp('2026-01-31', 1)`, g), '2026-02-28');
      assert.equal(vm.runInContext(`_addMesesClamp('2024-01-31', 1)`, g), '2024-02-29');
      assert.equal(vm.runInContext(`_addMesesClamp('2026-01-31', 2)`, g), '2026-03-31');
      assert.equal(vm.runInContext(`_addMesesClamp('2026-01-15', 1)`, g), '2026-02-15');
      assert.equal(vm.runInContext(`_addMesesClamp('2026-01-31', 0)`, g), '2026-01-31');
    });
    test('registrarCompra parcelada: vencimentos não pulam mês (31/01 → 28/02 → 31/03)', () => {
      vm.runInContext(`registrarCompra({ fornecedor_id: '', data: '2026-01-31',
        desconto: 0, parcelas_count: 3, primeira_data_vencimento: '2026-01-31',
        data_competencia: '2026-01-01',
        itens: [{ descricao: 'Areia', quantidade: 3, valor_unit: 100, valor_total: 300, unidade: 'sc' }] })`, g);
      const vencs = vm.runInContext(`read('parcelas').data`, g)
        .filter(p => p.origem === 'compra').map(p => p.data_vencimento);
      assert.deepEqual(vencs, ['2026-01-31', '2026-02-28', '2026-03-31']);
    });
    test('DateUtil.addMonths (frontend) clampa igual', () => {
      const s = makeFrontSandbox();
      assert.equal(vm.runInContext(`DateUtil.addMonths('2026-01-31', 1)`, s), '2026-02-28');
      assert.equal(vm.runInContext(`DateUtil.addMonths('2026-03-31', -1)`, s), '2026-02-28');
      assert.equal(vm.runInContext(`DateUtil.addMonths('2025-11-15', 3)`, s), '2026-02-15');
    });
  }

  console.log('\n— v3.7: valor combinado (orçamento fechado) —');
  {
    const s = makeFrontSandbox();
    test('combinadoInfo: número, string, bool do Sheets e vazio', () => {
      assert.deepEqual(vm.runInContext(
        `Calculator.combinadoInfo({ valor_combinado: 5000, materiais_inclusos: true })`, s),
        { combinado: 5000, inclusos: true });
      assert.deepEqual(vm.runInContext(
        `Calculator.combinadoInfo({ valor_combinado: '5000', materiais_inclusos: 'true' })`, s),
        { combinado: 5000, inclusos: true });
      assert.deepEqual(vm.runInContext(`Calculator.combinadoInfo({})`, s),
        { combinado: 0, inclusos: false });
    });
    test('baseFechamento: à parte soma itens, inclusos não, sem combinado = horas', () => {
      const aParte = vm.runInContext(
        `Calculator.baseFechamento({ valor_combinado: 5000 }, 2000, 800)`, s);
      assert.equal(aParte.base, 5800);
      assert.equal(aParte.referencia, 2800);
      const incluso = vm.runInContext(
        `Calculator.baseFechamento({ valor_combinado: 5000, materiais_inclusos: 'true' }, 2000, 800)`, s);
      assert.equal(incluso.base, 5000);
      const normal = vm.runInContext(`Calculator.baseFechamento({}, 2000, 800)`, s);
      assert.equal(normal.base, 2800);
      assert.equal(normal.referencia, 2800);
    });
    test('resolverFechamento: desconto R$/%, sobrescrever vence a base', () => {
      assert.deepEqual(vm.runInContext(`Calculator.resolverFechamento(5800, 0, 300, 'valor')`, s),
        { base: 5800, descontoAbs: 300, liquido: 5500 });
      assert.deepEqual(vm.runInContext(`Calculator.resolverFechamento(5800, 0, 10, 'perc')`, s),
        { base: 5800, descontoAbs: 580, liquido: 5220 });
      assert.deepEqual(vm.runInContext(`Calculator.resolverFechamento(5800, 6000, 10, 'perc')`, s),
        { base: 6000, descontoAbs: 600, liquido: 5400 });
      assert.equal(vm.runInContext(`Calculator.resolverFechamento(100, 0, 200, 'valor')`, s).liquido, 0);
    });
    test('valorPipelineOS: combinada sem sessão ≠ 0; combinada com sessões usa o combinado', () => {
      assert.equal(vm.runInContext(`Calculator.valorPipelineOS({ valor_combinado: 5000 }, [])`, s), 5000);
      assert.equal(vm.runInContext(
        `Calculator.valorPipelineOS({ valor_combinado: 5000 }, [{ valor_calculado: 900 }])`, s), 5000);
      assert.equal(vm.runInContext(
        `Calculator.valorPipelineOS({}, [{ valor_calculado: 900 }, { valor_manual: 300 }])`, s), 1200);
    });
  }
  {
    const g = makeGsSandbox();
    test('sheet os tem as colunas novas e create/read as preservam', () => {
      const headers = vm.runInContext(`SHEET_HEADERS.os`, g);
      assert.ok(headers.includes('valor_combinado') && headers.includes('materiais_inclusos'));
      const r = vm.runInContext(`create('os', { numero: 'OS-900', cliente_id: 'c1', status: 'andamento',
        valor_combinado: 5000, materiais_inclusos: false })`, g);
      const rec = vm.runInContext(`read('os', '${r.data.id}').data[0]`, g);
      assert.equal(Number(rec.valor_combinado), 5000);
      assert.equal(String(rec.materiais_inclusos), 'false');
    });
    test('fecharOS segue agnóstico: recebe líquido pronto e gera parcela igual', () => {
      vm.runInContext(`create('clientes', { id: 'c1', nome: 'Cliente Teste' })`, g);
      const os = vm.runInContext(`create('os', { numero: 'OS-901', cliente_id: 'c1', status: 'andamento',
        valor_combinado: 5000, materiais_inclusos: false })`, g);
      const r = vm.runInContext(
        `fecharOS({ os_id: '${os.data.id}', valor_bruto: 5800, desconto: 300, valor_liquido: 5500,
          data_competencia: '2026-07-01', data_vencimento: '2026-07-20', categoria_id: '', diaria_ids: [] })`, g);
      assert.equal(r.success, true);
      const parc = vm.runInContext(`read('parcelas').data`, g)
        .find(p => p.origem === 'os' && p.origem_id === os.data.id);
      assert.equal(Number(parc.valor), 5500);
      const osRec = vm.runInContext(`read('os', '${os.data.id}').data[0]`, g);
      assert.equal(osRec.status, 'fechado');
      assert.equal(Number(osRec.valor_fechamento), 5500);
    });
  }

  console.log('\n— v3.8: grupos no estoque + status orçamento —');
  {
    const g = makeGsSandbox();
    test('sheet estoque tem coluna grupo e create/read preservam', () => {
      assert.ok(vm.runInContext(`SHEET_HEADERS.estoque`, g).includes('grupo'));
      const r = vm.runInContext(`create('estoque', { descricao: 'Parafuso M6', grupo: 'Parafuso',
        quantidade: 10, valor_unit: 0.5, unidade: 'un', ativo: true })`, g);
      assert.equal(vm.runInContext(`read('estoque', '${r.data.id}').data[0]`, g).grupo, 'Parafuso');
    });
    const s = makeFrontSandbox();
    test('statusBadge inclui orçamento (aba/detalhe da OS)', () => {
      const b = vm.runInContext(`statusBadge('orcamento')`, s);
      assert.ok(/badge-gold/.test(b) && /Or.amento/.test(b));
      assert.ok(/badge-info/.test(vm.runInContext(`statusBadge('andamento')`, s)));
    });
  }

  console.log(`\n${passed} teste(s) OK${process.exitCode ? ' — COM FALHAS' : ''}\n`);
})();
