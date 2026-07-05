// ============================================================
// Mock do /exec pro preview local — carrega o Code.gs REAL num
// sandbox (SpreadsheetApp fake em memória), então create idempotente,
// readMany, gerarRecorrentes etc. se comportam como em produção.
// Rodar: node tests/mock-server.js   (porta 5502)
//   GET  /__down   → alterna modo "rede caída" (socket destruído)
//   GET  /__state  → dump das sheets em memória
// ============================================================
const http = require('node:http');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

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
  const hoje = new Date();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const sandbox = {
    console, JSON, Math, Date, Array, Object, String, Number, RegExp,
    __sheets: sheets,
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => sheets[n] || (sheets[n] = makeSheet()) }) },
    Utilities: { getUuid: () => 'srv-' + (++uuidN), formatDate: () => mesAtual },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    // respond() devolve o próprio objeto (ContentService fake)
    ContentService: { createTextOutput: t => ({ setMimeType: () => JSON.parse(t) }), MimeType: { JSON: 'json' } },
    DriveApp: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script/Code.gs'), 'utf8'), sandbox, { filename: 'Code.gs' });
  return sandbox;
}

const g = makeGsSandbox();
const create = vm.runInContext('create', g);
const doGet  = vm.runInContext('doGet', g);
const doPost = vm.runInContext('doPost', g);

// ─── Seeds ───────────────────────────────────────────────────
const hoje = new Date().toISOString().substring(0, 10);
const mes  = hoje.substring(0, 7);
[
  ['config',     { chave: 'valor_hora_manutencao', valor: 155, descricao: '' }],
  ['config',     { chave: 'empresa_nome', valor: 'Saretta Serviços', descricao: '' }],
  ['clientes',   { nome: 'João da Silva', tipo: 'cliente', telefone: '54 9999-0000', endereco: 'Rua A, 10', observacoes: '', data_cadastro: hoje, ativo: true }],
  ['clientes',   { nome: 'Mercado Central', tipo: 'fornecedor', telefone: '', endereco: '', observacoes: '', data_cadastro: hoje, ativo: true }],
  ['categorias', { nome: 'Serviços Elétricos', tipo: 'entrada', ativo: true }],
  ['categorias', { nome: 'Aluguel/Estrutura', tipo: 'saida', ativo: true }],
  ['categorias', { nome: 'Material/Estoque', tipo: 'saida', ativo: true }],
  ['contas',     { nome: 'Banco', saldo_inicial: 1000, ativo: true, ordem: 1, observacoes: '' }],
  ['estoque',    { descricao: 'Fita isolante', quantidade: 5, valor_unit: 8, fornecedor_id: '', unidade: 'un', observacoes: '', data_entrada: hoje, ativo: true, categoria_id: '', estoque_minimo: 2 }],
  ['parcelas',   { tipo: 'receber', origem: 'manual', origem_id: '', grupo_id: '', cliente_id: 'srv-3', descricao: 'Serviço avulso', valor: 500, data_competencia: mes + '-01', data_vencimento: hoje, data_pagamento: '', status: 'pendente', categoria_id: 'srv-5', conta_id: '', observacoes: '' }],
].forEach(([sheet, data]) => create(sheet, data));
// OS em andamento do João (cliente_id do seed acima = srv-3)
create('os', { numero: 'OS-101', nome: 'Reforma elétrica', tipo: 'diaria', cliente_id: 'srv-3',
  categoria_id: 'srv-5', status: 'andamento', data_inicio: hoje, data_fim: '',
  horas_calculadas: 0, valor_calculado: 0, valor_fechamento: '', observacoes: '',
  data_criacao: hoje, data_atualizacao: hoje });

// ─── HTTP ────────────────────────────────────────────────────
let down = false;
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/__down')) {
    down = !down;
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' });
    res.end('down=' + down);
    console.log('[mock] modo rede-caída:', down);
    return;
  }
  if (down) { req.socket.destroy(); return; } // simula queda real de rede

  const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
  if (req.url.startsWith('/__state')) {
    const dump = {};
    Object.entries(g.__sheets).forEach(([n, s]) => { dump[n] = s.rows; });
    res.writeHead(200, headers);
    res.end(JSON.stringify(dump, null, 2));
    return;
  }

  if (req.method === 'GET') {
    const u = new URL(req.url, 'http://localhost');
    const out = doGet({ parameter: Object.fromEntries(u.searchParams) });
    res.writeHead(200, headers);
    res.end(JSON.stringify(out));
    console.log('[mock] GET', u.searchParams.get('action'), u.searchParams.get('sheet') || u.searchParams.get('sheets') || '');
    return;
  }

  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    let out;
    try { out = doPost({ postData: { contents: body } }); }
    catch (e) { out = { success: false, error: String(e) }; }
    const parsed = (() => { try { return JSON.parse(body); } catch { return {}; } })();
    console.log('[mock] POST', parsed.action, parsed.sheet || '', parsed.data?.id || parsed.id || '');
    res.writeHead(200, headers);
    res.end(JSON.stringify(out));
  });
});
server.listen(5502, () => console.log('[mock] /exec fake em http://localhost:5502 (GET /__down alterna queda de rede)'));
