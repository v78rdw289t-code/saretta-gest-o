// ============================================================
// HOME - Dashboard
// ============================================================

const Home = (() => {
  async function render() {
    const section = qs('#page-home');
    const hoje = new Date().toLocaleDateString('pt-BR', { weekday:'long', day:'numeric', month:'long' });

    section.innerHTML = `
      <div style="background:var(--navy);margin:-16px -16px 20px;padding:20px 16px 24px">
        <div style="font-size:.75rem;color:rgba(255,255,255,.5);text-transform:capitalize;margin-bottom:4px">${hoje}</div>
        <div style="font-size:1.3rem;font-weight:800;color:#fff">Saretta Serviços</div>
        <div class="mt-3">
          <input id="home-search" type="text" placeholder="🔍  Buscar cliente ou OS..." class="input-search"
            style="background:rgba(255,255,255,.12);border-color:transparent;color:#fff"
            onkeydown="if(event.key==='Enter') Home.search()">
        </div>
      </div>

      <div id="home-stats" class="stats-grid mb-4">
        <div class="stat-card loading-pulse" style="grid-column:1/-1"><span>Carregando...</span></div>
      </div>

      <div class="card mb-4">
        <div class="card-header"><h3>Ações Rápidas</h3></div>
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
          <button class="quick-btn gold" onclick="App.navigate('os'); OS.openListaCompras()">
            <span class="qb-icon">🛒</span>Lista Compras
          </button>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>OS em Andamento</h3>
          <button class="btn btn-sm btn-outline" onclick="App.navigate('os')">Ver todas</button>
        </div>
        <div id="home-os-andamento">
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
      qs('#home-os-andamento').innerHTML = '<p class="text-muted p-3">Configure a conexão em Configurações</p>';
      return;
    }
    await loadOSAndamento();
  }

  async function loadStats() {
    if (!LocalConfig.getUrl()) {
      qs('#home-stats').innerHTML = `
        <div class="stat-card" style="grid-column:1/-1">
          <p class="text-muted">⚙️ Configure a URL do Apps Script em <strong>Configurações</strong></p>
        </div>`;
      return;
    }
    const res = await API.db.stats();
    if (!res?.success) return;
    const d = res.data;
    qs('#home-stats').innerHTML = `
      <div class="stat-card stat-blue" onclick="App.navigate('os'); OS.setStatus('andamento')" style="cursor:pointer">
        <div class="stat-label">Em Andamento</div>
        <div class="stat-value">${d.os_andamento}</div>
        <div class="stat-sub">OS ativas</div>
      </div>
      <div class="stat-card stat-orange" onclick="App.navigate('os'); OS.setStatus('acerto')" style="cursor:pointer">
        <div class="stat-label">Em Acerto</div>
        <div class="stat-value">${d.os_acerto}</div>
        <div class="stat-sub">aguardando pagamento</div>
      </div>
      <div class="stat-card stat-green">
        <div class="stat-label">A Receber</div>
        <div class="stat-value">${Fmt.currency(d.rec_total - d.rec_pago)}</div>
        <div class="stat-sub">este mês</div>
      </div>
      <div class="stat-card stat-${d.vencendo_7d > 0 ? 'red' : 'navy'}" onclick="App.navigate('financeiro')" style="cursor:pointer">
        <div class="stat-label">Vencendo</div>
        <div class="stat-value">${d.vencendo_7d}</div>
        <div class="stat-sub">próximos 7 dias</div>
      </div>
    `;
  }

  async function loadOSAndamento() {
    const res = await API.db.read('os', null, { status: 'andamento' });
    const items = (res?.data || []).sort((a, b) => a.data_criacao > b.data_criacao ? -1 : 1);
    if (items.length === 0) {
      qs('#home-os-andamento').innerHTML = '<div class="entity-empty">Nenhuma OS em andamento 🎉</div>';
      return;
    }
    qs('#home-os-andamento').innerHTML = `
      <div class="entity-list" style="border-radius:0;border:none;box-shadow:none">
        ${items.slice(0, 8).map(o => `
          <div class="entity-item" onclick="App.navigate('os'); OS.openDetail('${o.id}')">
            <div class="avatar av-blue"><span style="font-size:.72rem;font-weight:800">${(o.numero||'').replace('OS-','')}</span></div>
            <div class="entity-info">
              <div class="entity-name">${App.clienteNome(o.cliente_id)}</div>
              <div class="entity-sub">Início ${Fmt.date(o.data_inicio)} · ${o.tipo === 'diaria' ? 'Diária' : 'Normal'}</div>
            </div>
            <div class="entity-right">
              <span class="entity-chevron">›</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  async function search() {
    const q = qs('#home-search')?.value.trim();
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
      html += `<p class="p-3 pb-1 text-muted" style="font-size:.78rem;font-weight:700;text-transform:uppercase">Clientes (${clientes.length})</p>`;
      html += `<div class="entity-list" style="border-radius:0;border:none;box-shadow:none">` +
        clientes.map(c => `
          <div class="entity-item" onclick="App.navigate('clientes'); Clientes.openDetail('${c.id}')">
            <div class="avatar ${avatarColor(c.nome)}">${getInitials(c.nome)}</div>
            <div class="entity-info">
              <div class="entity-name">${c.nome}</div>
              <div class="entity-sub">${c.endereco || c.telefone || ''}</div>
            </div>
            <span class="entity-chevron">›</span>
          </div>`).join('') + `</div>`;
    }
    if (osList.length > 0) {
      html += `<p class="p-3 pb-1 text-muted" style="font-size:.78rem;font-weight:700;text-transform:uppercase">OS (${osList.length})</p>`;
      html += `<div class="entity-list" style="border-radius:0;border:none;box-shadow:none">` +
        osList.map(o => `
          <div class="entity-item" onclick="App.navigate('os'); OS.openDetail('${o.id}')">
            <div class="avatar av-navy"><span style="font-size:.72rem;font-weight:800">${(o.numero||'').replace('OS-','')}</span></div>
            <div class="entity-info">
              <div class="entity-name">${App.clienteNome(o.cliente_id)}</div>
              <div class="entity-sub">${o.numero} · ${Fmt.date(o.data_inicio)}</div>
            </div>
            ${statusBadge(o.status)}
          </div>`).join('') + `</div>`;
    }
    if (!html) html = '<p class="p-3 text-muted">Nenhum resultado encontrado.</p>';
    contentEl.innerHTML = html;
  }

  return { render, search };
})();
