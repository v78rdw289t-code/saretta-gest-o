// ============================================================
// SARETTA SERVIÇOS - BACKEND (Google Apps Script)
// Preencha SPREADSHEET_ID após criar a planilha
// ============================================================

const SPREADSHEET_ID = ''; // <- PREENCHA COM O ID DA PLANILHA
const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

const SHEET_HEADERS = {
  config:         ['id','chave','valor','descricao'],
  clientes:       ['id','nome','tipo','telefone','endereco','observacoes','data_cadastro','ativo'],
  categorias:     ['id','nome','tipo','ativo'],
  os:             ['id','numero','tipo','cliente_id','status','data_inicio','data_fim','valor_calculado','valor_fechamento','observacoes','data_criacao','data_atualizacao'],
  os_itens:       ['id','os_id','tipo','descricao','estoque_id','quantidade','valor_unit','valor_total'],
  diarias:        ['id','os_id','data','manha_inicio','manha_fim','tarde_inicio','tarde_fim','horas_totais','valor_calculado','valor_manual','observacoes'],
  fechamentos:    ['id','os_id','data','valor_bruto','desconto','valor_liquido','observacoes'],
  fechamento_dias:['id','fechamento_id','diaria_id'],
  parcelas:       ['id','tipo','origem','origem_id','cliente_id','descricao','valor','data_competencia','data_vencimento','data_pagamento','status','categoria_id','observacoes'],
  fiado:          ['id','pessoa','descricao','valor','data','parcela_pagar_id','status','observacoes'],
  estoque:        ['id','descricao','quantidade','valor_unit','fornecedor_id','unidade','observacoes','data_entrada','ativo'],
  compras:        ['id','fornecedor_id','data','valor_total','parcela_id','observacoes'],
  compras_itens:  ['id','compra_id','descricao','estoque_id','quantidade','valor_unit','valor_total'],
  lista_compras:  ['id','cliente_id','descricao','quantidade','unidade','estoque_id','status','data_criacao'],
};

// ─── ROTEADOR ────────────────────────────────────────────────
function doGet(e) {
  const params = e.parameter;
  try {
    const action = params.action;
    let result;
    if (action === 'read')        result = read(params.sheet, params.id || null, parseFilters(params));
    else if (action === 'initDB') result = initializeSheets();
    else if (action === 'stats')  result = getDashboardStats();
    else result = { success: false, error: 'Ação inválida' };
    return respond(result);
  } catch (err) {
    return respond({ success: false, error: err.toString() });
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    let result;
    switch (action) {
      case 'create':          result = create(data.sheet, data.data); break;
      case 'update':          result = update(data.sheet, data.id, data.data); break;
      case 'delete':          result = remove(data.sheet, data.id); break;
      case 'batch':           result = batch(data.operations); break;
      case 'fecharOS':        result = fecharOS(data); break;
      case 'registrarCompra': result = registrarCompra(data); break;
      case 'registrarFiado':  result = registrarFiado(data); break;
      case 'pagarParcela':    result = pagarParcela(data); break;
      case 'excluirOS':       result = excluirOS(data.id); break;
      default:                result = { success: false, error: 'Ação inválida' };
    }
    return respond(result);
  } catch (err) {
    return respond({ success: false, error: err.toString() });
  }
}

