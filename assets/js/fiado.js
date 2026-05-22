// ============================================================
// FIADO
// ============================================================

const Fiado = (() => {
  let allFiado = [];

  async function render() {
    await loadData();
    renderList();
  }

  async function loadData() {
    Loading.show();
    const res = await API.db.read('fiado');
    Loading.hide();
    allFiado = (res?.data || []).sort((a, b) => a.data > b.data ? -1 : 1);
  }

  function renderList(filtro = '') {
    let items = allFiado;
    if (filtro) items = items.filter(f => f.pessoa === filtro);

    const totalRodrigo = allFiado.filter(f => f.pessoa === 'rodrigo' && f.status === 'pendente').reduce((s, f) => s + Number(f.valor || 0), 0);
    const totalOdinei  = allFiado.filter(f => f.pessoa === 'odinei'  && f.status === 'pendente').reduce((s, f) => s + Number(f.valor || 0), 0);

    const section = qs('#page-fiado');
    section.innerHTML = `
      <div class="page-header">
        <h1>Fiado</h1>
        <button class="btn btn-primary" onclick="Fiado.openForm()">+ Novo Fiado</button>
      </div>
      <div class="stats-grid mb-4">
        <div class="stat-card stat-blue">
          <div class="stat-label">Deve ao Rodrigo</div>
          <div class="stat-value">${Fmt.currency(totalRodrigo)}</div>
        </div>
        <div class="stat-card stat-orange">
          <div class="stat-label">Deve ao Odinei</div>
          <div class="stat-value">${Fmt.currency(totalOdinei)}</div>
        </div>
        <div class="stat-card stat-red">
          <div class="stat-label">Total a Pagar</div>
          <div class="stat-value">${Fmt.currency(totalRodrigo + totalOdinei)}</div>
        </div>
      </div>
      <div class="filters-bar">
        <select id="fiado-filtro" class="input-select" onchange="Fiado.renderList(this.value)">
          <option value="">Todos</option>
          <option value="rodrigo" ${filtro==='rodrigo'?'selected':''}>Rodrigo</option>
          <option value="odinei"  ${filtro==='odinei' ?'selected':''}>Odinei</option>
        </select>
      </div>
      <div class="card">
        <div class="table-responsive">
          ${items.length === 0 ? '<p class="p-3 text-muted">Nenhum registro de fiado.</p>' : `
          <table class="table">
            <thead><tr>
              <th>Data</th><th>Pessoa</th><th>Descrição</th>
              <th>Valor</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              ${items.map(f => `
                <tr>
                  <td>${Fmt.date(f.data)}</td>
                  <td><span class="badge ${f.pessoa==='rodrigo'?'badge-blue':'badge-orange'}">${f.pessoa}</span></td>
                  <td>${f.descricao}</td>
                  <td><strong>${Fmt.currency(f.valor)}</strong></td>
                  <td>${statusBadge(f.status)}</td>
                  <td>
                    ${f.status === 'pendente' ? `
                      <button class="btn btn-sm btn-success" onclick="Fiado.quitar('${f.id}', '${f.parcela_pagar_id}')">Quitar</button>
                      <button class="btn btn-sm btn-outline" onclick="Fiado.openForm('${f.id}')">Editar</button>
                    ` : ''}
                    <button class="btn btn-sm btn-danger" onclick="Fiado.confirmDelete('${f.id}')">✕</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>`}
        </div>
      </div>
    `;
  }

  function openForm(id = null) {
    const f = id ? allFiado.find(x => x.id === id) : null;
    qs('#fiado-form-id').value     = id || '';
    qs('#fiado-form-pessoa').value = f?.pessoa || 'rodrigo';
    qs('#fiado-form-desc').value   = f?.descricao || '';
    qs('#fiado-form-valor').value  = f?.valor || '';
    qs('#fiado-form-data').value   = f?.data || DateUtil.today();
    qs('#fiado-form-venc').value   = f?.data_vencimento || DateUtil.today();
    qs('#fiado-form-obs').value    = f?.observacoes || '';
    if (qs('#modal-fiado-title')) qs('#modal-fiado-title').textContent = id ? 'Editar Fiado' : 'Novo Fiado';
    if (qs('#fiado-alert-new'))   qs('#fiado-alert-new').style.display = id ? 'none' : '';
    Modal.open('modal-fiado');
  }

  async function saveForm() {
    const id     = qs('#fiado-form-id').value;
    const pessoa = qs('#fiado-form-pessoa').value;
    const desc   = qs('#fiado-form-desc').value.trim();
    const valor  = Number(qs('#fiado-form-valor').value) || 0;
    const data   = qs('#fiado-form-data').value;
    const venc   = qs('#fiado-form-venc').value;
    const obs    = qs('#fiado-form-obs').value;

    if (!desc || !valor) { Toast.warning('Preencha descrição e valor'); return; }

    Loading.show();
    let res;
    if (id) {
      const fiado = allFiado.find(f => f.id === id);
      const ops = [
        { action: 'update', sheet: 'fiado', id, data: { pessoa, descricao: desc, valor, data, observacoes: obs } },
      ];
      if (fiado?.parcela_pagar_id) {
        ops.push({ action: 'update', sheet: 'parcelas', id: fiado.parcela_pagar_id,
          data: { descricao: `Fiado ${pessoa} — ${desc}`, valor, data_vencimento: venc } });
      }
      res = await API.db.batch(ops);
    } else {
      res = await API.db.registrarFiado({ pessoa, descricao: desc, valor, data, data_vencimento: venc, observacoes: obs });
    }
    Loading.hide();

    if (res?.success) {
      Toast.success(id ? 'Fiado atualizado!' : 'Fiado registrado! Conta a pagar gerada.');
      Modal.close('modal-fiado');
      await loadData(); renderList();
    } else Toast.error('Erro: ' + res?.error);
  }

  async function quitar(fiadoId, parcelaId) {
    Modal.confirm('Quitar este fiado? O pagamento será registrado no financeiro.', async () => {
      const ops = [
        { action: 'update', sheet: 'fiado', id: fiadoId, data: { status: 'quitado' } },
      ];
      if (parcelaId) {
        ops.push({ action: 'update', sheet: 'parcelas', id: parcelaId, data: { status: 'pago', data_pagamento: DateUtil.today() } });
      }
      await API.db.batch(ops);
      Toast.success('Fiado quitado!');
      await loadData(); renderList();
    });
  }

  async function confirmDelete(id) {
    Modal.confirm('Excluir este registro de fiado?', async () => {
      await API.db.delete('fiado', id);
      Toast.success('Excluído');
      await loadData(); renderList();
    });
  }

  return { render, renderList, openForm, saveForm, quitar, confirmDelete };
})();
