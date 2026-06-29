// ============================================================
// HOME - Dashboard (v2.9 — redesenho)
// Topo limpo (sem valores) + OS em andamento + Estoque +
// Últimos lançamentos (sem cifras). Equilíbrio entre atalhos
// e informação relevante, sem comprometer a privacidade.
// ============================================================

const Home = (() => {
  let _searching = false;
  let _searchDebounce = null;
  let _searchSeq = 0; // evita que uma busca antiga sobrescreva uma mais nova

  const MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  function dataCurta(s) {
    const d = new Date(String(s || '').substring(0, 10) + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    return `${d.getDate()} ${MESES[d.getMonth()]}`;
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
          <img src="assets/img/logo-app.png?v=2.9.0" alt="Saretta" class="home-hero-logo"
            onerror="this.onerror=null;this.src='assets/img/logo-icon.svg'">
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

      <!-- OS em andamento — primeira seção (o que está rodando agora) -->
      <div class="home-section-head">
        <h2 class="home-section-title">🔧 OS em andamento</h2>
        <div class="home-section-actions">
          <button class="home-section-add" onclick="App.navigate('os').then(() => OS.openForm())">＋ Nova</button>
          <button class="home-section-link" onclick="App.navigate('os')">Ver todas ›</button>
        </div>
      </div>
      <div id="home-os-andamento">
        <div class="os-cards">
          <div class="loading-pulse" style="height:112px;border-radius:15px"></div>
          <div class="loading-pulse" style="height:112px;border-radius:15px"></div>
        </div>
      </div>

      <!-- Estoque — card-hub do módulo (acesso + lançar compra + lista + resumo) -->
      <div class="card estq-card">
        <div class="estq-head" onclick="App.navigate('estoque')">
          <span class="estq-icon">📦</span>
          <div style="flex:1;min-width:0">
            <div class="estq-title">Estoque</div>
            <div class="estq-sub" id="home-estoque-info">—</div>
          </div>
          <span class="entity-chevron">›</span>
        </div>
        <div class="estq-actions">
          <button onclick="App.navigate('compras').then(() => Compras.openForm())">🛒 Lançar compra</button>
          <button onclick="Estoque.goTab('lista')">📝 Lista</button>
        </div>
      </div>

      <!-- Últimos lançamentos — sem valores (privacidade) -->
      <div class="home-section-head">
        <h2 class="home-section-title">💰 Últimos lançamentos</h2>
        <div class="home-section-actions">
          <button class="home-section-add" onclick="App.navigate('financeiro').then(() => Financeiro.openManual())">＋ Lançar</button>
          <button class="home-section-link" onclick="App.navigate('financeiro')">Ver todos ›</button>
        </div>
      </div>
      <div id="home-lancamentos" class="card lanc-card">
        <div class="loading-pulse" style="height:58px;border-radius:12px;margin:6px"></div>
      </div>
    `;

    // Sem URL configurada: mostra orientação e para por aqui.
    if (!LocalConfig.getUrl()) {
      const cfgMsg = '<p class="text-muted p-3" style="margin:0">Configure a conexão em Configurações</p>';
      qs('#home-os-andamento').innerHTML = cfgMsg;
      qs('#home-lancamentos').innerHTML = cfgMsg;
      const est = qs('#home-estoque-info'); if (est) est.textContent = 'Configure a conexão';
      return;
    }

    // Dispara em paralelo, SEM await — cada bloco se preenche sozinho.
    loadOSAndamento();
    loadEstoqueCard();
    loadUltimosLancamentos();
    loadLembrete();
  }

  // Preenche o resumo do card de Estoque na home (nº de itens + quantos a repor).
  async function loadEstoqueCard() {
    const el = qs('#home-estoque-info');
    if (!el) return;
    const res = await API.db.read('estoque');
    const itens = (res?.data || []).filter(e => e.ativo !== false && e.ativo !== 'false');
    const repor = itens.filter(e => {
      const m = Number(e.estoque_minimo || 0);
      return m > 0 && Number(e.quantidade || 0) <= m;
    }).length;
    el.innerHTML = itens.length === 0
      ? 'Nenhum item cadastrado'
      : `${itens.length} ${itens.length === 1 ? 'item' : 'itens'}` +
        (repor > 0 ? ` · <span class="repor">${repor} a repor</span>` : ' · tudo em ordem');
  }

  // ─── OS em andamento ─────────────────────────────────────────
  async function loadOSAndamento() {
    // Caminho rápido: se 'os' inteira está em cache, filtra local sem novo request
    if (API.db.isCached('os')) {
      const res = await API.db.read('os');
      return renderOSAndamento((res?.data || []).filter(o => o.status === 'andamento'));
    }
    const res = await API.db.read('os', null, { status: 'andamento' });
    renderOSAndamento(res?.data || []);
  }

  function renderOSAndamento(items) {
    items = (items || []).sort((a, b) => a.data_criacao > b.data_criacao ? -1 : 1);
    if (items.length === 0) {
      qs('#home-os-andamento').innerHTML = '<div class="os-card-empty">✅ Nenhuma OS em andamento</div>';
      return;
    }
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    qs('#home-os-andamento').innerHTML = `
      <div class="os-cards">
        ${items.slice(0, 8).map(o => {
          const num = (o.numero || '').replace('OS-', '');
          const titulo = o.nome || App.clienteNome(o.cliente_id);
          const cliente = App.clienteNome(o.cliente_id);
          const ini = new Date((o.data_inicio || '') + 'T00:00:00');
          const dias = !isNaN(ini.getTime()) ? Math.max(0, Math.floor((hoje - ini) / 86400000)) : null;
          const catNome = o.categoria_id ? App.categoriaNome(o.categoria_id) : '';
          return `
            <button class="os-card" onclick="App.navigate('os').then(() => OS.openDetail('${o.id}'))">
              <div class="os-card-top">
                <span class="os-card-num">#${num}</span>
                ${catNome ? `<span class="os-card-tipo is-normal">${catNome}</span>` : ''}
              </div>
              <div class="os-card-title">${titulo}</div>
              ${titulo !== cliente ? `<div class="os-card-cli">👤 ${cliente}</div>` : ''}
              <div class="os-card-foot">
                <span>${dias === null ? '' : dias === 0 ? 'Começou hoje' : `há ${dias} dia${dias > 1 ? 's' : ''}`}</span>
                <span class="os-card-go">Abrir ›</span>
              </div>
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  // ─── Últimos lançamentos (sem cifras) ────────────────────────
  async function loadUltimosLancamentos() {
    const el = qs('#home-lancamentos');
    if (!el) return;
    const res = await API.db.read('parcelas');
    const todas = (res?.data || []).filter(p => p.origem !== 'transferencia');
    // Ordem de INSERÇÃO: as parcelas voltam na ordem das linhas da planilha
    // (o backend faz appendRow no fim). As últimas inseridas estão no fim do
    // array → pega as últimas e inverte p/ mostrar a mais nova primeiro.
    // (Não ordena por data de venc./pagto — senão parcelas futuras a pagar
    //  subiriam pro topo mesmo tendo sido lançadas há muito tempo.)
    const ordenadas = todas.slice(-6).reverse();

    if (ordenadas.length === 0) {
      el.innerHTML = '<p class="lanc-empty">Nenhum lançamento ainda</p>';
      return;
    }

    // Data exibida (não é critério de ordem): pago → pagamento; senão venc./comp.
    const dataRef = p => String(p.data_pagamento || p.data_vencimento || p.data_competencia || '').substring(0, 10);
    el.innerHTML = ordenadas.map(p => {
      const receita = p.tipo === 'receber';
      const pago    = p.status === 'pago';
      const cat     = p.categoria_id ? App.categoriaNome(p.categoria_id) : '';
      const sub     = [(cat && cat !== '—') ? cat : '', dataCurta(dataRef(p))].filter(Boolean).join(' · ');
      const desc    = p.descricao || (receita ? 'Recebimento' : 'Pagamento');
      return `
        <div class="lanc-row" onclick="Home.abrirLancamento('${p.id}')">
          <span class="lanc-ico ${receita ? 'is-rec' : 'is-pag'}">${receita ? '↑' : '↓'}</span>
          <div class="lanc-body">
            <div class="lanc-desc">${desc}</div>
            <div class="lanc-sub">${sub}</div>
          </div>
          <span class="lanc-status ${pago ? 'is-pago' : 'is-pend'}">${pago ? '✓ Pago' : '○ Pendente'}</span>
        </div>`;
    }).join('');
  }

  // Abre o lançamento no Financeiro (modal de edição). Usa o padrão seguro
  // (replaceState ANTES) p/ o hashchange da navegação não fechar o modal.
  async function abrirLancamento(id) {
    history.replaceState(null, '', '#financeiro');
    await App.navigate('financeiro');
    if (typeof Financeiro !== 'undefined') Financeiro.editarParcela(id);
  }

  // ─── Lembrete / notificações (sem exibir nada na home) ───────
  // Mantém a central de notificações e o toast diário de contas, mesmo
  // sem o antigo "Resumo de hoje" na tela.
  function computeLembreteStats(osList, parcelas) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const em7   = new Date(today); em7.setDate(em7.getDate() + 7);
    const reais = parcelas.filter(p => p.origem !== 'transferencia');

    const pendRec = reais.filter(p => p.tipo === 'receber' && p.status === 'pendente');
    const venc7 = reais.filter(p => {
      if (p.status !== 'pendente') return false;
      const d = new Date(p.data_vencimento + 'T00:00:00');
      return !isNaN(d.getTime()) && d >= today && d <= em7;
    });
    const vencidas = pendRec.filter(p => {
      const d = new Date(p.data_vencimento + 'T00:00:00');
      return !isNaN(d.getTime()) && d < today;
    });

    let osParadaDias = 0;
    osList.filter(o => o.status === 'andamento').forEach(o => {
      const d = new Date((o.data_inicio || '') + 'T00:00:00');
      if (!isNaN(d.getTime())) {
        const dias = Math.floor((today - d) / 86400000);
        if (dias > osParadaDias) osParadaDias = dias;
      }
    });

    return { vencidas_qtd: vencidas.length, vencendo_7d: venc7.length, os_parada_dias: osParadaDias };
  }

  async function loadLembrete() {
    if (!(API.db.isCached('os') && API.db.isCached('parcelas'))) {
      // Sem cache ainda: lê em background; os blocos já dispararam os fetches.
    }
    const [osRes, parRes] = await Promise.all([
      API.db.read('os'),
      API.db.read('parcelas'),
    ]);
    if (!osRes?.success || !parRes?.success) return;
    maybeLembrete(computeLembreteStats(osRes.data || [], parRes.data || []));
  }

  // Lembrete local de contas: aparece no máximo 1x por dia, ao abrir o app,
  // quando há contas vencidas ou vencendo nos próximos 7 dias. Toast clicável
  // que leva ao Financeiro já filtrado + notificações persistentes na central.
  function maybeLembrete(d) {
    const vencidas = Number(d.vencidas_qtd || 0);
    const vencendo = Number(d.vencendo_7d || 0);
    const osParada = Number(d.os_parada_dias || 0);

    // 1) Notificações persistentes na central (dedupe diário pelo próprio Notif)
    if (typeof Notif !== 'undefined') {
      if (vencidas > 0) Notif.add({
        tipo: 'danger',
        titulo: `${vencidas} conta${vencidas > 1 ? 's' : ''} vencida${vencidas > 1 ? 's' : ''}`,
        texto: 'Há contas em atraso — toque para ver no Financeiro.',
        action: { page: 'financeiro', params: { tab: 'pagar', status: 'pendente' } },
        dedupeKey: 'contas-vencidas',
      });
      if (vencendo > 0) Notif.add({
        tipo: 'warning',
        titulo: `${vencendo} conta${vencendo > 1 ? 's' : ''} vencendo essa semana`,
        texto: 'Vence nos próximos 7 dias.',
        action: { page: 'financeiro', params: { filtro: 'vencendo7d' } },
        dedupeKey: 'contas-vencendo',
      });
      if (osParada >= 10) Notif.add({
        tipo: 'os',
        titulo: `OS parada há ${osParada} dias`,
        texto: 'Uma OS em andamento está sem registro de sessão.',
        action: { page: 'os' },
        dedupeKey: 'os-parada',
      });
    }

    // 2) Toast diário (só p/ contas)
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

    setTimeout(() => {
      Toast.show(msg, 'warning', 8000,
        () => App.navigate('financeiro', { filtro: 'vencendo7d' }));
    }, 900);
  }

  // ─── Busca ───────────────────────────────────────────────────
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

  // ─── Calculadora rápida (modal em index.html; mantida p/ uso futuro) ──
  async function openCalculadoraHome() {
    const cfg  = await Calculator.getConfig();
    const taxa = Calculator.cfgNum(cfg, 'valor_hora_manutencao', 0) || Calculator.cfgNum(cfg, 'valor_hora', 90);
    const modal = qs('#modal-calc-home');
    if (!modal) return;
    qs('#calc-home-taxa').value = taxa;
    qs('#calc-home-horas').value = '';
    qs('#calc-home-result').textContent = 'R$ 0,00';
    Modal.open('modal-calc-home');
    setTimeout(() => qs('#calc-home-horas')?.focus(), 200);
  }

  function calcHomeUpdate() {
    const horas = Number(qs('#calc-home-horas')?.value || 0);
    const taxa  = Number(qs('#calc-home-taxa')?.value  || 0);
    const total = horas * taxa;
    const el = qs('#calc-home-result');
    if (el) el.textContent = Fmt.currency(total);
  }

  return { render, search, clearSearch, onSearchInput, abrirLancamento, openCalculadoraHome, calcHomeUpdate };
})();
