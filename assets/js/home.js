// ============================================================
// HOME - Dashboard
// ============================================================

const Home = (() => {
  async function render() {
    const section = qs('#page-home');
    section.innerHTML = `
      <div class="page-header">
        <h1>Dashboard</h1>
        <div class="search-bar">
          <input id="home-search" type="text" placeholder="Buscar cliente ou OS..." class="input-search">
          <button class="btn btn-outline" onclick="Home.search()">Buscar</button>
        </div>
      </div>

      <div id="home-stats" class="stats-grid">
        <div class="stat-card loading-pulse"><span>Carregando...</span></div>
      </div>

      <div class="grid-2col">
        <div>
          <div class="card">
            <div class="card-header">
              <h3>Ações Rápidas</h3>
            </div>
            <div class="quick-actions">
              <button class="quick-btn" onclick="App.navigate('clientes'); Clientes.openForm()">
                <span class="qb-icon">👥</span>Novo Cliente
              </button>
              <button class="quick-btn" onclick="App.navigate('os'); OS.openForm()">
                <span class="qb-icon">📋</span>Nova OS
              </button>
              <button class="quick-btn" onclick="App.navigate('financeiro'); Financeiro.openManual()">
                <span class="qb-icon">💰</span>Lançamento
              </button>
              <button class="quick-btn" onclick="App.navigate('compras'); Compras.openForm()">
                <span class="qb-icon">🛍️</span>Nova Compra
              </button>
              <button class="quick-btn gold" onclick="App.navigate('os'); OS.openListaCompras()">
                <span class="qb-icon">🛒</span>Lista Compras
              </button>
            </div>
          </div>
        </div>

        <div>
          <div class="card">
            <div class="card-header">
              <h3>Próximos Vencimentos (7 dias)</h3>
            </div>
            <div id="home-vencimentos" class="list-items">
              <p class="text-muted">Carregando...</p>
            </div>
          </div>
        </div>
      </div>

      <div class="card mt-4">
        <div class="card-header">
          <h3>OS em Andamento</h3>
          <button class="btn btn-sm btn-outline" onclick="App.navigate('os')">Ver todas</button>
        </div>
        <div id="home-os-andamento" class="table-responsive">
          <p class="text-muted p-3">Carregando...</p>
        </div>
      </div>

      <div id="home-search-results" class="card mt-4 hidden">
        <div class="card-header">
          <h3>Resultados da Busca</h3>
          <button class="btn btn-sm btn-outline" onclick="qs('#home-search-results').classList.add('hidden')">✕</button>
        </div>
        <div id="home-search-content"></div>
      </div>
    `;

    await loadStats();
    if (!LocalConfig.getUrl()) {
      qs('#home-vencimentos').innerHTML = '<p class="text-muted p-2">— Configure a conexão para ver dados —</p>';
      qs('#home-os-andamento').innerHTML = '<p class="text-muted p-3">— Configure a conexão para ver dados —</p>';
      return;
    }
    await loadOSAndamento();
    await loadVencimentos();

    qs('#home-search').addEventListener('keydown', e => { if (e.key === 'Enter') Home.search(); });
  }

  async function loadStats() {
    if (!LocalConfig.getUrl()) {
      qs('#home-stats').innerHTML = `
        <div class="stat-card" style="grid-column:1/-1">
          <p class="text-muted">⚙️ Configure a URL do Apps Script em <strong>Configurações</strong> para conectar ao banco de dados.</p>
        </div>`;
      return;
    }
    const res = await API.db.stats();
    if (!res?.success) return;
    const d = res.data;
    qs('#home-stats').innerHTML = `
      <div class="stat-card stat-blue">
        <div class="stat-label">OS em Andamento</div>
        <div class="stat-value">${d.os_andamento}</div>
      </div>
      <div class="stat-card stat-orange">
        <div class="stat-label">OS em Acerto</div>
        <div class="stat-value">${d.os_acerto}</div>
      </div>
      <div class="stat-card stat-green">
        <div class="stat-label">A Receber (mês)</div>
        <div class="stat-value">${Fmt.currency(d.rec_total - d.rec_pago)}</div>
        <div class="stat-sub">Recebido: ${Fmt.currency(d.rec_pago)}</div>
      </div>
      <div class="stat-card stat-red">
        <div class="stat-label">A Pagar (mês)</div>
        <div class="stat-value">${Fmt.currency(d.pag_total - d.pag_pago)}</div>
        <div class="stat-sub">Pago: ${Fmt.currency(d.pag_pago)}</div>
      </div>
      <div class="stat-card ${d.saldo_mes >= 0 ? 'stat-green' : 'stat-red'}">
        <div class="stat-label">Saldo do Mês (caixa)</div>
        <div class="stat-value">${Fmt.currency(d.saldo_mes)}</div>
      </div>
      <div class="stat-card stat-orange">
        <div class="stat-label">Vencendo em 7 dias</div>
        <div class="stat-value">${d.vencendo_7d}</div>
      </div>
    `;
  }

  async function loadOSAndamento() {
    const res = await API.db.read('os', null, { status: 'andamento' });
    const items = res?.data || [];
    if (items.length === 0) {
      qs('#home-os-andamento').innerHTML = '<p class="text-muted p-3">Nenhuma OS em andamento</p>';
      return;
    }
    const rows = items.slice(0, 10).map(o => `
      <tr class="clickable" onclick="App.navigate('os'); OS.openDetail('${o.id}')">
        <td>${o.numero}</td>
        <td>${App.clienteNome(o.cliente_id)}</td>
        <td>${tipoBadge(o.tipo)}</td>
        <td>${Fmt.date(o.data_inicio)}</td>
        <td>${statusBadge(o.status)}</td>
      </tr>
    `).join('');
    qs('#home-os-andamento').innerHTML = `
      <table class="table">
        <thead><tr><th>Número</th><th>Cliente</th><th>Tipo</th><th>Início</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  async function loadVencimentos() {
    const res = await API.db.read('parcelas');
    const today = new Date();
    const items = (res?.data || []).filter(p => {
      if (p.status !== 'pendente') return false;
      const d = new Date(p.data_vencimento + 'T00:00:00');
      const diff = (d - today) / 86400000;
      return diff >= 0 && diff <= 7;
    }).sort((a, b) => a.data_vencimento > b.data_vencimento ? 1 : -1);

    if (items.length === 0) {
      qs('#home-vencimentos').innerHTML = '<p class="text-muted p-2">Nenhum vencimento nos próximos 7 dias</p>';
      return;
    }
    qs('#home-vencimentos').innerHTML = items.map(p => `
      <div class="list-item" onclick="App.navigate('financeiro')">
        <div>
          <div class="list-item-title">${p.descricao}</div>
          <div class="list-item-sub">Vence: ${Fmt.date(p.data_vencimento)}</div>
        </div>
        <div class="list-item-right">
          <span class="badge ${p.tipo === 'receber' ? 'badge-success' : 'badge-danger'}">${Fmt.currency(p.valor)}</span>
        </div>
      </div>
    `).join('');
  }

  async function search() {
    const q = qs('#home-search').value.trim();
    if (!q) return;

    Loading.show();
    const [cliRes, osRes] = await Promise.all([
      API.db.read('clientes'),
      API.db.read('os'),
    ]);
    Loading.hide();

    const clientes = filterRecords(cliRes?.data || [], q, ['nome','telefone','endereco']);
    const osList   = filterRecords(osRes?.data  || [], q, ['numero','observacoes']);

    const resultsEl = qs('#home-search-results');
    const contentEl = qs('#home-search-content');
    resultsEl.classList.remove('hidden');

    let html = '';
    if (clientes.length > 0) {
      html += `<h4 class="p-3 pb-1">Clientes (${clientes.length})</h4>`;
      html += clientes.map(c => `
        <div class="list-item clickable" onclick="App.navigate('clientes'); Clientes.openDetail('${c.id}')">
          <div>
            <div class="list-item-title">${c.nome}</div>
            <div class="list-item-sub">${c.telefone || ''} ${c.endereco || ''}</div>
          </div>
        </div>
      `).join('');
    }
    if (osList.length > 0) {
      html += `<h4 class="p-3 pb-1">Ordens de Serviço (${osList.length})</h4>`;
      html += osList.map(o => `
        <div class="list-item clickable" onclick="App.navigate('os'); OS.openDetail('${o.id}')">
          <div>
            <div class="list-item-title">${o.numero} — ${App.clienteNome(o.cliente_id)}</div>
            <div class="list-item-sub">${statusBadge(o.status)} ${tipoBadge(o.tipo)}</div>
          </div>
          <div class="list-item-right">${Fmt.date(o.data_inicio)}</div>
        </div>
      `).join('');
    }
    if (!html) html = '<p class="p-3 text-muted">Nenhum resultado encontrado.</p>';
    contentEl.innerHTML = html;
  }

  return { render, search };
})();
