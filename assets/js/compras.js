// ============================================================
// COMPRAS
// ============================================================

const Compras = (() => {
  let allCompras = [];
  let itensForm  = [];
  let estoqueList = [];

  async function render() {
    await loadData();
    renderList();
  }

  async function loadData() {
    const shown = Loading.maybeShow('compras');
    const res = await API.db.read('compras');
    if (shown) Loading.hide();
    allCompras = (res?.data || []).sort((a, b) => a.data > b.data ? -1 : 1);
  }

  function renderList() {
    const section = qs('#page-compras');
    section.innerHTML = `
      ${Estoque.tabsHTML('compras')}
      <div class="page-header">
        <h1>Compras</h1>
        <button class="btn btn-primary" onclick="Compras.openForm()">+ Nova Compra</button>
      </div>
      <div class="entity-list">
        ${allCompras.length === 0
          ? '<div class="entity-empty">Nenhuma compra registrada</div>'
          : allCompras.map(c => {
            const forn = App.clienteNome(c.fornecedor_id);
            return `
              <div class="entity-item" onclick="Compras.tapCard('${c.id}')">
                <div class="avatar ${avatarColor(forn)} avatar-icon">🛒</div>
                <div class="entity-info">
                  <div class="entity-name">${forn || 'Fornecedor não informado'}</div>
                  <div class="entity-sub">${Fmt.date(c.data)}${c.observacoes ? ' · ' + c.observacoes : ''}</div>
                </div>
                <div class="entity-right">
                  <span class="entity-value text-red">${Fmt.currency(c.valor_total)}</span>
                  <span class="entity-chevron">›</span>
                </div>
              </div>
            `;
          }).join('')}
      </div>
    `;
  }

  async function openDetail(id) {
    const compra = allCompras.find(c => c.id === id);
    if (!compra) return;

    Loading.show();
    const [itensRes, parRes] = await Promise.all([
      API.db.read('compras_itens', null, { compra_id: id }),
      API.db.read('parcelas', null, { origem_id: id }),
    ]);
    Loading.hide();
    const itens    = itensRes?.data || [];
    const parcelas = (parRes?.data || []).sort((a, b) => a.data_vencimento > b.data_vencimento ? 1 : -1);

    const section = qs('#page-compras');
    section.innerHTML = `
      <div class="page-header">
        <button class="btn btn-outline" onclick="Compras.render()">← Voltar</button>
        <h1>Compra — ${Fmt.date(compra.data)}</h1>
        <button class="btn btn-danger" onclick="Compras.confirmDelete('${id}')">Excluir</button>
      </div>
      <div class="grid-2col">
        <div class="card">
          <div class="card-header"><h3>Itens Comprados</h3></div>
          <div class="table-responsive">
            ${itens.length === 0 ? '<p class="p-3 text-muted">Sem itens</p>' : `
            <table class="table">
              <thead><tr><th>Descrição</th><th>Qtd</th><th>Un.</th><th>Unit.</th><th>Total</th></tr></thead>
              <tbody>
                ${itens.map(i => `
                  <tr>
                    <td>${i.descricao}</td>
                    <td>${i.quantidade}</td>
                    <td>${i.unidade || 'un'}</td>
                    <td>${Fmt.currency(i.valor_unit)}</td>
                    <td>${Fmt.currency(i.valor_total)}</td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot>
                <tr class="table-total">
                  <td colspan="4"><strong>Total</strong></td>
                  <td><strong>${Fmt.currency(compra.valor_total)}</strong></td>
                </tr>
              </tfoot>
            </table>`}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Parcelas / Pagamentos</h3></div>
          <div class="table-responsive">
            ${parcelas.length === 0 ? '<p class="p-3 text-muted">Sem parcelas</p>' : `
            <table class="table">
              <thead><tr><th>Vencimento</th><th>Valor</th><th>Status</th><th></th></tr></thead>
              <tbody>
                ${parcelas.map(p => `
                  <tr>
                    <td>${Fmt.date(p.data_vencimento)}</td>
                    <td>${Fmt.currency(p.valor)}</td>
                    <td>${statusBadge(p.status)}</td>
                    <td>
                      ${p.status === 'pendente' ? `<button class="btn btn-sm btn-success" onclick="App.navigate('financeiro').then(() => Financeiro.openPagamento('${p.id}'))">Pagar</button>` : ''}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>`}
          </div>
        </div>
      </div>
    `;
  }

  // trava de duplo clique (Guard) — o corpo real está em _confirmDelete
  function confirmDelete(id) { return Guard.run('compra-excluir', () => _confirmDelete(id)); }
  async function _confirmDelete(id) {
    Modal.confirm(
      'Excluir esta compra? As parcelas serão removidas. O estoque NÃO será revertido automaticamente.',
      async () => {
        Loading.show();
        const [itensRes, parRes] = await Promise.all([
          API.db.read('compras_itens', null, { compra_id: id }),
          API.db.read('parcelas', null, { origem_id: id }),
        ]);
        const itens    = itensRes?.data || [];
        const parcelas = parRes?.data   || [];

        await Promise.all([
          ...itens.map(i    => API.db.delete('compras_itens', i.id)),
          ...parcelas.map(p => API.db.delete('parcelas', p.id)),
        ]);
        await API.db.delete('compras', id);
        Loading.hide();
        Toast.success('Compra excluída.');
        await loadData(); renderList();
      }
    );
  }

  async function openForm() {
    itensForm = [];
    qs('#compra-forn').innerHTML  = App.clienteOptions('fornecedor');
    qs('#compra-data').value      = DateUtil.today();
    qs('#compra-venc').value      = DateUtil.today();
    qs('#compra-comp').value      = DateUtil.today().substring(0, 7);
    qs('#compra-parc').value      = '1';
    qs('#item-cat').innerHTML     = '<option value="">— Categoria —</option>' + App.categoriaOptions('saida');
    qs('#compra-obs').value       = '';
    if (qs('#compra-desconto')) qs('#compra-desconto').value = '0';
    const qp = qs('#compra-quempagou');
    if (qp) qp.value = '';
    qs('#compra-quempagou-hint')?.classList.add('hidden');
    await loadEstoque();
    renderItensForm();
    Modal.open('modal-compra');
  }

  async function loadEstoque() {
    const res = await API.db.read('estoque');
    estoqueList = (res?.data || []).filter(e => e.ativo !== false && e.ativo !== 'false');
    const sel = qs('#item-estoque');
    if (!sel) return;
    sel.innerHTML =
      '<option value="">— Novo item (cadastrar no estoque) —</option>' +
      estoqueList.map(e =>
        `<option value="${e.id}" data-unit="${e.valor_unit}" data-und="${e.unidade || 'un'}" data-cat="${e.categoria_id || ''}">${e.descricao} (Qtd: ${e.quantidade} ${e.unidade || 'un'})</option>`
      ).join('');
  }

  // Ao escolher um item do estoque, preenche descrição/unidade/valor/categoria automaticamente.
  function onSelectEstoque() {
    const sel = qs('#item-estoque');
    if (!sel || !sel.value) return;
    const opt = sel.options[sel.selectedIndex];
    qs('#item-desc').value     = opt.text.split(' (')[0];
    qs('#item-unit-val').value = opt.dataset.unit || '';
    qs('#item-und').value      = opt.dataset.und || 'un';
    if (opt.dataset.cat && qs('#item-cat')) qs('#item-cat').value = opt.dataset.cat;
  }

  function onQuemPagouChange() {
    const v = qs('#compra-quempagou')?.value || '';
    qs('#compra-quempagou-hint')?.classList.toggle('hidden', !v);
  }

  function renderItensForm() {
    const container = qs('#compra-itens-list');
    if (!container) return;
    container.innerHTML = itensForm.length === 0 ? '<p class="text-muted">Nenhum item</p>' :
      itensForm.map((item, i) => {
        const cat = item.categoria_id ? (App.getCategorias().find(c => String(c.id) === String(item.categoria_id))?.nome || '') : '';
        return `
        <div class="item-row">
          <span>${item.descricao} × ${item.quantidade} ${item.unidade||''}${cat ? ' · <em style="color:var(--text-muted)">'+cat+'</em>' : ''} = ${Fmt.currency(item.valor_total)}
            ${item.estoque_id ? '<span class="badge badge-success">↑ estoque</span>' : '<span class="badge badge-secondary">novo</span>'}</span>
          <button type="button" class="btn btn-sm btn-danger" onclick="Compras.removeItem(${i})">✕</button>
        </div>`;
      }).join('');
    const subtotal  = itensForm.reduce((s, i) => s + Number(i.valor_total || 0), 0);
    const desconto  = Number(qs('#compra-desconto')?.value) || 0;
    const totalFinal = Math.max(0, subtotal - desconto);
    if (qs('#compra-subtotal-display')) qs('#compra-subtotal-display').textContent = Fmt.currency(subtotal);
    qs('#compra-total-display').textContent = Fmt.currency(totalFinal);
  }

  function addItem() {
    const estId = qs('#item-estoque')?.value || '';
    const desc  = qs('#item-desc').value.trim();
    const qtd   = Number(qs('#item-qtd').value) || 1;
    const unit  = Number(qs('#item-unit-val').value) || 0;
    const und   = qs('#item-und').value.trim() || 'un';
    const total = qtd * unit;
    const catId = qs('#item-cat')?.value || '';
    if (!desc) { Toast.warning('Informe a descrição do item'); return; }
    itensForm.push({ estoque_id: estId, descricao: desc, quantidade: qtd, valor_unit: unit, valor_total: total, unidade: und, categoria_id: catId });
    if (qs('#item-estoque')) qs('#item-estoque').value = '';
    qs('#item-desc').value = '';
    qs('#item-qtd').value  = '1';
    qs('#item-unit-val').value = '';
    qs('#item-und').value  = '';
    renderItensForm();
  }

  function removeItem(i) {
    itensForm.splice(i, 1);
    renderItensForm();
  }

  // trava de duplo clique (Guard) — o corpo real está em _saveForm
  function saveForm() { return Guard.run('compra-save', _saveForm); }
  async function _saveForm() {
    const fornId    = qs('#compra-forn').value;
    const data      = qs('#compra-data').value;
    const venc      = qs('#compra-venc').value;
    const comp      = qs('#compra-comp').value + '-01';
    const parc      = Number(qs('#compra-parc').value) || 1;
    const obs       = qs('#compra-obs').value;
    const quemPagou = qs('#compra-quempagou')?.value || '';
    const desconto  = Number(qs('#compra-desconto')?.value) || 0;
    const total     = Math.max(0, itensForm.reduce((s, i) => s + Number(i.valor_total || 0), 0) - desconto);

    if (itensForm.length === 0) { Toast.warning('Adicione ao menos um item'); return; }

    Loading.show();
    const res = await API.db.registrarCompra({
      fornecedor_id: fornId, data, valor_total: total,
      parcelas_count: parc, primeira_data_vencimento: venc,
      data_competencia: comp, desconto: desconto,
      quem_pagou: quemPagou || undefined,
      itens: itensForm, observacoes: obs,
    });
    Loading.hide();

    if (res?.success) {
      const msg = quemPagou
        ? `Compra registrada! Foi pra ficha de ${quemPagou}.`
        : 'Compra registrada! Estoque e financeiro atualizados.';
      Toast.success(msg);
      Modal.close('modal-compra');
      await loadData(); renderList();
    } else Toast.error('Erro: ' + res?.error);
  }

  function tapCard(id) {
    openDetail(id);
  }

  return { render, renderList, tapCard, openDetail, confirmDelete, openForm, onSelectEstoque, onQuemPagouChange, addItem, removeItem, saveForm };
})();
