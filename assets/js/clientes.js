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
    if (filtroTipo) items = items.filter(c => c.tipo === filtroTipo || (filtroTipo === 'ambos' && c.tipo === 'ambos'));
    if (q) items = filterRecords(items, q, ['nome','telefone','endereco']);

    const tipoBadgeCli = t => {
      if (t === 'cliente')    return '<span class="badge badge-info">Cliente</span>';
      if (t === 'fornecedor') return '<span class="badge badge-secondary">Fornecedor</span>';
      return '<span class="badge badge-success">Equipe</span>';
    };

    const section = qs('#page-clientes');
    section.innerHTML = `
      <div class="page-header">
        <h1>Clientes / Fornecedores</h1>
        <button class="btn btn-primary" onclick="Clientes.openForm()">+ Novo</button>
      </div>
      <div class="mb-3">
        <input type="text" id="cli-search" placeholder="Buscar nome ou endereço..." class="input-search" value="${q}"
          oninput="Clientes.applyFilters()">
      </div>
      <div class="tab-bar mb-3">
        <button class="tab-btn ${filtroTipo===''?'active':''}"           onclick="Clientes.renderList(qs('#cli-search')?.value||'','')">Todos</button>
        <button class="tab-btn ${filtroTipo==='cliente'?'active':''}"    onclick="Clientes.renderList(qs('#cli-search')?.value||'','cliente')">Clientes</button>
        <button class="tab-btn ${filtroTipo==='fornecedor'?'active':''}" onclick="Clientes.renderList(qs('#cli-search')?.value||'','fornecedor')">Fornecedores</button>
        <button class="tab-btn ${filtroTipo==='ambos'?'active':''}"      onclick="Clientes.renderList(qs('#cli-search')?.value||'','ambos')">Equipe</button>
      </div>
      <div class="entity-list">
        ${items.length === 0
          ? '<div class="entity-empty">Nenhum cadastro encontrado</div>'
          : items.map(c => `
            <div class="entity-item" onclick="Clientes.tapCard('${c.id}')">
              <div class="avatar ${avatarColor(c.nome)}">${getInitials(c.nome)}</div>
              <div class="entity-info">
                <div class="entity-name">${c.nome}</div>
                <div class="entity-sub">${c.endereco || (c.telefone ? '📞 ' + c.telefone : 'Sem endereço')}</div>
                <div class="entity-badges">${tipoBadgeCli(c.tipo)}${c.telefone && c.endereco ? `<span class="badge badge-secondary">📞 ${c.telefone}</span>` : ''}</div>
              </div>
              <div class="entity-right">
                <span class="entity-chevron">›</span>
              </div>
            </div>
          `).join('')}
      </div>
    `;
  }

  function applyFilters() {
    const q  = qs('#cli-search')?.value || '';
    const tp = qs('#cli-tipo')?.value   || '';
    renderList(q, tp);
  }

  function tapCard(id) {
    const c = allClientes.find(x => x.id === id);
    if (!c) return;
    ActionSheet.open(c.nome, [
      { icon: '👁', label: 'Ver Detalhes',  fn: () => openDetail(id) },
      { icon: '✏️', label: 'Editar',        fn: () => openForm(id) },
      { icon: '🗑', label: 'Inativar',      fn: () => confirmDelete(id), danger: true },
    ]);
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
        <div class="entity-list" style="border-radius:0;border:none;box-shadow:none">
          ${osList.length === 0
            ? '<div class="entity-empty">Nenhuma OS</div>'
            : osList.map(o => `
              <div class="entity-item" onclick="App.navigate('os', {id:'${o.id}'})">
                <div class="avatar avatar-sm ${o.status === 'fechado' ? 'av-green' : o.status === 'andamento' ? 'av-blue' : 'av-orange'} avatar-icon">🔧</div>
                <div class="entity-info">
                  <div class="entity-name">${o.numero}</div>
                  <div class="entity-sub">${Fmt.date(o.data_inicio)}${o.data_fim ? ' → ' + Fmt.date(o.data_fim) : ''}</div>
                  <div class="entity-badges">${tipoBadge(o.tipo)} ${statusBadge(o.status)}</div>
                </div>
                <div class="entity-right">
                  <span class="entity-value">${Fmt.currency(o.valor_fechamento || o.valor_calculado)}</span>
                  <span class="entity-chevron">›</span>
                </div>
              </div>
            `).join('')}
        </div>
      </div>

      <div class="card mt-4">
        <div class="card-header"><h3>Movimentações</h3></div>
        <div class="entity-list" style="border-radius:0;border:none;box-shadow:none">
          ${parcelas.length === 0
            ? '<div class="entity-empty">Nenhuma movimentação</div>'
            : parcelas.map(p => `
              <div class="entity-item">
                <div class="avatar avatar-sm ${p.tipo==='receber'?'av-green':'av-red'} avatar-icon">${p.tipo==='receber'?'↓':'↑'}</div>
                <div class="entity-info">
                  <div class="entity-name">${p.descricao}</div>
                  <div class="entity-sub">Venc. ${Fmt.date(p.data_vencimento)}</div>
                </div>
                <div class="entity-right">
                  <span class="entity-value ${p.tipo==='receber'?'text-green':'text-red'}">${Fmt.currency(p.valor)}</span>
                  ${statusBadge(p.status)}
                </div>
              </div>
            `).join('')}
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
      if (!id) await App.onQuickAddDone(res.data?.id);
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

  return { render, renderList, applyFilters, tapCard, openDetail, openForm, saveForm, confirmDelete };
})();
