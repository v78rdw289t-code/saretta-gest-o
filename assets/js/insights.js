// ============================================================
// INSIGHTS — Painel v3.1 (repaginado)
// ============================================================
//
// Princípio: cada número aparece UMA vez, no card que responde uma
// pergunta do negócio. Análise (variação, projeção, meta) fica aqui;
// consulta (breakdown absoluto por categoria) fica no Resumo do Financeiro.
//
// Ordem dos cards:
//   1. KPIs do período (faturamento/despesas/resultado/margem + Δ)
//   2. 🎯 Meta do mês (config meta_faturamento_mensal)
//   3. 🧠 Resumo (narrativa comparativa enxuta)
//   4. 💵 Sua hora (valor/hora × custo/hora × hora base)
//   5. 🏭 Capacidade (custeio por absorção)
//   6. 🔧 Pipeline (OS abertas + fechadas a receber + parada)
//   7. 📈 Evolução (6 meses)
//   8. 📊 O que mudou (variações por categoria vs período anterior)
//   9. 👥 Clientes (top 5 + concentração)
//  10. ⏰ Recebimento (a receber, atrasado, prazo médio)
//  11. 🔮 Próximos 30 dias (o que vence, semana a semana)

const Insights = (() => {
  const SPEC_DEFAULTS = {
    metaMargemPercent:  30,
    alertaConcentracao: 40,
  };

  // Período selecionado (default: mês atual)
  let _periodo  = 'mes_atual';   // mes_atual | mes_anterior | ultimos_3m | ultimos_6m | ano
  let _regime   = 'competencia'; // competencia | caixa — controla faturamento/lucro/margem
  let _cache    = null;          // { parcelas, osList, diarias, comprasItensByCompra, fechamentoOsByFech }

  // ─── Helpers de período ─────────────────────────────────
  // Retorna { start, end, label } no formato YYYY-MM-DD
  function calcPeriodo(key) {
    const hoje = new Date();
    const y = hoje.getFullYear();
    const m = hoje.getMonth();   // 0-11

    function ymd(d) { return DateUtil.ymd(d); }

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
    const ymd = d => DateUtil.ymd(d);
    if (key === 'mes_anterior') return { start: ymd(new Date(y, m-2, 1)), end: ymd(new Date(y, m-1, 0)) };
    if (key === 'ultimos_3m')   return { start: ymd(new Date(y, m-5, 1)), end: ymd(new Date(y, m-2, 0)) };
    if (key === 'ultimos_6m')   return { start: ymd(new Date(y, m-11, 1)), end: ymd(new Date(y, m-5, 0)) };
    if (key === 'ano')          return { start: ymd(new Date(y-1, 0, 1)), end: ymd(new Date(y-1, 11, 31)) };
    return { start: ymd(new Date(y, m-1, 1)), end: ymd(new Date(y, m, 0)) }; // mes_atual → mês anterior
  }

  // Horas trabalhadas no período, das SESSÕES pela data de cada uma. As
  // horas_calculadas da OS só entram como legado, para OS normais antigas SEM
  // sessão registrada — evita dupla contagem.
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

  // Nº de meses-calendário cobertos pelo período (para escalar o custo fixo)
  function _mesesNoPeriodo(periodo) {
    const s = new Date(periodo.start + 'T00:00:00');
    const e = new Date(periodo.end + 'T00:00:00');
    return Math.max(1, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1);
  }

  // Período já terminou? Métricas de eficiência/ociosidade só são confiáveis com o
  // período FECHADO — durante o mês corrente faltam dias e a ociosidade conta dias
  // úteis futuros como se fossem parados, distorcendo tudo.
  function _periodoFechado(periodo) {
    return periodo.end < DateUtil.today();
  }
  // Dias úteis que ainda faltam até o período fechar
  function _diasUteisRestantes(periodo) {
    const hoje = DateUtil.today();
    if (periodo.end < hoje) return 0;
    return DateUtil.businessDays(hoje > periodo.start ? hoje : periodo.start, periodo.end);
  }

  // Custeio por absorção: dilui o custo fixo mensal pela CAPACIDADE NORMAL (dias
  // úteis do calendário), não pelos dias realmente trabalhados — assim o custo/dia
  // fica estável e o efeito do clima vira "ociosidade" (dias úteis não trabalhados).
  function _custeioNoPeriodo(periodo, custoFixoMensal) {
    const nMeses        = _mesesNoPeriodo(periodo);
    const custoFixoTot  = custoFixoMensal * nMeses;
    const diasUteis     = DateUtil.businessDays(periodo.start, periodo.end);
    const custoDia      = diasUteis > 0 ? custoFixoTot / diasUteis : 0;
    const diasTrab = new Set(
      _cache.diarias
        .map(d => String(d.data || '').substring(0, 10))
        .filter(data => data >= periodo.start && data <= periodo.end)
    ).size;
    const custoDiaReal  = diasTrab > 0 ? custoFixoTot / diasTrab : 0;
    const custoAbsorvido = diasTrab * custoDia;
    const ociosidade     = Math.max(0, custoFixoTot - custoAbsorvido);
    return { nMeses, custoFixoTot, diasUteis, custoDia, custoDiaReal, diasTrab, custoAbsorvido, ociosidade };
  }

  function _osFechadasNoPeriodo(periodo) {
    return _cache.osList.filter(o => {
      if (o.status !== 'fechado') return false;
      const ref = String(o.data_atualizacao || o.data_fim || o.data_inicio || '').substring(0, 10);
      return ref >= periodo.start && ref <= periodo.end;
    });
  }

  // Snapshot de métricas de um período — base dos KPIs, do resumo e do "O que mudou"
  function _calcSnapshot(periodo) {
    const parc = _cache.parcelas.filter(p => !origemForaResultado(p.origem) && noPeriodo(p, periodo));
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
      receitaHora: horas > 0 ? faturamento / horas : 0,
      despPorCat: Object.fromEntries(agruparPorCategoria(despesas)),
      recPorCat:  Object.fromEntries(agruparPorCategoria(receitas)),
    };
  }

  // ─── Narrativa comparando atual × anterior ────────────────
  function _pct(cur, prev) { return prev > 0 ? ((cur - prev) / prev * 100) : (cur > 0 ? 100 : 0); }
  function _sinalPct(cur, prev) {
    if (prev <= 0) return cur > 0 ? 'novo' : '—';
    const p = _pct(cur, prev);
    return (p >= 0 ? '+' : '−') + Math.abs(p).toFixed(0) + '%';
  }
  function _hf(h) { const v = Math.abs(h); const hh = Math.floor(v); const mm = Math.round((v - hh) * 60); return mm ? `${hh}h${String(mm).padStart(2,'0')}` : `${hh}h`; }

  // Resumo ENXUTO: 1 parágrafo (lucro + causa) + até 3 achados de variação que não
  // têm card próprio (ticket, valor/hora Δ, volume de OS). As variações por
  // categoria têm card próprio ("O que mudou") — não entram aqui.
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

    const achados = [];
    if (!semBase) {
      // Ticket médio
      if (a.nOS > 0 && b.nOS > 0) {
        const tp = _pct(a.ticket, b.ticket);
        if (Math.abs(tp) >= 5) achados.push({ prio: Math.abs(tp), icon: '🎟️',
          text: `Ticket médio por OS: <strong>${Fmt.currency(a.ticket)}</strong> (${_sinalPct(a.ticket, b.ticket)} vs período anterior).` });
      }
      // Variação do valor/hora
      if (b.receitaHora > 0 && Math.abs(_pct(a.receitaHora, b.receitaHora)) >= 8) {
        const rp = _pct(a.receitaHora, b.receitaHora);
        achados.push({ prio: Math.abs(rp) - 1, icon: '⚡',
          text: `Cada hora trabalhada rendeu <strong>${Fmt.currency(a.receitaHora)}</strong> (${_sinalPct(a.receitaHora, b.receitaHora)}).` });
      }
      // Volume de OS
      if (a.nOS !== b.nOS && (a.nOS || b.nOS)) {
        achados.push({ prio: 4, icon: '🔧',
          text: `Você fechou <strong>${a.nOS} OS</strong> no período (${b.nOS} no anterior).` });
      }
    }
    achados.sort((x, y) => y.prio - x.prio);
    return { resumo, achados: achados.slice(0, 3) };
  }

  // Evolução mês a mês (últimos N meses) — reaproveita o snapshot por mês
  function _calcEvolucao(nMeses) {
    const hoje = new Date(); const y = hoje.getFullYear(); const m = hoje.getMonth();
    const ymd = d => DateUtil.ymd(d);
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

  // Variações por categoria vs período anterior (alimenta "O que mudou").
  // Junta receitas e despesas, ordena pela magnitude da variação.
  function _calcMudancas(a, b, minDelta = 50) {
    const rows = [];
    const add = (tipo, nome, va, vb) => {
      const delta = va - vb;
      if (Math.abs(delta) < minDelta) return;
      rows.push({ tipo, nome, va, vb, delta,
        // "bom" = verde: receita subindo ou despesa caindo
        bom: tipo === 'rec' ? delta > 0 : delta < 0 });
    };
    new Set([...Object.keys(a.despPorCat), ...Object.keys(b.despPorCat)])
      .forEach(c => add('desp', c, a.despPorCat[c] || 0, b.despPorCat[c] || 0));
    new Set([...Object.keys(a.recPorCat), ...Object.keys(b.recPorCat)])
      .forEach(c => add('rec', c, a.recPorCat[c] || 0, b.recPorCat[c] || 0));
    rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    return rows.slice(0, 6);
  }

  // O que vence nos PRÓXIMOS 30 dias (sempre de hoje pra frente, independe do
  // período selecionado): parcelas pendentes agrupadas em 4 janelas semanais.
  // Atrasadas (venc < hoje) ficam de fora — moram no card Recebimento.
  function _calcProximos30() {
    const hojeStr = DateUtil.today();
    const hoje = new Date(hojeStr + 'T00:00:00');
    const faixas = [[0, 6], [7, 13], [14, 20], [21, 29]];
    const lbl = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    const semanas = faixas.map(([i, f]) => {
      const di = new Date(hoje.getTime() + i * 86400000);
      const df = new Date(hoje.getTime() + f * 86400000);
      return { label: `${lbl(di)}–${lbl(df)}`, receber: 0, pagar: 0 };
    });
    let receber = 0, pagar = 0, qtd = 0;
    _cache.parcelas.forEach(p => {
      if (p.status !== 'pendente' || origemForaResultado(p.origem)) return;
      const v = String(p.data_vencimento || '').substring(0, 10);
      if (!v || v < hojeStr) return;
      const dias = Math.round((new Date(v + 'T00:00:00') - hoje) / 86400000);
      if (dias > 29) return;
      const idx = faixas.findIndex(([i, f]) => dias >= i && dias <= f);
      const val = Number(p.valor || 0);
      if (p.tipo === 'receber') { semanas[idx].receber += val; receber += val; }
      else { semanas[idx].pagar += val; pagar += val; }
      qtd++;
    });
    return { semanas, receber, pagar, saldo: receber - pagar, qtd };
  }

  // ─── RENDER PRINCIPAL ───────────────────────────────────
  async function render() {
    const section = qs('#page-insights');
    const periodoLabels = {
      mes_atual: '📅 Mês atual', mes_anterior: 'Mês anterior',
      ultimos_3m: 'Últimos 3 meses', ultimos_6m: 'Últimos 6 meses', ano: 'Ano',
    };
    section.innerHTML = `
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <h1>📊 Insights</h1>
        <button class="btn btn-outline btn-sm" onclick="Insights.atualizar()"
          title="Recarrega os dados e revisa valores, datas e categorias do mês">🔄 Atualizar</button>
      </div>

      <!-- Controles: regime (competência/caixa) + período -->
      <div class="ins-controls mb-3">
        <div class="ins-regime" role="group" aria-label="Regime">
          <button class="${_regime==='competencia'?'active':''}" onclick="Insights.setRegime('competencia')"
            title="Conta tudo que foi lançado no período, independente de pago">Competência</button>
          <button class="${_regime==='caixa'?'active':''}" onclick="Insights.setRegime('caixa')"
            title="Conta só o que foi pago/recebido de fato">Caixa</button>
        </div>
        <select class="ins-periodo-sel" aria-label="Período" onchange="Insights.setPeriodo(this.value)">
          ${Object.entries(periodoLabels).map(([k, lbl]) =>
            `<option value="${k}" ${_periodo===k?'selected':''}>${lbl}</option>`).join('')}
        </select>
      </div>

      <div id="insights-content">
        <div class="loading-pulse p-4">Carregando dados...</div>
      </div>
    `;
    await loadInsights();
  }

  function setPeriodo(p) { _periodo = p; render(); }
  function setRegime(r)  { _regime  = r; render(); }

  // Botão "Atualizar": limpa o cache, recarrega dados frescos e revisa os
  // lançamentos do mês (valores/datas/categorias), avisando por toast.
  async function atualizar() {
    if (typeof API.clearCache === 'function') API.clearCache();
    await render();
    _auditarMes();
  }

  // Revisa os lançamentos com competência no período: categoria, vencimento e valor.
  function _auditarMes() {
    const periodo = calcPeriodo(_periodo);
    const parc = (_cache.parcelas || []).filter(p =>
      !origemForaResultado(p.origem) && noPeriodo(p, periodo, 'competencia'));
    let semCat = 0, semVenc = 0, valorRuim = 0;
    parc.forEach(p => {
      const catId = _categoriaIdEfetiva(p);
      const cat = App.categoriaNome(catId);
      if (!catId || !cat || cat === '—') semCat++;
      if (!p.data_vencimento) semVenc++;
      if (!(Number(p.valor) > 0)) valorRuim++;
    });
    const probs = [];
    if (semCat    > 0) probs.push(`${semCat} sem categoria`);
    if (semVenc   > 0) probs.push(`${semVenc} sem vencimento`);
    if (valorRuim > 0) probs.push(`${valorRuim} com valor inválido`);
    if (probs.length === 0) {
      Toast.success(`${periodo.label}: ${parc.length} lançamento(s) revisado(s) — tudo certo ✓`);
    } else {
      Toast.warning(`Revisão de ${periodo.label}: ${probs.join(' · ')}`);
    }
  }

  async function loadInsights() {
    const shown = Loading.maybeShow('parcelas', 'os', 'diarias', 'compras_itens');
    const [parRes, osRes, diRes, ciRes, foRes] = await Promise.all([
      API.db.read('parcelas'),
      API.db.read('os'),
      API.db.read('diarias'),
      API.db.read('compras_itens'),
      API.db.read('fechamento_os'),
    ]);
    if (shown) Loading.hide();

    _cache = {
      parcelas: parRes?.data || [],
      osList:   osRes?.data  || [],
      diarias:  diRes?.data  || [],
      comprasItensByCompra: agruparComprasItens(ciRes?.data || []),
      fechamentoOsByFech:   agruparFechamentoOs(foRes?.data || []),
    };

    const _cfg = await Calculator.getConfig();
    const custoFixoMensal = Calculator.custoFixoMensal(_cfg);
    const meta     = Calculator.cfgNum(_cfg, 'meta_faturamento_mensal', 0);
    const horaBase = Calculator.cfgNum(_cfg, 'valor_hora_manutencao', 0) || Calculator.cfgNum(_cfg, 'valor_hora', 0);

    const periodo = calcPeriodo(_periodo);
    const fechado = _periodoFechado(periodo);
    const diasRestantes = _diasUteisRestantes(periodo);

    // Snapshots atual × anterior — fonte única dos KPIs, resumo e "O que mudou"
    const snapAtual = _calcSnapshot(periodo);
    const snapAnt   = _calcSnapshot(calcPeriodoAnterior(_periodo));
    const { faturamento, totalDesp, lucro, horas: horasPeriodo } = snapAtual;
    const margem    = faturamento > 0 ? (lucro / faturamento) * 100 : 0;
    const margemAnt = snapAnt.faturamento > 0 ? (snapAnt.lucro / snapAnt.faturamento) * 100 : null;
    const custoHora   = horasPeriodo > 0 ? totalDesp / horasPeriodo : 0;
    const receitaHora = snapAtual.receitaHora;

    // Clientes (top 5 + concentração)
    const parcelasPeriodo = _cache.parcelas.filter(p => !origemForaResultado(p.origem) && noPeriodo(p, periodo));
    const receitas = parcelasPeriodo.filter(p => p.tipo === 'receber');
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

    // Recebimento (pendentes + atrasados — todos, não só do período)
    const hojeStr = DateUtil.today();
    const aReceber = _cache.parcelas.filter(p =>
      p.tipo === 'receber' && p.status === 'pendente'
    );
    const atrasados = aReceber.filter(p =>
      String(p.data_vencimento || '').substring(0, 10) < hojeStr
    );
    const totalReceber  = sumValor(aReceber);
    const totalAtrasado = sumValor(atrasados);
    const recebidasNoPeriodo = receitas.filter(p => p.status === 'pago' && p.data_pagamento);
    const prazos = recebidasNoPeriodo.map(p => {
      const venc  = new Date(String(p.data_vencimento || '').substring(0,10));
      const pagto = new Date(String(p.data_pagamento  || '').substring(0,10));
      return (pagto - venc) / 86400000;
    }).filter(n => Number.isFinite(n));
    const prazoMedio = prazos.length > 0
      ? prazos.reduce((s, n) => s + n, 0) / prazos.length : null;

    // Pipeline: OS abertas + fechadas ainda não recebidas. OS com valor
    // combinado entra pelo combinado (senão apareceria R$0 até registrar horas).
    const osAbertas = _cache.osList.filter(o => o.status === 'andamento' || o.status === 'acerto');
    const osAbertasIds = new Set(osAbertas.map(o => o.id));
    const sessoesAbertas = _cache.diarias.filter(d => osAbertasIds.has(d.os_id));
    const receitaPrevista = osAbertas.reduce((s, o) =>
      s + Calculator.valorPipelineOS(o, sessoesAbertas.filter(d => d.os_id === o.id)), 0);
    // Trabalho DESTE período ainda não faturado: sessões de OS abertas com data
    // dentro do período. É receita quase certa que ainda não virou parcela — sem
    // ela o mês parece pior do que é quando a OS demora uns dias pra fechar.
    // Limitação: OS combinada contribui aqui pelas horas de referência (não há
    // como ratear o combinado por período).
    const previstaPeriodo = sessoesAbertas
      .filter(d => { const dt = String(d.data || '').substring(0, 10); return dt >= periodo.start && dt <= periodo.end; })
      .reduce((s, d) => s + Number(d.valor_manual || d.valor_calculado || 0), 0);
    const nOSAbertas = osAbertasIds.size;
    const aReceberOS = _cache.parcelas.filter(p =>
      (p.origem === 'os' || p.origem === 'os_lote') && p.tipo === 'receber' && p.status === 'pendente'
    );
    const naoRecebidoValor = sumValor(aReceberOS);
    const naoRecebidoQtd   = aReceberOS.length;

    // OS em andamento parada há mais tempo (sem atualização)
    let osParada = null;
    const _hojeDt = new Date(); _hojeDt.setHours(0, 0, 0, 0);
    _cache.osList.filter(o => o.status === 'andamento').forEach(o => {
      const d = new Date((o.data_atualizacao || o.data_inicio || '').substring(0, 10) + 'T00:00:00');
      if (!isNaN(d.getTime())) {
        const dias = Math.floor((_hojeDt - d) / 86400000);
        if (dias >= 15 && dias > (osParada?.dias || 0)) osParada = { numero: o.numero, dias };
      }
    });

    const custeio = custoFixoMensal > 0 ? _custeioNoPeriodo(periodo, custoFixoMensal) : null;
    const mega     = buildMegaInsight(snapAtual, snapAnt);
    // Trabalho do período ainda não faturado entra como 1º achado do resumo —
    // é a resposta direta ao "o mês parece pior porque a OS demora a fechar".
    if (previstaPeriodo > 0) {
      mega.achados.unshift({ icon: '🔮',
        text: `<strong>${Fmt.currency(previstaPeriodo)}</strong> em trabalho deste período ainda não faturado (OS abertas) — fechando essas OS, o faturamento vai a <strong>${Fmt.currency(faturamento + previstaPeriodo)}</strong>.` });
      mega.achados = mega.achados.slice(0, 3);
    }
    const evol     = _calcEvolucao(6);
    const mudancas = _calcMudancas(snapAtual, snapAnt);
    const temBaseAnterior = !!(snapAnt.faturamento || snapAnt.totalDesp || snapAnt.horas);
    const prox30   = _calcProximos30();

    const regimeLabel = _regime === 'caixa' ? 'regime de Caixa' : 'regime de Competência';
    const periodoMensal = _periodo === 'mes_atual' || _periodo === 'mes_anterior';

    qs('#insights-content').innerHTML = `
      <p class="text-muted mb-3" style="font-size:.82rem;margin-top:-4px">
        ${periodo.label} · <strong>${regimeLabel}</strong>${fechado ? '' : ' · <span style="color:var(--warning)">em curso</span>'}
      </p>

      ${_renderKPIs(snapAtual, snapAnt, margem, margemAnt)}
      ${periodoMensal ? _renderMeta(faturamento, meta, fechado, diasRestantes, previstaPeriodo) : ''}
      ${_renderResumo(mega)}
      ${_renderSuaHora({ horasPeriodo, receitaHora, custoHora, horaBase, fechado })}
      ${custeio ? _renderCusteio(custeio, fechado, diasRestantes) : ''}
      ${_renderPipeline({ receitaPrevista, previstaPeriodo, faturamento, nOSAbertas, naoRecebidoValor, naoRecebidoQtd, osParada })}
      ${_renderEvolucao(evol)}
      ${_renderMudancas(mudancas, temBaseAnterior)}
      ${_renderClientes(top5Clientes, concentracao, clientesRanked)}
      ${_renderInadimplencia({ totalReceber, totalAtrasado, atrasados, prazoMedio })}
      ${_renderProximos30(prox30)}
    `;
  }

  // ─── HELPERS ─────────────────────────────────────────────
  function sumValor(arr) { return arr.reduce((s, p) => s + Number(p.valor || 0), 0); }

  // Categoria efetiva (sessões → OS → parcela; lote → predominante) via helper compartilhado (utils.js).
  function _categoriaIdEfetiva(p) {
    return categoriaEfetivaId(p, _cache.osList, _cache.diarias, _cache.fechamentoOsByFech);
  }
  function _ctxCat() {
    return { osList: _cache.osList, diarias: _cache.diarias, comprasItensByCompra: _cache.comprasItensByCompra, fechamentoOsByFech: _cache.fechamentoOsByFech };
  }

  function agruparPorCategoria(parcelas) {
    const out = {};
    parcelas.forEach(p => {
      distribuirCategorias(p, _ctxCat()).forEach(({ categoria_id, valor }) => {
        const k = App.categoriaNome(categoria_id) || 'Sem categoria';
        out[k] = (out[k] || 0) + Number(valor || 0);
      });
    });
    return Object.entries(out).sort((a, b) => b[1] - a[1]);
  }

  // ─── RENDERERS ───────────────────────────────────────────

  // KPIs do período — ÚNICA aparição de faturamento/despesas/resultado/margem.
  // Δ% vs período anterior direto em cada card (verde = melhorou).
  function _renderKPIs(a, b, margem, margemAnt) {
    const delta = (cur, prev, invertido = false) => {
      if (!(prev > 0)) return '';
      const p = _pct(cur, prev);
      if (Math.abs(p) < 1) return '<div class="stat-sub">estável</div>';
      const melhorou = invertido ? p < 0 : p > 0;
      return `<div class="stat-sub" style="color:${melhorou ? 'var(--success)' : 'var(--danger)'};font-weight:700">${p > 0 ? '▲ +' : '▼ −'}${Math.abs(p).toFixed(0)}% vs anterior</div>`;
    };
    const margemClass = margem >= SPEC_DEFAULTS.metaMargemPercent ? 'stat-green'
                      : margem >= 20 ? 'stat-orange' : 'stat-red';
    const margemSub = margem >= SPEC_DEFAULTS.metaMargemPercent ? `saudável (≥${SPEC_DEFAULTS.metaMargemPercent}%)`
                    : margem >= 20 ? 'atenção (meta 30%)' : 'crítica (<20%)';
    const deltaMargem = margemAnt !== null && Math.abs(margem - margemAnt) >= 1
      ? `<div class="stat-sub" style="color:${margem >= margemAnt ? 'var(--success)' : 'var(--danger)'};font-weight:700">${margem >= margemAnt ? '▲ +' : '▼ −'}${Math.abs(margem - margemAnt).toFixed(0)} p.p.</div>`
      : '';
    return `
      <div class="stats-grid mb-3">
        <div class="stat-card stat-green">
          <div class="stat-label">Faturamento</div>
          <div class="stat-value" style="font-size:1rem">${Fmt.currency(a.faturamento)}</div>
          ${delta(a.faturamento, b.faturamento)}
        </div>
        <div class="stat-card stat-red">
          <div class="stat-label">Despesas</div>
          <div class="stat-value" style="font-size:1rem">${Fmt.currency(a.totalDesp)}</div>
          ${delta(a.totalDesp, b.totalDesp, true)}
        </div>
        <div class="stat-card ${a.lucro >= 0 ? 'stat-navy' : 'stat-red'}">
          <div class="stat-label">Resultado</div>
          <div class="stat-value" style="font-size:1rem;color:${a.lucro >= 0 ? 'var(--success)' : 'var(--danger)'}">${Fmt.currency(a.lucro)}</div>
          ${b.lucro > 0 ? delta(a.lucro, b.lucro) : ''}
        </div>
        <div class="stat-card ${margemClass}">
          <div class="stat-label">Margem</div>
          <div class="stat-value" style="font-size:1rem">${margem.toFixed(0)}%</div>
          ${deltaMargem || `<div class="stat-sub">${a.faturamento > 0 ? margemSub : '—'}</div>`}
        </div>
      </div>
    `;
  }

  // 🎯 Meta do mês — progresso do faturamento vs meta_faturamento_mensal (config).
  // A barra tem 2 segmentos: faturado (gold sólido) + trabalho do período em OS
  // abertas ainda não faturado (gold translúcido) — mostra onde a meta chega
  // quando as OS fecharem.
  function _renderMeta(faturamento, meta, fechado, diasRestantes, previstaPeriodo = 0) {
    if (!(meta > 0)) {
      return `
        <div class="card mb-3" style="cursor:pointer" onclick="App.navigate('config')">
          <div class="card-body" style="display:flex;align-items:center;gap:10px">
            <span style="font-size:1.3rem">🎯</span>
            <div style="flex:1">
              <div style="font-weight:700;font-size:.88rem">Defina uma meta de faturamento</div>
              <div style="font-size:.75rem;color:var(--text-muted)">Configure em Config → Custos do Negócio e acompanhe o progresso aqui.</div>
            </div>
            <span class="entity-chevron">›</span>
          </div>
        </div>
      `;
    }
    const pct   = Math.min(100, faturamento / meta * 100);
    const pctProj = Math.min(100, (faturamento + previstaPeriodo) / meta * 100);
    const falta = Math.max(0, meta - faturamento);
    const bateu = faturamento >= meta;
    let rodape;
    if (bateu) {
      rodape = `Meta batida! ${Fmt.currency(faturamento - meta)} acima. 🏆`;
    } else if (fechado) {
      rodape = `Fechou a ${Fmt.currency(falta)} da meta.`;
    } else if (diasRestantes > 0) {
      rodape = `Ritmo pra bater: ${Fmt.currency(falta / diasRestantes)}/dia útil (${diasRestantes} restantes).`;
    } else {
      rodape = `Faltam ${Fmt.currency(falta)} — último dia do período.`;
    }
    const temProj = !bateu && previstaPeriodo > 0;
    return `
      <div class="meta-card mb-3">
        <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:7px">
          <span style="font-weight:700">🎯 Meta do mês</span>
          <span style="color:var(--gold);font-weight:800">${pct.toFixed(0)}%</span>
        </div>
        <div class="meta-bar">
          <div class="meta-bar-fill" style="width:${pct.toFixed(1)}%"></div>
          ${temProj ? `<div class="meta-bar-prev" style="width:${Math.max(0, pctProj - pct).toFixed(1)}%"></div>` : ''}
        </div>
        <div style="font-size:.78rem;opacity:.92;margin-top:7px">${Fmt.currency(faturamento)} de ${Fmt.currency(meta)}${bateu ? '' : ` · faltam <strong>${Fmt.currency(falta)}</strong>`}</div>
        ${temProj ? `<div style="font-size:.72rem;opacity:.85;margin-top:2px">Com as OS em andamento do período: <strong style="color:var(--gold)">${pctProj.toFixed(0)}%</strong> (${Fmt.currency(faturamento + previstaPeriodo)})</div>` : ''}
        <div style="font-size:.72rem;opacity:.75;margin-top:2px">${rodape}</div>
      </div>
    `;
  }

  function _renderResumo(mega) {
    const tc = { green: 'var(--success)', red: 'var(--danger)', orange: 'var(--warning)', navy: 'var(--navy)' };
    const c = tc[mega.resumo.tone] || 'var(--navy)';
    return `
      <div class="card mb-3" style="border-left:5px solid ${c}">
        <div class="card-header"><h3>🧠 Resumo</h3></div>
        <div class="card-body">
          <p style="font-size:.95rem;line-height:1.5;font-weight:600;color:var(--text);margin:0 0 ${mega.achados.length ? '10px' : '0'}">${mega.resumo.texto}</p>
          ${mega.achados.map(a => `
            <div style="display:flex;gap:9px;align-items:flex-start;padding:8px 0;border-top:1px solid var(--border)">
              <span style="font-size:1rem;flex-shrink:0;line-height:1.3">${a.icon}</span>
              <span style="font-size:.85rem;color:var(--text-muted);line-height:1.45">${a.text}</span>
            </div>`).join('')}
        </div>
      </div>
    `;
  }

  // 💵 Sua hora — a economia da hora trabalhada, num lugar só.
  function _renderSuaHora({ horasPeriodo, receitaHora, custoHora, horaBase, fechado }) {
    const parcial = fechado ? '' : ' <span style="color:var(--warning)">*parcial</span>';
    if (!(horasPeriodo > 0)) {
      return `
        <div class="card mb-3">
          <div class="card-header"><h3>💵 Sua hora</h3></div>
          <div class="card-body"><p class="text-muted" style="margin:0;font-size:.85rem">Registre sessões de trabalho nas OS para ver o valor e o custo de cada hora.</p></div>
        </div>
      `;
    }
    const spread = receitaHora - custoHora;
    const veredito = spread >= 0
      ? `<div class="tip-card tip-success" style="margin-top:12px"><span class="tip-icon">✓</span><div class="tip-body"><div class="tip-text">Cada hora rendeu <strong>${Fmt.currency(spread)}</strong> acima do custo.</div></div></div>`
      : `<div class="tip-card tip-danger" style="margin-top:12px"><span class="tip-icon">⚠️</span><div class="tip-body"><div class="tip-text">Cada hora custou <strong>${Fmt.currency(Math.abs(spread))}</strong> a mais do que rendeu — revise preço ou despesas.</div></div></div>`;
    return `
      <div class="card mb-3">
        <div class="card-header">
          <h3>💵 Sua hora</h3>
          <span class="badge badge-info">${Fmt.hours(horasPeriodo)} no período</span>
        </div>
        <div class="card-body">
          <div class="stats-grid">
            <div class="stat-card ${receitaHora >= custoHora ? 'stat-green' : 'stat-red'}">
              <div class="stat-label">Valor/hora${parcial}</div>
              <div class="stat-value" style="font-size:1rem">${Fmt.currency(receitaHora)}</div>
              <div class="stat-sub">faturamento ÷ horas</div>
            </div>
            <div class="stat-card stat-blue">
              <div class="stat-label">Custo/hora${parcial}</div>
              <div class="stat-value" style="font-size:1rem">${Fmt.currency(custoHora)}</div>
              <div class="stat-sub">despesas ÷ horas</div>
            </div>
            ${horaBase > 0 ? `
            <div class="stat-card stat-navy">
              <div class="stat-label">Hora base</div>
              <div class="stat-value" style="font-size:1rem">${Fmt.currency(horaBase)}</div>
              <div class="stat-sub">config (cobrança)</div>
            </div>` : ''}
          </div>
          ${veredito}
          ${!fechado ? `<p class="text-muted" style="font-size:.72rem;margin:10px 0 0">* valores parciais — ficam definitivos quando o período fechar.</p>` : ''}
        </div>
      </div>
    `;
  }

  // 🏭 Capacidade (custeio por absorção) — custo fixo diluído por dias úteis.
  function _renderCusteio(c, fechado, diasRestantes) {
    const ocupacao = c.diasUteis > 0 ? (c.diasTrab / c.diasUteis * 100) : 0;
    const diasParados = Math.max(0, c.diasUteis - c.diasTrab);
    const sobrou = c.diasTrab >= c.diasUteis;

    const cardsBase = `
      <div class="stat-card stat-navy">
        <div class="stat-label">Custo fixo ${c.nMeses > 1 ? `(${c.nMeses} meses)` : '(mês)'}</div>
        <div class="stat-value" style="font-size:1rem">${Fmt.currency(c.custoFixoTot)}</div>
      </div>
      <div class="stat-card stat-blue">
        <div class="stat-label">Custo/dia previsto</div>
        <div class="stat-value" style="font-size:1rem">${Fmt.currency(c.custoDia)}</div>
        <div class="stat-sub">÷ ${c.diasUteis} dias úteis</div>
      </div>
      <div class="stat-card ${c.custoDiaReal > c.custoDia ? 'stat-orange' : 'stat-green'}">
        <div class="stat-label">Custo/dia real</div>
        <div class="stat-value" style="font-size:1rem">${c.diasTrab > 0 ? Fmt.currency(c.custoDiaReal) : '—'}</div>
        <div class="stat-sub">÷ ${c.diasTrab} dia(s) trabalhado(s)</div>
      </div>`;

    // Período em andamento: ociosidade distorce (conta dias futuros como parados)
    if (!fechado) {
      return `
        <div class="card mb-3">
          <div class="card-header"><h3>🏭 Capacidade</h3></div>
          <div class="card-body">
            <div class="stats-grid">
              ${cardsBase}
              <div class="stat-card stat-navy">
                <div class="stat-label">Dias trabalhados</div>
                <div class="stat-value" style="font-size:1rem">${c.diasTrab} / ${c.diasUteis}</div>
                <div class="stat-sub">até agora</div>
              </div>
            </div>
            <div class="tip-card tip-info" style="margin-top:12px">
              <span class="tip-icon">⏳</span>
              <div class="tip-body"><div class="tip-text">
                Período em curso${diasRestantes > 0 ? ` (faltam ${diasRestantes} dia(s) úteis)` : ''} — a <strong>ocupação</strong> e a <strong>ociosidade</strong> aparecem quando o período fechar.
              </div></div>
            </div>
            <p class="text-muted" style="font-size:.72rem;margin:10px 0 0">
              Custo/dia fixo pelos dias úteis do calendário. Estimativa gerencial — separada das despesas lançadas no Financeiro.
            </p>
          </div>
        </div>
      `;
    }

    const insight = sobrou
      ? `Você trabalhou ${c.diasTrab} dias — no nível (ou acima) dos ${c.diasUteis} dias úteis do período. Custo fixo totalmente coberto. 💪`
      : `Você trabalhou <strong>${c.diasTrab} de ${c.diasUteis} dias úteis</strong>. Os ${diasParados} dia(s) parado(s) deixaram <strong>${Fmt.currency(c.ociosidade)}</strong> de custo fixo sem cobertura — impacto do clima/ociosidade, separado das suas OS.`;
    return `
      <div class="card mb-3">
        <div class="card-header"><h3>🏭 Capacidade</h3></div>
        <div class="card-body">
          <div class="stats-grid">
            ${cardsBase}
            <div class="stat-card ${ocupacao >= 80 ? 'stat-green' : ocupacao >= 50 ? 'stat-orange' : 'stat-red'}">
              <div class="stat-label">Ocupação</div>
              <div class="stat-value" style="font-size:1rem">${ocupacao.toFixed(0)}%</div>
              <div class="stat-sub">${c.diasTrab} / ${c.diasUteis} dias úteis</div>
            </div>
          </div>

          <div style="height:10px;border-radius:6px;overflow:hidden;display:flex;background:var(--bg);margin-top:14px">
            <div style="width:${Math.min(100, ocupacao).toFixed(1)}%;background:${ocupacao >= 80 ? 'var(--success)' : ocupacao >= 50 ? 'var(--warning)' : 'var(--danger)'};transition:width .4s"></div>
          </div>

          <div class="tip-card ${sobrou ? 'tip-success' : 'tip-warning'}" style="margin-top:12px">
            <span class="tip-icon">${sobrou ? '☀️' : '🌧️'}</span>
            <div class="tip-body"><div class="tip-text">${insight}</div></div>
          </div>

          <p class="text-muted" style="font-size:.72rem;margin:10px 0 0">
            Custo/dia fixo pelos dias úteis do calendário (não muda com o clima). Estimativa gerencial — separada das despesas lançadas no Financeiro, não some as duas.
          </p>
        </div>
      </div>
    `;
  }

  // 🔧 Pipeline — o que ainda vira dinheiro: OS abertas + fechadas não recebidas.
  function _renderPipeline({ receitaPrevista, previstaPeriodo = 0, faturamento = 0, nOSAbertas, naoRecebidoValor, naoRecebidoQtd, osParada }) {
    if (nOSAbertas === 0 && naoRecebidoValor === 0) return '';
    return `
      <div class="card mb-3">
        <div class="card-header"><h3>🔧 Pipeline</h3></div>
        <div class="card-body">
          <div style="display:flex;gap:12px">
            <div style="flex:1;background:var(--gold-lt);border-radius:10px;padding:10px 12px">
              <div style="font-size:.72rem;color:var(--gold-dk);font-weight:700">Em andamento</div>
              <div style="font-size:1rem;font-weight:800">${Fmt.currency(receitaPrevista)}</div>
              <div style="font-size:.7rem;color:var(--text-muted)">${nOSAbertas} OS aberta(s)${previstaPeriodo > 0 ? ` · ${Fmt.currency(previstaPeriodo)} deste período` : ''}</div>
            </div>
            <div style="flex:1;background:var(--bg);border-radius:10px;padding:10px 12px">
              <div style="font-size:.72rem;color:var(--text-muted);font-weight:700">Fechadas a receber</div>
              <div style="font-size:1rem;font-weight:800">${Fmt.currency(naoRecebidoValor)}</div>
              <div style="font-size:.7rem;color:var(--text-muted)">${naoRecebidoQtd} parcela(s) pendente(s)</div>
            </div>
          </div>
          ${previstaPeriodo > 0 ? `
          <div class="tip-card tip-info" style="margin-top:12px">
            <span class="tip-icon">🔮</span>
            <div class="tip-body"><div class="tip-text">Projeção do período: ${Fmt.currency(faturamento)} faturado + ${Fmt.currency(previstaPeriodo)} em aberto = <strong>${Fmt.currency(faturamento + previstaPeriodo)}</strong> quando as OS fecharem.</div></div>
          </div>` : ''}
          ${osParada ? `
          <div class="tip-card tip-warning" style="margin-top:12px">
            <span class="tip-icon">🐌</span>
            <div class="tip-body"><div class="tip-text"><strong>${osParada.numero}</strong> parada há ${osParada.dias} dias — vale retomar ou fechar.</div></div>
          </div>` : ''}
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
        <div class="card-header"><h3>📈 Evolução (6 meses)</h3></div>
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

  // 📊 O que mudou — variações por categoria vs período anterior. O breakdown
  // absoluto por categoria mora no Resumo do Financeiro (sem duplicar aqui).
  function _renderMudancas(rows, temBaseAnterior) {
    const corpo = !temBaseAnterior
      ? '<p class="text-muted" style="margin:0;font-size:.85rem">Sem período anterior pra comparar ainda.</p>'
      : rows.length === 0
        ? '<p class="text-muted" style="margin:0;font-size:.85rem">Nada mudou de forma relevante entre os períodos.</p>'
        : rows.map(r => {
            const seta = r.delta > 0 ? '▲' : '▼';
            const pct = r.vb > 0 ? ` (${_sinalPct(r.va, r.vb)})` : ' (novo)';
            return `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:.85rem">
              <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.nome} <small style="color:var(--text-muted)">${r.tipo === 'rec' ? 'receita' : 'despesa'}</small></span>
              <strong style="flex:0 0 auto;color:${r.bom ? 'var(--success)' : 'var(--danger)'}">${seta} ${r.delta > 0 ? '+' : '−'}${Fmt.currency(Math.abs(r.delta))}${pct}</strong>
            </div>`;
          }).join('');
    return `
      <div class="card mb-3">
        <div class="card-header"><h3>📊 O que mudou <small style="font-weight:400;color:var(--text-muted);font-size:.72rem">vs período anterior</small></h3></div>
        <div class="card-body">
          ${corpo}
          <p style="font-size:.72rem;color:var(--text-muted);margin:10px 0 0;cursor:pointer"
            onclick="App.navigate('financeiro').then(() => Financeiro.switchTab('resumo'))">
            Detalhe completo por categoria → <strong>Resumo do Financeiro</strong> ›
          </p>
        </div>
      </div>
    `;
  }

  function _renderClientes(top5, concentracao, todos) {
    const alerta = concentracao > SPEC_DEFAULTS.alertaConcentracao;
    return `
      <div class="card mb-3">
        <div class="card-header">
          <h3>👥 Clientes</h3>
          ${alerta ? `<span class="badge badge-orange">⚠ Concentração ${concentracao.toFixed(0)}%</span>` : ''}
        </div>
        <div class="card-body">
          ${top5.length === 0 ? '<p class="text-muted" style="margin:0">Sem receitas no período</p>' : `
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
      <div class="card mb-3">
        <div class="card-header"><h3>⏰ Recebimento</h3></div>
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

  // 🔮 Próximos 30 dias — o que vence daqui pra frente, semana a semana.
  function _renderProximos30({ semanas, receber, pagar, saldo, qtd }) {
    if (qtd === 0) {
      return `
        <div class="card mb-4">
          <div class="card-header"><h3>🔮 Próximos 30 dias</h3></div>
          <div class="card-body"><p class="text-muted" style="margin:0;font-size:.85rem">Nada vencendo nos próximos 30 dias.</p></div>
        </div>
      `;
    }
    return `
      <div class="card mb-4">
        <div class="card-header">
          <h3>🔮 Próximos 30 dias</h3>
          <span class="badge badge-info">${qtd} vencimento(s)</span>
        </div>
        <div class="card-body">
          ${semanas.map(s => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:.82rem">
              <span style="color:var(--text-muted)">${s.label}</span>
              <span>
                <strong class="text-green">+${Fmt.currency(s.receber)}</strong>
                <span style="color:var(--text-muted)"> · </span>
                <strong class="text-red">−${Fmt.currency(s.pagar)}</strong>
              </span>
            </div>
          `).join('')}
          <div class="tip-card ${saldo >= 0 ? 'tip-success' : 'tip-danger'}" style="margin-top:12px">
            <span class="tip-icon">${saldo >= 0 ? '✓' : '⚠️'}</span>
            <div class="tip-body"><div class="tip-text" style="display:flex;justify-content:space-between;gap:8px">
              <span>Saldo projetado da janela</span>
              <strong>${saldo >= 0 ? '+' : '−'}${Fmt.currency(Math.abs(saldo))}</strong>
            </div></div>
          </div>
          <p class="text-muted" style="font-size:.72rem;margin:10px 0 0">Só parcelas pendentes com vencimento de hoje a +30 dias. Atrasadas estão no card Recebimento.</p>
        </div>
      </div>
    `;
  }

  function sumArrSecond(entries) {
    return entries.reduce((s, [, v]) => s + v, 0) || 1;
  }

  return { render, setPeriodo, setRegime, atualizar };
})();
