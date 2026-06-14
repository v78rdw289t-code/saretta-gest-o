// ============================================================
// HOME - Dashboard
// ============================================================

const Home = (() => {
  let _searching = false;
  let _searchDebounce = null;
  let _searchSeq = 0; // evita que uma busca antiga sobrescreva uma mais nova
  let _osAndamento = []; // OS em andamento (cache p/ o seletor "Registrar o dia")

  // ─── Privacidade dos valores (R$) ───────────────────────────
  // Default = OCULTO (o app costuma abrir na frente de cliente). O dono toca
  // no olho p/ revelar. Usamos sessionStorage de propósito: a revelação vale
  // só enquanto o app está aberto — fechou e abriu de novo, volta escondido.
  function valoresVisiveis() { return sessionStorage.getItem('home_valores_visiveis') === '1'; }
  function applyValoresVis() {
    const vis = valoresVisiveis();
    const wrap = qs('#home-saldo');
    if (wrap) wrap.classList.toggle('valores-ocultos', !vis);
    const btn = qs('#home-saldo-eye');
    if (btn) {
      btn.textContent = vis ? '🙈' : '👁';
      btn.setAttribute('aria-label', vis ? 'Ocultar valores' : 'Mostrar valores');
    }
  }
  function toggleValores() {
    sessionStorage.setItem('home_valores_visiveis', valoresVisiveis() ? '0' : '1');
    applyValoresVis();
  }

  async function render() {
    const section = qs('#page-home');
    const agora = new Date();
    const hoje = agora.toLocaleDateString('pt-BR', { weekday:'long', day:'numeric', month:'long' });
    const h = agora.getHours();
    const saud = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    const saudIcon = h < 12 ? '☀️' : h < 18 ? '🌤️' : '🌙';

    section.innerHTML = `
      <div class="home-hero">
        <div class="home-hero-top">
          <div>
            <div class="home-greeting">${saudIcon} ${saud}</div>
            <div class="home-date">${hoje}</div>
          </div>
          <img src="assets/img/logo-app.png?v=2.0.22" alt="Saretta" class="home-hero-logo"
            onerror="this.onerror=null;this.src='assets/img/logo-icon.svg'">
        </div>

        <!-- Saldo do mês — oculto por padrão, revela no olho -->
        <div id="home-saldo" class="home-saldo valores-ocultos">
          <div class="home-saldo-skeleton loading-pulse"></div>
        </div>

        <div class="home-search-wrap">
          <input id="home-search" type="search" inputmode="search" enterkeyhint="search" autocomplete="off"
            placeholder="Buscar cliente ou OS..." class="input-search-hero"
            oninput="Home.onSearchInput()"
            onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();Home.search(true);}">
          <button id="home-search-clear" class="home-search-clear-btn hidden" onclick="Home.clearSearch()" title="Limpar busca">✕</button>
        </div>
      </div>

      <div id="home-search-results" class="hidden"></div>

      <!-- Registrar o dia — atalho direto pro registro de horas de uma OS -->
      <div id="home-registrar" class="card registrar-card">
        <div class="registrar-head">
          <span class="registrar-icon">⏱</span>
          <div>
            <div class="registrar-title">Registrar o dia</div>
            <div class="registrar-sub">Escolha uma OS e lance as horas de hoje</div>
          </div>
        </div>
        <div id="home-registrar-body">
          <div class="loading-pulse" style="height:46px;border-radius:12px"></div>
        </div>
      </div>

      <div class="quick-row">
        <button class="quick-action" onclick="App.navigate('os').then(() => OS.openForm())">
          <span class="quick-action-icon qa-navy">📋</span>
          <span class="quick-action-label">Nova OS</span>
        </button>
        <button class="quick-action" onclick="App.navigate('clientes').then(() => Clientes.openForm())">
          <span class="quick-action-icon qa-blue">👤</span>
          <span class="quick-action-label">Cliente</span>
        </button>
        <button class="quick-action" onclick="App.navigate('financeiro').then(() => Financeiro.openManual())">
          <span class="quick-action-icon qa-green">💰</span>
          <span class="quick-action-label">Lançar</span>
        </button>
        <button class="quick-action" onclick="App.navigate('os').then(() => OS.openListaCompras())">
          <span class="quick-action-icon qa-gold">🛒</span>
          <span class="quick-action-label">Compras</span>
        </button>
      </div>

      <div id="home-stats" class="home-stats">
        <div class="home-insights loading-pulse" style="min-height:120px"></div>
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
    `;

    applyValoresVis();

    // Dispara em paralelo, SEM await — Home aparece imediato com skeleton
    // e cada bloco se preenche sozinho assim que os dados chegam.
    loadStats();
    if (!LocalConfig.getUrl()) {
      qs('#home-os-andamento').innerHTML = '<p class="text-muted p-3">Configure a conexão em Configurações</p>';
      qs('#home-registrar-body').innerHTML = '<p class="text-muted" style="font-size:.82rem;margin:0">Configure a conexão para registrar.</p>';
      return;
    }
    loadOSAndamento();
  }

  // Calcula stats no FRONTEND a partir das sheets já em cache.
  // Replica a lógica do backend getDashboardStats() — quando OS e parcelas
  // estão em cache, é instantâneo (zero requests).
  function computeStatsLocal(osList, parcelas) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const em7   = new Date(today); em7.setDate(em7.getDate() + 7);
    const mes   = new Date().toISOString().substring(0, 7);
    const reais = parcelas.filter(p => p.origem !== 'transferencia');

    const osAndamento = osList.filter(o => o.status === 'andamento').length;
    const osAcerto    = osList.filter(o => o.status === 'acerto').length;

    const recMes = reais.filter(p => p.tipo === 'receber' && String(p.data_competencia || '').startsWith(mes));
    const pagMes = reais.filter(p => p.tipo === 'pagar'   && String(p.data_competencia || '').startsWith(mes));
    const sum = (arr) => arr.reduce((s, p) => s + Number(p.valor || 0), 0);
    const recPago  = sum(recMes.filter(p => p.status === 'pago'));
    const recTotal = sum(recMes);
    const pagPago  = sum(pagMes.filter(p => p.status === 'pago'));
    const pagTotal = sum(pagMes);

    // Pendentes (de qualquer mês) — para "a receber" e "vencendo"
    const pendRec = reais.filter(p => p.tipo === 'receber' && p.status === 'pendente');
    const aReceberTotal = sum(pendRec);

    // Vencendo nos próximos 7 dias — datas zeradas evitam erro de timezone
    const venc7 = reais.filter(p => {
      if (p.status !== 'pendente') return false;
      const d = new Date(p.data_vencimento + 'T00:00:00');
      if (isNaN(d.getTime())) return false;
      return d >= today && d <= em7;
    });
    // Já vencidas (pendentes com vencimento no passado)
    const vencidas = pendRec.filter(p => {
      const d = new Date(p.data_vencimento + 'T00:00:00');
      return !isNaN(d.getTime()) && d < today;
    });

    // Mês anterior (para tendência) — mesmo critério: competência + pago
    const mesAntD = new Date(); mesAntD.setDate(1); mesAntD.setMonth(mesAntD.getMonth() - 1);
    const mesAnt  = mesAntD.toISOString().substring(0, 7);
    const recPagoAnt = sum(reais.filter(p => p.tipo === 'receber' && p.status === 'pago' && String(p.data_competencia||'').startsWith(mesAnt)));
    const pagPagoAnt = sum(reais.filter(p => p.tipo === 'pagar'   && p.status === 'pago' && String(p.data_competencia||'').startsWith(mesAnt)));

    // OS em andamento parada há mais tempo (dias desde o início)
    let osParadaDias = 0;
    osList.filter(o => o.status === 'andamento').forEach(o => {
      const d = new Date((o.data_inicio || '') + 'T00:00:00');
      if (!isNaN(d.getTime())) {
        const dias = Math.floor((today - d) / 86400000);
        if (dias > osParadaDias) osParadaDias = dias;
      }
    });

    return {
      os_andamento: osAndamento, os_acerto: osAcerto,
      rec_total: recTotal, rec_pago: recPago,
      pag_total: pagTotal, pag_pago: pagPago,
      saldo_mes: recPago - pagPago,
      saldo_ant: recPagoAnt - pagPagoAnt,
      a_receber_total: aReceberTotal,
      a_receber_mes: recTotal - recPago,
      pend_rec_qtd: pendRec.length,
      vencendo_7d: venc7.length,
      vencidas_qtd: vencidas.length,
      vencidas_valor: sum(vencidas),
      os_parada_dias: osParadaDias,
    };
  }

  // Monta a lista de insights do dashboard — SEM expor valores em R$.
  // Cada insight: { icon, tone, title, sub, onclick? }
  function buildInsights(d) {
    const ins = [];

    // 1. Saúde do mês (status, sem cifras) + tendência vs mês anterior
    const pos = (d.saldo_mes || 0) >= 0;
    let trendSub = pos ? 'saldo positivo no mês' : 'saldo negativo no mês';
    if (typeof d.saldo_ant === 'number' && (d.saldo_ant !== 0 || d.saldo_mes !== 0)) {
      if (d.saldo_mes > d.saldo_ant)      trendSub = 'melhor que o mês passado';
      else if (d.saldo_mes < d.saldo_ant) trendSub = 'abaixo do mês passado';
      else                                trendSub = 'igual ao mês passado';
    }
    ins.push({
      icon: pos ? '📈' : '📉', tone: pos ? 'green' : 'red',
      title: pos ? 'Mês no azul' : 'Mês no vermelho', sub: trendSub,
      onclick: "App.navigate('financeiro').then(() => Financeiro.switchTab('resumo'))",
    });

    // 2. Contas vencidas (alerta)
    if (d.vencidas_qtd > 0) ins.push({
      icon: '⚠️', tone: 'red',
      title: `${d.vencidas_qtd} conta${d.vencidas_qtd > 1 ? 's' : ''} vencida${d.vencidas_qtd > 1 ? 's' : ''}`,
      sub: d.vencidas_qtd > 1 ? 'precisam de atenção' : 'precisa de atenção',
      onclick: "App.navigate('financeiro', { filtro: 'vencendo7d' })",
    });

    // 3. Vencendo nos próximos 7 dias
    if (d.vencendo_7d > 0) ins.push({
      icon: '⏰', tone: 'gold',
      title: `${d.vencendo_7d} vence${d.vencendo_7d > 1 ? 'm' : ''} essa semana`,
      sub: 'próximos 7 dias',
      onclick: "App.navigate('financeiro', { filtro: 'vencendo7d' })",
    });

    // 4. Recebimentos em aberto → abre o financeiro já nas parcelas a receber pendentes
    if (d.pend_rec_qtd > 0) ins.push({
      icon: '💵', tone: 'blue',
      title: `${d.pend_rec_qtd} recebimento${d.pend_rec_qtd > 1 ? 's' : ''} em aberto`,
      sub: 'ver parcelas a receber',
      onclick: "App.navigate('financeiro', { tab: 'receber', status: 'pendente' })",
    });

    // 5. Ordens de serviço — uma linha por status, cada uma abre a lista já filtrada
    if (d.os_andamento > 0) ins.push({
      icon: '🔧', tone: 'navy',
      title: `${d.os_andamento} OS em andamento`,
      sub: 'ver ordens ativas',
      onclick: "App.navigate('os').then(() => OS.setStatus('andamento'))",
    });
    if (d.os_acerto > 0) ins.push({
      icon: '🤝', tone: 'orange',
      title: `${d.os_acerto} OS em acerto`,
      sub: 'aguardando acerto',
      onclick: "App.navigate('os').then(() => OS.setStatus('acerto'))",
    });

    // 6. OS parada há muito tempo
    if (d.os_parada_dias >= 10) ins.push({
      icon: '🕒', tone: 'orange',
      title: `OS parada há ${d.os_parada_dias} dias`,
      sub: 'talvez precise de acerto', onclick: "App.navigate('os')",
    });

    // 7. Tudo calmo
    if (d.vencidas_qtd === 0 && d.vencendo_7d === 0) ins.push({
      icon: '✅', tone: 'green', title: 'Sem contas vencidas', sub: 'tudo em dia por aqui',
    });

    return ins;
  }

  async function loadStats() {
    if (!LocalConfig.getUrl()) {
      qs('#home-stats').innerHTML = `
        <div class="card" style="grid-column:1/-1;padding:16px 18px">
          <p class="text-muted" style="margin:0">⚙️ Configure a URL do Apps Script em <strong>Configurações</strong></p>
        </div>`;
      const saldo = qs('#home-saldo');
      if (saldo) saldo.innerHTML = '<div class="home-saldo-config">⚙️ Configure a conexão</div>';
      return;
    }

    // Caminho rápido: stats calculadas LOCAL se OS e parcelas estão em cache
    if (API.db.isCached('os') && API.db.isCached('parcelas')) {
      const [osRes, parRes] = await Promise.all([
        API.db.read('os'),
        API.db.read('parcelas'),
      ]);
      if (osRes?.success && parRes?.success) {
        renderDash(computeStatsLocal(osRes.data || [], parRes.data || []));
        return;
      }
    }

    // Fallback: chama o backend stats() — usado na primeira vez
    const res = await API.db.stats();
    if (!res?.success) return;
    renderDash(res.data);
  }

  function renderDash(d) {
    renderSaldo(d);
    renderStatsCard(d);
  }

  // Resumo financeiro do mês (caixa) no topo — valores maskáveis.
  function renderSaldo(d) {
    const el = qs('#home-saldo');
    if (!el) return;
    const saldo = Number(d.saldo_mes || 0);
    const pos = saldo >= 0;
    const v = (n) => `<span class="val-sensivel">${Fmt.currency(n)}</span>`;

    el.innerHTML = `
      <div class="home-saldo-head">
        <span class="home-saldo-label">Saldo do mês</span>
        <button id="home-saldo-eye" class="home-saldo-eye" onclick="Home.toggleValores()" aria-label="Mostrar valores">👁</button>
      </div>
      <div class="home-saldo-value ${pos ? 'is-pos' : 'is-neg'}">${v(saldo)}</div>
      <div class="home-saldo-grid">
        <div class="home-saldo-mini">
          <span class="hsm-label">Recebido</span>
          <span class="hsm-value pos">${v(d.rec_pago || 0)}</span>
        </div>
        <div class="home-saldo-mini">
          <span class="hsm-label">Pago</span>
          <span class="hsm-value neg">${v(d.pag_pago || 0)}</span>
        </div>
        <div class="home-saldo-mini">
          <span class="hsm-label">A receber</span>
          <span class="hsm-value gold">${v(d.a_receber_total || 0)}</span>
        </div>
      </div>
    `;
    applyValoresVis();
  }

  function renderStatsCard(d) {
    const insights = buildInsights(d);
    qs('#home-stats').innerHTML = `
      <div class="home-insights">
        <div class="home-insights-head">
          <span>💡 Resumo de hoje</span>
        </div>
        ${insights.map(i => `
          <div class="insight-row tone-${i.tone} ${i.onclick ? 'insight-clickable' : ''}"
            ${i.onclick ? `onclick="${i.onclick}"` : ''}>
            <span class="insight-icon">${i.icon}</span>
            <div class="insight-body">
              <div class="insight-title">${i.title}</div>
              <div class="insight-sub">${i.sub}</div>
            </div>
            ${i.onclick ? '<span class="insight-chevron">›</span>' : ''}
          </div>
        `).join('')}
      </div>
    `;
    maybeLembrete(d);
  }

  // Lembrete local de contas: aparece no máximo 1x por dia, ao abrir o app,
  // quando há contas vencidas ou vencendo nos próximos 7 dias. Toast clicável
  // que leva ao Financeiro já filtrado. Os mesmos números ficam nos insights
  // acima — aqui é só o "empurrão" ativo na abertura.
  function maybeLembrete(d) {
    const vencidas = Number(d.vencidas_qtd || 0);
    const vencendo = Number(d.vencendo_7d || 0);
    if (vencidas === 0 && vencendo === 0) return;

    // Chave do dia em horário LOCAL (evita o off-by-one do toISOString em UTC)
    const n = new Date();
    const hoje = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    if (localStorage.getItem('lembrete_contas_dia') === hoje) return;
    localStorage.setItem('lembrete_contas_dia', hoje);

    const partes = [];
    if (vencidas > 0) partes.push(`${vencidas} vencida${vencidas > 1 ? 's' : ''}`);
    if (vencendo > 0) partes.push(`${vencendo} vencendo essa semana`);
    const msg = `Contas: ${partes.join(' e ')} · toque para ver`;

    // Espera a home assentar (e o splash sair) antes de aparecer
    setTimeout(() => {
      Toast.show(msg, 'warning', 8000,
        () => App.navigate('financeiro', { filtro: 'vencendo7d' }));
    }, 900);
  }

  async function loadOSAndamento() {
    // Caminho rápido: se 'os' inteira está em cache, filtra local sem novo request
    if (API.db.isCached('os')) {
      const res = await API.db.read('os');
      const items = (res?.data || []).filter(o => o.status === 'andamento');
      _osAndamento = items;
      renderRegistrarDia(items);
      return renderOSAndamento(items);
    }
    const res = await API.db.read('os', null, { status: 'andamento' });
    _osAndamento = res?.data || [];
    renderRegistrarDia(_osAndamento);
    renderOSAndamento(_osAndamento);
  }

  // Card "Registrar o dia": seletor das OS em andamento + botão que entra
  // direto na OS e abre o registro de horas (OS.registrarDiaEm).
  function renderRegistrarDia(items) {
    const body = qs('#home-registrar-body');
    if (!body) return;
    if (!items || items.length === 0) {
      body.innerHTML = `
        <p class="registrar-empty">Nenhuma OS em andamento.</p>
        <button class="btn btn-outline btn-full" onclick="App.navigate('os').then(() => OS.openForm())">＋ Abrir nova OS</button>`;
      return;
    }
    const ordenadas = [...items].sort((a, b) => (a.data_criacao > b.data_criacao ? -1 : 1));
    body.innerHTML = `
      <div class="registrar-row">
        <select id="reg-dia-os" class="input registrar-select">
          ${ordenadas.map(o => {
            const titulo = o.nome || App.clienteNome(o.cliente_id);
            const num = (o.numero || '').replace('OS-', '');
            return `<option value="${o.id}">#${num} · ${titulo}</option>`;
          }).join('')}
        </select>
        <button class="btn btn-primary registrar-go" onclick="Home.irRegistrar()">Lançar →</button>
      </div>
    `;
  }

  function irRegistrar() {
    const sel = qs('#reg-dia-os');
    const id = sel?.value;
    if (!id) { Toast.warning('Selecione uma OS'); return; }
    OS.registrarDiaEm(id);
  }

  function renderOSAndamento(items) {
    items = items.sort((a, b) => a.data_criacao > b.data_criacao ? -1 : 1);
    if (items.length === 0) {
      qs('#home-os-andamento').innerHTML = '<div class="entity-empty">Nenhuma OS em andamento 🎉</div>';
      return;
    }
    qs('#home-os-andamento').innerHTML = `
      <div class="entity-list" style="border-radius:0;border:none;box-shadow:none">
        ${items.slice(0, 8).map(o => `
          <div class="entity-item" onclick="App.navigate('os').then(() => OS.openDetail('${o.id}'))">
            <div class="avatar av-blue"><span style="font-size:.72rem;font-weight:800">${(o.numero||'').replace('OS-','')}</span></div>
            <div class="entity-info">
              <div class="entity-name">${o.nome || App.clienteNome(o.cliente_id)}</div>
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

  function onSearchInput() {
    const val = (qs('#home-search')?.value || '').trim();
    const clearBtn = qs('#home-search-clear');
    if (clearBtn) clearBtn.classList.toggle('hidden', !val);

    clearTimeout(_searchDebounce);
    if (!val) { if (_searching) clearSearch(); return; }
    // Busca automática enquanto digita (a partir de 2 caracteres), sem precisar de Enter
    if (val.length >= 2) {
      _searchDebounce = setTimeout(() => search(false), 350);
    }
  }

  function clearSearch() {
    clearTimeout(_searchDebounce);
    _searchSeq++; // invalida qualquer busca em voo
    const inp = qs('#home-search');
    if (inp) inp.value = '';
    const clearBtn = qs('#home-search-clear');
    if (clearBtn) clearBtn.classList.add('hidden');
    const results = qs('#home-search-results');
    if (results) { results.classList.add('hidden'); results.innerHTML = ''; }
    _searching = false;
  }

  async function search(autoScroll = true) {
    const q = qs('#home-search')?.value.trim();
    if (!q) return;
    _searching = true;
    const seq = ++_searchSeq;

    const shown = Loading.maybeShow('clientes', 'os');
    const [cliRes, osRes] = await Promise.all([
      API.db.read('clientes'),
      API.db.read('os'),
    ]);
    if (shown) Loading.hide();

    // Se outra busca mais recente começou enquanto esta carregava, aborta.
    if (seq !== _searchSeq) return;
    // O usuário pode ter limpado o campo durante o carregamento.
    if (!qs('#home-search')?.value.trim()) return;

    const clientes = filterRecords(cliRes?.data || [], q, ['nome','telefone','endereco']);
    const osList   = filterRecords(osRes?.data  || [], q, ['numero','nome','observacoes']);

    const resultsEl = qs('#home-search-results');
    resultsEl.classList.remove('hidden');

    const total = clientes.length + osList.length;
    let html = `
      <div class="search-results-card">
        <div class="search-results-header">
          <h3>${total} resultado${total !== 1 ? 's' : ''} para "${q}"</h3>
          <button class="btn btn-sm btn-outline" onclick="Home.clearSearch()">✕ Limpar</button>
        </div>
    `;

    if (clientes.length > 0) {
      html += `
        <div style="padding:10px 18px 4px;font-size:.7rem;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:.6px">
          Clientes (${clientes.length})
        </div>
        <div class="entity-list" style="border-radius:0;border:none;box-shadow:none">
          ${clientes.map(c => `
            <div class="entity-item" onclick="App.navigate('clientes').then(() => Clientes.openDetail('${c.id}'))">
              <div class="avatar ${avatarColor(c.nome)}">${getInitials(c.nome)}</div>
              <div class="entity-info">
                <div class="entity-name">${c.nome}</div>
                <div class="entity-sub">${c.endereco || c.telefone || ''}</div>
              </div>
              <span class="entity-chevron">›</span>
            </div>`).join('')}
        </div>
      `;
    }

    if (osList.length > 0) {
      html += `
        <div style="padding:10px 18px 4px;font-size:.7rem;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:.6px">
          OS (${osList.length})
        </div>
        <div class="entity-list" style="border-radius:0;border:none;box-shadow:none">
          ${osList.map(o => `
            <div class="entity-item" onclick="App.navigate('os').then(() => OS.openDetail('${o.id}'))">
              <div class="avatar av-navy"><span style="font-size:.72rem;font-weight:800">${(o.numero||'').replace('OS-','')}</span></div>
              <div class="entity-info">
                <div class="entity-name">${o.nome || App.clienteNome(o.cliente_id)}</div>
                <div class="entity-sub">${o.numero} · ${App.clienteNome(o.cliente_id)} · ${Fmt.date(o.data_inicio)}</div>
              </div>
              ${statusBadge(o.status)}
            </div>`).join('')}
        </div>
      `;
    }

    if (total === 0) {
      html += `<div class="entity-empty">Nenhum resultado para "${q}"</div>`;
    }

    html += '</div>';
    resultsEl.innerHTML = html;
    if (autoScroll) resultsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  return { render, search, clearSearch, onSearchInput, toggleValores, irRegistrar };
})();
