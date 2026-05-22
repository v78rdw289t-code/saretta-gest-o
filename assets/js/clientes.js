// ============================================================
// CLIENTES / FORNECEDORES
// ============================================================

const Clientes = (() => {
  let allClientes = [];

  async function render() {
    await loadData();
    renderList();
  }

  async function loadData() {
    Loading.show();
    const res = await API.db.read('clientes');
    Loading.hide();
    allClientes = res?.data || [];
  }

  function renderList(q = '', filtroTipo = '') {
    let items = allClientes.filter(c => c.ativo !== false && c.ativo !== 'false');
    if (filtroTipo) items = items.filter(c => c.tipo === filtroTipo || c.tipo === 'ambos');
    if (q) items = filterRecords(items, q, ['nome','telefone','endereco']);

    const section = qs('#page-clientes');
    section.innerHTML = `
      <div class="page-header">
        <h1>Clientes / Fornecedores</h1>
        <button class="btn btn-primary" onclick="Clientes.openForm()">+ Novo</button>
      </div>
      <div class="filters-bar">
        <input type="text" id="cli-search" placeholder="Buscar..." class="input-search" value="${q}"
          oninput="Clientes.applyFilters()">
        <select id="cli-tipo" class="input-select" onchange="Clientes.applyFilters()">
          <option value="">Todos</option>
          <option value="cliente"    ${filtroTipo==='cliente'    ?'selected':''}>Clientes</option>
          <option value="fornecedor" ${filtroTipo==='fornecedor' ?'selected':''}>Fornecedores</option>
          <option value="ambos"      ${filtroTipo==='ambos'      ?'selected':''}>Ambos</option>
        </select>
      </div>
      <div class="card">
        <div class="table-responsive">
          ${items.length === 0 ? '<p class="p-3 text-muted">Nenhum cadastro encontrado.</p>' : `
          <table class="table">
            <thead><tr><th>Nome</th><th>Tipo</th><th>Telefone</th><th>Endereço</th><th></th></tr></thead>
            <tbody>
              ${items.map(c => `
                <tr class="clickable" onclick="Clientes.openDetail('${c.id}')">
                  <td><strong>${c.nome}</strong></td>
                  <td><span class="badge ${c.tipo==='cliente'?'badge-info':c.tipo==='fornecedor'?'badge-secondary':'badge-success'}">${c.tipo}</span></td>
                  <td>${c.telefone || '—'}</td>
                  <td>${c.endereco || '—'}</td>
                  <td>
                    <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); Clientes.openForm('${c.id}')">Editar</button>
                    <button class="btn btn-sm btn-danger"  onclick="event.stopPropagation(); Clientes.confirmDelete('${c.id}')">Excluir</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>`}
        </div>
      </div>
    `;
  }

  function applyFilters() {
    renderList(qs('#cli-search')?.value || '', qs('#cli-tipo')?.value || '');
  }

  async function openDetail(id) {
    const c = allClientes.find(x => x.id === id);
    if (!c) return;

    const [osRes, parRes] = await Promise.all([
      API.db.read('os', null, { cliente_id: id }),
      API.db.read('parcelas', null, { cliente_id: id }),
    ]);
    const osList  = (osRes?.data  || []).sort((a, b) => a.data_criacao > b.data_criacao ? -1 : 1);
    const parcelas= (parRes?.data || []).sort((a, b) => a.data_vencimento > b.data_vencimento ? -1 : 1);
    const totalRec= parcelas.filter(p => p.tipo === 'receber').reduce((s, p) => s + Number(p.valor||0), 0);
    const totalPag= parcelas.filter(p => p.tipo === 'pagar').reduce((s, p) => s + Number(p.valor||0), 0);
    const totalRecebido= parcelas.filter(p => p.tipo === 'receber' && p.status === 'pago').reduce((s, p) => s + Number(p.valor||0), 0);

    const section = qs('#page-clientes');
    section.innerHTML = `
      <div class="page-header">
        <button class="btn btn-outline" onclick="Clientes.render()">← Voltar</button>
        <h1>${c.nome}</h1>
        <button class="btn btn-outline" onclick="Clientes.openForm('${c.id}')">Editar</button>
      </div>

      <div class="grid-2col">
        <div class="card">
          <div class="card-header"><h3>Dados</h3></div>
          <div class="card-body info-grid">
            <div><label>Tipo</label><span class="badge badge-info">${c.tipo}</span></div>
            <div><label>Telefone</label>${c.telefone || '—'}</div>
            <div class="full-width"><label>Endereço</label>${c.endereco || '—'}</div>
            ${c.observacoes ? `<div class="full-width"><label>Observações</label>${c.observacoes}</div>` : ''}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Financeiro</h3></div>
          <div class="card-body">
            <div class="info-row"><span>Total a Receber</span><strong class="text-green">${Fmt.currency(totalRec)}</strong></div>
            <div class="info-row"><span>Total Recebido</span><strong class="text-blue">${Fmt.currency(totalRecebido)}</strong></div>
            <div class="info-row"><span>Saldo pendente</span><strong class="text-orange">${Fmt.currency(totalRec - totalRecebido)}</strong></div>
            <div class="info-row"><span>Total Pago (compras)</span><strong class="text-red">${Fmt.currency(totalPag)}</strong></div>
          </div>
        </div>
      </div>

      <div class="card mt-4">
        <div class="card-header"><h3>Ordens de Serviço</h3></div>
        <div class="table-responsive">
          ${osList.length === 0 ? '<p class="p-3 text-muted">Nenhuma OS</p>' : `
          <table class="table">
            <thead><tr><th>Número</th><th>Tipo</th><th>Status</th><th>Início</th><th>Valor</th></tr></thead>
            <tbody>
              ${osList.map(o => `
                <tr class="clickable" onclick="App.navigate('os', {id:'${o.id}'})">
                  <td>${o.numero}</td>
                  <td>${tipoBadge(o.tipo)}</td>
                  <td>${statusBadge(o.status)}</td>
                  <td>${Fmt.date(o.data_inicio)}</td>
                  <td>${Fmt.currency(o.valor_fechamento || o.valor_calculado)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>`}
        </div>
      </div>

      <div class="card mt-4">
        <div class="card-header"><h3>Movimentações Financeiras</h3></div>
        <div class="table-responsive">
          ${parcelas.length === 0 ? '<p class="p-3 text-muted">Nenhuma movimentação</p>' : `
          <table class="table">
            <thead><tr><th>Descrição</th><th>Tipo</th><th>Vencimento</th><th>Valor</th><th>Status</th></tr></thead>
            <tbody>
              ${parcelas.map(p => `
                <tr>
                  <td>${p.descricao}</td>
                  <td><span class="badge ${p.tipo==='receber'?'badge-success':'badge-danger'}">${p.tipo}</span></td>
                  <td>${Fmt.date(p.data_vencimento)}</td>
                  <td>${Fmt.currency(p.valor)}</td>
                  <td>${statusBadge(p.status)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>`}
        </div>
      </div>
    `;
  }

  function openForm(id = null) {
    const c = id ? allClientes.find(x => x.id === id) : null;
    qs('#cli-form-id').value       = id || '';
    qs('#cli-form-nome').value     = c?.nome || '';
    qs('#cli-form-tipo').value     = c?.tipo || 'cliente';
    qs('#cli-form-tel').value      = c?.telefone || '';
    qs('#cli-form-end').value      = c?.endereco || '';
    qs('#cli-form-obs').value      = c?.observacoes || '';
    qs('#modal-cli-title').textContent = id ? 'Editar Cliente/Fornecedor' : 'Novo Cliente/Fornecedor';
    Modal.open('modal-cliente');
  }

  async function saveForm() {
    const id   = qs('#cli-form-id').value;
    const data = {
      nome:       qs('#cli-form-nome').value.trim(),
      tipo:       qs('#cli-form-tipo').value,
      telefone:   qs('#cli-form-tel').value.trim(),
      endereco:   qs('#cli-form-end').value.trim(),
      observacoes:qs('#cli-form-obs').value.trim(),
      ativo:      true,
    };
    if (!data.nome) { Toast.warning('Nome é obrigatório'); return; }
    if (!id) data.data_cadastro = DateUtil.today();

    Loading.show();
    const res = id ? await API.db.update('clientes', id, data) : await API.db.create('clientes', data);
    Loading.hide();

    if (res?.success) {
      Toast.success(id ? 'Atualizado!' : 'Cadastrado!');
      Modal.close('modal-cliente');
      await loadData();
      await App.loadGlobals();
      renderList();
    } else Toast.error('Erro: ' + res?.error);
  }

  async function confirmDelete(id) {
    Modal.confirm('Inativar este cadastro?', async () => {
      await API.db.update('clientes', id, { ativo: false });
      Toast.success('Inativado');
      await loadData();
      await App.loadGlobals();
      renderList();
    });
  }

  return { render, renderList, applyFilters, openDetail, openForm, saveForm, confirmDelete };
})();
