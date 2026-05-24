// ============================================================
// INSIGHTS — Painel financeiro v2 (baseado no spec)
// ============================================================
//
// Mapeamento do spec saretta_financeiro_spec.md → estrutura atual:
//   "lancamento"        → parcelas (já existente)
//   "categoria"         → categorias (sheet existente, vinculada via categoria_id)
//   status pago/a_receber/atrasado → derivado de parcela.status + data_vencimento
//   horas_trabalhadas   → somatório das diárias linkadas à OS (origem='os')
//   regiao              → não implementado (precisa de parsing do endereço)
//   taxa de visita      → não implementado (requer marcação manual)
//
// Seções implementadas (Fase 1):
//   3.1 Visão Geral do Período
//   3.2 Análise por Categoria
//   3.3 Análise de Clientes (com alerta de concentração)
//   3.4 Inadimplência e Recebimento
//   3.8 Fluxo de Caixa Simplificado (semana a semana)
//   + Dicas do Negócio (mantido)

const Insights = (() => {
  // Defaults do spec — podem virar config editável depois
  const SPEC_DEFAULTS = {
    custoHoraBase:      90,
    diasUteisMes:       20,
    horasDia:           7.5,
    metaMargemPercent:  30,
    alertaConcentracao: 40,
  };

  // Período selecionado (default: mês atual)
  let _periodo = 'mes_atual';   // mes_atual | mes_anterior | ultimos_3m | ultimos_6m | ano
  let _cache   = null;          // { parcelas, osList, diarias }

  // ─── Helpers de período ─────────────────────────────────
  // Retorna { start, end, label } no formato YYYY-MM-DD
  function calcPeriodo(key) {
    const hoje = new Date();
    const y = hoje.getFullYear();
    const m = hoje.getMonth();   // 0-11

    function ymd(d) { return d.toISOString().substring(0, 10); }

    if (key === 'mes_atual') {
      return {
        start: ymd(new Date(y, m, 1)),
        end:   ymd(new Date(y, m + 1, 0)),
        label: hoje.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
      };
    }
    if (key === 'mes_anterior') {
      const d = new Date(y, m - 1, 1);
      return {
        start: ymd(d),
        end:   ymd(new Date(y, m, 0)),
        label: d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
      };
    }
    if (key === 'ultimos_3m') {
      return {
        start: ymd(new Date(y, m - 2, 1)),
        end:   ymd(new Date(y, m + 1, 0)),
        label: 'Últimos 3 meses',
      };
    }
    if (key === 'ultimos_6m') {
      return {
        start: ymd(new Date(y, m - 5, 1)),
        end:   ymd(new Date(y, m + 1, 0)),
        label: 'Últimos 6 meses',
      };
    }
    if (key === 'ano') {
      return {
        start: ymd(new Date(y, 0, 1)),
        end:   ymd(new Date(y, 11, 31)),
        label: `Ano ${y}`,
      };
    }
    return calcPeriodo('mes_atual');
  }

  // Parcela cai no período se data_competencia OR data_pagamento estiver no range
  function noPeriodo(p, periodo, campo = 'data_competencia') {
    const d = String(p[campo] || '').substring(0, 10);
    return d && d >= periodo.start && d <= periodo.end;
  }

  // ─── RENDER PRINCIPAL ───────────────────────────────────
  async function render() {
    const section = qs('#page-insights');
    section.innerHTML = `
      <div class="page-header"><h1>📊 Insights</h1></div>

      <!-- Seletor de período -->
      <div class="card mb-3" style="padding:6px">
        <div class="tab-bar" style="margin:0">
          <button class="tab-btn ${_periodo==='mes_atual'?'active':''}"    onclick="Insights.setPeriodo('mes_atual')">Mês atual</button>
          <button class="tab-btn ${_periodo==='mes_anterior'?'active':''}" onclick="Insights.setPeriodo('mes_anterior')">Mês ant.</button>
          <button class="tab-btn ${_periodo==='ultimos_3m'?'active':''}"   onclick="Insights.setPeriodo('ultimos_3m')">3 meses</button>
          <button class="tab-btn ${_periodo==='ultimos_6m'?'active':''}"   onclick="Insights.setPeriodo('ultimos_6m')">6 meses</button>
          <button class="tab-btn ${_periodo==='ano'?'active':''}"          onclick="Insights.setPeriodo('ano')">Ano</button>
        </div>
      </div>

      <div id="insights-content">
        <div class="loading-pulse p-4">Carregando dados...</div>
      </div>
    `;
    await loadInsights();
  }

  function setPeriodo(p) {
    _periodo = p;
    render();
  }

  async function loadInsights() {
    const shown = Loading.maybeShow('parcelas', 'os', 'diarias');
    const [parRes, osRes, diRes] = await Promise.all([
      API.db.read('parcelas'),
      API.db.read('os'),
      API.db.read('diarias'),
    ]);
    if (shown) Loading.hide();

    _cache = {
      parcelas: parRes?.data || [],
      osList:   osRes?.data  || [],
      diarias:  diRes?.data  || [],
    };

    const periodo = calcPeriodo(_periodo);

    // Pre-filtra parcelas pelo período (regime de competência)
    const parcelasPeriodo = _cache.parcelas.filter(p => noPeriodo(p, periodo));

    // Métricas básicas
    const receitas = parcelasPeriodo.filter(p => p.tipo === 'receber');
    const despesas = parcelasPeriodo.filter(p => p.tipo === 'pagar');
    const faturamento = sumValor(receitas);
    const totalDesp   = sumValor(despesas);
    const lucro       = faturamento - totalDesp;
    const margem      = faturamento > 0 ? (lucro / faturamento) * 100 : 0;

    // Horas trabalhadas no período (das diárias)
    const horasPeriodo = _cache.diarias.filter(d => {
      const data = String(d.data || '').substring(0, 10);
      return data >= periodo.start && data <= periodo.end;
    }).reduce((s, d) => s + Number(d.horas_totais || 0), 0);

    const custoHora   = horasPeriodo > 0 ? totalDesp / horasPeriodo : 0;
    const receitaHora = horasPeriodo > 0 ? faturamento / horasPeriodo : 0;

    // Top clientes no período (por receita)
    const porCliente = {};
    receitas.forEach(p => {
      const k = App.clienteNome(p.cliente_id) || 'Sem cliente';
      porCliente[k] = (porCliente[k] || 0) + Number(p.valor || 0);
    });
    const clientesRanked = Object.entries(porCliente).sort((a, b) => b[1] - a[1]);
    const top5Clientes   = clientesRanked.slice(0, 5);
    const concentracao   = clientesRanked[0] && faturamento > 0
      ? (clientesRanked[0][1] / faturamento) * 100 : 0;

    // Categorias de receita e despesa
    const porCategoriaRec = agruparPorCategoria(receitas);
    const porCategoriaDesp = agruparPorCategoria(despesas);

    // Inadimplência (pendentes + atrasados — todos, não só do período)
    const hojeStr = new Date().toISOString().substring(0, 10);
    const aReceber = _cache.parcelas.filter(p =>
      p.tipo === 'receber' && p.status === 'pendente'
    );
    const atrasados = aReceber.filter(p =>
      String(p.data_vencimento || '').substring(0, 10) < hojeStr
    );
    const totalReceber  = sumValor(aReceber);
    const totalAtrasado = sumValor(atrasados);

    // Prazo médio de recebimento (apenas das parcelas pagas no período)
    const recebidasNoPeriodo = receitas.filter(p => p.status === 'pago' && p.data_pagamento);
    const prazos = recebidasNoPeriodo.map(p => {
      const venc  = new Date(String(p.data_vencimento || '').substring(0,10));
      const pagto = new Date(String(p.data_pagamento  || '').substring(0,10));
      return (pagto - venc) / 86400000;
    }).filter(n => Number.isFinite(n));
    const prazoMedio = prazos.length > 0
      ? prazos.reduce((s, n) => s + n, 0) / prazos.length : null;

    // Fluxo de caixa por semana (apenas para mês atual)
    const semanas = _periodo === 'mes_atual' ? _calcSemanas(periodo, _cache.parcelas) : null;

    // Dicas
    const tips = buildTips({
      receitas, despesas, faturamento, totalDesp, margem, top5Clientes,
      concentracao, atrasados, horasPeriodo, custoHora,
    });

    qs('#insights-content').innerHTML = `
      <p class="text-muted mb-3" style="font-size:.82rem;margin-top:-4px">Período: <strong>${periodo.label}</strong></p>

      ${_renderDicas(tips)}
      ${_renderVisaoGeral({ faturamento, totalDesp, lucro, margem, horasPeriodo, custoHora, receitaHora })}
      ${_renderCategorias(porCategoriaRec, porCategoriaDesp)}
      ${_renderClientes(top5Clientes, concentracao, clientesRanked)}
      ${_renderInadimplencia({ totalReceber, totalAtrasado, atrasados, prazoMedio })}
      ${semanas ? _renderFluxoCaixa(semanas) : ''}
    `;
  }

  // ─── HELPERS ─────────────────────────────────────────────
  function sumValor(arr) { return arr.reduce((s, p) => s + Number(p.valor || 0), 0); }

  function agruparPorCategoria(parcelas) {
    const out = {};
    parcelas.forEach(p => {
      const k = App.categoriaNome(p.categoria_id) || 'Sem categoria';
      out[k] = (out[k] || 0) + Number(p.valor || 0);
    });
    return Object.entries(out).sort((a, b) => b[1] - a[1]);
  }

  function _calcSemanas(periodo, parcelas) {
    const start = new Date(periodo.start + 'T00:00:00');
    const end   = new Date(periodo.end + 'T23:59:59');
    const semanas = [];
    let s = new Date(start);
    while (s <= end) {
      const e = new Date(Math.min(s.getTime() + 6 * 86400000, end.getTime()));
      const sStr = s.toISOString().substring(0,10);
      const eStr = e.toISOString().substring(0,10);
      const ent = sumValor(parcelas.filter(p =>
        p.tipo === 'receber' && p.status === 'pago' &&
        String(p.data_pagamento || '').substring(0,10) >= sStr &&
        String(p.data_pagamento || '').substring(0,10) <= eStr
      ));
      const sai = sumValor(parcelas.filter(p =>
        p.tipo === 'pagar' && p.status === 'pago' &&
        String(p.data_pagamento || '').substring(0,10) >= sStr &&
        String(p.data_pagamento || '').substring(0,10) <= eStr
      ));
      semanas.push({
        label: `${s.getDate()}/${s.getMonth()+1}–${e.getDate()}/${e.getMonth()+1}`,
        entradas: ent, saidas: sai, saldo: ent - sai,
      });
      s = new Date(e.getTime() + 86400000);
    }
    return semanas;
  }

  // ─── RENDERERS ───────────────────────────────────────────
  function _renderDicas(tips) {
    return `
      <div class="card mb-4">
        <div class="card-header">
          <h3>💡 Dicas do Negócio</h3>
          <span class="badge badge-gold">${tips.length}</span>
        </div>
        <div class="card-body">
          ${tips.map(t => `
            <div class="tip-card tip-${t.type}">
              <span class="tip-icon">${t.icon}</span>
              <div class="tip-body">
                <div class="tip-title">${t.title}</div>
                <div class="tip-text">${t.text}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function _renderVisaoGeral({ faturamento, totalDesp, lucro, margem, horasPeriodo, custoHora, receitaHora }) {
    const margemClass = margem >= SPEC_DEFAULTS.metaMargemPercent ? 'stat-green'
                      : margem >= 20 ? 'stat-orange' : 'stat-red';
    return `
      <div class="card mb-4">
        <div class="card-header"><h3>📈 Visão Geral</h3></div>
        <div class="card-body">
          <div class="stats-grid">
            <div class="stat-card stat-green">
              <div class="stat-label">Faturamento</div>
              <div class="stat-value" style="font-size:1rem">${Fmt.currency(faturamento)}</div>
            </div>
            <div class="stat-card stat-red">
              <div class="stat-label">Despesas</div>
              <div class="stat-value" style="font-size:1rem">${Fmt.currency(totalDesp)}</div>
            </div>
            <div class="stat-card ${lucro >= 0 ? 'stat-blue' : 'stat-red'}">
              <div class="stat-label">Lucro</div>
              <div class="stat-value" style="font-size:1rem">${Fmt.currency(lucro)}</div>
            </div>
            <div class="stat-card ${margemClass}">
              <div class="stat-label">Margem</div>
              <div class="stat-value" style="font-size:1rem">${margem.toFixed(1)}%</div>
              <div class="stat-sub">meta: ${SPEC_DEFAULTS.metaMargemPercent}%</div>
            </div>
          </div>

          <div class="info-row mt-3">
            <span>Horas registradas:</span>
            <strong>${Fmt.hours(horasPeriodo)}</strong>
          </div>
          ${horasPeriodo > 0 ? `
            <div class="info-row">
              <span>Custo/hora real:</span>
              <strong>${Fmt.currency(custoHora)}/h</strong>
            </div>
            <div class="info-row">
              <span>Receita/hora:</span>
              <strong class="${receitaHora > custoHora ? 'text-green' : 'text-red'}">${Fmt.currency(receitaHora)}/h</strong>
            </div>
            <div class="info-row">
              <span style="font-size:.78rem;color:var(--text-muted)">Base de referência:</span>
              <span style="font-size:.78rem;color:var(--text-muted)">${Fmt.currency(SPEC_DEFAULTS.custoHoraBase)}/h</span>
            </div>
          ` : `
            <p class="text-muted mt-2" style="font-size:.82rem">Registre diárias para calcular custo/hora real.</p>
          `}
        </div>
      </div>
    `;
  }

  function _renderCategorias(porRec, porDesp) {
    const maxRec  = Math.max(...porRec.map(c  => c[1]), 1);
    const maxDesp = Math.max(...porDesp.map(c => c[1]), 1);
    // Layout vertical (bar-row-v): label em cima, barra fina embaixo
    // Resolve o problema de label longo (ex: "Material/Estoque") cortando ou sobrepondo barra
    const linha = (nome, val, max, cor) => `
      <div class="bar-row-v">
        <div class="bar-head">
          <span class="bar-name">${nome}</span>
          <span class="bar-val">${Fmt.currency(val)}</span>
        </div>
        <div class="bar-track">
          <div class="bar ${cor}" style="width:${(val/max*100).toFixed(0)}%"></div>
        </div>
      </div>
    `;
    return `
      <div class="grid-2col mb-4">
        <div class="card">
          <div class="card-header"><h3>🟢 Receitas por Categoria</h3></div>
          <div class="card-body">
            ${porRec.length === 0 ? '<p class="text-muted">Sem receitas no período</p>' :
              porRec.map(([nome, val]) => linha(nome, val, maxRec, 'bar-green')).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>🔴 Despesas por Categoria</h3></div>
          <div class="card-body">
            ${porDesp.length === 0 ? '<p class="text-muted">Sem despesas no período</p>' :
              porDesp.map(([nome, val]) => linha(nome, val, maxDesp, 'bar-red')).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function _renderClientes(top5, concentracao, todos) {
    const alerta = concentracao > SPEC_DEFAULTS.alertaConcentracao;
    return `
      <div class="card mb-4">
        <div class="card-header">
          <h3>👥 Análise de Clientes</h3>
          ${alerta ? `<span class="badge badge-orange">⚠ Concentração ${concentracao.toFixed(0)}%</span>` : ''}
        </div>
        <div class="card-body">
          ${top5.length === 0 ? '<p class="text-muted">Sem receitas no período</p>' : `
            ${alerta ? `
              <div class="tip-card tip-warning" style="margin-bottom:14px">
                <span class="tip-icon">🎯</span>
                <div class="tip-body">
                  <div class="tip-title">Risco de Dependência</div>
                  <div class="tip-text">"${top5[0][0]}" representa ${concentracao.toFixed(0)}% da receita do período. Acima de ${SPEC_DEFAULTS.alertaConcentracao}% é alerta — diversifique a carteira.</div>
                </div>
              </div>
            ` : ''}
            ${top5.map(([nome, val], i) => {
              const pct = (val / sumArrSecond(todos)) * 100;
              return `
                <div class="info-row">
                  <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1">
                    <span style="width:22px;height:22px;border-radius:50%;background:var(--navy);color:#fff;font-size:.7rem;font-weight:800;display:flex;align-items:center;justify-content:center;flex:0 0 auto">${i+1}</span>
                    <span style="font-size:.875rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${nome}</span>
                  </div>
                  <div style="text-align:right;flex:0 0 auto">
                    <strong class="text-green">${Fmt.currency(val)}</strong>
                    <div style="font-size:.7rem;color:var(--text-muted)">${pct.toFixed(0)}%</div>
                  </div>
                </div>
              `;
            }).join('')}
            ${todos.length > 5 ? `
              <p class="text-muted mt-2" style="font-size:.78rem">+ ${todos.length - 5} outros clientes</p>
            ` : ''}
          `}
        </div>
      </div>
    `;
  }

  function _renderInadimplencia({ totalReceber, totalAtrasado, atrasados, prazoMedio }) {
    return `
      <div class="card mb-4">
        <div class="card-header"><h3>⏰ Inadimplência e Recebimento</h3></div>
        <div class="card-body">
          <div class="stats-grid">
            <div class="stat-card stat-orange">
              <div class="stat-label">A Receber</div>
              <div class="stat-value" style="font-size:1rem">${Fmt.currency(totalReceber)}</div>
            </div>
            <div class="stat-card stat-red">
              <div class="stat-label">Atrasado</div>
              <div class="stat-value" style="font-size:1rem">${Fmt.currency(totalAtrasado)}</div>
              <div class="stat-sub">${atrasados.length} conta(s)</div>
            </div>
          </div>
          ${prazoMedio !== null ? `
            <div class="info-row mt-3">
              <span>Prazo médio de recebimento:</span>
              <strong class="${prazoMedio <= 0 ? 'text-green' : 'text-orange'}">${prazoMedio.toFixed(0)} dia(s) ${prazoMedio < 0 ? 'antes' : 'após'} venc.</strong>
            </div>
          ` : ''}
          ${atrasados.length > 0 ? `
            <div style="margin-top:14px">
              <div style="font-size:.78rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:6px">Contas atrasadas</div>
              ${atrasados.slice(0, 5).map(p => {
                const venc = new Date(String(p.data_vencimento).substring(0,10));
                const diasAtraso = Math.floor((Date.now() - venc.getTime()) / 86400000);
                return `
                  <div class="info-row">
                    <div style="min-width:0;flex:1">
                      <div style="font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.descricao}</div>
                      <div style="font-size:.7rem;color:var(--text-muted)">${App.clienteNome(p.cliente_id)} · venceu há ${diasAtraso} dia(s)</div>
                    </div>
                    <strong class="text-red" style="flex:0 0 auto">${Fmt.currency(p.valor)}</strong>
                  </div>
                `;
              }).join('')}
              ${atrasados.length > 5 ? `<p class="text-muted mt-1" style="font-size:.78rem">+ ${atrasados.length - 5} outra(s)</p>` : ''}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  function _renderFluxoCaixa(semanas) {
    const max = Math.max(...semanas.flatMap(s => [s.entradas, s.saidas]), 1);
    return `
      <div class="card mb-4">
        <div class="card-header"><h3>💸 Fluxo de Caixa (semanas do mês)</h3></div>
        <div class="card-body">
          ${semanas.map(s => `
            <div style="margin-bottom:16px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <strong style="font-size:.85rem">${s.label}</strong>
                <strong class="${s.saldo >= 0 ? 'text-green' : 'text-red'}">${Fmt.currency(s.saldo)}</strong>
              </div>
              <div class="bar-row-v" style="margin-bottom:4px">
                <div class="bar-head">
                  <span class="bar-name" style="font-size:.72rem;color:var(--text-muted)">↓ Entradas</span>
                  <span class="bar-val" style="font-size:.72rem">${Fmt.currency(s.entradas)}</span>
                </div>
                <div class="bar-track">
                  <div class="bar bar-green" style="width:${(s.entradas/max*100).toFixed(0)}%"></div>
                </div>
              </div>
              <div class="bar-row-v">
                <div class="bar-head">
                  <span class="bar-name" style="font-size:.72rem;color:var(--text-muted)">↑ Saídas</span>
                  <span class="bar-val" style="font-size:.72rem">${Fmt.currency(s.saidas)}</span>
                </div>
                <div class="bar-track">
                  <div class="bar bar-red" style="width:${(s.saidas/max*100).toFixed(0)}%"></div>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function sumArrSecond(entries) {
    return entries.reduce((s, [, v]) => s + v, 0) || 1;
  }

  // ─── DICAS (mantém + adapta para período selecionado) ────
  function buildTips({ receitas, despesas, faturamento, totalDesp, margem, top5Clientes, concentracao, atrasados, horasPeriodo, custoHora }) {
    const tips = [];

    if (faturamento === 0 && totalDesp === 0) {
      tips.push({ icon: '💡', type: 'navy', title: 'Sem dados', text: 'Não há lançamentos neste período. Registre receitas e despesas para começar a ver insights.' });
      return tips;
    }

    // Margem
    if (margem < 20 && faturamento > 0) {
      tips.push({ icon: '⚠️', type: 'danger', title: 'Margem Crítica', text: `Margem em ${margem.toFixed(0)}% — abaixo do mínimo seguro. Revise as despesas ou aumente o ticket.` });
    } else if (margem >= SPEC_DEFAULTS.metaMargemPercent) {
      tips.push({ icon: '💪', type: 'success', title: 'Margem Saudável', text: `Margem de ${margem.toFixed(0)}% acima da meta (${SPEC_DEFAULTS.metaMargemPercent}%). Excelente!` });
    }

    // Concentração
    if (concentracao > SPEC_DEFAULTS.alertaConcentracao && top5Clientes.length > 0) {
      tips.push({ icon: '🎯', type: 'warning', title: 'Alta Concentração', text: `"${top5Clientes[0][0]}" = ${concentracao.toFixed(0)}% do faturamento. Diversifique a carteira para reduzir risco.` });
    }

    // Inadimplência
    if (atrasados.length > 0) {
      const total = atrasados.reduce((s, p) => s + Number(p.valor || 0), 0);
      tips.push({ icon: '⏰', type: 'danger', title: `${atrasados.length} Conta(s) Atrasada(s)`, text: `${Fmt.currency(total)} em recebíveis vencidos. Priorize a cobrança.` });
    }

    // Custo/hora vs base de referência
    if (horasPeriodo > 0 && custoHora > SPEC_DEFAULTS.custoHoraBase * 1.2) {
      tips.push({ icon: '📊', type: 'warning', title: 'Custo Operacional Alto', text: `Custo/hora real (${Fmt.currency(custoHora)}) está ${((custoHora/SPEC_DEFAULTS.custoHoraBase-1)*100).toFixed(0)}% acima da base de referência (${Fmt.currency(SPEC_DEFAULTS.custoHoraBase)}).` });
    }

    if (tips.length === 0) {
      tips.push({ icon: '✅', type: 'success', title: 'Tudo em ordem', text: 'Nenhum alerta crítico para o período selecionado. Continue assim.' });
    }

    return tips;
  }

  return { render, setPeriodo };
})();
