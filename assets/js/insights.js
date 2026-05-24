// ============================================================
// INSIGHTS
// ============================================================

const Insights = (() => {
  async function render() {
    const section = qs('#page-insights');
    section.innerHTML = `
      <div class="page-header"><h1>Insights</h1></div>
      <p class="text-muted mb-4" style="font-size:.875rem">Análise dos últimos 6 meses</p>
      <div id="insights-content">
        <div class="loading-pulse p-4">Carregando dados...</div>
      </div>
    `;
    await loadInsights();
  }

  function buildTips(parcelas, osList, recPorMes, pagPorMes, topClientes, porCliente) {
    const tips = [];

    // Tendência de receita
    const recAtual = recPorMes[5]?.competencia || 0;
    const recAnterior = recPorMes[4]?.competencia || 0;
    if (recAnterior > 0) {
      const delta = ((recAtual / recAnterior) - 1) * 100;
      if (delta >= 10) {
        tips.push({ icon: '📈', type: 'success', title: 'Receita em Alta', text: `Receita cresceu ${delta.toFixed(0)}% em relação ao mês anterior. Continue o bom trabalho!` });
      } else if (delta <= -10) {
        tips.push({ icon: '📉', type: 'danger', title: 'Queda na Receita', text: `Receita caiu ${Math.abs(delta).toFixed(0)}% em relação ao mês anterior. Vale revisar os serviços em andamento.` });
      }
    }

    // Margem operacional do último mês
    const despAtual = pagPorMes[5]?.competencia || 0;
    if (recAtual > 0) {
      const margem = ((recAtual - despAtual) / recAtual) * 100;
      if (margem < 20) {
        tips.push({ icon: '⚠️', type: 'warning', title: 'Margem Baixa', text: `Margem operacional em ${margem.toFixed(0)}% este mês. Verifique os custos — o ideal é manter acima de 30%.` });
      } else if (margem >= 50) {
        tips.push({ icon: '💪', type: 'success', title: 'Boa Margem', text: `Margem de ${margem.toFixed(0)}% este mês. Excelente controle de despesas!` });
      }
    }

    // Concentração de clientes (risco)
    if (topClientes.length > 0) {
      const totalRecGeral = Object.values(porCliente).reduce((s, v) => s + v, 0);
      if (totalRecGeral > 0) {
        const topPercent = (topClientes[0][1] / totalRecGeral) * 100;
        if (topPercent > 40) {
          tips.push({ icon: '🎯', type: 'warning', title: 'Alta Concentração', text: `"${topClientes[0][0]}" representa ${topPercent.toFixed(0)}% da receita total. Diversifique sua carteira de clientes para reduzir o risco.` });
        }
      }
    }

    // OS em andamento há muito tempo
    const hoje = new Date();
    const osAntigas = osList.filter(o => {
      if (o.status !== 'andamento') return false;
      const inicio = new Date(String(o.data_inicio || o.data_criacao).substring(0, 10) + 'T00:00:00');
      return (hoje - inicio) > 30 * 24 * 60 * 60 * 1000;
    });
    if (osAntigas.length > 0) {
      tips.push({ icon: '🔧', type: 'warning', title: 'OS Antigas Abertas', text: `${osAntigas.length} OS em andamento há mais de 30 dias. Considere atualizá-las ou fechar as concluídas.` });
    }

    // Contas a vencer nos próximos 7 dias
    const em7dias = new Date(hoje.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const hojeStr = hoje.toISOString().split('T')[0];
    const vencendo = parcelas.filter(p =>
      p.tipo === 'pagar' && p.status === 'pendente' &&
      p.data_vencimento >= hojeStr && p.data_vencimento <= em7dias
    );
    if (vencendo.length > 0) {
      const totalVenc = vencendo.reduce((s, p) => s + Number(p.valor || 0), 0);
      tips.push({ icon: '📅', type: 'danger', title: 'Contas Vencendo', text: `${vencendo.length} conta${vencendo.length > 1 ? 's' : ''} totalizando ${Fmt.currency(totalVenc)} vencem nos próximos 7 dias.` });
    }

    // Melhor mês
    const melhorMes = recPorMes.reduce((best, r) => r.competencia > best.competencia ? r : best, recPorMes[0]);
    if (melhorMes && melhorMes.competencia > 0) {
      const [ano, mes] = melhorMes.mes.split('-');
      const nomeMes = new Date(Number(ano), Number(mes) - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
      tips.push({ icon: '🏆', type: 'info', title: 'Melhor Mês', text: `${nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1)} foi seu melhor mês com ${Fmt.currency(melhorMes.competencia)} de receita.` });
    }

    // Estoque baixo (se tiver dados de OS sem itens de estoque — dica genérica)
    const totalOS = osList.length;
    const fechadas = osList.filter(o => o.status === 'fechado').length;
    if (totalOS > 0) {
      const taxaFechamento = (fechadas / totalOS) * 100;
      if (taxaFechamento < 50 && totalOS >= 5) {
        tips.push({ icon: '📊', type: 'info', title: 'Taxa de Conclusão', text: `${taxaFechamento.toFixed(0)}% das suas OS foram fechadas. Manter acima de 70% indica boa produtividade.` });
      }
    }

    // Sem dados suficientes
    if (tips.length === 0) {
      tips.push({ icon: '💡', type: 'navy', title: 'Dica', text: 'Continue registrando suas OS e lançamentos financeiros para receber insights personalizados sobre o seu negócio.' });
    }

    return tips;
  }

  async function loadInsights() {
    const shown = Loading.maybeShow('parcelas', 'os');
    const [parRes, osRes] = await Promise.all([
      API.db.read('parcelas'),
      API.db.read('os'),
    ]);
    if (shown) Loading.hide();

    const parcelas = parRes?.data || [];
    const osList   = osRes?.data  || [];

    // Últimos 6 meses
    const meses = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      meses.push(d.toISOString().substring(0, 7));
    }

    const recPorMes = meses.map(m => ({
      mes: m,
      competencia: parcelas.filter(p => p.tipo === 'receber' && String(p.data_competencia||'').startsWith(m)).reduce((s, p) => s + Number(p.valor||0), 0),
      caixa:       parcelas.filter(p => p.tipo === 'receber' && p.status === 'pago' && String(p.data_pagamento||'').startsWith(m)).reduce((s, p) => s + Number(p.valor||0), 0),
    }));
    const pagPorMes = meses.map(m => ({
      mes: m,
      competencia: parcelas.filter(p => p.tipo === 'pagar' && String(p.data_competencia||'').startsWith(m)).reduce((s, p) => s + Number(p.valor||0), 0),
      caixa:       parcelas.filter(p => p.tipo === 'pagar' && p.status === 'pago' && String(p.data_pagamento||'').startsWith(m)).reduce((s, p) => s + Number(p.valor||0), 0),
    }));

    const osPorMes = meses.map(m => ({
      mes: m,
      total: osList.filter(o => String(o.data_criacao||'').startsWith(m)).length,
      fechadas: osList.filter(o => o.status === 'fechado' && String(o.data_atualizacao||'').startsWith(m)).length,
    }));

    // Top clientes
    const porCliente = {};
    parcelas.filter(p => p.tipo === 'receber').forEach(p => {
      const k = App.clienteNome(p.cliente_id) || 'Desconhecido';
      porCliente[k] = (porCliente[k] || 0) + Number(p.valor || 0);
    });
    const topClientes = Object.entries(porCliente).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // Top categorias despesa
    const porCategoria = {};
    parcelas.filter(p => p.tipo === 'pagar').forEach(p => {
      const k = App.categoriaNome(p.categoria_id) || 'Sem Categoria';
      porCategoria[k] = (porCategoria[k] || 0) + Number(p.valor || 0);
    });
    const topCategorias = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const maxRec = Math.max(...recPorMes.map(r => r.competencia), 1);
    const maxPag = Math.max(...pagPorMes.map(r => r.competencia), 1);

    // Gerar dicas
    const tips = buildTips(parcelas, osList, recPorMes, pagPorMes, topClientes, porCliente);

    qs('#insights-content').innerHTML = `
      <!-- DICAS DO NEGÓCIO -->
      <div class="card mb-4">
        <div class="card-header">
          <h3>💡 Dicas do Negócio</h3>
          <span class="badge badge-gold">${tips.length} insight${tips.length !== 1 ? 's' : ''}</span>
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

      <div class="grid-2col">
        <div class="card">
          <div class="card-header"><h3>Receitas por Mês</h3></div>
          <div class="card-body">
            ${recPorMes.map(r => `
              <div class="bar-row">
                <div class="bar-label">${r.mes.substring(5)}</div>
                <div class="bar-track">
                  <div class="bar bar-green" style="width:${(r.competencia/maxRec*100).toFixed(0)}%"></div>
                </div>
                <div class="bar-value">${Fmt.currency(r.competencia)}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Despesas por Mês</h3></div>
          <div class="card-body">
            ${pagPorMes.map(r => `
              <div class="bar-row">
                <div class="bar-label">${r.mes.substring(5)}</div>
                <div class="bar-track">
                  <div class="bar bar-red" style="width:${(r.competencia/maxPag*100).toFixed(0)}%"></div>
                </div>
                <div class="bar-value">${Fmt.currency(r.competencia)}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Resultado (Competência)</h3></div>
          <div class="card-body">
            ${meses.map((m, i) => {
              const res = recPorMes[i].competencia - pagPorMes[i].competencia;
              const nomeMes = new Date(Number(m.split('-')[0]), Number(m.split('-')[1]) - 1, 1)
                .toLocaleDateString('pt-BR', { month: 'short' });
              return `
                <div class="info-row">
                  <span style="font-size:.85rem">${nomeMes} ${m.split('-')[0]}</span>
                  <strong class="${res >= 0 ? 'text-green' : 'text-red'}">${Fmt.currency(res)}</strong>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>OS por Mês</h3></div>
          <div class="card-body">
            ${osPorMes.map(o => {
              const nomeMes = new Date(Number(o.mes.split('-')[0]), Number(o.mes.split('-')[1]) - 1, 1)
                .toLocaleDateString('pt-BR', { month: 'short' });
              return `
                <div class="info-row">
                  <span style="font-size:.85rem">${nomeMes}</span>
                  <span style="font-size:.85rem"><strong>${o.total}</strong> abertas · <strong class="text-green">${o.fechadas}</strong> fechadas</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Top 5 Clientes</h3></div>
          <div class="card-body">
            ${topClientes.length === 0 ? '<p class="text-muted">Sem dados</p>' :
              topClientes.map(([nome, val], i) => `
                <div class="info-row">
                  <div style="display:flex;align-items:center;gap:8px">
                    <span style="width:22px;height:22px;border-radius:50%;background:var(--navy);color:#fff;font-size:.7rem;font-weight:800;display:flex;align-items:center;justify-content:center">${i+1}</span>
                    <span style="font-size:.875rem">${nome}</span>
                  </div>
                  <strong class="text-green">${Fmt.currency(val)}</strong>
                </div>
              `).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Top 5 Despesas</h3></div>
          <div class="card-body">
            ${topCategorias.length === 0 ? '<p class="text-muted">Sem dados</p>' :
              topCategorias.map(([nome, val], i) => `
                <div class="info-row">
                  <div style="display:flex;align-items:center;gap:8px">
                    <span style="width:22px;height:22px;border-radius:50%;background:var(--danger);color:#fff;font-size:.7rem;font-weight:800;display:flex;align-items:center;justify-content:center">${i+1}</span>
                    <span style="font-size:.875rem">${nome}</span>
                  </div>
                  <strong class="text-red">${Fmt.currency(val)}</strong>
                </div>
              `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  return { render };
})();