function respond(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseFilters(params) {
  const filters = {};
  const skip = ['action', 'sheet', 'id'];
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

function create(sheetName, data) {
  const sh = getSheet(sheetName);
  const headers = SHEET_HEADERS[sheetName];
  if (!headers) throw new Error('Headers não definidos para: ' + sheetName);
  data.id = Utilities.getUuid();
  const row = headers.map(h => data[h] !== undefined ? data[h] : '');
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

// ─── OPERAÇÕES COMPLEXAS ─────────────────────────────────────

function fecharOS(data) {
  // data: { os_id, valor_bruto, desconto, valor_liquido, data_vencimento,
  //         data_competencia, categoria_id, diaria_ids, observacoes }
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
  update('os', data.os_id, { status: 'acerto', valor_fechamento: data.valor_liquido, data_atualizacao: new Date().toISOString() });

  return { success: true, fechamento_id: fechId, parcela_id: parcela.data.id };
}

function registrarCompra(data) {
  // data: { fornecedor_id, data, valor_total, parcelas_count, primeira_data_vencimento,
  //         data_competencia, categoria_id, itens: [{descricao, estoque_id, quantidade, valor_unit, valor_total}], observacoes }
  const compraData = {
    fornecedor_id: data.fornecedor_id,
    data:          data.data,
    valor_total:   data.valor_total,
    observacoes:   data.observacoes || '',
  };
  const compra = create('compras', compraData);
  const compraId = compra.data.id;

  // Itens da compra + entrada no estoque
  (data.itens || []).forEach(item => {
    create('compras_itens', { ...item, compra_id: compraId });
    // Atualizar estoque
    if (item.estoque_id) {
      const estRec = read('estoque', item.estoque_id).data[0];
      if (estRec) {
        const novaQtd = Number(estRec.quantidade || 0) + Number(item.quantidade || 0);
        update('estoque', item.estoque_id, { quantidade: novaQtd });
      }
    } else {
      // Criar novo item no estoque
      create('estoque', {
        descricao:    item.descricao,
        quantidade:   item.quantidade,
        valor_unit:   item.valor_unit,
        fornecedor_id:data.fornecedor_id,
        unidade:      item.unidade || 'un',
        data_entrada: data.data,
        ativo:        true,
      });
    }
  });

  // Gerar parcelas a pagar
  const parcCount = data.parcelas_count || 1;
  const valorParc = data.valor_total / parcCount;
  const fornRec = data.fornecedor_id ? read('clientes', data.fornecedor_id).data[0] : null;
  const fornNome = fornRec ? fornRec.nome : '';

  let primeiraVenc = new Date(data.primeira_data_vencimento);
  for (let i = 0; i < parcCount; i++) {
    const venc = new Date(primeiraVenc);
    venc.setMonth(venc.getMonth() + i);
    create('parcelas', {
      tipo:            'pagar',
      origem:          'compra',
      origem_id:       compraId,
      cliente_id:      data.fornecedor_id || '',
      descricao:       'Compra - ' + fornNome + (parcCount > 1 ? ' (' + (i+1) + '/' + parcCount + ')' : ''),
      valor:           valorParc,
      data_competencia:data.data_competencia,
      data_vencimento: Utilities.formatDate(venc, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      data_pagamento:  '',
      status:          'pendente',
      categoria_id:    data.categoria_id || '',
      observacoes:     data.observacoes || '',
    });
  }

  // Atualizar referência da parcela na compra (apenas primeira)
  update('compras', compraId, { parcela_id: compraId });

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

function pagarParcela(data) {
  // data: { parcela_id, data_pagamento, valor_pago }
  update('parcelas', data.parcela_id, {
    data_pagamento: data.data_pagamento,
    status:         'pago',
  });
  return { success: true };
}

function excluirOS(osId) {
  // Devolver itens ao estoque, remover registros relacionados
  const itens = read('os_itens', null, { os_id: osId }).data;
  itens.forEach(item => {
    if (item.estoque_id && item.tipo === 'material') {
      const estRec = read('estoque', item.estoque_id).data[0];
      if (estRec) {
        update('estoque', item.estoque_id, { quantidade: Number(estRec.quantidade || 0) + Number(item.quantidade || 0) });
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
      results.push('Já existe: ' + name);
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
    { nome: 'Outros',            tipo: 'ambos',   ativo: true },
  ];
  cats.forEach(c => {
    if (!existingCat.find(ec => ec.nome === c.nome)) create('categorias', c);
  });

  return { success: true, results };
}
