// ============================================================
// INSIGHTS
// ============================================================

const Insights = (() => {
  async function render() {
    const section = qs('#page-insights');
    section.innerHTML = `
      <div class="page-header"><h1>Insights</h1></div>
      <p class="text-muted mb-4">Análise dos últimos 6 meses</p>
      <div id="insights-content">
        <div class="loading-pulse p-4">Carregando dados...</div>
      </div>
    `;
    await loadInsights();
  }

  async function loadInsights() {
    Loading.show();
    const [parRes, osRes] = await Promise.all([
      API.db.read('parcelas'),
      API.db.read('os'),
    ]);
    Loading.hide();

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

    // OS por mês
    const osPorMes = meses.map(m => ({
      mes: m,
      total: osList.filter(o => String(o.data_criacao||'').startsWith(m)).length,
      fechadas: osList.filter(o => o.status === 'fechado' && String(o.data_atualizacao||'').startsWith(m)).length,
    }));

    // Top clientes por valor
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

    qs('#insights-content').innerHTML = `
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
          <div class="card-header"><h3>Resultado por Mês (Competência)</h3></div>
          <div class="card-body">
            ${meses.map((m, i) => {
              const res = recPorMes[i].competencia - pagPorMes[i].competencia;
              return `
                <div class="info-row">
                  <span>${m}</span>
                  <strong class="${res >= 0 ? 'text-green' : 'text-red'}">${Fmt.currency(res)}</strong>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>OS por Mês</h3></div>
          <div class="card-body">
            ${osPorMes.map(o => `
              <div class="info-row">
                <span>${o.mes}</span>
                <span>${o.total} abertas / ${o.fechadas} fechadas</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Top 5 Clientes (Receita Total)</h3></div>
          <div class="card-body">
            ${topClientes.length === 0 ? '<p class="text-muted">Sem dados</p>' :
              topClientes.map(([nome, val]) => `
                <div class="info-row">
                  <span>${nome}</span>
                  <strong class="text-green">${Fmt.currency(val)}</strong>
                </div>
              `).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Top 5 Categorias de Despesa</h3></div>
          <div class="card-body">
            ${topCategorias.length === 0 ? '<p class="text-muted">Sem dados</p>' :
              topCategorias.map(([nome, val]) => `
                <div class="info-row">
                  <span>${nome}</span>
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
