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

  // Resultado mais recente da calculadora do detalhe — usado pelo modal
  // de fechamento. Atualizado a cada interação na calculadora.
  let _calc = {
    bruto:    0,   // soma sem desconto (calc normal: subtotal; diária: dias+itens)
    liquido:  0,   // valor sugerido (calc normal: já com desconto/simples; diária: igual ao bruto)
    horas:    0,   // só p/ exibir no fechamento
    detalhe:  '',  // texto curto descrevendo o cálculo
  };
  let _calcExpanded = false;  // true = calculadora aberta; false = resumo/botão

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

  // ─── LISTA ─────────────────────────────────────────────
  function renderList(filtroStatus = '', filtroTipo = '', q = '') {
    currentView = 'list';
    let items = allOS;
    if (filtroStatus) items = items.filter(o => o.status === filtroStatus);
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

    const section = qs('#page-os');
    section.innerHTML = `
      <div class="section-tabs">
        <button class="section-tab active" onclick="App.navigate('os')">📋 Ordens</button>
        <button class="section-tab" onclick="App.navigate('estoque')">📦 Estoque</button>
        <button class="section-tab" onclick="OS.openListaCompras()">🛒 Lista Compras</button>
      </div>

      <div class="page-header">
        <h1>Ordens de Serviço</h1>
        <button class="btn btn-primary" onclick="OS.openForm()">+ Nova OS</button>
      </div>

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
      <div class="entity-list">
        ${items.length === 0
          ? '<div class="entity-empty">Nenhuma OS encontrada</div>'
          : items.map(o => {
            const catNome = o.categoria_id ? App.categoriaNome(o.categoria_id) : '';
            return `
            <div class="entity-item" onclick="OS.tapCard('${o.id}')">
              <div class="avatar ${statusAv(o.status)}">
                <span style="font-size:.75rem;font-weight:800">${o.numero?.replace('OS-','')}</span>
              </div>
              <div class="entity-info">
                <div class="entity-name">${App.clienteNome(o.cliente_id)}${o.nome ? ` <span style="font-weight:500;color:var(--text-muted);font-size:.85em">· ${o.nome}</span>` : ''}</div>
                <div class="entity-sub">${Fmt.date(o.data_inicio)}${o.data_fim ? ' → ' + Fmt.date(o.data_fim) : ''}</div>
                <div class="entity-badges">${tipoBadge(o.tipo)} ${statusBadge(o.status)}${catNome ? ` <span class="badge badge-info">${catNome}</span>` : ''}</div>
              </div>
              <div class="entity-right">
                <span class="entity-chevron">›</span>
              </div>
            </div>
          `;
          }).join('')}
      </div>
    `;
  }

  function applyFilters() {
    const q  = qs('#os-search')?.value || '';
    renderList(_currentStatus, '', q);
  }

  let _currentStatus = '';
  function setStatus(s) {
    _currentStatus = s;
    applyFilters();
  }

  function _maisOpcoes(id) {
    const o = allOS.find(x => x.id === id) || currentOS;
    const actions = [
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
    const diarias = allDiarias.filter(d => d.os_id === id)
                               .sort((a, b) => a.data > b.data ? -1 : 1); // mais recente primeiro
    const itens   = allItens.filter(i => i.os_id === id);
    const section = qs('#page-os');
    const cliente = App.clienteNome(currentOS.cliente_id);

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
        <div style="display:flex;gap:10px;margin-bottom:16px">
          <button class="btn btn-primary" style="flex:1;font-size:1rem;padding:13px 8px;border-radius:12px" onclick="OS.openDiaria()">
            ${currentOS.tipo === 'diaria' ? '＋ Registrar Dia' : '⏱ Registrar Sessão'}
          </button>
          <button class="btn btn-gold" style="flex:1;font-size:1rem;padding:13px 8px" onclick="OS.openFechamento()">
            ✓ Fechar OS
          </button>
        </div>
      ` : `
        <div style="text-align:center;margin-bottom:16px">${statusBadge('fechado')}</div>
      `}

      <!-- Info resumida -->
      <div class="card mb-3">
        <div class="card-body" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><div class="info-label">Tipo</div>${tipoBadge(currentOS.tipo)}</div>
          <div><div class="info-label">Início</div><strong>${Fmt.date(currentOS.data_inicio)}</strong></div>
          ${currentOS.data_fim ? `<div><div class="info-label">Fim</div><strong>${Fmt.date(currentOS.data_fim)}</strong></div>` : ''}
          <!-- Status (alterar via menu ⋯ no topo) -->
          <div style="grid-column:1/-1">
            <div class="info-label">Status</div>
            ${statusBadge(currentOS.status)}
          </div>
          ${currentOS.valor_fechamento ? `<div style="grid-column:1/-1"><div class="info-label">Valor Fechado</div><strong class="text-green" style="font-size:1.2rem">${Fmt.currency(currentOS.valor_fechamento)}</strong></div>` : ''}
          ${currentOS.observacoes ? `<div style="grid-column:1/-1"><div class="info-label">Observações</div><span style="color:var(--text-muted)">${currentOS.observacoes}</span></div>` : ''}
        </div>
      </div>

      <!-- Calculadora de valor — colapsada por padrão; expande sob demanda -->
      ${currentOS.status !== 'fechado' ? `
        <div class="card mb-3" id="os-calc-card">
          <!-- preenchido por renderCalculadora() — 3 estados: botão, aberta, ou resumo -->
        </div>
      ` : ''}

      <!-- Itens -->
      <div class="card mb-3">
        <div class="card-header">
          <h3>Materiais / Itens</h3>
          ${currentOS.status !== 'fechado' ? `<button class="btn btn-sm btn-primary" onclick="OS.openItemForm()">+ Item</button>` : ''}
        </div>
        <div id="os-itens-list">${renderItens(itens)}</div>
      </div>

      <!-- Sessões de trabalho (diária: "Dias Trabalhados"; normal: "Sessões de Trabalho") -->
      <div class="card mb-3">
        <div class="card-header">
          <h3>${currentOS.tipo === 'diaria' ? 'Dias Trabalhados' : 'Sessões de Trabalho'}</h3>
          <span class="badge badge-info">${diarias.length} ${currentOS.tipo === 'diaria' ? 'dia(s)' : 'sessão(ões)'}</span>
        </div>
        <div class="entity-list" style="border-radius:0;border:none;box-shadow:none">
          ${diarias.length === 0
            ? `<div class="entity-empty">${currentOS.tipo === 'diaria' ? 'Nenhum dia registrado ainda' : 'Nenhuma sessão registrada ainda'}</div>`
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
                <strong>Total (${diarias.length} ${currentOS.tipo === 'diaria' ? 'dias' : 'sessões'})</strong>
                ${currentOS.tipo !== 'diaria' ? `<div style="font-size:.78rem;color:var(--text-muted)">${Fmt.hours(diarias.reduce((s,d)=>s+Number(d.horas_totais||0),0))} registradas</div>` : ''}
              </div>
              <div class="entity-right">
                <span class="entity-value">${Fmt.currency(diarias.reduce((s,d)=>s+Number(d.valor_manual||d.valor_calculado||0),0))}</span>
              </div>
            </div>` : ''}
        </div>
      </div>
    `;

    // Renderiza a calculadora de valor (se a OS ainda não foi fechada)
    if (currentOS.status !== 'fechado') {
      await renderCalculadora(diarias, itens);
    }
  }

  // ─── CALCULADORA DE VALOR (no detalhe) ──────────────────
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

    const totalItens  = Number(qs('#calc-itens-total')?.value) || 0;
    const simplesPerc = Number(qs('#calc-simples')?.value)     || 0;

    const subtotal     = maoObra + matTotal + vChamada + totalItens;
    const valorSimples = subtotal * (simplesPerc / 100);
    const calculado    = Math.round((subtotal + valorSimples) * 100) / 100;

    _calc = {
      bruto:   calculado,
      liquido: calculado,
      horas:   horasSess,
      detalhe: `${sessoes.length} sessão(ões) · ${Fmt.hours(horasSess)}`,
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

  // ─── FORM OS ────────────────────────────────────────────
  async function openForm(id = null) {
    let os = null;
    if (id) {
      os = allOS.find(o => o.id === id) || (await API.db.read('os', id))?.data?.[0];
    }
    const numero = os ? os.numero : await nextOSNumber();
    const section = qs('#page-os');
    section.innerHTML = `
      <div class="page-header">
        <button class="btn btn-outline" onclick="${id ? `OS.openDetail('${id}')` : 'OS.render()'}">← Voltar</button>
        <h1>${os ? 'Editar OS' : 'Nova OS'}</h1>
      </div>
      <div class="card">
        <div class="card-body">
          <form id="os-form" onsubmit="OS.saveForm(event, '${id || ''}')">
            <div class="form-row">
              <div class="form-group">
                <label>Número</label>
                <input type="text" name="numero" class="input" value="${numero}" required>
              </div>
              <div class="form-group">
                <label>Tipo *</label>
                <select name="tipo" class="input" required onchange="OS.toggleTipo(this.value)">
                  <option value="normal" ${(!os||os.tipo==='normal')?'selected':''}>Normal</option>
                  <option value="diaria" ${os?.tipo==='diaria'?'selected':''}>Diária</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label>Nome da OS <small style="color:var(--text-muted);font-weight:400">(opcional)</small></label>
              <input type="text" name="nome" class="input" value="${os?.nome || ''}" placeholder="Ex: Reforma do galpão, Cerca leste...">
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
            <div id="datas-normais" class="${os?.tipo==='diaria'?'hidden':''}">
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
            <div class="form-group">
              <label>Observações</label>
              <textarea name="observacoes" class="input" rows="3">${os?.observacoes || ''}</textarea>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary">Salvar OS</button>
              <button type="button" class="btn btn-outline" onclick="${id ? `OS.openDetail('${id}')` : 'OS.render()'}">Cancelar</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  function toggleTipo(val) {
    qs('#datas-normais')?.classList.toggle('hidden', val === 'diaria');
  }

  async function saveForm(e, id = '') {
    e.preventDefault();
    const form = e.target;
    const fd   = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    data.data_atualizacao = new Date().toISOString();

    Loading.show();
    let res;
    if (id) {
      res = await API.db.update('os', id, data);
    } else {
      data.data_criacao = new Date().toISOString();
      res = await API.db.create('os', data);
    }
    Loading.hide();

    if (res?.success) {
      Toast.success(id ? 'OS atualizada!' : 'OS criada!');
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
  async function registrarDiaEm(osId) {
    if (!osId) return;
    // Sincroniza o hash para 'os' ANTES de navegar (via replaceState, que NÃO
    // dispara hashchange). Assim o navigate('os') não muda o hash e o listener
    // de "voltar" (hashchange) não fecha o modal recém-aberto. Ver app.js ~149.
    if ((location.hash || '').replace(/^#/, '') !== 'os') {
      history.replaceState(null, '', '#os');
    }
    await App.navigate('os');   // hash já é 'os' → sem novo hashchange
    await openDetail(osId);     // seta currentOS + renderiza o detalhe
    await openDiaria();         // abre o modal usando currentOS
  }

  async function openDiaria(diariaId = null) {
    if (!currentOS) return;
    let d = null;
    if (diariaId) d = allDiarias.find(x => x.id === diariaId);
    // Título dinâmico: "Registrar Dia" para diária, "Registrar Sessão" para normal
    const isNormal = currentOS.tipo !== 'diaria';
    const titleEl  = qs('#modal-diaria-title');
    if (titleEl) titleEl.textContent = diariaId
      ? (isNormal ? 'Editar Sessão' : 'Editar Dia')
      : (isNormal ? 'Registrar Sessão' : 'Registrar Dia');
    const saveBtn = qs('#modal-diaria-save-btn');
    if (saveBtn) saveBtn.textContent = isNormal ? 'Salvar Sessão' : 'Salvar Dia';
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

    // Carrega os blocos do registro (novos: blocos_json; antigos: manhã/tarde + reajuste)
    if (d) {
      _blocos = Calculator.blocosFromDiaria(d).map(b => ({
        inicio: b.inicio || '', fim: b.fim || '',
        reajuste: !!b.reajuste, fatores: b.fatores || [],
        avulso: !!b.avulso, horas: b.horas || 0,
      }));
    } else {
      _blocos = [];
    }
    // Sempre começa com pelo menos 1 período em branco para preencher
    if (_blocos.length === 0) _blocos = [{ inicio: '', fim: '', reajuste: false, fatores: [] }];

    const baseRate = Calculator.cfgNum(cfg, 'valor_hora_manutencao', 0) || Calculator.cfgNum(cfg, 'valor_hora', 0);
    qs('#modal-diaria-info').innerHTML =
      `<span style="font-size:.75rem;color:var(--text-muted)">Valor hora base: ${Fmt.currency(baseRate)}/h</span>`;

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
          <span class="bloco-num">${b.reajuste ? '⚡' : '🕐'} Período ${i + 1}${dur > 0 ? ` <small>· ${Fmt.hours(dur)}</small>` : ''}</span>
          <button type="button" class="bloco-del" title="Remover período" onclick="OS.removeBloco(${i})">🗑</button>
        </div>
        <div class="bloco-times">
          <input type="time" class="input" value="${b.inicio || ''}"
            oninput="OS.setBloco(${i},'inicio',this.value)" onchange="OS.calcDiariaPreview()" aria-label="Início">
          <span class="bloco-sep">→</span>
          <input type="time" class="input" value="${b.fim || ''}"
            oninput="OS.setBloco(${i},'fim',this.value)" onchange="OS.calcDiariaPreview()" aria-label="Fim">
        </div>
        <label class="checkbox-item bloco-reaj-check">
          <input type="checkbox" ${b.reajuste ? 'checked' : ''} onchange="OS.toggleBlocoReajuste(${i})">
          <span>Reajuste / fatores de risco${b.reajuste && fatoresAtivos > 0 ? ` <small class="bloco-pct">+${fatoresAtivos}%</small>` : ''}</span>
        </label>
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

    // Breakdown normal × reajuste (só quando há reajuste e não é valor fixo)
    const breakdown = qs('#modal-diaria-breakdown');
    if (breakdown) {
      if (bk.hReajuste > 0 && !manual) {
        breakdown.style.display = '';
        breakdown.innerHTML = `${Fmt.hours(bk.hNormal)} normal (${Fmt.currency(bk.valorNormal)}) + <span style="color:var(--gold-dk);font-weight:700">⚡ ${Fmt.hours(bk.hReajuste)} reajuste (${Fmt.currency(bk.valorReajuste)})</span>`;
      } else {
        breakdown.style.display = 'none';
      }
    }
  }

  async function saveDiaria() {
    const osId   = qs('#modal-diaria-os-id').value;
    const id     = qs('#modal-diaria-id').value;
    const manual = qs('#modal-diaria-manual').value;

    // Mantém só períodos com horas válidas (>0)
    const blocosValidos = _blocos.filter(b => {
      const h = b.avulso ? Number(b.horas || 0)
                         : ((b.inicio && b.fim) ? DateUtil.diffHours(b.inicio, b.fim) : 0);
      return h > 0;
    });

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
      Toast.success(currentOS?.tipo === 'diaria' ? 'Dia registrado!' : 'Sessão registrada!');
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

  async function deleteDiaria(id) {
    const msg = currentOS?.tipo !== 'diaria' ? 'Excluir esta sessão?' : 'Excluir este dia?';
    Modal.confirm(msg, async () => {
      await API.db.delete('diarias', id);
      Toast.success('Dia excluído');
      await loadData();
      openDetail(currentOS.id);
    });
  }

  function tapDiaria(id) {
    const titulo = currentOS?.tipo !== 'diaria' ? 'Sessão registrada' : 'Dia registrado';
    ActionSheet.open(titulo, [
      { icon: '✏️', label: 'Editar', fn: () => openDiaria(id) },
      { icon: '🗑', label: 'Excluir', fn: () => deleteDiaria(id), danger: true },
    ]);
  }

  // ─── ITENS ──────────────────────────────────────────────
  async function openItemForm(itemId = null) {
    if (!currentOS) return;
    const item   = itemId ? allItens.find(i => i.id === itemId) : null;
    const estRes = await API.db.read('estoque');
    const estoque = (estRes?.data || []).filter(e => e.ativo !== false && e.ativo !== 'false');

    qs('#modal-item-id').value    = itemId || '';
    qs('#modal-item-os-id').value = currentOS.id;
    qs('#modal-item-tipo').value  = item?.tipo || 'material';
    qs('#modal-item-desc').value  = item?.descricao || '';
    qs('#modal-item-qtd').value   = item?.quantidade || '1';
    qs('#modal-item-unit').value  = item?.valor_unit || '';
    qs('#modal-item-total').value = item?.valor_total || '';
    if (qs('#modal-item-quempagou')) qs('#modal-item-quempagou').value = '';
    qs('#modal-item-estoque').innerHTML =
      '<option value="">— Selecione do estoque (opcional) —</option>' +
      estoque.map(e => `<option value="${e.id}" data-unit="${e.valor_unit}" ${e.id === item?.estoque_id ? 'selected' : ''}>${e.descricao} (Qtd: ${e.quantidade})</option>`).join('');
    onItemTipoChange(); // sincroniza visibilidade do campo quem pagou
    Modal.open('modal-item');
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

  async function saveItem() {
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
      // Novo item com estoque: descontar
      const estRes = await API.db.read('estoque', estId);
      const est = estRes?.data?.[0];
      if (est) {
        finalDesc = est.descricao;
        await API.db.update('estoque', estId, { quantidade: Math.max(0, Number(est.quantidade || 0) - qtd) });
      }
    } else if (itemId) {
      // Edição: ajustar estoque pela diferença de quantidade
      const original = allItens.find(i => i.id === itemId);
      if (original?.estoque_id) {
        const estRes = await API.db.read('estoque', original.estoque_id);
        const est = estRes?.data?.[0];
        if (est) {
          const diff = Number(original.quantidade || 0) - qtd; // positive = return stock
          await API.db.update('estoque', original.estoque_id, { quantidade: Math.max(0, Number(est.quantidade || 0) + diff) });
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

    // Se material pago por colaborador: gerar fiado de reembolso
    if (res?.success && !itemId && quemPagou && total > 0) {
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
      Modal.close('modal-item');
      await loadData();
      openDetail(osId);
    } else {
      Toast.error('Erro: ' + (res?.error || ''));
    }
  }

  async function deleteItem(id) {
    Modal.confirm('Remover este item?', async () => {
      const item = allItens.find(i => i.id === id);
      // Devolver ao estoque se for material
      if (item?.estoque_id && item.tipo === 'material') {
        const estRes = await API.db.read('estoque', item.estoque_id);
        const est = estRes?.data?.[0];
        if (est) await API.db.update('estoque', item.estoque_id, { quantidade: Number(est.quantidade||0) + Number(item.quantidade||0) });
      }
      await API.db.delete('os_itens', id);
      Toast.success('Item removido');
      await loadData();
      openDetail(currentOS.id);
    });
  }

  // ─── FECHAMENTO ──────────────────────────────────────────────
  function openFechamento() {
    if (!currentOS) return;

    const isDiaria   = currentOS.tipo === 'diaria';
    const diarias    = allDiarias.filter(d => d.os_id === currentOS.id);
    const itens      = allItens.filter(i => i.os_id === currentOS.id);
    const totalDias  = diarias.reduce((s, d) => s + Number(d.valor_manual || d.valor_calculado || 0), 0);
    const totalItens = itens.reduce((s, i) => s + Number(i.valor_total || 0), 0);

    // Para diária: sempre recalcula direto das diárias + itens (independe de _calc)
    if (isDiaria) {
      const base = totalDias + totalItens;
      _calc.liquido = base;
      _calc.bruto   = base;
    } else if (_calc.liquido <= 0) {
      _calc.liquido = Number(currentOS.valor_calculado || 0);
      _calc.bruto   = _calc.liquido;
    }

    const calc = _calc.liquido;

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
            <!-- hidden sempre presente — base para atualizarFechamento e saveFechamento -->
            <input type="hidden" id="fech-calculado-num" value="${calc.toFixed(2)}">

            ${isDiaria ? `
            <div style="background:var(--bg);border-radius:12px;padding:12px 14px;margin-bottom:16px">
              <div style="font-size:.72rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">Composição do valor</div>
              <div class="info-row" style="margin-bottom:4px">
                <span>Diárias (${diarias.length} dia${diarias.length !== 1 ? 's' : ''})</span>
                <strong>${Fmt.currency(totalDias)}</strong>
              </div>
              ${totalItens > 0 ? `
              <div class="info-row" style="margin-bottom:4px">
                <span>Materiais / Itens</span>
                <strong>${Fmt.currency(totalItens)}</strong>
              </div>` : ''}
              <div class="info-row" style="border-top:1px solid var(--border);margin-top:8px;padding-top:8px">
                <span><strong>Subtotal</strong></span>
                <strong class="text-green">${Fmt.currency(calc)}</strong>
              </div>
            </div>
            ` : `
            <!-- OS normal: valor calculado -->
            <div class="form-group">
              <label>Valor calculado</label>
              <input type="text" class="input" value="${Fmt.currency(calc)}"
                readonly style="background:var(--bg);font-weight:700;color:var(--text-muted)">
              <small style="color:var(--text-muted);font-size:.72rem">Vem da calculadora — se quiser sobrescrever, preencha "valor manual" abaixo.</small>
            </div>
            `}

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
                <input type="month" id="fech-competencia" class="input"
                  value="${DateUtil.today().substring(0,7)}" required>
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

  // Recalcula valor final a partir de: (manual || calculado) - desconto
  function atualizarFechamento() {
    const calc   = Number(qs('#fech-calculado-num')?.value) || 0;
    const manual = Number(qs('#fech-manual')?.value)        || 0;
    const base   = manual > 0 ? manual : calc;

    const descVal  = Number(qs('#fech-desconto')?.value) || 0;
    const descTipo = qs('#fech-desconto-tipo')?.value || 'valor';
    const descontoAbs = descTipo === 'perc' ? (base * descVal / 100) : descVal;
    const final = Math.max(0, base - descontoAbs);

    if (qs('#fech-final'))         qs('#fech-final').value = final.toFixed(2);
    if (qs('#fech-final-display')) qs('#fech-final-display').textContent = Fmt.currency(final);
  }

  async function saveFechamento(e) {
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
    const comp    = qs('#fech-competencia').value + '-01';
    const venc    = qs('#fech-vencimento').value;
    const catId   = currentOS.categoria_id || '';
    const obs     = qs('#fech-obs').value;

    // Para diárias: pega os dias que estão marcados na CALCULADORA do detalhe
    // (não mais aqui no fechamento — ela já passou)
    const diariaIds = currentOS.tipo === 'diaria'
      ? allDiarias.filter(d => d.os_id === osId).map(d => d.id)
      : [];

    if (liquido <= 0) { Toast.warning('Valor final precisa ser maior que zero'); return; }

    Loading.show();
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
    const res = await API.db.update('os', currentOS.id, patch);
    Loading.hide();
    if (res?.success) {
      currentOS.status = novoStatus;
      if (patch.data_fim) currentOS.data_fim = patch.data_fim;
      const idx = allOS.findIndex(o => o.id === currentOS.id);
      if (idx >= 0) { allOS[idx].status = novoStatus; if (patch.data_fim) allOS[idx].data_fim = patch.data_fim; }
      Toast.success('Status atualizado.');
      openDetail(currentOS.id);
    } else {
      Toast.error('Erro ao atualizar status.');
    }
  }

  // ─── LISTA DE COMPRAS ───────────────────────────────────
  // Estado local para o modal "Nova Lista": cliente fixo + itens acumulados
  let _novaLista = { cliente_id: '', itens: [] };
  // Cache da lista pra evitar refetch quando só toggleamos checkbox
  let _listaCache = { lista: [], estoque: [] };

  async function openListaCompras() {
    Loading.show();
    const [lcRes, estRes] = await Promise.all([
      API.db.read('lista_compras'),
      API.db.read('estoque'),
    ]);
    Loading.hide();
    _listaCache = {
      lista:   lcRes?.data || [],
      estoque: (estRes?.data || []).filter(e => e.ativo !== false && e.ativo !== 'false'),
    };
    renderListaCompras();
  }

  function renderListaCompras() {
    const { lista, estoque } = _listaCache;
    const section = qs('#page-os');

    // Agrupar por cliente_id (mantém pendentes E comprados juntos)
    const grupos = {};
    lista.forEach(l => {
      const k = l.cliente_id || '_sem';
      if (!grupos[k]) grupos[k] = [];
      grupos[k].push(l);
    });
    // Ordena cada grupo: pendentes primeiro, depois por data
    Object.keys(grupos).forEach(k => {
      grupos[k].sort((a, b) => {
        const aP = (a.status || 'pendente') === 'pendente' ? 0 : 1;
        const bP = (b.status || 'pendente') === 'pendente' ? 0 : 1;
        if (aP !== bP) return aP - bP;
        return String(a.data_criacao || '').localeCompare(String(b.data_criacao || ''));
      });
    });

    const grupoIds = Object.keys(grupos).sort((a, b) =>
      App.clienteNome(a).localeCompare(App.clienteNome(b))
    );

    section.innerHTML = `
      <div class="section-tabs">
        <button class="section-tab" onclick="OS.render()">📋 Ordens</button>
        <button class="section-tab" onclick="App.navigate('estoque')">📦 Estoque</button>
        <button class="section-tab active" onclick="OS.openListaCompras()">🛒 Lista Compras</button>
      </div>

      <div class="page-header">
        <h1>Lista de Compras</h1>
        <button class="btn btn-primary" onclick="OS.openNovaListaForm()">+ Nova Lista</button>
      </div>

      ${grupoIds.length === 0 ? `
        <div class="card mt-3"><div class="card-body">
          <p class="text-muted" style="text-align:center;margin:0">Nenhum item na lista. Toque em <strong>+ Nova Lista</strong> para começar.</p>
        </div></div>
      ` : grupoIds.map(cid => {
        const itens = grupos[cid];
        const pend  = itens.filter(i => (i.status || 'pendente') === 'pendente').length;
        const total = itens.length;
        return `
          <div class="card mt-3">
            <div class="card-header">
              <h3>${App.clienteNome(cid)}</h3>
              <div style="display:flex;gap:6px;align-items:center">
                <span class="badge ${pend > 0 ? 'badge-warning' : 'badge-success'}">${pend > 0 ? `${pend} pend.` : '✓ tudo comprado'}</span>
                <button class="btn btn-sm btn-outline" onclick="OS.addItensCliente('${cid}')">+ Item</button>
              </div>
            </div>
            <div class="card-body" style="padding:6px 8px">
              ${itens.map(i => {
                const comprado = (i.status || 'pendente') === 'comprado';
                const noEst = estoque.find(e => (e.descricao || '').toLowerCase() === (i.descricao || '').toLowerCase());
                return `
                  <label class="lista-row" style="display:flex;align-items:center;gap:12px;padding:10px 8px;border-bottom:1px solid var(--border);cursor:pointer">
                    <input type="checkbox" ${comprado ? 'checked' : ''}
                      style="width:22px;height:22px;flex:0 0 auto;accent-color:var(--success)"
                      onchange="OS.toggleComprado('${i.id}', this.checked)">
                    <div style="flex:1;min-width:0">
                      <div style="font-weight:600;${comprado ? 'text-decoration:line-through;color:var(--text-muted)' : ''}">${i.descricao}</div>
                      <div style="font-size:.78rem;color:var(--text-muted);margin-top:2px">
                        ${i.quantidade || 1} ${i.unidade || 'un'}
                        ${noEst ? ` · <span class="badge badge-success" style="font-size:.65rem">estoque: ${noEst.quantidade}</span>` : ''}
                      </div>
                    </div>
                    <button class="btn btn-sm btn-danger" style="flex:0 0 auto" onclick="event.preventDefault();OS.deleteListaItem('${i.id}')">✕</button>
                  </label>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }).join('')}

      ${_renderNovaListaModal()}
    `;
  }

  // Modal inline da Nova Lista — escolhe cliente uma vez e adiciona vários itens
  function _renderNovaListaModal() {
    const aberto = !!_novaLista._aberto;
    if (!aberto) return '';
    const cliFix = _novaLista.cliente_id;
    return `
      <div class="card mt-3" style="border:2px solid var(--primary)">
        <div class="card-header">
          <h3>Nova Lista de Compras</h3>
          <button class="btn btn-sm btn-outline" onclick="OS.fecharNovaLista()">✕</button>
        </div>
        <div class="card-body">
          <div class="form-group">
            <label>Cliente *</label>
            <select id="nl-cliente" class="input" ${cliFix ? 'disabled' : ''}
              onchange="OS._setNovaListaCliente(this.value)">
              ${App.clienteOptions('cliente', cliFix)}
            </select>
            ${cliFix ? '<small style="color:var(--text-muted);font-size:.72rem">Adicionando itens para este cliente. Para trocar, cancele e comece de novo.</small>' : ''}
          </div>

          <hr style="margin:12px 0;border:none;border-top:1px solid var(--border)">

          <div class="form-row">
            <div class="form-group">
              <label>Item</label>
              <input type="text" id="nl-desc" class="input" placeholder="Ex: Parafuso M8"
                onkeydown="if(event.key==='Enter'){event.preventDefault();OS.addItemNovaLista();}">
            </div>
            <div class="form-group" style="flex:0 0 80px">
              <label>Qtd</label>
              <input type="number" id="nl-qtd" class="input" value="1" min="0.01" step="0.01">
            </div>
            <div class="form-group" style="flex:0 0 80px">
              <label>Un.</label>
              <input type="text" id="nl-und" class="input" placeholder="un">
            </div>
          </div>
          <button type="button" class="btn btn-outline btn-full" onclick="OS.addItemNovaLista()">+ Adicionar à lista</button>

          ${_novaLista.itens.length > 0 ? `
            <div style="margin-top:14px">
              <div style="font-size:.78rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">
                ${_novaLista.itens.length} item(s) para salvar
              </div>
              ${_novaLista.itens.map((it, i) => `
                <div class="info-row" style="padding:6px 4px">
                  <span>${it.descricao} — ${it.quantidade} ${it.unidade}</span>
                  <button class="btn btn-sm btn-danger" onclick="OS.removeItemNovaLista(${i})">✕</button>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
        <div class="card-body" style="padding-top:0;display:flex;gap:8px">
          <button class="btn btn-outline" onclick="OS.fecharNovaLista()">Cancelar</button>
          <button class="btn btn-primary" style="flex:1" onclick="OS.salvarNovaLista()"
            ${_novaLista.itens.length === 0 ? 'disabled' : ''}>
            Salvar ${_novaLista.itens.length > 0 ? `(${_novaLista.itens.length})` : ''}
          </button>
        </div>
      </div>
    `;
  }

  function openNovaListaForm() {
    _novaLista = { cliente_id: '', itens: [], _aberto: true };
    renderListaCompras();
  }

  function fecharNovaLista() {
    _novaLista = { cliente_id: '', itens: [], _aberto: false };
    renderListaCompras();
  }

  // Adiciona itens a um cliente já existente — pré-seleciona e trava o cliente
  function addItensCliente(clienteId) {
    _novaLista = { cliente_id: clienteId, itens: [], _aberto: true };
    renderListaCompras();
    setTimeout(() => qs('#nl-desc')?.focus(), 50);
  }

  function _setNovaListaCliente(id) {
    _novaLista.cliente_id = id;
  }

  function addItemNovaLista() {
    const cli  = qs('#nl-cliente')?.value || _novaLista.cliente_id;
    const desc = qs('#nl-desc')?.value.trim();
    const qtd  = Number(qs('#nl-qtd')?.value) || 1;
    const und  = qs('#nl-und')?.value.trim() || 'un';
    if (!cli)  { Toast.warning('Selecione o cliente'); return; }
    if (!desc) { Toast.warning('Informe o item'); return; }
    _novaLista.cliente_id = cli;
    _novaLista.itens.push({ descricao: desc, quantidade: qtd, unidade: und });
    renderListaCompras();
    setTimeout(() => {
      qs('#nl-desc').value = '';
      qs('#nl-qtd').value  = '1';
      qs('#nl-und').value  = '';
      qs('#nl-desc')?.focus();
    }, 30);
  }

  function removeItemNovaLista(i) {
    _novaLista.itens.splice(i, 1);
    renderListaCompras();
  }

  async function salvarNovaLista() {
    if (!_novaLista.cliente_id || _novaLista.itens.length === 0) return;
    Loading.show();
    const ops = _novaLista.itens.map(it => ({
      action: 'create',
      sheet:  'lista_compras',
      data: {
        cliente_id:   _novaLista.cliente_id,
        descricao:    it.descricao,
        quantidade:   it.quantidade,
        unidade:      it.unidade,
        status:       'pendente',
        data_criacao: DateUtil.today(),
      },
    }));
    const res = await API.db.batch(ops);
    Loading.hide();
    if (res?.success) {
      Toast.success(`${ops.length} item(s) adicionado(s)!`);
      _novaLista = { cliente_id: '', itens: [], _aberto: false };
      await openListaCompras();
    } else {
      Toast.error('Erro ao salvar lista');
    }
  }

  // Toggle in-place: o item permanece visível, só muda o status
  async function toggleComprado(id, comprado) {
    const novoStatus = comprado ? 'comprado' : 'pendente';
    // Otimista: atualiza cache local e rerendeniza imediato
    const it = _listaCache.lista.find(l => l.id === id);
    if (it) it.status = novoStatus;
    renderListaCompras();
    await API.db.update('lista_compras', id, { status: novoStatus });
  }

  // Mantido para compatibilidade (Home/etc) — agora apenas marca
  async function marcarComprado(id) {
    await toggleComprado(id, true);
  }

  async function deleteListaItem(id) {
    Modal.confirm('Remover item da lista?', async () => {
      _listaCache.lista = _listaCache.lista.filter(l => l.id !== id);
      renderListaCompras();
      await API.db.delete('lista_compras', id);
    });
  }

  // Stub: o form antigo foi substituído pela Nova Lista
  function openListaItemForm() { openNovaListaForm(); }
  async function saveListaItem(e) { e.preventDefault(); }

  async function confirmDelete(id) {
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

  return {
    render, renderList, applyFilters, setStatus, tapCard, _maisOpcoes, openDetail, openForm, toggleTipo, saveForm,
    openDiaria, registrarDiaEm, calcDiariaPreview, saveDiaria, deleteDiaria, tapDiaria,
    renderBlocos, addBloco, removeBloco, setBloco, toggleBlocoReajuste, toggleBlocoFator,
    openItemForm, onItemTipoChange, saveItem, deleteItem,
    // Calculadora no detalhe + Fechamento simplificado
    renderCalculadora, calcDiariaUpdate, calcNormalUpdate, toggleCalc, salvarCalculo,
    openFechamento, atualizarFechamento, toggleDescontoTipo, saveFechamento, mudarStatus,
    openListaCompras, openListaItemForm, saveListaItem, marcarComprado, deleteListaItem,
    openNovaListaForm, fecharNovaLista, addItensCliente, _setNovaListaCliente,
    addItemNovaLista, removeItemNovaLista, salvarNovaLista, toggleComprado,
    confirmDelete,
  };
})();
