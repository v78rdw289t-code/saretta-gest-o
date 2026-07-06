// ============================================================
// SARETTA SERVIÇOS - BACKEND (Google Apps Script)
// Preencha SPREADSHEET_ID após criar a planilha
// ============================================================

const SPREADSHEET_ID = ''; // <- PREENCHA COM O ID DA PLANILHA

// ─── SEGURANÇA ───────────────────────────────────────────────
// O token de acesso NÃO fica no código (assim não vaza no repositório).
// Defina-o nas PROPRIEDADES DO SCRIPT:
//   Apps Script → ⚙ Configurações do projeto → Propriedades do script →
//   Adicionar propriedade:  nome = API_TOKEN   valor = (seu token secreto)
// e cadastre o MESMO valor em Configurações → Conexão no app.
// Enquanto a propriedade ficar vazia/ausente, o acesso continua aberto
// (compatível com versões antigas). Mudar o valor da propriedade vale na
// hora — não precisa republicar de novo (só republique 1x p/ subir ESTE código).
function getApiToken() {
  try {
    return (PropertiesService.getScriptProperties().getProperty('API_TOKEN') || '').trim();
  } catch (e) {
    return '';
  }
}

function checkAuth(token) {
  const apiToken = getApiToken();
  if (!apiToken) return;                   // token não definido → acesso aberto (retrocompat)
  // .trim() dos DOIS lados: robusto a espaço/quebra-de-linha colado sem querer
  // (o app já faz trim no setToken; aqui garante que o backend também faça).
  if (String(token || '').trim() !== apiToken) throw new Error('Não autorizado (token inválido)');
}

const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

const SHEET_HEADERS = {
  config:         ['id','chave','valor','descricao'],
  clientes:       ['id','nome','tipo','telefone','endereco','observacoes','data_cadastro','ativo'],
  categorias:     ['id','nome','tipo','ativo'],
  os:             ['id','numero','nome','tipo','cliente_id','categoria_id','status','data_inicio','data_fim','horas_calculadas','valor_calculado','valor_fechamento','observacoes','data_criacao','data_atualizacao'],
  os_itens:       ['id','os_id','tipo','descricao','estoque_id','quantidade','valor_unit','valor_total'],
  diarias:        ['id','os_id','categoria_id','data','manha_inicio','manha_fim','tarde_inicio','tarde_fim','horas_totais','valor_calculado','valor_manual','observacoes','reajuste_json','blocos_json'],
  fechamentos:    ['id','os_id','data','valor_bruto','desconto','valor_liquido','observacoes'],
  fechamento_dias:['id','fechamento_id','diaria_id'],
  // Fechamento em lote (várias OS → 1 parcela): uma linha por OS do lote,
  // com o líquido (snapshot) daquela OS. Categoria NÃO é gravada — é resolvida
  // dinâmica por OS via categoriaEfetivaId no frontend (categoria segue a OS).
  fechamento_os:  ['id','fechamento_id','os_id','valor_liq'],
  parcelas:       ['id','tipo','origem','origem_id','grupo_id','cliente_id','descricao','valor','data_competencia','data_vencimento','data_pagamento','status','categoria_id','conta_id','observacoes'],
  contas:         ['id','nome','saldo_inicial','ativo','ordem','observacoes'],
  fiado:          ['id','pessoa','descricao','valor','data','parcela_pagar_id','status','observacoes'],
  estoque:        ['id','descricao','quantidade','valor_unit','fornecedor_id','unidade','observacoes','data_entrada','ativo','categoria_id','estoque_minimo'],
  compras:        ['id','fornecedor_id','data','valor_total','valor_bruto','desconto','parcela_id','observacoes'],
  compras_itens:  ['id','compra_id','descricao','estoque_id','categoria_id','quantidade','valor_unit','valor_liq','valor_total'],
  lista_compras:  ['id','cliente_id','descricao','quantidade','unidade','estoque_id','status','data_criacao'],
  // Razão (extrato) do estoque: toda entrada/saída/ajuste vira uma linha aqui.
  // tipo: entrada|saida|ajuste · motivo: compra|uso_os|uso_interno|perda|ajuste|devolucao
  // origem: compra|os|manual|inventario · origem_id: id da compra/OS (quando houver)
  estoque_movimentacoes: ['id','estoque_id','tipo','motivo','quantidade','valor_unit','valor_total','origem','origem_id','data','observacoes'],
  // Razão (extrato/ficha) da conta-corrente de cada sócio.
  // direcao: empresa_deve (+, a empresa deve ao sócio) | socio_deve (−, o sócio deve à empresa)
  // motivo: despesa_bolso | emprestimo | acerto | ajuste · status: ativo | acertado
  fiado_mov:      ['id','pessoa','data','direcao','motivo','descricao','valor','parcela_id','conta_id','status','grupo_id','observacoes'],
  // Contas fixas (aluguel, luz...): cadastro-mestre; a parcela do mês nasce via
  // gerarRecorrentes (origem='recorrente'). ultima_geracao = 'yyyy-MM' do último
  // mês já gerado (vazio = nunca gerou; a geração NÃO retroage antes do cadastro).
  // tipo: v1 só 'pagar' (coluna existe p/ um futuro 'receber' sem migração).
  recorrentes:    ['id','descricao','tipo','valor','categoria_id','cliente_id','dia_vencimento','ativo','ultima_geracao','observacoes','data_criacao'],
  // Agenda: visitas/compromissos agendados. CRUD genérico (sem action própria).
  // tipo: visita|orcamento|compromisso|lembrete · status: agendado|feito|cancelado
  // cliente_id/os_id opcionais (linka a um cliente e/ou OS). ordem: desempate no dia.
  compromissos:   ['id','data','hora_inicio','hora_fim','tipo','titulo','cliente_id','os_id','status','ordem','observacoes','data_criacao','data_atualizacao'],
};

// ─── ROTEADOR ────────────────────────────────────────────────
function doGet(e) {
  const params = e.parameter;
  try {
    checkAuth(params.token);
    const action = params.action;
    let result;
    if (action === 'read')           result = read(params.sheet, params.id || null, parseFilters(params));
    else if (action === 'readMany')  result = readMany(params.sheets);
    else if (action === 'initDB')    result = initializeSheets();
    else if (action === 'stats')     result = getDashboardStats();
    else if (action === 'repairDB')  result = repairParcelasContaId();
    else result = { success: false, error: 'Ação inválida' };
    return respond(result);
  } catch (err) {
    return respond({ success: false, error: err.toString() });
  }
}

