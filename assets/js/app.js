// ============================================================
// APP - Roteador e inicialização
// ============================================================

const App = (() => {
  const pages = ['home','agenda','os','financeiro','clientes','estoque','compras','fiado','insights','config'];
  // v1.3: sub-páginas que vivem dentro de uma página pai no nav.
  // App.navigate('fiado') automaticamente roteia pra dentro de Financeiro.
  const SUB_PAGES = {
    compras:  'estoque',
    fiado:    'financeiro',
    agenda:   'home',
  };
  let currentPage = 'home';
  let currentParent = 'home'; // para active state no nav quando estamos numa sub-página
  let allClientes = [];
  let allCategorias = [];
  let allContas = [];

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
    const modules = { home: Home, agenda: Agenda, os: OS, financeiro: Financeiro, clientes: Clientes,
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
    const [cliRes, catRes, conRes] = await Promise.all([
      API.db.read('clientes'),
      API.db.read('categorias'),
      API.db.read('contas'),
      // Aquece o cache do estoque no boot (não vira global — os.js/estoque.js
      // leem via API.db.read). Sem isso, a 1ª OS/orçamento em campo offline
      // poderia vir sem itens do estoque pra escolher.
      API.db.read('estoque').catch(() => null),
      // Aquece OS + sessões + materiais no boot pra rodar a OS em campo offline.
      // Têm TTL longo no api.js (OFFLINE_WORK_SHEETS); aquecer aqui garante que
      // estejam no cache mesmo num boot frio sem rede no dia seguinte.
      API.db.read('os').catch(() => null),
      API.db.read('diarias').catch(() => null),
      API.db.read('os_itens').catch(() => null),
      // Aquece as sheets "frias" que abriam com spinner (Compras/Lista, Fiado,
      // A fazer). Fire-and-forget: não bloqueiam o boot e servem do cache (SWR)
      // quando a aba abre, com refetch em background.
      API.db.read('compras').catch(() => null),
      API.db.read('lista_compras').catch(() => null),
      API.db.read('estoque_movimentacoes').catch(() => null),
      API.db.read('fiado_mov').catch(() => null),
      API.db.read('fiado').catch(() => null),
      API.db.read('compromissos').catch(() => null),
    ]);
    allClientes   = (cliRes?.data  || []).filter(c => c.ativo !== false && c.ativo !== 'false')
                                          .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' }));
    allCategorias = (catRes?.data  || []).filter(c => c.ativo !== false && c.ativo !== 'false');
    allContas     = (conRes?.data  || []).filter(c => c.ativo !== false && c.ativo !== 'false')
                                          .sort((a, b) => (Number(a.ordem)||0) - (Number(b.ordem)||0));
  }

  function getClientes()   { return allClientes; }
  function getCategorias() { return allCategorias; }
  function getContas()     { return allContas; }

  function contaNome(id) {
    const c = allContas.find(x => x.id === id);
    return c ? c.nome : (id ? '—' : '');
  }

  function contaOptions(selected = '', placeholder = 'Selecione conta...') {
    return `<option value="">${placeholder}</option>` +
      allContas.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${c.nome}</option>`).join('');
  }

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

    // Botão "voltar" do Android/navegador: em vez de sair do app, volta de tela.
    // Se houver um modal/overlay aberto, o voltar fecha ele e mantém a tela atual.
    window.addEventListener('hashchange', () => {
      const aberto = document.querySelector('.modal.open, .modal-center.open, #action-sheet.open, #doc-overlay.open');
      if (aberto) {
        if (typeof Modal !== 'undefined')       Modal.closeAll();
        if (typeof ActionSheet !== 'undefined') ActionSheet.close?.();
        if (typeof Doc !== 'undefined')          Doc.fechar();
        // re-sincroniza o hash com a tela atual sem disparar nova navegação
        if ((location.hash || '').replace(/^#/, '') !== currentPage) {
          history.replaceState(null, '', '#' + currentPage);
        }
        return;
      }
      const page = (location.hash || '').replace(/^#/, '') || 'home';
      if (pages.includes(page) && page !== currentPage) navigate(page);
    });

    // Badge de notificações (a partir do que estiver salvo de sessões anteriores)
    if (typeof Notif !== 'undefined') Notif.init();

    // Protege o armazenamento antes de qualquer coisa (não bloqueia o boot)
    pedirStoragePersistente();

    // Boot decide se mostra splash ou entra direto
    await bootApp();

    // Contas fixas: pede ao backend pra gerar as parcelas do mês (1x por dia)
    verificaRecorrentes();
  }

  // Pede armazenamento PERSISTENTE ao navegador. Sem isto os dados do app são
  // "best-effort": quando o Android fica sem espaço, o Chrome despeja a ORIGEM
  // INTEIRA por uso menos recente — e leva junto o localStorage com a URL do
  // Apps Script e o token (saretta_config), não só o cache. Era esse o sumiço da
  // conexão no celular. Com o app instalado na tela inicial o Chrome concede sem
  // prompt; no navegador comum pode negar (aí o diagnóstico em Config → Conexão
  // mostra "não protegido"). Idempotente: uma vez concedido, persiste.
  async function pedirStoragePersistente() {
    try {
      if (!navigator.storage?.persist) return;
      if (await navigator.storage.persisted()) return;
      await navigator.storage.persist();
    } catch (e) {}
  }

  // Dispara gerarRecorrentes com throttle diário. A geração roda NO backend
  // (LockService + ultima_geracao = idempotente); aqui é só o gatilho.
  // Backend antigo responde 'Ação inválida' → silêncio (tenta de novo após
  // o dono republicar). Usa _postDireto: só invalida cache se DEU certo —
  // um boot offline não pode apagar o cache que mantém as telas vivas.
  function verificaRecorrentes() {
    if (!LocalConfig.getUrl()) return;
    if (navigator.onLine === false) return;
    const KEY  = 'saretta_recorrentes_check';
    const hoje = DateUtil.today();
    try { if (localStorage.getItem(KEY) === hoje) return; } catch {}
    API._postDireto('gerarRecorrentes', { mes: hoje.substring(0, 7) }).then(r => {
      if (r && (r.success || /inválida|não encontrada/i.test(r.error || ''))) {
        try { localStorage.setItem(KEY, hoje); } catch {}
      }
      if (r?.success && r.geradas > 0 && typeof Notif !== 'undefined') {
        Notif.add({
          tipo: 'money', titulo: `${r.geradas} conta(s) fixa(s) lançada(s)`,
          texto: 'Parcelas do mês geradas automaticamente.',
          action: { page: 'financeiro', params: { tab: 'pagar' } },
          dedupeKey: 'recorrentes-' + hoje.substring(0, 7),
        });
      }
    }).catch(() => {});
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

    // Aguarda todas OU timeout de 10s — o que vier primeiro
    const timeout = new Promise(resolve => setTimeout(resolve, 10000));
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

  return { navigate, init, loadGlobals, getClientes, getCategorias, getContas,
           pedirStoragePersistente,
           clienteNome, categoriaNome, contaNome,
           clienteOptions, categoriaOptions, contaOptions,
           quickAdd, onQuickAddDone,
           getCurrentParent, getCurrentPage, SUB_PAGES };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
