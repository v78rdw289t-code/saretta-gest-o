// ============================================================
// FINANCEIRO - Contas a Receber / Pagar
// ============================================================

const Financeiro = (() => {
  let allParcelas = [];
  let currentTab = 'receber'; // receber | pagar | resumo

  async function render() {
    if (!LocalConfig.getUrl()) {
      const section = qs('#page-financeiro');
      section.innerHTML = `
        <div class="page-header"><h1>Financeiro</h1></div>
        <div class="alert alert-info">
          ⚙️ Configure a URL do Apps Script em <strong>Configurações</strong> para usar o financeiro.
        </div>`;
      return;
    }
    await loadData();
    renderView();
  }

  async function loadData() {
    Loading.show();
    const res = await API.db.read('parcelas');
    Loading.hide();
    allParcelas = res?.data || [];
  }

  function renderView() {
    const section = qs('#page-financeiro');
    const mes = new Date().toISOString().substring(0, 7);

    section.innerHTML = `
      <div class="section-tabs">
        <button class="section-tab ${currentTab==='receber' ? 'active' : ''}" onclick="Financeiro.switchTab('receber')">↓ A Receber</button>
        <button class="section-tab ${currentTab==='pagar' ? 'active' : ''}"   onclick="Financeiro.switchTab('pagar')">↑ A Pagar</button>
        <button class="section-tab" onclick="App.navigate('fiado')">💸 Fiado</button>
        <button class="section-tab" onclick="App.navigate('compras')">🛍️ Compras</button>
        <button class="section-tab ${currentTab==='resumo' ? 'active' : ''}"  onclick="Financeiro.switchTab('resumo')">📊 Resumo</button>
      </div>
      <div class="page-header">
        <h1>Financeiro</h1>
        <button class="btn btn-primary" onclick="Financeiro.openManual()">+ Lançamento Manual</button>
      </div>

      <div id="fin-content"></div>
    `;

    renderTab();
  }

  function switchTab(tab) {
    currentTab = tab;
    // Re-renderiza tudo para que as section-tabs reflitam o estado ativo
    renderView();
  }

  function renderTab() {
    if (currentTab === 'resumo') { renderResumo(); return; }
    renderParcelas(currentTab);
  }

  function renderParcelas(tipo) {
    const mesAtual = new Date().toISOString().substring(0, 7);
    let items = allParcelas.filter(p => p.tipo === tipo);

    const totalPendente = items.filter(p => p.status === 'pendente').reduce((s, p) => s + Number(p.valor || 0), 0);
    const totalPago     = items.filter(p => p.status === 'pago').reduce((s, p) => s + Number(p.valor || 0), 0);

    qs('#fin-content').innerHTML = `
      <div class="stats-grid mb-4">
        <div class="stat-card stat-${tipo === 'receber' ? 'green' : 'red'}">
          <div class="stat-label">Total Pendente</div>
          <div class="stat-value">${Fmt.currency(totalPendente)}</div>
        </div>
        <div class="stat-card stat-blue">
          <div class="stat-label">Total Pago</div>
          <div class="stat-value">${Fmt.currency(totalPago)}</div>
        </div>
      </div>
      <div class="filters-bar">
        <input type="month" id="fin-mes" class="input-select" value="${mesAtual}" onchange="Financeiro.filtrar()">
        <select id="fin-status" class="input-select" onchange="Financeiro.filtrar()">
          <option value="">Todos</option>
          <option value="pendente">Pendente</option>
          <option value="pago">Pago</option>
          <option value="cancelado">Cancelado</option>
        </select>
        <select id="fin-regime" class="input-select" onchange="Financeiro.filtrar()">
          <option value="competencia">Competência</option>
          <option value="caixa">Caixa</option>
        </select>
      </div>
      <div class="card">
        <div id="fin-table" class="table-responsive"></div>
      </div>
    `;
    filtrar();
  }

  function filtrar() {
    const tipo    = currentTab;
    const mes     = qs('#fin-mes')?.value || '';
    const status  = qs('#fin-status')?.value || '';
    const regime  = qs('#fin-regime')?.value || 'competencia';

    let items = allParcelas.filter(p => p.tipo === tipo);
    if (status) items = items.filter(p => p.status === status);
    if (mes) {
      if (regime === 'competencia') {
        items = items.filter(p => String(p.data_competencia || '').substring(0, 7) === mes);
      } else {
        items = items.filter(p => {
          if (p.status === 'pago') return String(p.data_pagamento || '').substring(0, 7) === mes;
          return String(p.data_vencimento || '').substring(0, 7) === mes;
        });
      }
    }
    items = [...items].sort((a, b) => (a.data_vencimento > b.data_vencimento ? 1 : -1));

    if (!qs('#fin-table')) return;
    if (items.length === 0) { qs('#fin-table').innerHTML = '<div class="entity-empty">Nenhum lançamento encontrado</div>'; return; }

    const total = items.reduce((s, p) => s + Number(p.valor || 0), 0);
    const isRec = tipo === 'receber';

    qs('#fin-table').innerHTML = `
      <div class="entity-list" style="border-radius:0;border:none;box-shadow:none">
        ${items.map(p => {
          const venc   = new Date(p.data_vencimento + 'T00:00:00');
          const hoje   = new Date();
          const vencido = p.status === 'pendente' && venc < hoje;
          const clienteNome = App.clienteNome(p.cliente_id);
          return `
            <div class="entity-item${vencido ? '" style="background:var(--danger-lt)' : ''}" onclick="Financeiro.tapParcela('${p.id}')">
              <div class="avatar avatar-sm ${isRec ? 'av-green' : 'av-red'}">${isRec ? '↓' : '↑'}</div>
              <div class="entity-info">
                <div class="entity-name">${p.descricao}</div>
                <div class="entity-sub">${clienteNome ? clienteNome + ' · ' : ''}Venc. ${Fmt.date(p.data_vencimento)}${vencido ? ' ⚠' : ''}</div>
              </div>
              <div class="entity-right">
                <span class="entity-value ${isRec ? 'text-green' : 'text-red'}">${Fmt.currency(p.valor)}</span>
                ${statusBadge(p.status)}
              </div>
            </div>
          `;
        }).join('')}
        <div class="entity-item" style="background:var(--bg);cursor:default">
          <div class="entity-info"><strong>Total</strong></div>
          <div class="entity-right"><span class="entity-value">${Fmt.currency(total)}</span></div>
        </div>
      </div>
    `;
  }

  function tapParcela(id) {
    const p = allParcelas.find(x => x.id === id);
    if (!p) return;
    const actions = [];
    if (p.status === 'pendente') {
      actions.push({ icon: '💰', label: 'Registrar Pagamento', fn: () => openPagamento(id) });
    }
    actions.push({ icon: '✏️', label: 'Editar', fn: () => editarParcela(id) });
    actions.push({ icon: '✕', label: 'Cancelar lançamento', fn: () => cancelarParcela(id), danger: true });
    ActionSheet.open(p.descricao, actions);
  }

  function renderResumo() {
    const mes = new Date().toISOString().substring(0, 7);
    qs('#fin-content').innerHTML = `
      <div class="filters-bar">
        <label>Mês: <input type="month" id="resumo-mes" class="input-select" value="${mes}" onchange="Financeiro.renderResumoMes()"></label>
      </div>
      <div id="resumo-content"></div>
    `;
    renderResumoMes();
  }

  function renderResumoMes() {
    const mes = qs('#resumo-mes')?.value || new Date().toISOString().substring(0, 7);

    const recComp = allParcelas.filter(p => p.tipo === 'receber' && String(p.data_competencia||'').startsWith(mes));
    const pagComp = allParcelas.filter(p => p.tipo === 'pagar'   && String(p.data_competencia||'').startsWith(mes));
    const recCaixa= allParcelas.filter(p => p.tipo === 'receber' && p.status === 'pago' && String(p.data_pagamento||'').startsWith(mes));
    const pagCaixa= allParcelas.filter(p => p.tipo === 'pagar'   && p.status === 'pago' && String(p.data_pagamento||'').startsWith(mes));

    const sum = arr => arr.reduce((s, p) => s + Number(p.valor || 0), 0);

    const recTotalComp = sum(recComp);
    const pagTotalComp = sum(pagComp);
    const recTotalCaixa= sum(recCaixa);
    const pagTotalCaixa= sum(pagCaixa);

    const resumoByCategoria = (arr) => {
      const map = {};
      arr.forEach(p => {
        const k = App.categoriaNome(p.categoria_id) || 'Sem Categoria';
        map[k] = (map[k] || 0) + Number(p.valor || 0);
      });
      return Object.entries(map).sort((a, b) => b[1] - a[1]);
    };

    qs('#resumo-content').innerHTML = `
      <div class="grid-2col mt-3">
        <div class="card">
          <div class="card-header"><h3>Regime de Competência</h3><span class="badge badge-info">${mes}</span></div>
          <div class="card-body">
            <div class="info-row">
              <span>Receitas (a receber)</span>
              <strong class="text-green">${Fmt.currency(recTotalComp)}</strong>
            </div>
            <div class="info-row">
              <span>Despesas (a pagar)</span>
              <strong class="text-red">${Fmt.currency(pagTotalComp)}</strong>
            </div>
            <div class="info-row total-row">
              <span><strong>Resultado</strong></span>
              <strong class="${recTotalComp - pagTotalComp >= 0 ? 'text-green' : 'text-red'}">${Fmt.currency(recTotalComp - pagTotalComp)}</strong>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Regime de Caixa</h3><span class="badge badge-info">${mes}</span></div>
          <div class="card-body">
            <div class="info-row">
              <span>Entradas pagas</span>
              <strong class="text-green">${Fmt.currency(recTotalCaixa)}</strong>
            </div>
            <div class="info-row">
              <span>Saídas pagas</span>
              <strong class="text-red">${Fmt.currency(pagTotalCaixa)}</strong>
            </div>
            <div class="info-row total-row">
              <span><strong>Saldo em Caixa</strong></span>
              <strong class="${recTotalCaixa - pagTotalCaixa >= 0 ? 'text-green' : 'text-red'}">${Fmt.currency(recTotalCaixa - pagTotalCaixa)}</strong>
            </div>
          </div>
        </div>
      </div>

      <div class="grid-2col mt-3">
        <div class="card">
          <div class="card-header"><h3>Receitas por Categoria (competência)</h3></div>
          <div class="card-body">
            ${resumoByCategoria(recComp).map(([k, v]) => `
              <div class="info-row">
                <span>${k}</span><strong class="text-green">${Fmt.currency(v)}</strong>
              </div>
            `).join('') || '<p class="text-muted">Sem dados</p>'}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Despesas por Categoria (competência)</h3></div>
          <div class="card-body">
            ${resumoByCategoria(pagComp).map(([k, v]) => `
              <div class="info-row">
                <span>${k}</span><strong class="text-red">${Fmt.currency(v)}</strong>
              </div>
            `).join('') || '<p class="text-muted">Sem dados</p>'}
          </div>
        </div>
      </div>
    `;
  }

  // Atualiza os selects de cliente/categoria conforme o tipo (receber/pagar)
  // Mantém o valor selecionado se já estava válido.
  function refreshManualSelects(curCliente = '', curCategoria = '') {
    const tipo = qs('#manual-tipo')?.value || 'pagar';
    const tipoCliente   = tipo === 'receber' ? 'cliente'  : 'fornecedor';
    const tipoCategoria = tipo === 'receber' ? 'entrada'  : 'saida';
    qs('#manual-cliente').innerHTML   = App.clienteOptions(tipoCliente, curCliente);
    qs('#manual-categoria').innerHTML = App.categoriaOptions(tipoCategoria, curCategoria);
  }

  function openManual() {
    qs('#manual-save-btn').onclick = () => saveManual();
    qs('#manual-tipo').value   = 'pagar';
    qs('#manual-desc').value   = '';
    qs('#manual-valor').value  = '';
    qs('#manual-comp').value   = DateUtil.today().substring(0, 7);
    qs('#manual-venc').value   = DateUtil.today();
    qs('#manual-pagto').value  = '';
    qs('#manual-status').value = 'pendente';
    refreshManualSelects();
    qs('#manual-tipo').onchange = () => refreshManualSelects();
    qs('#manual-obs').value = '';
    Modal.open('modal-manual-lancamento');
  }

  async function saveManual() {
    const status = qs('#manual-status').value;
    const data = {
      tipo:            qs('#manual-tipo').value,
      origem:          'manual',
      origem_id:       '',
      cliente_id:      qs('#manual-cliente').value,
      descricao:       qs('#manual-desc').value,
      valor:           Number(qs('#manual-valor').value) || 0,
      data_competencia:qs('#manual-comp').value + '-01',
      data_vencimento: qs('#manual-venc').value,
      data_pagamento:  status === 'pago' ? (qs('#manual-pagto').value || DateUtil.today()) : '',
      status,
      categoria_id:    qs('#manual-categoria').value,
      observacoes:     qs('#manual-obs').value,
    };
    if (!data.descricao || !data.valor) { Toast.warning('Preencha descrição e valor'); return; }

    Loading.show();
    const res = await API.db.create('parcelas', data);
    Loading.hide();
    if (res?.success) {
      Toast.success('Lançamento criado!');
      Modal.close('modal-manual-lancamento');
      await loadData();
      renderView();
    } else Toast.error('Erro: ' + res?.error);
  }

  function openPagamento(id) {
    const p = allParcelas.find(x => x.id === id);
    if (!p) return;
    qs('#pag-parcela-id').value  = id;
    qs('#pag-valor').textContent = Fmt.currency(p.valor);
    qs('#pag-data').value        = DateUtil.today();
    Modal.open('modal-pagamento');
  }

  async function confirmarPagamento() {
    const id   = qs('#pag-parcela-id').value;
    const data = qs('#pag-data').value;
    if (!data) { Toast.warning('Informe a data de pagamento'); return; }
    Loading.show();
    const res = await API.db.pagarParcela({ parcela_id: id, data_pagamento: data });
    Loading.hide();
    if (res?.success) {
      Toast.success('Pagamento registrado!');
      Modal.close('modal-pagamento');
      await loadData();
      filtrar();
    } else Toast.error('Erro: ' + res?.error);
  }

  async function editarParcela(id) {
    const p = allParcelas.find(x => x.id === id);
    if (!p) return;

    // Parcelas geradas por fiado devem ser editadas pelo módulo Fiado
    // para manter o registro fiado sincronizado.
    if (p.origem === 'fiado' && p.origem_id) {
      Modal.confirm(
        'Esta parcela é de um fiado. Para manter os registros sincronizados, edite pelo módulo Fiado. Deseja abrir agora?',
        () => { App.navigate('fiado'); setTimeout(() => Fiado.openForm(p.origem_id), 200); }
      );
      return;
    }

    qs('#manual-tipo').value   = p.tipo;
    qs('#manual-desc').value   = p.descricao;
    qs('#manual-valor').value  = p.valor;
    qs('#manual-comp').value   = String(p.data_competencia || '').substring(0, 7);
    qs('#manual-venc').value   = p.data_vencimento;
    qs('#manual-pagto').value  = p.data_pagamento || '';
    qs('#manual-status').value = p.status;
    refreshManualSelects(p.cliente_id, p.categoria_id);
    qs('#manual-tipo').onchange = () => refreshManualSelects();
    qs('#manual-obs').value    = p.observacoes || '';
    qs('#manual-save-btn').onclick = async () => {
      const status = qs('#manual-status').value;
      const data = {
        tipo:            qs('#manual-tipo').value,
        cliente_id:      qs('#manual-cliente').value,
        descricao:       qs('#manual-desc').value,
        valor:           Number(qs('#manual-valor').value) || 0,
        data_competencia:qs('#manual-comp').value + '-01',
        data_vencimento: qs('#manual-venc').value,
        // Se voltar para pendente/cancelado, zera data_pagamento para não distorcer regime de caixa
        data_pagamento:  status === 'pago' ? (qs('#manual-pagto').value || DateUtil.today()) : '',
        status,
        categoria_id:    qs('#manual-categoria').value,
        observacoes:     qs('#manual-obs').value,
      };
      const res = await API.db.update('parcelas', id, data);
      if (res?.success) {
        Toast.success('Atualizado!');
        Modal.close('modal-manual-lancamento');
        await loadData(); filtrar();
      } else Toast.error('Erro: ' + res?.error);
    };
    Modal.open('modal-manual-lancamento');
  }

  async function cancelarParcela(id) {
    const p = allParcelas.find(x => x.id === id);
    Modal.confirm('Cancelar este lançamento?', async () => {
      const ops = [{ action: 'update', sheet: 'parcelas', id, data: { status: 'cancelado' } }];
      // Se for parcela de fiado, cancelar o fiado também para manter sincronia
      if (p && p.origem === 'fiado' && p.origem_id) {
        ops.push({ action: 'update', sheet: 'fiado', id: p.origem_id, data: { status: 'cancelado' } });
      }
      await API.db.batch(ops);
      Toast.success('Cancelado');
      await loadData(); filtrar();
    });
  }

  return { render, switchTab, filtrar, renderResumo, renderResumoMes,
           openManual, saveManual, openPagamento, confirmarPagamento,
           editarParcela, cancelarParcela, tapParcela };
})();