function doPost(e) {
  // Trava de concorrência: escritas rodam UMA por vez. Sem isso, dois cliques
  // quase simultâneos podem passar juntos pelas checagens de "já fechado"
  // (check-then-write) e duplicar parcela/fechamento.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return respond({ success: false, error: 'Servidor ocupado — tente de novo em instantes' });
  }
  try {
    const data = JSON.parse(e.postData.contents);
    checkAuth(data.token);
    const action = data.action;
    let result;
    switch (action) {
      case 'create':          result = create(data.sheet, data.data); break;
      case 'update':          result = update(data.sheet, data.id, data.data); break;
      case 'delete':          result = remove(data.sheet, data.id); break;
      case 'batch':           result = batch(data.operations); break;
      case 'fecharOS':        result = fecharOS(data); break;
      case 'fecharOSLote':    result = fecharOSLote(data); break;
      case 'registrarCompra': result = registrarCompra(data); break;
      case 'registrarMovEstoque': result = registrarMovEstoque(data); break;
      case 'registrarFiado':  result = registrarFiado(data); break;
      case 'registrarEmprestimoSocio': result = registrarEmprestimoSocio(data); break;
      case 'registrarFiadoMovManual':  result = registrarFiadoMovManual(data); break;
      case 'acertarFiado':    result = acertarFiado(data); break;
      case 'pagarParcela':      result = pagarParcela(data); break;
      case 'excluirLancamento': result = excluirLancamento(data.parcela_id); break;
      case 'excluirOS':         result = excluirOS(data.id); break;
      case 'gerarRecorrentes':  result = gerarRecorrentes(data); break;
      default:                result = { success: false, error: 'Ação inválida' };
    }
    return respond(result);
  } catch (err) {
    return respond({ success: false, error: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

function respond(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseFilters(params) {
  const filters = {};
  // 'token' é metadado de autenticação, NÃO um filtro de coluna — senão todo
  // read com token autenticado filtra por uma coluna inexistente e volta vazio.
  const skip = ['action', 'sheet', 'id', 'token'];
  Object.keys(params).forEach(k => {
    if (!skip.includes(k)) filters[k] = params[k];
  });
  return Object.keys(filters).length > 0 ? filters : null;
}

// ─── CRUD GENÉRICO ───────────────────────────────────────────
function getSheet(name) {
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Planilha não encontrada: ' + name);
  return sh;
}

function sheetToRecords(sh) {
  const all = sh.getDataRange().getValues();
  if (all.length < 2) return [];
  const headers = all[0];
  return all.slice(1).reduce((acc, row) => {
    if (row[0]) {
      const rec = {};
      headers.forEach((h, i) => { rec[h] = row[i] === '' ? null : row[i]; });
      acc.push(rec);
    }
    return acc;
  }, []);
}

function read(sheetName, id = null, filters = null) {
  const sh = getSheet(sheetName);
  let records = sheetToRecords(sh);
  if (id) records = records.filter(r => String(r.id) === String(id));
  if (filters) {
    Object.entries(filters).forEach(([k, v]) => {
      records = records.filter(r => String(r[k]) === String(v));
    });
  }
  return { success: true, data: records };
}

// Lê VÁRIAS sheets numa única requisição: ?action=readMany&sheets=os,parcelas,...
// Cada chamada ao /exec custa ~1-3s (redirect + partida do Apps Script), então
// o app junta os reads de uma tela num GET só. Regras:
//  - só sheets conhecidas (SHEET_HEADERS) — nome estranho volta [] em vez de erro;
//  - sheet ainda não criada (initDB pendente) volta [] em vez de derrubar o lote.
function readMany(sheetsParam) {
  const names = String(sheetsParam || '').split(',').map(s => s.trim()).filter(Boolean);
  if (names.length === 0) return { success: false, error: 'Nenhuma sheet solicitada' };
  const data = {};
  names.forEach(name => {
    if (!SHEET_HEADERS[name]) { data[name] = []; return; }
    try { data[name] = sheetToRecords(getSheet(name)); }
    catch (e) { data[name] = []; }
  });
  return { success: true, data };
}

function create(sheetName, data) {
  const sh = getSheet(sheetName);
  // Lê os cabeçalhos REAIS da planilha (pós-migração a ordem pode diferir de SHEET_HEADERS).
  // Consistente com update(), que também lê headers da planilha em vez de SHEET_HEADERS.
  const all = sh.getDataRange().getValues();
  let headers;
  if (all.length >= 1 && all[0][0]) {
    headers = all[0];
  } else {
    // Planilha vazia: inicializa cabeçalhos a partir de SHEET_HEADERS
    headers = SHEET_HEADERS[sheetName];
    if (!headers) throw new Error('Headers não definidos para: ' + sheetName);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  // Id de idempotência vindo do cliente (caderneta offline): se o app mandou
  // um UUID em data.id, ele é respeitado — e se a linha JÁ existe (reenvio de
  // um POST que na verdade tinha chegado, ex.: timeout ambíguo), vira no-op em
  // vez de duplicar. O doPost roda sob LockService, então o check-then-append
  // é atômico. Sem id do cliente, comportamento antigo (UUID do servidor).
  const clientId = (typeof data.id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.id)) ? data.id : '';
  if (clientId) {
    const idIdx = headers.indexOf('id');
    for (let i = 1; i < all.length; i++) {
      if (String(all[i][idIdx]) === clientId) {
        const rec = {};
        headers.forEach((h, j) => { rec[h] = all[i][j]; });
        return { success: true, data: rec, jaExiste: true };
      }
    }
    data.id = clientId;
  } else {
    data.id = Utilities.getUuid();
  }
  const row = headers.map(h => (h && data[h] !== undefined) ? data[h] : '');
  sh.appendRow(row);
  return { success: true, data: { ...data } };
}

function update(sheetName, id, data) {
  const sh = getSheet(sheetName);
  const all = sh.getDataRange().getValues();
  const headers = all[0];
  const idIdx = headers.indexOf('id');
  for (let i = 1; i < all.length; i++) {
    if (String(all[i][idIdx]) === String(id)) {
      headers.forEach((h, j) => {
        if (data[h] !== undefined) sh.getRange(i + 1, j + 1).setValue(data[h]);
      });
      return { success: true };
    }
  }
  return { success: false, error: 'Registro não encontrado' };
}

function remove(sheetName, id) {
  const sh = getSheet(sheetName);
  const all = sh.getDataRange().getValues();
  const idIdx = all[0].indexOf('id');
  for (let i = all.length - 1; i >= 1; i--) {
    if (String(all[i][idIdx]) === String(id)) {
      sh.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: 'Registro não encontrado' };
}

function batch(operations) {
  const results = [];
  operations.forEach(op => {
    try {
      let r;
      if (op.action === 'create')      r = create(op.sheet, op.data);
      else if (op.action === 'update') r = update(op.sheet, op.id, op.data);
      else if (op.action === 'delete') r = remove(op.sheet, op.id);
      results.push(r);
    } catch (e) {
      results.push({ success: false, error: e.toString() });
    }
  });
  return { success: true, results };
}

// ─── CONTAS FIXAS RECORRENTES ────────────────────────────────
// Meses 'yyyy-MM' APÓS depoisDe (exclusivo) até ate (inclusivo).
// depoisDe vazio/inválido → só [ate]: recorrente recém-cadastrada gera o mês
// corrente e NÃO retroage; depois disso o catch-up cobre meses pulados
// (app fechado o mês inteiro → aluguel do mês pulado entra mesmo assim).
function _mesesEntre(depoisDe, ate) {
  if (!/^\d{4}-\d{2}$/.test(String(ate || ''))) return [];
  if (!/^\d{4}-\d{2}$/.test(String(depoisDe || ''))) return [ate];
  if (String(depoisDe) >= String(ate)) return [];
  const out = [];
  let y = Number(String(depoisDe).slice(0, 4)), m = Number(String(depoisDe).slice(5, 7));
  const ay = Number(String(ate).slice(0, 4)), am = Number(String(ate).slice(5, 7));
  while (y < ay || (y === ay && m < am)) {
    m++; if (m > 12) { m = 1; y++; }
    out.push(y + '-' + ('0' + m).slice(-2));
  }
  return out;
}

// Vencimento no mês com o dia clampado no último dia (31 → 28/29/30).
function _vencNoMes(mes, dia) {
  const y = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7));
  const ultimo = new Date(y, m, 0).getDate();
  const d = Math.max(1, Math.min(ultimo, parseInt(dia, 10) || 1));
  return mes + '-' + ('0' + d).slice(-2);
}

// Gera as parcelas pendentes das contas fixas até data.mes (ou o mês do
// servidor). Idempotente: ultima_geracao marca até onde já foi e o doPost
// roda sob LockService — dois boots simultâneos não duplicam.
function gerarRecorrentes(data) {
  const mesAtual = /^\d{4}-\d{2}$/.test(String(data.mes || ''))
    ? String(data.mes)
    : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
  const recs = read('recorrentes').data;
  let geradas = 0;
  recs.forEach(rec => {
    if (rec.ativo === false || rec.ativo === 'false') return;
    const meses = _mesesEntre(rec.ultima_geracao, mesAtual);
    if (!meses.length) return;
    meses.forEach(mes => {
      create('parcelas', {
        tipo: rec.tipo || 'pagar',
        origem: 'recorrente',
        origem_id: rec.id,
        grupo_id: '',
        cliente_id: rec.cliente_id || '',
        descricao: rec.descricao,
        valor: rec.valor,
        data_competencia: mes + '-01',
        data_vencimento: _vencNoMes(mes, rec.dia_vencimento),
        data_pagamento: '',
        status: 'pendente',
        categoria_id: rec.categoria_id || '',
        conta_id: '',
        observacoes: rec.observacoes || '',
      });
      geradas++;
    });
    update('recorrentes', rec.id, { ultima_geracao: mesAtual });
  });
  return { success: true, geradas: geradas };
}

// ─── OPERAÇÕES COMPLEXAS ─────────────────────────────────────

function fecharOS(data) {
  // data: { os_id, valor_bruto, desconto, valor_liquido, data_vencimento,
  //         data_competencia, categoria_id, diaria_ids, observacoes }
  // Idempotência: fechar 2x a mesma OS (clique duplo) geraria 2 fechamentos
  // e 2 parcelas — a 2ª chamada é recusada aqui.
  const osCheck = read('os', data.os_id).data[0];
  if (!osCheck) return { success: false, error: 'OS não encontrada' };
  if (String(osCheck.status) === 'fechado') {
    return { success: false, error: 'Esta OS já foi fechada — a parcela já existe no Financeiro.', jaFechada: true };
  }
  const fechamentoData = {
    os_id:         data.os_id,
    data:          Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    valor_bruto:   data.valor_bruto,
    desconto:      data.desconto || 0,
    valor_liquido: data.valor_liquido,
    observacoes:   data.observacoes || '',
  };
  const fechamento = create('fechamentos', fechamentoData);
  const fechId = fechamento.data.id;

  // Relacionar dias (se diária)
  if (data.diaria_ids && data.diaria_ids.length > 0) {
    data.diaria_ids.forEach(did => create('fechamento_dias', { fechamento_id: fechId, diaria_id: did }));
  }

  // Buscar info da OS para montar parcela
  const osRec = read('os', data.os_id).data[0];
  const clienteRec = osRec ? read('clientes', osRec.cliente_id).data[0] : null;
  const clienteNome = clienteRec ? clienteRec.nome : '';

  const parcelaData = {
    tipo:            'receber',
    origem:          'os',
    origem_id:       data.os_id,
    cliente_id:      osRec ? osRec.cliente_id : '',
    descricao:       'OS #' + (osRec ? osRec.numero : '') + ' - ' + clienteNome,
    valor:           data.valor_liquido,
    data_competencia:data.data_competencia,
    data_vencimento: data.data_vencimento,
    data_pagamento:  '',
    status:          'pendente',
    categoria_id:    data.categoria_id || '',
    observacoes:     data.observacoes || '',
  };
  const parcela = create('parcelas', parcelaData);

  // Atualizar status da OS
  update('os', data.os_id, { status: 'fechado', valor_fechamento: data.valor_liquido, data_fim: new Date().toISOString().substring(0,10), data_atualizacao: new Date().toISOString() });

  return { success: true, fechamento_id: fechId, parcela_id: parcela.data.id };
}

function fecharOSLote(data) {
  // Fechamento em lote: várias OS do mesmo cliente → 1 fechamento + 1 parcela.
  // data: { cliente_id, itens: [{os_id, valor_bruto, valor_liquido, diaria_ids:[]}],
  //         valor_bruto_total, desconto, valor_liquido_total,
  //         data_competencia, data_vencimento, categoria_id, observacoes }
  const itens = data.itens || [];
  if (itens.length === 0) return { success: false, error: 'Nenhuma OS no lote' };

  // Idempotência: se QUALQUER OS do lote já está fechada (clique duplo ou
  // lote repetido), recusa tudo antes de criar qualquer registro.
  const jaFechadas = [];
  itens.forEach(it => {
    const osCheck = read('os', it.os_id).data[0];
    if (osCheck && String(osCheck.status) === 'fechado') jaFechadas.push(osCheck.numero || it.os_id);
  });
  if (jaFechadas.length > 0) {
    return { success: false, error: 'OS já fechada(s): ' + jaFechadas.join(', ') + ' — o lote não foi repetido.', jaFechada: true };
  }

  const fechamento = create('fechamentos', {
    os_id:         '', // lote não pertence a uma OS única; vínculo fica em fechamento_os
    data:          Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    valor_bruto:   data.valor_bruto_total,
    desconto:      data.desconto || 0,
    valor_liquido: data.valor_liquido_total,
    observacoes:   data.observacoes || '',
  });
  const fechId = fechamento.data.id;

  const numeros = [];
  const hoje = new Date().toISOString().substring(0, 10);
  itens.forEach(it => {
    create('fechamento_os', { fechamento_id: fechId, os_id: it.os_id, valor_liq: it.valor_liquido });
    (it.diaria_ids || []).forEach(did => create('fechamento_dias', { fechamento_id: fechId, diaria_id: did }));
    const osRec = read('os', it.os_id).data[0];
    // numero já vem como 'OS-101' → vira '#101' (descrição curta: "OS #101, #102 - Cliente")
    if (osRec) numeros.push('#' + String(osRec.numero || '').replace(/^OS-?/i, ''));
    update('os', it.os_id, { status: 'fechado', valor_fechamento: it.valor_liquido, data_fim: hoje, data_atualizacao: new Date().toISOString() });
  });

  const clienteRec = data.cliente_id ? read('clientes', data.cliente_id).data[0] : null;
  const clienteNome = clienteRec ? clienteRec.nome : '';

  const parcela = create('parcelas', {
    tipo:            'receber',
    origem:          'os_lote',
    origem_id:       fechId,
    cliente_id:      data.cliente_id || '',
    descricao:       'OS ' + numeros.join(', ') + ' - ' + clienteNome,
    valor:           data.valor_liquido_total,
    data_competencia:data.data_competencia,
    data_vencimento: data.data_vencimento,
    data_pagamento:  '',
    status:          'pendente',
    categoria_id:    data.categoria_id || '',
    observacoes:     data.observacoes || '',
  });

  return { success: true, fechamento_id: fechId, parcela_id: parcela.data.id };
}

function registrarCompra(data) {
  // data: { fornecedor_id, data, valor_total (líquido), desconto, parcelas_count,
  //         primeira_data_vencimento, data_competencia, categoria_id (fallback p/ parcela),
  //         quem_pagou (opcional),
  //         itens: [{descricao, estoque_id, categoria_id, quantidade, valor_unit, valor_total, unidade}],
  //         observacoes }
  const itens = data.itens || [];
  // Bruto = soma dos itens; líquido = com o desconto da compra aplicado.
  const bruto = itens.reduce((s, it) =>
    s + Number(it.valor_total || (Number(it.quantidade || 0) * Number(it.valor_unit || 0))), 0);
  const desconto = Number(data.desconto || 0);
  const liquido = (data.valor_total !== undefined && data.valor_total !== '')
    ? Number(data.valor_total)
    : Math.max(0, bruto - desconto);
  // Fator de rateio: cada item carrega sua fatia proporcional do desconto.
  const ratio = bruto > 0 ? (liquido / bruto) : 1;

  const compra = create('compras', {
    fornecedor_id: data.fornecedor_id,
    data:          data.data,
    valor_total:   liquido,
    valor_bruto:   bruto,
    desconto:      desconto,
    observacoes:   data.observacoes || '',
  });
  const compraId = compra.data.id;

  // Soma o valor líquido por categoria de item → categoria dominante (vai na parcela).
  const catTotais = {};

  // Itens da compra + entrada no estoque (custo médio ponderado) + movimentação
  itens.forEach(item => {
    const qtd       = Number(item.quantidade || 0);
    const brutoItem = Number(item.valor_total || (qtd * Number(item.valor_unit || 0)));
    const liqItem   = Math.round(brutoItem * ratio * 100) / 100;          // já com desconto rateado
    const custoUnit = qtd > 0 ? Math.round((liqItem / qtd) * 100) / 100 : liqItem; // custo real unitário
    const catItem   = item.categoria_id || '';
    if (catItem) catTotais[catItem] = (catTotais[catItem] || 0) + liqItem;

    // Resolve o item de estoque: vinculado, ou casa por descrição+unidade, ou cria novo.
    let estId  = item.estoque_id || '';
    let estRec = estId ? read('estoque', estId).data[0] : _acharEstoquePorDescricao(item.descricao, item.unidade);
    if (estRec) {
      estId = estRec.id;
      const qOld = Number(estRec.quantidade || 0);
      const aOld = Number(estRec.valor_unit || 0);
      const qNew = qOld + qtd;
      // Custo médio ponderado: (valor do estoque atual + valor da entrada) / qtd total.
      const aNew = qNew > 0 ? Math.round(((qOld * aOld) + liqItem) / qNew * 100) / 100 : custoUnit;
      const upd = { quantidade: qNew, valor_unit: aNew };
      if (catItem && !estRec.categoria_id) upd.categoria_id = catItem;   // preenche só se faltava
      if (data.fornecedor_id && !estRec.fornecedor_id) upd.fornecedor_id = data.fornecedor_id;
      update('estoque', estId, upd);
    } else {
      const novo = create('estoque', {
        descricao:      item.descricao,
        quantidade:     qtd,
        valor_unit:     custoUnit,
        fornecedor_id:  data.fornecedor_id || '',
        unidade:        item.unidade || 'un',
        categoria_id:   catItem,
        estoque_minimo: 0,
        data_entrada:   data.data,
        ativo:          true,
      });
      estId = novo.data.id;
    }

    // Linha da compra: guarda a categoria do item + valor líquido (p/ relatório financeiro).
    create('compras_itens', {
      compra_id:   compraId,
      descricao:   item.descricao,
      estoque_id:  estId,
      categoria_id:catItem,
      quantidade:  qtd,
      valor_unit:  Number(item.valor_unit || 0),
      valor_liq:   liqItem,
      valor_total: brutoItem,
    });

    // Movimentação de entrada no razão do estoque.
    create('estoque_movimentacoes', {
      estoque_id:  estId,
      tipo:        'entrada',
      motivo:      'compra',
      quantidade:  qtd,
      valor_unit:  custoUnit,
      valor_total: liqItem,
      origem:      'compra',
      origem_id:   compraId,
      data:        data.data,
      observacoes: '',
    });
  });

  // Categoria que vai na parcela (a de maior valor; fallback p/ telas que não rateiam por item).
  let parcelaCatId = data.categoria_id || '';
  const catKeys = Object.keys(catTotais);
  if (catKeys.length) parcelaCatId = catKeys.reduce((a, b) => (catTotais[a] >= catTotais[b] ? a : b));

  // Gerar parcelas a pagar
  const parcCount = data.parcelas_count || 1;
  const valorParc = liquido / parcCount;
  const fornRec = data.fornecedor_id ? read('clientes', data.fornecedor_id).data[0] : null;
  const fornNome = fornRec ? fornRec.nome : '';
  const dataPago = data.data || data.primeira_data_vencimento;
  // grupo_id: une todas as parcelas desta transação para exclusão em conjunto
  const grupoIdCompra = Utilities.getUuid();

  if (data.quem_pagou) {
    // Sócio pagou a compra do bolso. A despesa real CONTA no resultado
    // (conta_id='' = não saiu da conta da empresa); a dívida com o sócio
    // vira movimento na ficha. SEM receita fantasma de "Devolução de fiado".
    let primeiraVenc = new Date(data.primeira_data_vencimento);
    for (let i = 0; i < parcCount; i++) {
      const venc = new Date(primeiraVenc);
      venc.setMonth(venc.getMonth() + i);
      create('parcelas', {
        tipo:            'pagar',
        origem:          'compra',
        origem_id:       compraId,
        grupo_id:        grupoIdCompra,
        cliente_id:      data.fornecedor_id || '',
        descricao:       'Compra - ' + fornNome + (parcCount > 1 ? ' (' + (i+1) + '/' + parcCount + ')' : ''),
        valor:           valorParc,
        data_competencia:data.data_competencia,
        data_vencimento: Utilities.formatDate(venc, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
        data_pagamento:  dataPago,
        status:          'pago',
        conta_id:        '',  // saiu do bolso da pessoa, não da conta da empresa
        categoria_id:    parcelaCatId,
        observacoes:     data.observacoes || '',
      });
    }
    // Ficha do sócio: empresa passa a dever a ele
    _fiadoMovCreate({
      pessoa:      data.quem_pagou,
      data:        dataPago,
      direcao:     'empresa_deve',
      motivo:      'despesa_bolso',
      descricao:   'Compra ' + fornNome,
      valor:       liquido,
      grupo_id:    grupoIdCompra,
      observacoes: data.observacoes || '',
    });
  } else {
    // Caminho normal: parcelas pendentes
    let primeiraVenc = new Date(data.primeira_data_vencimento);
    for (let i = 0; i < parcCount; i++) {
      const venc = new Date(primeiraVenc);
      venc.setMonth(venc.getMonth() + i);
      create('parcelas', {
        tipo:            'pagar',
        origem:          'compra',
        origem_id:       compraId,
        grupo_id:        grupoIdCompra,
        cliente_id:      data.fornecedor_id || '',
        descricao:       'Compra - ' + fornNome + (parcCount > 1 ? ' (' + (i+1) + '/' + parcCount + ')' : ''),
        valor:           valorParc,
        data_competencia:data.data_competencia,
        data_vencimento: Utilities.formatDate(venc, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
        data_pagamento:  '',
        status:          'pendente',
        categoria_id:    parcelaCatId,
        observacoes:     data.observacoes || '',
      });
    }
  }

  return { success: true, compra_id: compraId };
}

function registrarFiado(data) {
  // data: { pessoa, descricao, valor, data, observacoes, categoria_id }
  // Gera: 1 parcela a pagar (empresa deve para pessoa) + 1 registro fiado
  const parcelaPagar = create('parcelas', {
    tipo:            'pagar',
    origem:          'fiado',
    origem_id:       '',
    cliente_id:      '',
    descricao:       'Fiado - ' + data.pessoa + ' - ' + data.descricao,
    valor:           data.valor,
    data_competencia:data.data,
    data_vencimento: data.data_vencimento || data.data,
    data_pagamento:  '',
    status:          'pendente',
    categoria_id:    data.categoria_id || '',
    observacoes:     data.observacoes || '',
  });

  const fiado = create('fiado', {
    pessoa:         data.pessoa,
    descricao:      data.descricao,
    valor:          data.valor,
    data:           data.data,
    parcela_pagar_id: parcelaPagar.data.id,
    status:         'pendente',
    observacoes:    data.observacoes || '',
  });

  update('parcelas', parcelaPagar.data.id, { origem_id: fiado.data.id });

  return { success: true, fiado_id: fiado.data.id, parcela_id: parcelaPagar.data.id };
}

// ============================================================
// FICHA DO SÓCIO (conta-corrente: Rodrigo / Odinei)
// Razão de movimentos em 'fiado_mov'. Saldo na PERSPECTIVA DA EMPRESA:
//   empresa_deve (+) = a empresa deve ao sócio (ele cobriu despesa do bolso)
//   socio_deve   (−) = o sócio deve à empresa (a empresa emprestou pra ele)
// ============================================================

function _hojeStr() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function _fiadoMovCreate(o) {
  return create('fiado_mov', {
    pessoa:      String(o.pessoa || '').toLowerCase(),
    data:        o.data || _hojeStr(),
    direcao:     o.direcao,
    motivo:      o.motivo,
    descricao:   o.descricao || '',
    valor:       Number(o.valor || 0),
    parcela_id:  o.parcela_id || '',
    conta_id:    o.conta_id || '',
    status:      o.status || 'ativo',
    grupo_id:    o.grupo_id || '',
    observacoes: o.observacoes || '',
  });
}

// Saldo atual da ficha (perspectiva empresa, + = empresa deve ao sócio).
// Inclui o "saldo inicial" do modelo antigo: reembolsos de fiado ainda pendentes.
function _fiadoSaldoPessoa(pessoa) {
  pessoa = String(pessoa || '').toLowerCase();
  var saldo = 0;
  // Modelo antigo: registros 'fiado' pendentes = empresa deve
  sheetToRecords(getSheet('fiado')).forEach(function(f) {
    if (String(f.pessoa || '').toLowerCase() === pessoa && f.status === 'pendente') {
      saldo += Number(f.valor || 0);
    }
  });
  // Modelo novo: movimentos ativos
  sheetToRecords(getSheet('fiado_mov')).forEach(function(m) {
    if (String(m.pessoa || '').toLowerCase() === pessoa && m.status === 'ativo') {
      saldo += (m.direcao === 'socio_deve' ? -1 : 1) * Number(m.valor || 0);
    }
  });
  return Math.round(saldo * 100) / 100;
}

// Empresa empresta dinheiro a um sócio. Sai de uma conta real (NÃO é despesa,
// fica fora do resultado como uma transferência) e o sócio passa a dever.
function registrarEmprestimoSocio(data) {
  // data: { pessoa, valor, conta_id, data, descricao, observacoes }
  var valor = Number(data.valor || 0);
  if (!valor) return { success: false, error: 'Valor inválido' };
  if (!data.conta_id) return { success: false, error: 'Selecione a conta de onde sai o dinheiro' };
  var dataMov = data.data || _hojeStr();
  var desc = data.descricao || ('Empréstimo a ' + data.pessoa);
  var grupoId = Utilities.getUuid();
  var parc = create('parcelas', {
    tipo:            'pagar',
    origem:          'fiado_emprestimo',
    origem_id:       '',
    grupo_id:        grupoId,
    cliente_id:      '',
    descricao:       desc,
    valor:           valor,
    data_competencia:dataMov.substring(0, 7) + '-01',
    data_vencimento: dataMov,
    data_pagamento:  dataMov,
    status:          'pago',
    categoria_id:    '',
    conta_id:        data.conta_id,
    observacoes:     data.observacoes || '',
  });
  var mov = _fiadoMovCreate({
    pessoa: data.pessoa, data: dataMov, direcao: 'socio_deve', motivo: 'emprestimo',
    descricao: desc, valor: valor, parcela_id: parc.data.id, conta_id: data.conta_id,
    grupo_id: grupoId, observacoes: data.observacoes || '',
  });
  return { success: true, mov_id: mov.data.id, parcela_id: parc.data.id };
}

// Movimento manual avulso na ficha (ajuste), sem efeito em conta da empresa.
function registrarFiadoMovManual(data) {
  // data: { pessoa, direcao, valor, data, descricao, observacoes }
  var valor = Number(data.valor || 0);
  if (!valor) return { success: false, error: 'Valor inválido' };
  if (data.direcao !== 'empresa_deve' && data.direcao !== 'socio_deve') {
    return { success: false, error: 'Direção inválida' };
  }
  var mov = _fiadoMovCreate({
    pessoa: data.pessoa, data: data.data || _hojeStr(), direcao: data.direcao,
    motivo: 'ajuste', descricao: data.descricao || 'Ajuste manual', valor: valor,
    observacoes: data.observacoes || '',
  });
  return { success: true, mov_id: mov.data.id };
}

// Acerto: zera o saldo da ficha. Mexe numa conta real pelo LÍQUIDO e arquiva
// tudo (movimentos novos viram 'acertado'; fiados antigos pendentes viram
// 'quitado' e suas parcelas pendentes são removidas — o acerto cobre o caixa).
function acertarFiado(data) {
  // data: { pessoa, conta_id, data, observacoes }
  var pessoa = String(data.pessoa || '').toLowerCase();
  var saldo = _fiadoSaldoPessoa(pessoa);
  if (Math.abs(saldo) < 0.005) return { success: false, error: 'Nada a acertar (saldo zero)' };
  var dataMov = data.data || _hojeStr();
  var grupoId = Utilities.getUuid();
  var valor = Math.round(Math.abs(saldo) * 100) / 100;
  var empresaDevia = saldo > 0; // empresa paga o sócio
  var pessoaFmt = pessoa.charAt(0).toUpperCase() + pessoa.slice(1);
  var descAcerto = 'Acerto de fiado — ' + pessoaFmt + ' (já acertado em ' +
                   dataMov.split('-').reverse().join('/') + ')';

  // 1) Movimento real na conta da empresa (fora do resultado)
  if (data.conta_id) {
    create('parcelas', {
      tipo:            empresaDevia ? 'pagar' : 'receber',
      origem:          'fiado_acerto',
      origem_id:       '',
      grupo_id:        grupoId,
      cliente_id:      '',
      descricao:       descAcerto,
      valor:           valor,
      data_competencia:dataMov.substring(0, 7) + '-01',
      data_vencimento: dataMov,
      data_pagamento:  dataMov,
      status:          'pago',
      categoria_id:    '',
      conta_id:        data.conta_id,
      observacoes:     data.observacoes || '',
    });
  }

  // 2) Arquiva o modelo antigo: fiados pendentes viram quitado; parcela
  //    pendente vinculada é removida (o caixa já foi coberto no passo 1).
  sheetToRecords(getSheet('fiado')).forEach(function(f) {
    if (String(f.pessoa || '').toLowerCase() === pessoa && f.status === 'pendente') {
      update('fiado', f.id, { status: 'quitado' });
      if (f.parcela_pagar_id) {
        var pr = read('parcelas', f.parcela_pagar_id).data[0];
        if (pr && pr.origem === 'fiado' && pr.status === 'pendente') {
          try { remove('parcelas', f.parcela_pagar_id); } catch (e) {}
        }
      }
    }
  });

  // 3) Arquiva os movimentos novos ativos
  sheetToRecords(getSheet('fiado_mov')).forEach(function(m) {
    if (String(m.pessoa || '').toLowerCase() === pessoa && m.status === 'ativo') {
      update('fiado_mov', m.id, { status: 'acertado' });
    }
  });

  // 4) Linha de acerto no extrato (informativa, já arquivada; direção contrária
  //    ao saldo para deixar explícito que zerou)
  _fiadoMovCreate({
    pessoa: pessoa, data: dataMov,
    direcao: empresaDevia ? 'socio_deve' : 'empresa_deve',
    motivo: 'acerto', descricao: descAcerto, valor: valor,
    conta_id: data.conta_id || '', status: 'acertado', grupo_id: grupoId,
    observacoes: data.observacoes || '',
  });

  return { success: true, valor: valor, empresa_pagou: empresaDevia };
}

// Movimentação avulsa de estoque: baixa/perda/uso interno/uso em OS (saída),
// entrada manual, ou ajuste de inventário (define qtd e/ou custo absolutos).
// Sem efeito financeiro (a despesa já foi lançada na compra).
function registrarMovEstoque(data) {
  // data: { estoque_id, tipo (entrada|saida|ajuste), motivo, quantidade,
  //         nova_quantidade, novo_valor_unit (p/ ajuste),
  //         origem, origem_id, data, observacoes }
  const estRec = read('estoque', data.estoque_id).data[0];
  if (!estRec) return { success: false, error: 'Item de estoque não encontrado' };
  const qOld = Number(estRec.quantidade || 0);
  const aOld = Number(estRec.valor_unit || 0);
  const hoje = data.data || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const r2 = n => Math.round(n * 100) / 100;
  let tipo, motivo, qtdMov, custoMov, qNew;

  if (data.tipo === 'ajuste') {
    // Correção: aplica quantidade e/ou custo absolutos; registra a diferença de quantidade.
    qNew = (data.nova_quantidade !== undefined && data.nova_quantidade !== '') ? Number(data.nova_quantidade) : qOld;
    const aNew = (data.novo_valor_unit !== undefined && data.novo_valor_unit !== '') ? Number(data.novo_valor_unit) : aOld;
    qtdMov = qNew - qOld;
    custoMov = aNew;
    tipo = 'ajuste'; motivo = 'ajuste';
    update('estoque', data.estoque_id, { quantidade: qNew, valor_unit: aNew });
  } else if (data.tipo === 'entrada') {
    qtdMov = Number(data.quantidade || 0);
    custoMov = (data.valor_unit !== undefined && data.valor_unit !== '') ? Number(data.valor_unit) : aOld;
    qNew = qOld + qtdMov;
    const aNew = qNew > 0 ? r2(((qOld * aOld) + (qtdMov * custoMov)) / qNew) : custoMov;
    tipo = 'entrada'; motivo = data.motivo || 'entrada';
    update('estoque', data.estoque_id, { quantidade: qNew, valor_unit: aNew });
  } else {
    // saída: baixa/perda/uso interno/uso em OS. Mantém o custo médio (não recalcula).
    qtdMov = Number(data.quantidade || 0);
    custoMov = aOld;
    qNew = Math.max(0, qOld - qtdMov);
    tipo = 'saida'; motivo = data.motivo || 'uso_interno';
    update('estoque', data.estoque_id, { quantidade: qNew });
  }

  create('estoque_movimentacoes', {
    estoque_id:  data.estoque_id,
    tipo:        tipo,
    motivo:      motivo,
    quantidade:  Math.abs(qtdMov),
    valor_unit:  custoMov,
    valor_total: r2(Math.abs(qtdMov) * custoMov),
    origem:      data.origem || 'manual',
    origem_id:   data.origem_id || '',
    data:        hoje,
    observacoes: data.observacoes || (data.tipo === 'ajuste' ? 'Ajuste de inventário' : ''),
  });
  return { success: true, quantidade: qNew };
}

function pagarParcela(data) {
  // data: { parcela_id, data_pagamento, conta_id }
  // Idempotência: parcela já paga → no-op de sucesso (clique duplo não
  // sobrescreve data/conta do pagamento original).
  const parcCheck = read('parcelas', data.parcela_id).data[0];
  if (!parcCheck) return { success: false, error: 'Parcela não encontrada' };
  if (String(parcCheck.status) === 'pago') return { success: true, jaPago: true };
  const patch = {
    data_pagamento: data.data_pagamento,
    status:         'pago',
  };
  if (data.conta_id !== undefined) patch.conta_id = data.conta_id;
  update('parcelas', data.parcela_id, patch);
  // Se a parcela é de fiado, sincronizar o registro fiado
  const parc = read('parcelas', data.parcela_id).data[0];
  if (parc && parc.origem === 'fiado' && parc.origem_id) {
    update('fiado', parc.origem_id, { status: 'quitado' });
  }
  return { success: true };
}

// Exclui um lançamento e todas as parcelas criadas junto com ele (mesmo grupo_id).
// Para registros antigos sem grupo_id, aplica fallbacks por tipo de origem:
//   - transferencia → busca o par pelo mesmo descricao+valor+vencimento
//   - compra        → busca todas com o mesmo origem_id
//   - fiado_pago    → busca irmãs com mesmo valor+competencia
// Em todos os casos, registros 'fiado' com origem_id são excluídos em cascata.
function excluirLancamento(parcelaId) {
  const todasParcelas = sheetToRecords(getSheet('parcelas'));
  const parc = todasParcelas.find(function(p) { return String(p.id) === String(parcelaId); });
  if (!parc) return { success: false, error: 'Parcela não encontrada' };

  var grupo = []; // parcelas para excluir

  if (parc.grupo_id) {
    // Novos registros: agrupa pelo grupo_id
    grupo = todasParcelas.filter(function(p) { return p.grupo_id === parc.grupo_id; });
  } else if (parc.origem === 'transferencia') {
    // Fallback: encontra o par pela descrição + valor + vencimento
    var par = todasParcelas.find(function(p) {
      return p.id !== parc.id &&
             p.origem === 'transferencia' &&
             p.descricao === parc.descricao &&
             String(p.valor) === String(parc.valor) &&
             p.data_vencimento === parc.data_vencimento;
    });
    grupo = par ? [parc, par] : [parc];
  } else if (parc.origem === 'compra' && parc.origem_id) {
    // Fallback: todas parcelas da mesma compra (compra + fiado_pago com mesmo origem_id)
    grupo = todasParcelas.filter(function(p) {
      return p.origem_id === parc.origem_id &&
             (p.origem === 'compra' || p.origem === 'fiado_pago');
    });
    // Inclui parcela de reembolso (fiado) vinculada a este grupo via fiado record
    var fiadoReemb = todasParcelas.find(function(p) {
      return p.origem === 'fiado' && p.origem_id &&
             grupo.some(function(g) { return g.id === p.id; }) === false;
    });
    // Busca pelo fiado record cujo parcela_pagar_id aponte para a parcela de reembolso
    if (grupo.length > 0) {
      try {
        var fiadoSheet = sheetToRecords(getSheet('fiado'));
        var fiadoRec = fiadoSheet.find(function(f) {
          return todasParcelas.some(function(p) {
            return p.id === f.parcela_pagar_id && p.origem_id === parc.origem_id;
          });
        });
        if (!fiadoRec) {
          // Alternativa: acha pelo reembolso que tem mesmo valor e mesmo compra_id no obs (heurística)
          fiadoRec = fiadoSheet.find(function(f) {
            return String(f.valor) === String(parc.valor) &&
                   todasParcelas.some(function(p) {
                     return p.id === f.parcela_pagar_id && p.origem === 'fiado';
                   });
          });
        }
        if (fiadoRec) {
          var reembParc = todasParcelas.find(function(p) { return p.id === fiadoRec.parcela_pagar_id; });
          if (reembParc) grupo.push(reembParc);
        }
      } catch(e) {}
    }
    if (grupo.length === 0) grupo = [parc];
  } else if (parc.origem === 'fiado_pago') {
    // Fallback: agrupa fiado_pago com mesmo valor+competencia (criados juntos)
    grupo = todasParcelas.filter(function(p) {
      return p.origem === 'fiado_pago' &&
             String(p.valor) === String(parc.valor) &&
             p.data_competencia === parc.data_competencia;
    });
    // Inclui parcela de reembolso com mesmo valor+competencia
    var reemb = todasParcelas.find(function(p) {
      return p.origem === 'fiado' &&
             String(p.valor) === String(parc.valor) &&
             p.data_competencia === parc.data_competencia;
    });
    if (reemb) grupo.push(reemb);
    if (grupo.length === 0) grupo = [parc];
  } else {
    grupo = [parc];
  }

  // Deduplica por id
  var vistos = {};
  grupo = grupo.filter(function(p) {
    if (vistos[p.id]) return false;
    vistos[p.id] = true;
    return true;
  });

  // Exclui fiado records vinculados e depois as parcelas
  grupo.forEach(function(p) {
    if (p.origem === 'fiado' && p.origem_id) {
      try { remove('fiado', p.origem_id); } catch(e) {}
    }
  });
  // Exclui movimentos da ficha vinculados (por parcela_id ou pelo mesmo grupo_id)
  try {
    var grupoIds = {};
    grupo.forEach(function(p) { grupoIds[p.id] = true; });
    sheetToRecords(getSheet('fiado_mov')).forEach(function(m) {
      if ((m.parcela_id && grupoIds[m.parcela_id]) ||
          (parc.grupo_id && m.grupo_id === parc.grupo_id)) {
        try { remove('fiado_mov', m.id); } catch(e) {}
      }
    });
  } catch(e) {}
  grupo.forEach(function(p) {
    try { remove('parcelas', p.id); } catch(e) {}
  });

  return { success: true, deleted: grupo.length };
}

function excluirOS(osId) {
  // Devolver itens ao estoque, remover registros relacionados
  const itens = read('os_itens', null, { os_id: osId }).data;
  itens.forEach(item => {
    if (item.estoque_id && item.tipo === 'material') {
      const estRec = read('estoque', item.estoque_id).data[0];
      if (estRec) {
        const qtd = Number(item.quantidade || 0);
        update('estoque', item.estoque_id, { quantidade: Number(estRec.quantidade || 0) + qtd });
        create('estoque_movimentacoes', {
          estoque_id:  item.estoque_id,
          tipo:        'entrada',
          motivo:      'devolucao',
          quantidade:  qtd,
          valor_unit:  Number(estRec.valor_unit || 0),
          valor_total: qtd * Number(estRec.valor_unit || 0),
          origem:      'os',
          origem_id:   osId,
          data:        Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
          observacoes: 'Devolução por exclusão de OS',
        });
      }
    }
    remove('os_itens', item.id);
  });
  const diarias = read('diarias', null, { os_id: osId }).data;
  diarias.forEach(d => remove('diarias', d.id));
  const fechamentos = read('fechamentos', null, { os_id: osId }).data;
  fechamentos.forEach(f => {
    const fdias = read('fechamento_dias', null, { fechamento_id: f.id }).data;
    fdias.forEach(fd => remove('fechamento_dias', fd.id));
    remove('fechamentos', f.id);
  });
  // Lote: remove só a linha desta OS; o restante do lote (fechamento/parcela) fica.
  const fosRows = read('fechamento_os', null, { os_id: osId }).data;
  fosRows.forEach(fo => remove('fechamento_os', fo.id));
  remove('os', osId);
  return { success: true };
}

// ─── DASHBOARD STATS ─────────────────────────────────────────
function getDashboardStats() {
  const today = new Date();
  const mes = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM');

  const osList       = sheetToRecords(getSheet('os'));
  const parcelas     = sheetToRecords(getSheet('parcelas'));

  const osAndamento  = osList.filter(o => o.status === 'andamento').length;
  const osAcerto     = osList.filter(o => o.status === 'acerto').length;

  const recMes = parcelas.filter(p => p.tipo === 'receber' && String(p.data_competencia).startsWith(mes));
  const pagMes = parcelas.filter(p => p.tipo === 'pagar'   && String(p.data_competencia).startsWith(mes));
  const recPago = recMes.filter(p => p.status === 'pago').reduce((s, p) => s + Number(p.valor || 0), 0);
  const recTotal= recMes.reduce((s, p) => s + Number(p.valor || 0), 0);
  const pagPago = pagMes.filter(p => p.status === 'pago').reduce((s, p) => s + Number(p.valor || 0), 0);
  const pagTotal= pagMes.reduce((s, p) => s + Number(p.valor || 0), 0);

  const venc7 = parcelas.filter(p => {
    if (p.status !== 'pendente') return false;
    const d = new Date(p.data_vencimento);
    const diff = (d - today) / 86400000;
    return diff >= 0 && diff <= 7;
  });

  return {
    success: true,
    data: {
      os_andamento: osAndamento,
      os_acerto:    osAcerto,
      rec_total:    recTotal,
      rec_pago:     recPago,
      pag_total:    pagTotal,
      pag_pago:     pagPago,
      saldo_mes:    recPago - pagPago,
      vencendo_7d:  venc7.length,
    }
  };
}

// ─── HELPERS INTERNOS ───────────────────────────────────────
// Retorna o id de uma categoria pelo nome (busca na planilha)
function _findCategoria(nome) {
  try {
    const cats = sheetToRecords(getSheet('categorias'));
    return cats.find(c => c.nome === nome)?.id || '';
  } catch { return ''; }
}

// Acha um item ATIVO no estoque pela descrição (+unidade), p/ mesclar recompras
// em vez de criar duplicatas. Comparação normalizada (case/espaços).
function _acharEstoquePorDescricao(descricao, unidade) {
  if (!descricao) return null;
  const norm = s => String(s || '').trim().toLowerCase();
  const alvo = norm(descricao);
  const alvoUn = norm(unidade);
  try {
    const ests = sheetToRecords(getSheet('estoque'));
    return ests.find(e =>
      e.ativo !== false && e.ativo !== 'false' &&
      norm(e.descricao) === alvo &&
      (alvoUn ? norm(e.unidade) === alvoUn : true)
    ) || null;
  } catch { return null; }
}

// Repara parcelas onde conta_id e observacoes foram gravados invertidos
// (bug do create() que usava SHEET_HEADERS em vez de headers reais após migração).
//
// Situação: a sheet 'parcelas' foi criada SEM conta_id; após migração, conta_id
// foi adicionado ao FINAL. O SHEET_HEADERS tinha a ordem antiga (conta_id antes
// de observacoes). O create() bugado montava a linha por SHEET_HEADERS, então:
//   • posição da coluna observacoes  → recebia data.conta_id  (um UUID)
//   • posição da coluna conta_id     → recebia data.observacoes (texto ou vazio)
//
// Detecção: coluna observacoes tem um UUID E coluna conta_id NÃO tem um UUID.
// Restauração: troca os valores; o texto original de observacoes é preservado.
function repairParcelasContaId() {
  const sh = getSheet('parcelas');
  const all = sh.getDataRange().getValues();
  if (all.length < 2) return { fixed: 0 };
  const headers  = all[0];
  const contaIdx = headers.indexOf('conta_id');
  const obsIdx   = headers.indexOf('observacoes');
  if (contaIdx === -1 || obsIdx === -1) return { fixed: 0, msg: 'colunas não encontradas' };
  const uuidPat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let fixed = 0;
  for (let i = 1; i < all.length; i++) {
    const row      = all[i];
    if (!row[0]) continue;
    const contaVal = String(row[contaIdx] || '').trim();
    const obsVal   = String(row[obsIdx]   || '').trim();
    // Condição robusta:
    //   obsVal  É  um UUID  → o conta_id ficou gravado ali por engano
    //   contaVal NÃO é UUID → conta_id coluna ainda não tem o valor correto
    // (se contaVal já for UUID, a linha já foi corrigida ou nunca foi afetada)
    if (uuidPat.test(obsVal) && !uuidPat.test(contaVal)) {
      sh.getRange(i + 1, contaIdx + 1).setValue(obsVal);    // conta_id ← UUID correto
      sh.getRange(i + 1, obsIdx   + 1).setValue(contaVal);  // observacoes ← texto original (pode ser vazio)
      fixed++;
    }
  }
  return { success: true, fixed };
}

// ─── SETUP ───────────────────────────────────────────────────
function initializeSheets() {
  const results = [];
  Object.entries(SHEET_HEADERS).forEach(([name, headers]) => {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
      sh.setFrozenRows(1);
      results.push('Criada: ' + name);
    } else {
      // Migra colunas: adiciona ao final qualquer header novo que falte
      const lastCol = sh.getLastColumn() || 1;
      const current = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
      const missing = headers.filter(h => current.indexOf(h) === -1);
      if (missing.length > 0) {
        const startCol = lastCol + 1;
        sh.getRange(1, startCol, 1, missing.length).setValues([missing]);
        sh.getRange(1, startCol, 1, missing.length).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
        results.push('Migrada: ' + name + ' (+' + missing.join(',') + ')');
      } else {
        results.push('Já existe: ' + name);
      }
    }
  });

  // Config inicial
  const configSh = ss.getSheetByName('config');
  const existingConfig = sheetToRecords(configSh);
  const fatoresDefault = JSON.stringify([
    { id: 1, label: 'Risco (altura, elétrica, confinado)',          percentual: 30 },
    { id: 2, label: 'Acesso difícil (lama, animais, equip. extra)', percentual: 20 },
    { id: 3, label: 'Urgência (chamado no mesmo dia)',               percentual: 25 },
    { id: 4, label: 'Complexidade (imprevisível, diagnóstico)',      percentual: 20 },
    { id: 5, label: 'Fim de semana ou feriado',                     percentual: 30 },
    { id: 6, label: 'Cliente distante / novo',                      percentual: 20 },
    { id: 7, label: 'Sazonalidade (plantio / colheita)',            percentual: 15 },
  ]);
  const defaults = [
    { chave: 'valor_hora_manutencao',  valor: '155',  descricao: 'Valor da hora — Manutenção (R$/h)' },
    { chave: 'valor_hora_projeto',     valor: '200',  descricao: 'Valor da hora — Projeto novo (R$/h)' },
    { chave: 'taxa_admin_material',    valor: '15',   descricao: 'Taxa de administração sobre material (%)' },
    { chave: 'valor_chamada_proximo',  valor: '200',  descricao: 'Chamada técnica — cliente próximo (R$)' },
    { chave: 'valor_chamada_distante', valor: '250',  descricao: 'Chamada técnica — cliente distante (R$)' },
    { chave: 'simples_aliquota',       valor: '0',    descricao: 'Alíquota Simples Nacional (%)' },
    { chave: 'fatores_json',           valor: fatoresDefault, descricao: 'Fatores de ajuste (JSON)' },
    { chave: 'empresa_nome',           valor: 'Saretta Serviços', descricao: 'Nome da empresa' },
  ];
  defaults.forEach(d => {
    if (!existingConfig.find(c => c.chave === d.chave)) {
      create('config', d);
    }
  });

  // Categorias iniciais
  const catSh = ss.getSheetByName('categorias');
  const existingCat = sheetToRecords(catSh);
  const cats = [
    { nome: 'Serviços',          tipo: 'entrada', ativo: true },
    { nome: 'Material/Estoque',  tipo: 'saida',   ativo: true },
    { nome: 'Alimentação',       tipo: 'saida',   ativo: true },
    { nome: 'Combustível',       tipo: 'saida',   ativo: true },
    { nome: 'Ferramentas',       tipo: 'saida',   ativo: true },
    { nome: 'Fiado Rodrigo',     tipo: 'pagar',   ativo: true },
    { nome: 'Fiado Odinei',      tipo: 'pagar',   ativo: true },
    { nome: 'Devolução de fiado',tipo: 'entrada', ativo: true },
    { nome: 'Outros',            tipo: 'ambos',   ativo: true },
    // Categorias de OS (tipo='os')
    { nome: 'Elétrica',                  tipo: 'os', ativo: true },
    { nome: 'Adequação de propriedade',  tipo: 'os', ativo: true },
    { nome: 'Cerca',                     tipo: 'os', ativo: true },
    { nome: 'Construção',                tipo: 'os', ativo: true },
    { nome: 'Reforma',                   tipo: 'os', ativo: true },
    { nome: 'Consertos',                 tipo: 'os', ativo: true },
    { nome: 'Hidráulica',                tipo: 'os', ativo: true },
  ];
  cats.forEach(c => {
    if (!existingCat.find(ec => ec.nome === c.nome)) create('categorias', c);
  });

  // Categorias de estoque/material (tipo='saida') — usadas no item de estoque e no rateio
  // por categoria da compra. Dedupe por nome+tipo: 'Elétrica'/'Hidráulica' podem coexistir
  // com as categorias de OS de mesmo nome (tipo='os'), pois são contextos diferentes.
  const catEstoque = ['Uso e consumo', 'Organização', 'EPI', 'Elétrica', 'Hidráulica'];
  catEstoque.forEach(nome => {
    if (!existingCat.find(ec => ec.nome === nome && ec.tipo === 'saida')) {
      create('categorias', { nome: nome, tipo: 'saida', ativo: true });
    }
  });

  // Contas iniciais (saldo_inicial fica zerado — usuário configura na UI)
  const contasSh = ss.getSheetByName('contas');
  const existingContas = sheetToRecords(contasSh);
  const contas = [
    { nome: 'Carteira', saldo_inicial: 0, ativo: true, ordem: 1 },
    { nome: 'Sicredi',  saldo_inicial: 0, ativo: true, ordem: 2 },
  ];
  contas.forEach(c => {
    if (!existingContas.find(ec => ec.nome === c.nome)) create('contas', c);
  });

  // Repara parcelas com conta_id/observacoes invertidos (bug do create() pré-v1.5.5)
  const repair = repairParcelasContaId();
  if (repair.fixed > 0) results.push('Reparadas ' + repair.fixed + ' parcelas (conta_id corrigido)');

  return { success: true, results };
}

// ============================================================
// BACKUP AUTOMÁTICO DA PLANILHA
// ============================================================
// backupPlanilha() copia a planilha INTEIRA para a pasta do Drive
// definida em BACKUP_PASTA, mantendo só as BACKUP_MANTER cópias mais
// recentes (as antigas vão pra lixeira do Drive, recuperáveis por 30 dias).
//
// COMO ATIVAR (uma vez só, no editor do Apps Script):
//   1. Selecione configurarBackupSemanal no menu de funções e Execute ▶
//      (na 1ª vez o Google pede autorização de acesso ao Drive — aceitar).
//   2. Pronto: toda segunda-feira entre 3h e 4h sai um backup sozinho.
//   3. Para testar na hora, execute backupPlanilha ▶ e confira a pasta
//      "Backups Saretta Gestão" no Drive.
// Gatilhos rodam o código SALVO — não precisa republicar a implantação.

const BACKUP_PASTA  = 'Backups Saretta Gestão';
const BACKUP_MANTER = 8;

function backupPlanilha() {
  const arquivo = DriveApp.getFileById(SPREADSHEET_ID);
  const pastas  = DriveApp.getFoldersByName(BACKUP_PASTA);
  const pasta   = pastas.hasNext() ? pastas.next() : DriveApp.createFolder(BACKUP_PASTA);

  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH\'h\'mm');
  const nome  = 'Backup Saretta ' + stamp;
  arquivo.makeCopy(nome, pasta);

  // Retenção: mantém as BACKUP_MANTER mais recentes, o resto vai pra lixeira
  const files = [];
  const it = pasta.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(BACKUP_MANTER).forEach(function (f) { f.setTrashed(true); });

  return { success: true, backup: nome, guardados: Math.min(files.length, BACKUP_MANTER) };
}

function configurarBackupSemanal() {
  // Remove gatilhos antigos do backup (evita duplicar se rodar 2x)
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupPlanilha') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backupPlanilha')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(3)
    .create();
  return 'Gatilho criado: backup toda segunda-feira entre 3h e 4h. Execute backupPlanilha() para testar agora.';
}
