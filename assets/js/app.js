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

  function navigate(page, params = {}) {
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

    // Chamar renderizador do módulo da sub-página
    const modules = { home: Home, os: OS, financeiro: Financeiro, clientes: Clientes,
                      estoque: Estoque, compras: Compras, fiado: Fiado, insights: Insights, config: Config };
    const mod = modules[page];
    if (mod && typeof mod.render === 'function') mod.render(params);

    // Atualizar hash
    window.location.hash = page;

    // Disparar evento para drawer/etc atualizarem estado ativo
    document.dispatchEvent(new CustomEvent('pageChange', { detail: page }));
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

    // Carregar dados globais
    await loadGlobals();

    // Sempre abre na home
    navigate('home');
  }

  return { navigate, init, loadGlobals, getClientes, getCategorias,
           clienteNome, categoriaNome, clienteOptions, categoriaOptions,
           quickAdd, onQuickAddDone,
           getCurrentParent, getCurrentPage, SUB_PAGES };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
