// ============================================================
// FINANCEIRO - Contas a Receber / Pagar
// ============================================================

const Financeiro = (() => {
  let allParcelas = [];
  let allOS = [], allDiarias = []; // p/ resolver a categoria efetiva das parcelas de OS
  let comprasItensByCompra = {};   // p/ ratear a despesa da compra pelas categorias dos itens
  let fechamentoOsByFech   = {};   // p/ ratear a parcela de lote de OS pelas categorias das OS
  let allRecorrentes = [];         // contas fixas (card no Resumo)
  let _recEditId = null;           // id da recorrente sendo editada no modal manual
  let _compTocada = false;         // usuário mexeu na competência à mão? (senão, derivada da data)
  let currentTab = 'receber'; // receber | pagar | resumo
  let _lastFiltered = [];    // cache do último resultado filtrado (para paginação)
  let _visibleCount = 30;    // quantos itens mostrar atualmente
  const PAGE_SIZE   = 30;
  let _filtroVenc7d = false; // quando true, mostra só vencendo nos próximos 7 dias

  // Estado dos filtros persistido entre tabs
  let _filtros = {
    busca: '', periodoTipo: 'mes', mes: '', dataIni: '', dataFim: '',
    status: '', regime: 'competencia',
    categoria: '', cliente: '', conta: '', sort: 'venc_desc',
  };
  let _filterOpen = false;
  let _filtroAbertos = null; // null | 'pendente' | 'vencido'

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
    // Ao entrar no módulo: reseta filtro especial e volta para aba receber
    _filtroVenc7d = params.filtro === 'vencendo7d';
    _filtroAbertos = null;
    currentTab = (params.tab === 'pagar' || params.tab === 'resumo') ? params.tab : 'receber';
    _filtros.periodoTipo = 'mes';
    _filtros.dataIni = ''; _filtros.dataFim = '';
    // Demais filtros começam limpos a cada entrada
    _filtros.categoria = ''; _filtros.cliente = ''; _filtros.conta = ''; _filtros.busca = '';
    if (params.status) {
      // Veio de um atalho (ex: "recebimentos em aberto" do dashboard):
      // filtra pelo status e mostra TODOS os meses (pendentes acumulam de meses anteriores)
      _filtros.status = params.status;
      _filtros.mes = '';
      _filterOpen = true;
    } else {
      _filtros.status = '';
      _filtros.mes = new Date().toISOString().substring(0, 7);
      _filterOpen = false;
    }
    // loadGlobals garante que App.getContas() esteja populado (usado no resumo de saldos)
    await Promise.all([loadData(), App.loadGlobals()]);
    renderView();
  }

  async function loadData() {
    const shown = Loading.maybeShow('parcelas');
    // OS + sessões são usadas só p/ resolver a categoria efetiva das parcelas de OS
    const [res, osRes, diRes, ciRes, foRes, recRes] = await Promise.all([
      API.db.read('parcelas'),
      API.db.read('os'),
      API.db.read('diarias'),
      API.db.read('compras_itens'),
      API.db.read('fechamento_os'),
      API.db.read('recorrentes'), // pré-initDB volta [] (readMany) ou erro gracioso
    ]);
    if (shown) Loading.hide();
    allParcelas = res?.data || [];
    allOS       = osRes?.data || [];
    allDiarias  = diRes?.data || [];
    comprasItensByCompra = agruparComprasItens(ciRes?.data || []);
    fechamentoOsByFech   = agruparFechamentoOs(foRes?.data || []);
    allRecorrentes = recRes?.data || [];
  }

  // Categoria efetiva de uma parcela (sessões → OS → parcela; lote → predominante) — utils.js
  function _catEfetivaId(p) { return categoriaEfetivaId(p, allOS, allDiarias, fechamentoOsByFech); }
  // Contexto p/ ratear compra (itens) e lote de OS (fechamento_os) por categoria — utils.js
  function _ctxCat() { return { osList: allOS, diarias: allDiarias, comprasItensByCompra, fechamentoOsByFech }; }

  function renderView() {
    const section = qs('#page-financeiro');

    section.innerHTML = `
      <div class="section-tabs">
        <button class="section-tab ${currentTab==='receber' ? 'active' : ''}" onclick="Financeiro.switchTab('receber')">↓ Receber</button>
        <button class="section-tab ${currentTab==='pagar' ? 'active' : ''}"   onclick="Financeiro.switchTab('pagar')">↑ Pagar</button>
        <button class="section-tab" onclick="App.navigate('fiado')">Fiado</button>
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
    _filtroAbertos = null;
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
    const isRec = tipo === 'receber';

    qs('#fin-content').innerHTML = `
      <div class="fin-periodo-bar">
        <span id="fin-periodo-label" class="fin-periodo-label"></span>
        ${_filtroVenc7d ? '' : `<button class="fin-periodo-edit" onclick="Financeiro.openPeriodo()">alterar</button>`}
      </div>
      <div class="stats-grid-4">
        <div class="stat-card stat-${isRec ? 'gold' : 'orange'}" onclick="Financeiro.verAbertos('pendente')" style="cursor:pointer">
          <div class="stat-label">Pendente</div>
          <div class="stat-value" id="stat-pendente">—</div>
          <div class="stat-sub" id="stat-pendente-ct"></div>
        </div>
        <div class="stat-card stat-red" onclick="Financeiro.verAbertos('vencido')" style="cursor:pointer">
          <div class="stat-label">Vencido</div>
          <div class="stat-value" id="stat-vencido">—</div>
          <div class="stat-sub" id="stat-vencido-ct"></div>
        </div>
        <div class="stat-card stat-${isRec ? 'green' : 'blue'}">
          <div class="stat-label">${isRec ? 'Recebido' : 'Pago'}</div>
          <div class="stat-value" id="stat-pago">—</div>
          <div class="stat-sub" id="stat-pago-ct"></div>
        </div>
        <div class="stat-card stat-navy">
          <div class="stat-label">7 dias</div>
          <div class="stat-value" id="stat-7d">—</div>
          <div class="stat-sub" id="stat-7d-ct"></div>
        </div>
      </div>

      ${_filtroVenc7d ? `
        <div style="display:flex;align-items:center;gap:8px;padding:4px 0 10px;flex-wrap:wrap">
          <span style="background:var(--warning-lt);color:var(--warning);border:1px solid currentColor;border-radius:20px;padding:4px 12px;font-size:.82rem;font-weight:600;display:flex;align-items:center;gap:6px">
            ⏰ Vencendo nos próximos 7 dias
            <button type="button" onclick="Financeiro.limparFiltroVenc7d()"
              style="background:none;border:none;cursor:pointer;font-size:1rem;line-height:1;padding:0;color:inherit">×</button>
          </span>
        </div>
      ` : `
        <div class="fin-search-row">
          <input type="search" id="fin-busca" class="input-search" placeholder="Buscar descrição..."
            value="${_filtros.busca}" oninput="Financeiro.onBuscaInput(this.value)">
          <button class="btn-filter-toggle ${_filterOpen ? 'active' : ''}" id="btn-filter-toggle"
            onclick="Financeiro.toggleFilterPanel()">
            Filtros <span id="filter-badge-wrap"></span>
          </button>
        </div>
        <div id="fin-filter-panel" class="fin-filter-panel" style="${_filterOpen ? '' : 'display:none'}">
          <div class="form-group ${_filtros.periodoTipo === 'intervalo' ? 'full-col' : ''}">
            <label>Período</label>
            <select id="fin-periodo-tipo" onchange="Financeiro.onPeriodoTipoChange()">
              <option value="mes"       ${_filtros.periodoTipo!=='intervalo'?'selected':''}>Por mês</option>
              <option value="intervalo" ${_filtros.periodoTipo==='intervalo'?'selected':''}>Intervalo de datas</option>
            </select>
          </div>
          ${_filtros.periodoTipo === 'intervalo' ? `
            <div class="form-group">
              <label>De</label>
              <input type="date" id="fin-data-ini" value="${_filtros.dataIni}" onchange="Financeiro.onFilterChange()">
            </div>
            <div class="form-group">
              <label>Até</label>
              <input type="date" id="fin-data-fim" value="${_filtros.dataFim}" onchange="Financeiro.onFilterChange()">
            </div>
          ` : `
            <div class="form-group">
              <label>Mês</label>
              ${MonthPicker.render('fin-mes', _filtros.mes, 'Financeiro.onFilterChange()')}
            </div>
          `}
          <div class="form-group">
            <label>Status</label>
            <select id="fin-status" onchange="Financeiro.onFilterChange()">
              <option value="">Todos</option>
              <option value="pendente" ${_filtros.status==='pendente'?'selected':''}>Pendente</option>
              <option value="pago"     ${_filtros.status==='pago'?'selected':''}>Pago</option>
              <option value="cancelado"${_filtros.status==='cancelado'?'selected':''}>Cancelado</option>
            </select>
          </div>
          <div class="form-group">
            <label>Regime</label>
            <select id="fin-regime" onchange="Financeiro.onFilterChange()">
              <option value="competencia" ${_filtros.regime==='competencia'?'selected':''}>Competência</option>
              <option value="caixa"       ${_filtros.regime==='caixa'?'selected':''}>Caixa</option>
            </select>
          </div>
          <div class="form-group">
            <label>Categoria</label>
            <select id="fin-categoria" onchange="Financeiro.onFilterChange()">
              <option value="">Todas</option>
              ${App.getCategorias().filter(c => c.tipo === (isRec ? 'entrada' : 'saida') || c.tipo === 'ambos')
                .map(c => `<option value="${c.id}" ${_filtros.categoria===c.id?'selected':''}>${c.nome}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>${isRec ? 'Cliente' : 'Fornecedor'}</label>
            <select id="fin-cliente" onchange="Financeiro.onFilterChange()">
              <option value="">Todos</option>
              ${App.getClientes().map(c => `<option value="${c.id}" ${_filtros.cliente===c.id?'selected':''}>${c.nome}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Conta</label>
            <select id="fin-conta" onchange="Financeiro.onFilterChange()">
              <option value="">Todas</option>
              ${App.getContas().map(c => `<option value="${c.id}" ${_filtros.conta===c.id?'selected':''}>${c.nome}</option>`).join('')}
            </select>
          </div>
          <div class="full-col" style="display:flex;justify-content:flex-end">
            <button class="btn btn-outline btn-sm" onclick="Financeiro.limparFiltros()">Limpar filtros</button>
          </div>
        </div>
        <div id="fin-active-chips" class="fin-active-chips"></div>
      `}

      <div id="fin-sort-row" class="fin-sort-row">
        <span class="count-label" id="fin-count"></span>
        <button class="btn-sort" onclick="Financeiro.toggleSort()" id="btn-sort" title="Ordenar">
          <span id="sort-label">Data ↓</span>
        </button>
      </div>

      <div class="card">
        <div id="fin-table"></div>
      </div>
    `;
    filtrar();
  }

  function limparFiltroVenc7d() {
    _filtroVenc7d = false;
    renderView();
  }

  function onBuscaInput(val) {
    _filtros.busca = val;
    filtrar();
  }

  function onFilterChange() {
    // ?? mantém o valor quando o input não está no DOM (modo mês vs intervalo)
    _filtros.mes       = MonthPicker.value('fin-mes') || _filtros.mes;
    _filtros.dataIni   = qs('#fin-data-ini')?.value  ?? _filtros.dataIni;
    _filtros.dataFim   = qs('#fin-data-fim')?.value  ?? _filtros.dataFim;
    _filtros.status    = qs('#fin-status')?.value    || '';
    _filtros.regime    = qs('#fin-regime')?.value    || 'competencia';
    _filtros.categoria = qs('#fin-categoria')?.value || '';
    _filtros.cliente   = qs('#fin-cliente')?.value   || '';
    _filtros.conta     = qs('#fin-conta')?.value     || '';
    filtrar();
  }

  function onPeriodoTipoChange() {
    _filtros.periodoTipo = qs('#fin-periodo-tipo')?.value || 'mes';
    // Ao entrar em "intervalo" sem datas, pré-preenche com o mês selecionado
    if (_filtros.periodoTipo === 'intervalo' && !_filtros.dataIni && !_filtros.dataFim) {
      const p = _periodoFromMes(_filtros.mes);
      _filtros.dataIni = p.ini;
      _filtros.dataFim = p.fim;
    }
    renderParcelas(currentTab); // re-render mantém o painel aberto
  }

  // Abre o painel de filtros já com o foco no período
  function openPeriodo() {
    if (!_filterOpen) toggleFilterPanel();
    qs('#fin-filter-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function toggleFilterPanel() {
    _filterOpen = !_filterOpen;
    const panel = qs('#fin-filter-panel');
    const btn   = qs('#btn-filter-toggle');
    if (panel) panel.style.display = _filterOpen ? '' : 'none';
    if (btn)   btn.classList.toggle('active', _filterOpen);
  }

  // ─── PERÍODO ────────────────────────────────────────────────
  // Converte 'YYYY-MM' no range [primeiro dia, último dia] do mês
  function _periodoFromMes(mes) {
    if (!mes) return { ini: '', fim: '' };
    const [y, m] = mes.split('-').map(Number);
    const last   = new Date(y, m, 0).getDate();
    return { ini: `${mes}-01`, fim: `${mes}-${String(last).padStart(2, '0')}` };
  }

  // Período ativo: {ini, fim, label} conforme modo (mês ou intervalo)
  function getPeriodo() {
    if (_filtros.periodoTipo === 'intervalo') {
      const ini = _filtros.dataIni || '';
      const fim = _filtros.dataFim || '';
      let label;
      if (ini && fim)   label = `${Fmt.date(ini)} – ${Fmt.date(fim)}`;
      else if (ini)     label = `de ${Fmt.date(ini)}`;
      else if (fim)     label = `até ${Fmt.date(fim)}`;
      else              label = 'Todo o período';
      return { ini, fim, label };
    }
    const mes = _filtros.mes;
    if (!mes) return { ini: '', fim: '', label: 'Todo o período' };
    const { ini, fim } = _periodoFromMes(mes);
    const [y, m] = mes.split('-').map(Number);
    const nome = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return { ini, fim, label: nome.charAt(0).toUpperCase() + nome.slice(1) };
  }

  // Uma parcela cai no período? Competência compara por mês; caixa por dia real.
  function _noPeriodo(p, per, regime) {
    const { ini, fim } = per;
    if (!ini && !fim) return true; // período aberto = tudo
    if (regime === 'competencia') {
      const m = String(p.data_competencia || '').substring(0, 7);
      if (!m) return false;
      if (ini && m < ini.substring(0, 7)) return false;
      if (fim && m > fim.substring(0, 7)) return false;
      return true;
    }
    // caixa: usa data real (pagamento se pago, senão vencimento)
    const d = String(p.status === 'pago' ? p.data_pagamento : p.data_vencimento || '').substring(0, 10);
    if (!d) return false;
    if (ini && d < ini) return false;
    if (fim && d > fim) return false;
    return true;
  }

  function limparFiltros() {
    _filtros.busca = ''; _filtros.status = ''; _filtros.categoria = '';
    _filtros.cliente = ''; _filtros.conta = '';
    _filtros.periodoTipo = 'mes';
    _filtros.mes = new Date().toISOString().substring(0, 7);
    _filtros.dataIni = ''; _filtros.dataFim = '';
    _filtros.regime = 'competencia';
    _filtroAbertos = null;
    renderParcelas(currentTab);
  }

  function verAbertos(tipo) {
    _filtroAbertos = tipo;
    filtrar();
  }

  function toggleSort() {
    const order = {
      venc_desc: 'venc_asc', venc_asc: 'valor_desc',
      valor_desc: 'valor_asc', valor_asc: 'venc_desc',
    };
    _filtros.sort = order[_filtros.sort] || 'venc_desc';
    _renderTable();
    const labels = {
      venc_desc: 'Data ↓', venc_asc: 'Data ↑',
      valor_desc: 'Valor ↓', valor_asc: 'Valor ↑',
    };
    const el = qs('#sort-label');
    if (el) el.textContent = labels[_filtros.sort];
  }

  function filtrar() {
    const tipo   = currentTab;
    const regime = _filtros.regime;
    const per    = getPeriodo();
    const sum    = arr => arr.reduce((s, p) => s + Number(p.valor || 0), 0);

    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const em7  = new Date(hoje); em7.setDate(em7.getDate() + 7);

    const baseTipo = allParcelas.filter(p => p.tipo === tipo && !origemForaResultado(p.origem));

    // ── STAT CARDS ──
    // Pendente e Vencido: sempre totais gerais (ignoram o filtro de período —
    // contas em aberto acumulam de meses anteriores e o dono precisa ver o total real).
    // Recebido/Pago e 7 dias: seguem o período selecionado normalmente.
    const cardBasePago = _filtroVenc7d ? baseTipo : baseTipo.filter(p => _noPeriodo(p, per, regime));
    const pendentes  = baseTipo.filter(p => p.status === 'pendente');
    const vencidos   = pendentes.filter(p => new Date(p.data_vencimento + 'T00:00:00') < hoje);
    const proximos7d = pendentes.filter(p => {
      const d = new Date(p.data_vencimento + 'T00:00:00');
      return d >= hoje && d <= em7;
    });
    const pagos = cardBasePago.filter(p => p.status === 'pago');

    _updateStat('stat-pendente', sum(pendentes), pendentes.length);
    _updateStat('stat-vencido',  sum(vencidos),  vencidos.length);
    _updateStat('stat-pago',     sum(pagos),     pagos.length);
    _updateStat('stat-7d',       sum(proximos7d),proximos7d.length);

    // Label do período acima dos cards
    const lbl = qs('#fin-periodo-label');
    if (lbl) lbl.innerHTML = `📅 ${_filtroVenc7d ? 'Geral' : per.label}`;

    // ── MODO ESPECIAL: vencendo em 7 dias ──
    if (_filtroVenc7d) {
      const items = [...proximos7d].sort((a, b) => (a.data_vencimento < b.data_vencimento ? -1 : 1));
      _lastFiltered = items;
      _visibleCount = PAGE_SIZE;
      _renderTable();
      return;
    }

    // ── MODO ABERTOS: pendentes ou vencidos de todos os períodos ──
    if (_filtroAbertos) {
      let items = baseTipo.filter(p => p.status === 'pendente');
      if (_filtroAbertos === 'vencido') items = items.filter(p => new Date(p.data_vencimento + 'T00:00:00') < hoje);
      _lastFiltered = items;
      _visibleCount = PAGE_SIZE;
      _updateChips();
      _renderTable();
      return;
    }

    // ── LISTA (modo normal) ──
    let items = allParcelas.filter(p => p.tipo === tipo);
    const status  = _filtros.status;
    const busca   = (_filtros.busca || '').toLowerCase().trim();
    const catId   = _filtros.categoria;
    const cliId   = _filtros.cliente;
    const contaId = _filtros.conta;

    if (status)  items = items.filter(p => p.status === status);
    if (catId)   items = items.filter(p => p.categoria_id === catId);
    if (cliId)   items = items.filter(p => p.cliente_id   === cliId);
    if (contaId) items = items.filter(p => p.conta_id     === contaId);
    if (busca)   items = items.filter(p => (p.descricao || '').toLowerCase().includes(busca));
    items = items.filter(p => _noPeriodo(p, per, regime));

    _lastFiltered = items;
    _visibleCount = PAGE_SIZE;
    _updateChips();
    _renderTable();
  }

  function _updateStat(id, valor, count) {
    const el   = qs('#' + id);
    const elCt = qs('#' + id + '-ct');
    if (el)   el.textContent   = Fmt.currency(valor);
    if (elCt) elCt.textContent = count > 0 ? `${count} lançamento${count > 1 ? 's' : ''}` : '';
  }

  function _updateChips() {
    const chips = qs('#fin-active-chips');
    if (!chips) return;
    const labels = {
      status:    { pendente: 'Pendente', pago: 'Pago', cancelado: 'Cancelado' },
      regime:    { caixa: 'Caixa' },
    };
    const parts = [];
    if (_filtroAbertos) parts.push({ key: 'abertos', label: _filtroAbertos === 'vencido' ? '⚠ Vencidos (todos os períodos)' : '📋 Pendentes (todos os períodos)' });
    if (_filtros.status)    parts.push({ key: 'status',    label: labels.status[_filtros.status] || _filtros.status });
    if (_filtros.regime === 'caixa') parts.push({ key: 'regime', label: 'Caixa' });
    if (_filtros.categoria) parts.push({ key: 'categoria', label: App.categoriaNome(_filtros.categoria) });
    if (_filtros.cliente)   parts.push({ key: 'cliente',   label: App.clienteNome(_filtros.cliente) });
    if (_filtros.conta)     parts.push({ key: 'conta',     label: (App.getContas().find(c => c.id === _filtros.conta)?.nome || '') });
    if (_filtros.busca)     parts.push({ key: 'busca',     label: `"${_filtros.busca}"` });

    chips.innerHTML = parts.map(p => `
      <span class="fin-chip">
        ${p.label}
        <button onclick="Financeiro.removeChip('${p.key}')">×</button>
      </span>
    `).join('');

    // Badge no botão de filtro
    const bw = qs('#filter-badge-wrap');
    const activeCount = parts.filter(p => p.key !== 'busca').length;
    if (bw) bw.innerHTML = activeCount > 0
      ? `<span class="filter-badge">${activeCount}</span>` : '';
    const sortLbl = qs('#sort-label');
    if (sortLbl) {
      const labels2 = { venc_desc: 'Data ↓', venc_asc: 'Data ↑', valor_desc: 'Valor ↓', valor_asc: 'Valor ↑' };
      sortLbl.textContent = labels2[_filtros.sort] || 'Data ↓';
    }
  }

  function removeChip(key) {
    if (key === 'abertos')   { _filtroAbertos = null; }
    if (key === 'status')    { _filtros.status    = ''; const el = qs('#fin-status');    if (el) el.value = ''; }
    if (key === 'regime')    { _filtros.regime     = 'competencia'; const el = qs('#fin-regime'); if (el) el.value = 'competencia'; }
    if (key === 'categoria') { _filtros.categoria  = ''; const el = qs('#fin-categoria'); if (el) el.value = ''; }
    if (key === 'cliente')   { _filtros.cliente    = ''; const el = qs('#fin-cliente');  if (el) el.value = ''; }
    if (key === 'conta')     { _filtros.conta      = ''; const el = qs('#fin-conta');    if (el) el.value = ''; }
    if (key === 'busca')     { _filtros.busca      = ''; const el = qs('#fin-busca');    if (el) el.value = ''; }
    filtrar();
  }

  function verMais() {
    _visibleCount += PAGE_SIZE;
    _renderTable();
  }

  function _sortItems(items) {
    const s = _filtros.sort;
    return [...items].sort((a, b) => {
      if (s === 'venc_asc')   return a.data_vencimento < b.data_vencimento ? -1 : 1;
      if (s === 'valor_desc') return Number(b.valor) - Number(a.valor);
      if (s === 'valor_asc')  return Number(a.valor) - Number(b.valor);
      return a.data_vencimento > b.data_vencimento ? -1 : 1; // venc_desc (default)
    });
  }

  function _renderTable() {
    if (!qs('#fin-table')) return;
    const tipo  = currentTab;
    const isRec = tipo === 'receber';
    const items = _sortItems(_lastFiltered);

    const countEl = qs('#fin-count');
    if (countEl) countEl.textContent = `${items.length} registro${items.length !== 1 ? 's' : ''}`;

    if (items.length === 0) {
      qs('#fin-table').innerHTML = '<div class="entity-empty" style="padding:24px;text-align:center;color:var(--text-muted)">Nenhum lançamento encontrado</div>';
      return;
    }

    const hoje    = new Date(); hoje.setHours(0, 0, 0, 0);
    const shown   = items.slice(0, _visibleCount);
    const hasMore = items.length > _visibleCount;
    const total   = items.reduce((s, p) => s + Number(p.valor || 0), 0);

    qs('#fin-table').innerHTML = `
      <div class="entity-list" style="border-radius:0;border:none;box-shadow:none">
        ${shown.map(p => {
          const venc    = new Date(p.data_vencimento + 'T00:00:00');
          const vencido = p.status === 'pendente' && venc < hoje;
          const clienteNome = App.clienteNome(p.cliente_id);
          const catNome     = p.categoria_id ? App.categoriaNome(p.categoria_id) : '';
          const sub = [
            clienteNome && clienteNome !== '—' ? clienteNome : '',
            catNome     && catNome     !== '—' ? catNome     : '',
            `Venc. ${Fmt.date(p.data_vencimento)}${vencido ? ' ⚠' : ''}`,
          ].filter(Boolean).join(' · ');
          return `
            <div class="entity-item${vencido ? ' item-vencido' : ''}" onclick="Financeiro.tapParcela('${p.id}')"
              style="${vencido ? 'background:var(--danger-lt)' : ''}">
              <div class="avatar avatar-sm ${isRec ? 'av-green' : 'av-red'}">${isRec ? '↓' : '↑'}</div>
              <div class="entity-info">
                <div class="entity-name">${p.descricao}</div>
                <div class="entity-sub">${sub}</div>
              </div>
              <div class="entity-right">
                <span class="entity-value ${isRec ? 'text-green' : 'text-red'}">${Fmt.currency(p.valor)}</span>
                ${statusBadge(p.status)}
              </div>
            </div>
          `;
        }).join('')}
        <div class="entity-item" style="background:var(--bg);cursor:default">
          <div class="entity-info"><strong>Total filtrado</strong></div>
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

  async function tapParcela(id) {
    const p = await _getParcela(id);
    if (!p) { Toast.warning('Parcela não encontrada'); return; }
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
      <div class="filters-bar" style="align-items:flex-end;gap:10px;flex-wrap:wrap">
        <label style="flex:1;min-width:200px">Mês:
          ${MonthPicker.render('resumo-mes', mes, 'Financeiro.renderResumoMes()')}
        </label>
        <button class="btn btn-outline btn-sm" onclick="Financeiro.exportarPDF()">📄 Exportar PDF</button>
      </div>
      <div id="resumo-content"></div>
    `;
    renderResumoMes();
  }

  function renderResumoMes() {
    const mes = MonthPicker.value('resumo-mes') || new Date().toISOString().substring(0, 7);

    // Mês anterior para comparativo
    const [ano, m] = mes.split('-').map(Number);
    const antDate  = new Date(ano, m - 2, 1);
    const mesAnt   = antDate.toISOString().substring(0, 7);

    const reais = p => !origemForaResultado(p.origem);

    const filterComp  = (tipo, m2) => allParcelas.filter(p => p.tipo === tipo && reais(p) && String(p.data_competencia||'').startsWith(m2));
    const filterCaixa = (tipo, m2) => allParcelas.filter(p => p.tipo === tipo && p.status === 'pago' && reais(p) && String(p.data_pagamento||'').startsWith(m2));

    const recComp  = filterComp('receber', mes);  const recCompAnt  = filterComp('receber', mesAnt);
    const pagComp  = filterComp('pagar',   mes);  const pagCompAnt  = filterComp('pagar',   mesAnt);
    const recCaixa = filterCaixa('receber', mes); const recCaixaAnt = filterCaixa('receber', mesAnt);
    const pagCaixa = filterCaixa('pagar',   mes); const pagCaixaAnt = filterCaixa('pagar',   mesAnt);

    const sum = arr => arr.reduce((s, p) => s + Number(p.valor || 0), 0);

    const recTotalComp  = sum(recComp);  const recTotalCompAnt  = sum(recCompAnt);
    const pagTotalComp  = sum(pagComp);  const pagTotalCompAnt  = sum(pagCompAnt);
    const recTotalCaixa = sum(recCaixa); const recTotalCaixaAnt = sum(recCaixaAnt);
    const pagTotalCaixa = sum(pagCaixa); const pagTotalCaixaAnt = sum(pagCaixaAnt);

    const varPct = (atual, ant) => {
      if (!ant) return atual > 0 ? `<span class="text-green">novo</span>` : '';
      const p = ((atual - ant) / ant * 100).toFixed(0);
      const cls = p >= 0 ? 'text-green' : 'text-red';
      return `<span class="${cls}" style="font-size:.7rem">${p >= 0 ? '+' : ''}${p}%</span>`;
    };

    const contas = App.getContas();
    const todasPagas = allParcelas.filter(p => p.status === 'pago');
    const saldosContas = contas.map(c => {
      const ini = Number(c.saldo_inicial || 0);
      const ent = todasPagas.filter(p => p.tipo === 'receber' && p.conta_id === c.id).reduce((s, p) => s + Number(p.valor || 0), 0);
      const sai = todasPagas.filter(p => p.tipo === 'pagar'   && p.conta_id === c.id).reduce((s, p) => s + Number(p.valor || 0), 0);
      return { conta: c, inicial: ini, entradas: ent, saidas: sai, saldo: ini + ent - sai };
    });
    const semConta   = todasPagas.filter(p => !p.conta_id).length;
    const saldoTotal = saldosContas.reduce((s, x) => s + x.saldo, 0);

    const byCategoria = (arr) => {
      const map = {};
      arr.forEach(p => {
        distribuirCategorias(p, _ctxCat()).forEach(({ categoria_id, valor }) => {
          const nome = App.categoriaNome(categoria_id);
          const k = (nome && nome !== '—') ? nome : 'Sem Categoria';
          map[k] = (map[k] || 0) + Number(valor || 0);
        });
      });
      return Object.entries(map).sort((a, b) => b[1] - a[1]);
    };

    const barCats = (arr, colorClass) => {
      const entries = byCategoria(arr);
      if (!entries.length) return '<p class="text-muted" style="font-size:.82rem">Sem dados</p>';
      const max = entries[0][1];
      return entries.map(([k, v]) => `
        <div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span style="font-size:.8rem;font-weight:600;color:var(--text)">${k}</span>
            <strong class="${colorClass}" style="font-size:.82rem">${Fmt.currency(v)}</strong>
          </div>
          <div class="bar-track">
            <div class="bar" style="width:${Math.max(6, (v/max*100)).toFixed(1)}%;background:var(--${colorClass === 'text-green' ? 'success' : 'danger'});opacity:.7"></div>
          </div>
        </div>
      `).join('');
    };

    const resultComp  = recTotalComp  - pagTotalComp;
    const resultCaixa = recTotalCaixa - pagTotalCaixa;
    const resultCompAnt  = recTotalCompAnt  - pagTotalCompAnt;
    const resultCaixaAnt = recTotalCaixaAnt - pagTotalCaixaAnt;

    qs('#resumo-content').innerHTML = `
      <!-- Saldos de contas -->
      <div class="card mt-3">
        <div class="card-header">
          <h3>Saldos das Contas</h3>
          <strong class="${saldoTotal >= 0 ? 'text-green' : 'text-red'}" style="font-size:1.1rem">${Fmt.currency(saldoTotal)}</strong>
        </div>
        <div class="card-body">
          ${saldosContas.length === 0 ? `
            <p class="text-muted" style="text-align:center;margin:0">
              Nenhuma conta. <a href="#" onclick="App.navigate('config');return false">Cadastrar em Config</a>.
            </p>
          ` : `
            <div class="stats-grid">
              ${saldosContas.map(s => `
                <div class="stat-card saldo-card ${s.saldo >= 0 ? 'stat-green' : 'stat-red'}" onclick="Financeiro.openExtrato('${s.conta.id}')" title="Toque para ver o extrato">
                  <div class="stat-label">${s.conta.nome}</div>
                  <div class="stat-value" style="font-size:1.05rem">${Fmt.currency(s.saldo)}<span class="saldo-chevron">›</span></div>
                  <div class="stat-sub" style="font-size:.68rem">inicial ${Fmt.currency(s.inicial)} · +${Fmt.currency(s.entradas)} −${Fmt.currency(s.saidas)}</div>
                </div>
              `).join('')}
            </div>
            ${semConta > 0 ? `<p class="text-muted mt-2" style="font-size:.74rem">⚠ ${semConta} parcela(s) paga(s) sem conta vinculada.</p>` : ''}
          `}
        </div>
      </div>

      <!-- Resultado do mês — 2 cards lado a lado -->
      <div class="grid-2col mt-3">
        <div class="card">
          <div class="card-header"><h3>Competência</h3><span class="badge badge-info">${mes}</span></div>
          <div class="card-body">
            <div class="info-row">
              <span>Receitas</span>
              <span style="display:flex;align-items:center;gap:6px">
                ${varPct(recTotalComp, recTotalCompAnt)}
                <strong class="text-green">${Fmt.currency(recTotalComp)}</strong>
              </span>
            </div>
            <div class="info-row">
              <span>Despesas</span>
              <span style="display:flex;align-items:center;gap:6px">
                ${varPct(pagTotalComp, pagTotalCompAnt)}
                <strong class="text-red">${Fmt.currency(pagTotalComp)}</strong>
              </span>
            </div>
            <div class="info-row total-row">
              <strong>Resultado</strong>
              <span style="display:flex;align-items:center;gap:6px">
                ${varPct(resultComp, resultCompAnt)}
                <strong class="${resultComp >= 0 ? 'text-green' : 'text-red'}">${Fmt.currency(resultComp)}</strong>
              </span>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Caixa</h3><span class="badge badge-info">${mes}</span></div>
          <div class="card-body">
            <div class="info-row">
              <span>Entradas</span>
              <span style="display:flex;align-items:center;gap:6px">
                ${varPct(recTotalCaixa, recTotalCaixaAnt)}
                <strong class="text-green">${Fmt.currency(recTotalCaixa)}</strong>
              </span>
            </div>
            <div class="info-row">
              <span>Saídas</span>
              <span style="display:flex;align-items:center;gap:6px">
                ${varPct(pagTotalCaixa, pagTotalCaixaAnt)}
                <strong class="text-red">${Fmt.currency(pagTotalCaixa)}</strong>
              </span>
            </div>
            <div class="info-row total-row">
              <strong>Saldo</strong>
              <span style="display:flex;align-items:center;gap:6px">
                ${varPct(resultCaixa, resultCaixaAnt)}
                <strong class="${resultCaixa >= 0 ? 'text-green' : 'text-red'}">${Fmt.currency(resultCaixa)}</strong>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Categorias com barras -->
      <div class="grid-2col mt-3">
        <div class="card">
          <div class="card-header"><h3>Receitas por Categoria</h3></div>
          <div class="card-body">${barCats(recComp, 'text-green')}</div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Despesas por Categoria</h3></div>
          <div class="card-body">${barCats(pagComp, 'text-red')}</div>
        </div>
      </div>

      <!-- Contas fixas (recorrentes) — independe do mês selecionado -->
      <div class="card mt-3">
        <div class="card-header">
          <h3>📆 Contas fixas</h3>
          ${allRecorrentes.length ? `<span class="badge badge-info">${Fmt.currency(allRecorrentes.filter(r => r.ativo !== false && r.ativo !== 'false').reduce((s, r) => s + Number(r.valor || 0), 0))}/mês</span>` : ''}
        </div>
        <div class="card-body">${renderRecorrentesList()}</div>
      </div>
    `;
  }

  // Lista do card "Contas fixas": cadastro-mestre das despesas mensais.
  // A parcela de cada mês nasce sozinha (gerarRecorrentes no boot do app).
  function renderRecorrentesList() {
    if (!allRecorrentes.length) {
      return `<p class="text-muted" style="font-size:.8rem;margin:0">
        Nenhuma conta fixa. Em <strong>+ Lançamento</strong>, escolha
        Repetição → <strong>Todo mês</strong> pra parar de redigitar aluguel, luz etc.
      </p>`;
    }
    return allRecorrentes.map(r => {
      const pausada = r.ativo === false || r.ativo === 'false';
      return `
        <div class="info-row">
          <div style="min-width:0;flex:1;${pausada ? 'opacity:.55' : ''}">
            <div style="font-size:.875rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.descricao}</div>
            <div style="font-size:.72rem;color:var(--text-muted)">
              <strong class="text-red">${Fmt.currency(r.valor)}</strong> · todo dia ${r.dia_vencimento}${pausada ? ' · <span style="color:#CC6600">pausada</span>' : ''}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex:0 0 auto">
            <button class="btn btn-sm btn-outline" title="${pausada ? 'Reativar' : 'Pausar'}"
              onclick="Financeiro.toggleRecorrente('${r.id}', ${pausada})">${pausada ? '▶' : '⏸'}</button>
            <button class="btn btn-sm btn-outline" title="Editar"
              onclick="Financeiro.editarRecorrente('${r.id}')">✏️</button>
            <button class="btn btn-sm btn-outline" title="Excluir"
              onclick="Financeiro.excluirRecorrente('${r.id}')">🗑</button>
          </div>
        </div>`;
    }).join('');
  }

  async function toggleRecorrente(id, reativar) {
    const campos = { ativo: !!reativar };
    if (reativar) {
      // Reativar NÃO gera retroativo dos meses pausados: marca a geração como
      // "em dia" até o mês passado e lança só o mês corrente daqui pra frente.
      const d = new Date(); d.setMonth(d.getMonth() - 1);
      campos.ultima_geracao = d.toISOString().substring(0, 7);
    }
    Loading.show();
    await API.db.update('recorrentes', id, campos);
    if (reativar) await API.db.gerarRecorrentes({ mes: DateUtil.today().substring(0, 7) });
    Loading.hide();
    Toast.success(reativar ? 'Conta fixa reativada!' : 'Conta fixa pausada — não gera mais parcelas');
    await loadData();
    renderView();
  }

  function editarRecorrente(id) {
    const rec = allRecorrentes.find(r => r.id === id);
    if (!rec) return;
    openManual();
    _recEditId = id; // depois do openManual (que zera)
    qs('#manual-title').textContent = 'Editar conta fixa';
    setTipo('pagar');
    refreshManualSelects(rec.cliente_id || '', rec.categoria_id || '');
    qs('#manual-desc').value  = rec.descricao || '';
    qs('#manual-valor').value = rec.valor || '';
    qs('#manual-parcelado').value = 'fixa';
    // Vencimento exibido: dia da recorrente no mês corrente (clamp no último dia)
    const mes    = DateUtil.today().substring(0, 7);
    const ultimo = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();
    const dia    = Math.min(Number(rec.dia_vencimento) || 1, ultimo);
    qs('#manual-venc').value = mes + '-' + String(dia).padStart(2, '0');
    qs('#manual-obs').value  = rec.observacoes || '';
    toggleMaisOpcoes(true); // a repetição "Todo mês" fica no avançado — abrir p/ ver
    toggleParcelado();
  }

  function excluirRecorrente(id) {
    const rec = allRecorrentes.find(r => r.id === id);
    Modal.confirm(`Excluir a conta fixa "${rec?.descricao || ''}"? As parcelas já lançadas ficam.`, async () => {
      await API.db.delete('recorrentes', id);
      Toast.success('Conta fixa excluída');
      await loadData();
      renderView();
    });
  }

  // Atualiza os selects de cliente/categoria conforme o tipo (receber/pagar)
  // Mantém o valor selecionado se já estava válido.
  function refreshManualSelects(curCliente = '', curCategoria = '') {
    const tipo = qs('#manual-tipo')?.value || 'pagar';
    // Despesa aceita fornecedor E equipe (pagar alguém da equipe é despesa).
    const tipoCliente   = tipo === 'receber' ? 'cliente'  : ['fornecedor', 'equipe'];
    const tipoCategoria = tipo === 'receber' ? 'entrada'  : 'saida';
    qs('#manual-cliente').innerHTML   = App.clienteOptions(tipoCliente, curCliente);
    qs('#manual-categoria').innerHTML = App.categoriaOptions(tipoCategoria, curCategoria);
    const lbl = qs('#manual-cliente-label');
    if (lbl) lbl.textContent = tipo === 'receber' ? 'Cliente' : 'Fornecedor / Equipe';
  }

  // Quick add do lançamento: cadastra como CLIENTE se for receita, FORNECEDOR se for despesa
  // (antes era fixo 'cliente' — por isso o fornecedor recém-criado não aparecia em despesas)
  function quickAddContato() {
    const tipo = (qs('#manual-tipo')?.value === 'receber') ? 'cliente' : 'fornecedor';
    App.quickAdd('manual-cliente', tipo);
  }

  function calcNetValor() {
    const bruto     = Number(qs('#manual-valor')?.value) || 0;
    const desc      = Number(qs('#manual-desconto')?.value) || 0;
    const liq       = Math.max(0, bruto - desc);
    const row       = qs('#manual-valor-liq-row');
    if (!row) return;
    const parcelado = qs('#manual-parcelado')?.value === 'sim';
    const nParc     = parcelado ? (parseInt(qs('#manual-nparcelas')?.value) || 2) : 1;
    if (parcelado && nParc >= 2 && liq > 0) {
      const unitario = liq / nParc;
      row.textContent = `${nParc}x de ${Fmt.currency(unitario)} = total ${Fmt.currency(liq)}`;
      row.style.display = '';
    } else if (desc > 0 && bruto > 0) {
      row.textContent = `Valor líquido: ${Fmt.currency(liq)}`;
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  }

  // ─── Segmented controls (Tipo / Status) ──────────────────
  // Os <select> escondidos #manual-tipo/#manual-status são a fonte de verdade
  // lida pelo resto do código; os botões só setam o value e repintam o visual.
  function setTipo(val) {
    qs('#manual-tipo').value = val;
    qsa('#seg-tipo .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.val === val));
    const lbl = qs('#manual-cliente-label');
    if (lbl) lbl.textContent = val === 'receber' ? 'Cliente' : 'Fornecedor';
    refreshManualSelects();
    refreshQuemPagouVisibility();
  }

  function setStatus(val) {
    qs('#manual-status').value = val;
    qsa('#seg-status .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.val === val));
    qs('#seg-status')?.classList.toggle('is-cancelado', val === 'cancelado');
    refreshCancelarLink();
    refreshStatusFields();
  }

  // Pago → Data + Conta; A pagar/cancelado → Vencimento. No modo parcelado/fixa
  // quem manda é toggleParcelado (parcelas nascem pendentes), então sai fora.
  function refreshStatusFields() {
    const modo = qs('#manual-parcelado')?.value || '';
    if (modo === 'sim' || modo === 'fixa') return;
    const pago = qs('#manual-status').value === 'pago';
    qs('#manual-pagto-wrap').style.display = pago ? '' : 'none';
    qs('#manual-conta-wrap').style.display = pago ? '' : 'none';
    qs('#manual-venc-wrap').style.display  = pago ? 'none' : '';
    if (!_compTocada) syncCompetencia();
  }

  function toggleMaisOpcoes(forceOpen) {
    const body = qs('#manual-mais-opcoes');
    const btn  = qs('#manual-mais-toggle');
    if (!body) return;
    const abrir = (typeof forceOpen === 'boolean') ? forceOpen : body.style.display === 'none';
    body.style.display = abrir ? '' : 'none';
    btn?.classList.toggle('open', abrir);
  }

  // Competência derivada da data relevante (pagamento se pago, vencimento se a pagar),
  // até o dono mexer no seletor à mão (_compTocada).
  function deriveCompetencia() {
    const pago = qs('#manual-status')?.value === 'pago';
    const d = pago ? qs('#manual-pagto')?.value : qs('#manual-venc')?.value;
    return (d || DateUtil.today()).substring(0, 7);
  }
  function syncCompetencia() {
    if (qs('#manual-comp-wrap'))
      qs('#manual-comp-wrap').innerHTML = MonthPicker.render('manual-comp', deriveCompetencia(), 'Financeiro.onCompChange()');
  }
  function onCompChange() { _compTocada = true; }
  function onDataChange() { if (!_compTocada) syncCompetencia(); }

  function refreshCancelarLink() {
    const link = qs('#manual-cancelar-link');
    if (!link) return;
    link.textContent = qs('#manual-status').value === 'cancelado'
      ? '↺ Reativar lançamento' : 'Cancelar este lançamento';
  }
  // Alterna cancelado ↔ pendente (só na edição, via link)
  function toggleCancelado() {
    setStatus(qs('#manual-status').value === 'cancelado' ? 'pendente' : 'cancelado');
  }

  // Mostra/esconde campos dependendo do modo de repetição (parcelado/fixa)
  function toggleParcelado() {
    const modo       = qs('#manual-parcelado')?.value || '';
    const parcelado  = modo === 'sim';
    const fixa       = modo === 'fixa';
    const repete     = parcelado || fixa;
    const nWrap      = qs('#manual-nparcelas-wrap');
    if (nWrap) nWrap.style.display = parcelado ? '' : 'none';

    // Parcelado/fixa → status(segmento)/pagto/conta ocultos (parcelas nascem pendentes);
    // o vencimento CONTINUA visível (é o venc da 1ª parcela / dia da conta fixa).
    if (qs('#seg-status'))        qs('#seg-status').style.display        = repete ? 'none' : '';
    if (qs('#manual-pagto-wrap')) qs('#manual-pagto-wrap').style.display = repete ? 'none' : '';
    if (qs('#manual-conta-wrap')) qs('#manual-conta-wrap').style.display = repete ? 'none' : '';
    if (qs('#manual-venc-wrap'))  qs('#manual-venc-wrap').style.display  = repete ? '' : (qs('#manual-status').value === 'pago' ? 'none' : '');
    // "Quem pagou" incompatível com parcelado/fixa
    if (repete) {
      const quemWrap = qs('#manual-quempagou-wrap');
      if (quemWrap) quemWrap.style.display = 'none';
    } else {
      refreshQuemPagouVisibility();
      refreshStatusFields();
    }
    // Ajusta label do vencimento conforme o modo
    const vencLabel = qs('#manual-venc-label');
    if (vencLabel) vencLabel.textContent = parcelado ? 'Vencimento 1ª parcela'
                                         : fixa      ? 'Dia do vencimento (repete todo mês)'
                                         : 'Vencimento';
    calcNetValor();
  }

  // tipoForcado ('pagar'|'receber') permite abrir o lançamento na hora, sem
  // depender de já ter navegado pro Financeiro (usado pelo FAB da Home).
  function openManual(tipoForcado) {
    _recEditId = null;
    _compTocada = false;
    qs('#manual-save-btn').onclick = () => saveManual();
    qs('#manual-title').textContent = 'Novo lançamento';
    qs('#manual-desc').value   = '';
    qs('#manual-valor').value  = '';
    qs('#manual-desconto').value = '0';
    if (qs('#manual-valor-liq-row')) qs('#manual-valor-liq-row').style.display = 'none';
    // Reset repetição + "mais opções" colapsado
    if (qs('#manual-parcelado'))      qs('#manual-parcelado').value = '';
    if (qs('#manual-nparcelas'))      qs('#manual-nparcelas').value = '2';
    if (qs('#manual-nparcelas-wrap')) qs('#manual-nparcelas-wrap').style.display = 'none';
    toggleMaisOpcoes(false);
    qs('#manual-cancelar-link').style.display = 'none'; // cancelar só na edição
    qs('#manual-venc').value   = DateUtil.today();
    qs('#manual-pagto').value  = DateUtil.today();  // padrão: pago hoje
    qs('#manual-quempagou').value = '';
    qs('#manual-conta').innerHTML = App.contaOptions('', '— Selecione conta —');
    // Tipo já vem certo pela aba (Receber → receita; Pagar/Resumo → despesa),
    // ou forçado por quem abriu (FAB da Home).
    const tipoIni = tipoForcado || (currentTab === 'receber' ? 'receber' : 'pagar');
    setTipo(tipoIni);       // repinta segmento + refresh selects/quempagou
    // Status por tipo: despesa normalmente já foi paga; receita normalmente é a receber.
    setStatus(tipoIni === 'receber' ? 'pendente' : 'pago');
    qs('#manual-quempagou').onchange = () => refreshQuemPagouHint();
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
  // trava de duplo clique (Guard) — o corpo real está em _saveManual
  function saveManual(novo) {
    return Guard.run('fin-lancamento', async () => {
      await _saveManual();
      // Sucesso = _saveManual fechou o modal; validação que falha o deixa aberto.
      if (novo) {
        const m = document.getElementById('modal-manual-lancamento');
        if (m && !m.classList.contains('open')) openManual();
      }
    });
  }
  async function _saveManual() {
    const status   = qs('#manual-status').value;
    const tipo     = qs('#manual-tipo').value;
    const quemPagou = qs('#manual-quempagou')?.value || '';

    const desc     = qs('#manual-desc').value.trim();
    const valorBruto = Number(qs('#manual-valor').value) || 0;
    const desconto   = Number(qs('#manual-desconto')?.value) || 0;
    const valor      = Math.max(0, valorBruto - desconto);
    const compMonth= MonthPicker.value('manual-comp');
    const venc     = qs('#manual-venc').value;
    const pagto    = qs('#manual-pagto').value;
    const categoria= qs('#manual-categoria').value;
    const cliente  = qs('#manual-cliente').value;
    const conta    = qs('#manual-conta')?.value || '';
    const obs      = qs('#manual-obs').value;

    const isParcelado = qs('#manual-parcelado')?.value === 'sim';
    const isFixa      = qs('#manual-parcelado')?.value === 'fixa';

    if (!desc || !valor) { Toast.warning('Preencha descrição e valor'); return; }
    if (!categoria)      { Toast.warning('Escolha a categoria'); return; }
    // Conta obrigatória quando pago — EXCETO quando o sócio pagou do bolso
    // (quemPagou): aí a despesa não sai de conta da empresa (conta_id='').
    if (!isParcelado && !isFixa && !quemPagou && status === 'pago' && !conta) {
      Toast.warning('Selecione a conta quando o status for "Pago"'); return;
    }

    // Competência: o que o dono escolheu no avançado, ou derivada da data
    // relevante (pagamento se pago, vencimento se a pagar) quando não tocada.
    const compFull = ((_compTocada && compMonth) ? compMonth : deriveCompetencia()) + '-01';

    // ── Conta fixa (recorrente): grava o cadastro-mestre; a parcela do mês
    // nasce via gerarRecorrentes (backend, idempotente) ────────────────────
    if (isFixa) {
      if (tipo !== 'pagar') { Toast.warning('Conta fixa (todo mês) é só pra despesas nesta versão'); return; }
      const vencStr = venc || DateUtil.today();
      const diaVenc = Number(vencStr.substring(8, 10)) || 1;
      Loading.show();
      let res;
      if (_recEditId) {
        // Edição: só o cadastro — parcelas já geradas ficam como estão
        res = await API.db.update('recorrentes', _recEditId, {
          descricao: desc, valor, categoria_id: categoria, cliente_id: cliente,
          dia_vencimento: diaVenc, observacoes: obs,
        });
      } else {
        // ultima_geracao = mês ANTERIOR ao 1º vencimento: se o 1º vencimento é
        // neste mês, a parcela nasce já; se é um mês futuro, nasce quando chegar
        // (e a geração NÃO retroage pra antes do cadastro).
        const dAnt = new Date(vencStr.substring(0, 7) + '-01T00:00:00');
        dAnt.setMonth(dAnt.getMonth() - 1);
        res = await API.db.create('recorrentes', {
          descricao: desc, tipo: 'pagar', valor, categoria_id: categoria,
          cliente_id: cliente, dia_vencimento: diaVenc, ativo: true,
          ultima_geracao: dAnt.toISOString().substring(0, 7),
          observacoes: obs, data_criacao: DateUtil.today(),
        });
      }
      let geradas = null;
      if (res?.success && !_recEditId) {
        const g = await API.db.gerarRecorrentes({ mes: DateUtil.today().substring(0, 7) });
        if (g?.success) geradas = g.geradas;
      }
      Loading.hide();
      if (!res?.success) { Toast.error('Erro: ' + (res?.error || '')); return; }
      if (_recEditId)           Toast.success('Conta fixa atualizada!');
      else if (geradas === null) Toast.success('Conta fixa salva! (parcelas nascem quando o servidor for atualizado)');
      else if (geradas > 0)      Toast.success('Conta fixa salva! Parcela deste mês lançada.');
      else                       Toast.success(`Conta fixa salva! 1ª parcela nasce em ${vencStr.substring(5, 7)}/${vencStr.substring(0, 4)}.`);
      _recEditId = null;
      Modal.close('modal-manual-lancamento');
      await loadData();
      renderView();
      return;
    }

    // ── Caminho parcelado: cria N parcelas mensais com grupo_id compartilhado ──
    if (isParcelado) {
      const nParc   = Math.max(2, Math.min(60, parseInt(qs('#manual-nparcelas')?.value) || 2));
      const vencBase = new Date((venc || DateUtil.today()) + 'T00:00:00');
      if (isNaN(vencBase.getTime())) { Toast.warning('Informe o vencimento da 1ª parcela'); return; }

      const grupoId = genUUID();

      // Divide igualmente; a última absorve o centavo de arredondamento
      const valorUnit = Math.floor((valor / nParc) * 100) / 100;
      const resto     = Math.round((valor - valorUnit * nParc) * 100) / 100;

      const operations = Array.from({ length: nParc }, (_, i) => {
        const d = new Date(vencBase);
        d.setMonth(d.getMonth() + i);
        const vencStr = d.toISOString().substring(0, 10);
        const compStr = vencStr.substring(0, 7) + '-01';
        return {
          action: 'create', sheet: 'parcelas',
          data: {
            tipo,
            origem:           'manual',
            origem_id:        '',
            grupo_id:         grupoId,
            cliente_id:       cliente,
            descricao:        `${desc} (${i + 1}/${nParc})`,
            valor:            Math.round((valorUnit + (i === nParc - 1 ? resto : 0)) * 100) / 100,
            data_competencia: compStr,
            data_vencimento:  vencStr,
            data_pagamento:   '',
            status:           'pendente',
            categoria_id:     categoria,
            conta_id:         '',
            observacoes:      obs,
          },
        };
      });

      Loading.show();
      const res = await API.db.batch(operations);
      Loading.hide();
      if (res?.success) {
        Toast.success(`${nParc} parcelas criadas! (${Fmt.currency(valorUnit)}/mês)`);
        Modal.close('modal-manual-lancamento');
        await loadData();
        renderView();
      } else {
        Toast.error('Erro ao criar parcelas: ' + (res?.error || ''));
      }
      return;
    }

    // Caminho especial: sócio pagou a despesa do bolso (ficha).
    // A despesa real CONTA no resultado (conta_id='' = não saiu da conta da
    // empresa) e a dívida com o sócio vira movimento na ficha. SEM receita
    // fantasma de "Devolução de fiado".
    if (tipo === 'pagar' && quemPagou) {
      const dataPago = pagto || venc || DateUtil.today();
      const grupoId = genUUID();
      Loading.show();
      // Despesa real (saiu do bolso do sócio, não da conta da empresa)
      const desp = await API.db.create('parcelas', {
        tipo: 'pagar', origem: 'manual', origem_id: '', grupo_id: grupoId,
        cliente_id: cliente, descricao: desc, valor,
        data_competencia: compFull, data_vencimento: dataPago, data_pagamento: dataPago,
        status: 'pago', categoria_id: categoria, conta_id: '', observacoes: obs,
      });
      // Movimento na ficha: empresa passa a dever ao sócio
      await API.db.create('fiado_mov', {
        pessoa: quemPagou, data: dataPago, direcao: 'empresa_deve', motivo: 'despesa_bolso',
        descricao: desc, valor, parcela_id: desp?.data?.id || '', conta_id: '',
        status: 'ativo', grupo_id: grupoId, observacoes: obs,
      });
      Loading.hide();
      Toast.success(`Lançado! Despesa registrada e ${quemPagou} vai pra ficha.`);
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

  // Acha a parcela no cache; se veio de FORA (ex.: botão Pagar na tela da
  // Compra) antes do loadData do Financeiro, busca direto em vez de falhar
  // em silêncio — era o bug do "clico em Pagar e não abre nada".
  async function _getParcela(id) {
    let p = allParcelas.find(x => x.id === id);
    if (p) return p;
    const res = await API.db.read('parcelas', id);
    p = (res?.data || [])[0];
    if (p && !allParcelas.some(x => x.id === p.id)) allParcelas.push(p);
    return p || null;
  }

  async function openPagamento(id) {
    const p = await _getParcela(id);
    if (!p) { Toast.warning('Parcela não encontrada'); return; }
    qs('#pag-parcela-id').value  = id;
    qs('#pag-valor').textContent = Fmt.currency(p.valor);
    qs('#pag-data').value        = DateUtil.today();
    qs('#pag-conta').innerHTML   = App.contaOptions(p.conta_id || '', 'Selecione conta...');
    // Fiado só faz sentido para despesas (tipo=pagar)
    const quemWrap = qs('#pag-quempagou-wrap');
    if (quemWrap) quemWrap.style.display = p.tipo === 'pagar' ? '' : 'none';
    if (qs('#pag-quempagou')) qs('#pag-quempagou').value = '';
    if (qs('#pag-conta-wrap')) qs('#pag-conta-wrap').style.display = '';
    if (qs('#pag-fiado-hint')) qs('#pag-fiado-hint').style.display = 'none';
    Modal.open('modal-pagamento');
  }

  function refreshPagQuemPagouVisibility() {
    const quem     = qs('#pag-quempagou')?.value || '';
    const contaWrap = qs('#pag-conta-wrap');
    const hint      = qs('#pag-fiado-hint');
    if (contaWrap) contaWrap.style.display = quem ? 'none' : '';
    if (hint)      hint.style.display      = quem ? 'block' : 'none';
  }

  // trava de duplo clique (Guard) — o corpo real está em _confirmarPagamento
  function confirmarPagamento() { return Guard.run('fin-pagar', _confirmarPagamento); }
  async function _confirmarPagamento() {
    const id        = qs('#pag-parcela-id').value;
    const data      = qs('#pag-data').value;
    const conta     = qs('#pag-conta').value;
    const quemPagou = qs('#pag-quempagou')?.value || '';

    if (!data) { Toast.warning('Informe a data de pagamento'); return; }
    if (!quemPagou && !conta) { Toast.warning('Selecione a conta'); return; }

    // ── Caminho ficha: sócio pagou esta despesa do bolso ──────────
    // A despesa continua contando no resultado (vira paga, sem conta da
    // empresa) e a dívida com o sócio vira movimento na ficha.
    if (quemPagou) {
      const p = allParcelas.find(x => x.id === id);
      if (!p) return;
      const quemFmt = quemPagou.charAt(0).toUpperCase() + quemPagou.slice(1);

      Loading.show();
      // 1. Marca a despesa como paga pelo sócio (sem conta da empresa)
      await API.db.update('parcelas', id, { status: 'pago', data_pagamento: data, conta_id: '' });
      // 2. Movimento na ficha: empresa passa a dever ao sócio
      await API.db.create('fiado_mov', {
        pessoa: quemPagou, data, direcao: 'empresa_deve', motivo: 'despesa_bolso',
        descricao: p.descricao, valor: p.valor, parcela_id: id, conta_id: '',
        status: 'ativo', grupo_id: p.grupo_id || '', observacoes: '',
      });
      Loading.hide();
      Toast.success(`Pago por ${quemFmt} — foi pra ficha dele.`);
      Modal.close('modal-pagamento');
      await loadData();
      filtrar();
      return;
    }

    // ── Caminho normal ──────────────────────────────────────────
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
    const p = await _getParcela(id);
    if (!p) { Toast.warning('Parcela não encontrada'); return; }

    // Parcelas do modelo antigo de fiado (reembolso pendente) entram na ficha
    // do sócio como "saldo anterior" — são resolvidas por um Acerto, não
    // editadas avulsas. Abre a ficha em vez de editar a parcela solta.
    if (p.origem === 'fiado' && p.origem_id) {
      Modal.confirm(
        'Esta é uma parcela de fiado antigo. Ela agora aparece na Ficha do sócio e é resolvida com um Acerto. Abrir a Ficha?',
        () => { App.navigate('fiado'); }
      );
      return;
    }

    _recEditId = null;
    _compTocada = true; // na edição, preserva a competência gravada (não deriva da data)
    qs('#manual-title').textContent = 'Editar lançamento';
    qs('#manual-desc').value     = p.descricao;
    qs('#manual-valor').value    = p.valor;
    qs('#manual-desconto').value = '0';
    if (qs('#manual-valor-liq-row')) qs('#manual-valor-liq-row').style.display = 'none';
    // Edição é de parcela avulsa: sem modo repetição
    if (qs('#manual-parcelado'))      qs('#manual-parcelado').value = '';
    if (qs('#manual-nparcelas-wrap')) qs('#manual-nparcelas-wrap').style.display = 'none';
    if (qs('#seg-status')) qs('#seg-status').style.display = '';
    qs('#manual-comp-wrap').innerHTML = MonthPicker.render('manual-comp', Fmt.monthInput(p.data_competencia), 'Financeiro.onCompChange()');
    qs('#manual-venc').value   = Fmt.dateInput(p.data_vencimento);
    qs('#manual-pagto').value  = Fmt.dateInput(p.data_pagamento);
    qs('#manual-conta').innerHTML = App.contaOptions(p.conta_id || '', '— Selecione (quando pago) —');
    qs('#manual-obs').value    = p.observacoes || '';
    qs('#manual-quempagou').value = '';
    setTipo(p.tipo);                                // repinta segmento + label + selects
    refreshManualSelects(p.cliente_id, p.categoria_id); // repopula com a seleção da parcela
    setStatus(p.status);                            // repinta segmento + visibilidade + link cancelar
    qs('#manual-cancelar-link').style.display = ''; // cancelar disponível na edição
    // Abre "mais opções" se há algo avançado escondido (obs, ou competência ≠ derivada)
    toggleMaisOpcoes(!!p.observacoes || Fmt.monthInput(p.data_competencia) !== deriveCompetencia());
    qs('#manual-save-btn').onclick = async () => {
      const status = qs('#manual-status').value;
      const contaEdit = qs('#manual-conta')?.value || '';
      if (status === 'pago' && !contaEdit) { Toast.warning('Selecione a conta quando o status for "Pago"'); return; }
      const data = {
        tipo:            qs('#manual-tipo').value,
        cliente_id:      qs('#manual-cliente').value,
        descricao:       qs('#manual-desc').value,
        valor:           Number(qs('#manual-valor').value) || 0,
        data_competencia:MonthPicker.value('manual-comp') + '-01',
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

  // trava de duplo clique (Guard) — o corpo real está em _excluirParcela
  function excluirParcela(id) { return Guard.run('fin-excluir', () => _excluirParcela(id)); }
  async function _excluirParcela(id) {
    const p = allParcelas.find(x => x.id === id);

    // Calcula quantas parcelas do mesmo grupo existem (para exibir aviso correto)
    const grupoCount = p?.grupo_id
      ? allParcelas.filter(x => x.grupo_id === p.grupo_id).length
      : 0;

    let aviso;
    if (p?.origem === 'os') {
      aviso = 'Esta parcela foi gerada por uma OS. Excluir remove só o lançamento financeiro — a OS continua. Continuar?';
    } else if (p?.origem === 'transferencia' || (grupoCount >= 2)) {
      const total = grupoCount >= 2 ? grupoCount : 2;
      aviso = `Este lançamento faz parte de um grupo (${total} parcelas relacionadas). Todas serão excluídas juntas. Continuar?`;
    } else if (p?.origem === 'compra') {
      aviso = 'Esta parcela foi gerada por uma compra. Todas as parcelas desta compra serão excluídas. Continuar?';
    } else if (p?.origem === 'fiado' || p?.origem === 'fiado_pago') {
      aviso = 'Excluir este lançamento de fiado? Os registros relacionados também serão removidos.';
    } else {
      aviso = 'Excluir este lançamento? Esta ação não pode ser desfeita.';
    }

    Modal.confirm(aviso, async () => {
      Loading.show();
      const res = await API.db.excluirLancamento(id);
      Loading.hide();
      if (!res?.success) { Toast.error('Erro ao excluir: ' + (res?.error || '')); return; }
      const qtd = res.deleted || 1;
      Toast.success(qtd > 1 ? `${qtd} lançamentos excluídos` : 'Excluído');
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

  // trava de duplo clique (Guard) — o corpo real está em _salvarTransferencia
  function salvarTransferencia() { return Guard.run('fin-transfer', _salvarTransferencia); }
  async function _salvarTransferencia() {
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
    // grupo_id une as 2 parcelas da transferência para exclusão em conjunto
    const grupoTransf = genUUID();

    Loading.show();
    const res = await API.db.batch([
      // Saída da conta origem
      { action: 'create', sheet: 'parcelas', data: {
          tipo: 'pagar', origem: 'transferencia', origem_id: '', grupo_id: grupoTransf,
          cliente_id: '', descricao: desc, valor,
          data_competencia: comp, data_vencimento: data,
          data_pagamento: data, status: 'pago',
          conta_id: origem, observacoes: obs,
      }},
      // Entrada na conta destino
      { action: 'create', sheet: 'parcelas', data: {
          tipo: 'receber', origem: 'transferencia', origem_id: '', grupo_id: grupoTransf,
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

  // ─── EXTRATO DA CONTA (histórico com saldo acumulado) ───────
  // Estado do extrato aberto. Paginação por lotes: o CÁLCULO do saldo roda
  // sobre TODOS os movimentos (preciso, e barato mesmo com milhares), mas a
  // RENDERIZAÇÃO vai em lotes — é injetar milhares de linhas no DOM de uma vez
  // que travaria. Cada "Ver mais" ANEXA o próximo lote (não re-renderiza).
  let _extLinhas  = [];  // movimentos já com saldoApos, do mais novo p/ o mais antigo
  let _extShown   = 0;   // quantos já estão no DOM
  let _extInicial = 0;   // saldo inicial da conta (linha-âncora no fim)
  const EXT_PAGE  = 60;

  function openExtrato(contaId) {
    const conta = App.getContas().find(c => c.id === contaId);
    if (!conta) { Toast.error('Conta não encontrada'); return; }
    _extInicial = Number(conta.saldo_inicial || 0);

    const movs = allParcelas
      .filter(p => p.status === 'pago' && p.conta_id === contaId)
      .map(p => ({
        p,
        sign:  p.tipo === 'receber' ? 1 : -1,
        valor: Number(p.valor || 0),
        // data do caixa (quando foi pago); fallbacks só p/ ordenar
        data:  String(p.data_pagamento || p.data_competencia || p.data_vencimento || '').substring(0, 10),
      }));

    // Acumula do mais antigo p/ o mais novo, depois inverte p/ exibir (extrato)
    movs.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
    let saldo = _extInicial;
    movs.forEach(m => { m.saldoApos = (saldo += m.sign * m.valor); });
    const saldoFinal = saldo;
    _extLinhas = movs.reverse();
    _extShown  = 0;

    const n = _extLinhas.length;
    qs('#modal-extrato-title').textContent = `Extrato · ${conta.nome}`;
    qs('#modal-extrato-saldo').innerHTML =
      `<div class="extrato-saldo-label">Saldo atual${n ? ` · ${n} lançamento${n > 1 ? 's' : ''}` : ''}</div>
       <div class="extrato-saldo-val ${saldoFinal >= 0 ? 'text-green' : 'text-red'}">${Fmt.currency(saldoFinal)}</div>`;

    const body = qs('#modal-extrato-body');
    body.innerHTML = '';
    if (n === 0) {
      body.innerHTML = `<p class="text-muted" style="text-align:center;padding:18px 0 14px;margin:0">Nenhuma movimentação paga nesta conta ainda.</p>${_extInicialHtml()}`;
    } else {
      _appendExtrato(); // primeiro lote + rodapé
    }
    body.scrollTop = 0;
    Modal.open('modal-extrato');
  }

  function _extratoRowHtml(m) {
    const isRec = m.sign > 0;
    const cli = App.clienteNome(m.p.cliente_id);
    const cat = m.p.categoria_id ? App.categoriaNome(m.p.categoria_id) : '';
    const tags = [
      m.p.origem === 'transferencia' ? '↔ Transferência' : '',
      cli && cli !== '—' ? cli : '',
      cat && cat !== '—' ? cat : '',
    ].filter(Boolean).join(' · ');
    return `
      <div class="extrato-row">
        <div class="extrato-icon ${isRec ? 'av-green' : 'av-red'}">${isRec ? '↓' : '↑'}</div>
        <div class="extrato-main">
          <div class="extrato-desc">${m.p.descricao || (isRec ? 'Entrada' : 'Saída')}</div>
          <div class="extrato-meta">${Fmt.date(m.data)}${tags ? ' · ' + tags : ''}</div>
        </div>
        <div class="extrato-right">
          <div class="extrato-val ${isRec ? 'text-green' : 'text-red'}">${isRec ? '+' : '−'}${Fmt.currency(m.valor)}</div>
          <div class="extrato-saldo-acc">saldo ${Fmt.currency(m.saldoApos)}</div>
        </div>
      </div>`;
  }

  function _extInicialHtml() {
    return `
      <div id="extrato-footer" class="extrato-row extrato-inicial">
        <div class="extrato-main"><div class="extrato-desc">Saldo inicial</div></div>
        <div class="extrato-right"><div class="extrato-saldo-acc">${Fmt.currency(_extInicial)}</div></div>
      </div>`;
  }

  // Anexa o próximo lote ao fim (sem mexer no que já está) e recoloca o rodapé:
  // botão "Ver mais" enquanto sobra, ou a linha de saldo inicial no fim.
  function _appendExtrato() {
    const body = qs('#modal-extrato-body');
    if (!body) return;
    qs('#extrato-footer')?.remove();
    const slice = _extLinhas.slice(_extShown, _extShown + EXT_PAGE);
    _extShown += slice.length;
    body.insertAdjacentHTML('beforeend', slice.map(_extratoRowHtml).join(''));
    const restantes = _extLinhas.length - _extShown;
    body.insertAdjacentHTML('beforeend', restantes > 0
      ? `<button id="extrato-footer" class="btn btn-outline btn-full extrato-vermais" onclick="Financeiro.verMaisExtrato()">Ver mais ${restantes} lançamento${restantes > 1 ? 's' : ''}</button>`
      : _extInicialHtml());
  }

  function verMaisExtrato() { _appendExtrato(); }

  // Exporta um relatório de receitas/despesas do mês do Resumo em PDF.
  async function exportarPDF() {
    const mes = MonthPicker.value('resumo-mes') || new Date().toISOString().substring(0, 7);
    const [ano, m] = mes.split('-').map(Number);
    const nomeMs = new Date(ano, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    const label  = nomeMs.charAt(0).toUpperCase() + nomeMs.slice(1);

    const reais = p => !origemForaResultado(p.origem);
    const sum   = arr => arr.reduce((s, p) => s + Number(p.valor || 0), 0);
    // Regime de CAIXA: só o que foi efetivamente recebido/pago no mês, pela data de pagamento.
    // (NÃO usa competência — evita listar parcelas futuras ainda não pagas e datas presas no dia 01)
    const pagoNoMes = (tipo) => allParcelas.filter(p => p.tipo === tipo && p.status === 'pago' && reais(p) && String(p.data_pagamento || '').startsWith(mes));
    const sortPag = arr => [...arr].sort((a, b) => (a.data_pagamento || '') < (b.data_pagamento || '') ? -1 : 1);

    const rec = pagoNoMes('receber'), pag = pagoNoMes('pagar');
    if (rec.length === 0 && pag.length === 0) { Toast.warning('Sem recebimentos ou pagamentos em ' + label); return; }

    // Resolve a categoria efetiva (sessões → OS → parcela) já no nome p/ o PDF.
    const enrich = arr => sortPag(arr).map(p => ({ ...p, categoriaNome: App.categoriaNome(_catEfetivaId(p)) }));

    await Doc.relatorioFinanceiro({
      periodoLabel:  label,
      receitasList:  enrich(rec), totalReceitas: sum(rec),
      despesasList:  enrich(pag), totalDespesas: sum(pag),
    });
  }

  return { render, switchTab, filtrar, limparFiltroVenc7d, verAbertos, verMais, calcNetValor, openExtrato, verMaisExtrato,
           exportarPDF,
           renderResumo, renderResumoMes,
           openManual, saveManual, openPagamento, confirmarPagamento, quickAddContato,
           toggleRecorrente, editarRecorrente, excluirRecorrente,
           refreshPagQuemPagouVisibility,
           openTransferencia, salvarTransferencia,
           toggleParcelado, setTipo, setStatus, toggleMaisOpcoes, toggleCancelado,
           onCompChange, onDataChange,
           editarParcela, excluirParcela, tapParcela,
           onBuscaInput, onFilterChange, toggleFilterPanel, limparFiltros,
           onPeriodoTipoChange, openPeriodo,
           toggleSort, removeChip };
})();
