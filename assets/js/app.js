// ============================================================
// APP - Roteador e inicialização
// ============================================================

const App = (() => {
  const pages = ['home','os','financeiro','clientes','estoque','compras','fiado','insights','config'];
  let currentPage = 'home';
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
    currentPage = page;

    // Atualizar nav (sidebar + bottom)
    const bnavPages = ['home','os','financeiro','clientes'];
    qsa('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
    qsa('.bnav-item[data-page]').forEach(el => el.classList.toggle('active', el.dataset.page === page));
    // Marcar "Mais" ativo se for página do drawer
    const moreBtn = qs('#btn-more');
    if (moreBtn) moreBtn.classList.toggle('active', !bnavPages.includes(page) && page !== 'home');

    // Mostrar página
    qsa('.page').forEach(el => el.classList.toggle('hidden', el.id !== 'page-' + page));

    // Chamar renderizador do módulo
    const modules = { home: Home, os: OS, financeiro: Financeiro, clientes: Clientes,
                      estoque: Estoque, compras: Compras, fiado: Fiado, insights: Insights, config: Config };
    const mod = modules[page];
    if (mod && typeof mod.render === 'function') mod.render(params);

    // Atualizar hash
    window.location.hash = page;
  }

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

  function openDrawer() {
    qs('#more-drawer').classList.add('open');
  }
  function closeDrawer() {
    qs('#more-drawer').classList.remove('open');
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

    // Botão "Mais" — drawer
    qs('#btn-more')?.addEventListener('click', openDrawer);
    qs('#more-drawer-bg')?.addEventListener('click', closeDrawer);
    qsa('.drawer-item').forEach(btn => {
      btn.addEventListener('click', () => { navigate(btn.dataset.page); closeDrawer(); });
    });

    // Marcar ativo no drawer
    document.addEventListener('pageChange', e => {
      qsa('.drawer-item').forEach(b => b.classList.toggle('active', b.dataset.page === e.detail));
    });

    // Carregar dados globais
    await loadGlobals();

    // Rota inicial
    const hash = window.location.hash.replace('#', '');
    navigate(pages.includes(hash) ? hash : 'home');
  }

  return { navigate, init, loadGlobals, getClientes, getCategorias,
           clienteNome, categoriaNome, clienteOptions, categoriaOptions,
           quickAdd, onQuickAddDone };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
