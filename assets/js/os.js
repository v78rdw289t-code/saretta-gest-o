// ============================================================
// OS - Ordens de Serviço
// ============================================================

const OS = (() => {
  let allOS = [], allDiarias = [], allItens = [];
  // Estado temporário do modal de registro de dia (modelo de blocos v2)
  let _blocos        = []; // períodos atuais: [{inicio,fim,reajuste:bool,fatores:[{id,label,percentual}]}]
  let _diariaFatores = []; // fatores disponíveis (config), carregados ao abrir o modal
  let currentOS = null;
  let currentView = 'list'; // list | detail | form | diaria | fechamento
  let _registroView = 'os'; // lista: 'os' | 'orcamento'

  // Resultado mais recente da calculadora do detalhe — usado pelo modal
  // de fechamento. Atualizado a cada interação na calculadora.
  let _calc = {
    bruto:    0,   // soma sem desconto (calc normal: subtotal; diária: dias+itens)
    liquido:  0,   // valor sugerido (calc normal: já com desconto/simples; diária: igual ao bruto)
    horas:    0,   // só p/ exibir no fechamento
    detalhe:  '',  // texto curto descrevendo o cálculo
  };
  let _calcExpanded = false;  // true = calculadora aberta; false = resumo/botão

  // Fechamento em lote (várias OS do mesmo cliente → 1 parcela)
  let _loteMode    = false;      // modo seleção múltipla ligado na lista
  let _loteSel     = new Set();  // ids das OS marcadas
  let _loteCliente = '';         // cliente fixado pela 1ª OS marcada
  let _loteCalc    = {};         // osId → { base, baseOrig, maoObra, totalItens, calculado, ... }

  // ─── RENDER PRINCIPAL ───────────────────────────────────
  async function render(params = {}) {
    await Promise.all([loadData(), App.loadGlobals()]);
    if (params.id) { openDetail(params.id); return; }
    renderList();
  }

  async function loadData() {
    const shown = Loading.maybeShow('os', 'diarias', 'os_itens');
    const [osRes, dRes, iRes] = await Promise.all([
      API.db.read('os'),
      API.db.read('diarias'),
      API.db.read('os_itens'),
    ]);
    if (shown) Loading.hide();
    allOS      = osRes?.data || [];
    allDiarias = dRes?.data  || [];
    allItens   = iRes?.data  || [];
  }

  // ─── TIPO DA OS: 'horas' | 'valor' ───────────────────────
  // 'horas'  → as horas registradas viram o valor a cobrar (fechamento pelas sessões).
  // 'valor'  → valor fechado com o cliente (guardado em orcado_valor); no fechamento
  //            a base é esse valor e as horas viram só referência. Retrocompatível:
  //            OS antigas (tipo 'normal'/vazio) e as geradas de orçamento (orcado_valor>0)
  //            são classificadas sem precisar de migração.
  function osTipo(o) {
    if (!o) return 'horas';
    if (o.tipo === 'valor') return 'valor';
    if (o.tipo === 'horas')  return 'horas';
    return Number(o.orcado_valor) > 0 ? 'valor' : 'horas';
  }
  function osTipoBadge(o) {
    return osTipo(o) === 'valor'
      ? '<span class="badge badge-gold">💰 Valor fechado</span>'
      : '<span class="badge badge-secondary">🕐 Por horas</span>';
  }

  // ─── LISTA ─────────────────────────────────────────────
  // Entra na tela já filtrada em "Andamento" (pedido do dono: o dia a dia é
  // com as abertas; Fechadas/Todas ficam a 1 toque). O filtro escolhido
  // persiste na sessão — voltar do detalhe não reseta a aba.
  function renderList(filtroStatus = _currentStatus, filtroTipo = '', q = '') {
    currentView = 'list';
    const isOrcView = _registroView === 'orcamento';
    let items = allOS.filter(o => (o.registro || 'os') === _registroView);
    if (filtroStatus && !isOrcView) items = items.filter(o => o.status === filtroStatus);
    if (filtroTipo)   items = items.filter(o => o.tipo === filtroTipo);
    if (q)            items = filterRecords(items, q, ['numero','nome','observacoes']).concat(
                               items.filter(o =>
                                 App.clienteNome(o.cliente_id).toLowerCase().includes(q.toLowerCase()) ||
                                 (App.categoriaNome(o.categoria_id) || '').toLowerCase().includes(q.toLowerCase())
                               )
                             ).filter((v, i, a) => a.indexOf(v) === i);

    items = [...items].sort((a, b) => (a.data_criacao > b.data_criacao ? -1 : 1));

    const statusAv = s => s === 'fechado' ? 'av-green' : s === 'andamento' ? 'av-blue' : s === 'acerto' ? 'av-orange' : 'av-navy';

    // Insights rápidos
    const mes = new Date().toISOString().substring(0,7);
    const totalAndamento = allOS.filter(o => o.status === 'andamento').length;
    const totalAcerto    = allOS.filter(o => o.status === 'acerto').length;
    const fechadasMes    = allOS.filter(o => o.status === 'fechado' && String(o.data_atualizacao||o.data_inicio||'').startsWith(mes)).length;
    const receitaMes     = allOS.filter(o => o.status === 'fechado' && String(o.data_atualizacao||o.data_inicio||'').startsWith(mes))
                                .reduce((s,o) => s + Number(o.valor_fechamento||0), 0);

    // Subtotal do lote (valores já gravados nas sessões + itens — sem recalcular base)
    const loteSubtotal = Array.from(_loteSel).reduce((s, id) => {
      const mo = allDiarias.filter(d => d.os_id === id)
        .reduce((t, d) => t + Number(d.valor_manual || d.valor_calculado || 0), 0);
      const it = allItens.filter(i => i.os_id === id)
        .reduce((t, i) => t + Number(i.valor_total || 0), 0);
      return s + mo + it;
    }, 0);

    const section = qs('#page-os');
    section.innerHTML = `
      <div class="page-header">
        <h1>${isOrcView ? 'Orçamentos' : 'Ordens de Serviço'}</h1>
        <div style="display:flex;gap:8px">
          ${!isOrcView ? `<button class="btn ${_loteMode ? 'btn-gold' : 'btn-outline'} btn-sm" onclick="OS.toggleLoteMode()">${_loteMode ? '✕ Cancelar' : '☑ Fechar em lote'}</button>` : ''}
          ${_loteMode ? '' : (isOrcView
            ? `<button class="btn btn-primary" onclick="OS.openForm(null,'orcamento')">+ Novo Orçamento</button>`
            : `<button class="btn btn-primary" onclick="OS.openForm()">+ Nova OS</button>`)}
        </div>
      </div>

      <div class="tab-bar mb-3">
        <button class="tab-btn ${!isOrcView ? 'active' : ''}" onclick="OS.setRegistroView('os')">🧾 OS</button>
        <button class="tab-btn ${isOrcView ? 'active' : ''}" onclick="OS.setRegistroView('orcamento')">📄 Orçamentos</button>
      </div>

      ${_loteMode ? `
      <div class="lote-hint mb-3">
        Toque nas OS <strong>do mesmo cliente</strong> que quer juntar num fechamento só (1 parcela).
      </div>` : ''}

      ${isOrcView ? `
        <div class="stats-grid mb-3">
          <div class="stat-card stat-navy">
            <div class="stat-label">Orçamentos</div>
            <div class="stat-value">${items.length}</div>
          </div>
          <div class="stat-card stat-green">
            <div class="stat-label">Viraram OS</div>
            <div class="stat-value">${items.filter(o => allOS.some(x => x.orcamento_id === o.id)).length}</div>
          </div>
        </div>
        <div class="mb-3">
          <input type="text" id="os-search" placeholder="Buscar orçamento ou cliente..." class="input-search" value="${q}"
            oninput="OS.applyFilters()">
        </div>
      ` : `
        <div class="stats-grid mb-3">
          <div class="stat-card stat-blue" style="cursor:pointer" onclick="OS.setStatus('andamento')">
            <div class="stat-label">Andamento</div>
            <div class="stat-value">${totalAndamento}</div>
          </div>
          <div class="stat-card stat-orange" style="cursor:pointer" onclick="OS.setStatus('acerto')">
            <div class="stat-label">Em Acerto</div>
            <div class="stat-value">${totalAcerto}</div>
          </div>
          <div class="stat-card stat-green">
            <div class="stat-label">Fechadas (mês)</div>
            <div class="stat-value">${fechadasMes}</div>
          </div>
          <div class="stat-card stat-navy">
            <div class="stat-label">Receita (mês)</div>
            <div class="stat-value" style="font-size:1rem">${Fmt.currency(receitaMes)}</div>
          </div>
        </div>
        <div class="mb-3">
          <input type="text" id="os-search" placeholder="Buscar OS ou cliente..." class="input-search" value="${q}"
            oninput="OS.applyFilters()">
        </div>
        <div class="tab-bar mb-3">
          <button class="tab-btn ${filtroStatus===''       ?'active':''}" onclick="OS.setStatus('')">Todas</button>
          <button class="tab-btn ${filtroStatus==='andamento'?'active':''}" onclick="OS.setStatus('andamento')">Andamento</button>
          <button class="tab-btn ${filtroStatus==='acerto' ?'active':''}" onclick="OS.setStatus('acerto')">Acerto</button>
          <button class="tab-btn ${filtroStatus==='fechado'?'active':''}" onclick="OS.setStatus('fechado')">Fechadas</button>
        </div>
      `}
      <div class="entity-list">
        ${items.length === 0
          ? `<div class="entity-empty">${isOrcView ? 'Nenhum orçamento ainda' : 'Nenhuma OS encontrada'}</div>`
          : items.map(o => {
            const catNome = o.categoria_id ? App.categoriaNome(o.categoria_id) : '';
            const numShort = (o.numero || '').replace(/^(OS|ORC)-/i, '');
            const jaGerou = isOrcView && allOS.some(x => x.orcamento_id === o.id);
            // Em modo lote: só OS não fechadas e (após a 1ª marcada) do mesmo cliente
            const selecionavel = !_loteMode || (o.status !== 'fechado' && (!_loteCliente || o.cliente_id === _loteCliente));
            const marcada = _loteMode && _loteSel.has(o.id);
            const clique = _loteMode
              ? (selecionavel ? `OS.toggleLoteSel('${o.id}')` : '')
              : `OS.tapCard('${o.id}')`;
            const badges = isOrcView
              ? `<span class="badge badge-gold">📄 Orçamento</span>${jaGerou ? ' <span class="badge badge-success">✓ Gerou OS</span>' : ''}${catNome ? ` <span class="badge badge-info">${catNome}</span>` : ''}`
              : `${statusBadge(o.status)} ${osTipoBadge(o)}${catNome ? ` <span class="badge badge-info">${catNome}</span>` : ''}`;
            return `
            <div class="entity-item${_loteMode && !selecionavel ? ' lote-off' : ''}${marcada ? ' lote-on' : ''}" onclick="${clique}">
              ${_loteMode ? `<span class="lote-check${marcada ? ' on' : ''}">${marcada ? '✓' : ''}</span>` : ''}
              <div class="avatar ${isOrcView ? 'av-gold' : statusAv(o.status)}">
                <span style="font-size:.75rem;font-weight:800">${numShort}</span>
              </div>
              <div class="entity-info">
                <div class="entity-name">${App.clienteNome(o.cliente_id)}${o.nome ? ` <span style="font-weight:500;color:var(--text-muted);font-size:.85em">· ${o.nome}</span>` : ''}</div>
                <div class="entity-sub">${Fmt.date(o.data_inicio)}${!isOrcView && o.data_fim ? ' → ' + Fmt.date(o.data_fim) : ''}${isOrcView && o.prazo_dias ? ' · ' + o.prazo_dias + ' dia(s)' : ''}</div>
                <div class="entity-badges">${badges}</div>
              </div>
              <div class="entity-right">
                <span class="entity-chevron">›</span>
              </div>
            </div>
          `;
          }).join('')}
      </div>

      ${_loteMode ? `
      <div style="height:84px"></div>
      <div class="lote-bar">
        <div class="lote-bar-info">
          <strong>${_loteSel.size} OS selecionada(s)</strong>
          <span>${_loteSel.size ? Fmt.currency(loteSubtotal) + (_loteCliente ? ' · ' + App.clienteNome(_loteCliente) : '') : 'marque 2 ou mais'}</span>
        </div>
        <button class="btn btn-gold" ${_loteSel.size >= 2 ? '' : 'disabled'} onclick="OS.abrirFechamentoLote()">Fechar juntas →</button>
      </div>` : ''}
    `;
  }

  // ─── Seleção múltipla p/ fechamento em lote ─────────────
  function toggleLoteMode() {
    _loteMode = !_loteMode;
    _loteSel.clear();
    _loteCliente = '';
    renderList(_currentStatus, '', qs('#os-search')?.value || '');
  }

  function toggleLoteSel(id) {
    const os = allOS.find(o => o.id === id);
    if (!os || os.status === 'fechado') return;
    if (_loteSel.has(id)) {
      _loteSel.delete(id);
      if (_loteSel.size === 0) _loteCliente = '';
    } else {
      if (_loteCliente && os.cliente_id !== _loteCliente) {
        Toast.warning('Só dá pra juntar OS do mesmo cliente.');
        return;
      }
      _loteCliente = os.cliente_id;
      _loteSel.add(id);
    }
    renderList(_currentStatus, '', qs('#os-search')?.value || '');
  }

  function applyFilters() {
    const q  = qs('#os-search')?.value || '';
    renderList(_currentStatus, '', q);
  }

  let _currentStatus = 'andamento'; // filtro inicial da lista (ver renderList)
  function setStatus(s) {
    _currentStatus = s;
    applyFilters();
  }

  // Alterna a lista entre OS e Orçamentos
  function setRegistroView(v) {
    _registroView = v;
    renderList(_currentStatus, '', qs('#os-search')?.value || '');
  }

  function _maisOpcoes(id) {
    const o = allOS.find(x => x.id === id) || currentOS;
    const actions = [
      { icon: '📊', label: 'Análise / Insights', fn: () => openInsightsOS(id) },
      { icon: '✏️', label: 'Editar OS', fn: () => openForm(id) },
      { icon: '🔄', label: 'Alterar status', fn: () => _menuStatus() },
      { icon: '📋', label: 'Gerar OS (PDF)',       fn: () => Doc.gerar(id, 'os') },
      { icon: '💰', label: 'Gerar Orçamento (PDF)', fn: () => Doc.gerar(id, 'orcamento') },
    ];
    if (o && o.status !== 'fechado') {
      actions.push({ icon: '✓', label: 'Fechar OS', fn: () => openFechamento() });
    }
    actions.push({ icon: '🗑', label: 'Excluir OS', fn: () => confirmDelete(id), danger: true });
    ActionSheet.open(o ? o.numero : 'OS', actions);
  }

  // Submenu de status (aberto pelo "Alterar status" no menu ⋯) — só os diferentes do atual
  function _menuStatus() {
    if (!currentOS) return;
    const opts = [
      { v: 'andamento', icon: '🔧', label: 'Em Andamento' },
      { v: 'acerto',    icon: '🤝', label: 'Em Acerto' },
      { v: 'fechado',   icon: '✓',  label: 'Fechado (sem gerar conta)' },
    ].filter(o => o.v !== currentOS.status);
    ActionSheet.open('Alterar status', opts.map(o => ({
      icon: o.icon, label: o.label, fn: () => mudarStatus(o.v),
    })));
  }

  function tapCard(id) {
    openDetail(id);
  }

  // ─── DETALHE ────────────────────────────────────────────
  async function openDetail(id) {
    const novoOS = allOS.find(o => o.id === id) || (await API.db.read('os', id))?.data?.[0];
    if (!novoOS) return;
    // Ao trocar de OS, hidrata o resumo da calculadora a partir do valor salvo
    if (!currentOS || currentOS.id !== novoOS.id) {
      const valorSalvo = Number(novoOS.valor_calculado || 0);
      _calc = {
        bruto:   valorSalvo,
        liquido: valorSalvo,
        horas:   0,
        detalhe: valorSalvo > 0 ? 'valor salvo' : '',
      };
      _calcExpanded = false;
    }
    currentOS = novoOS;
    currentView = 'detail';
    // Orçamento tem tela própria (simplificada) — sai daqui.
    if (currentOS.registro === 'orcamento') return renderOrcamentoDetail();
    const diarias = allDiarias.filter(d => d.os_id === id)
                               .sort((a, b) => a.data > b.data ? -1 : 1); // mais recente primeiro
    const itens   = allItens.filter(i => i.os_id === id);
    const sessAberta = acharSessaoAberta(diarias, id); // sessão só com início, a encerrar
    // Parcelas (lançamentos financeiros) NÃO bloqueiam mais o detalhe: elas moram
    // em sheets (parcelas/fechamento_os) que qualquer fechamento/pagamento
    // invalida, então caem fora do cache e vão à rede — e em sinal fraco na obra
    // o detalhe INTEIRO ficava preso vários segundos esperando, com a lista ainda
    // à mostra (parecia "parou na lista"). Agora a seção pinta "Carregando…" e o
    // _preencheParcelas atualiza quando a rede responde. Ver openDetail no fim.
    const section = qs('#page-os');
    const cliente = App.clienteNome(currentOS.cliente_id);
    // Somas para o card de resumo (serviço = mão de obra; materiais = itens)
    const _somaMO    = diarias.reduce((s, d) => s + Number(d.valor_manual || d.valor_calculado || 0), 0);
    const _somaMat   = itens.reduce((s, i) => s + Number(i.valor_total || 0), 0);
    const _somaTotal = _somaMO + _somaMat;

    section.innerHTML = `
      <!-- Header compacto -->
      <div class="page-header" style="gap:8px">
        <button class="btn btn-outline btn-sm" onclick="OS.render()">← Voltar</button>
        <div style="flex:1;min-width:0">
          <div style="font-size:.72rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px">${currentOS.numero}${currentOS.categoria_id ? ` · ${App.categoriaNome(currentOS.categoria_id)}` : ''}</div>
          <div style="font-weight:800;font-size:1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${currentOS.nome || cliente}</div>
          ${currentOS.nome ? `<div style="font-size:.78rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cliente}</div>` : ''}
        </div>
        <button class="btn btn-outline btn-sm" style="font-size:1.2rem;letter-spacing:2px;padding:6px 12px"
          onclick="OS._maisOpcoes('${id}')">⋯</button>
      </div>

      <!-- Barra de ações principais -->
      ${currentOS.status !== 'fechado' ? `
        ${sessAberta ? `
        <div class="card mb-3" style="border-left:4px solid var(--gold, #c8a24a)">
          <div class="card-body">
            <div style="display:flex;align-items:center;gap:10px">
              <span style="font-size:1.3rem">${sessAberta.pausada ? '⏸' : '▶'}</span>
              <div style="flex:1;min-width:0">
                <div class="info-label">${sessAberta.pausada ? 'Sessão pausada' : 'Sessão em andamento'}</div>
                <strong>${sessAberta.pausada ? 'Pausada — dá pra retomar' : `Desde ${sessAberta.inicio}`}${sessAberta.data && sessAberta.data !== DateUtil.today() ? ` · ${Fmt.date(sessAberta.data)}` : ''}</strong>
              </div>
            </div>
            <div style="display:flex;gap:8px;margin-top:12px">
              ${sessAberta.pausada
                ? `<button class="btn btn-gold btn-sm" style="flex:1" onclick="OS.retomarSessao('${sessAberta.diariaId}')">▶ Retomar</button>`
                : `<button class="btn btn-outline btn-sm" style="flex:1" onclick="OS.pausarSessao('${sessAberta.diariaId}')">⏸ Pausar</button>`}
              <button class="btn btn-gold btn-sm" style="flex:1" onclick="OS.encerrarSessao('${sessAberta.diariaId}')">⏹ Encerrar</button>
            </div>
          </div>
        </div>` : ''}
        <div style="display:flex;gap:10px;margin-bottom:${sessAberta ? '10px' : '16px'}">
          <button class="btn btn-primary" style="flex:1;font-size:1rem;padding:13px 8px;border-radius:12px" onclick="OS.openDiaria()">
            ⏱ Registrar Sessão
          </button>
          <button class="btn btn-gold" style="flex:1;font-size:1rem;padding:13px 8px" onclick="OS.openFechamento()">
            ✓ Fechar OS
          </button>
        </div>
        ${!sessAberta ? `
        <button class="btn btn-outline btn-sm" style="width:100%;margin-bottom:16px" onclick="OS.iniciarSessaoAgora('${id}')">
          ▶ Iniciar sessão agora <small style="color:var(--text-muted);font-weight:400">— marca o horário de início</small>
        </button>` : ''}
      ` : `
        <div style="text-align:center;margin-bottom:16px">${statusBadge('fechado')}</div>
      `}

      <!-- Info resumida -->
      <div class="card mb-3">
        <div class="card-body" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><div class="info-label">Início</div><strong>${Fmt.date(currentOS.data_inicio)}</strong></div>
          ${currentOS.data_fim ? `<div><div class="info-label">Fim</div><strong>${Fmt.date(currentOS.data_fim)}</strong></div>` : ''}
          <!-- Status (alterar via menu ⋯ no topo) -->
          <div style="grid-column:1/-1">
            <div class="info-label">Status</div>
            ${statusBadge(currentOS.status)} ${osTipoBadge(currentOS)}
          </div>
          ${osTipo(currentOS) === 'valor' && !currentOS.orcamento_id && Number(currentOS.orcado_valor) > 0 ? `
          <div style="grid-column:1/-1">
            <div class="info-label">Valor fechado (combinado)</div>
            <strong class="text-green" style="font-size:1.2rem">${Fmt.currency(currentOS.orcado_valor)}</strong>
          </div>` : ''}
          ${osTipo(currentOS) === 'valor'
            ? (_somaMat > 0 ? `
          <div style="grid-column:1/-1;border-top:1px solid var(--border);padding-top:10px">
            <div class="info-row"><span>Materiais lançados</span><strong>${Fmt.currency(_somaMat)}</strong></div>
          </div>` : '')
            : `
          <div style="grid-column:1/-1;border-top:1px solid var(--border);padding-top:10px">
            <div class="info-row"><span>Serviço (mão de obra)</span><strong>${Fmt.currency(_somaMO)}</strong></div>
            <div class="info-row"><span>Materiais</span><strong>${Fmt.currency(_somaMat)}</strong></div>
            <div class="info-row" style="font-weight:800;margin-top:4px;padding-top:6px;border-top:1px solid var(--border)"><span>Total</span><strong class="text-navy" style="font-size:1.1rem">${Fmt.currency(_somaTotal)}</strong></div>
          </div>`}
          ${currentOS.valor_fechamento ? `<div style="grid-column:1/-1"><div class="info-label">Valor Fechado</div><strong class="text-green" style="font-size:1.2rem">${Fmt.currency(currentOS.valor_fechamento)}</strong></div>` : ''}
          ${currentOS.observacoes ? `<div style="grid-column:1/-1"><div class="info-label">Observações</div><span style="color:var(--text-muted)">${currentOS.observacoes}</span></div>` : ''}
        </div>
      </div>

      <!-- Referência do orçamento de origem (se a OS veio de um orçamento) -->
      ${currentOS.orcamento_id ? `
        <div class="card mb-3" style="cursor:pointer" onclick="OS.openDetail('${currentOS.orcamento_id}')">
          <div class="card-body" style="display:flex;align-items:center;gap:10px">
            <span style="font-size:1.3rem">📋</span>
            <div style="flex:1">
              <div class="info-label">Orçado em ${currentOS.orcado_data ? Fmt.date(currentOS.orcado_data) : '—'}</div>
              <strong>${Fmt.currency(currentOS.orcado_valor)}</strong>${currentOS.prazo_dias ? ` · prazo ${currentOS.prazo_dias} dia(s)` : ''}
            </div>
            <span class="entity-chevron">›</span>
          </div>
        </div>` : ''}

      <!-- Itens -->
      <div class="card mb-3">
        <div class="card-header">
          <h3>Materiais / Itens</h3>
          <div style="display:flex;gap:6px">
            <button class="btn btn-sm btn-outline" onclick="OS.openFaltouMaterial()">🧾 Faltou</button>
            ${currentOS.status !== 'fechado' ? `<button class="btn btn-sm btn-primary" onclick="OS.openItemForm()">+ Item</button>` : ''}
          </div>
        </div>
        <div id="os-itens-list">${renderItens(itens)}</div>
      </div>

      <!-- Sessões de trabalho (diária: "Dias Trabalhados"; normal: "Sessões de Trabalho") -->
      <div class="card mb-3">
        <div class="card-header">
          <h3>Sessões de Trabalho</h3>
          <span class="badge badge-info">${diarias.length} sessão(ões)</span>
        </div>
        <div class="entity-list" style="border-radius:0;border:none;box-shadow:none">
          ${diarias.length === 0
            ? `<div class="entity-empty">Nenhuma sessão registrada ainda</div>`
            : diarias.map(d => {
                const valor = Number(d.valor_manual || d.valor_calculado || 0);
                const horas = Number(d.horas_totais || 0);
                const hhmm  = (t) => String(t || '').replace('@', '').slice(0, 5);
                const blocos = Calculator.blocosFromDiaria(d);
                const periodos = blocos
                  .filter(b => !b.avulso && b.inicio && b.fim)
                  .map(b => `${b.reajuste ? '⚡' : '🕐'} ${hhmm(b.inicio)}–${hhmm(b.fim)}`)
                  .join('  ');
                // Badge de reajuste: soma das horas de blocos com reajuste
                const bk = Calculator.calcBlocos(blocos, 1);
                let reajusteBadge = '';
                if (bk.hReajuste > 0) {
                  const nomes = [...new Set(blocos.filter(b => b.reajuste)
                    .flatMap(b => (b.fatores || []).map(f => (f.label || '').split(' ')[0]))
                    .filter(Boolean))].join(', ');
                  reajusteBadge = `<span class="badge badge-gold" style="font-size:.65rem">⚡ ${Fmt.hours(bk.hReajuste)} reajuste${nomes ? ': ' + nomes : ''}</span>`;
                }
                return `
                  <div class="entity-item" onclick="${currentOS.status !== 'fechado' ? `OS.tapDiaria('${d.id}')` : ''}">
                    <div class="avatar av-navy" style="font-size:.7rem;font-weight:800;flex-direction:column;gap:0;line-height:1.1">
                      <span>${Fmt.date(d.data).split('/').slice(0,2).join('/')}</span>
                    </div>
                    <div class="entity-info">
                      <div class="entity-name">${periodos || (d.valor_manual ? '💰 Valor manual' : 'Sem horários')}</div>
                      <div class="entity-sub">${horas > 0 ? Fmt.hours(horas) : ''}${d.valor_manual ? ' · valor fixo' : ''}</div>
                      ${reajusteBadge ? `<div class="entity-badges">${reajusteBadge}</div>` : ''}
                      ${d.observacoes ? `<div class="diaria-obs">📝 ${d.observacoes}</div>` : ''}
                    </div>
                    <div class="entity-right">
                      <span class="entity-value">${Fmt.currency(valor)}</span>
                      ${currentOS.status !== 'fechado' ? '<span class="entity-chevron">›</span>' : ''}
                    </div>
                  </div>
                `;
              }).join('')}
          ${diarias.length > 0 ? `
            <div class="entity-item" style="background:var(--bg);cursor:default">
              <div class="entity-info">
                <strong>Total (${diarias.length} sessões)</strong>
                <div style="font-size:.78rem;color:var(--text-muted)">${Fmt.hours(diarias.reduce((s,d)=>s+Number(d.horas_totais||0),0))} registradas</div>
              </div>
              <div class="entity-right">
                <span class="entity-value">${Fmt.currency(diarias.reduce((s,d)=>s+Number(d.valor_manual||d.valor_calculado||0),0))}</span>
              </div>
            </div>` : ''}
        </div>
      </div>

      <!-- Parcelas geradas por esta OS — clicáveis, levam para editar no Financeiro.
           Preenchida em _preencheParcelas (não bloqueia o detalhe). -->
      <div class="card mb-3" id="os-parcelas-card">${_parcelasCardInner(null, currentOS.status)}</div>
    `;

    // Carrega as parcelas SEM bloquear: com cache é instantâneo, em rede lenta a
    // seção fica "Carregando…" e atualiza quando responder — o detalhe já está na tela.
    _preencheParcelas(id);
  }

  // Filtra as parcelas desta OS: origem direta ('os') ou via fechamento em lote
  // ('os_lote', vínculo os → fechamento_id → parcela.origem_id). Pura, testável.
  function _parcelasDaOS(parcRes, fosRes, osId) {
    const fechIds = (fosRes?.data || []).filter(f => f.os_id === osId).map(f => f.fechamento_id);
    return (parcRes?.data || [])
      .filter(p => (p.origem === 'os' && p.origem_id === osId) ||
                   (p.origem === 'os_lote' && fechIds.includes(p.origem_id)))
      .sort((a, b) => String(a.data_vencimento || '') < String(b.data_vencimento || '') ? -1 : 1);
  }

  // Conteúdo do card "Parcelas geradas". parcelas=null → estado "Carregando…"
  // (ainda buscando); [] → "nenhuma"; senão a lista clicável.
  function _parcelasCardInner(parcelas, statusOS) {
    const corpo = parcelas === null
      ? `<div class="entity-empty loading-pulse">Carregando…</div>`
      : (parcelas.length === 0
          ? `<div class="entity-empty">${statusOS === 'fechado' ? 'Nenhuma parcela vinculada.' : 'Nenhuma — a parcela é gerada ao fechar a OS.'}</div>`
          : parcelas.map(p => {
              const venc = p.data_vencimento ? Fmt.date(p.data_vencimento) : '—';
              const atrasada = p.status === 'pendente' && String(p.data_vencimento || '').substring(0, 10) < DateUtil.today();
              return `
                <div class="entity-item" onclick="OS.abrirParcela('${p.id}')">
                  <div class="entity-info">
                    <div class="entity-name">${p.descricao || (p.tipo === 'pagar' ? 'A pagar' : 'A receber')}</div>
                    <div class="entity-sub">venc. ${venc}${atrasada ? ' · <span style="color:var(--danger)">atrasada</span>' : ''}</div>
                    <div class="entity-badges">${statusBadge(p.status)}</div>
                  </div>
                  <div class="entity-right">
                    <span class="entity-value">${Fmt.currency(p.valor)}</span>
                    <span class="entity-chevron">›</span>
                  </div>
                </div>`;
            }).join(''));
    return `
      <div class="card-header">
        <h3>Parcelas geradas</h3>
        ${parcelas === null ? '' : `<span class="badge badge-info">${parcelas.length}</span>`}
      </div>
      <div class="entity-list" style="border-radius:0;border:none;box-shadow:none">${corpo}</div>`;
  }

  // Busca parcelas/fechamento_os e injeta no card, sem travar o detalhe. Se o dono
  // trocou de OS ou saiu do detalhe enquanto a rede vinha, descarta (a resposta
  // era pra outra tela). Ver openDetail — foi ele que disparou.
  async function _preencheParcelas(osId) {
    const [parcRes, fosRes] = await Promise.all([
      API.db.read('parcelas'),
      API.db.read('fechamento_os'),
    ]);
    const card = qs('#os-parcelas-card');
    if (!card || currentView !== 'detail' || !currentOS || currentOS.id !== osId) return;
    card.innerHTML = _parcelasCardInner(_parcelasDaOS(parcRes, fosRes, osId), currentOS.status);
  }

  // Abre uma parcela gerada por esta OS para edição (no módulo Financeiro).
  async function abrirParcela(parcelaId) {
    if (!parcelaId) return;
    // Sincroniza o hash p/ 'financeiro' ANTES de navegar (replaceState NÃO dispara
    // hashchange) — assim o modal de edição não é fechado pelo listener de "voltar".
    if ((location.hash || '').replace(/^#/, '') !== 'financeiro') {
      history.replaceState(null, '', '#financeiro');
    }
    await App.navigate('financeiro'); // carrega allParcelas no Financeiro
    Financeiro.editarParcela(parcelaId);
  }

  // ─── CALCULADORA DE VALOR (removida do detalhe) ─────────
  // Card com 3 estados:
  //   1. Sem cálculo + colapsado → botão grande "🧮 Calcular Valor"
  //   2. Com cálculo + colapsado → card-resumo (valor, detalhe, "Editar")
  //   3. Expandido (sempre) → calculadora completa + botão "✓ Pronto"
  async function renderCalculadora(diarias, itens) {
    const card = qs('#os-calc-card');
    if (!card) return;

    const totalItens = itens.reduce((s, i) => s + Number(i.valor_total || 0), 0);

    if (!_calcExpanded) {
      // Estados 1 ou 2: card colapsado
      if (_calc.liquido > 0) {
        // Estado 2: já calculado — mostra resumo
        card.innerHTML = `
          <div class="card-body" style="display:flex;align-items:center;gap:14px;padding:14px 16px">
            <div style="flex:1;min-width:0">
              <div class="info-label" style="margin-bottom:2px">Valor calculado</div>
              <div style="font-size:1.35rem;font-weight:800;color:var(--success);line-height:1.1">${Fmt.currency(_calc.liquido)}</div>
              <div style="font-size:.75rem;color:var(--text-muted);margin-top:2px">${_calc.detalhe || ''}</div>
            </div>
            <button class="btn btn-outline btn-sm" onclick="OS.toggleCalc()">✏️ Editar</button>
          </div>
        `;
      } else {
        // Estado 1: ainda sem cálculo — só o botão
        card.innerHTML = `
          <div class="card-body" style="padding:14px 16px">
            <button class="btn btn-gold btn-full" style="padding:14px;font-size:.95rem" onclick="OS.toggleCalc()">
              🧮 Calcular Valor da OS
            </button>
          </div>
        `;
      }
      return;
    }

    // Estado 3: expandido — calculadora completa
    card.innerHTML = `
      <div class="card-header">
        <h3>💰 Calculadora de Valor</h3>
        <strong id="os-calc-total" class="text-green" style="font-size:1.15rem">—</strong>
      </div>
      <div class="card-body" id="os-calc-body"></div>
      <div class="card-body" style="padding-top:0;display:flex;gap:8px">
        <button class="btn btn-outline" style="flex:0 0 auto" onclick="OS.toggleCalc()">Cancelar</button>
        <button class="btn btn-primary" style="flex:1" onclick="OS.salvarCalculo()">💾 Salvar Cálculo</button>
      </div>
    `;

    const body = qs('#os-calc-body');
    if (currentOS.tipo === 'diaria') {
      body.innerHTML = _renderCalcDiaria(diarias, itens, totalItens);
      calcDiariaUpdate();
    } else {
      const cfg = await Calculator.getConfig();
      body.innerHTML = _renderCalcNormal(cfg, totalItens);
      calcNormalUpdate();
    }
  }

  // Alterna entre calculadora aberta e fechada (re-renderizando só o card)
  async function toggleCalc() {
    _calcExpanded = !_calcExpanded;
    if (!currentOS) return;
    const diarias = allDiarias.filter(d => d.os_id === currentOS.id)
                              .sort((a, b) => a.data > b.data ? -1 : 1); // mais recente primeiro
    const itens   = allItens.filter(i => i.os_id === currentOS.id);
    await renderCalculadora(diarias, itens);
  }

  // Salva o valor calculado na OS para persistir entre sessões.
  // O resumo passa a aparecer mesmo quando você reabre o app depois.
  async function salvarCalculo() {
    if (!currentOS) return;
    if (_calc.liquido <= 0) {
      Toast.warning('Ajuste a calculadora antes de salvar');
      return;
    }
    Loading.show();
    const res = await API.db.update('os', currentOS.id, {
      valor_calculado:   _calc.liquido,
      horas_calculadas:  _calc.horas || 0,
      data_atualizacao:  new Date().toISOString(),
    });
    Loading.hide();
    if (res?.success) {
      currentOS.valor_calculado = _calc.liquido;
      currentOS.horas_calculadas = _calc.horas || 0;
      const idx = allOS.findIndex(o => o.id === currentOS.id);
      if (idx >= 0) {
        allOS[idx].valor_calculado = _calc.liquido;
        allOS[idx].horas_calculadas = _calc.horas || 0;
      }
      Toast.success('Cálculo salvo!');
      // Colapsa a calculadora e mostra o resumo
      _calcExpanded = false;
      const diarias = allDiarias.filter(d => d.os_id === currentOS.id);
      const itens   = allItens.filter(i => i.os_id === currentOS.id);
      await renderCalculadora(diarias, itens);
    } else {
      Toast.error('Erro ao salvar: ' + (res?.error || ''));
    }
  }

  function _renderCalcDiaria(diarias, itens, totalItens) {
    if (diarias.length === 0 && itens.length === 0) {
      return '<p class="text-muted" style="margin:8px 0 0">Adicione dias ou itens para ver o cálculo.</p>';
    }
    return `
      ${diarias.length > 0 ? `
        <div style="font-size:.75rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">Dias a faturar</div>
        <div id="calc-dias">
          ${diarias.map(d => `
            <label class="checkbox-item">
              <input type="checkbox" class="dia-check" value="${d.id}"
                data-valor="${d.valor_manual || d.valor_calculado || 0}"
                onchange="OS.calcDiariaUpdate()" checked>
              <span>${Fmt.date(d.data)} — ${Fmt.currency(d.valor_manual || d.valor_calculado || 0)}</span>
            </label>
          `).join('')}
        </div>
      ` : ''}
      ${totalItens > 0 ? `
        <div class="info-row mt-2"><span>Total itens:</span><strong>${Fmt.currency(totalItens)}</strong></div>
        <input type="hidden" id="calc-itens-total" value="${totalItens.toFixed(2)}">
      ` : '<input type="hidden" id="calc-itens-total" value="0">'}
    `;
  }

  function _renderCalcNormal(cfg, totalItens) {
    const vPrx = Fmt.currency(Number(cfg.valor_chamada_proximo) || 200);
    const vDst = Fmt.currency(Number(cfg.valor_chamada_distante)|| 250);

    // Mão de obra agora vem da SOMA das sessões registradas (horas + fatores por bloco)
    const sessoes   = allDiarias.filter(d => d.os_id === currentOS?.id);
    const maoObra   = sessoes.reduce((s, d) => s + Number(d.valor_manual || d.valor_calculado || 0), 0);
    const horasSess = sessoes.reduce((s, d) => s + Number(d.horas_totais || 0), 0);

    return `
      <!-- Mão de obra (soma das sessões) -->
      <div class="calc-maoobra">
        <div>
          <div class="info-label" style="margin-bottom:2px">Mão de obra</div>
          <div style="font-size:.74rem;color:var(--text-muted)">
            ${sessoes.length > 0 ? `${sessoes.length} sessão(ões) · ${Fmt.hours(horasSess)}` : 'Nenhuma sessão registrada'}
          </div>
        </div>
        <strong style="font-size:1.1rem">${Fmt.currency(maoObra)}</strong>
      </div>
      ${sessoes.length === 0 ? `<p style="font-size:.74rem;color:var(--warning);margin:0 0 10px">⚠ Registre as sessões (horas) pra compor a mão de obra.</p>` : ''}

      <p class="calc-section-label">Material e Chamada</p>
      <div class="form-row">
        <div class="form-group">
          <label>Material extra (R$)</label>
          <input type="number" id="calc-material" class="input" step="0.01" value="0" min="0" oninput="OS.calcNormalUpdate()">
        </div>
        <div class="form-group">
          <label>Admin. Material (%)</label>
          <input type="number" id="calc-taxa-admin" class="input" step="0.5" min="0" value="${cfg.taxa_admin_material || 15}" oninput="OS.calcNormalUpdate()">
        </div>
      </div>
      <label class="checkbox-item">
        <input type="checkbox" id="calc-chamada" onchange="OS.calcNormalUpdate()">
        <span>Chamada Técnica</span>
      </label>
      <div id="calc-chamada-tipo-wrap" class="hidden mt-2">
        <select id="calc-chamada-tipo" class="input" onchange="OS.calcNormalUpdate()">
          <option value="proximo">Próximo (${vPrx})</option>
          <option value="distante">Distante (${vDst})</option>
        </select>
      </div>
      <div class="form-row mt-3">
        <div class="form-group">
          <label>Simples Nacional (%)</label>
          <input type="number" id="calc-simples" class="input" step="0.1" min="0" max="20" value="${cfg.simples_aliquota || 0}" oninput="OS.calcNormalUpdate()">
        </div>
        <div class="form-group">
          <label>Itens do OS</label>
          <input type="text" class="input" value="${Fmt.currency(totalItens)}" readonly style="background:var(--bg)">
          <input type="hidden" id="calc-itens-total" value="${totalItens.toFixed(2)}">
        </div>
      </div>

      <div id="calc-breakdown" class="mt-3"></div>
      <p style="font-size:.72rem;color:var(--text-muted);margin-top:8px">
        💡 Para cobrar um valor diferente do calculado, use "Sobrescrever valor" no fechamento da OS.
      </p>
    `;
  }

  // Recalcula valor para OS diária e atualiza _calc + display
  function calcDiariaUpdate() {
    const checks = qsa('.dia-check:checked');
    const valorDias  = checks.reduce((s, c) => s + Number(c.dataset.valor || 0), 0);
    const totalItens = Number(qs('#calc-itens-total')?.value) || 0;
    const total = valorDias + totalItens;
    _calc = {
      bruto: total,
      liquido: total,
      horas: 0,
      detalhe: `${checks.length} dia(s) + itens`,
    };
    _updateCalcTotal();
  }

  // Recalcula valor para OS normal — mão de obra vem da SOMA das sessões.
  // Material/chamada/itens/Simples se somam; valor manual (se houver) sobrescreve o total,
  // mas o valor calculado continua sempre visível no breakdown.
  async function calcNormalUpdate() {
    const chamadaOn = qs('#calc-chamada')?.checked || false;
    qs('#calc-chamada-tipo-wrap')?.classList.toggle('hidden', !chamadaOn);

    const cfg       = await Calculator.getConfig();
    const sessoes   = allDiarias.filter(d => d.os_id === currentOS?.id);
    const maoObra   = sessoes.reduce((s, d) => s + Number(d.valor_manual || d.valor_calculado || 0), 0);
    const horasSess = sessoes.reduce((s, d) => s + Number(d.horas_totais || 0), 0);

    const tipoChamada = qs('#calc-chamada-tipo')?.value || 'proximo';
    const vChamada = chamadaOn
      ? (tipoChamada === 'proximo' ? Calculator.cfgNum(cfg, 'valor_chamada_proximo', 200)
                                   : Calculator.cfgNum(cfg, 'valor_chamada_distante', 250))
      : 0;

    const material   = Number(qs('#calc-material')?.value   || 0);
    const adminPerc  = Number(qs('#calc-taxa-admin')?.value || 0);
    const matAdmin   = material * (adminPerc / 100);
    const matTotal   = material + matAdmin;

    // #calc-itens-total só existe quando a calculadora está expandida no DOM.
    // Se não estiver (ex: chamado do fechamento com calc colapsada), lê de allItens.
    const totalItens  = qs('#calc-itens-total')
      ? Number(qs('#calc-itens-total').value) || 0
      : allItens.filter(i => i.os_id === currentOS?.id).reduce((s, i) => s + Number(i.valor_total || 0), 0);
    const simplesPerc = Number(qs('#calc-simples')?.value)     || 0;

    const subtotal     = maoObra + matTotal + vChamada + totalItens;
    const valorSimples = subtotal * (simplesPerc / 100);
    const calculado    = Math.round((subtotal + valorSimples) * 100) / 100;

    _calc = {
      bruto:      calculado,
      liquido:    calculado,
      horas:      horasSess,
      detalhe:    `${sessoes.length} sessão(ões) · ${Fmt.hours(horasSess)}`,
      // breakdown guardado para exibir no fechamento mesmo com calc colapsada
      maoObra,
      matTotal,
      vChamada,
      totalItens,
      valorSimples,
      nSessoes: sessoes.length,
    };

    const bd = qs('#calc-breakdown');
    if (bd) {
      const row = (label, val, style = '') =>
        `<div class="info-row" ${style ? `style="${style}"` : ''}><span>${label}</span><span>${val}</span></div>`;
      bd.innerHTML = `<div style="border-top:1px solid var(--border);padding-top:10px">
        ${row(`Mão de obra (${Fmt.hours(horasSess)}):`, Fmt.currency(maoObra))}
        ${material > 0 ? row(`Material + admin (${adminPerc}%):`, Fmt.currency(matTotal)) : ''}
        ${vChamada > 0 ? row('Chamada técnica:', Fmt.currency(vChamada)) : ''}
        ${totalItens > 0 ? row('Itens do OS:', Fmt.currency(totalItens)) : ''}
        ${valorSimples > 0 ? row(`Simples (${simplesPerc}%):`, `+${Fmt.currency(valorSimples)}`, 'color:var(--text-muted)') : ''}
        ${row('<strong>Valor calculado</strong>', `<strong>${Fmt.currency(calculado)}</strong>`, 'border-top:1px solid var(--border);margin-top:6px;padding-top:8px')}
      </div>`;
    }

    _updateCalcTotal();
  }

  function _updateCalcTotal() {
    const el = qs('#os-calc-total');
    if (el) el.textContent = Fmt.currency(_calc.liquido);
  }

  function renderItens(itens) {
    if (itens.length === 0) return '<p class="p-3 text-muted">Nenhum item</p>';
    return `<div class="table-responsive"><table class="table">
      <thead><tr><th>Tipo</th><th>Descrição</th><th>Qtd</th><th>Unit.</th><th>Total</th><th></th></tr></thead>
      <tbody>
        ${itens.map(i => `
          <tr>
            <td><span class="badge ${i.tipo === 'material' ? 'badge-info' : 'badge-secondary'}">${i.tipo}</span></td>
            <td>${i.descricao}</td>
            <td>${i.quantidade}</td>
            <td>${Fmt.currency(i.valor_unit)}</td>
            <td>${Fmt.currency(i.valor_total)}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-sm btn-outline" onclick="OS.openItemForm('${i.id}')">Editar</button>
              <button class="btn btn-sm btn-danger"  onclick="OS.deleteItem('${i.id}')">✕</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table></div>`;
  }

  // ─── FORM OS / ORÇAMENTO ────────────────────────────────
  async function openForm(id = null, registro = 'os') {
    let os = null;
    if (id) {
      os = allOS.find(o => o.id === id) || (await API.db.read('os', id))?.data?.[0];
    }
    const reg    = os ? (os.registro || 'os') : registro;
    const isOrc  = reg === 'orcamento';
    const tipoAtual = os ? osTipo(os) : 'horas';
    const numero = os ? os.numero : await nextOSNumber(isOrc ? 'ORC' : 'OS');
    const titulo = isOrc ? (os ? 'Editar Orçamento' : 'Novo Orçamento') : (os ? 'Editar OS' : 'Nova OS');
    const section = qs('#page-os');
    section.innerHTML = `
      <div class="page-header">
        <button class="btn btn-outline" onclick="${id ? `OS.openDetail('${id}')` : 'OS.render()'}">← Voltar</button>
        <h1>${titulo}</h1>
      </div>
      <div class="card">
        <div class="card-body">
          <form id="os-form" onsubmit="OS.saveForm(event, '${id || ''}')">
            <input type="hidden" name="registro" value="${reg}">
            <div class="form-group">
              <label>Número</label>
              <input type="text" name="numero" class="input" value="${numero}" required>
            </div>
            <div class="form-group">
              <label>Nome <small style="color:var(--text-muted);font-weight:400">(opcional)</small></label>
              <input type="text" name="nome" class="input" value="${os?.nome || ''}" placeholder="${isOrc ? 'Ex: Troca de fiação, Portão...' : 'Ex: Reforma do galpão, Cerca leste...'}">
            </div>
            <div class="form-group">
              <label>Cliente *</label>
              <div class="input-row">
                <select name="cliente_id" id="os-form-cliente" class="input" required>
                  ${App.clienteOptions('cliente', os?.cliente_id)}
                </select>
                <button type="button" class="btn-quick-add" title="Cadastrar novo cliente"
                  onclick="App.quickAdd('os-form-cliente','cliente')">+</button>
              </div>
            </div>
            <div class="form-group">
              <label>Categoria <small style="color:var(--text-muted);font-weight:400">(opcional)</small></label>
              <select name="categoria_id" class="input">
                ${App.categoriaOptions('os', os?.categoria_id)}
              </select>
            </div>
            ${isOrc ? `
              <div class="form-row">
                <div class="form-group">
                  <label>Data do orçamento</label>
                  <input type="date" name="data_inicio" class="input" value="${Fmt.dateInput(os?.data_inicio) || DateUtil.today()}">
                </div>
                <div class="form-group">
                  <label>Prazo estimado (dias)</label>
                  <input type="number" name="prazo_dias" class="input" min="0" step="1" value="${os?.prazo_dias || ''}" placeholder="Ex: 5">
                </div>
              </div>
              <div class="form-group">
                <label>Valor total do orçamento (opcional)
                  <small style="color:var(--text-muted);font-weight:400">— deixe vazio p/ somar os itens</small>
                </label>
                <input type="number" name="orcado_valor" class="input" step="0.01" min="0" value="${os?.orcado_valor || ''}" placeholder="Ex: 2500,00 — total fechado sem detalhar item a item">
              </div>
            ` : `
              <div class="form-group">
                <label>Tipo de cobrança</label>
                <select name="tipo" id="os-form-tipo" class="input" onchange="OS.onTipoOSChange()">
                  <option value="horas" ${tipoAtual==='valor'?'':'selected'}>🕐 Por horas — as horas registradas viram o valor</option>
                  <option value="valor" ${tipoAtual==='valor'?'selected':''}>💰 Valor fechado — preço combinado com o cliente</option>
                </select>
              </div>
              <div class="form-group" id="os-valor-fechado-wrap" style="${tipoAtual==='valor'?'':'display:none'}">
                <label>Valor fechado (R$) <small style="color:var(--text-muted);font-weight:400">— o material pode entrar por cima no fechamento</small></label>
                <input type="number" name="orcado_valor" id="os-form-orcado" class="input" step="0.01" min="0" value="${os?.orcado_valor || ''}" placeholder="Ex: 1500,00">
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Data Início</label>
                  <input type="date" name="data_inicio" class="input" value="${Fmt.dateInput(os?.data_inicio) || DateUtil.today()}">
                </div>
                <div class="form-group">
                  <label>Data Fim</label>
                  <input type="date" name="data_fim" class="input" value="${Fmt.dateInput(os?.data_fim)}">
                </div>
              </div>
              <div class="form-group">
                <label>Status</label>
                <select name="status" class="input">
                  <option value="andamento" ${(!os||os.status==='andamento')?'selected':''}>Em Andamento</option>
                  <option value="rascunho"  ${os?.status==='rascunho' ?'selected':''}>Rascunho</option>
                  <option value="acerto"    ${os?.status==='acerto'   ?'selected':''}>Em Acerto</option>
                  <option value="fechado"   ${os?.status==='fechado'  ?'selected':''}>Fechado</option>
                </select>
              </div>
            `}
            <div class="form-group">
              <label>Observações</label>
              <textarea name="observacoes" class="input" rows="3">${os?.observacoes || ''}</textarea>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary">${isOrc ? 'Salvar Orçamento' : 'Salvar OS'}</button>
              <button type="button" class="btn btn-outline" onclick="${id ? `OS.openDetail('${id}')` : 'OS.render()'}">Cancelar</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  // Mostra/esconde o campo "Valor fechado" conforme o tipo de cobrança escolhido.
  function onTipoOSChange() {
    const valor = qs('#os-form-tipo')?.value === 'valor';
    const wrap  = qs('#os-valor-fechado-wrap');
    if (wrap) wrap.style.display = valor ? '' : 'none';
    if (valor) qs('#os-form-orcado')?.focus();
  }

  // trava de duplo clique (Guard) — o corpo real está em _saveForm
  function saveForm(e, id = '') { return Guard.run('os-save', () => _saveForm(e, id)); }
  async function _saveForm(e, id = '') {
    e.preventDefault();
    const form = e.target;
    const fd   = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    data.data_atualizacao = new Date().toISOString();

    const isOrc = data.registro === 'orcamento';
    // Normaliza tipo de cobrança + valor fechado.
    if (isOrc) {
      // Orçamento: total manual opcional em orcado_valor (vazio = soma dos itens).
      data.orcado_valor = Number(data.orcado_valor) > 0 ? Number(data.orcado_valor) : '';
    } else {
      // OS: 'horas' (as sessões viram o valor) | 'valor' (preço fechado em orcado_valor).
      data.tipo = data.tipo === 'valor' ? 'valor' : 'horas';
      data.orcado_valor = data.tipo === 'valor' ? (Number(data.orcado_valor) || 0) : '';
    }
    Loading.show();
    let res;
    if (id) {
      res = await API.db.update('os', id, data);
    } else {
      if (isOrc && !data.status) data.status = 'orcamento';
      data.data_criacao = new Date().toISOString();
      res = await API.db.create('os', data);
    }
    Loading.hide();

    if (res?.success) {
      const nome = isOrc ? 'Orçamento' : 'OS';
      Toast.success(id ? `${nome} atualizado!` : `${nome} criado!`);
      await loadData();
      if (id) openDetail(id);
      else {
        const newId = res.data?.id;
        if (newId) openDetail(newId);
        else renderList();
      }
    } else {
      Toast.error('Erro ao salvar OS: ' + (res?.error || ''));
    }
  }

  // ─── FORM DIÁRIA / SESSÃO — modelo de blocos de horário (v2) ──
  // (render/add/remove/toggle dos blocos ficam logo após openDiaria)

  // Atalho da home "Registrar o dia": entra na OS e já abre o registro de horas.
  // Com diariaId, abre aquela sessão (ex.: encerrar uma sessão em aberto).
  async function registrarDiaEm(osId, diariaId = null) {
    if (!osId) return;
    // Sincroniza o hash para 'os' ANTES de navegar (via replaceState, que NÃO
    // dispara hashchange). Assim o navigate('os') não muda o hash e o listener
    // de "voltar" (hashchange) não fecha o modal recém-aberto. Ver app.js ~149.
    if ((location.hash || '').replace(/^#/, '') !== 'os') {
      history.replaceState(null, '', '#os');
    }
    await App.navigate('os');   // hash já é 'os' → sem novo hashchange
    await openDetail(osId);     // seta currentOS + renderiza o detalhe
    await openDiaria(diariaId || null); // abre o modal (sessão nova ou a informada)
  }

  // ─── SESSÃO EM ANDAMENTO (iniciar / pausar / retomar / encerrar) ──
  // Uma sessão fica "ativa" enquanto tiver um bloco com flag `aberta`:
  //  • em execução: bloco `{inicio, fim:'', aberta:true}` (o relógio corre);
  //  • pausada:     marcador `{aberta:true, pausada:true}` (relógio parado, dá pra retomar).
  // Períodos já concluídos são blocos normais `{inicio, fim}` (sem `aberta`).
  // Encerrar = abrir a diária e salvar (o fluxo normal remove os marcadores).
  function _horaAgora() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function blocoAberto(d) {
    try {
      const bl = Calculator.blocosFromDiaria(d) || [];
      // Marca `aberta` (execução ou pausa) OU legado (início sem fim, sem flag).
      return bl.find(b => b.aberta === true) || bl.find(b => !b.avulso && b.inicio && !b.fim) || null;
    } catch { return null; }
  }
  // Acha a 1ª sessão ativa de uma OS num array de diárias (a home tem leituras
  // próprias). Retorna { diariaId, inicio, data, pausada } ou null.
  function acharSessaoAberta(diariasArr, osId) {
    for (const d of (diariasArr || [])) {
      if (d.os_id !== osId) continue;
      const b = blocoAberto(d);
      if (b) return { diariaId: d.id, inicio: b.inicio || '', data: d.data, pausada: !!b.pausada };
    }
    return null;
  }

  // Menu de sessão (usado no botão "Sessão" da home e no detalhe): as opções
  // dependem do estado — sem sessão / em execução / pausada.
  async function sessaoMenu(osId) {
    await loadData(); // garante o estado atual das sessões (home lê à parte)
    const os = allOS.find(o => o.id === osId) || (currentOS && currentOS.id === osId ? currentOS : null);
    const ativa = acharSessaoAberta(allDiarias, osId);
    const acoes = [];
    if (!ativa) {
      acoes.push({ icon: '▶', label: 'Iniciar sessão agora', fn: () => iniciarSessaoAgora(osId) });
      acoes.push({ icon: '⏱', label: 'Registrar sessão', fn: () => registrarDiaEm(osId) });
    } else if (ativa.pausada) {
      acoes.push({ icon: '▶', label: 'Retomar sessão', fn: () => retomarSessao(ativa.diariaId) });
      acoes.push({ icon: '⏹', label: 'Encerrar sessão', fn: () => encerrarSessao(ativa.diariaId) });
    } else {
      acoes.push({ icon: '⏸', label: 'Pausar sessão', fn: () => pausarSessao(ativa.diariaId) });
      acoes.push({ icon: '⏹', label: 'Encerrar sessão', fn: () => encerrarSessao(ativa.diariaId) });
    }
    ActionSheet.open('Sessão' + (os?.numero ? ' — ' + os.numero : ''), acoes);
  }

  // Atualiza a tela certa após mexer numa sessão: se estiver NA OS vendo esta OS,
  // re-renderiza o detalhe; senão (ex.: veio da home) re-renderiza a home. Usa a
  // página REAL (App.getCurrentPage), não o currentView do módulo — assim mexer
  // da home não "pula" pro detalhe da OS.
  function _refreshSessao(osId) {
    const naOS = typeof App !== 'undefined' && App.getCurrentPage && App.getCurrentPage() === 'os';
    if (naOS && currentView === 'detail' && currentOS && currentOS.id === osId) openDetail(osId);
    else if (typeof Home !== 'undefined' && Home.render) Home.render();
  }

  // Sufixo do toast quando a gravação só entrou na caderneta (obra sem sinal).
  const _sufixoFila = (r) => (r && r.queued) ? ' · 📮 sem rede' : '';

  // Grava o estado da sessão (recalcula horas/valor dos períodos concluídos) e
  // atualiza a tela (detalhe ou home). Preserva marcadores aberta/pausada.
  // `t` = balão do Toast.progress em andamento — recebe o erro se falhar.
  // Retorna { ok, horas, queued }; horas = total dos períodos já concluídos.
  async function _persistSessao(diariaId, osId, blocos, t = null) {
    const cfg = await Calculator.getConfig();
    const baseRate = Calculator.cfgNum(cfg, 'valor_hora_manutencao', 0) || Calculator.cfgNum(cfg, 'valor_hora', 0);
    const clean = blocos.map(b => {
      if (b.pausada) return { aberta: true, pausada: true };
      const fatores = (b.fatores || []).map(f => ({ id: f.id, label: f.label, percentual: f.percentual }));
      if (b.avulso) return { avulso: true, horas: Number(b.horas || 0), reajuste: !!b.reajuste, fatores };
      const o = { inicio: b.inicio || '', fim: b.fim || '', reajuste: !!b.reajuste, fatores };
      if (b.aberta) o.aberta = true;
      return o;
    });
    const bk = Calculator.calcBlocos(clean, baseRate); // períodos concluídos; abertos contam 0
    Loading.show();
    const res = await API.db.update('diarias', diariaId, {
      horas_totais: bk.horas, valor_calculado: bk.valor, blocos_json: JSON.stringify(clean),
    });
    Loading.hide();
    if (res?.success) {
      await loadData();
      _refreshSessao(osId);
    } else {
      const msg = 'Erro: ' + (res?.error || '');
      if (t) t.fail(msg); else Toast.error(msg);
    }
    return { ok: !!res?.success, horas: bk.horas, queued: !!res?.queued };
  }

  // Mantém data_inicio/data_fim da OS cobrindo as sessões — mesma manutenção que
  // o salvar pelo modal faz (saveDiaria, ~1400). Encerrar é caminho quente: usa o
  // allDiarias já recarregado e só grava quando a 1ª/última data mudou de fato.
  async function _sincronizaDatasOS(osId) {
    const dia = (v) => String(v || '').substring(0, 10);
    const datas = allDiarias.filter(x => x.os_id === osId).map(x => dia(x.data)).filter(Boolean).sort();
    if (!datas.length) return;
    const os = allOS.find(o => o.id === osId);
    const ini = datas[0], fim = datas[datas.length - 1];
    if (!os || (dia(os.data_inicio) === ini && dia(os.data_fim) === fim)) return;
    await API.db.update('os', osId, { data_inicio: ini, data_fim: fim });
    await loadData();
    _refreshSessao(osId);
  }

  // Inicia uma sessão AGORA em 1 toque: diária com um período em execução.
  function iniciarSessaoAgora(osId) { return Guard.run('os-iniciar-sessao', () => _iniciarSessaoAgora(osId)); }
  async function _iniciarSessaoAgora(osId) {
    const os = allOS.find(o => o.id === osId) || currentOS;
    if (!os) return;
    tapFeedback();
    const inicio = _horaAgora();
    const t = Toast.progress('Iniciando sessão…');
    const blocos = [{ inicio, fim: '', aberta: true, reajuste: false, fatores: [] }];
    const data = {
      os_id: osId, categoria_id: os.categoria_id || '', data: DateUtil.today(),
      manha_inicio: '', manha_fim: '', tarde_inicio: '', tarde_fim: '',
      horas_totais: 0, valor_calculado: 0, valor_manual: '',
      reajuste_json: '', blocos_json: JSON.stringify(blocos), observacoes: '',
    };
    Loading.show();
    const res = await API.db.create('diarias', data);
    Loading.hide();
    if (res?.success) {
      await loadData();
      _refreshSessao(osId);
      t.done(`Sessão iniciada às ${inicio}${_sufixoFila(res)}`);
    } else t.fail('Erro: ' + (res?.error || ''));
  }

  // Pausa a sessão: fecha o período em execução (fim = agora) e deixa um
  // marcador de pausa (a sessão segue ativa, o relógio para).
  function pausarSessao(diariaId) { return Guard.run('os-pausar', () => _pausarSessao(diariaId)); }
  async function _pausarSessao(diariaId) {
    const d = allDiarias.find(x => x.id === diariaId);
    if (!d) return;
    tapFeedback();
    const t = Toast.progress('Pausando sessão…');
    let blocos = Calculator.blocosFromDiaria(d).map(b => ({ ...b }));
    const idx = blocos.findIndex(b => b.aberta && b.inicio && !b.fim);
    if (idx >= 0) { blocos[idx].fim = _horaAgora(); delete blocos[idx].aberta; }
    blocos = blocos.filter(b => !b.pausada);
    blocos.push({ aberta: true, pausada: true });
    const r = await _persistSessao(diariaId, d.os_id, blocos, t);
    if (r.ok) t.done('Sessão pausada' + _sufixoFila(r));
  }

  // Retoma a sessão pausada: abre um novo período em execução (início = agora).
  function retomarSessao(diariaId) { return Guard.run('os-retomar', () => _retomarSessao(diariaId)); }
  async function _retomarSessao(diariaId) {
    const d = allDiarias.find(x => x.id === diariaId);
    if (!d) return;
    tapFeedback();
    const inicio = _horaAgora();
    const t = Toast.progress('Retomando sessão…');
    let blocos = Calculator.blocosFromDiaria(d).map(b => ({ ...b })).filter(b => !b.pausada);
    blocos.push({ inicio, fim: '', aberta: true, reajuste: false, fatores: [] });
    const r = await _persistSessao(diariaId, d.os_id, blocos, t);
    if (r.ok) t.done('Sessão retomada às ' + inicio + _sufixoFila(r));
  }

  // Como ficam os blocos ao encerrar: cai o marcador de pausa e o período em
  // execução ganha fim = agora. Sessão pausada não tem período aberto (o relógio
  // parou na pausa) → só perde o marcador. Pura, pra dar pra testar sem rede.
  function blocosAoEncerrar(d, agora) {
    const blocos = Calculator.blocosFromDiaria(d).map(b => ({ ...b })).filter(b => !b.pausada);
    // Em execução — ou legado: início sem fim e sem a flag `aberta`.
    const idx = blocos.findIndex(b => !b.avulso && b.inicio && !b.fim);
    if (idx >= 0) { blocos[idx].fim = agora; delete blocos[idx].aberta; }
    return blocos;
  }

  // Encerra a sessão NA HORA, sem abrir o modal pra salvar. O toast de sucesso é
  // o caminho de ajuste: um toque abre a sessão pra corrigir horário/valor/obs.
  function encerrarSessao(diariaId) { return Guard.run('os-encerrar', () => _encerrarSessao(diariaId)); }
  async function _encerrarSessao(diariaId) {
    const d = allDiarias.find(x => x.id === diariaId);
    if (!d) return;
    tapFeedback();
    const osId = d.os_id;
    const t = Toast.progress('Encerrando sessão…');
    const r = await _persistSessao(diariaId, osId, blocosAoEncerrar(d, _horaAgora()), t);
    if (!r.ok) return;
    await _sincronizaDatasOS(osId);
    t.done(`Sessão encerrada · ${Fmt.hours(r.horas)}${_sufixoFila(r)} — toque pra ajustar`,
           () => registrarDiaEm(osId, diariaId));
  }

  async function openDiaria(diariaId = null) {
    if (!currentOS) return;
    let d = null;
    if (diariaId) d = allDiarias.find(x => x.id === diariaId);
    const titleEl  = qs('#modal-diaria-title');
    if (titleEl) titleEl.textContent = diariaId ? 'Editar Sessão' : 'Registrar Sessão';
    const saveBtn = qs('#modal-diaria-save-btn');
    if (saveBtn) saveBtn.textContent = 'Salvar Sessão';
    const cfg = await Calculator.getConfig();

    qs('#modal-diaria-os-id').value     = currentOS.id;
    qs('#modal-diaria-id').value        = diariaId || '';
    qs('#modal-diaria-data').value      = Fmt.dateInput(d?.data) || DateUtil.today();
    const catPadrao = d?.categoria_id ?? currentOS.categoria_id ?? '';
    qs('#modal-diaria-categoria').innerHTML = App.categoriaOptions('os', catPadrao);
    qs('#modal-diaria-manual').value    = d?.valor_manual || '';
    if (qs('#modal-diaria-obs')) qs('#modal-diaria-obs').value = d?.observacoes || '';

    // Fatores disponíveis (config) — usados ao marcar reajuste num período
    _diariaFatores = Calculator.getFatores(cfg);

    // Carrega os blocos do registro (novos: blocos_json; antigos: manhã/tarde + reajuste).
    // Ignora o marcador de pausa (`pausada`) — é controle interno, não um período.
    if (d) {
      _blocos = Calculator.blocosFromDiaria(d).filter(b => !b.pausada).map(b => ({
        inicio: b.inicio || '', fim: b.fim || '',
        reajuste: !!b.reajuste, fatores: b.fatores || [],
        avulso: !!b.avulso, horas: b.horas || 0,
      }));
    } else {
      _blocos = [];
    }
    // Sempre começa com pelo menos 1 período em branco para preencher
    if (_blocos.length === 0) _blocos = [{ inicio: '', fim: '', reajuste: false, fatores: [] }];

    // "Mais opções" (valor fixo/observação) começa colapsado; abre se já há algo preenchido (edição)
    toggleMaisOpcoes(!!(d?.valor_manual || d?.observacoes));

    renderBlocos();
    await calcDiariaPreview();
    Modal.open('modal-diaria');
  }

  // ─── BLOCOS DE HORÁRIO (períodos) ────────────────────────────
  function renderBlocos() {
    const wrap = qs('#diaria-blocos');
    if (!wrap) return;
    if (_blocos.length === 0) {
      wrap.innerHTML = '<p class="text-muted" style="font-size:.8rem;margin:4px 0">Nenhum período. Toque em "+ Adicionar período".</p>';
      return;
    }
    wrap.innerHTML = _blocos.map((b, i) => {
      const fatoresAtivos = (b.fatores || []).reduce((s, f) => s + Number(f.percentual || 0), 0);
      const dur = (b.inicio && b.fim) ? DateUtil.diffHours(b.inicio, b.fim) : 0;
      return `
      <div class="bloco-row ${b.reajuste ? 'bloco-reajuste' : ''}">
        <div class="bloco-head">
          <span class="bloco-num">${b.reajuste ? '⚡' : '🕐'} Período ${i + 1}${dur > 0 ? ` <small>· ${Fmt.hours(dur)}</small>` : ''}${b.reajuste && fatoresAtivos > 0 ? ` <small class="bloco-pct">+${fatoresAtivos}%</small>` : ''}</span>
          <button type="button" class="bloco-del" title="Remover período" onclick="OS.removeBloco(${i})">🗑</button>
        </div>
        <div class="bloco-times">
          <input type="time" class="input" value="${b.inicio || ''}"
            oninput="OS.setBloco(${i},'inicio',this.value)" onchange="OS.calcDiariaPreview()" aria-label="Início">
          <span class="bloco-sep">→</span>
          <input type="time" class="input" value="${b.fim || ''}"
            oninput="OS.setBloco(${i},'fim',this.value)" onchange="OS.calcDiariaPreview()" aria-label="Fim">
        </div>
        <button type="button" class="bloco-reaj-toggle ${b.reajuste ? 'on' : ''}"
          aria-pressed="${b.reajuste}" onclick="OS.toggleBlocoReajuste(${i})">
          ⚡ Reajuste / fatores de risco
        </button>
        ${b.reajuste ? `
          <div class="bloco-fatores">
            ${_diariaFatores.map(f => {
              const on = (b.fatores || []).some(x => String(x.id) === String(f.id));
              const curto = String(f.label).split('(')[0].trim();
              return `<button type="button" class="chip-fator ${on ? 'on' : ''}" title="${f.label}"
                onclick="OS.toggleBlocoFator(${i},'${f.id}')">
                ${curto} <b>+${f.percentual}%</b>
              </button>`;
            }).join('')}
          </div>` : ''}
      </div>`;
    }).join('');
  }

  function addBloco() {
    _blocos.push({ inicio: '', fim: '', reajuste: false, fatores: [] });
    renderBlocos();
    calcDiariaPreview();
  }

  function removeBloco(i) {
    _blocos.splice(i, 1);
    renderBlocos();
    calcDiariaPreview();
  }

  // Atualiza um campo do bloco sem re-renderizar (preserva foco no input)
  function setBloco(i, campo, valor) {
    if (_blocos[i]) { _blocos[i][campo] = valor; _blocos[i].avulso = false; }
  }

  function toggleBlocoReajuste(i) {
    if (!_blocos[i]) return;
    _blocos[i].reajuste = !_blocos[i].reajuste;
    if (_blocos[i].reajuste && _blocos[i].fatores.length === 0 && _diariaFatores.length === 1) {
      // Atalho: se só existe 1 fator configurado, já marca ele
      _blocos[i].fatores = [{ ..._diariaFatores[0] }];
    }
    renderBlocos();
    calcDiariaPreview();
  }

  function toggleBlocoFator(i, fid) {
    if (!_blocos[i]) return;
    const arr = _blocos[i].fatores || (_blocos[i].fatores = []);
    // Comparação como String — fatores da config têm id numérico, mas o onclick passa string
    const idx = arr.findIndex(f => String(f.id) === String(fid));
    if (idx >= 0) arr.splice(idx, 1);
    else { const f = _diariaFatores.find(x => String(x.id) === String(fid)); if (f) arr.push({ ...f }); }
    renderBlocos();
    calcDiariaPreview();
  }

  async function calcDiariaPreview() {
    const manual   = qs('#modal-diaria-manual')?.value;
    const cfg      = await Calculator.getConfig();
    const baseRate = Calculator.cfgNum(cfg, 'valor_hora_manutencao', 0) || Calculator.cfgNum(cfg, 'valor_hora', 0);

    const bk         = Calculator.calcBlocos(_blocos, baseRate);
    const totalValor = manual ? Number(manual) : bk.valor;

    if (qs('#modal-diaria-horas')) qs('#modal-diaria-horas').textContent = Fmt.hours(bk.horas);
    if (qs('#modal-diaria-valor')) qs('#modal-diaria-valor').textContent = Fmt.currency(totalValor);

    // Sublinha da caixa verde: base/h + quebra normal×reajuste, ou aviso de valor fixo
    const sub = qs('#modal-diaria-base-sub');
    if (sub) {
      if (manual) {
        sub.innerHTML = `valor fixo aplicado · cálculo seria ${Fmt.currency(bk.valor)}`;
      } else if (bk.hReajuste > 0) {
        sub.innerHTML = `base ${Fmt.currency(baseRate)}/h · ${Fmt.hours(bk.hNormal)} normal (${Fmt.currency(bk.valorNormal)}) + <span class="calc-sub-reaj">⚡ ${Fmt.hours(bk.hReajuste)} reajuste (${Fmt.currency(bk.valorReajuste)})</span>`;
      } else {
        sub.innerHTML = `base ${Fmt.currency(baseRate)}/h`;
      }
    }
  }

  function toggleMaisOpcoes(forceOpen) {
    const body = qs('#diaria-mais-opcoes');
    const btn  = qs('#diaria-mais-toggle');
    if (!body) return;
    const abrir = (typeof forceOpen === 'boolean') ? forceOpen : body.style.display === 'none';
    body.style.display = abrir ? '' : 'none';
    btn?.classList.toggle('open', abrir);
  }

  // trava de duplo clique (Guard) — o corpo real está em _saveDiaria
  function saveDiaria() { return Guard.run('os-sessao', _saveDiaria); }
  async function _saveDiaria() {
    const osId   = qs('#modal-diaria-os-id').value;
    const id     = qs('#modal-diaria-id').value;
    const manual = qs('#modal-diaria-manual').value;

    // Mantém só períodos com horas válidas (>0)
    const blocosValidos = _blocos.filter(b => {
      const h = b.avulso ? Number(b.horas || 0)
                         : ((b.inicio && b.fim) ? DateUtil.diffHours(b.inicio, b.fim) : 0);
      return h > 0;
    });
    // Períodos "abertos": têm início mas ainda não têm fim.
    const blocosAbertos = _blocos.filter(b => !b.avulso && b.inicio && !b.fim);

    // Sessão EM ABERTO: só início, sem fim e sem valor fixo → salva pra encerrar
    // depois (na home aparece "▶ Desde HH:MM"). Não vira valor até ter o fim.
    if (blocosValidos.length === 0 && !manual && blocosAbertos.length > 0) {
      return _saveDiariaAberta(osId, id, blocosAbertos);
    }

    if (blocosValidos.length === 0 && !manual) {
      Toast.warning('Preencha ao menos um período (início e fim) ou um valor fixo');
      return;
    }

    const cfg      = await Calculator.getConfig();
    const baseRate = Calculator.cfgNum(cfg, 'valor_hora_manutencao', 0) || Calculator.cfgNum(cfg, 'valor_hora', 0);
    const bk        = Calculator.calcBlocos(blocosValidos, baseRate);
    const valorCalc = bk.valor;

    // Persiste só o essencial de cada bloco
    const blocosClean = blocosValidos.map(b => {
      const fatores = (b.fatores || []).map(f => ({ id: f.id, label: f.label, percentual: f.percentual }));
      return b.avulso
        ? { avulso: true, horas: Number(b.horas || 0), reajuste: !!b.reajuste, fatores }
        : { inicio: b.inicio, fim: b.fim, reajuste: !!b.reajuste, fatores };
    });

    const data = {
      os_id:           osId,
      categoria_id:    qs('#modal-diaria-categoria')?.value || '',
      data:            qs('#modal-diaria-data').value,
      // Campos manhã/tarde legados ficam vazios — fonte de verdade é blocos_json
      manha_inicio: '', manha_fim: '', tarde_inicio: '', tarde_fim: '',
      horas_totais:    bk.horas,
      valor_calculado: valorCalc,
      valor_manual:    manual || '',
      reajuste_json:   '',
      blocos_json:     JSON.stringify(blocosClean),
      observacoes:     qs('#modal-diaria-obs')?.value.trim() || '',
    };

    Loading.show();
    const res = id ? await API.db.update('diarias', id, data) : await API.db.create('diarias', data);
    Loading.hide();

    if (res?.success) {
      Toast.success('Sessão registrada!');
      Modal.close('modal-diaria');
      const dRes = await API.db.read('diarias', null, { os_id: osId });
      const dias = (dRes?.data || []).sort((a, b) => a.data > b.data ? 1 : -1);
      if (dias.length > 0) {
        await API.db.update('os', osId, { data_inicio: dias[0].data, data_fim: dias[dias.length-1].data });
      }
      await loadData();
      openDetail(osId);
    } else {
      Toast.error('Erro: ' + (res?.error || ''));
    }
  }

  // Salva uma sessão EM ABERTO (só início, sem fim). horas/valor = 0 até encerrar.
  async function _saveDiariaAberta(osId, id, blocosAbertos) {
    const blocosClean = blocosAbertos.map(b => ({
      inicio: b.inicio, fim: '', aberta: true, reajuste: !!b.reajuste,
      fatores: (b.fatores || []).map(f => ({ id: f.id, label: f.label, percentual: f.percentual })),
    }));
    const data = {
      os_id:           osId,
      categoria_id:    qs('#modal-diaria-categoria')?.value || '',
      data:            qs('#modal-diaria-data').value,
      manha_inicio: '', manha_fim: '', tarde_inicio: '', tarde_fim: '',
      horas_totais:    0,
      valor_calculado: 0,
      valor_manual:    '',
      reajuste_json:   '',
      blocos_json:     JSON.stringify(blocosClean),
      observacoes:     qs('#modal-diaria-obs')?.value.trim() || '',
    };
    Loading.show();
    const res = id ? await API.db.update('diarias', id, data) : await API.db.create('diarias', data);
    Loading.hide();
    if (res?.success) {
      Toast.success('Sessão iniciada — encerre depois');
      Modal.close('modal-diaria');
      await loadData();
      openDetail(osId);
    } else {
      Toast.error('Erro: ' + (res?.error || ''));
    }
  }

  async function deleteDiaria(id) {
    Modal.confirm('Excluir esta sessão?', async () => {
      await API.db.delete('diarias', id);
      Toast.success('Sessão excluída');
      await loadData();
      openDetail(currentOS.id);
    });
  }

  function tapDiaria(id) {
    ActionSheet.open('Sessão registrada', [
      { icon: '✏️', label: 'Editar', fn: () => openDiaria(id) },
      { icon: '🗑', label: 'Excluir', fn: () => deleteDiaria(id), danger: true },
    ]);
  }

  // ─── ITENS ──────────────────────────────────────────────
  let _itemEstoque = []; // itens do estoque em cache p/ a busca do modal-item

  async function openItemForm(itemId = null) {
    if (!currentOS) return;
    const item   = itemId ? allItens.find(i => i.id === itemId) : null;
    const estRes = await API.db.read('estoque');
    _itemEstoque = (estRes?.data || []).filter(e => e.ativo !== false && e.ativo !== 'false');

    qs('#modal-item-id').value    = itemId || '';
    qs('#modal-item-os-id').value = currentOS.id;
    qs('#modal-item-tipo').value  = item?.tipo || 'material';
    qs('#modal-item-desc').value  = item?.descricao || '';
    qs('#modal-item-qtd').value   = item?.quantidade || '1';
    qs('#modal-item-unit').value  = item?.valor_unit || '';
    qs('#modal-item-total').value = item?.valor_total || '';
    if (qs('#modal-item-quempagou')) qs('#modal-item-quempagou').value = '';
    qs('#modal-item-estoque').value = item?.estoque_id || '';
    qs('#modal-item-busca').value   = '';
    // Item já vinculado (edição): mostra qual é; senão convida a buscar.
    const vinc = item?.estoque_id ? _itemEstoque.find(e => e.id === item.estoque_id) : null;
    renderItemResultados(vinc ? [vinc] : [], vinc ? vinc.id : '');
    onItemTipoChange(); // sincroniza visibilidade do campo quem pagou
    // "Adicionar e continuar" só faz sentido ao adicionar (não ao editar um item).
    const contBtn = qs('#modal-item-continuar');
    if (contBtn) contBtn.style.display = itemId ? 'none' : '';
    Modal.open('modal-item');
  }

  // Busca do item no estoque (offline-friendly: filtra o cache local).
  function filtrarItemEstoque(q) {
    const termo = String(q || '').trim();
    if (!termo) { renderItemResultados([], qs('#modal-item-estoque').value); return; }
    const achados = filterRecords(_itemEstoque, termo, ['descricao', 'grupo', 'unidade']).slice(0, 30);
    renderItemResultados(achados, qs('#modal-item-estoque').value);
  }

  function renderItemResultados(lista, selId) {
    const box = qs('#modal-item-resultados');
    if (!box) return;
    if (!lista.length) {
      box.innerHTML = _itemEstoque.length
        ? '<div class="item-busca-hint">Digite pra buscar no estoque (ou preencha à mão abaixo)</div>'
        : '<div class="item-busca-hint">Estoque vazio — preencha à mão abaixo</div>';
      return;
    }
    box.innerHTML = lista.map(e => `
      <div class="item-busca-row ${e.id === selId ? 'is-sel' : ''}" onclick="OS.escolherItemEstoque('${e.id}')">
        <div style="flex:1;min-width:0">
          <div class="item-busca-nome">${e.descricao}${e.grupo ? ` <span class="item-busca-grp">📁 ${e.grupo}</span>` : ''}</div>
          <div class="item-busca-sub">${Number(e.quantidade || 0)} ${e.unidade || 'un'} · ${Fmt.currency(e.valor_unit)}/un</div>
        </div>
        ${e.id === selId ? '<span style="color:var(--success);font-weight:800">✓</span>' : ''}
      </div>`).join('');
  }

  function escolherItemEstoque(id) {
    const e = _itemEstoque.find(x => x.id === id);
    if (!e) return;
    // Toggle: reclicar no já selecionado desvincula
    const jaSel = qs('#modal-item-estoque').value === id;
    qs('#modal-item-estoque').value = jaSel ? '' : id;
    if (!jaSel) {
      qs('#modal-item-desc').value = e.descricao || '';
      qs('#modal-item-unit').value = e.valor_unit || '';
      const qtd = Number(qs('#modal-item-qtd').value) || 1;
      qs('#modal-item-total').value = (qtd * (Number(e.valor_unit) || 0)).toFixed(2);
    }
    renderItemResultados([e], jaSel ? '' : id);
  }

  // Mostra/oculta campo "quem pagou" conforme o tipo do item
  function onItemTipoChange() {
    const tipo = qs('#modal-item-tipo')?.value;
    const wrap = qs('#item-quempagou-wrap');
    if (wrap) wrap.style.display = tipo === 'material' ? '' : 'none';
    if (tipo !== 'material' && qs('#modal-item-quempagou')) {
      qs('#modal-item-quempagou').value = '';
    }
  }

  // Limpa o form do item pro próximo (mantém o tipo escolhido), foca a busca.
  function _resetItemForm() {
    qs('#modal-item-id').value      = '';
    qs('#modal-item-estoque').value = '';
    qs('#modal-item-desc').value    = '';
    qs('#modal-item-qtd').value     = '1';
    qs('#modal-item-unit').value    = '';
    qs('#modal-item-total').value   = '';
    if (qs('#modal-item-quempagou')) qs('#modal-item-quempagou').value = '';
    qs('#modal-item-busca').value   = '';
    renderItemResultados([], '');
    onItemTipoChange();
    qs('#modal-item-busca')?.focus();
  }

  // trava de duplo clique (Guard) — o corpo real está em _saveItem.
  // continuar=true: salva e mantém o modal aberto pra adicionar o próximo item.
  function saveItem(continuar = false) { return Guard.run('os-item', () => _saveItem(continuar)); }
  async function _saveItem(continuar = false) {
    const itemId    = qs('#modal-item-id').value;
    const osId      = qs('#modal-item-os-id').value;
    const tipo      = qs('#modal-item-tipo').value;
    const estId     = qs('#modal-item-estoque').value;
    const desc      = qs('#modal-item-desc').value;
    const qtd       = Number(qs('#modal-item-qtd').value) || 1;
    const unit      = Number(qs('#modal-item-unit').value) || 0;
    const total     = Number(qs('#modal-item-total').value) || (qtd * unit);
    const quemPagou = (tipo === 'material' ? qs('#modal-item-quempagou')?.value : '') || '';

    if (!desc && !estId) { Toast.warning('Informe a descrição'); return; }

    let finalDesc  = desc;
    let finalEstId = estId;

    if (!itemId && estId) {
      // Novo item do estoque: baixa + movimentação rastreada (uso em OS).
      // Offline, a movimentação NÃO entra na caderneta (mexe em saldo de
      // estoque = check-then-write) — o item grava e a baixa fica pra depois.
      const estRes = await API.db.read('estoque', estId);
      const est = estRes?.data?.[0];
      if (est) {
        finalDesc = est.descricao;
        if (navigator.onLine === false) {
          Toast.warning('Sem internet — item salvo, mas a baixa no estoque não foi registrada. Ajuste depois em Estoque.');
        } else {
          await API.db.registrarMovEstoque({
            estoque_id: estId, tipo: 'saida', motivo: 'uso_os',
            quantidade: qtd, origem: 'os', origem_id: osId,
            observacoes: 'OS #' + (currentOS?.numero || ''),
          });
        }
      }
    } else if (itemId) {
      // Edição: ajusta o estoque pela diferença, registrando a movimentação
      const original = allItens.find(i => i.id === itemId);
      if (original?.estoque_id) {
        const diff = Number(original.quantidade || 0) - qtd; // >0 devolve ao estoque, <0 consome mais
        if (diff > 0) {
          await API.db.registrarMovEstoque({ estoque_id: original.estoque_id, tipo: 'entrada', motivo: 'devolucao', quantidade: diff, origem: 'os', origem_id: osId, observacoes: 'Ajuste de item na OS' });
        } else if (diff < 0) {
          await API.db.registrarMovEstoque({ estoque_id: original.estoque_id, tipo: 'saida', motivo: 'uso_os', quantidade: -diff, origem: 'os', origem_id: osId, observacoes: 'Ajuste de item na OS' });
        }
        finalEstId = original.estoque_id;
      }
    }

    const itemData = {
      os_id: osId, tipo, descricao: finalDesc,
      estoque_id: finalEstId || '',
      quantidade: qtd, valor_unit: unit, valor_total: total,
    };

    Loading.show();
    const res = itemId
      ? await API.db.update('os_itens', itemId, itemData)
      : await API.db.create('os_itens', itemData);

    // Se material pago por colaborador: gerar fiado de reembolso.
    // Item veio da caderneta (queued) = estamos offline: a cadeia parcela→fiado
    // referencia ids entre si e o backend antigo regenera ids de create — não é
    // seguro enfileirar. Fica pro dono lançar depois, com aviso honesto.
    if (res?.success && res.queued && !itemId && quemPagou && total > 0) {
      Toast.warning('Sem internet — o reembolso de quem pagou NÃO foi lançado. Registre depois no Financeiro.');
    }
    if (res?.success && !res.queued && !itemId && quemPagou && total > 0) {
      const pessoaFmt = quemPagou.charAt(0).toUpperCase() + quemPagou.slice(1);
      const catFiado  = App.getCategorias().find(c => c.nome === `Fiado ${pessoaFmt}`)?.id || '';
      const osNum     = currentOS?.numero || '';
      const parc = await API.db.create('parcelas', {
        tipo: 'pagar', origem: 'fiado', origem_id: '',
        cliente_id: '', valor: total,
        descricao:        `Reembolso ${pessoaFmt}: ${finalDesc || desc} (OS #${osNum})`,
        data_competencia: DateUtil.today().substring(0, 7) + '-01',
        data_vencimento:  DateUtil.today(),
        data_pagamento:   '',
        status:           'pendente',
        categoria_id:     catFiado,
        observacoes:      `Material na OS #${osNum}`,
      });
      if (parc?.data?.id) {
        const fiad = await API.db.create('fiado', {
          pessoa:           quemPagou,
          descricao:        `${finalDesc || desc} (OS #${osNum})`,
          valor:            total,
          data:             DateUtil.today(),
          parcela_pagar_id: parc.data.id,
          status:           'pendente',
          observacoes:      `Material na OS #${osNum}`,
        });
        if (fiad?.data?.id) {
          await API.db.update('parcelas', parc.data.id, { origem_id: fiad.data.id });
        }
      }
    }
    Loading.hide();

    if (res?.success) {
      const msg = (!itemId && quemPagou)
        ? `Item adicionado! Fiado de reembolso gerado para ${quemPagou.charAt(0).toUpperCase() + quemPagou.slice(1)}.`
        : (itemId ? 'Item atualizado!' : 'Item adicionado!');
      Toast.success(msg);
      await loadData();
      openDetail(osId); // re-renderiza o detalhe (fica atrás do modal se continuar)
      if (continuar) {
        // Mantém o modal aberto: atualiza o cache da busca e limpa o form pro próximo.
        const estRes = await API.db.read('estoque');
        _itemEstoque = (estRes?.data || []).filter(e => e.ativo !== false && e.ativo !== 'false');
        _resetItemForm();
      } else {
        Modal.close('modal-item');
      }
    } else {
      Toast.error('Erro: ' + (res?.error || ''));
    }
  }

  async function deleteItem(id) {
    Modal.confirm('Remover este item?', async () => {
      const item = allItens.find(i => i.id === id);
      // Devolver ao estoque se for material (+ movimentação de devolução)
      if (item?.estoque_id && item.tipo === 'material') {
        await API.db.registrarMovEstoque({
          estoque_id: item.estoque_id, tipo: 'entrada', motivo: 'devolucao',
          quantidade: Number(item.quantidade || 0), origem: 'os',
          origem_id: currentOS?.id || '', observacoes: 'Item removido da OS',
        });
      }
      await API.db.delete('os_itens', id);
      Toast.success('Item removido');
      await loadData();
      openDetail(currentOS.id);
    });
  }

  // ─── ORÇAMENTO (registro tipo OS, simplificado) ──────────────
  // Orçamento = registro 'os' com registro='orcamento'. Itens em os_itens
  // (SEM baixa de estoque). Valor = soma dos itens. "Gerar OS" cria uma OS
  // nova só com cliente + categoria + referência (orçado em X: valor/data/prazo).

  // Tela do orçamento — chamada por openDetail quando registro==='orcamento'.
  function renderOrcamentoDetail() {
    const o = currentOS;
    const itens = allItens.filter(i => i.os_id === o.id);
    // Total = valor total manual (se informado no cabeçalho) OU a soma dos itens.
    const somaItens  = itens.reduce((s, i) => s + Number(i.valor_total || 0), 0);
    const totalManual = Number(o.orcado_valor) > 0 ? Number(o.orcado_valor) : 0;
    const total = totalManual > 0 ? totalManual : somaItens;
    const cliente = App.clienteNome(o.cliente_id);
    const catNome = o.categoria_id ? App.categoriaNome(o.categoria_id) : '';
    const jaGerou = allOS.some(x => x.orcamento_id === o.id);
    const section = qs('#page-os');
    section.innerHTML = `
      <div class="page-header" style="gap:8px">
        <button class="btn btn-outline btn-sm" onclick="OS.render()">← Voltar</button>
        <div style="flex:1;min-width:0">
          <div style="font-size:.72rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px">📄 Orçamento ${o.numero}${catNome ? ` · ${catNome}` : ''}</div>
          <div style="font-weight:800;font-size:1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${o.nome || cliente}</div>
          ${o.nome ? `<div style="font-size:.78rem;color:var(--text-muted)">${cliente}</div>` : ''}
        </div>
        <button class="btn btn-outline btn-sm" onclick="OS.openForm('${o.id}','orcamento')">Editar</button>
      </div>

      <div style="display:flex;gap:10px;margin-bottom:16px">
        <button class="btn btn-gold" style="flex:1;font-size:1rem;padding:13px 8px;border-radius:12px" onclick="OS.gerarOSdeOrcamento('${o.id}')">
          ${jaGerou ? '↻ Gerar OS de novo' : '➜ Gerar OS'}
        </button>
        <button class="btn btn-outline" style="font-size:1rem;padding:13px 14px" onclick="Doc.gerar('${o.id}','orcamento')">📄 PDF</button>
      </div>

      <div class="card mb-3">
        <div class="card-body" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><div class="info-label">Cliente</div><strong>${cliente}</strong></div>
          <div><div class="info-label">Data</div><strong>${Fmt.date(o.data_inicio)}</strong></div>
          ${catNome ? `<div><div class="info-label">Categoria</div><strong>${catNome}</strong></div>` : ''}
          <div><div class="info-label">Prazo</div><strong>${o.prazo_dias ? o.prazo_dias + ' dia(s)' : '—'}</strong></div>
          ${jaGerou ? `<div style="grid-column:1/-1"><span class="badge badge-success">✓ Já gerou OS</span></div>` : ''}
          ${o.observacoes ? `<div style="grid-column:1/-1"><div class="info-label">Observações</div><span style="color:var(--text-muted)">${o.observacoes}</span></div>` : ''}
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-header">
          <h3>Itens do Orçamento</h3>
          <div style="display:flex;gap:6px">
            <button class="btn btn-sm btn-outline" onclick="OS.openOrcItemForm(null,'grupo')">+ Grupo</button>
            <button class="btn btn-sm btn-primary" onclick="OS.openOrcItemForm()">+ Item</button>
          </div>
        </div>
        <div>${renderOrcItens(itens)}</div>
      </div>

      <div class="card mb-3">
        <div class="card-body" style="font-weight:800;font-size:1.05rem">
          <div class="info-row">
            <span>${totalManual > 0 ? 'Total fechado' : 'Total estimado'}</span>
            <span class="text-navy">${Fmt.currency(total)}</span>
          </div>
          ${totalManual > 0 && somaItens > 0 && Math.abs(somaItens - totalManual) > 0.005 ? `
          <div class="info-row" style="font-weight:400;font-size:.78rem;color:var(--text-muted);margin-top:4px">
            <span>Itens somam ${Fmt.currency(somaItens)} · vale o total fechado</span>
          </div>` : ''}
        </div>
      </div>
    `;
  }

  function renderOrcItens(itens) {
    if (itens.length === 0) return '<p class="p-3 text-muted">Nada ainda — use “+ Grupo” ou “+ Item”.</p>';
    const grupos  = itens.filter(i => i.tipo === 'grupo');
    const simples = itens.filter(i => i.tipo !== 'grupo');
    let html = '';
    // Grupos como blocos (título + valor + serviços em tópicos).
    grupos.forEach((i, idx) => {
      const g = parseGrupo(i);
      html += `
        <div class="orc-grupo-card">
          <div class="orc-grupo-head">
            <div class="orc-grupo-titulo">${idx + 1}. ${Fmt.esc(g.titulo)}</div>
            <div class="orc-grupo-valor">${Fmt.currency(g.valor)}</div>
          </div>
          ${g.servicos.length ? `<ul class="orc-grupo-lista">
            ${g.servicos.map(s => `<li>${Fmt.esc(s.desc)}${s.valor ? ` <span class="orc-gserv-tag">${Fmt.currency(s.valor)}</span>` : ''}</li>`).join('')}
          </ul>` : ''}
          <div class="orc-grupo-actions">
            <button class="btn btn-sm btn-outline" onclick="OS.openOrcItemForm('${i.id}')">Editar</button>
            <button class="btn btn-sm btn-danger"  onclick="OS.deleteOrcItem('${i.id}')">✕</button>
          </div>
        </div>`;
    });
    // Itens avulsos (material/serviço) na tabela de sempre.
    if (simples.length) {
      html += `<div class="table-responsive"><table class="table">
        <thead><tr><th>Tipo</th><th>Descrição</th><th>Qtd</th><th>Unit.</th><th>Total</th><th></th></tr></thead>
        <tbody>
          ${simples.map(i => `
            <tr>
              <td><span class="badge ${i.tipo === 'material' ? 'badge-info' : 'badge-secondary'}">${i.tipo === 'material' ? 'material' : 'serviço'}</span></td>
              <td>${Fmt.esc(i.descricao)}</td>
              <td>${i.quantidade === '' || i.quantidade == null ? '—' : i.quantidade}</td>
              <td>${i.valor_unit === '' || i.valor_unit == null || Number(i.valor_unit) === 0 ? '—' : Fmt.currency(i.valor_unit)}</td>
              <td>${Fmt.currency(i.valor_total)}</td>
              <td style="white-space:nowrap">
                <button class="btn btn-sm btn-outline" onclick="OS.openOrcItemForm('${i.id}')">Editar</button>
                <button class="btn btn-sm btn-danger"  onclick="OS.deleteOrcItem('${i.id}')">✕</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>`;
    }
    return html;
  }

  // Item do orçamento: grava em os_itens (os_id = orçamento), SEM mexer no estoque.
  // Serviço: esconde quantidade/unitário (basta descrição + um valor opcional).
  function onOrcItemTipoChange() {
    const tipo   = qs('#orc-item-tipo')?.value;
    const grupo  = tipo === 'grupo';
    const serv   = tipo === 'servico';
    const row = qs('#orc-item-qtdrow');
    if (row) row.style.display = (serv || grupo) ? 'none' : '';        // grupo/serviço não têm qtd×unit
    const gwrap = qs('#orc-grupo-wrap');
    if (gwrap) gwrap.style.display = grupo ? '' : 'none';
    const dlbl = qs('#orc-item-desc-label');
    if (dlbl) dlbl.textContent = grupo ? 'Título do grupo *' : 'Descrição *';
    const desc = qs('#orc-item-desc');
    if (desc) desc.placeholder = grupo ? 'Ex: Reforma e vedação das portas' : 'Ex: Cabo 2,5mm  /  Instalação elétrica';
    const lbl = qs('#orc-item-total-label');
    if (lbl) lbl.textContent = grupo ? 'Valor do grupo (R$)' : (serv ? 'Valor do serviço (opcional)' : 'Valor Total');
    // Grupo recém-escolhido sem nenhuma linha ainda: começa com uma vazia.
    if (grupo && qs('#orc-grupo-servicos') && !qs('#orc-grupo-servicos').children.length) addGrupoServico();
  }

  // ─── GRUPO DE SERVIÇOS (item do orçamento, tipo 'grupo') ─────
  // Encaixado em os_itens SEM coluna nova: `descricao` guarda o título na 1ª
  // linha e cada serviço nas seguintes ("desc" ou "desc\tvalor"); `valor_total`
  // guarda o valor do grupo. Assim soma normal no total, no PDF e no "Gerar OS".
  function parseGrupo(item) {
    const linhas = String(item.descricao || '').split('\n');
    const titulo = (linhas[0] || '').trim();
    const servicos = linhas.slice(1).map(l => {
      const [d, v] = String(l).split('\t');
      const valor = (v != null && String(v).trim() !== '') ? Number(v) || 0 : '';
      return { desc: (d || '').trim(), valor };
    }).filter(s => s.desc);
    return { titulo, servicos, valor: Number(item.valor_total) || 0 };
  }
  // Monta {descricao, valor_total} a partir do form. Valor do grupo manual vence;
  // vazio → soma dos serviços que tiverem preço (0 se nenhum tiver).
  function encodeGrupo(titulo, servicos, valorGrupo) {
    const linhas = [String(titulo || '').trim()];
    let somaServ = 0;
    servicos.forEach(s => {
      const d = String(s.desc || '').trim();
      if (!d) return;
      const v = Number(s.valor) || 0;
      if (v > 0) { somaServ += v; linhas.push(d + '\t' + v); }
      else linhas.push(d);
    });
    const vg = Number(valorGrupo) || 0;
    return { descricao: linhas.join('\n'), valor_total: vg > 0 ? vg : somaServ };
  }
  // Adiciona uma linha de serviço no modal do grupo (desc + valor opcional).
  function addGrupoServico(desc = '', valor = '') {
    const wrap = qs('#orc-grupo-servicos');
    if (!wrap) return;
    const row = document.createElement('div');
    row.className = 'orc-gserv-row';
    row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px';
    row.innerHTML = `
      <input type="text" class="input orc-gserv-desc" placeholder="Ex: Reforma da porta principal" style="flex:2;min-width:0">
      <input type="number" class="input orc-gserv-val" placeholder="R$ opc." step="0.01" min="0" style="flex:1;min-width:0">
      <button type="button" class="btn btn-sm btn-danger" title="Remover" onclick="this.closest('.orc-gserv-row').remove()">✕</button>`;
    // value via propriedade (não innerHTML) p/ não precisar escapar aspas.
    row.querySelector('.orc-gserv-desc').value = desc;
    if (valor !== '' && valor != null) row.querySelector('.orc-gserv-val').value = valor;
    wrap.appendChild(row);
  }

  function openOrcItemForm(itemId = null, presetTipo = null) {
    if (!currentOS) return;
    const item = itemId ? allItens.find(i => i.id === itemId) : null;
    qs('#orc-item-id').value    = itemId || '';
    qs('#orc-item-tipo').value  = item?.tipo || presetTipo || 'material';
    qs('#orc-grupo-servicos').innerHTML = '';
    if (item?.tipo === 'grupo') {
      const g = parseGrupo(item);
      qs('#orc-item-desc').value  = g.titulo;
      g.servicos.forEach(s => addGrupoServico(s.desc, s.valor));
      if (!g.servicos.length) addGrupoServico();
      qs('#orc-item-total').value = Number(item.valor_total) > 0 ? item.valor_total : '';
      qs('#orc-item-qtd').value   = '';
      qs('#orc-item-unit').value  = '';
    } else {
      qs('#orc-item-desc').value  = item?.descricao || '';
      qs('#orc-item-qtd').value   = (item && item.quantidade !== '' && item.quantidade != null) ? item.quantidade : '1';
      qs('#orc-item-unit').value  = (item && item.valor_unit !== '' && item.valor_unit != null) ? item.valor_unit : '';
      qs('#orc-item-total').value = item?.valor_total || '';
    }
    qs('#modal-orc-item-title').textContent = item ? 'Editar item' : 'Adicionar item';
    onOrcItemTipoChange();
    Modal.open('modal-orc-item');
  }

  function saveOrcItem() { return Guard.run('orc-item', _saveOrcItem); }
  async function _saveOrcItem() {
    const itemId = qs('#orc-item-id').value;
    const osId   = currentOS.id;
    const tipo   = qs('#orc-item-tipo').value;

    let itemData;
    if (tipo === 'grupo') {
      // Grupo: título + serviços (bullets, valor opcional) + valor do grupo.
      const titulo = qs('#orc-item-desc').value.trim();
      if (!titulo) { Toast.warning('Informe o título do grupo'); return; }
      const servicos = [...document.querySelectorAll('#orc-grupo-servicos .orc-gserv-row')]
        .map(r => ({ desc: r.querySelector('.orc-gserv-desc').value, valor: r.querySelector('.orc-gserv-val').value }))
        .filter(s => s.desc.trim());
      const { descricao, valor_total } = encodeGrupo(titulo, servicos, qs('#orc-item-total').value);
      itemData = { os_id: osId, tipo: 'grupo', descricao, estoque_id: '', quantidade: '', valor_unit: '', valor_total };
    } else {
      const desc = qs('#orc-item-desc').value.trim();
      if (!desc) { Toast.warning('Informe a descrição'); return; }
      // Serviço: só descrição + um valor total (opcional) — sem quantidade/unitário.
      // Material: quantidade × unitário (ou valor total digitado).
      let quantidade = '', valor_unit = '', valor_total = 0;
      if (tipo === 'servico') {
        valor_total = Number(qs('#orc-item-total').value) || 0;
      } else {
        quantidade = Number(qs('#orc-item-qtd').value) || 1;
        valor_unit = Number(qs('#orc-item-unit').value) || 0;
        valor_total = Number(qs('#orc-item-total').value) || (quantidade * valor_unit);
      }
      // Orçamento NÃO mexe em estoque: estoque_id sempre vazio.
      itemData = { os_id: osId, tipo, descricao: desc, estoque_id: '', quantidade, valor_unit, valor_total };
    }

    Loading.show();
    const res = itemId
      ? await API.db.update('os_itens', itemId, itemData)
      : await API.db.create('os_itens', itemData);
    Loading.hide();

    if (res?.success) {
      Toast.success(itemId ? 'Item atualizado' : 'Item adicionado');
      Modal.close('modal-orc-item');
      await loadData();
      openDetail(osId);
    } else Toast.error('Erro: ' + (res?.error || ''));
  }

  async function deleteOrcItem(id) {
    Modal.confirm('Remover este item do orçamento?', async () => {
      await API.db.delete('os_itens', id);
      Toast.success('Item removido');
      await loadData();
      openDetail(currentOS.id);
    });
  }

  // Gera uma OS nova a partir do orçamento: só cliente + categoria + referência.
  function gerarOSdeOrcamento(orcId) { return Guard.run('orc-gerar', () => _gerarOSdeOrcamento(orcId)); }
  async function _gerarOSdeOrcamento(orcId) {
    const orc = allOS.find(o => o.id === orcId) || currentOS;
    if (!orc) return;
    Modal.confirm('Gerar uma OS a partir deste orçamento? O orçamento continua salvo.', async () => {
      // Valor levado p/ a OS = total manual do orçamento (se informado) OU soma dos itens.
      const somaItens = allItens.filter(i => i.os_id === orcId).reduce((s, i) => s + Number(i.valor_total || 0), 0);
      const valor = Number(orc.orcado_valor) > 0 ? Number(orc.orcado_valor) : somaItens;
      Loading.show();
      const res = await API.db.create('os', {
        numero:       await nextOSNumber('OS'),
        nome:         '',
        cliente_id:   orc.cliente_id,
        categoria_id: orc.categoria_id || '',
        registro:     'os',
        tipo:         'valor',
        status:       'andamento',
        data_inicio:  DateUtil.today(),
        orcamento_id: orcId,
        orcado_valor: valor,
        orcado_data:  orc.data_inicio || DateUtil.today(),
        prazo_dias:   orc.prazo_dias || '',
        data_criacao: new Date().toISOString(),
      });
      Loading.hide();
      if (res?.success && res.data?.id) {
        Toast.success('OS gerada a partir do orçamento!');
        await loadData();
        openDetail(res.data.id);
      } else Toast.error('Erro: ' + (res?.error || ''));
    });
  }

  // ─── FALTOU MATERIAL ─────────────────────────────────────────
  // Atalho de campo: percebeu na obra que falta material → anota direto na
  // lista de compras DO CLIENTE da OS, sem sair da tela (antes: OS → Estoque
  // → aba Lista → achar o cliente, 6+ toques). Funciona offline (create de
  // lista_compras está na whitelist da caderneta).
  function openFaltouMaterial() {
    if (!currentOS?.cliente_id) {
      Toast.warning('OS sem cliente — adicione pela aba Lista do Estoque');
      return;
    }
    qs('#modal-faltou-sub').textContent = 'Vai pra lista de compras de ' + App.clienteNome(currentOS.cliente_id);
    qs('#modal-faltou-desc').value = '';
    qs('#modal-faltou-qtd').value  = '1';
    qs('#modal-faltou-und').value  = 'un';
    Modal.open('modal-faltou');
    setTimeout(() => qs('#modal-faltou-desc')?.focus(), 80);
  }

  function saveFaltouMaterial(maisUm) { return Guard.run('os-faltou', () => _saveFaltouMaterial(maisUm)); }
  async function _saveFaltouMaterial(maisUm) {
    const desc = qs('#modal-faltou-desc').value.trim();
    if (!desc) { Toast.warning('Informe o que faltou'); return; }
    const res = await API.db.create('lista_compras', {
      cliente_id:   currentOS.cliente_id,
      descricao:    desc,
      quantidade:   Number(qs('#modal-faltou-qtd').value) || 1,
      unidade:      qs('#modal-faltou-und').value.trim() || 'un',
      status:       'pendente',
      data_criacao: DateUtil.today(),
    });
    if (!res?.success) { Toast.error('Erro: ' + (res?.error || '')); return; }
    if (!res.queued) Toast.success('Na lista de compras!');
    if (maisUm) {
      qs('#modal-faltou-desc').value = '';
      qs('#modal-faltou-qtd').value  = '1';
      qs('#modal-faltou-desc')?.focus();
    } else {
      Modal.close('modal-faltou');
    }
  }

  // ─── FECHAMENTO ──────────────────────────────────────────────
  // Recalcula mão de obra a partir das sessões usando uma hora base.
  // Sessões com valor_manual (>0) ficam fixas; as demais são recalculadas
  // aplicando os fatores/reajuste de cada bloco sobre a nova base.
  function _calcFromBaseFor(os, base) {
    const sessoes = allDiarias.filter(d => d.os_id === os?.id);
    let maoObra = 0, nCalc = 0, nManual = 0;
    for (const d of sessoes) {
      if (Number(d.valor_manual) > 0) { maoObra += Number(d.valor_manual); nManual++; }
      else { maoObra += Calculator.calcBlocos(Calculator.blocosFromDiaria(d), base).valor; nCalc++; }
    }
    const totalItens = allItens.filter(i => i.os_id === os?.id)
      .reduce((s, i) => s + Number(i.valor_total || 0), 0);
    const calculado = Math.round((maoObra + totalItens) * 100) / 100;
    return { maoObra, totalItens, calculado, nSessoes: sessoes.length, nCalc, nManual };
  }

  function _calcFromBase(base) { return _calcFromBaseFor(currentOS, base); }

  // Revela o campo de hora base (fica escondido atrás de um botão p/ não poluir).
  function toggleHoraBase() {
    qs('#fech-hora-base-wrap')?.classList.remove('hidden');
    qs('#fech-hora-base-btn')?.classList.add('hidden');
    const inp = qs('#fech-hora-base');
    if (inp) { inp.focus(); inp.select(); }
  }

  // oninput da hora base no fechamento — recalcula a mão de obra e atualiza tudo.
  // Só roda em OS por horas (o material entra à parte via atualizarFechamento).
  function recalcBaseFechamento() {
    const base = Number(qs('#fech-hora-base')?.value) || 0;
    const r = _calcFromBase(base);
    _calc.maoObra = r.maoObra; _calc.totalItens = r.totalItens;
    _calc.nSessoes = r.nSessoes; _calc.horaBase = base;
    // preço-base da OS por horas = mão de obra recalculada
    if (qs('#fech-preco-base')) qs('#fech-preco-base').value = r.maoObra.toFixed(2);
    if (qs('#fech-maoobra'))    qs('#fech-maoobra').textContent = Fmt.currency(r.maoObra);
    atualizarFechamento();
  }

  async function openFechamento() {
    if (!currentOS) return;

    // Hora base padrão vem da config; pode ser sobrescrita no fechamento.
    const cfg      = await Calculator.getConfig();
    const baseRate = Calculator.cfgNum(cfg, 'valor_hora_manutencao', 0) || Calculator.cfgNum(cfg, 'valor_hora', 0);

    const r0 = _calcFromBase(baseRate);
    // OS que veio de ORÇAMENTO / de valor fechado: o valor orçado é o preço
    // combinado com o cliente. A base do fechamento passa a ser ele; as horas
    // viram REFERÊNCIA (pra saber se saiu no lucro), não recalculam o valor.
    const orcado    = Number(currentOS.orcado_valor || 0);
    const temOrcado = orcado > 0;
    // "Serviço" = a base sem material: valor fechado (orçado) ou mão de obra das sessões.
    const precoBase   = temOrcado ? orcado : r0.maoObra;
    const materialBase = r0.totalItens;                       // soma crua dos itens de material
    const matPctDef   = Calculator.cfgNum(cfg, 'taxa_admin_material', 15); // % padrão sobre o material
    const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
    const matChargeInit = materialBase > 0 ? round2(materialBase * (1 + matPctDef / 100)) : 0;
    const calc = round2(precoBase + matChargeInit);           // material incluído por padrão
    _calc.liquido  = calc; _calc.bruto = calc;
    _calc.maoObra  = r0.maoObra;   _calc.totalItens = r0.totalItens;
    _calc.nSessoes = r0.nSessoes;  _calc.horaBase = baseRate;
    _calc.horaBaseOrig = baseRate; // referência p/ detectar mudança no fechamento

    // Renderiza modal de fechamento
    const section = qs('#page-os');
    section.innerHTML = `
      <div class="page-header">
        <button class="btn btn-outline" onclick="OS.openDetail('${currentOS.id}')">← Voltar</button>
        <h1>Fechar OS — ${currentOS.numero}</h1>
      </div>

      <div class="card" style="max-width:560px;margin:0 auto">
        <div class="card-body">
          <form id="fechamento-form" onsubmit="OS.saveFechamento(event)">
            <input type="hidden" id="fech-os-id" value="${currentOS.id}">

            <!-- Breakdown de valores -->
            <!-- hidden sempre presentes — base para atualizarFechamento e saveFechamento -->
            <input type="hidden" id="fech-calculado-num" value="${calc.toFixed(2)}">
            <input type="hidden" id="fech-preco-base"    value="${precoBase.toFixed(2)}">
            <input type="hidden" id="fech-material-base"  value="${materialBase.toFixed(2)}">

            <div style="background:var(--bg);border-radius:12px;padding:12px 14px;margin-bottom:12px">
              <div style="font-size:.72rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">${temOrcado ? 'Valor combinado' : 'Composição do valor'}</div>
              <div class="info-row" style="margin-bottom:4px">
                <span>${temOrcado ? '💰 Valor fechado' : `Mão de obra (${r0.nSessoes} sessão(ões))`}</span>
                <strong id="fech-maoobra">${Fmt.currency(precoBase)}</strong>
              </div>

              ${materialBase > 0 ? `
              <div style="border-top:1px solid var(--border);margin-top:8px;padding-top:8px">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem;font-weight:600">
                  <input type="checkbox" id="fech-inc-material" checked onchange="OS.atualizarFechamento()" style="width:18px;height:18px;flex:0 0 auto">
                  Incluir material p/ cobrar do cliente
                </label>
                <div class="info-row" style="margin-top:6px;font-size:.8rem;color:var(--text-muted)">
                  <span>Material lançado</span><span>${Fmt.currency(materialBase)}</span>
                </div>
                <div class="input-row" style="margin-top:6px;align-items:center;gap:8px">
                  <span style="font-size:.8rem;color:var(--text-muted);align-self:center">Acréscimo (%)</span>
                  <input type="number" id="fech-mat-pct" class="input" step="1" min="0" value="${matPctDef}"
                    style="flex:0 0 80px;text-align:center" oninput="OS.atualizarFechamento()">
                  <span style="font-size:.8rem;color:var(--text-muted);align-self:center">→ cobrar <strong id="fech-mat-charge" class="text-navy">${Fmt.currency(matChargeInit)}</strong></span>
                </div>
              </div>` : ''}

              <div class="info-row" style="border-top:1px solid var(--border);margin-top:8px;padding-top:8px">
                <span><strong>Valor calculado</strong></span>
                <strong id="fech-calculado-display" class="text-green">${Fmt.currency(calc)}</strong>
              </div>

              ${temOrcado ? `
              <div style="font-size:.72rem;color:var(--text-muted);margin-top:6px">
                🕐 pelas horas daria: <span id="fech-ref-horas">${Fmt.currency(r0.maoObra)}</span> · ${r0.nSessoes} sessão(ões) de mão de obra
              </div>` : ''}
            </div>

            ${r0.nCalc > 0 && !temOrcado ? `
            <div style="margin-bottom:16px">
              <button type="button" id="fech-hora-base-btn" class="btn btn-outline btn-sm" style="font-size:.82rem"
                onclick="OS.toggleHoraBase()">⚙️ Alterar hora base (R$ ${baseRate}/h)</button>
              <div id="fech-hora-base-wrap" class="hidden" style="margin-top:10px">
                <label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:4px">Nova hora base
                  <small style="color:var(--text-muted);font-weight:400">— recalcula todas as sessões (fatores por cima)</small>
                </label>
                <div class="input-row">
                  <span style="align-self:center;color:var(--text-muted);font-weight:700">R$</span>
                  <input type="number" id="fech-hora-base" class="input" step="1" min="0"
                    value="${baseRate}" oninput="OS.recalcBaseFechamento()">
                  <span style="align-self:center;color:var(--text-muted);font-size:.85rem">/h</span>
                </div>
                ${r0.nManual > 0 ? `<small style="color:var(--text-muted);font-size:.72rem">${r0.nManual} sessão(ões) com valor fixo não mudam.</small>` : ''}
              </div>
            </div>
            ` : ''}

            <!-- Sobrescrever valor (opcional) — vale p/ OS normal e diária -->
            <div class="form-group">
              <label>Sobrescrever valor <small style="color:var(--text-muted);font-weight:400">(opcional — ignora o cálculo acima)</small></label>
              <input type="number" id="fech-manual" class="input" step="0.01" min="0" placeholder="Em branco = usar o valor calculado"
                oninput="OS.atualizarFechamento()">
            </div>

            <!-- Desconto com toggle R$ / % -->
            <div class="form-group">
              <label>Desconto</label>
              <div class="input-row">
                <input type="number" id="fech-desconto" class="input" step="0.01" min="0" value="0"
                  oninput="OS.atualizarFechamento()">
                <select id="fech-desconto-tipo" class="input" style="flex:0 0 80px;text-align:center"
                  onchange="OS.toggleDescontoTipo()">
                  <option value="valor">R$</option>
                  <option value="perc">%</option>
                </select>
              </div>
            </div>

            <!-- Valor final destacado -->
            <div class="info-row total-row" style="background:var(--success-lt);border-radius:14px;padding:14px 16px;border:none;margin-bottom:16px">
              <span><strong>Valor final:</strong></span>
              <strong id="fech-final-display" style="font-size:1.4rem;color:var(--success)">${Fmt.currency(calc)}</strong>
            </div>
            <input type="hidden" id="fech-final" value="${calc.toFixed(2)}">

            <hr style="border:none;border-top:1px solid var(--border);margin:16px 0">

            <div class="form-row">
              <div class="form-group">
                <label>Competência</label>
                ${MonthPicker.render('fech-competencia', DateUtil.today().substring(0, 7))}
              </div>
              <div class="form-group">
                <label>Vencimento</label>
                <input type="date" id="fech-vencimento" class="input"
                  value="${DateUtil.today()}" required>
              </div>
            </div>

            ${currentOS.categoria_id ? `
            <div class="form-group">
              <label>Categoria</label>
              <input class="input" readonly style="background:var(--bg);color:var(--text-muted)"
                value="${App.categoriaNome(currentOS.categoria_id)}">
              <small style="color:var(--text-muted);font-size:.72rem">Herdada da OS — altere na OS se precisar mudar.</small>
            </div>
            ` : ''}

            <div class="form-group">
              <label>Observações</label>
              <textarea id="fech-obs" class="input" rows="2"></textarea>
            </div>

            <div class="form-actions">
              <button type="submit" class="btn btn-primary btn-lg">Fechar OS e Gerar Parcela</button>
            </div>
          </form>
        </div>
      </div>
    `;
    // Garante que o display do total inicial está correto
    atualizarFechamento();
  }

  function toggleDescontoTipo() {
    // Resetar campo ao mudar de unidade evita confusão (10% != R$ 10)
    const inp = qs('#fech-desconto');
    if (inp) inp.value = 0;
    atualizarFechamento();
  }

  // Recalcula, ao vivo: valor calculado = preço-base + material (se incluído, com %),
  // e depois o valor final = (sobrescrito || calculado) − desconto.
  function atualizarFechamento() {
    const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
    const precoBase = Number(qs('#fech-preco-base')?.value)    || 0;
    const matBase   = Number(qs('#fech-material-base')?.value) || 0;
    const incEl     = qs('#fech-inc-material');
    const inc       = incEl ? incEl.checked : false;
    const pct       = Number(qs('#fech-mat-pct')?.value) || 0;
    const matCharge = (inc && matBase > 0) ? round2(matBase * (1 + pct / 100)) : 0;
    const calc      = round2(precoBase + matCharge);

    // Atualiza a composição (material cobrado + valor calculado)
    if (qs('#fech-mat-charge'))        qs('#fech-mat-charge').textContent = Fmt.currency(matCharge);
    if (qs('#fech-calculado-num'))     qs('#fech-calculado-num').value = calc.toFixed(2);
    if (qs('#fech-calculado-display')) qs('#fech-calculado-display').textContent = Fmt.currency(calc);

    // Valor final = (sobrescrito || calculado) − desconto
    const manual = Number(qs('#fech-manual')?.value) || 0;
    const base   = manual > 0 ? manual : calc;
    const descVal  = Number(qs('#fech-desconto')?.value) || 0;
    const descTipo = qs('#fech-desconto-tipo')?.value || 'valor';
    const descontoAbs = descTipo === 'perc' ? (base * descVal / 100) : descVal;
    const final = Math.max(0, base - descontoAbs);

    if (qs('#fech-final'))         qs('#fech-final').value = final.toFixed(2);
    if (qs('#fech-final-display')) qs('#fech-final-display').textContent = Fmt.currency(final);
  }

  // trava de duplo clique (Guard) — o corpo real está em _saveFechamento
  function saveFechamento(e) { return Guard.run('os-fechar', () => _saveFechamento(e)); }
  async function _saveFechamento(e) {
    e.preventDefault();
    const osId   = qs('#fech-os-id').value;

    // base = manual se preenchido, senão calculado
    const calc   = Number(qs('#fech-calculado-num').value) || 0;
    const manual = Number(qs('#fech-manual').value)        || 0;
    const base   = manual > 0 ? manual : calc;

    // Resolve desconto absoluto (em R$) considerando o toggle valor/%
    const descVal  = Number(qs('#fech-desconto').value) || 0;
    const descTipo = qs('#fech-desconto-tipo').value || 'valor';
    const descontoAbs = descTipo === 'perc' ? (base * descVal / 100) : descVal;

    const liquido = Math.max(0, base - descontoAbs);
    const compMes = MonthPicker.value('fech-competencia');
    if (!compMes) { Toast.warning('Selecione a competência'); return; }
    const comp    = compMes + '-01';
    const venc    = qs('#fech-vencimento').value;
    const catId   = currentOS.categoria_id || '';
    const obs     = qs('#fech-obs').value;

    // Vincula todas as sessões da OS ao fechamento (registro em fechamento_dias).
    const diariaIds = allDiarias.filter(d => d.os_id === osId).map(d => d.id);

    if (liquido <= 0) { Toast.warning('Valor final precisa ser maior que zero'); return; }

    Loading.show();

    // Se a hora base foi alterada, persiste o novo valor de cada sessão recalculada
    // (mantém o detalhe da OS coerente com o valor fechado). Manuais não mudam.
    const horaBase = Number(qs('#fech-hora-base')?.value) || 0;
    if (horaBase > 0 && horaBase !== _calc.horaBaseOrig) {
      const ops = allDiarias
        .filter(d => d.os_id === osId && !(Number(d.valor_manual) > 0))
        .map(d => ({ action: 'update', sheet: 'diarias', id: d.id,
          data: { valor_calculado: Calculator.calcBlocos(Calculator.blocosFromDiaria(d), horaBase).valor } }));
      if (ops.length) await API.db.batch(ops);
    }

    const res = await API.db.fecharOS({
      os_id: osId, valor_bruto: base, desconto: descontoAbs, valor_liquido: liquido,
      data_competencia: comp, data_vencimento: venc, categoria_id: catId,
      diaria_ids: diariaIds, observacoes: obs,
    });
    Loading.hide();

    const dataFim = new Date().toISOString().substring(0, 10);
    const patch = {
      status: 'fechado',
      valor_fechamento: liquido,
      data_fim: dataFim,
      data_atualizacao: new Date().toISOString(),
    };

    // Atualiza localmente na hora — independe do retorno do fecharOS
    if (currentOS) {
      currentOS.status          = 'fechado';
      currentOS.valor_fechamento = liquido;
      currentOS.data_fim         = dataFim;
    }
    const idx = allOS.findIndex(o => o.id === osId);
    if (idx >= 0) {
      allOS[idx].status           = 'fechado';
      allOS[idx].valor_fechamento  = liquido;
      allOS[idx].data_fim          = dataFim;
    }

    if (res?.success) {
      // Redundância: força status=fechado via update direto
      await API.db.update('os', osId, patch);
      Toast.success('OS fechada!');
    } else {
      // fecharOS falhou (parcela não gerada), mas status muda de qualquer forma
      await API.db.update('os', osId, patch);
      Toast.warning('OS marcada como fechada, mas houve erro ao gerar parcela: ' + (res?.error || ''));
    }

    await loadData();
    openDetail(osId);
  }

  // ─── FECHAMENTO EM LOTE (várias OS do mesmo cliente → 1 parcela) ──
  function abrirFechamentoLote() {
    openFechamentoLote(Array.from(_loteSel));
  }

  async function openFechamentoLote(osIds) {
    const lista = (osIds || []).map(id => allOS.find(o => o.id === id)).filter(Boolean);
    if (lista.length < 2) { Toast.warning('Selecione ao menos 2 OS para o lote.'); return; }
    _loteCliente = lista[0].cliente_id;

    const cfg      = await Calculator.getConfig();
    const baseRate = Calculator.cfgNum(cfg, 'valor_hora_manutencao', 0) || Calculator.cfgNum(cfg, 'valor_hora', 0);

    _loteCalc = {};
    lista.forEach(os => {
      const r = _calcFromBaseFor(os, baseRate);
      _loteCalc[os.id] = { base: baseRate, baseOrig: baseRate, ...r };
    });
    currentView = 'fechamento';

    const section = qs('#page-os');
    section.innerHTML = `
      <div class="page-header" style="gap:8px">
        <button class="btn btn-outline btn-sm" onclick="OS.render()">← Voltar</button>
        <div style="flex:1;min-width:0">
          <h1 style="font-size:1.15rem">Fechamento em lote</h1>
          <div style="font-size:.8rem;color:var(--text-muted)">${lista.length} OS · ${App.clienteNome(_loteCliente)}</div>
        </div>
      </div>

      <form id="fechamento-lote-form" onsubmit="OS.saveFechamentoLote(event)" style="max-width:560px;margin:0 auto">

        ${lista.map(os => {
          const r = _loteCalc[os.id];
          const catNome = os.categoria_id ? App.categoriaNome(os.categoria_id) : '';
          return `
        <div class="card mb-3">
          <div class="card-body">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
              <strong style="min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${os.numero}${os.nome ? ' · ' + os.nome : ''}</strong>
              ${catNome ? `<span class="badge badge-info" style="flex:0 0 auto">${catNome}</span>` : ''}
            </div>
            <div class="info-row" style="margin-bottom:4px">
              <span>Mão de obra (${r.nSessoes} sessão(ões))</span>
              <strong id="lote-mo-${os.id}">${Fmt.currency(r.maoObra)}</strong>
            </div>
            ${r.totalItens > 0 ? `<div class="info-row" style="margin-bottom:4px"><span>Materiais / Itens</span><strong>${Fmt.currency(r.totalItens)}</strong></div>` : ''}
            <div class="info-row" style="border-top:1px solid var(--border);margin-top:8px;padding-top:8px">
              <span><strong>Subtotal</strong></span>
              <strong id="lote-sub-${os.id}" class="text-green">${Fmt.currency(r.calculado)}</strong>
            </div>
            ${r.nCalc > 0 ? `
            <div style="margin-top:10px">
              <button type="button" id="lote-base-btn-${os.id}" class="btn btn-outline btn-sm" style="font-size:.78rem"
                onclick="OS.toggleLoteHoraBase('${os.id}')">⚙️ Alterar hora base (R$ ${baseRate}/h)</button>
              <div id="lote-base-wrap-${os.id}" class="hidden" style="margin-top:8px">
                <div class="input-row">
                  <span style="align-self:center;color:var(--text-muted);font-weight:700">R$</span>
                  <input type="number" id="lote-base-${os.id}" class="input" step="1" min="0"
                    value="${baseRate}" oninput="OS.recalcLoteOS('${os.id}')">
                  <span style="align-self:center;color:var(--text-muted);font-size:.85rem">/h</span>
                </div>
                ${r.nManual > 0 ? `<small style="color:var(--text-muted);font-size:.72rem">${r.nManual} sessão(ões) com valor fixo não mudam.</small>` : ''}
              </div>
            </div>` : ''}
          </div>
        </div>`;
        }).join('')}

        <div class="card mb-3">
          <div class="card-body">
            <div class="info-row" style="margin-bottom:10px">
              <span><strong>Subtotal do lote (${lista.length} OS)</strong></span>
              <strong id="lote-total-display" class="text-green"></strong>
            </div>

            <!-- Desconto com toggle R$ / % — dividido proporcionalmente entre as OS -->
            <div class="form-group">
              <label>Desconto <small style="color:var(--text-muted);font-weight:400">— dividido entre as OS, proporcional ao valor</small></label>
              <div class="input-row">
                <input type="number" id="lote-desconto" class="input" step="0.01" min="0" value="0"
                  oninput="OS.atualizarFechamentoLote()">
                <select id="lote-desconto-tipo" class="input" style="flex:0 0 80px;text-align:center"
                  onchange="OS.toggleDescontoTipoLote()">
                  <option value="valor">R$</option>
                  <option value="perc">%</option>
                </select>
              </div>
            </div>

            <div id="lote-split" style="background:var(--bg);border-radius:12px;padding:10px 14px;margin-bottom:12px"></div>

            <div class="info-row total-row" style="background:var(--success-lt);border-radius:14px;padding:14px 16px;border:none;margin-bottom:4px">
              <span><strong>Valor final (1 parcela):</strong></span>
              <strong id="lote-final-display" style="font-size:1.4rem;color:var(--success)"></strong>
            </div>
            <small style="color:var(--text-muted);font-size:.72rem;display:block;margin-bottom:12px">
              A categoria de cada OS é mantida — nos relatórios e insights o valor é rateado entre elas.
            </small>

            <hr style="border:none;border-top:1px solid var(--border);margin:14px 0">

            <div class="form-row">
              <div class="form-group">
                <label>Competência</label>
                ${MonthPicker.render('lote-competencia', DateUtil.today().substring(0, 7))}
              </div>
              <div class="form-group">
                <label>Vencimento</label>
                <input type="date" id="lote-vencimento" class="input" value="${DateUtil.today()}" required>
              </div>
            </div>

            <div class="form-group">
              <label>Observações</label>
              <textarea id="lote-obs" class="input" rows="2"></textarea>
            </div>

            <div class="form-actions">
              <button type="submit" class="btn btn-primary btn-lg">Fechar ${lista.length} OS e gerar 1 parcela</button>
            </div>
          </div>
        </div>
      </form>
    `;
    atualizarFechamentoLote();
  }

  function toggleLoteHoraBase(osId) {
    qs('#lote-base-wrap-' + osId)?.classList.remove('hidden');
    qs('#lote-base-btn-' + osId)?.classList.add('hidden');
    const inp = qs('#lote-base-' + osId);
    if (inp) { inp.focus(); inp.select(); }
  }

  // oninput da hora base de UMA OS do lote — recalcula só ela e refaz os totais.
  function recalcLoteOS(osId) {
    const lc = _loteCalc[osId];
    if (!lc) return;
    const os   = allOS.find(o => o.id === osId);
    const base = Number(qs('#lote-base-' + osId)?.value) || 0;
    const r = _calcFromBaseFor(os, base);
    _loteCalc[osId] = { ...lc, ...r, base };
    if (qs('#lote-mo-' + osId))  qs('#lote-mo-' + osId).textContent  = Fmt.currency(r.maoObra);
    if (qs('#lote-sub-' + osId)) qs('#lote-sub-' + osId).textContent = Fmt.currency(r.calculado);
    atualizarFechamentoLote();
  }

  function toggleDescontoTipoLote() {
    const inp = qs('#lote-desconto');
    if (inp) inp.value = 0;
    atualizarFechamentoLote();
  }

  // Recalcula os totais do lote + preview do rateio por OS.
  function atualizarFechamentoLote() {
    const ids   = Object.keys(_loteCalc);
    const total = ids.reduce((s, id) => s + _loteCalc[id].calculado, 0);

    const descVal  = Number(qs('#lote-desconto')?.value) || 0;
    const descTipo = qs('#lote-desconto-tipo')?.value || 'valor';
    const descontoAbs = Math.min(descTipo === 'perc' ? (total * descVal / 100) : descVal, total);
    const final = Math.max(0, total - descontoAbs);
    const fator = total > 0 ? final / total : 0;

    if (qs('#lote-total-display')) qs('#lote-total-display').textContent = Fmt.currency(total);
    if (qs('#lote-final-display')) qs('#lote-final-display').textContent = Fmt.currency(final);

    const split = qs('#lote-split');
    if (split) {
      split.innerHTML = `
        <div style="font-size:.72rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">Cada OS fica com</div>
        ${ids.map(id => {
          const os = allOS.find(o => o.id === id);
          return `<div class="info-row" style="margin-bottom:2px">
            <span>${os?.numero || ''}</span>
            <strong>${Fmt.currency(Math.round(_loteCalc[id].calculado * fator * 100) / 100)}</strong>
          </div>`;
        }).join('')}
      `;
    }
  }

  // trava de duplo clique (Guard) — o corpo real está em _saveFechamentoLote
  function saveFechamentoLote(e) { return Guard.run('os-fechar-lote', () => _saveFechamentoLote(e)); }
  async function _saveFechamentoLote(e) {
    e.preventDefault();
    const ids = Object.keys(_loteCalc);
    if (ids.length < 2) return;

    const total = Math.round(ids.reduce((s, id) => s + _loteCalc[id].calculado, 0) * 100) / 100;
    const descVal  = Number(qs('#lote-desconto')?.value) || 0;
    const descTipo = qs('#lote-desconto-tipo')?.value || 'valor';
    const descontoAbs  = Math.min(descTipo === 'perc' ? Math.round(total * descVal) / 100 : descVal, total);
    const liquidoTotal = Math.round((total - descontoAbs) * 100) / 100;
    if (liquidoTotal <= 0) { Toast.warning('Valor final precisa ser maior que zero'); return; }

    const compMes = MonthPicker.value('lote-competencia');
    if (!compMes) { Toast.warning('Selecione a competência'); return; }
    const comp = compMes + '-01';
    const venc = qs('#lote-vencimento').value;
    const obs  = qs('#lote-obs').value;

    // Rateio proporcional do desconto: mesmo fator p/ todas; a última OS absorve
    // a diferença de centavos p/ Σ líquidos == valor da parcela (padrão do parcelado).
    const fator = total > 0 ? liquidoTotal / total : 0;
    let acumulado = 0;
    const itens = ids.map((id, i) => {
      const bruto = Math.round(_loteCalc[id].calculado * 100) / 100;
      let liq;
      if (i === ids.length - 1) liq = Math.round((liquidoTotal - acumulado) * 100) / 100;
      else { liq = Math.round(bruto * fator * 100) / 100; acumulado = Math.round((acumulado + liq) * 100) / 100; }
      return {
        os_id: id, valor_bruto: bruto, valor_liquido: liq,
        diaria_ids: allDiarias.filter(d => d.os_id === id).map(d => d.id),
      };
    });

    // Categoria predominante do lote (por valor) — fallback de exibição da parcela;
    // o rateio real por categoria é resolvido dinamicamente via fechamento_os.
    const porCat = {};
    itens.forEach(it => {
      const c = categoriaEfetivaId({ origem: 'os', origem_id: it.os_id }, allOS, allDiarias);
      if (c) porCat[c] = (porCat[c] || 0) + it.valor_liquido;
    });
    const catId = (Object.entries(porCat).sort((a, b) => b[1] - a[1])[0] || [''])[0];

    Loading.show();

    // Persiste as sessões recalculadas das OS cuja hora base mudou (manuais não mudam)
    const ops = [];
    ids.forEach(id => {
      const lc = _loteCalc[id];
      if (lc.base > 0 && lc.base !== lc.baseOrig) {
        allDiarias.filter(d => d.os_id === id && !(Number(d.valor_manual) > 0)).forEach(d => {
          ops.push({ action: 'update', sheet: 'diarias', id: d.id,
            data: { valor_calculado: Calculator.calcBlocos(Calculator.blocosFromDiaria(d), lc.base).valor } });
        });
      }
    });
    if (ops.length) await API.db.batch(ops);

    const res = await API.db.fecharOSLote({
      cliente_id: _loteCliente,
      itens,
      valor_bruto_total: total,
      desconto: descontoAbs,
      valor_liquido_total: liquidoTotal,
      data_competencia: comp,
      data_vencimento: venc,
      categoria_id: catId,
      observacoes: obs,
    });
    Loading.hide();

    if (res?.success) {
      const dataFim = new Date().toISOString().substring(0, 10);
      itens.forEach(it => {
        const idx = allOS.findIndex(o => o.id === it.os_id);
        if (idx >= 0) {
          allOS[idx].status = 'fechado';
          allOS[idx].valor_fechamento = it.valor_liquido;
          allOS[idx].data_fim = dataFim;
        }
      });
      Toast.success(`${itens.length} OS fechadas — 1 parcela de ${Fmt.currency(liquidoTotal)} gerada!`);
      _loteMode = false; _loteSel.clear(); _loteCliente = ''; _loteCalc = {};
      await loadData();
      renderList();
    } else {
      Toast.error('Erro ao fechar o lote: ' + (res?.error || ''));
    }
  }

  async function mudarStatus(novoStatus) {
    if (!currentOS || !novoStatus) return;
    Loading.show();
    const patch = {
      status: novoStatus,
      data_atualizacao: new Date().toISOString(),
    };
    if (novoStatus === 'fechado' && !currentOS.data_fim) {
      patch.data_fim = new Date().toISOString().substring(0, 10);
    }
    // Marca quando a OS ENTROU em acerto — base pra contar "há N dias pra cobrar".
    if (novoStatus === 'acerto' && currentOS.status !== 'acerto') {
      patch.data_acerto = DateUtil.today();
    }
    const res = await API.db.update('os', currentOS.id, patch);
    Loading.hide();
    if (res?.success) {
      currentOS.status = novoStatus;
      if (patch.data_fim)    currentOS.data_fim = patch.data_fim;
      if (patch.data_acerto) currentOS.data_acerto = patch.data_acerto;
      const idx = allOS.findIndex(o => o.id === currentOS.id);
      if (idx >= 0) { allOS[idx].status = novoStatus; if (patch.data_fim) allOS[idx].data_fim = patch.data_fim; if (patch.data_acerto) allOS[idx].data_acerto = patch.data_acerto; }
      Toast.success('Status atualizado.');
      openDetail(currentOS.id);
    } else {
      Toast.error('Erro ao atualizar status.');
    }
  }


  // trava de duplo clique (Guard) — o corpo real está em _confirmDelete
  function confirmDelete(id) { return Guard.run('os-excluir', () => _confirmDelete(id)); }
  async function _confirmDelete(id) {
    Modal.confirm('Excluir esta OS? Os itens serão devolvidos ao estoque.', async () => {
      Loading.show();
      const res = await API.db.excluirOS(id);
      Loading.hide();
      if (res?.success) {
        Toast.success('OS excluída');
        await loadData();
        renderList();
      } else Toast.error('Erro: ' + res?.error);
    });
  }

  // ─── ANÁLISE / INSIGHTS DA OS (menu ⋯) ──────────────────
  // Reúne tempo, mão de obra, materiais, recebimento e valor/hora desta OS, com
  // insights textuais (meio período, valor/hora vs base, multi-mês, a receber).
  async function openInsightsOS(id) {
    const o = allOS.find(x => x.id === id) || currentOS;
    if (!o) { Toast.warning('OS não encontrada'); return; }

    const sessoes = allDiarias.filter(d => d.os_id === id).sort((a, b) => a.data > b.data ? 1 : -1);
    const itens   = allItens.filter(i => i.os_id === id);

    // Parcelas geradas no fechamento desta OS (recebido vs a receber) —
    // direto (origem='os') ou via fechamento em lote (origem='os_lote'): a
    // parcela do lote cobre várias OS, então entra só a FATIA desta OS
    // (valor_liq dela ÷ total do lote, via fechamento_os).
    const [parcRes, fosRes] = await Promise.all([
      API.db.read('parcelas'),
      API.db.read('fechamento_os'),
    ]);
    const fosAll  = fosRes?.data || [];
    const shareDe = {};
    fosAll.filter(f => String(f.os_id) === String(id)).forEach(f => {
      const tot = fosAll.filter(x => x.fechamento_id === f.fechamento_id)
                        .reduce((s, x) => s + Number(x.valor_liq || 0), 0);
      shareDe[f.fechamento_id] = tot > 0 ? Number(f.valor_liq || 0) / tot : 0;
    });
    const parcelas = (parcRes?.data || [])
      .filter(p => (p.origem === 'os' && String(p.origem_id) === String(id)) ||
                   (p.origem === 'os_lote' && shareDe[p.origem_id] !== undefined))
      .map(p => p.origem === 'os_lote' ? { ...p, valor: Number(p.valor || 0) * shareDe[p.origem_id] } : p);

    const nSessoes = sessoes.length;
    const horas    = sessoes.reduce((s, d) => s + Number(d.horas_totais || 0), 0);
    const maoObra  = sessoes.reduce((s, d) => s + Number(d.valor_manual || d.valor_calculado || 0), 0);
    const matTotal = itens.reduce((s, i) => s + Number(i.valor_total || 0), 0);
    const totalOS  = Number(o.valor_fechamento || 0) || (maoObra + matTotal);
    const recebido = parcelas.filter(p => p.status === 'pago').reduce((s, p) => s + Number(p.valor || 0), 0);
    const aReceber = parcelas.filter(p => p.status !== 'pago').reduce((s, p) => s + Number(p.valor || 0), 0);
    const lucroServico = totalOS - matTotal; // ganho do serviço (material é repasse)

    // Distribuição por mês — sessões podem cair em meses diferentes; conta DIAS
    // distintos (não sessões) para o custo fixo e a média.
    const porMes = {};
    sessoes.forEach(d => {
      const mes = String(d.data || '').substring(0, 7);
      const dia = String(d.data || '').substring(0, 10);
      if (!mes) return;
      if (!porMes[mes]) porMes[mes] = { diasSet: new Set(), horas: 0, valor: 0 };
      porMes[mes].diasSet.add(dia);
      porMes[mes].horas += Number(d.horas_totais || 0);
      porMes[mes].valor += Number(d.valor_manual || d.valor_calculado || 0);
    });
    const meses = Object.keys(porMes).sort();
    const nDias = meses.reduce((s, m) => s + porMes[m].diasSet.size, 0);
    const mediaDia = nDias > 0 ? horas / nDias : 0;
    const valorHora = horas > 0 ? maoObra / horas : 0;

    const cfg = await Calculator.getConfig();
    const baseHora = Calculator.cfgNum(cfg, 'valor_hora_manutencao', 0) || Calculator.cfgNum(cfg, 'valor_hora', 0);

    // Custo fixo absorvido por esta OS: para cada mês das sessões, dias da OS ×
    // (custo fixo mensal ÷ dias úteis daquele mês). Lucro real = serviço − absorção.
    const custoFixoMensal = Calculator.custoFixoMensal(cfg);
    let custoFixoAbsorvido = 0;
    if (custoFixoMensal > 0) {
      meses.forEach(m => {
        const [y, mm] = m.split('-').map(Number);
        const ultimo = new Date(y, mm, 0).getDate();
        const diasUteis = DateUtil.businessDays(`${m}-01`, `${m}-${String(ultimo).padStart(2, '0')}`);
        const custoDia = diasUteis > 0 ? custoFixoMensal / diasUteis : 0;
        custoFixoAbsorvido += porMes[m].diasSet.size * custoDia;
      });
    }
    const temCusteio = custoFixoMensal > 0 && nDias > 0;
    const lucroReal = lucroServico - custoFixoAbsorvido;

    // Insights textuais
    const tips = [];
    if (nSessoes === 0) {
      tips.push({ icon: '📭', text: 'Nenhuma sessão registrada ainda. Registre os dias trabalhados para ver a análise.' });
    } else {
      // Lucro real (depois do custo fixo absorvido) — a resposta de "deu lucro?"
      if (temCusteio) {
        if (lucroReal >= 0)
          tips.push({ icon: '🟢', text: `Lucro real de <strong>${Fmt.currency(lucroReal)}</strong> — sobrou depois de absorver ${Fmt.currency(custoFixoAbsorvido)} de custo fixo pelos ${nDias} dia(s) que a OS ocupou.` });
        else
          tips.push({ icon: '🔴', text: `No vermelho: depois do custo fixo (${Fmt.currency(custoFixoAbsorvido)} por ${nDias} dia(s)), esta OS fica em <strong>${Fmt.currency(lucroReal)}</strong>. O serviço não cobriu os dias que ocupou — vale reajustar ou concentrar o trabalho.` });
      }
      if (mediaDia > 0 && mediaDia < 4 && nDias >= 3)
        tips.push({ icon: '🌗', text: `Média de ${Fmt.hours(mediaDia)} por dia em ${nDias} dias — muitos dias de meio período, o que dilui o valor por dia (e cada dia carrega custo fixo cheio). Concentrar horas rende mais.` });
      else if (mediaDia >= 8)
        tips.push({ icon: '💪', text: `Dias cheios: média de ${Fmt.hours(mediaDia)} por dia trabalhado.` });
      if (baseHora > 0 && valorHora > 0) {
        if (valorHora >= baseHora) tips.push({ icon: '⚡', text: `Cada hora rendeu ${Fmt.currency(valorHora)} — acima da sua base (${Fmt.currency(baseHora)}/h). 👏` });
        else tips.push({ icon: '📉', text: `Cada hora rendeu ${Fmt.currency(valorHora)} — abaixo da base (${Fmt.currency(baseHora)}/h). Um reajuste nas próximas sessões compensa.` });
      }
      if (matTotal > 0 && matTotal > maoObra)
        tips.push({ icon: '📦', text: `Materiais (${Fmt.currency(matTotal)}) superam a mão de obra (${Fmt.currency(maoObra)}). Confira se a margem do material está coberta.` });
      if (meses.length > 1)
        tips.push({ icon: '📆', text: `Trabalho distribuído em ${meses.length} meses. As horas entram no mês de cada sessão — o recebimento, no mês do fechamento.` });
      if (aReceber > 0)
        tips.push({ icon: '📥', text: `${Fmt.currency(aReceber)} ainda a receber desta OS.` });
      else if (recebido > 0)
        tips.push({ icon: '✅', text: `Tudo recebido: ${Fmt.currency(recebido)}.` });
    }

    const stat = (label, val, cls = 'stat-navy', sub = '') => `
      <div class="stat-card ${cls}">
        <div class="stat-label">${label}</div>
        <div class="stat-value" style="font-size:1rem">${val}</div>
        ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
      </div>`;
    const NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const mesLabel = (m) => { const [y, mm] = m.split('-'); return `${NOMES_MES[Number(mm) - 1] || mm}/${y.slice(2)}`; };

    qs('#os-insights-title').textContent = `📊 ${o.numero || 'OS'} · Análise`;
    qs('#os-insights-body').innerHTML = `
      <div class="stats-grid">
        ${stat('⏱ Tempo', Fmt.hours(horas), 'stat-blue', `${nDias} dia(s) · ${Fmt.hours(mediaDia)}/dia`)}
        ${stat('⚡ Valor/hora', Fmt.currency(valorHora), (baseHora > 0 && valorHora >= baseHora) ? 'stat-green' : 'stat-orange', baseHora > 0 ? `base ${Fmt.currency(baseHora)}` : '')}
        ${stat('🛠 Mão de obra', Fmt.currency(maoObra), 'stat-navy')}
        ${stat('📦 Materiais', Fmt.currency(matTotal), 'stat-navy')}
      </div>
      <div class="stats-grid mt-3">
        ${stat('💰 Total da OS', Fmt.currency(totalOS), 'stat-green')}
        ${stat('🧾 Result. serviço', Fmt.currency(lucroServico), 'stat-blue', 'sem materiais')}
      </div>
      ${temCusteio ? `
        <div class="stats-grid mt-3">
          ${stat('🏢 Custo fixo', Fmt.currency(custoFixoAbsorvido), 'stat-navy', `${nDias} dia(s) absorvido(s)`)}
          ${stat('🎯 Lucro real', Fmt.currency(lucroReal), lucroReal >= 0 ? 'stat-green' : 'stat-red', 'após custo fixo')}
        </div>` : ''}
      ${parcelas.length ? `
        <div class="stats-grid mt-3">
          ${stat('✅ Recebido', Fmt.currency(recebido), 'stat-green')}
          ${stat('📥 A receber', Fmt.currency(aReceber), aReceber > 0 ? 'stat-red' : 'stat-navy')}
        </div>` : ''}

      ${meses.length > 1 ? `
        <div class="ins-os-title">Distribuição por mês</div>
        <div class="entity-list" style="border-radius:12px">
          ${meses.map(m => `
            <div class="entity-item" style="cursor:default">
              <div class="entity-info">
                <div class="entity-name" style="text-transform:capitalize">${mesLabel(m)}</div>
                <div class="entity-sub">${porMes[m].diasSet.size} dia(s) · ${Fmt.hours(porMes[m].horas)}</div>
              </div>
              <div class="entity-right"><span class="entity-value">${Fmt.currency(porMes[m].valor)}</span></div>
            </div>`).join('')}
        </div>` : ''}

      ${tips.length ? `
        <div class="ins-os-title">💡 Insights</div>
        ${tips.map(t => `
          <div class="tip-card tip-info">
            <span class="tip-icon">${t.icon}</span>
            <div class="tip-body"><div class="tip-text">${t.text}</div></div>
          </div>`).join('')}
      ` : ''}
    `;
    Modal.open('modal-os-insights');
  }

  return {
    render, renderList, applyFilters, setStatus, setRegistroView, tapCard, _maisOpcoes, openDetail, abrirParcela, openForm, onTipoOSChange, saveForm,
    openInsightsOS,
    openDiaria, registrarDiaEm, iniciarSessaoAgora, sessaoMenu, pausarSessao, retomarSessao, encerrarSessao, calcDiariaPreview, saveDiaria, deleteDiaria, tapDiaria, toggleMaisOpcoes,
    renderBlocos, addBloco, removeBloco, setBloco, toggleBlocoReajuste, toggleBlocoFator,
    openItemForm, onItemTipoChange, saveItem, deleteItem, filtrarItemEstoque, escolherItemEstoque,
    openOrcItemForm, onOrcItemTipoChange, saveOrcItem, deleteOrcItem, gerarOSdeOrcamento,
    addGrupoServico, parseGrupo, encodeGrupo,
    openFaltouMaterial, saveFaltouMaterial,
    // Calculadora no detalhe + Fechamento simplificado
    renderCalculadora, calcDiariaUpdate, calcNormalUpdate, toggleCalc, salvarCalculo,
    openFechamento, atualizarFechamento, recalcBaseFechamento, toggleHoraBase, toggleDescontoTipo, saveFechamento, mudarStatus,
    // Fechamento em lote
    toggleLoteMode, toggleLoteSel, abrirFechamentoLote, openFechamentoLote,
    toggleLoteHoraBase, recalcLoteOS, toggleDescontoTipoLote, atualizarFechamentoLote, saveFechamentoLote,
    confirmDelete,
    // Helpers expostos (usados pela home)
    osTipo, osTipoBadge, acharSessaoAberta, blocoAberto, blocosAoEncerrar, _parcelasDaOS,
  };
})();
