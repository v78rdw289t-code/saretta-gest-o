// ============================================================
// FIADO
// ============================================================

const Fiado = (() => {
  let allFiado    = [];
  let allParcelas = [];

  async function render() {
    await loadData();
    renderList();
  }

  async function loadData() {
    const shown = Loading.maybeShow('fiado', 'parcelas');
    const [fRes, pRes] = await Promise.all([
      API.db.read('fiado'),
      API.db.read('parcelas'),
      App.loadGlobals(), // garante que App.getContas() esteja populado para o modal de quitação
    ]);
    if (shown) Loading.hide();
    // Normaliza 'pessoa' para minúsculo (entradas antigas ou via compras podem ter 'Rodrigo' capitalizado)
    allFiado    = (fRes?.data || [])
      .map(f => ({ ...f, pessoa: (f.pessoa || '').toLowerCase() }))
      .sort((a, b) => a.data > b.data ? -1 : 1);
    allParcelas = pRes?.data || [];
  }

  // Acessa a parcela vinculada a um fiado (fonte da verdade para valor/vencimento/categoria/competência)
  function getParcela(fiado) {
    if (!fiado?.parcela_pagar_id) return null;
    return allParcelas.find(p => p.id === fiado.parcela_pagar_id) || null;
  }

  // Valor "ao vivo" do fiado — prefere o da parcela (caso tenha sido editado em outro lugar)
  function valorVivo(fiado) {
    const p = getParcela(fiado);
    return Number((p?.valor ?? fiado.valor) || 0);
  }

  function renderList(filtro = '') {
    let items = allFiado;
    if (filtro) items = items.filter(f => f.pessoa === filtro);

    const totalRodrigo = allFiado.filter(f => f.pessoa === 'rodrigo' && f.status === 'pendente').reduce((s, f) => s + valorVivo(f), 0);
    const totalOdinei  = allFiado.filter(f => f.pessoa === 'odinei'  && f.status === 'pendente').reduce((s, f) => s + valorVivo(f), 0);

    const section = qs('#page-fiado');
    section.innerHTML = `
      <div class="section-tabs">
        <button class="section-tab" onclick="App.navigate('financeiro')">↓ Receber</button>
        <button class="section-tab" onclick="App.navigate('financeiro'); setTimeout(()=>Financeiro.switchTab('pagar'),50)">↑ Pagar</button>
        <button class="section-tab active" onclick="App.navigate('fiado')">Fiado</button>
        <button class="section-tab" onclick="App.navigate('compras')">Compras</button>
        <button class="section-tab" onclick="App.navigate('financeiro'); setTimeout(()=>Financeiro.switchTab('resumo'),50)">Resumo</button>
      </div>
      <div class="page-header">
        <h1>Fiado</h1>
        <button class="btn btn-primary" onclick="Fiado.openForm()">+ Novo</button>
      </div>
      <div class="stats-grid mb-4">
        <div class="stat-card stat-blue">
          <div class="stat-label">Deve ao Rodrigo</div>
          <div class="stat-value">${Fmt.currency(totalRodrigo)}</div>
          ${totalRodrigo > 0 ? `
            <button class="btn btn-sm" style="margin-top:8px;width:100%;background:rgba(255,255,255,.18);color:inherit;border:1px solid rgba(255,255,255,.3)"
              onclick="event.stopPropagation();Fiado.openQuitarTudo('rodrigo')">Quitar Rodrigo</button>
          ` : ''}
        </div>
        <div class="stat-card stat-orange">
          <div class="stat-label">Deve ao Odinei</div>
          <div class="stat-value">${Fmt.currency(totalOdinei)}</div>
          ${totalOdinei > 0 ? `
            <button class="btn btn-sm" style="margin-top:8px;width:100%;background:rgba(255,255,255,.18);color:inherit;border:1px solid rgba(255,255,255,.3)"
              onclick="event.stopPropagation();Fiado.openQuitarTudo('odinei')">Quitar Odinei</button>
          ` : ''}
        </div>
        <div class="stat-card stat-red">
          <div class="stat-label">Total a Pagar</div>
          <div class="stat-value">${Fmt.currency(totalRodrigo + totalOdinei)}</div>
        </div>
      </div>
      <div class="tab-bar mb-3">
        <button class="tab-btn ${filtro===''       ?'active':''}" onclick="Fiado.renderList('')">Todos</button>
        <button class="tab-btn ${filtro==='rodrigo'?'active':''}" onclick="Fiado.renderList('rodrigo')">Rodrigo</button>
        <button class="tab-btn ${filtro==='odinei' ?'active':''}" onclick="Fiado.renderList('odinei')">Odinei</button>
      </div>
      <div class="entity-list">
        ${items.length === 0
          ? '<div class="entity-empty">Nenhum registro de fiado</div>'
          : items.map(f => `
            <div class="entity-item" onclick="Fiado.tapCard('${f.id}')">
              <div class="avatar ${f.pessoa === 'rodrigo' ? 'av-blue' : 'av-orange'}">${getInitials(f.pessoa)}</div>
              <div class="entity-info">
                <div class="entity-name">${f.descricao}</div>
                <div class="entity-sub">${Fmt.date(f.data)} · <strong>${f.pessoa}</strong></div>
              </div>
              <div class="entity-right">
                <span class="entity-value text-red">${Fmt.currency(valorVivo(f))}</span>
                ${statusBadge(f.status)}
              </div>
            </div>
          `).join('')}
      </div>
    `;
  }

  function openForm(id = null) {
    const f = id ? allFiado.find(x => x.id === id) : null;
    const p = f ? getParcela(f) : null;

    qs('#fiado-form-id').value     = id || '';
    qs('#fiado-form-pessoa').value = f?.pessoa || 'rodrigo';
    qs('#fiado-form-desc').value   = f?.descricao || '';
    qs('#fiado-form-valor').value  = p?.valor ?? f?.valor ?? '';
    qs('#fiado-form-data').value   = Fmt.dateInput(f?.data) || DateUtil.today();
    qs('#fiado-form-venc').value   = Fmt.dateInput(p?.data_vencimento) || Fmt.dateInput(f?.data) || DateUtil.today();
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
        { action: 'update', sheet: 'fiado', id,
          data: { pessoa, descricao: desc, valor, data, observacoes: obs } },
      ];
      if (fiado?.parcela_pagar_id) {
        ops.push({
          action: 'update', sheet: 'parcelas', id: fiado.parcela_pagar_id,
          data: {
            descricao:        'Fiado - ' + pessoa + ' - ' + desc,
            valor,
            data_competencia: data,
            data_vencimento:  venc,
            observacoes:      obs,
          },
        });
      }
      res = await API.db.batch(ops);
      if (res?.success) res.success = res.results?.every(r => r?.success);
    } else {
      res = await API.db.registrarFiado({ pessoa, descricao: desc, valor, data, data_vencimento: venc, observacoes: obs });
    }
    Loading.hide();

    if (res?.success) {
      Toast.success(id ? 'Fiado atualizado!' : 'Fiado registrado! Conta a pagar gerada.');
      Modal.close('modal-fiado');
      await loadData(); renderList();
    } else Toast.error('Erro: ' + (res?.error || 'falha ao salvar'));
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

  // Abre o modal de quitação em lote.
  // pessoa = '' → quita TODOS os pendentes de todas as pessoas
  // pessoa = 'rodrigo' | 'odinei' → quita só dessa pessoa
  function openQuitarTudo(pessoa) {
    const pendentes = pessoa
      ? allFiado.filter(f => f.pessoa === pessoa && f.status === 'pendente')
      : allFiado.filter(f => f.status === 'pendente');

    if (pendentes.length === 0) {
      Toast.warning('Nenhum fiado pendente' + (pessoa ? ` para ${pessoa}` : ''));
      return;
    }

    const total     = pendentes.reduce((s, f) => s + valorVivo(f), 0);
    const pessoaLabel = pessoa
      ? pessoa.charAt(0).toUpperCase() + pessoa.slice(1)
      : 'todos';

    qs('#fiado-quitar-desc').innerHTML =
      `<strong>${pendentes.length} fiado(s)</strong> de <strong>${pessoaLabel}</strong><br>
       Total a quitar: <strong style="color:var(--danger)">${Fmt.currency(total)}</strong>`;
    qs('#fiado-quitar-data').value      = DateUtil.today();
    qs('#fiado-quitar-conta').innerHTML = App.contaOptions('', '— Selecione a conta —');
    qs('#fiado-quitar-btn').dataset.pessoa = pessoa;
    Modal.open('modal-fiado-quitar-tudo');
  }

  async function confirmarQuitarTudo() {
    const pessoa = qs('#fiado-quitar-btn').dataset.pessoa;
    const data   = qs('#fiado-quitar-data').value;
    const conta  = qs('#fiado-quitar-conta').value;
    if (!data)  { Toast.warning('Informe a data de pagamento'); return; }
    if (!conta) { Toast.warning('Selecione a conta'); return; }

    const pendentes = pessoa
      ? allFiado.filter(f => f.pessoa === pessoa && f.status === 'pendente')
      : allFiado.filter(f => f.status === 'pendente');

    if (pendentes.length === 0) { Toast.warning('Nenhum fiado pendente'); return; }

    const ops = [];
    pendentes.forEach(f => {
      ops.push({ action: 'update', sheet: 'fiado', id: f.id, data: { status: 'quitado' } });
      if (f.parcela_pagar_id) {
        ops.push({ action: 'update', sheet: 'parcelas', id: f.parcela_pagar_id,
          data: { status: 'pago', data_pagamento: data, conta_id: conta } });
      }
    });

    Loading.show();
    await API.db.batch(ops);
    Loading.hide();
    Toast.success(`${pendentes.length} fiado(s) quitado(s)!`);
    Modal.close('modal-fiado-quitar-tudo');
    await loadData(); renderList();
  }

  async function confirmDelete(id) {
    const fiado = allFiado.find(x => x.id === id);
    const msg = fiado?.status === 'quitado'
      ? 'Excluir este fiado já quitado? O lançamento pago no financeiro será mantido (histórico).'
      : 'Excluir este registro de fiado? A conta a pagar gerada também será removida.';
    Modal.confirm(msg, async () => {
      const ops = [{ action: 'delete', sheet: 'fiado', id }];
      // Só remove a parcela se ainda estiver pendente — se já foi paga, mantém o histórico no caixa
      if (fiado?.parcela_pagar_id && fiado.status !== 'quitado') {
        ops.push({ action: 'delete', sheet: 'parcelas', id: fiado.parcela_pagar_id });
      }
      await API.db.batch(ops);
      Toast.success('Excluído');
      await loadData(); renderList();
    });
  }

  function tapCard(id) {
    const f = allFiado.find(x => x.id === id);
    if (!f) return;
    const actions = [];
    if (f.status === 'pendente') {
      actions.push({ icon: '✅', label: 'Quitar',  fn: () => quitar(id, f.parcela_pagar_id) });
      actions.push({ icon: '✏️', label: 'Editar',  fn: () => openForm(id) });
    }
    actions.push({ icon: '🗑', label: 'Excluir', fn: () => confirmDelete(id), danger: true });
    ActionSheet.open(f.descricao, actions);
  }

  return { render, renderList, tapCard, openForm, saveForm,
           quitar, openQuitarTudo, confirmarQuitarTudo, confirmDelete };
})();
