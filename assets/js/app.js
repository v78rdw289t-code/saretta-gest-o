// ============================================================
// APP - Roteador e inicialização
// ============================================================

const App = (() => {
  const pages = ['home','os','financeiro','clientes','estoque','compras','fiado','insights','config'];
  // v1.3: sub-páginas que vivem dentro de uma página pai no nav.
  // App.navigate('fiado') automaticamente roteia pra dentro de Financeiro.
  const SUB_PAGES = {
    estoque:  'os',
    compras:  'financeiro',
    fiado:    'financeiro',
  };
  let currentPage = 'home';
  let currentParent = 'home'; // para active state no nav quando estamos numa sub-página
  let allClientes = [];
  let allCategorias = [];

  // ─── Quick Add (abre form de cliente sem sair da tela) ───
  let _qaSelectId = null;
  let _qaTipo = null;

  function quickAdd(selectId, tipo = 'cliente') {
    _qaSelectId = selectId;
    _qaTipo = tipo;
    // Pré-seleciona o tipo no form
    Clientes.openForm();
    setTimeout(() => {
      const tipoEl = qs('#cli-form-tipo');
      if (tipoEl) tipoEl.value = tipo;
    }, 50);
  }

  async function onQuickAddDone(newId) {
    if (!_qaSelectId) return;
    await loadGlobals();
    const sel = document.getElementById(_qaSelectId);
    if (sel) sel.innerHTML = clienteOptions(_qaTipo, newId);
    _qaSelectId = null;
    _qaTipo = null;
  }

  // Async para que callers possam encadear ações via .then() — evita
  // race condition tipo `App.navigate('os'); OS.openListaCompras()`,
  // que antes sobrescrevia o conteúdo quando o render do OS terminava
  // por último.
  async function navigate(page, params = {}) {
    if (!pages.includes(page)) return;

    // v1.3: se é uma sub-página, ativa o nav do pai mas mostra o conteúdo da sub-página.
    const parent = SUB_PAGES[page] || page;
    currentPage = page;
    currentParent = parent;

    // Atualizar nav (sidebar + bottom) — sempre destacando o PAI
    qsa('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === parent));
    qsa('.bnav-item[data-page]').forEach(el => el.classList.toggle('active', el.dataset.page === parent));

    // Mostrar página (a sub-página específica, não o pai)
    qsa('.page').forEach(el => el.classList.toggle('hidden', el.id !== 'page-' + page));

    // Atualizar hash + evento ANTES do render — quem encadeia espera o await abaixo
    window.location.hash = page;
    document.dispatchEvent(new CustomEvent('pageChange', { detail: page }));

    // Chamar renderizador do módulo e ESPERAR ele terminar
    const modules = { home: Home, os: OS, financeiro: Financeiro, clientes: Clientes,
                      estoque: Estoque, compras: Compras, fiado: Fiado, insights: Insights, config: Config };
    const mod = modules[page];
    if (mod && typeof mod.render === 'function') {
      await mod.render(params);
    }
  }

  function getCurrentParent() { return currentParent; }
  function getCurrentPage()   { return currentPage; }

  async function loadGlobals() {
    if (!LocalConfig.getUrl()) return;
    const [cliRes, catRes] = await Promise.all([
      API.db.read('clientes'),
      API.db.read('categorias'),
    ]);
    allClientes   = (cliRes?.data  || []).filter(c => c.ativo !== false && c.ativo !== 'false');
    allCategorias = (catRes?.data  || []).filter(c => c.ativo !== false && c.ativo !== 'false');
  }

  function getClientes()   { return allClientes; }
  function getCategorias() { return allCategorias; }

  function clienteNome(id) {
    const c = allClientes.find(c => c.id === id);
    return c ? c.nome : id || '—';
  }

  function categoriaNome(id) {
    const c = allCategorias.find(c => c.id === id);
    return c ? c.nome : '—';
  }

  function clienteOptions(tipo = null, selected = '') {
    let list = allClientes;
    if (tipo) list = list.filter(c => c.tipo === tipo || c.tipo === 'ambos');
    return '<option value="">Selecione...</option>' +
      list.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${c.nome}</option>`).join('');
  }

  function categoriaOptions(tipo = null, selected = '') {
    let list = allCategorias;
    if (tipo) list = list.filter(c => c.tipo === tipo || c.tipo === 'ambos');
    return '<option value="">Selecione...</option>' +
      list.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${c.nome}</option>`).join('');
  }

  async function init() {
    // Fechar modais ao clicar no fundo
    document.addEventListener('click', e => {
      if (e.target.classList.contains('modal') || e.target.classList.contains('modal-center')) Modal.closeAll();
    });

    // Sidebar nav (desktop)
    qsa('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => navigate(btn.dataset.page));
    });

    // Bottom nav (mobile)
    qsa('.bnav-item[data-page]').forEach(btn => {
      btn.addEventListener('click', () => navigate(btn.dataset.page));
    });

    // Boot decide se mostra splash ou entra direto
    await bootApp();
  }

  // Decide entre dois caminhos:
  //   A) Tem cache (não-primeira sessão): entra direto na home; prefetch silencioso
  //   B) Sem cache (primeira sessão ou cache expirado): mostra splash e pré-carrega
  //      tudo em paralelo (com timeout de 5s pra não travar se Sheets demorar)
  async function bootApp() {
    const semUrl = !LocalConfig.getUrl();
    const semCache = typeof API !== 'undefined' && !API.hasCache();

    // Sem URL configurada → não vale a pena splash, vai direto pra home
    // (vai mostrar o aviso "Configure a URL").
    if (semUrl) {
      navigate('home');
      return;
    }

    if (semCache) {
      // Caminho B: splash com pré-carga total
      await bootComSplash();
    } else {
      // Caminho A: cache disponível, entra rápido
      await loadGlobals();
      navigate('home');
      setTimeout(() => prefetchMainData(), 600);
    }
  }

  async function bootComSplash() {
    const splash = document.getElementById('boot-splash');
    const status = document.getElementById('boot-splash-status');
    const bar    = document.getElementById('boot-splash-bar');
    if (splash) splash.classList.remove('hidden');
    const setBar = (pct, msg) => {
      if (bar) bar.style.width = pct + '%';
      if (status && msg) status.textContent = msg;
    };
    setBar(8, 'Conectando…');

    // Lista de carregamentos em paralelo
    const tasks = [
      loadGlobals(),                                      // clientes + categorias
      API.db.read('os').catch(() => null),
      API.db.read('parcelas').catch(() => null),
      API.db.read('estoque').catch(() => null),
      API.db.read('diarias').catch(() => null),
      API.db.read('os_itens').catch(() => null),
      API.db.read('compras').catch(() => null),
      API.db.read('fiado').catch(() => null),
    ];

    // Avança a barra conforme as tasks terminam
    let done = 0;
    tasks.forEach(p => p.then(() => {
      done++;
      setBar(8 + Math.round((done / tasks.length) * 88), `Carregando dados (${done}/${tasks.length})…`);
    }));

    // Aguarda todas OU timeout de 5s — o que vier primeiro
    const timeout = new Promise(resolve => setTimeout(resolve, 5000));
    await Promise.race([Promise.all(tasks), timeout]);

    setBar(100, 'Pronto!');
    navigate('home');

    // Fade-out e remove splash
    if (splash) {
      splash.classList.add('fade-out');
      setTimeout(() => splash.classList.add('hidden'), 350);
    }
  }

  // Dispara reads silenciosos pra popular o cache.
  // Não esperamos as promises — só queremos que o cache seja preenchido.
  function prefetchMainData() {
    if (!LocalConfig.getUrl()) return;
    if (typeof API === 'undefined') return;
    API.db.read('os').catch(() => {});
    API.db.read('parcelas').catch(() => {});
    API.db.read('estoque').catch(() => {});
    API.db.read('compras').catch(() => {});
    API.db.read('fiado').catch(() => {});
  }

  return { navigate, init, loadGlobals, getClientes, getCategorias,
           clienteNome, categoriaNome, clienteOptions, categoriaOptions,
           quickAdd, onQuickAddDone,
           getCurrentParent, getCurrentPage, SUB_PAGES };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
