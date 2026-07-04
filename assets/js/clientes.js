// ============================================================
// CLIENTES / FORNECEDORES
// ============================================================

const Clientes = (() => {
  let allClientes = [];
  let _filtroTipo = '';
  let _view       = 'lista';   // lista | resumo

  async function render() {
    await loadData();
    if (_view === 'resumo') return renderResumo();
    renderList();
  }

  function goView(v) {
    _view = v;
    if (v === 'resumo') renderResumo(); else renderList();
  }

  function viewTabsHTML(active) {
    return `
      <div class="tab-bar mb-3">
        <button class="tab-btn ${active==='lista'?'active':''}"  onclick="Clientes.goView('lista')">👥 Lista</button>
        <button class="tab-btn ${active==='resumo'?'active':''}" onclick="Clientes.goView('resumo')">📊 Resumo</button>
      </div>
    `;
  }

  async function loadData() {
    const shown = Loading.maybeShow('clientes');
    const res = await API.db.read('clientes');
    if (shown) Loading.hide();
    allClientes = res?.data || [];
  }

  function renderList(q = '', filtroTipo = _filtroTipo) {
    _view = 'lista';
    _filtroTipo = filtroTipo;
    let items = allClientes.filter(c => c.ativo !== false && c.ativo !== 'false');
    if (filtroTipo) items = items.filter(c => c.tipo === filtroTipo);
    if (q) items = filterRecords(items, q, ['nome','telefone','endereco']);
    items = [...items].sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' }));

    const tipoBadgeCli = t => {
      if (t === 'cliente')    return '<span class="badge badge-info">Cliente</span>';
      if (t === 'fornecedor') return '<span class="badge badge-secondary">Fornecedor</span>';
      if (t === 'equipe')     return '<span class="badge badge-success">Equipe</span>';
      if (t === 'ambos')      return '<span class="badge badge-gold">Ambos</span>';
      return '<span class="badge badge-secondary">' + (t || 'Outro') + '</span>';
    };

    const section = qs('#page-clientes');
    section.innerHTML = `
      <div class="page-header">
        <h1>Clientes / Fornecedores</h1>
        <button class="btn btn-primary" onclick="Clientes.openForm()">+ Novo</button>
      </div>
      ${viewTabsHTML('lista')}
      <div class="mb-3">
        <input type="text" id="cli-search" placeholder="Buscar nome, telefone..." class="input-search" value="${q}"
          oninput="Clientes.applyFilters()">
      </div>
      <div class="tab-bar mb-3">
        <button class="tab-btn ${filtroTipo===''?'active':''}"           onclick="Clientes.renderList(qs('#cli-search')?.value||'','')">Todos</button>
        <button class="tab-btn ${filtroTipo==='cliente'?'active':''}"    onclick="Clientes.renderList(qs('#cli-search')?.value||'','cliente')">Clientes</button>
        <button class="tab-btn ${filtroTipo==='fornecedor'?'active':''}" onclick="Clientes.renderList(qs('#cli-search')?.value||'','fornecedor')">Fornec.</button>
        <button class="tab-btn ${filtroTipo==='equipe'?'active':''}"     onclick="Clientes.renderList(qs('#cli-search')?.value||'','equipe')">Equipe</button>
      </div>
      <div class="entity-list">
        ${items.length === 0
          ? '<div class="entity-empty">Nenhum cadastro encontrado</div>'
          : items.map(c => `
            <div class="entity-item" onclick="Clientes.openDetail('${c.id}')">
              <div class="avatar ${avatarColor(c.nome)}">${getInitials(c.nome)}</div>
              <div class="entity-info">
                <div class="entity-name">${c.nome}</div>
                <div class="entity-sub">${c.endereco || (c.telefone ? '📞 ' + c.telefone : 'Sem endereço')}</div>
                <div class="entity-badges">${tipoBadgeCli(c.tipo)}${c.telefone && c.endereco ? `<span class="badge badge-secondary">📞 ${c.telefone}</span>` : ''}</div>
              </div>
              <div class="entity-right">
                <span class="entity-chevron">›</span>
              </div>
            </div>
          `).join('')}
      </div>
    `;
  }

  function applyFilters() {
    const q = qs('#cli-search')?.value || '';
    renderList(q, _filtroTipo);
  }

  // ── Aba Resumo: visão financeira da carteira de clientes ──
  async function renderResumo() {
    _view = 'resumo';
    const shown = Loading.maybeShow('clientes-resumo');
    const [parRes, osRes, diaRes, cfg] = await Promise.all([
      API.db.read('parcelas'),
      API.db.read('os'),
      API.db.read('diarias'),
      Calculator.getConfig(),
    ]);
    if (shown) Loading.hide();

    const hoje = DateUtil.today();
    const d12  = new Date(); d12.setMonth(d12.getMonth() - 12);
    const ini12 = d12.toISOString().split('T')[0];

    const parcelas = (parRes?.data || []).filter(p =>
      p.status !== 'cancelado' && !origemForaResultado(p.origem) &&
      p.origem !== 'fiado' && p.origem !== 'fiado_pago');
    const osList  = osRes?.data || [];
    const diarias = diaRes?.data || [];

    const nomeDe = {}; allClientes.forEach(c => { nomeDe[c.id] = c.nome; });
    const cliDe  = {}, statusDe = {};
    osList.forEach(o => { cliDe[o.id] = o.cliente_id; statusDe[o.id] = o.status; });
    const horaBase = Calculator.cfgNum(cfg, 'valor_hora_manutencao', 0) || Calculator.cfgNum(cfg, 'valor_hora', 0);
    const diasDesde = d => Math.floor((Date.parse(hoje) - Date.parse(d)) / 86400000);

    // Quem me deve (situação atual, sem janela)
    const devMap = {};
    parcelas.forEach(p => {
      if (p.tipo !== 'receber' || p.status === 'pago' || !p.cliente_id) return;
      const m = devMap[p.cliente_id] || (devMap[p.cliente_id] = { total: 0, vencido: 0, maxAtraso: 0, proxVenc: '' });
      m.total += Number(p.valor || 0);
      const v = String(p.data_vencimento || '').substring(0, 10);
      if (v && v < hoje) {
        m.vencido += Number(p.valor || 0);
        m.maxAtraso = Math.max(m.maxAtraso, diasDesde(v));
      } else if (v && (!m.proxVenc || v < m.proxVenc)) m.proxVenc = v;
    });
    const devedores    = Object.entries(devMap).sort((a, b) => b[1].total - a[1].total);
    const totalReceber = devedores.reduce((s, [, m]) => s + m.total, 0);
    const totalVencido = devedores.reduce((s, [, m]) => s + m.vencido, 0);

    // Faturamento 12m por cliente (regra de competência: quando o serviço aconteceu)
    const fat12 = {}, fatLife = {};
    parcelas.forEach(p => {
      if (p.tipo !== 'receber' || !p.cliente_id) return;
      const val = Number(p.valor || 0);
      fatLife[p.cliente_id] = (fatLife[p.cliente_id] || 0) + val;
      const ref = String(p.data_competencia || p.data_pagamento || p.data_vencimento || '').substring(0, 10);
      if (ref >= ini12) fat12[p.cliente_id] = (fat12[p.cliente_id] || 0) + val;
    });

    // Horas 12m por cliente — sessões de OS FECHADAS (OS aberta ainda não faturou,
    // entraria como falso R$/h baixo). Espelha _horasBreakdown: OS normal antiga
    // sem sessão entra pelas horas_calculadas.
    const osComSessao = new Set(diarias.map(d => d.os_id));
    const horas12 = {};
    diarias.forEach(d => {
      const cid = cliDe[d.os_id];
      if (!cid || statusDe[d.os_id] !== 'fechado') return;
      const data = String(d.data || '').substring(0, 10);
      if (data < ini12) return;
      horas12[cid] = (horas12[cid] || 0) + Number(d.horas_totais || 0);
    });
    osList.forEach(o => {
      if (o.tipo !== 'normal' || osComSessao.has(o.id) || o.status !== 'fechado' || !o.cliente_id) return;
      const ref = String(o.data_atualizacao || o.data_inicio || '').substring(0, 10);
      if (ref < ini12) return;
      horas12[o.cliente_id] = (horas12[o.cliente_id] || 0) + Number(o.horas_calculadas || 0);
    });

    const rentab = Object.entries(horas12)
      .filter(([, h]) => h > 0)
      .map(([cid, h]) => ({ cid, horas: h, fat: fat12[cid] || 0, rh: (fat12[cid] || 0) / h }))
      .sort((a, b) => b.rh - a.rh);

    // Ranking 12m (top 5) + nº de OS fechadas e ticket médio
    const nOS12 = {};
    osList.forEach(o => {
      if (o.status !== 'fechado' || !o.cliente_id) return;
      const ref = String(o.data_fim || o.data_atualizacao || o.data_inicio || '').substring(0, 10);
      if (ref >= ini12) nOS12[o.cliente_id] = (nOS12[o.cliente_id] || 0) + 1;
    });
    const ranking     = Object.entries(fat12).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const totalFat12  = ranking.reduce((s, [, v]) => s + v, 0);

    // Ativos 12m (teve OS ou receita na janela) vs cadastrados — só clientes
    const ehCliente   = c => c.ativo !== false && c.ativo !== 'false' && c.tipo !== 'fornecedor' && c.tipo !== 'equipe';
    const cadastrados = allClientes.filter(ehCliente);
    const ativosSet   = new Set(Object.keys(fat12));
    osList.forEach(o => {
      const ref = String(o.data_inicio || o.data_criacao || '').substring(0, 10);
      if (o.cliente_id && ref >= ini12) ativosSet.add(o.cliente_id);
    });
    const ativos12 = cadastrados.filter(c => ativosSet.has(c.id)).length;

    // Parados: já teve OS, nenhuma aberta, última há 90+ dias
    const ultimaOS = {}, temAberta = new Set();
    osList.forEach(o => {
      if (!o.cliente_id) return;
      if (o.status === 'andamento' || o.status === 'acerto') temAberta.add(o.cliente_id);
      const ref = String(o.data_fim || o.data_atualizacao || o.data_inicio || '').substring(0, 10);
      if (ref && (!ultimaOS[o.cliente_id] || ref > ultimaOS[o.cliente_id])) ultimaOS[o.cliente_id] = ref;
    });
    const parados = cadastrados
      .filter(c => ultimaOS[c.id] && !temAberta.has(c.id) && diasDesde(ultimaOS[c.id]) >= 90)
      .map(c => ({ cid: c.id, dias: diasDesde(ultimaOS[c.id]), hist: fatLife[c.id] || 0 }))
      .sort((a, b) => b.hist - a.hist);

    const hf = h => (Math.round(h * 10) / 10).toLocaleString('pt-BR') + 'h';
    const haTempo = dias => {
      const m = Math.floor(dias / 30);
      return m >= 1 ? `há ${m} ${m > 1 ? 'meses' : 'mês'}` : `há ${dias} dias`;
    };
    const rowCli = (cid, sub, right) => `
      <div class="info-row" style="cursor:pointer" onclick="Clientes.openDetail('${cid}')">
        <div style="min-width:0;flex:1">
          <div style="font-size:.875rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${nomeDe[cid] || 'Cliente removido'}</div>
          <div style="font-size:.72rem;color:var(--text-muted)">${sub}</div>
        </div>
        <div style="text-align:right;flex:0 0 auto">${right}</div>
      </div>
    `;

    const section = qs('#page-clientes');
    section.innerHTML = `
      <div class="page-header">
        <h1>Clientes / Fornecedores</h1>
        <button class="btn btn-primary" onclick="Clientes.openForm()">+ Novo</button>
      </div>
      ${viewTabsHTML('resumo')}

      <div class="stats-grid mb-3">
        <div class="stat-card ${totalVencido > 0 ? 'stat-red' : 'stat-blue'}">
          <div class="stat-label">A Receber</div>
          <div class="stat-value" style="font-size:1.05rem">${Fmt.currency(totalReceber)}</div>
          <div class="stat-sub">${totalVencido > 0 ? Fmt.currency(totalVencido) + ' vencido' : devedores.length ? devedores.length + ' cliente(s)' : 'nada pendente'}</div>
        </div>
        <div class="stat-card stat-green">
          <div class="stat-label">Ativos (12 meses)</div>
          <div class="stat-value" style="font-size:1.05rem">${ativos12}</div>
          <div class="stat-sub">de ${cadastrados.length} cadastrados</div>
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-header"><h3>💰 Quem me deve</h3></div>
        <div class="card-body">
          ${devedores.length === 0 ? '<p class="text-muted" style="margin:0">Ninguém devendo 🎉</p>' :
            devedores.map(([cid, m]) => rowCli(cid,
              m.vencido > 0 ? `<span style="color:var(--danger)">⚠ vencido ${haTempo(m.maxAtraso)}</span>` :
              m.proxVenc ? `vence em ${Fmt.date(m.proxVenc)}` : 'em aberto',
              `<strong class="${m.vencido > 0 ? 'text-red' : ''}">${Fmt.currency(m.total)}</strong>`
            )).join('')}
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-header">
          <h3>💵 Rentabilidade por cliente</h3>
          ${horaBase > 0 ? `<span class="badge badge-secondary">base ${Fmt.currency(horaBase)}/h</span>` : ''}
        </div>
        <div class="card-body">
          ${rentab.length === 0 ? '<p class="text-muted" style="margin:0">Sem horas registradas em OS fechadas nos últimos 12 meses</p>' : `
            ${rentab.slice(0, 8).map(r => {
              const acima = horaBase > 0 ? r.rh >= horaBase : null;
              return rowCli(r.cid, `${Fmt.currency(r.fat)} · ${hf(r.horas)} trabalhadas`, `
                <strong class="${acima === null ? '' : acima ? 'text-green' : 'text-red'}">${Fmt.currency(r.rh)}/h</strong>
                ${acima === null ? '' : `<div style="font-size:.68rem;color:var(--${acima ? 'success' : 'danger'})">${acima ? '▲ acima da base' : '▼ abaixo da base'}</div>`}
              `);
            }).join('')}
            ${rentab.length > 8 ? `<p class="text-muted mt-2" style="font-size:.78rem">+ ${rentab.length - 8} outros clientes</p>` : ''}
            <p class="text-muted mt-2" style="font-size:.72rem">Faturado ÷ horas de trabalho registradas nas OS fechadas · últimos 12 meses</p>
          `}
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-header">
          <h3>🏆 Top clientes</h3>
          <span class="badge badge-secondary">12 meses</span>
        </div>
        <div class="card-body">
          ${ranking.length === 0 ? '<p class="text-muted" style="margin:0">Sem faturamento nos últimos 12 meses</p>' : `
            ${ranking.slice(0, 5).map(([cid, val], i) => {
              const pct = totalFat12 > 0 ? (val / totalFat12) * 100 : 0;
              const n   = nOS12[cid] || 0;
              return `
                <div style="padding:6px 0;cursor:pointer" onclick="Clientes.openDetail('${cid}')">
                  <div style="display:flex;justify-content:space-between;gap:8px;font-size:.875rem">
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i + 1}. ${nomeDe[cid] || 'Cliente removido'}</span>
                    <strong style="flex:0 0 auto">${Fmt.currency(val)}</strong>
                  </div>
                  <div style="height:6px;background:var(--bg);border-radius:3px;margin:4px 0">
                    <div style="height:6px;width:${Math.max(2, pct)}%;background:var(--gold);border-radius:3px"></div>
                  </div>
                  <div style="font-size:.7rem;color:var(--text-muted)">${pct.toFixed(0)}% da carteira${n > 0 ? ` · ${n} OS · ticket ${Fmt.currency(val / n)}` : ''}</div>
                </div>
              `;
            }).join('')}
            ${ranking.length > 5 ? `<p class="text-muted mt-2" style="font-size:.78rem">+ ${ranking.length - 5} outros clientes</p>` : ''}
          `}
        </div>
      </div>

      <div class="card mb-4">
        <div class="card-header"><h3>😴 Sem serviço há tempo</h3></div>
        <div class="card-body">
          ${parados.length === 0 ? '<p class="text-muted" style="margin:0">Nenhum cliente parado há mais de 90 dias</p>' : `
            ${parados.slice(0, 6).map(p => rowCli(p.cid, `última OS ${haTempo(p.dias)}`,
              p.hist > 0 ? `<span style="font-size:.75rem;color:var(--text-muted)">${Fmt.currency(p.hist)} no histórico</span>` : ''
            )).join('')}
            ${parados.length > 6 ? `<p class="text-muted mt-2" style="font-size:.78rem">+ ${parados.length - 6} outros clientes</p>` : ''}
          `}
        </div>
      </div>
    `;
  }

  async function openDetail(id) {
    const c = allClientes.find(x => x.id === id);
    if (!c) return;

    const tipoBadgeFull = t => {
      if (t === 'cliente')    return '<span class="badge badge-info">Cliente</span>';
      if (t === 'fornecedor') return '<span class="badge badge-secondary">Fornecedor</span>';
      if (t === 'equipe')     return '<span class="badge badge-success">Equipe</span>';
      if (t === 'ambos')      return '<span class="badge badge-gold">Ambos</span>';
      return '<span class="badge badge-secondary">' + (t || '—') + '</span>';
    };

    const [osRes, parRes] = await Promise.all([
      API.db.read('os', null, { cliente_id: id }),
      API.db.read('parcelas', null, { cliente_id: id }),
    ]);
    const osList   = (osRes?.data || []).sort((a, b) => a.data_criacao > b.data_criacao ? -1 : 1);
    const allParc  = parRes?.data || [];
    const _origemFiado = o => o === 'fiado' || o === 'fiado_pago' || origemForaResultado(o);
    const isForn   = c.tipo === 'fornecedor';

    // ── Fornecedor: todos os lançamentos a pagar (sem filtro de origem) ──
    const fornPagar     = allParc.filter(p => p.tipo === 'pagar')
                                  .sort((a, b) => a.data_vencimento > b.data_vencimento ? -1 : 1);
    const valorComprado = fornPagar.reduce((s, p) => s + Number(p.valor||0), 0);
    const valorPago     = fornPagar.filter(p => p.status === 'pago').reduce((s, p) => s + Number(p.valor||0), 0);
    const valorAPagar   = fornPagar.filter(p => p.status === 'pendente').reduce((s, p) => s + Number(p.valor||0), 0);

    // ── Cliente: parcelas filtradas (sem fiado/transferência) ──
    const parcelas        = allParc.filter(p => !_origemFiado(p.origem))
                                    .sort((a, b) => a.data_vencimento > b.data_vencimento ? -1 : 1);
    const totalRec        = parcelas.filter(p => p.tipo === 'receber').reduce((s, p) => s + Number(p.valor||0), 0);
    const totalPag        = parcelas.filter(p => p.tipo === 'pagar').reduce((s, p) => s + Number(p.valor||0), 0);
    const totalRecebido   = parcelas.filter(p => p.tipo === 'receber' && p.status === 'pago').reduce((s, p) => s + Number(p.valor||0), 0);
    const saldoReceberPend= parcelas.filter(p => p.tipo === 'receber' && p.status !== 'pago' && p.status !== 'cancelado').reduce((s, p) => s + Number(p.valor||0), 0);
    const totalPagoForn   = parcelas.filter(p => p.tipo === 'pagar' && p.status === 'pago').reduce((s, p) => s + Number(p.valor||0), 0);
    const saldoPagarPend  = parcelas.filter(p => p.tipo === 'pagar' && p.status !== 'pago' && p.status !== 'cancelado').reduce((s, p) => s + Number(p.valor||0), 0);

    const section = qs('#page-clientes');
    section.innerHTML = `
      <div class="page-header">
        <button class="btn btn-outline btn-sm" onclick="Clientes.render()">← Voltar</button>
        <h1>${c.nome}</h1>
        <button class="btn btn-outline btn-sm" onclick="Clientes.openForm('${c.id}')">Editar</button>
      </div>

      <div class="grid-2col">
        <div class="card">
          <div class="card-header"><h3>Dados</h3></div>
          <div class="card-body info-grid">
            <div><label>Tipo</label>${tipoBadgeFull(c.tipo)}</div>
            <div><label>Telefone</label><span>${c.telefone || '—'}</span></div>
            <div class="full-width"><label>Endereço</label><span>${c.endereco || '—'}</span></div>
            ${c.observacoes ? `<div class="full-width"><label>Observações</label><span>${c.observacoes}</span></div>` : ''}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Financeiro</h3></div>
          <div class="card-body">
            ${isForn ? `
              ${fornPagar.length === 0 ? `
                <div class="entity-empty" style="padding:8px 0">Sem movimentações</div>
              ` : `
                <div class="stats-grid">
                  <div class="stat-card stat-blue">
                    <div class="stat-label">Total Comprado</div>
                    <div class="stat-value" style="font-size:1.05rem">${Fmt.currency(valorComprado)}</div>
                    <div class="stat-sub">${fornPagar.length} lançamento(s)</div>
                  </div>
                  <div class="stat-card stat-green">
                    <div class="stat-label">Total Pago</div>
                    <div class="stat-value" style="font-size:1.05rem">${Fmt.currency(valorPago)}</div>
                  </div>
                </div>
                <div class="stat-card ${valorAPagar > 0 ? 'stat-red' : 'stat-green'}" style="margin-top:8px">
                  <div class="stat-label">A Pagar</div>
                  <div class="stat-value" style="font-size:1.05rem">${Fmt.currency(valorAPagar)}</div>
                </div>
              `}
            ` : `
              ${totalRec > 0 ? `
              <div class="info-row"><span>Total Faturado</span><strong>${Fmt.currency(totalRec)}</strong></div>
              <div class="info-row"><span>Recebido</span><strong class="text-green">${Fmt.currency(totalRecebido)}</strong></div>
              <div class="info-row"><span>A Receber</span><strong class="${saldoReceberPend > 0 ? 'text-orange' : 'text-muted'}">${Fmt.currency(saldoReceberPend)}</strong></div>
              ` : ''}
              ${totalPag > 0 ? `
              <div class="info-row" style="${totalRec > 0 ? 'margin-top:8px;padding-top:8px;border-top:1px solid var(--border)' : ''}"><span>Total Compras</span><strong>${Fmt.currency(totalPag)}</strong></div>
              <div class="info-row"><span>Pago a Fornecedor</span><strong class="text-blue">${Fmt.currency(totalPagoForn)}</strong></div>
              <div class="info-row"><span>Saldo a Pagar</span><strong class="${saldoPagarPend > 0 ? 'text-red' : 'text-muted'}">${Fmt.currency(saldoPagarPend)}</strong></div>
              ` : ''}
              ${totalRec === 0 && totalPag === 0 ? `<div class="entity-empty" style="padding:8px 0">Sem movimentações</div>` : ''}
            `}
          </div>
        </div>
      </div>

      ${osList.length > 0 ? `
      <div class="card mt-4">
        <div class="card-header"><h3>Ordens de Serviço</h3></div>
        <div class="entity-list" style="border-radius:0;border:none;box-shadow:none">
          ${osList.map(o => `
            <div class="entity-item" onclick="App.navigate('os', {id:'${o.id}'})">
              <div class="avatar avatar-sm ${o.status === 'fechado' ? 'av-green' : o.status === 'andamento' ? 'av-blue' : 'av-orange'} avatar-icon">🔧</div>
              <div class="entity-info">
                <div class="entity-name">${o.numero}</div>
                <div class="entity-sub">${Fmt.date(o.data_inicio)}${o.data_fim ? ' → ' + Fmt.date(o.data_fim) : ''}</div>
                <div class="entity-badges">${tipoBadge(o.tipo)} ${statusBadge(o.status)}</div>
              </div>
              <div class="entity-right">
                ${o.valor_fechamento ? `<span class="entity-value">${Fmt.currency(o.valor_fechamento)}</span>` : ''}
                <span class="entity-chevron">›</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}

      <div class="card mt-4">
        <div class="card-header">
          <h3>${isForn ? 'Lançamentos' : 'Movimentações'}</h3>
          ${isForn && fornPagar.length > 0 ? `<span class="badge badge-secondary">${fornPagar.length}</span>` : ''}
        </div>
        <div class="entity-list" style="border-radius:0;border:none;box-shadow:none">
          ${(isForn ? fornPagar : parcelas).length === 0
            ? '<div class="entity-empty">Nenhuma movimentação</div>'
            : (isForn ? fornPagar : parcelas).map(p => `
              <div class="entity-item">
                <div class="avatar avatar-sm ${p.tipo==='receber'?'av-green':'av-red'} avatar-icon">${p.tipo==='receber'?'↓':'↑'}</div>
                <div class="entity-info">
                  <div class="entity-name">${p.descricao}</div>
                  <div class="entity-sub">Venc. ${Fmt.date(p.data_vencimento)}</div>
                </div>
                <div class="entity-right">
                  <span class="entity-value ${p.tipo==='receber'?'text-green':'text-red'}">${Fmt.currency(p.valor)}</span>
                  ${statusBadge(p.status)}
                </div>
              </div>
            `).join('')}
        </div>
      </div>

      <div class="mt-4 mb-4">
        <button class="btn btn-danger btn-full" onclick="Clientes.confirmDelete('${c.id}')">🗑 Inativar Cadastro</button>
      </div>
    `;
  }

  function openForm(id = null) {
    const c = id ? allClientes.find(x => x.id === id) : null;
    qs('#cli-form-id').value       = id || '';
    qs('#cli-form-nome').value     = c?.nome || '';
    qs('#cli-form-tipo').value     = c?.tipo || 'cliente';
    qs('#cli-form-tel').value      = c?.telefone || '';
    qs('#cli-form-end').value      = c?.endereco || '';
    qs('#cli-form-obs').value      = c?.observacoes || '';
    qs('#modal-cli-title').textContent = id ? 'Editar Cadastro' : 'Novo Cadastro';
    Modal.open('modal-cliente');
  }

  // trava de duplo clique (Guard) — o corpo real está em _saveForm
  function saveForm() { return Guard.run('cli-save', _saveForm); }
  async function _saveForm() {
    const id   = qs('#cli-form-id').value;
    const data = {
      nome:        qs('#cli-form-nome').value.trim(),
      tipo:        qs('#cli-form-tipo').value,
      telefone:    qs('#cli-form-tel').value.trim(),
      endereco:    qs('#cli-form-end').value.trim(),
      observacoes: qs('#cli-form-obs').value.trim(),
      ativo:       true,
    };
    if (!data.nome) { Toast.warning('Nome é obrigatório'); return; }
    if (!id) data.data_cadastro = DateUtil.today();

    Loading.show();
    const res = id ? await API.db.update('clientes', id, data) : await API.db.create('clientes', data);
    Loading.hide();

    if (res?.success) {
      Toast.success(id ? 'Atualizado!' : 'Cadastrado!');
      Modal.close('modal-cliente');
      await loadData();
      await App.loadGlobals();
      if (!id) await App.onQuickAddDone(res.data?.id);
      renderList();
    } else Toast.error('Erro: ' + res?.error);
  }

  async function confirmDelete(id) {
    Modal.confirm('Inativar este cadastro?', async () => {
      await API.db.update('clientes', id, { ativo: false });
      Toast.success('Inativado');
      await loadData();
      await App.loadGlobals();
      renderList();
    });
  }

  return { render, renderList, renderResumo, goView, applyFilters, openDetail, openForm, saveForm, confirmDelete };
})();
