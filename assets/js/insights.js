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
  let _periodo  = 'mes_atual';   // mes_atual | mes_anterior | ultimos_3m | ultimos_6m | ano
  let _regime   = 'competencia'; // competencia | caixa — controla faturamento/lucro/margem
  let _megaModo = 'realizado';   // realizado | previsao — narrativa do resumo inteligente
  let _cache    = null;          // { parcelas, osList, diarias }

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

  // Parcela cai no período conforme o REGIME:
  //   - competência: usa data_competencia (mostra tudo lançado, independente de pago)
  //   - caixa:       usa data_pagamento + exige status='pago' (só o que entrou/saiu de fato)
  function noPeriodo(p, periodo, regime = _regime) {
    if (regime === 'caixa') {
      if (p.status !== 'pago') return false;
      const d = String(p.data_pagamento || '').substring(0, 10);
      return d && d >= periodo.start && d <= periodo.end;
    }
    // competência (default)
    const d = String(p.data_competencia || '').substring(0, 10);
    return d && d >= periodo.start && d <= periodo.end;
  }

  // Período imediatamente anterior, de mesma duração (para comparar)
  function calcPeriodoAnterior(key) {
    const hoje = new Date(); const y = hoje.getFullYear(); const m = hoje.getMonth();
    const ymd = d => d.toISOString().substring(0, 10);
    if (key === 'mes_anterior') return { start: ymd(new Date(y, m-2, 1)), end: ymd(new Date(y, m-1, 0)) };
    if (key === 'ultimos_3m')   return { start: ymd(new Date(y, m-5, 1)), end: ymd(new Date(y, m-2, 0)) };
    if (key === 'ultimos_6m')   return { start: ymd(new Date(y, m-11, 1)), end: ymd(new Date(y, m-5, 0)) };
    if (key === 'ano')          return { start: ymd(new Date(y-1, 0, 1)), end: ymd(new Date(y-1, 11, 31)) };
    return { start: ymd(new Date(y, m-1, 1)), end: ymd(new Date(y, m, 0)) }; // mes_atual → mês anterior
  }

  // Horas trabalhadas no período, separadas por tipo de OS (diária × normal).
  // Fonte de verdade: as SESSÕES (diárias), atribuídas ao mês de CADA sessão pela
  // sua data. Isso separa corretamente OS com sessões em meses diferentes, mesmo
  // que a OS ainda não tenha sido fechada/recebida. As horas_calculadas da OS só
  // entram como legado, para OS normais antigas que NÃO têm sessão registrada
  // (antes da calculadora virar sessões) — evita dupla contagem.
  function _horasBreakdown(periodo) {
    const tipoDe = {};
    _cache.osList.forEach(o => { tipoDe[o.id] = o.tipo; });
    const osComSessao = new Set(_cache.diarias.map(d => d.os_id));

    let hDiaria = 0, hNormal = 0, valorSessoes = 0;
    _cache.diarias.forEach(d => {
      const data = String(d.data || '').substring(0, 10);
      if (data < periodo.start || data > periodo.end) return;
      const h = Number(d.horas_totais || 0);
      if (tipoDe[d.os_id] === 'diaria') hDiaria += h; else hNormal += h;
      // valor da mão de obra da sessão — acompanha as horas mês a mês
      valorSessoes += Number(d.valor_manual || d.valor_calculado || 0);
    });

    _cache.osList.forEach(o => {
      if (o.tipo !== 'normal' || osComSessao.has(o.id)) return; // já contado via sessões
      const ref = String(o.data_atualizacao || o.data_inicio || '').substring(0, 10);
      if (ref < periodo.start || ref > periodo.end) return;
      hNormal += Number(o.horas_calculadas || 0);
      valorSessoes += Number(o.valor_calculado || 0);
    });

    return { hDiaria, hNormal, total: hDiaria + hNormal, valorSessoes };
  }

  function _horasNoPeriodo(periodo) { return _horasBreakdown(periodo).total; }

  // Nº de meses-calendário cobertos pelo período (para escalar o custo fixo)
  function _mesesNoPeriodo(periodo) {
    const s = new Date(periodo.start + 'T00:00:00');
    const e = new Date(periodo.end + 'T00:00:00');
    return Math.max(1, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1);
  }

  // Custeio por absorção: dilui o custo fixo mensal pela CAPACIDADE NORMAL (dias
  // úteis do calendário), não pelos dias realmente trabalhados — assim o custo/dia
  // fica estável e o efeito do clima vira "ociosidade" (dias úteis não trabalhados).
  function _custeioNoPeriodo(periodo, custoFixoMensal) {
    const nMeses        = _mesesNoPeriodo(periodo);
    const custoFixoTot  = custoFixoMensal * nMeses;
    const diasUteis     = DateUtil.businessDays(periodo.start, periodo.end);
    const custoDia      = diasUteis > 0 ? custoFixoTot / diasUteis : 0;
    // Dias distintos com sessão registrada no período
    const diasTrab = new Set(
      _cache.diarias
        .map(d => String(d.data || '').substring(0, 10))
        .filter(data => data >= periodo.start && data <= periodo.end)
    ).size;
    const custoAbsorvido = diasTrab * custoDia;
    const ociosidade     = Math.max(0, custoFixoTot - custoAbsorvido);
    return { nMeses, custoFixoTot, diasUteis, custoDia, diasTrab, custoAbsorvido, ociosidade };
  }

  function _osFechadasNoPeriodo(periodo) {
    return _cache.osList.filter(o => {
      if (o.status !== 'fechado') return false;
      const ref = String(o.data_atualizacao || o.data_fim || o.data_inicio || '').substring(0, 10);
      return ref >= periodo.start && ref <= periodo.end;
    });
  }

  // Snapshot de métricas de um período — base da comparação do mega insight
  function _calcSnapshot(periodo) {
    const parc = _cache.parcelas.filter(p => noPeriodo(p, periodo));
    const receitas = parc.filter(p => p.tipo === 'receber');
    const despesas = parc.filter(p => p.tipo === 'pagar');
    const faturamento = sumValor(receitas);
    const totalDesp   = sumValor(despesas);
    const hb = _horasBreakdown(periodo);
    const horas = hb.total;
    const osFech = _osFechadasNoPeriodo(periodo);
    const valorOS = osFech.reduce((s, o) => s + Number(o.valor_fechamento || o.valor_calculado || 0), 0);
    return {
      faturamento, totalDesp, lucro: faturamento - totalDesp, horas,
      nOS: osFech.length,
      ticket: osFech.length > 0 ? valorOS / osFech.length : 0,
      // valor/hora baseado no valor das SESSÕES do período (acompanha as horas mês
      // a mês) — evita o R$/h inflado quando o faturamento da OS cai todo no mês do
      // fechamento mas as horas estão espalhadas em meses anteriores.
      receitaHora: horas > 0 ? hb.valorSessoes / horas : 0,
      despPorCat: Object.fromEntries(agruparPorCategoria(despesas)),
      recPorCat:  Object.fromEntries(agruparPorCategoria(receitas)),
    };
  }

  // Snapshot na ótica da PREVISÃO — mesma forma de _calcSnapshot, mas a receita
  // considera SÓ o que entrou de fato (parcelas recebidas/pagas) + a receita
  // prevista das OS em andamento (passada por fora). Ignora deliberadamente as
  // parcelas a receber ainda pendentes (ex.: OS fechada que o cliente não pagou).
  function _calcSnapshotProjetado(periodo, receitaPrevista = 0) {
    const recebidas = _cache.parcelas.filter(p =>
      p.tipo === 'receber' && p.status === 'pago' &&
      String(p.data_competencia || '').substring(0, 10) >= periodo.start &&
      String(p.data_competencia || '').substring(0, 10) <= periodo.end
    );
    const despesas = _cache.parcelas.filter(p => p.tipo === 'pagar' && noPeriodo(p, periodo));
    const recebido    = sumValor(recebidas);
    const faturamento = recebido + receitaPrevista;
    const totalDesp   = sumValor(despesas);
    const horas       = _horasNoPeriodo(periodo);
    const osFech      = _osFechadasNoPeriodo(periodo);
    const valorOS     = osFech.reduce((s, o) => s + Number(o.valor_fechamento || o.valor_calculado || 0), 0);
    return {
      faturamento, totalDesp, lucro: faturamento - totalDesp, horas, recebido,
      nOS: osFech.length,
      ticket: osFech.length > 0 ? valorOS / osFech.length : 0,
      receitaHora: horas > 0 ? faturamento / horas : 0,
      despPorCat: Object.fromEntries(agruparPorCategoria(despesas)),
      recPorCat:  Object.fromEntries(agruparPorCategoria(recebidas)),
    };
  }

  // ─── MEGA INSIGHT — narrativa comparando atual × anterior ────
  function _pct(cur, prev) { return prev > 0 ? ((cur - prev) / prev * 100) : (cur > 0 ? 100 : 0); }
  function _sinalPct(cur, prev) {
    if (prev <= 0) return cur > 0 ? 'novo' : '—';
    const p = _pct(cur, prev);
    return (p >= 0 ? '+' : '−') + Math.abs(p).toFixed(0) + '%';
  }
  function _hf(h) { const v = Math.abs(h); const hh = Math.floor(v); const mm = Math.round((v - hh) * 60); return mm ? `${hh}h${String(mm).padStart(2,'0')}` : `${hh}h`; }

  function buildMegaInsight(a, b) {
    const semBase = !(b.faturamento || b.totalDesp || b.horas);
    let resumo;
    if (semBase) {
      resumo = { tone: 'navy', texto: 'Ainda não tenho um período anterior pra comparar. A partir do próximo, eu te mostro aqui o que mudou e por quê. 📊' };
    } else {
      const dl = a.lucro - b.lucro;
      const lucroPct   = _sinalPct(a.lucro, b.lucro);
      const horasCaiu  = a.horas > 0 && a.horas < b.horas * 0.95;
      const horasSubiu = a.horas > b.horas * 1.05;
      const recHoraSubiu = a.receitaHora > b.receitaHora * 1.03;
      if (dl >= 0) {
        if (horasCaiu && recHoraSubiu) {
          resumo = { tone: 'green', texto: `Mês mais eficiente 💪 Você trabalhou ${_hf(b.horas - a.horas)} a menos e ainda assim sobrou mais (lucro ${lucroPct}). Cada hora rendeu ${Fmt.currency(a.receitaHora)} — melhor que o período anterior.` };
        } else if (a.faturamento > b.faturamento && (a.faturamento - b.faturamento) >= Math.abs(a.totalDesp - b.totalDesp)) {
          resumo = { tone: 'green', texto: `Você faturou mais (${_sinalPct(a.faturamento, b.faturamento)}) e o lucro acompanhou (${lucroPct}). Bom ritmo!` };
        } else if (a.totalDesp < b.totalDesp) {
          resumo = { tone: 'green', texto: `Você segurou os gastos (${_sinalPct(a.totalDesp, b.totalDesp)} em despesas) e o lucro melhorou (${lucroPct}), mesmo faturando parecido.` };
        } else {
          resumo = { tone: 'green', texto: `O lucro do período melhorou (${lucroPct}) em relação ao anterior.` };
        }
      } else {
        if (horasSubiu && a.lucro < b.lucro) {
          resumo = { tone: 'red', texto: `Atenção: você trabalhou mais (${_hf(a.horas - b.horas)} a mais) mas sobrou menos (lucro ${lucroPct}). Vale revisar preço e custos.` };
        } else if (a.faturamento < b.faturamento) {
          resumo = { tone: 'red', texto: `Faturou menos (${_sinalPct(a.faturamento, b.faturamento)}) e o lucro recuou (${lucroPct}).` };
        } else if (a.totalDesp > b.totalDesp) {
          resumo = { tone: 'red', texto: `Os gastos subiram (${_sinalPct(a.totalDesp, b.totalDesp)}) e comeram parte do lucro (${lucroPct}).` };
        } else {
          resumo = { tone: 'orange', texto: `O lucro recuou (${lucroPct}) frente ao período anterior.` };
        }
      }
    }

    // Achados secundários, ordenados por relevância (magnitude)
    const achados = [];
    if (!semBase) {
      // Ticket médio
      if (a.nOS > 0 && b.nOS > 0) {
        const tp = _pct(a.ticket, b.ticket);
        if (Math.abs(tp) >= 5) achados.push({ prio: Math.abs(tp), icon: tp >= 0 ? '🎟️' : '🎟️', tone: tp >= 0 ? 'green' : 'orange',
          text: `Ticket médio por OS: <strong>${Fmt.currency(a.ticket)}</strong> (${_sinalPct(a.ticket, b.ticket)} vs período anterior).` });
      }
      // Maior variação de despesa por categoria
      const cats = new Set([...Object.keys(a.despPorCat), ...Object.keys(b.despPorCat)]);
      let maiorVar = null;
      cats.forEach(c => {
        const va = a.despPorCat[c] || 0, vb = b.despPorCat[c] || 0;
        const delta = va - vb;
        if (Math.abs(delta) >= 50 && Math.abs(delta) > Math.abs(maiorVar?.delta || 0)) maiorVar = { c, va, vb, delta };
      });
      if (maiorVar) {
        const subiu = maiorVar.delta > 0;
        achados.push({ prio: Math.abs(maiorVar.delta), icon: subiu ? '🔺' : '🔻', tone: subiu ? 'red' : 'green',
          text: `${subiu ? 'Aumentou' : 'Reduziu'} os gastos com <strong>${maiorVar.c}</strong> em ${Fmt.currency(Math.abs(maiorVar.delta))}${maiorVar.vb > 0 ? ` (${_sinalPct(maiorVar.va, maiorVar.vb)})` : ''}.` });
      }
      // Receita/hora (se não destacada no resumo)
      if (b.receitaHora > 0 && Math.abs(_pct(a.receitaHora, b.receitaHora)) >= 8) {
        const rp = _pct(a.receitaHora, b.receitaHora);
        achados.push({ prio: Math.abs(rp) - 1, icon: '⚡', tone: rp >= 0 ? 'green' : 'orange',
          text: `Cada hora trabalhada rendeu <strong>${Fmt.currency(a.receitaHora)}</strong> (${_sinalPct(a.receitaHora, b.receitaHora)}).` });
      }
      // Volume de OS
      if (a.nOS !== b.nOS && (a.nOS || b.nOS)) {
        achados.push({ prio: 4, icon: '🔧', tone: 'navy',
          text: `Você fechou <strong>${a.nOS} OS</strong> no período (${b.nOS} no anterior).` });
      }
    }
    achados.sort((x, y) => y.prio - x.prio);
    return { resumo, achados: achados.slice(0, 4) };
  }

  // Resumo no modo PREVISÃO: usa o MESMO motor do resumo normal (buildMegaInsight),
  // mas alimentado por snapshots projetados (recebido + OS em andamento). Assim a
  // narrativa considera gastos, horas, eficiência e ticket — igual ao resumo normal,
  // só que com a base de previsão. No topo, mostra a composição recebido/andamento.
  function buildMegaInsightPrevisao(a, b, recebido, receitaPrevista, nOSAbertas) {
    const total = recebido + receitaPrevista;
    const composicao = [
      { icon: '✅', tone: 'green', text: `Já recebido: <strong>${Fmt.currency(recebido)}</strong>` },
      { icon: '🔮', tone: 'navy',  text: `Em andamento: <strong>${Fmt.currency(receitaPrevista)}</strong> em ${nOSAbertas} OS` },
      { icon: '🎯', tone: 'navy',  text: `Total projetado: <strong>${Fmt.currency(total)}</strong>` },
    ];

    const temBase = b.faturamento > 0 || b.totalDesp > 0 || b.horas > 0;
    let base;
    if (!temBase) {
      // Sem período anterior pra comparar — narrativa própria, ainda considerando gastos e horas
      const tone = a.lucro >= 0 ? 'green' : 'red';
      const horaTxt = a.horas > 0 ? ` em ${_hf(a.horas)} de trabalho (${Fmt.currency(a.receitaHora)}/h)` : '';
      const texto = `Somando o que já recebeu com as OS em andamento, o período deve fechar em `
        + `<strong>${Fmt.currency(total)}</strong>. Descontando <strong>${Fmt.currency(a.totalDesp)}</strong> de gastos, `
        + `o lucro projetado é <strong>${Fmt.currency(a.lucro)}</strong>${horaTxt}.`;
      base = { resumo: { tone, texto }, achados: [] };
    } else {
      base = buildMegaInsight(a, b);
      base.resumo = { tone: base.resumo.tone, texto: '🔮 <strong>Projeção:</strong> ' + base.resumo.texto };
    }
    return { resumo: base.resumo, achados: [...composicao, ...base.achados].slice(0, 6) };
  }

  // Evolução mês a mês (últimos N meses) — reaproveita o snapshot por mês
  function _calcEvolucao(nMeses) {
    const hoje = new Date(); const y = hoje.getFullYear(); const m = hoje.getMonth();
    const ymd = d => d.toISOString().substring(0, 10);
    const out = [];
    for (let i = nMeses - 1; i >= 0; i--) {
      const ini = new Date(y, m - i, 1);
      const periodo = { start: ymd(ini), end: ymd(new Date(y, m - i + 1, 0)) };
      const s = _calcSnapshot(periodo);
      out.push({
        label: ini.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
        receita: s.faturamento, despesa: s.totalDesp, lucro: s.lucro, horas: s.horas,
      });
    }
    return out;
  }

  // ─── RENDER PRINCIPAL ───────────────────────────────────
  async function render() {
    const section = qs('#page-insights');
    section.innerHTML = `
      <div class="page-header"><h1>📊 Insights</h1></div>

      <!-- Seletor de período -->
      <div class="card mb-2" style="padding:6px">
        <div class="tab-bar" style="margin:0">
          <button class="tab-btn ${_periodo==='mes_atual'?'active':''}"    onclick="Insights.setPeriodo('mes_atual')">Mês atual</button>
          <button class="tab-btn ${_periodo==='mes_anterior'?'active':''}" onclick="Insights.setPeriodo('mes_anterior')">Mês ant.</button>
          <button class="tab-btn ${_periodo==='ultimos_3m'?'active':''}"   onclick="Insights.setPeriodo('ultimos_3m')">3 meses</button>
          <button class="tab-btn ${_periodo==='ultimos_6m'?'active':''}"   onclick="Insights.setPeriodo('ultimos_6m')">6 meses</button>
          <button class="tab-btn ${_periodo==='ano'?'active':''}"          onclick="Insights.setPeriodo('ano')">Ano</button>
        </div>
      </div>

      <!-- Toggle Competência / Caixa -->
      <div class="card mb-3" style="padding:6px">
        <div class="tab-bar" style="margin:0">
          <button class="tab-btn ${_regime==='competencia'?'active':''}" onclick="Insights.setRegime('competencia')"
            title="Conta tudo que foi lançado no período, independente de pago">
            📑 Competência
          </button>
          <button class="tab-btn ${_regime==='caixa'?'active':''}" onclick="Insights.setRegime('caixa')"
            title="Conta só o que foi pago/recebido de fato">
            💵 Caixa
          </button>
        </div>
      </div>

      <div id="insights-content">
        <div class="loading-pulse p-4">Carregando dados...</div>
      </div>
    `;
    await loadInsights();
  }

  function setPeriodo(p) { _periodo = p; render(); }
  function setRegime(r)  { _regime  = r; render(); }
  // Alterna a narrativa do resumo: realizado vs. projeção com receita prevista.
  // Re-renderiza só os insights (dados já em cache, sem novos requests).
  function setMegaModo(m) { _megaModo = m; loadInsights(); }

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

    // Custo fixo mensal (config) — base do custeio por absorção
    const _cfg = await Calculator.getConfig();
    const custoFixoMensal = Number(_cfg.custo_fixo_mensal) || 0;

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

    // Horas trabalhadas no período:
    //   Fonte: sessões (diárias) atribuídas ao mês de cada sessão, separadas por
    //   tipo de OS. horas_calculadas só entra p/ OS normais legadas sem sessão.
    const _hb = _horasBreakdown(periodo);
    const horasDiarias  = _hb.hDiaria;
    const horasOSNormal = _hb.hNormal;
    const horasPeriodo  = _hb.total;
    const custoHora    = horasPeriodo > 0 ? totalDesp        / horasPeriodo : 0;
    // valor/hora pelo valor das SESSÕES do período (acompanha as horas mês a mês)
    const receitaHora  = horasPeriodo > 0 ? _hb.valorSessoes / horasPeriodo : 0;

    // Top clientes no período (por receita) — ignora lançamentos sem cliente identificado
    const porCliente = {};
    receitas.forEach(p => {
      const k = App.clienteNome(p.cliente_id);
      if (!k || k === '—') return;
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

    const regimeLabel = _regime === 'caixa' ? 'regime de Caixa' : 'regime de Competência';
    // Snapshots para o resumo: período atual × anterior de mesma duração
    const snapAtual = _calcSnapshot(periodo);
    const snapAnt   = _calcSnapshot(calcPeriodoAnterior(_periodo));
    const evol      = _calcEvolucao(6);

    // Receita prevista: soma das sessões registradas de OS abertas (andamento / acerto)
    const osAbertasIds = new Set(
      _cache.osList.filter(o => o.status === 'andamento' || o.status === 'acerto').map(o => o.id)
    );
    const sessoesAbertas = _cache.diarias.filter(d => osAbertasIds.has(d.os_id));
    const receitaPrevista = sessoesAbertas.reduce((s, d) => s + Number(d.valor_manual || d.valor_calculado || 0), 0);
    const nOSAbertas = osAbertasIds.size;
    const nSessoesAbertas = sessoesAbertas.length;

    // OS fechadas e ainda NÃO recebidas — parcelas geradas no fechamento (origem='os')
    // que continuam pendentes. Mostrado como item do resumo (não recebido × valor).
    const aReceberOS = _cache.parcelas.filter(p =>
      p.origem === 'os' && p.tipo === 'receber' && p.status === 'pendente'
    );
    const naoRecebidoValor = sumValor(aReceberOS);
    const naoRecebidoQtd   = new Set(aReceberOS.map(p => p.origem_id).filter(Boolean)).size || aReceberOS.length;

    // Sem OS abertas não há previsão → força modo realizado e esconde o toggle
    const temPrevisao = nOSAbertas > 0 && receitaPrevista > 0;
    const modo = temPrevisao ? _megaModo : 'realizado';
    let mega;
    if (modo === 'previsao') {
      // Base de previsão: recebido + OS em andamento; anterior usa só o recebido
      const snapProjAtual = _calcSnapshotProjetado(periodo, receitaPrevista);
      const snapProjAnt   = _calcSnapshotProjetado(calcPeriodoAnterior(_periodo), 0);
      mega = buildMegaInsightPrevisao(snapProjAtual, snapProjAnt, snapProjAtual.recebido, receitaPrevista, nOSAbertas);
    } else {
      mega = buildMegaInsight(snapAtual, snapAnt);
    }

    // Custeio por absorção (custo fixo diluído por dias úteis) — só se configurado
    const custeio = custoFixoMensal > 0 ? _custeioNoPeriodo(periodo, custoFixoMensal) : null;

    qs('#insights-content').innerHTML = `
      <p class="text-muted mb-3" style="font-size:.82rem;margin-top:-4px">
        ${periodo.label} · <strong>${regimeLabel}</strong>
      </p>

      ${_renderMegaInsight(mega, receitaPrevista, modo, temPrevisao, { naoRecebidoValor, naoRecebidoQtd })}
      ${_renderEvolucao(evol)}
      ${_renderReceitaPrevista({ receitaPrevista, faturamento, nOSAbertas, nSessoesAbertas })}
      ${custeio ? _renderCusteio(custeio, faturamento) : ''}
      ${_renderVisaoGeral({ faturamento, totalDesp, lucro, margem, horasPeriodo, horasDiarias, horasOSNormal, custoHora, receitaHora })}
      ${_renderCategorias(porCategoriaRec, porCategoriaDesp)}
      ${_renderClientes(top5Clientes, concentracao, clientesRanked)}
      ${_renderInadimplencia({ totalReceber, totalAtrasado, atrasados, prazoMedio })}
      ${semanas ? _renderFluxoCaixa(semanas) : ''}
      ${_renderDicas(tips)}
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
  function _renderMegaInsight(mega, receitaPrevista = 0, modo = 'realizado', temPrevisao = false, extra = {}) {
    const tc = { green: 'var(--success)', red: 'var(--danger)', orange: 'var(--warning)', navy: 'var(--navy)' };
    const c = tc[mega.resumo.tone] || 'var(--navy)';
    const { naoRecebidoValor = 0, naoRecebidoQtd = 0 } = extra;
    // Toggle Realizado / Com previsão — só quando há OS abertas com sessões
    const toggle = temPrevisao ? `
      <div class="mega-toggle">
        <button class="mega-toggle-btn ${modo === 'realizado' ? 'active' : ''}" onclick="Insights.setMegaModo('realizado')">📊 Realizado</button>
        <button class="mega-toggle-btn ${modo === 'previsao' ? 'active' : ''}" onclick="Insights.setMegaModo('previsao')">🔮 Com previsão</button>
      </div>` : '';
    // Rodapé com a receita prevista: só no modo realizado (no previsão a narrativa já cobre isso)
    const prevStr = (modo === 'realizado' && receitaPrevista > 0)
      ? `<div style="margin-top:12px;padding:10px 12px;background:var(--bg);border-radius:10px;border-left:3px solid var(--gold-dk)">
           <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:2px">Receita prevista (OS em aberto)</div>
           <div style="font-size:1.1rem;font-weight:800;color:var(--navy)">${Fmt.currency(receitaPrevista)}</div>
         </div>` : '';
    // OS fechadas aguardando pagamento (não recebido × valor) — em ambos os modos
    const naoRecebidoStr = naoRecebidoValor > 0
      ? `<div style="margin-top:12px;padding:10px 12px;background:var(--bg);border-radius:10px;border-left:3px solid var(--danger)">
           <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
             <div>
               <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:2px">📥 OS fechadas a receber</div>
               <div style="font-size:.72rem;color:var(--text-muted)">${naoRecebidoQtd} OS aguardando pagamento</div>
             </div>
             <div style="font-size:1.1rem;font-weight:800;color:var(--danger)">${Fmt.currency(naoRecebidoValor)}</div>
           </div>
         </div>` : '';
    return `
      <div class="card mb-4" style="border-left:5px solid ${c}">
        <div class="card-header"><h3>🧠 Resumo inteligente</h3></div>
        <div class="card-body">
          ${toggle}
          <p style="font-size:.95rem;line-height:1.5;font-weight:600;color:var(--text);margin:0 0 ${mega.achados.length ? '10px' : '0'}">${mega.resumo.texto}</p>
          ${mega.achados.map(a => `
            <div style="display:flex;gap:9px;align-items:flex-start;padding:8px 0;border-top:1px solid var(--border)">
              <span style="font-size:1rem;flex-shrink:0;line-height:1.3">${a.icon}</span>
              <span style="font-size:.85rem;color:var(--text-muted);line-height:1.45">${a.text}</span>
            </div>`).join('')}
          ${prevStr}
          ${naoRecebidoStr}
        </div>
      </div>
    `;
  }

  function _renderEvolucao(evol) {
    const temDados = evol.some(m => m.receita || m.despesa || m.horas);
    const maxRD    = Math.max(1, ...evol.flatMap(m => [m.receita, m.despesa]));
    const maxLucro = Math.max(1, ...evol.map(m => Math.abs(m.lucro)));
    const maxH     = Math.max(1, ...evol.map(m => m.horas));
    const hfmt = (h) => (typeof Fmt.hours === 'function') ? Fmt.hours(h) : `${Math.round(h)}h`;
    const kfmt = (v) => { if (v >= 1000) return `${(v/1000).toFixed(1)}k`; return v > 0 ? Math.round(v).toString() : '—'; };
    const col = (mes, bars, val) => `
      <div class="evo-col">
        <div class="evo-barwrap">${bars}</div>
        <div class="evo-val">${val}</div>
        <div class="evo-lbl">${mes.label}</div>
      </div>`;
    return `
      <div class="card mb-3">
        <div class="card-header"><h3>📊 Evolução (6 meses)</h3></div>
        <div class="card-body">
          ${!temDados ? '<p class="text-muted" style="margin:0;font-size:.85rem">Sem dados suficientes nos últimos meses.</p>' : `
            <div class="evo-leg-row">
              <span class="evo-leg"><i style="background:var(--success)"></i>Receita</span>
              <span class="evo-leg"><i style="background:var(--danger)"></i>Despesa</span>
            </div>
            <div class="evo-row">
              ${evol.map(m => col(m, `
                <div class="evo-bar" style="height:${Math.max(2, m.receita / maxRD * 100)}%;background:var(--success)"></div>
                <div class="evo-bar" style="height:${Math.max(2, m.despesa / maxRD * 100)}%;background:var(--danger)"></div>
              `, m.receita > 0 ? `<span style="color:var(--success)">R$${kfmt(m.receita)}</span>` : '—')).join('')}
            </div>

            <div class="evo-title">Lucro por mês</div>
            <div class="evo-row">
              ${evol.map(m => col(m,
                `<div class="evo-bar evo-bar-wide" style="height:${Math.max(2, Math.abs(m.lucro) / maxLucro * 100)}%;background:${m.lucro >= 0 ? 'var(--navy)' : 'var(--danger)'}"></div>`,
                m.lucro !== 0 ? `<span style="color:${m.lucro >= 0 ? 'var(--navy)' : 'var(--danger)'}">R$${kfmt(m.lucro)}</span>` : '—'
              )).join('')}
            </div>

            <div class="evo-title">Horas trabalhadas</div>
            <div class="evo-row">
              ${evol.map(m => col(m,
                `<div class="evo-bar evo-bar-wide" style="height:${Math.max(2, m.horas / maxH * 100)}%;background:var(--gold)"></div>`,
                m.horas > 0 ? hfmt(m.horas) : '—'
              )).join('')}
            </div>
          `}
        </div>
      </div>`;
  }

  function _renderReceitaPrevista({ receitaPrevista, faturamento, nOSAbertas, nSessoesAbertas }) {
    if (nOSAbertas === 0) return '';
    const total = faturamento + receitaPrevista;
    const pctReal = total > 0 ? (faturamento / total * 100) : 0;
    const pctPrev = total > 0 ? (receitaPrevista / total * 100) : 100;
    return `
      <div class="card mb-3">
        <div class="card-header"><h3>🔮 Receita Prevista</h3></div>
        <div class="card-body">
          <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:10px">
            ${nOSAbertas} OS abertas · ${nSessoesAbertas} sessão(ões) registrada(s)
          </div>
          <div style="display:flex;gap:12px;margin-bottom:14px">
            <div style="flex:1;background:var(--bg);border-radius:10px;padding:10px 12px;border-left:3px solid var(--success)">
              <div style="font-size:.72rem;color:var(--text-muted)">Realizado (período)</div>
              <div style="font-size:1rem;font-weight:800;color:var(--success)">${Fmt.currency(faturamento)}</div>
            </div>
            <div style="flex:1;background:var(--bg);border-radius:10px;padding:10px 12px;border-left:3px solid var(--gold-dk)">
              <div style="font-size:.72rem;color:var(--text-muted)">Em andamento</div>
              <div style="font-size:1rem;font-weight:800;color:var(--gold-dk)">${Fmt.currency(receitaPrevista)}</div>
            </div>
          </div>
          <div style="height:10px;border-radius:6px;overflow:hidden;display:flex;background:var(--bg)">
            ${pctReal > 0 ? `<div style="width:${pctReal.toFixed(1)}%;background:var(--success);transition:width .4s"></div>` : ''}
            ${pctPrev > 0 ? `<div style="width:${pctPrev.toFixed(1)}%;background:var(--gold-dk);transition:width .4s"></div>` : ''}
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:5px;font-size:.72rem;color:var(--text-muted)">
            <span>Realizado ${pctReal.toFixed(0)}%</span>
            <span>Em aberto ${pctPrev.toFixed(0)}%</span>
          </div>
        </div>
      </div>
    `;
  }

  function _renderCusteio(c, faturamento) {
    const ocupacao = c.diasUteis > 0 ? (c.diasTrab / c.diasUteis * 100) : 0;
    const resultado = faturamento - c.custoFixoTot;
    const diasParados = Math.max(0, c.diasUteis - c.diasTrab);
    const sobrou = c.diasTrab >= c.diasUteis;
    const insight = sobrou
      ? `Você trabalhou ${c.diasTrab} dias — no nível (ou acima) dos ${c.diasUteis} dias úteis do período. Custo fixo totalmente coberto. 💪`
      : `Você trabalhou <strong>${c.diasTrab} de ${c.diasUteis} dias úteis</strong>. Os ${diasParados} dia(s) parado(s) deixaram <strong>${Fmt.currency(c.ociosidade)}</strong> de custo fixo sem cobertura — é o impacto do clima/ociosidade no período, separado das suas OS.`;
    return `
      <div class="card mb-3">
        <div class="card-header"><h3>🏢 Custo Fixo & Capacidade</h3></div>
        <div class="card-body">
          <div class="stats-grid">
            <div class="stat-card stat-navy">
              <div class="stat-label">Custo fixo ${c.nMeses > 1 ? `(${c.nMeses} meses)` : '(mês)'}</div>
              <div class="stat-value" style="font-size:1rem">${Fmt.currency(c.custoFixoTot)}</div>
            </div>
            <div class="stat-card stat-blue">
              <div class="stat-label">Custo por dia</div>
              <div class="stat-value" style="font-size:1rem">${Fmt.currency(c.custoDia)}</div>
              <div class="stat-sub">÷ ${c.diasUteis} dias úteis</div>
            </div>
            <div class="stat-card ${ocupacao >= 80 ? 'stat-green' : ocupacao >= 50 ? 'stat-orange' : 'stat-red'}">
              <div class="stat-label">Dias trabalhados</div>
              <div class="stat-value" style="font-size:1rem">${c.diasTrab} / ${c.diasUteis}</div>
              <div class="stat-sub">${ocupacao.toFixed(0)}% de ocupação</div>
            </div>
            <div class="stat-card ${c.ociosidade > 0 ? 'stat-red' : 'stat-green'}">
              <div class="stat-label">Ociosidade (clima)</div>
              <div class="stat-value" style="font-size:1rem">${Fmt.currency(c.ociosidade)}</div>
              <div class="stat-sub">custo descoberto</div>
            </div>
          </div>

          <div style="height:10px;border-radius:6px;overflow:hidden;display:flex;background:var(--bg);margin-top:14px">
            <div style="width:${Math.min(100, ocupacao).toFixed(1)}%;background:${ocupacao >= 80 ? 'var(--success)' : ocupacao >= 50 ? 'var(--warning)' : 'var(--danger)'};transition:width .4s"></div>
          </div>

          <div class="info-row mt-3">
            <span>Custo fixo coberto pelas OS:</span>
            <strong>${Fmt.currency(c.custoAbsorvido)}</strong>
          </div>
          <div class="info-row">
            <span>Faturamento − custo fixo:</span>
            <strong class="${resultado >= 0 ? 'text-green' : 'text-red'}">${Fmt.currency(resultado)}</strong>
          </div>

          <div class="tip-card ${sobrou ? 'tip-success' : 'tip-warning'}" style="margin-top:12px">
            <span class="tip-icon">${sobrou ? '☀️' : '🌧️'}</span>
            <div class="tip-body"><div class="tip-text">${insight}</div></div>
          </div>

          <p class="text-muted" style="font-size:.72rem;margin:10px 0 0">
            Custo/dia fixo pelos dias úteis do calendário — não muda com o clima. O que varia é a ociosidade.
          </p>
        </div>
      </div>
    `;
  }

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

  function _renderVisaoGeral({ faturamento, totalDesp, lucro, margem, horasPeriodo, horasDiarias, horasOSNormal, custoHora, receitaHora }) {
    const margemClass = margem >= SPEC_DEFAULTS.metaMargemPercent ? 'stat-green'
                      : margem >= 20 ? 'stat-orange' : 'stat-red';
    const horasClass = horasPeriodo >= 40 ? 'stat-green' : horasPeriodo > 0 ? 'stat-blue' : 'stat-navy';
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

          <div class="stats-grid mt-3">
            <div class="stat-card ${horasClass}">
              <div class="stat-label">⏱ Horas no Mês</div>
              <div class="stat-value" style="font-size:1rem">${Fmt.hours(horasPeriodo)}</div>
              ${horasPeriodo > 0 ? `<div class="stat-sub">${Fmt.currency(receitaHora)}/h</div>` : ''}
            </div>
            <div class="stat-card stat-navy">
              <div class="stat-label">📋 OS Normais</div>
              <div class="stat-value" style="font-size:1rem">${Fmt.hours(horasOSNormal)}</div>
              <div class="stat-sub">calculadora</div>
            </div>
            <div class="stat-card stat-blue">
              <div class="stat-label">📅 Diárias</div>
              <div class="stat-value" style="font-size:1rem">${Fmt.hours(horasDiarias)}</div>
              <div class="stat-sub">registro do dia</div>
            </div>
          </div>

          ${horasPeriodo > 0 ? `
            <div class="info-row mt-3">
              <span>Valor/hora trabalhada <small style="color:var(--text-muted)">(sessões do mês)</small>:</span>
              <strong class="${receitaHora > custoHora ? 'text-green' : 'text-red'}">${Fmt.currency(receitaHora)}/h</strong>
            </div>
            <div class="info-row">
              <span>Custo/hora real:</span>
              <strong>${Fmt.currency(custoHora)}/h</strong>
            </div>
            <div class="info-row">
              <span style="font-size:.78rem;color:var(--text-muted)">Base de referência:</span>
              <span style="font-size:.78rem;color:var(--text-muted)">${Fmt.currency(SPEC_DEFAULTS.custoHoraBase)}/h</span>
            </div>
          ` : `
            <p class="text-muted mt-2" style="font-size:.82rem">Registre diárias ou salve cálculos em OS normais para ver horas e ${'$'}/hora.</p>
          `}
        </div>
      </div>
    `;
  }

  // Gráfico de rosca (donut) em SVG — proporção de cada categoria
  function _donut(entries) {
    const total = entries.reduce((s, [, v]) => s + v, 0);
    if (!total) return '';
    const cores = ['#1A2B4A', '#F5A623', '#30D158', '#FF3B30', '#007AFF', '#A680F0', '#FF9500', '#2AC9D5'];
    const top = entries.slice(0, 7);
    const restoVal = entries.slice(7).reduce((s, [, v]) => s + v, 0);
    const data = restoVal > 0 ? [...top, ['Outros', restoVal]] : top;
    const r = 42, cx = 54, cy = 54, sw = 16, circ = 2 * Math.PI * r;
    let off = 0;
    const segs = data.map(([, val], i) => {
      const len = val / total * circ;
      const s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${cores[i % cores.length]}" stroke-width="${sw}" stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
      off += len; return s;
    }).join('');
    const legend = data.map(([nome, val], i) =>
      `<div class="donut-leg"><i style="background:${cores[i % cores.length]}"></i>${nome}<span class="donut-leg-pct">${(val / total * 100).toFixed(0)}%</span></div>`
    ).join('');
    return `<div class="donut-wrap">
      <svg viewBox="0 0 108 108" width="104" height="104" style="flex-shrink:0">${segs}</svg>
      <div class="donut-legend">${legend}</div>
    </div>`;
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
              _donut(porRec) + porRec.map(([nome, val]) => linha(nome, val, maxRec, 'bar-green')).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>🔴 Despesas por Categoria</h3></div>
          <div class="card-body">
            ${porDesp.length === 0 ? '<p class="text-muted">Sem despesas no período</p>' :
              _donut(porDesp) + porDesp.map(([nome, val]) => linha(nome, val, maxDesp, 'bar-red')).join('')}
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

  return { render, setPeriodo, setRegime, setMegaModo };
})();
