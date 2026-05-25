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
  os:             ['id','numero','nome','tipo','cliente_id','categoria_id','status','data_inicio','data_fim','horas_calculadas','valor_calculado','valor_fechamento','observacoes','data_criacao','data_atualizacao'],
  os_itens:       ['id','os_id','tipo','descricao','estoque_id','quantidade','valor_unit','valor_total'],
  diarias:        ['id','os_id','categoria_id','data','manha_inicio','manha_fim','tarde_inicio','tarde_fim','horas_totais','valor_calculado','valor_manual','observacoes','reajuste_json'],
  fechamentos:    ['id','os_id','data','valor_bruto','desconto','valor_liquido','observacoes'],
  fechamento_dias:['id','fechamento_id','diaria_id'],
  parcelas:       ['id','tipo','origem','origem_id','cliente_id','descricao','valor','data_competencia','data_vencimento','data_pagamento','status','categoria_id','conta_id','observacoes'],
  contas:         ['id','nome','saldo_inicial','ativo','ordem','observacoes'],
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
    if (action === 'read')           result = read(params.sheet, params.id || null, parseFilters(params));
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
  data.id = Utilities.getUuid();
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
  //         data_competencia, categoria_id, quem_pagou (opcional),
  //         itens: [{descricao, estoque_id, quantidade, valor_unit, valor_total}], observacoes }
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
  const dataPago = data.data || data.primeira_data_vencimento;

  if (data.quem_pagou) {
    // Caminho fiado: a pessoa já pagou do bolso.
    // Parcelas da compra marcadas como pago (a despesa aconteceu).
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
        data_pagamento:  dataPago,
        status:          'pago',
        conta_id:        '',  // saiu do bolso da pessoa, não da conta da empresa
        categoria_id:    data.categoria_id || '',
        observacoes:     data.observacoes || '',
      });
    }
    // Receita-fiado: neutraliza a saída no caixa (pessoa cobriu)
    const catDevFiado = _findCategoria('Devolução de fiado');
    create('parcelas', {
      tipo:            'receber',
      origem:          'fiado_pago',
      origem_id:       compraId,
      cliente_id:      '',
      descricao:       'Fiado ' + data.quem_pagou + ' (entrada): Compra ' + fornNome,
      valor:           data.valor_total,
      data_competencia:data.data_competencia,
      data_vencimento: dataPago,
      data_pagamento:  dataPago,
      status:          'pago',
      conta_id:        '',
      categoria_id:    catDevFiado,
      observacoes:     'Cobertura de compra paga por ' + data.quem_pagou,
    });
    // Reembolso pendente (empresa deve à pessoa)
    const catFiado = _findCategoria('Fiado ' + data.quem_pagou);
    const reemb = create('parcelas', {
      tipo:            'pagar',
      origem:          'fiado',
      origem_id:       '',
      cliente_id:      '',
      descricao:       'Reembolso ' + data.quem_pagou + ': Compra ' + fornNome,
      valor:           data.valor_total,
      data_competencia:data.data_competencia,
      data_vencimento: data.primeira_data_vencimento,
      data_pagamento:  '',
      status:          'pendente',
      conta_id:        '',
      categoria_id:    catFiado,
      observacoes:     data.observacoes || '',
    });
    // Registro fiado vinculado ao reembolso
    const fiado = create('fiado', {
      pessoa:          data.quem_pagou,
      descricao:       'Compra ' + fornNome,
      valor:           data.valor_total,
      data:            dataPago,
      parcela_pagar_id:reemb.data.id,
      status:          'pendente',
      observacoes:     data.observacoes || '',
    });
    if (fiado?.data?.id) {
      update('parcelas', reemb.data.id, { origem_id: fiado.data.id });
    }
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

function pagarParcela(data) {
  // data: { parcela_id, data_pagamento, conta_id }
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

// ─── HELPERS INTERNOS ───────────────────────────────────────
// Retorna o id de uma categoria pelo nome (busca na planilha)
function _findCategoria(nome) {
  try {
    const cats = sheetToRecords(getSheet('categorias'));
    return cats.find(c => c.nome === nome)?.id || '';
  } catch { return ''; }
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
