// ============================================================
// FINANCEIRO - Contas a Receber / Pagar
// ============================================================

const Financeiro = (() => {
  let allParcelas = [];
  let currentTab = 'receber'; // receber | pagar | resumo
  let _lastFiltered = [];    // cache do último resultado filtrado (para paginação)
  let _visibleCount = 30;    // quantos itens mostrar atualmente
  const PAGE_SIZE   = 30;
  let _filtroVenc7d = false; // quando true, mostra só vencendo nos próximos 7 dias

  async function render(params = {}) {
    if (!LocalConfig.getUrl()) {
      const section = qs('#page-financeiro');
      section.innerHTML = `
        <div class="page-header"><h1>Financeiro</h1></div>
        <div class="alert alert-info">
          ⚙️ Configure a URL do Apps Script em <strong>Configurações</strong> para usar o financeiro.
        </div>`;
      return;
    }
    if (params.filtro === 'vencendo7d') {
      _filtroVenc7d = true;
      currentTab = 'receber';
    }
    // loadGlobals garante que App.getContas() esteja populado (usado no resumo de saldos)
    await Promise.all([loadData(), App.loadGlobals()]);
    renderView();
  }

  async function loadData() {
    const shown = Loading.maybeShow('parcelas');
    const res = await API.db.read('parcelas');
    if (shown) Loading.hide();
    allParcelas = res?.data || [];
  }

  function renderView() {
    const section = qs('#page-financeiro');
    const mes = new Date().toISOString().substring(0, 7);

    section.innerHTML = `
      <div class="section-tabs">
        <button class="section-tab ${currentTab==='receber' ? 'active' : ''}" onclick="Financeiro.switchTab('receber')">↓ Receber</button>
        <button class="section-tab ${currentTab==='pagar' ? 'active' : ''}"   onclick="Financeiro.switchTab('pagar')">↑ Pagar</button>
        <button class="section-tab" onclick="App.navigate('fiado')">Fiado</button>
        <button class="section-tab" onclick="App.navigate('compras')">Compras</button>
        <button class="section-tab ${currentTab==='resumo' ? 'active' : ''}"  onclick="Financeiro.switchTab('resumo')">Resumo</button>
      </div>
      <div class="page-header">
        <h1>Financeiro</h1>
        <div style="display:flex;gap:8px">
          <button class="btn btn-outline btn-sm" onclick="Financeiro.openTransferencia()">↔ Transferir</button>
          <button class="btn btn-primary btn-sm" onclick="Financeiro.openManual()">+ Lançamento</button>
        </div>
      </div>

      <div id="fin-content"></div>
    `;

    renderTab();
  }

  function switchTab(tab) {
    currentTab = tab;
    // Re-renderiza tudo para que as section-tabs reflitam o estado ativo.
    // Para o resumo, recarrega os dados antes de renderizar (garante saldos atualizados).
    if (tab === 'resumo') {
      loadData().then(() => renderView());
    } else {
      renderView();
    }
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
          <div class="stat-label">${tipo === 'receber' ? 'Total Recebido' : 'Total Pago'}</div>
          <div class="stat-value">${Fmt.currency(totalPago)}</div>
        </div>
      </div>
      ${_filtroVenc7d ? `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 0 4px;flex-wrap:wrap">
        <span style="background:var(--warning-lt,#fff3cd);color:var(--warning,#856404);border:1px solid currentColor;border-radius:20px;padding:4px 12px;font-size:.82rem;font-weight:600;display:flex;align-items:center;gap:6px">
          ⏰ Vencendo nos próximos 7 dias
          <button type="button" onclick="Financeiro.limparFiltroVenc7d()"
            style="background:none;border:none;cursor:pointer;font-size:1rem;line-height:1;padding:0;color:inherit">×</button>
        </span>
      </div>
      ` : `
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
      `}
      <div class="card">
        <div id="fin-table" class="table-responsive"></div>
      </div>
    `;
    filtrar();
  }

  function limparFiltroVenc7d() {
    _filtroVenc7d = false;
    renderView();
  }

  function filtrar() {
    const tipo    = currentTab;
    const mes     = qs('#fin-mes')?.value || '';
    const status  = qs('#fin-status')?.value || '';
    const regime  = qs('#fin-regime')?.value || 'competencia';

    let items = allParcelas.filter(p => p.tipo === tipo);

    if (_filtroVenc7d) {
      // Filtro especial: pendentes vencendo nos próximos 7 dias
      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      const em7  = new Date(hoje); em7.setDate(em7.getDate() + 7);
      items = items.filter(p => {
        if (p.status !== 'pendente') return false;
        const d = new Date(p.data_vencimento + 'T00:00:00');
        return d >= hoje && d <= em7;
      });
      // Ordena do mais próximo ao mais distante
      items = [...items].sort((a, b) => (a.data_vencimento < b.data_vencimento ? -1 : 1));
    } else {
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
      // Mais recente primeiro
      items = [...items].sort((a, b) => (a.data_vencimento > b.data_vencimento ? -1 : 1));
    }

    _lastFiltered = items;
    _visibleCount = PAGE_SIZE;
    _renderTable();
  }

  function verMais() {
    _visibleCount += PAGE_SIZE;
    _renderTable();
  }

  function _renderTable() {
    if (!qs('#fin-table')) return;
    const tipo  = currentTab;
    const isRec = tipo === 'receber';
    const items = _lastFiltered;

    if (items.length === 0) {
      qs('#fin-table').innerHTML = '<div class="entity-empty">Nenhum lançamento encontrado</div>';
      return;
    }

    const shown   = items.slice(0, _visibleCount);
    const hasMore = items.length > _visibleCount;
    const total   = items.reduce((s, p) => s + Number(p.valor || 0), 0);

    qs('#fin-table').innerHTML = `
      <div class="entity-list" style="border-radius:0;border:none;box-shadow:none">
        ${shown.map(p => {
          const venc    = new Date(p.data_vencimento + 'T00:00:00');
          const hoje    = new Date();
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
          <div class="entity-info"><strong>Total (${items.length} registros)</strong></div>
          <div class="entity-right"><span class="entity-value">${Fmt.currency(total)}</span></div>
        </div>
        ${hasMore ? `
          <div style="text-align:center;padding:10px">
            <button class="btn btn-outline btn-sm" onclick="Financeiro.verMais()">
              Ver mais (${items.length - _visibleCount} restantes)
            </button>
          </div>` : ''}
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
    actions.push({ icon: '🗑', label: 'Excluir lançamento', fn: () => excluirParcela(id), danger: true });
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
    // Exclui transferências do regime de caixa (são neutras — saldo líquido = 0)
    const recCaixa= allParcelas.filter(p => p.tipo === 'receber' && p.status === 'pago' && p.origem !== 'transferencia' && String(p.data_pagamento||'').startsWith(mes));
    const pagCaixa= allParcelas.filter(p => p.tipo === 'pagar'   && p.status === 'pago' && p.origem !== 'transferencia' && String(p.data_pagamento||'').startsWith(mes));

    const sum = arr => arr.reduce((s, p) => s + Number(p.valor || 0), 0);

    const recTotalComp = sum(recComp);
    const pagTotalComp = sum(pagComp);
    const recTotalCaixa= sum(recCaixa);
    const pagTotalCaixa= sum(pagCaixa);

    // Saldos por conta — calculados sobre TODAS as parcelas pagas (não só do mês),
    // pois saldo é cumulativo. saldo_inicial NÃO é receita: só ponto de partida.
    const contas = App.getContas();
    const todasPagas = allParcelas.filter(p => p.status === 'pago');
    const saldosContas = contas.map(c => {
      const ini  = Number(c.saldo_inicial || 0);
      const ent  = todasPagas.filter(p => p.tipo === 'receber' && p.conta_id === c.id)
                             .reduce((s, p) => s + Number(p.valor || 0), 0);
      const sai  = todasPagas.filter(p => p.tipo === 'pagar'   && p.conta_id === c.id)
                             .reduce((s, p) => s + Number(p.valor || 0), 0);
      return { conta: c, inicial: ini, entradas: ent, saidas: sai, saldo: ini + ent - sai };
    });
    const semConta = todasPagas.filter(p => !p.conta_id).length;
    const saldoTotal = saldosContas.reduce((s, x) => s + x.saldo, 0);

    const resumoByCategoria = (arr) => {
      const map = {};
      arr.forEach(p => {
        const nome = App.categoriaNome(p.categoria_id);
        // categoriaNome retorna '—' quando não acha — '—' é truthy e engolia o fallback.
        // Aqui normalizamos: qualquer coisa sem categoria real vai para 'Sem Categoria'.
        const k = (nome && nome !== '—') ? nome : 'Sem Categoria';
        map[k] = (map[k] || 0) + Number(p.valor || 0);
      });
      return Object.entries(map).sort((a, b) => b[1] - a[1]);
    };

    qs('#resumo-content').innerHTML = `
      <div class="card mt-3">
        <div class="card-header">
          <h3>💳 Saldos das Contas</h3>
          <strong class="${saldoTotal >= 0 ? 'text-green' : 'text-red'}" style="font-size:1.1rem">
            ${Fmt.currency(saldoTotal)}
          </strong>
        </div>
        <div class="card-body">
          ${saldosContas.length === 0 ? `
            <p class="text-muted" style="text-align:center;margin:0">
              Nenhuma conta cadastrada. <a href="#" onclick="App.navigate('config');return false">Cadastrar em Configurações</a>.
            </p>
          ` : `
            <div class="stats-grid">
              ${saldosContas.map(s => `
                <div class="stat-card ${s.saldo >= 0 ? 'stat-green' : 'stat-red'}">
                  <div class="stat-label">${s.conta.nome}</div>
                  <div class="stat-value" style="font-size:1.05rem">${Fmt.currency(s.saldo)}</div>
                  <div class="stat-sub" style="font-size:.68rem">
                    inicial ${Fmt.currency(s.inicial)} · +${Fmt.currency(s.entradas)} −${Fmt.currency(s.saidas)}
                  </div>
                </div>
              `).join('')}
            </div>
            ${semConta > 0 ? `
              <p class="text-muted mt-2" style="font-size:.74rem">
                ⚠ ${semConta} parcela(s) paga(s) sem conta vinculada — não contam aqui. Edite-as para vincular.
              </p>
            ` : ''}
            <p style="font-size:.72rem;color:var(--text-muted);margin-top:8px;line-height:1.4">
              Saldo = saldo inicial + entradas pagas − saídas pagas (acumulado). Saldo inicial <strong>não</strong> entra nos resumos abaixo.
            </p>
          `}
        </div>
      </div>

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

  function calcNetValor() {
    const bruto = Number(qs('#manual-valor')?.value) || 0;
    const desc  = Number(qs('#manual-desconto')?.value) || 0;
    const row   = qs('#manual-valor-liq-row');
    if (!row) return;
    if (desc > 0 && bruto > 0) {
      row.textContent = `Valor líquido: ${Fmt.currency(Math.max(0, bruto - desc))}`;
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  }

  function openManual() {
    qs('#manual-save-btn').onclick = () => saveManual();
    qs('#manual-tipo').value   = 'pagar';
    qs('#manual-desc').value   = '';
    qs('#manual-valor').value  = '';
    qs('#manual-desconto').value = '0';
    if (qs('#manual-valor-liq-row')) qs('#manual-valor-liq-row').style.display = 'none';
    qs('#manual-comp').value   = DateUtil.today().substring(0, 7);
    qs('#manual-venc').value   = DateUtil.today();
    // Padrão: já pago hoje. Usuário muda pra "Pendente" se ainda não foi pago.
    qs('#manual-pagto').value  = DateUtil.today();
    qs('#manual-status').value = 'pago';
    qs('#manual-quempagou').value = '';
    qs('#manual-conta').innerHTML = App.contaOptions('', '— Selecione conta —');
    refreshManualSelects();
    qs('#manual-tipo').onchange = () => {
      refreshManualSelects();
      refreshQuemPagouVisibility();
    };
    qs('#manual-quempagou').onchange = () => refreshQuemPagouHint();
    refreshQuemPagouVisibility();
    refreshQuemPagouHint();
    qs('#manual-obs').value = '';
    Modal.open('modal-manual-lancamento');
  }

  // Mostra "Quem pagou?" apenas quando tipo='pagar' (despesa)
  function refreshQuemPagouVisibility() {
    const wrap = qs('#manual-quempagou-wrap');
    if (!wrap) return;
    const isPagar = qs('#manual-tipo').value === 'pagar';
    wrap.style.display = isPagar ? '' : 'none';
    if (!isPagar) qs('#manual-quempagou').value = '';
  }

  function refreshQuemPagouHint() {
    const hint = qs('#manual-quempagou-hint');
    if (!hint) return;
    const has = !!qs('#manual-quempagou').value;
    hint.classList.toggle('hidden', !has);
  }

  // Caso normal: cria 1 parcela como sempre.
  // Caso "Rodrigo/Odinei pagou": cria 3 parcelas + 1 fiado via batch:
  //   1) Despesa real (status=pago)         — sai do caixa do colaborador
  //   2) Receita-fiado (status=pago)        — entra no caixa equivalente
  //   3) Reembolso A-Pagar (status=pendente)— empresa deve a Rodrigo/Odinei
  //   + Registro 'fiado' vinculado à parcela #3
  async function saveManual() {
    const status   = qs('#manual-status').value;
    const tipo     = qs('#manual-tipo').value;
    const quemPagou = qs('#manual-quempagou')?.value || '';

    const desc     = qs('#manual-desc').value.trim();
    const valorBruto = Number(qs('#manual-valor').value) || 0;
    const desconto   = Number(qs('#manual-desconto')?.value) || 0;
    const valor      = Math.max(0, valorBruto - desconto);
    const compMonth= qs('#manual-comp').value;
    const venc     = qs('#manual-venc').value;
    const pagto    = qs('#manual-pagto').value;
    const categoria= qs('#manual-categoria').value;
    const cliente  = qs('#manual-cliente').value;
    const conta    = qs('#manual-conta')?.value || '';
    const obs      = qs('#manual-obs').value;

    if (!desc || !valor) { Toast.warning('Preencha descrição e valor'); return; }
    if (status === 'pago' && !conta) { Toast.warning('Selecione a conta quando o status for "Pago"'); return; }

    const compFull = (compMonth || DateUtil.today().substring(0,7)) + '-01';

    // Caminho especial: fiado integrado
    if (tipo === 'pagar' && quemPagou) {
      const dataPago = pagto || venc || DateUtil.today();
      // Busca categoria "Devolução de fiado" do cache (para a parcela de entrada)
      const catDevFiado = App.getCategorias().find(c => c.nome === 'Devolução de fiado')?.id || '';
      // Busca "Fiado <Pessoa>" para o reembolso (ex: "Fiado Rodrigo")
      // quemPagou vem minúsculo do select → capitalizar para casar com a categoria
      const quemFmt = quemPagou.charAt(0).toUpperCase() + quemPagou.slice(1);
      const catFiadoPessoa = App.getCategorias().find(c => c.nome === `Fiado ${quemFmt}`)?.id || '';
      Loading.show();
      // Para fiado integrado: a despesa real e a receita-fiado entram/saem
      // numa "conta virtual" do colaborador (não na conta da empresa).
      // 1ª parcela — A despesa real (saiu do caixa)
      const desp = await API.db.create('parcelas', {
        tipo: 'pagar', origem: 'fiado_pago', origem_id: '',
        cliente_id: cliente, descricao: desc, valor,
        data_competencia: compFull, data_vencimento: dataPago, data_pagamento: dataPago,
        status: 'pago', categoria_id: categoria, conta_id: '', observacoes: obs,
      });
      // 2ª parcela — A receita-fiado (entrou no caixa, do bolso)
      const rec = await API.db.create('parcelas', {
        tipo: 'receber', origem: 'fiado_pago', origem_id: '',
        cliente_id: '', descricao: `Fiado ${quemPagou} (entrada): ${desc}`, valor,
        data_competencia: compFull, data_vencimento: dataPago, data_pagamento: dataPago,
        status: 'pago', categoria_id: catDevFiado, conta_id: '', observacoes: `Cobertura de despesa paga por ${quemPagou}`,
      });
      // 3ª parcela — A pagar de reembolso (futuro)
      const reemb = await API.db.create('parcelas', {
        tipo: 'pagar', origem: 'fiado', origem_id: '',
        cliente_id: '', descricao: `Reembolso ${quemPagou}: ${desc}`, valor,
        data_competencia: compFull, data_vencimento: venc || dataPago, data_pagamento: '',
        status: 'pendente', categoria_id: catFiadoPessoa, conta_id: '', observacoes: obs,
      });
      // Registro fiado vinculado à parcela de reembolso
      if (reemb?.data?.id) {
        const fia = await API.db.create('fiado', {
          pessoa: quemPagou, descricao: desc, valor, data: dataPago,
          parcela_pagar_id: reemb.data.id, status: 'pendente', observacoes: obs,
        });
        // Sincroniza origem_id na parcela #3 pra apontar pro fiado
        if (fia?.data?.id) {
          await API.db.update('parcelas', reemb.data.id, { origem_id: fia.data.id });
        }
      }
      Loading.hide();
      Toast.success(`Lançado! 3 entradas + fiado de ${quemPagou} criados.`);
      Modal.close('modal-manual-lancamento');
      await loadData();
      renderView();
      return;
    }

    // Caminho normal: 1 parcela só
    const data = {
      tipo,
      origem:          'manual',
      origem_id:       '',
      cliente_id:      cliente,
      descricao:       desc,
      valor,
      data_competencia:compFull,
      data_vencimento: venc,
      data_pagamento:  status === 'pago' ? (pagto || DateUtil.today()) : '',
      status,
      categoria_id:    categoria,
      conta_id:        status === 'pago' ? conta : '',
      observacoes:     obs,
    };
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
    qs('#pag-conta').innerHTML   = App.contaOptions(p.conta_id || '', 'Selecione conta...');
    Modal.open('modal-pagamento');
  }

  async function confirmarPagamento() {
    const id     = qs('#pag-parcela-id').value;
    const data   = qs('#pag-data').value;
    const conta  = qs('#pag-conta').value;
    if (!data)  { Toast.warning('Informe a data de pagamento'); return; }
    if (!conta) { Toast.warning('Selecione a conta'); return; }
    Loading.show();
    const res = await API.db.pagarParcela({ parcela_id: id, data_pagamento: data, conta_id: conta });
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

    qs('#manual-tipo').value     = p.tipo;
    qs('#manual-desc').value     = p.descricao;
    qs('#manual-valor').value    = p.valor;
    qs('#manual-desconto').value = '0';
    if (qs('#manual-valor-liq-row')) qs('#manual-valor-liq-row').style.display = 'none';
    qs('#manual-comp').value   = Fmt.monthInput(p.data_competencia);
    qs('#manual-venc').value   = Fmt.dateInput(p.data_vencimento);
    qs('#manual-pagto').value  = Fmt.dateInput(p.data_pagamento);
    qs('#manual-status').value = p.status;
    qs('#manual-conta').innerHTML = App.contaOptions(p.conta_id || '', '— Selecione (quando pago) —');
    refreshManualSelects(p.cliente_id, p.categoria_id);
    qs('#manual-tipo').onchange = () => refreshManualSelects();
    qs('#manual-obs').value    = p.observacoes || '';
    qs('#manual-save-btn').onclick = async () => {
      const status = qs('#manual-status').value;
      const contaEdit = qs('#manual-conta')?.value || '';
      if (status === 'pago' && !contaEdit) { Toast.warning('Selecione a conta quando o status for "Pago"'); return; }
      const data = {
        tipo:            qs('#manual-tipo').value,
        cliente_id:      qs('#manual-cliente').value,
        descricao:       qs('#manual-desc').value,
        valor:           Number(qs('#manual-valor').value) || 0,
        data_competencia:qs('#manual-comp').value + '-01',
        data_vencimento: qs('#manual-venc').value,
        // Se voltar para pendente/cancelado, zera data_pagamento e conta_id pra não distorcer caixa
        data_pagamento:  status === 'pago' ? (qs('#manual-pagto').value || DateUtil.today()) : '',
        conta_id:        status === 'pago' ? contaEdit : '',
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

  async function excluirParcela(id) {
    const p = allParcelas.find(x => x.id === id);
    const aviso = p?.origem === 'os' || p?.origem === 'compra'
      ? `Esta parcela foi gerada por uma ${p.origem === 'os' ? 'OS' : 'compra'}. Excluir aqui remove só o lançamento financeiro — a ${p.origem === 'os' ? 'OS' : 'compra'} continua. Continuar?`
      : 'Excluir este lançamento? Esta ação não pode ser desfeita.';
    Modal.confirm(aviso, async () => {
      const ops = [{ action: 'delete', sheet: 'parcelas', id }];
      // Se for parcela de fiado, remove o registro fiado também pra manter sincronia
      if (p && p.origem === 'fiado' && p.origem_id) {
        ops.push({ action: 'delete', sheet: 'fiado', id: p.origem_id });
      }
      Loading.show();
      const res = await API.db.batch(ops);
      Loading.hide();
      if (!res?.success) { Toast.error('Erro ao excluir'); return; }
      Toast.success('Excluído');
      await loadData(); filtrar();
    });
  }

  // ─── TRANSFERÊNCIA ──────────────────────────────────────────
  function openTransferencia() {
    qs('#transf-origem').innerHTML  = App.contaOptions('', '— Conta de origem —');
    qs('#transf-destino').innerHTML = App.contaOptions('', '— Conta de destino —');
    qs('#transf-valor').value = '';
    qs('#transf-data').value  = DateUtil.today();
    qs('#transf-obs').value   = '';
    Modal.open('modal-transferencia');
  }

  async function salvarTransferencia() {
    const origem  = qs('#transf-origem').value;
    const destino = qs('#transf-destino').value;
    const valor   = Number(qs('#transf-valor').value) || 0;
    const data    = qs('#transf-data').value;
    const obs     = qs('#transf-obs').value.trim();

    if (!origem)             { Toast.warning('Selecione a conta de origem');            return; }
    if (!destino)            { Toast.warning('Selecione a conta de destino');           return; }
    if (origem === destino)  { Toast.warning('Origem e destino devem ser diferentes');  return; }
    if (!valor)              { Toast.warning('Informe o valor');                        return; }
    if (!data)               { Toast.warning('Informe a data');                         return; }

    const contas      = App.getContas();
    const origemNome  = contas.find(c => c.id === origem)?.nome  || '';
    const destinoNome = contas.find(c => c.id === destino)?.nome || '';
    const desc = `Transferência: ${origemNome} → ${destinoNome}`;
    const comp = data.substring(0, 7) + '-01';

    Loading.show();
    const res = await API.db.batch([
      // Saída da conta origem
      { action: 'create', sheet: 'parcelas', data: {
          tipo: 'pagar', origem: 'transferencia', origem_id: '',
          cliente_id: '', descricao: desc, valor,
          data_competencia: comp, data_vencimento: data,
          data_pagamento: data, status: 'pago',
          conta_id: origem, observacoes: obs,
      }},
      // Entrada na conta destino
      { action: 'create', sheet: 'parcelas', data: {
          tipo: 'receber', origem: 'transferencia', origem_id: '',
          cliente_id: '', descricao: desc, valor,
          data_competencia: comp, data_vencimento: data,
          data_pagamento: data, status: 'pago',
          conta_id: destino, observacoes: obs,
      }},
    ]);
    Loading.hide();

    if (res?.success) {
      Toast.success(`${Fmt.currency(valor)} transferidos de ${origemNome} para ${destinoNome}`);
      Modal.close('modal-transferencia');
      await loadData();
      renderView();
    } else {
      Toast.error('Erro ao registrar transferência');
    }
  }

  return { render, switchTab, filtrar, limparFiltroVenc7d, verMais, calcNetValor,
           renderResumo, renderResumoMes,
           openManual, saveManual, openPagamento, confirmarPagamento,
           openTransferencia, salvarTransferencia,
           editarParcela, excluirParcela, tapParcela };
})();
