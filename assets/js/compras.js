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
    Loading.show();
    const res = await API.db.read('compras');
    Loading.hide();
    allCompras = (res?.data || []).sort((a, b) => a.data > b.data ? -1 : 1);
  }

  function renderList() {
    const section = qs('#page-compras');
    section.innerHTML = `
      <div class="page-header">
        <h1>Compras</h1>
        <button class="btn btn-primary" onclick="Compras.openForm()">+ Nova Compra</button>
      </div>
      <div class="card">
        <div class="table-responsive">
          ${allCompras.length === 0 ? '<p class="p-3 text-muted">Nenhuma compra registrada.</p>' : `
          <table class="table">
            <thead><tr>
              <th>Data</th><th>Fornecedor</th><th>Total</th><th>Observações</th><th></th>
            </tr></thead>
            <tbody>
              ${allCompras.map(c => `
                <tr class="clickable" onclick="Compras.openDetail('${c.id}')">
                  <td>${Fmt.date(c.data)}</td>
                  <td>${App.clienteNome(c.fornecedor_id)}</td>
                  <td><strong>${Fmt.currency(c.valor_total)}</strong></td>
                  <td>${c.observacoes || '—'}</td>
                  <td>
                    <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); Compras.confirmDelete('${c.id}')">Excluir</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>`}
        </div>
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
                      ${p.status === 'pendente' ? `<button class="btn btn-sm btn-success" onclick="App.navigate('financeiro'); Financeiro.openPagamento('${p.id}')">Pagar</button>` : ''}
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

  async function confirmDelete(id) {
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
    qs('#compra-cat').innerHTML   = App.categoriaOptions('saida');
    qs('#compra-obs').value       = '';
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
        `<option value="${e.id}" data-unit="${e.valor_unit}" data-und="${e.unidade || 'un'}">${e.descricao} (Qtd: ${e.quantidade} ${e.unidade || 'un'})</option>`
      ).join('');
  }

  function onSelectEstoque() {
    const sel = qs('#item-estoque');
    if (!sel.value) return;
    const opt = sel.options[sel.selectedIndex];
    qs('#item-desc').value     = opt.text.split(' (')[0];
    qs('#item-unit-val').value = opt.dataset.unit || '';
    qs('#item-und').value      = opt.dataset.und || 'un';
  }

  function renderItensForm() {
    const container = qs('#compra-itens-list');
    if (!container) return;
    container.innerHTML = itensForm.length === 0 ? '<p class="text-muted">Nenhum item</p>' :
      itensForm.map((item, i) => `
        <div class="item-row">
          <span>${item.descricao} × ${item.quantidade} ${item.unidade||''} = ${Fmt.currency(item.valor_total)}
            ${item.estoque_id ? '<span class="badge badge-success">↑ estoque</span>' : '<span class="badge badge-secondary">novo</span>'}</span>
          <button type="button" class="btn btn-sm btn-danger" onclick="Compras.removeItem(${i})">✕</button>
        </div>
      `).join('');
    const total = itensForm.reduce((s, i) => s + Number(i.valor_total || 0), 0);
    qs('#compra-total-display').textContent = Fmt.currency(total);
  }

  function addItem() {
    const estId = qs('#item-estoque').value;
    const desc  = qs('#item-desc').value.trim();
    const qtd   = Number(qs('#item-qtd').value) || 1;
    const unit  = Number(qs('#item-unit-val').value) || 0;
    const und   = qs('#item-und').value.trim() || 'un';
    const total = qtd * unit;
    if (!desc) { Toast.warning('Informe a descrição do item'); return; }
    itensForm.push({ estoque_id: estId || '', descricao: desc, quantidade: qtd, valor_unit: unit, valor_total: total, unidade: und });
    qs('#item-estoque').value = '';
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

  async function saveForm() {
    const fornId = qs('#compra-forn').value;
    const data   = qs('#compra-data').value;
    const venc   = qs('#compra-venc').value;
    const comp   = qs('#compra-comp').value + '-01';
    const parc   = Number(qs('#compra-parc').value) || 1;
    const catId  = qs('#compra-cat').value;
    const obs    = qs('#compra-obs').value;
    const total  = itensForm.reduce((s, i) => s + Number(i.valor_total || 0), 0);

    if (itensForm.length === 0) { Toast.warning('Adicione ao menos um item'); return; }

    Loading.show();
    const res = await API.db.registrarCompra({
      fornecedor_id: fornId, data, valor_total: total,
      parcelas_count: parc, primeira_data_vencimento: venc,
      data_competencia: comp, categoria_id: catId,
      itens: itensForm, observacoes: obs,
    });
    Loading.hide();

    if (res?.success) {
      Toast.success('Compra registrada! Estoque e financeiro atualizados.');
      Modal.close('modal-compra');
      await loadData(); renderList();
    } else Toast.error('Erro: ' + res?.error);
  }

  return { render, renderList, openDetail, confirmDelete, openForm, onSelectEstoque, addItem, removeItem, saveForm };
})();
