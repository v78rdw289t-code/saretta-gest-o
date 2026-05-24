// ============================================================
// ESTOQUE
// ============================================================

const Estoque = (() => {
  let allEstoque = [];

  async function render() {
    await loadData();
    renderList();
  }

  async function loadData() {
    const shown = Loading.maybeShow('estoque');
    const res = await API.db.read('estoque');
    if (shown) Loading.hide();
    allEstoque = (res?.data || []).filter(e => e.ativo !== false && e.ativo !== 'false');
  }

  function renderList(q = '') {
    let items = allEstoque;
    if (q) items = filterRecords(items, q, ['descricao','unidade']);

    const section = qs('#page-estoque');
    const baixoEstoque = items.filter(e => Number(e.quantidade || 0) <= 2);

    section.innerHTML = `
      <div class="section-tabs">
        <button class="section-tab" onclick="App.navigate('os')">📋 Ordens</button>
        <button class="section-tab active" onclick="App.navigate('estoque')">📦 Estoque</button>
        <button class="section-tab" onclick="OS.openListaCompras()">🛒 Lista Compras</button>
      </div>
      <div class="page-header">
        <h1>Estoque</h1>
        <button class="btn btn-primary" onclick="Estoque.openForm()">+ Novo Item</button>
      </div>
      ${baixoEstoque.length > 0 ? `
        <div class="alert alert-warning mb-3">
          ⚠ ${baixoEstoque.length} item(ns) com estoque baixo: ${baixoEstoque.map(e => e.descricao).join(', ')}
        </div>
      ` : ''}
      <div class="filters-bar">
        <input type="text" id="est-search" placeholder="Buscar..." class="input-search" value="${q}"
          oninput="Estoque.renderList(qs('#est-search').value)">
      </div>
      <div class="entity-list">
        ${items.length === 0
          ? '<div class="entity-empty">Nenhum item no estoque</div>'
          : items.map(e => {
            const baixo = Number(e.quantidade || 0) <= 2;
            return `
              <div class="entity-item${baixo ? '" style="background:var(--warning-lt)' : ''}" onclick="Estoque.tapCard('${e.id}')">
                <div class="avatar ${avatarColor(e.descricao)} avatar-icon">📦</div>
                <div class="entity-info">
                  <div class="entity-name">${e.descricao}${baixo ? ' ⚠️' : ''}</div>
                  <div class="entity-sub">${e.quantidade} ${e.unidade || 'un'} · ${Fmt.currency(e.valor_unit)}/un${e.fornecedor_id ? ' · ' + App.clienteNome(e.fornecedor_id) : ''}</div>
                </div>
                <div class="entity-right">
                  <span class="entity-value">${Fmt.currency(Number(e.valor_unit||0) * Number(e.quantidade||0))}</span>
                  <span class="entity-chevron">›</span>
                </div>
              </div>
            `;
          }).join('')}
        <div class="entity-item" style="background:var(--bg);cursor:default">
          <div class="entity-info"><strong>Total em estoque</strong></div>
          <div class="entity-right"><span class="entity-value">${Fmt.currency(items.reduce((s, e) => s + Number(e.valor_unit||0) * Number(e.quantidade||0), 0))}</span></div>
        </div>
      </div>
    `;
  }

  function tapCard(id) {
    const e = allEstoque.find(x => x.id === id);
    if (!e) return;
    ActionSheet.open(e.descricao, [
      { icon: '✏️', label: 'Editar',  fn: () => openForm(id) },
      { icon: '🗑', label: 'Excluir', fn: () => confirmDelete(id), danger: true },
    ]);
  }

  function openForm(id = null) {
    const e = id ? allEstoque.find(x => x.id === id) : null;
    qs('#est-form-id').value        = id || '';
    qs('#est-form-desc').value      = e?.descricao || '';
    qs('#est-form-qtd').value       = e?.quantidade || '0';
    qs('#est-form-unit').value      = e?.valor_unit || '0';
    qs('#est-form-und').value       = e?.unidade || 'un';
    qs('#est-form-forn').innerHTML  = App.clienteOptions('fornecedor', e?.fornecedor_id);
    qs('#est-form-data').value      = Fmt.dateInput(e?.data_entrada) || DateUtil.today();
    qs('#est-form-obs').value       = e?.observacoes || '';
    qs('#modal-est-title').textContent = id ? 'Editar Item' : 'Novo Item no Estoque';
    Modal.open('modal-estoque');
  }

  async function saveForm() {
    const id   = qs('#est-form-id').value;
    const data = {
      descricao:   qs('#est-form-desc').value.trim(),
      quantidade:  Number(qs('#est-form-qtd').value) || 0,
      valor_unit:  Number(qs('#est-form-unit').value) || 0,
      unidade:     qs('#est-form-und').value.trim() || 'un',
      fornecedor_id:qs('#est-form-forn').value,
      data_entrada: qs('#est-form-data').value,
      observacoes: qs('#est-form-obs').value.trim(),
      ativo:       true,
    };
    if (!data.descricao) { Toast.warning('Informe a descrição'); return; }

    Loading.show();
    const res = id ? await API.db.update('estoque', id, data) : await API.db.create('estoque', data);
    Loading.hide();
    if (res?.success) {
      Toast.success(id ? 'Atualizado!' : 'Item criado!');
      Modal.close('modal-estoque');
      await loadData(); renderList();
    } else Toast.error('Erro: ' + res?.error);
  }

  async function confirmDelete(id) {
    Modal.confirm('Excluir este item do estoque?', async () => {
      await API.db.update('estoque', id, { ativo: false });
      Toast.success('Removido');
      await loadData(); renderList();
    });
  }

  return { render, renderList, tapCard, openForm, saveForm, confirmDelete };
})();
