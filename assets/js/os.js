// ============================================================
// OS - Ordens de Serviço
// ============================================================

const OS = (() => {
  let allOS = [], allDiarias = [], allItens = [];
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
    if (q)            items = filterRecords(items, q, ['numero','observacoes']).concat(
                               items.filter(o => App.clienteNome(o.cliente_id).toLowerCase().includes(q.toLowerCase()))
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
          : items.map(o => `
            <div class="entity-item" onclick="OS.tapCard('${o.id}')">
              <div class="avatar ${statusAv(o.status)}">
                <span style="font-size:.75rem;font-weight:800">${o.numero?.replace('OS-','')}</span>
              </div>
              <div class="entity-info">
                <div class="entity-name">${App.clienteNome(o.cliente_id)}</div>
                <div class="entity-sub">${Fmt.date(o.data_inicio)}${o.data_fim ? ' → ' + Fmt.date(o.data_fim) : ''}</div>
                <div class="entity-badges">${tipoBadge(o.tipo)} ${statusBadge(o.status)}</div>
              </div>
              <div class="entity-right">
                <span class="entity-value">${o.valor_fechamento || o.valor_calculado ? Fmt.currency(o.valor_fechamento || o.valor_calculado) : ''}</span>
                <span class="entity-chevron">›</span>
              </div>
            </div>
          `).join('')}
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
    ];
    if (o && o.status !== 'fechado') {
      actions.push({ icon: '✓', label: 'Fechar OS', fn: () => openFechamento() });
    }
    actions.push({ icon: '🗑', label: 'Excluir OS', fn: () => confirmDelete(id), danger: true });
    ActionSheet.open(o ? o.numero : 'OS', actions);
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
                               .sort((a, b) => a.data > b.data ? 1 : -1);
    const itens   = allItens.filter(i => i.os_id === id);
    const section = qs('#page-os');
    const cliente = App.clienteNome(currentOS.cliente_id);

    section.innerHTML = `
      <!-- Header compacto -->
      <div class="page-header" style="gap:8px">
        <button class="btn btn-outline btn-sm" onclick="OS.render()">← Voltar</button>
        <div style="flex:1;min-width:0">
          <div style="font-size:.72rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px">${currentOS.numero}</div>
          <div style="font-weight:800;font-size:1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cliente}</div>
        </div>
        <button class="btn btn-outline btn-sm" style="font-size:1.2rem;letter-spacing:2px;padding:6px 12px"
          onclick="OS._maisOpcoes('${id}')">⋯</button>
      </div>

      <!-- Barra de ações principais -->
      ${currentOS.status !== 'fechado' ? `
        <div style="display:flex;gap:10px;margin-bottom:16px">
          ${currentOS.tipo === 'diaria' ? `
            <button class="btn btn-primary" style="flex:1;font-size:1rem;padding:13px 8px;border-radius:12px" onclick="OS.openDiaria()">
              ＋ Registrar Dia
            </button>
          ` : ''}
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
          <div><div class="info-label">Status</div>${statusBadge(currentOS.status)}</div>
          <div><div class="info-label">Início</div><strong>${Fmt.date(currentOS.data_inicio)}</strong></div>
          ${currentOS.data_fim ? `<div><div class="info-label">Fim</div><strong>${Fmt.date(currentOS.data_fim)}</strong></div>` : '<div></div>'}
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

      <!-- Dias (só para diária) -->
      ${currentOS.tipo === 'diaria' ? `
        <div class="card mb-3">
          <div class="card-header">
            <h3>Dias Trabalhados</h3>
            <span class="badge badge-info">${diarias.length} dia(s)</span>
          </div>
          <div class="entity-list" style="border-radius:0;border:none;box-shadow:none">
            ${diarias.length === 0
              ? '<div class="entity-empty">Nenhum dia registrado ainda</div>'
              : diarias.map(d => {
                  const valor = Number(d.valor_manual || d.valor_calculado || 0);
                  const horas = Number(d.horas_totais || 0);
                  const tmi = Fmt.time(d.manha_inicio), tmf = Fmt.time(d.manha_fim);
                  const tti = Fmt.time(d.tarde_inicio),  ttf = Fmt.time(d.tarde_fim);
                  const manha = (tmi !== '—' && tmf !== '—') ? `☀️ ${tmi}–${tmf}` : '';
                  const tarde = (tti !== '—' && ttf !== '—') ? `🌤 ${tti}–${ttf}` : '';
                  const periodos = [manha, tarde].filter(Boolean).join('   ');
                  return `
                    <div class="entity-item" onclick="${currentOS.status !== 'fechado' ? `OS.tapDiaria('${d.id}')` : ''}">
                      <div class="avatar av-navy" style="font-size:.7rem;font-weight:800;flex-direction:column;gap:0;line-height:1.1">
                        <span>${Fmt.date(d.data).split('/').slice(0,2).join('/')}</span>
                      </div>
                      <div class="entity-info">
                        <div class="entity-name">${periodos || (d.valor_manual ? '💰 Valor manual' : 'Sem horários')}</div>
                        <div class="entity-sub">${horas > 0 ? Fmt.hours(horas) : ''}${d.valor_manual ? ' · valor fixo' : ''}</div>
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
                <div class="entity-info"><strong>Total (${diarias.length} dias)</strong></div>
                <div class="entity-right">
                  <span class="entity-value">${Fmt.currency(diarias.reduce((s,d)=>s+Number(d.valor_manual||d.valor_calculado||0),0))}</span>
                </div>
              </div>` : ''}
          </div>
        </div>
      ` : ''}
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
      const fatores = Calculator.getFatores(cfg);
      body.innerHTML = _renderCalcNormal(cfg, fatores, totalItens);
      calcNormalUpdate();
    }
  }

  // Alterna entre calculadora aberta e fechada (re-renderizando só o card)
  async function toggleCalc() {
    _calcExpanded = !_calcExpanded;
    if (!currentOS) return;
    const diarias = allDiarias.filter(d => d.os_id === currentOS.id)
                              .sort((a, b) => a.data > b.data ? 1 : -1);
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
      data_atualizacao:  new Date().toISOString(),
    });
    Loading.hide();
    if (res?.success) {
      currentOS.valor_calculado = _calc.liquido;
      const idx = allOS.findIndex(o => o.id === currentOS.id);
      if (idx >= 0) allOS[idx].valor_calculado = _calc.liquido;
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

  function _renderCalcNormal(cfg, fatores, totalItens) {
    const hManut = Fmt.currency(Number(cfg.valor_hora_manutencao) || 155);
    const hProj  = Fmt.currency(Number(cfg.valor_hora_projeto)    || 200);
    const vPrx   = Fmt.currency(Number(cfg.valor_chamada_proximo) || 200);
    const vDst   = Fmt.currency(Number(cfg.valor_chamada_distante)|| 250);
    return `
      <div class="form-group">
        <label>Tipo de Serviço</label>
        <select id="calc-tipo" class="input" onchange="OS.calcNormalUpdate()">
          <option value="manutencao">🔧 Manutenção (${hManut}/h)</option>
          <option value="projeto">🏗️ Projeto Novo (${hProj}/h)</option>
        </select>
      </div>
      <div class="form-group">
        <label>Horas Trabalhadas</label>
        <input type="number" id="calc-horas" class="input" step="0.5" value="1" min="0" oninput="OS.calcNormalUpdate()">
      </div>
      <p style="font-size:.75rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin:14px 0 8px">Fatores de Ajuste</p>
      <div id="calc-fatores">
        ${fatores.map(f => `
          <label class="checkbox-item">
            <input type="checkbox" class="fator-check" data-perc="${f.percentual}" onchange="OS.calcNormalUpdate()">
            <span>${f.label} <small style="color:var(--text-muted)">(+${f.percentual}%)</small></span>
          </label>
        `).join('')}
      </div>
      <p style="font-size:.75rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin:14px 0 8px">Material e Chamada</p>
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

  // Recalcula valor para OS normal usando Calculator
  async function calcNormalUpdate() {
    const chamadaOn = qs('#calc-chamada')?.checked || false;
    qs('#calc-chamada-tipo-wrap')?.classList.toggle('hidden', !chamadaOn);

    const cfg = await Calculator.getConfig();
    const tipo = qs('#calc-tipo')?.value;
    const horaBase = tipo === 'projeto'
      ? Calculator.cfgNum(cfg, 'valor_hora_projeto', 200)
      : Calculator.cfgNum(cfg, 'valor_hora_manutencao', 155);

    const fatoresAtivos = qsa('.fator-check:checked').map(c => ({ percentual: Number(c.dataset.perc) }));
    const totalItens = Number(qs('#calc-itens-total')?.value) || 0;
    const params = {
      horaBase,
      horas:             Number(qs('#calc-horas')?.value         || 0),
      material:          Number(qs('#calc-material')?.value      || 0),
      taxaAdminMaterial: Number(qs('#calc-taxa-admin')?.value    || 0),
      fatoresAtivos,
      chamadaTecnica:    chamadaOn,
      tipoChamada:       qs('#calc-chamada-tipo')?.value          || 'proximo',
      desconto:          0,   // desconto agora vive no modal de fechamento
      simples:           Number(qs('#calc-simples')?.value        || 0),
    };

    const r = await Calculator.calcularServico(params);
    const totalComItens = r.total + totalItens;

    _calc = {
      bruto:   r.subtotalBruto + totalItens,
      liquido: totalComItens,
      horas:   params.horas,
      detalhe: `${params.horas}h · ${tipo}`,
    };

    const bd = qs('#calc-breakdown');
    if (bd) {
      const row = (label, val, style = '') =>
        `<div class="info-row" ${style ? `style="${style}"` : ''}><span>${label}</span><span>${val}</span></div>`;
      bd.innerHTML = `<div style="border-top:1px solid var(--border);padding-top:10px">
        ${row('Hora base:', `${Fmt.currency(horaBase)}/h`)}
        ${r.totalPerc > 0 ? row(`Fatores (+${r.totalPerc}%):`, `<strong>${Fmt.currency(r.horaFinal)}/h</strong>`) : ''}
        ${row(`Mão de obra (${Fmt.hours(params.horas)}):`, Fmt.currency(r.subtotalMao))}
        ${params.material > 0 ? row(`Material + admin (${params.taxaAdminMaterial}%):`, Fmt.currency(r.subtotalMat)) : ''}
        ${r.valorChamada > 0 ? row('Chamada técnica:', Fmt.currency(r.valorChamada)) : ''}
        ${totalItens > 0 ? row('Itens do OS:', Fmt.currency(totalItens)) : ''}
        ${row('Subtotal:', Fmt.currency(r.subtotalBruto + totalItens), 'border-top:1px solid var(--border);margin-top:6px;padding-top:6px')}
        ${r.valorSimples > 0 ? row(`Simples (${params.simples}%):`, `+${Fmt.currency(r.valorSimples)}`, 'color:var(--text-muted)') : ''}
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
    return `<table class="table">
      <thead><tr><th>Tipo</th><th>Descrição</th><th>Qtd</th><th>Unit.</th><th>Total</th><th></th></tr></thead>
      <tbody>
        ${itens.map(i => `
          <tr>
            <td><span class="badge ${i.tipo === 'material' ? 'badge-info' : 'badge-secondary'}">${i.tipo}</span></td>
            <td>${i.descricao}</td>
            <td>${i.quantidade}</td>
            <td>${Fmt.currency(i.valor_unit)}</td>
            <td>${Fmt.currency(i.valor_total)}</td>
            <td>
              <button class="btn btn-sm btn-outline" onclick="OS.openItemForm('${i.id}')">Editar</button>
              <button class="btn btn-sm btn-danger"  onclick="OS.deleteItem('${i.id}')">✕</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
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
              <label>Cliente *</label>
              <div class="input-row">
                <select name="cliente_id" id="os-form-cliente" class="input" required>
                  ${App.clienteOptions('cliente', os?.cliente_id)}
                </select>
                <button type="button" class="btn-quick-add" title="Cadastrar novo cliente"
                  onclick="App.quickAdd('os-form-cliente','cliente')">+</button>
              </div>
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

  // ─── FORM DIÁRIA ────────────────────────────────────────
  async function openDiaria(diariaId = null) {
    if (!currentOS) return;
    let d = null;
    if (diariaId) d = allDiarias.find(x => x.id === diariaId);
    const cfg = await Calculator.getConfig();

    qs('#modal-diaria-os-id').value     = currentOS.id;
    qs('#modal-diaria-id').value        = diariaId || '';
    qs('#modal-diaria-data').value      = Fmt.dateInput(d?.data) || DateUtil.today();
    qs('#modal-diaria-manha-in').value  = Fmt.timeInput(d?.manha_inicio);
    qs('#modal-diaria-manha-fim').value = Fmt.timeInput(d?.manha_fim);
    qs('#modal-diaria-tarde-in').value  = Fmt.timeInput(d?.tarde_inicio);
    qs('#modal-diaria-tarde-fim').value = Fmt.timeInput(d?.tarde_fim);
    qs('#modal-diaria-manual').value    = d?.valor_manual || '';
    const vHora = cfg.valor_hora_manutencao || cfg.valor_hora || 0;
    qs('#modal-diaria-info').textContent = `Valor hora: ${Fmt.currency(vHora)} | Total calculado com base nas horas`;

    await calcDiariaPreview();
    Modal.open('modal-diaria');
  }

  async function calcDiariaPreview() {
    const mi = qs('#modal-diaria-manha-in').value;
    const mf = qs('#modal-diaria-manha-fim').value;
    const ti = qs('#modal-diaria-tarde-in').value;
    const tf = qs('#modal-diaria-tarde-fim').value;
    const manual = qs('#modal-diaria-manual').value;

    let horas = 0;
    if (mi && mf) horas += DateUtil.diffHours(mi, mf);
    if (ti && tf) horas += DateUtil.diffHours(ti, tf);

    const valor = await Calculator.calcularDia(mi, mf, ti, tf, manual || null);
    qs('#modal-diaria-horas').textContent = Fmt.hours(horas);
    qs('#modal-diaria-valor').textContent = Fmt.currency(valor);
  }

  async function saveDiaria() {
    const osId    = qs('#modal-diaria-os-id').value;
    const id      = qs('#modal-diaria-id').value;
    const mi      = qs('#modal-diaria-manha-in').value;
    const mf      = qs('#modal-diaria-manha-fim').value;
    const ti      = qs('#modal-diaria-tarde-in').value;
    const tf      = qs('#modal-diaria-tarde-fim').value;
    const manual  = qs('#modal-diaria-manual').value;

    // Validar: pelo menos 2 campos preenchidos
    const filled = [mi, mf, ti, tf].filter(Boolean).length;
    if (filled < 2) { Toast.warning('Preencha ao menos 2 horários'); return; }

    let horas = 0;
    if (mi && mf) horas += DateUtil.diffHours(mi, mf);
    if (ti && tf) horas += DateUtil.diffHours(ti, tf);
    const valorCalc = await Calculator.calcularDia(mi, mf, ti, tf, null);

    // Prefixo '@' impede o Google Sheets de converter "HH:MM" para tipo Time
    // (que causaria deslocamento de fuso horário ao ler de volta)
    const safe = t => t ? '@' + t : '';
    const data = {
      os_id:         osId,
      data:          qs('#modal-diaria-data').value,
      manha_inicio:  safe(mi), manha_fim: safe(mf),
      tarde_inicio:  safe(ti), tarde_fim: safe(tf),
      horas_totais:  horas,
      valor_calculado: valorCalc,
      valor_manual:  manual || '',
      observacoes:   '',
    };

    Loading.show();
    const res = id ? await API.db.update('diarias', id, data) : await API.db.create('diarias', data);
    Loading.hide();

    if (res?.success) {
      Toast.success('Dia registrado!');
      Modal.close('modal-diaria');
      // Atualizar datas da OS
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
    Modal.confirm('Excluir este dia?', async () => {
      await API.db.delete('diarias', id);
      Toast.success('Dia excluído');
      await loadData();
      openDetail(currentOS.id);
    });
  }

  function tapDiaria(id) {
    ActionSheet.open('Dia registrado', [
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
    qs('#modal-item-estoque').innerHTML =
      '<option value="">— Selecione do estoque (opcional) —</option>' +
      estoque.map(e => `<option value="${e.id}" data-unit="${e.valor_unit}" ${e.id === item?.estoque_id ? 'selected' : ''}>${e.descricao} (Qtd: ${e.quantidade})</option>`).join('');
    Modal.open('modal-item');
  }

  async function saveItem() {
    const itemId  = qs('#modal-item-id').value;
    const osId    = qs('#modal-item-os-id').value;
    const tipo    = qs('#modal-item-tipo').value;
    const estId   = qs('#modal-item-estoque').value;
    const desc    = qs('#modal-item-desc').value;
    const qtd     = Number(qs('#modal-item-qtd').value) || 1;
    const unit    = Number(qs('#modal-item-unit').value) || 0;
    const total   = Number(qs('#modal-item-total').value) || (qtd * unit);

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
    Loading.hide();

    if (res?.success) {
      Toast.success(itemId ? 'Item atualizado!' : 'Item adicionado!');
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

  // ─── FECHAMENTO (versão simplificada — apenas valor + competência + venc) ─
  // Pré-requisito: a calculadora no detalhe já preencheu _calc.liquido.
  function openFechamento() {
    if (!currentOS) return;

    // Se a calculadora ainda não foi tocada (raro), usa o valor calculado da OS
    if (_calc.liquido <= 0) {
      _calc.liquido = Number(currentOS.valor_calculado || 0);
      _calc.bruto   = _calc.liquido;
    }

    const calc = _calc.liquido;

    // Renderiza modal de fechamento (página dedicada, simples)
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

            <!-- Valor calculado (readonly) -->
            <div class="form-group">
              <label>Valor calculado</label>
              <input type="text" id="fech-calculado" class="input" value="${Fmt.currency(calc)}"
                readonly style="background:var(--bg);font-weight:700;color:var(--text-muted)">
              <input type="hidden" id="fech-calculado-num" value="${calc.toFixed(2)}">
              <small style="color:var(--text-muted);font-size:.72rem">Vem da calculadora — se quiser sobrescrever, preencha "valor manual" abaixo.</small>
            </div>

            <!-- Valor manual opcional -->
            <div class="form-group">
              <label>Valor manual <small style="color:var(--text-muted);font-weight:400">(opcional)</small></label>
              <input type="number" id="fech-manual" class="input" step="0.01" min="0" placeholder="Em branco = usar calculado"
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

            <div class="form-group">
              <label>Categoria <small style="color:var(--text-muted);font-weight:400">(opcional)</small></label>
              <select id="fech-categoria" class="input">${App.categoriaOptions('entrada')}</select>
            </div>

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
    const catId   = qs('#fech-categoria').value;
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

    if (res?.success) {
      Toast.success('OS fechada! Parcela gerada no financeiro.');
      await loadData();
      await App.loadGlobals();
      renderList();
    } else {
      Toast.error('Erro: ' + (res?.error || ''));
    }
  }

  // ─── LISTA DE COMPRAS ───────────────────────────────────
  async function openListaCompras() {
    const [lcRes, cliRes, estRes] = await Promise.all([
      API.db.read('lista_compras'),
      API.db.read('clientes'),
      API.db.read('estoque'),
    ]);
    const lista   = lcRes?.data  || [];
    const clientes= cliRes?.data || [];
    const estoque = (estRes?.data || []).filter(e => e.ativo !== false && e.ativo !== 'false');

    const section = qs('#page-os');
    section.innerHTML = `
      <div class="section-tabs">
        <button class="section-tab" onclick="OS.render()">📋 Ordens</button>
        <button class="section-tab" onclick="App.navigate('estoque')">📦 Estoque</button>
        <button class="section-tab active" onclick="OS.openListaCompras()">🛒 Lista Compras</button>
      </div>

      <div class="page-header">
        <h1>Lista de Compras</h1>
        <button class="btn btn-primary" onclick="OS.openListaItemForm()">+ Adicionar Item</button>
      </div>
      ${clientes.filter(c => c.tipo === 'cliente' || c.tipo === 'ambos').map(c => {
        const itens = lista.filter(l => l.cliente_id === c.id && l.status !== 'comprado');
        if (itens.length === 0) return '';
        return `
          <div class="card mt-3">
            <div class="card-header"><h3>${c.nome}</h3></div>
            <div class="table-responsive">
              <table class="table">
                <thead><tr><th>Item</th><th>Qtd</th><th>No Estoque</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  ${itens.map(i => {
                    const noEst = estoque.find(e => e.descricao.toLowerCase() === i.descricao.toLowerCase());
                    return `
                      <tr>
                        <td>${i.descricao}</td>
                        <td>${i.quantidade} ${i.unidade || ''}</td>
                        <td>${noEst ? `<span class="badge badge-success">✓ ${noEst.quantidade} ${noEst.unidade||''}</span>` : '<span class="badge badge-danger">Não tem</span>'}</td>
                        <td>${statusBadge(i.status || 'pendente')}</td>
                        <td>
                          <button class="btn btn-sm btn-success" onclick="OS.marcarComprado('${i.id}')">Comprado</button>
                          <button class="btn btn-sm btn-danger"  onclick="OS.deleteListaItem('${i.id}')">✕</button>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
      }).join('')}
      <div id="modal-lista-item-form" class="hidden card mt-3">
        <div class="card-header"><h3>Adicionar Item à Lista</h3></div>
        <div class="card-body">
          <form id="lista-item-form" onsubmit="OS.saveListaItem(event)">
            <div class="form-row">
              <div class="form-group">
                <label>Cliente</label>
                <select name="cliente_id" class="input" required>
                  ${App.clienteOptions('cliente')}
                </select>
              </div>
              <div class="form-group">
                <label>Item</label>
                <input type="text" name="descricao" class="input" required>
              </div>
              <div class="form-group">
                <label>Qtd</label>
                <input type="number" name="quantidade" class="input" value="1" min="1">
              </div>
              <div class="form-group">
                <label>Unidade</label>
                <input type="text" name="unidade" class="input" placeholder="un, m, kg...">
              </div>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary">Adicionar</button>
              <button type="button" class="btn btn-outline" onclick="qs('#modal-lista-item-form').classList.add('hidden')">Cancelar</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  function openListaItemForm() {
    qs('#modal-lista-item-form')?.classList.remove('hidden');
  }

  async function saveListaItem(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = { ...Object.fromEntries(fd.entries()), status: 'pendente', data_criacao: DateUtil.today() };
    const res = await API.db.create('lista_compras', data);
    if (res?.success) { Toast.success('Item adicionado!'); openListaCompras(); }
    else Toast.error('Erro: ' + res?.error);
  }

  async function marcarComprado(id) {
    await API.db.update('lista_compras', id, { status: 'comprado' });
    Toast.success('Marcado como comprado!');
    openListaCompras();
  }

  async function deleteListaItem(id) {
    Modal.confirm('Remover item da lista?', async () => {
      await API.db.delete('lista_compras', id);
      openListaCompras();
    });
  }

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
    openDiaria, calcDiariaPreview, saveDiaria, deleteDiaria, tapDiaria,
    openItemForm, saveItem, deleteItem,
    // Calculadora no detalhe + Fechamento simplificado
    renderCalculadora, calcDiariaUpdate, calcNormalUpdate, toggleCalc, salvarCalculo,
    openFechamento, atualizarFechamento, toggleDescontoTipo, saveFechamento,
    openListaCompras, openListaItemForm, saveListaItem, marcarComprado, deleteListaItem,
    confirmDelete,
  };
})();
