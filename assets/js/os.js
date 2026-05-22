// ============================================================
// OS - Ordens de Serviço
// ============================================================

const OS = (() => {
  let allOS = [], allDiarias = [], allItens = [];
  let currentOS = null;
  let currentView = 'list'; // list | detail | form | diaria | fechamento

  // ─── RENDER PRINCIPAL ───────────────────────────────────
  async function render(params = {}) {
    await loadData();
    if (params.id) { openDetail(params.id); return; }
    renderList();
  }

  async function loadData() {
    Loading.show();
    const [osRes, dRes, iRes] = await Promise.all([
      API.db.read('os'),
      API.db.read('diarias'),
      API.db.read('os_itens'),
    ]);
    Loading.hide();
    allOS      = osRes?.data || [];
    allDiarias = dRes?.data  || [];
    allItens   = iRes?.data  || [];
  }

  // ─── LISTA ─────────────────────────────────────────────
  function renderList(filtroStatus = '', filtroTipo = '', q = '') {
    currentView = 'list';
    let items = allOS;
    if (filtroStatus) items = items.filter(o => o.status === filtroStatus);
    if (filtroTipo)   items = items.filter(o => o.tipo === filtroTipo);
    if (q)            items = filterRecords(items, q, ['numero','observacoes']).concat(
                               items.filter(o => App.clienteNome(o.cliente_id).toLowerCase().includes(q.toLowerCase()))
                             ).filter((v, i, a) => a.indexOf(v) === i);

    items = [...items].sort((a, b) => (a.data_criacao > b.data_criacao ? -1 : 1));

    const section = qs('#page-os');
    section.innerHTML = `
      <div class="page-header">
        <h1>Ordens de Serviço</h1>
        <button class="btn btn-primary" onclick="OS.openForm()">+ Nova OS</button>
      </div>
      <div class="filters-bar">
        <input type="text" id="os-search" placeholder="Buscar..." class="input-search" value="${q}"
          oninput="OS.applyFilters()">
        <select id="os-filtro-status" class="input-select" onchange="OS.applyFilters()">
          <option value="">Todos status</option>
          <option value="rascunho"  ${filtroStatus==='rascunho'  ?'selected':''}>Rascunho</option>
          <option value="andamento" ${filtroStatus==='andamento' ?'selected':''}>Em Andamento</option>
          <option value="acerto"    ${filtroStatus==='acerto'    ?'selected':''}>Em Acerto</option>
          <option value="fechado"   ${filtroStatus==='fechado'   ?'selected':''}>Fechado</option>
        </select>
        <select id="os-filtro-tipo" class="input-select" onchange="OS.applyFilters()">
          <option value="">Todos tipos</option>
          <option value="normal" ${filtroTipo==='normal' ?'selected':''}>Normal</option>
          <option value="diaria" ${filtroTipo==='diaria' ?'selected':''}>Diária</option>
        </select>
      </div>
      <div class="card">
        <div class="table-responsive">
          ${items.length === 0 ? '<p class="p-3 text-muted">Nenhuma OS encontrada.</p>' : `
          <table class="table">
            <thead><tr>
              <th>Número</th><th>Cliente</th><th>Tipo</th>
              <th>Status</th><th>Início</th><th>Fim</th><th>Valor</th><th></th>
            </tr></thead>
            <tbody>
              ${items.map(o => `
                <tr class="clickable" onclick="OS.openDetail('${o.id}')">
                  <td><strong>${o.numero}</strong></td>
                  <td>${App.clienteNome(o.cliente_id)}</td>
                  <td>${tipoBadge(o.tipo)}</td>
                  <td>${statusBadge(o.status)}</td>
                  <td>${Fmt.date(o.data_inicio)}</td>
                  <td>${Fmt.date(o.data_fim)}</td>
                  <td>${Fmt.currency(o.valor_fechamento || o.valor_calculado)}</td>
                  <td>
                    <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); OS.openForm('${o.id}')">Editar</button>
                    <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); OS.confirmDelete('${o.id}')">Excluir</button>
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
    const q  = qs('#os-search')?.value || '';
    const st = qs('#os-filtro-status')?.value || '';
    const tp = qs('#os-filtro-tipo')?.value || '';
    renderList(st, tp, q);
  }

  // ─── DETALHE ────────────────────────────────────────────
  async function openDetail(id) {
    currentOS = allOS.find(o => o.id === id) || (await API.db.read('os', id))?.data?.[0];
    if (!currentOS) return;
    currentView = 'detail';
    const diarias = allDiarias.filter(d => d.os_id === id)
                               .sort((a, b) => a.data > b.data ? 1 : -1);
    const itens   = allItens.filter(i => i.os_id === id);
    const section = qs('#page-os');
    const cliente = App.clienteNome(currentOS.cliente_id);

    section.innerHTML = `
      <div class="page-header">
        <button class="btn btn-outline" onclick="OS.render()">← Voltar</button>
        <h1>${currentOS.numero} — ${cliente}</h1>
        <div class="btn-group">
          ${currentOS.status !== 'fechado' ? `
            ${currentOS.tipo === 'diaria' ? `<button class="btn btn-secondary" onclick="OS.openDiaria()">+ Registrar Dia</button>` : ''}
            <button class="btn btn-primary" onclick="OS.openFechamento()">Fechar OS</button>
          ` : ''}
          <button class="btn btn-outline" onclick="OS.openForm('${id}')">Editar</button>
          <button class="btn btn-danger"  onclick="OS.confirmDelete('${id}')">Excluir</button>
        </div>
      </div>

      <div class="grid-2col">
        <div class="card">
          <div class="card-header"><h3>Informações</h3></div>
          <div class="card-body info-grid">
            <div><label>Tipo</label>${tipoBadge(currentOS.tipo)}</div>
            <div><label>Status</label>${statusBadge(currentOS.status)}</div>
            <div><label>Cliente</label>${cliente}</div>
            <div><label>Início</label>${Fmt.date(currentOS.data_inicio)}</div>
            <div><label>Fim</label>${Fmt.date(currentOS.data_fim)}</div>
            <div><label>Valor Calculado</label>${Fmt.currency(currentOS.valor_calculado)}</div>
            <div><label>Valor Fechamento</label>${Fmt.currency(currentOS.valor_fechamento)}</div>
            ${currentOS.observacoes ? `<div class="full-width"><label>Obs.</label>${currentOS.observacoes}</div>` : ''}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>Itens</h3>
            ${currentOS.status !== 'fechado' ? `<button class="btn btn-sm btn-primary" onclick="OS.openItemForm()">+ Item</button>` : ''}
          </div>
          <div id="os-itens-list">
            ${renderItens(itens)}
          </div>
        </div>
      </div>

      ${currentOS.tipo === 'diaria' ? `
        <div class="card mt-4">
          <div class="card-header">
            <h3>Dias Registrados</h3>
            <span class="badge badge-info">${diarias.length} dia(s)</span>
          </div>
          <div class="table-responsive">
            ${diarias.length === 0 ? '<p class="p-3 text-muted">Nenhum dia registrado</p>' : `
            <table class="table">
              <thead><tr>
                <th>Data</th><th>Manhã</th><th>Tarde</th><th>Horas</th><th>Valor</th><th></th>
              </tr></thead>
              <tbody>
                ${diarias.map(d => `
                  <tr>
                    <td>${Fmt.date(d.data)}</td>
                    <td>${d.manha_inicio || '—'} – ${d.manha_fim || '—'}</td>
                    <td>${d.tarde_inicio || '—'} – ${d.tarde_fim || '—'}</td>
                    <td>${Fmt.hours(d.horas_totais)}</td>
                    <td>${Fmt.currency(d.valor_manual || d.valor_calculado)}</td>
                    <td>
                      ${currentOS.status !== 'fechado' ? `
                      <button class="btn btn-sm btn-outline" onclick="OS.openDiaria('${d.id}')">Editar</button>
                      <button class="btn btn-sm btn-danger"  onclick="OS.deleteDiaria('${d.id}')">Excluir</button>
                      ` : ''}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot>
                <tr class="table-total">
                  <td colspan="3"><strong>Total</strong></td>
                  <td>${Fmt.hours(diarias.reduce((s,d)=>s+Number(d.horas_totais||0),0))}</td>
                  <td>${Fmt.currency(diarias.reduce((s,d)=>s+Number(d.valor_manual||d.valor_calculado||0),0))}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>`}
          </div>
        </div>
      ` : ''}
    `;
  }

  function renderItens(itens) {
    if (itens.length === 0) return '<p class="p-3 text-muted">Nenhum item</p>';
    return `<table class="table">
      <thead><tr><th>Tipo</th><th>Descrição</th><th>Qtd</th><th>Unit.</th><th>Total</th><th></th></tr></thead>
      <tbody>
        ${itens.map(i => `
          <tr>
            <td><span class="badge ${i.tipo === 'material' ? 'badge-info' : 'badge-secondary'}">${i.tipo}</span></td>
            <td>${i.descricao}</td>
            <td>${i.quantidade}</td>
            <td>${Fmt.currency(i.valor_unit)}</td>
            <td>${Fmt.currency(i.valor_total)}</td>
            <td>
              <button class="btn btn-sm btn-outline" onclick="OS.openItemForm('${i.id}')">Editar</button>
              <button class="btn btn-sm btn-danger"  onclick="OS.deleteItem('${i.id}')">✕</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
  }

  // ─── FORM OS ────────────────────────────────────────────
  async function openForm(id = null) {
    let os = null;
    if (id) {
      os = allOS.find(o => o.id === id) || (await API.db.read('os', id))?.data?.[0];
    }
    const numero = os ? os.numero : await nextOSNumber();
    const section = qs('#page-os');
    section.innerHTML = `
      <div class="page-header">
        <button class="btn btn-outline" onclick="${id ? `OS.openDetail('${id}')` : 'OS.render()'}">← Voltar</button>
        <h1>${os ? 'Editar OS' : 'Nova OS'}</h1>
      </div>
      <div class="card">
        <div class="card-body">
          <form id="os-form" onsubmit="OS.saveForm(event, '${id || ''}')">
            <div class="form-row">
              <div class="form-group">
                <label>Número</label>
                <input type="text" name="numero" class="input" value="${numero}" required>
              </div>
              <div class="form-group">
                <label>Tipo *</label>
                <select name="tipo" class="input" required onchange="OS.toggleTipo(this.value)">
                  <option value="normal" ${(!os||os.tipo==='normal')?'selected':''}>Normal</option>
                  <option value="diaria" ${os?.tipo==='diaria'?'selected':''}>Diária</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label>Cliente *</label>
              <select name="cliente_id" class="input" required>
                ${App.clienteOptions('cliente', os?.cliente_id)}
              </select>
            </div>
            <div id="datas-normais" class="${os?.tipo==='diaria'?'hidden':''}">
              <div class="form-row">
                <div class="form-group">
                  <label>Data Início</label>
                  <input type="date" name="data_inicio" class="input" value="${os?.data_inicio || DateUtil.today()}">
                </div>
                <div class="form-group">
                  <label>Data Fim</label>
                  <input type="date" name="data_fim" class="input" value="${os?.data_fim || ''}">
                </div>
              </div>
            </div>
            <div class="form-group">
              <label>Status</label>
              <select name="status" class="input">
                <option value="andamento" ${(!os||os.status==='andamento')?'selected':''}>Em Andamento</option>
                <option value="rascunho"  ${os?.status==='rascunho' ?'selected':''}>Rascunho</option>
                <option value="acerto"    ${os?.status==='acerto'   ?'selected':''}>Em Acerto</option>
                <option value="fechado"   ${os?.status==='fechado'  ?'selected':''}>Fechado</option>
              </select>
            </div>
            <div class="form-group">
              <label>Observações</label>
              <textarea name="observacoes" class="input" rows="3">${os?.observacoes || ''}</textarea>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary">Salvar OS</button>
              <button type="button" class="btn btn-outline" onclick="${id ? `OS.openDetail('${id}')` : 'OS.render()'}">Cancelar</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  function toggleTipo(val) {
    qs('#datas-normais')?.classList.toggle('hidden', val === 'diaria');
  }

  async function saveForm(e, id = '') {
    e.preventDefault();
    const form = e.target;
    const fd   = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    data.data_atualizacao = new Date().toISOString();

    Loading.show();
    let res;
    if (id) {
      res = await API.db.update('os', id, data);
    } else {
      data.data_criacao = new Date().toISOString();
      res = await API.db.create('os', data);
    }
    Loading.hide();

    if (res?.success) {
      Toast.success(id ? 'OS atualizada!' : 'OS criada!');
      await loadData();
      if (id) openDetail(id);
      else {
        const newId = res.data?.id;
        if (newId) openDetail(newId);
        else renderList();
      }
    } else {
      Toast.error('Erro ao salvar OS: ' + (res?.error || ''));
    }
  }

  // ─── FORM DIÁRIA ────────────────────────────────────────
  async function openDiaria(diariaId = null) {
    if (!currentOS) return;
    let d = null;
    if (diariaId) d = allDiarias.find(x => x.id === diariaId);
    const cfg = await Calculator.getConfig();

    qs('#modal-diaria-os-id').value     = currentOS.id;
    qs('#modal-diaria-id').value        = diariaId || '';
    qs('#modal-diaria-data').value      = d?.data || DateUtil.today();
    qs('#modal-diaria-manha-in').value  = d?.manha_inicio || '';
    qs('#modal-diaria-manha-fim').value = d?.manha_fim    || '';
    qs('#modal-diaria-tarde-in').value  = d?.tarde_inicio || '';
    qs('#modal-diaria-tarde-fim').value = d?.tarde_fim    || '';
    qs('#modal-diaria-manual').value    = d?.valor_manual || '';
    qs('#modal-diaria-info').textContent = `Valor hora: ${Fmt.currency(cfg.valor_hora || 0)} | Fator normal: ${cfg.fator_manha || 1} | Extra: ${cfg.fator_extra || 1.5}`;

    await calcDiariaPreview();
    Modal.open('modal-diaria');
  }

  async function calcDiariaPreview() {
    const mi = qs('#modal-diaria-manha-in').value;
    const mf = qs('#modal-diaria-manha-fim').value;
    const ti = qs('#modal-diaria-tarde-in').value;
    const tf = qs('#modal-diaria-tarde-fim').value;
    const manual = qs('#modal-diaria-manual').value;

    let horas = 0;
    if (mi && mf) horas += DateUtil.diffHours(mi, mf);
    if (ti && tf) horas += DateUtil.diffHours(ti, tf);

    const valor = await Calculator.calcularDia(mi, mf, ti, tf, manual || null);
    qs('#modal-diaria-horas').textContent = Fmt.hours(horas);
    qs('#modal-diaria-valor').textContent = Fmt.currency(valor);
  }

  async function saveDiaria() {
    const osId    = qs('#modal-diaria-os-id').value;
    const id      = qs('#modal-diaria-id').value;
    const mi      = qs('#modal-diaria-manha-in').value;
    const mf      = qs('#modal-diaria-manha-fim').value;
    const ti      = qs('#modal-diaria-tarde-in').value;
    const tf      = qs('#modal-diaria-tarde-fim').value;
    const manual  = qs('#modal-diaria-manual').value;

    // Validar: pelo menos 2 campos preenchidos
    const filled = [mi, mf, ti, tf].filter(Boolean).length;
    if (filled < 2) { Toast.warning('Preencha ao menos 2 horários'); return; }

    let horas = 0;
    if (mi && mf) horas += DateUtil.diffHours(mi, mf);
    if (ti && tf) horas += DateUtil.diffHours(ti, tf);
    const valorCalc = await Calculator.calcularDia(mi, mf, ti, tf, null);

    const data = {
      os_id:         osId,
      data:          qs('#modal-diaria-data').value,
      manha_inicio:  mi, manha_fim: mf,
      tarde_inicio:  ti, tarde_fim: tf,
      horas_totais:  horas,
      valor_calculado: valorCalc,
      valor_manual:  manual || '',
      observacoes:   '',
    };

    Loading.show();
    const res = id ? await API.db.update('diarias', id, data) : await API.db.create('diarias', data);
    Loading.hide();

    if (res?.success) {
      Toast.success('Dia registrado!');
      Modal.close('modal-diaria');
      // Atualizar datas da OS
      const dRes = await API.db.read('diarias', null, { os_id: osId });
      const dias = (dRes?.data || []).sort((a, b) => a.data > b.data ? 1 : -1);
      if (dias.length > 0) {
        await API.db.update('os', osId, { data_inicio: dias[0].data, data_fim: dias[dias.length-1].data });
      }
      await loadData();
      openDetail(osId);
    } else {
      Toast.error('Erro: ' + (res?.error || ''));
    }
  }

  async function deleteDiaria(id) {
    Modal.confirm('Excluir este dia?', async () => {
      await API.db.delete('diarias', id);
      Toast.success('Dia excluído');
      await loadData();
      openDetail(currentOS.id);
    });
  }

  // ─── ITENS ──────────────────────────────────────────────
  async function openItemForm(itemId = null) {
    if (!currentOS) return;
    const item   = itemId ? allItens.find(i => i.id === itemId) : null;
    const estRes = await API.db.read('estoque');
    const estoque = (estRes?.data || []).filter(e => e.ativo !== false && e.ativo !== 'false');

    qs('#modal-item-id').value    = itemId || '';
    qs('#modal-item-os-id').value = currentOS.id;
    qs('#modal-item-tipo').value  = item?.tipo || 'material';
    qs('#modal-item-desc').value  = item?.descricao || '';
    qs('#modal-item-qtd').value   = item?.quantidade || '1';
    qs('#modal-item-unit').value  = item?.valor_unit || '';
    qs('#modal-item-total').value = item?.valor_total || '';
    qs('#modal-item-estoque').innerHTML =
      '<option value="">— Selecione do estoque (opcional) —</option>' +
      estoque.map(e => `<option value="${e.id}" data-unit="${e.valor_unit}" ${e.id === item?.estoque_id ? 'selected' : ''}>${e.descricao} (Qtd: ${e.quantidade})</option>`).join('');
    Modal.open('modal-item');
  }

  async function saveItem() {
    const itemId  = qs('#modal-item-id').value;
    const osId    = qs('#modal-item-os-id').value;
    const tipo    = qs('#modal-item-tipo').value;
    const estId   = qs('#modal-item-estoque').value;
    const desc    = qs('#modal-item-desc').value;
    const qtd     = Number(qs('#modal-item-qtd').value) || 1;
    const unit    = Number(qs('#modal-item-unit').value) || 0;
    const total   = Number(qs('#modal-item-total').value) || (qtd * unit);

    if (!desc && !estId) { Toast.warning('Informe a descrição'); return; }

    let finalDesc  = desc;
    let finalEstId = estId;

    if (!itemId && estId) {
      // Novo item com estoque: descontar
      const estRes = await API.db.read('estoque', estId);
      const est = estRes?.data?.[0];
      if (est) {
        finalDesc = est.descricao;
        await API.db.update('estoque', estId, { quantidade: Math.max(0, Number(est.quantidade || 0) - qtd) });
      }
    } else if (itemId) {
      // Edição: ajustar estoque pela diferença de quantidade
      const original = allItens.find(i => i.id === itemId);
      if (original?.estoque_id) {
        const estRes = await API.db.read('estoque', original.estoque_id);
        const est = estRes?.data?.[0];
        if (est) {
          const diff = Number(original.quantidade || 0) - qtd; // positive = return stock
          await API.db.update('estoque', original.estoque_id, { quantidade: Math.max(0, Number(est.quantidade || 0) + diff) });
        }
        finalEstId = original.estoque_id;
      }
    }

    const itemData = {
      os_id: osId, tipo, descricao: finalDesc,
      estoque_id: finalEstId || '',
      quantidade: qtd, valor_unit: unit, valor_total: total,
    };

    Loading.show();
    const res = itemId
      ? await API.db.update('os_itens', itemId, itemData)
      : await API.db.create('os_itens', itemData);
    Loading.hide();

    if (res?.success) {
      Toast.success(itemId ? 'Item atualizado!' : 'Item adicionado!');
      Modal.close('modal-item');
      await loadData();
      openDetail(osId);
    } else {
      Toast.error('Erro: ' + (res?.error || ''));
    }
  }

  async function deleteItem(id) {
    Modal.confirm('Remover este item?', async () => {
      const item = allItens.find(i => i.id === id);
      // Devolver ao estoque se for material
      if (item?.estoque_id && item.tipo === 'material') {
        const estRes = await API.db.read('estoque', item.estoque_id);
        const est = estRes?.data?.[0];
        if (est) await API.db.update('estoque', item.estoque_id, { quantidade: Number(est.quantidade||0) + Number(item.quantidade||0) });
      }
      await API.db.delete('os_itens', id);
      Toast.success('Item removido');
      await loadData();
      openDetail(currentOS.id);
    });
  }

  // ─── FECHAMENTO ─────────────────────────────────────────
  async function openFechamento() {
    if (!currentOS) return;
    const diarias  = allDiarias.filter(d => d.os_id === currentOS.id)
                                .sort((a, b) => a.data > b.data ? 1 : -1);
    const itens    = allItens.filter(i => i.os_id === currentOS.id);
    const totalItens = itens.reduce((s, i) => s + Number(i.valor_total || 0), 0);

    let cfg = {}, fatores = Calculator.FATORES_DEFAULT;
    if (currentOS.tipo !== 'diaria') {
      cfg    = await Calculator.getConfig();
      fatores = Calculator.getFatores(cfg);
    }

    const section = qs('#page-os');
    section.innerHTML = `
      <div class="page-header">
        <button class="btn btn-outline" onclick="OS.openDetail('${currentOS.id}')">← Voltar</button>
        <h1>Fechar OS — ${currentOS.numero}</h1>
      </div>
      <div class="grid-2col">
        ${currentOS.tipo === 'diaria'
          ? _renderFechamentoDiaria(diarias, itens, totalItens)
          : _renderFechamentoNormal(cfg, fatores)}

        <div class="card">
          <div class="card-header"><h3>Fechamento</h3></div>
          <div class="card-body">
            <form id="fechamento-form" onsubmit="OS.saveFechamento(event)">
              <input type="hidden" id="fech-os-id" value="${currentOS.id}">
              ${currentOS.tipo === 'diaria' ? `
                <div class="form-group">
                  <label>Valor Bruto (R$)</label>
                  <input type="number" id="fech-bruto" class="input" step="0.01" value="${totalItens.toFixed(2)}"
                    onchange="OS.calcFechamento()" required>
                </div>
                <div class="form-group">
                  <label>Desconto (R$)</label>
                  <input type="number" id="fech-desconto" class="input" step="0.01" value="0"
                    onchange="OS.calcFechamento()">
                </div>
              ` : `
                <input type="hidden" id="fech-bruto" value="0">
                <input type="hidden" id="fech-desconto" value="0">
              `}
              <div class="info-row total-row ${currentOS.tipo !== 'diaria' ? 'mb-3' : ''}">
                <span><strong>${currentOS.tipo === 'diaria' ? 'Valor Líquido' : 'Total'}:</strong></span>
                <strong id="fech-liquido-display" style="font-size:1.2rem;color:var(--success)">—</strong>
              </div>
              <input type="hidden" id="fech-liquido" value="0">
              <hr>
              <div class="form-group">
                <label>Data de Competência</label>
                <input type="month" id="fech-competencia" class="input" value="${DateUtil.today().substring(0,7)}" required>
              </div>
              <div class="form-group">
                <label>Data de Vencimento</label>
                <input type="date" id="fech-vencimento" class="input" value="${DateUtil.today()}" required>
              </div>
              <div class="form-group">
                <label>Categoria</label>
                <select id="fech-categoria" class="input">${App.categoriaOptions('entrada')}</select>
              </div>
              <div class="form-group">
                <label>Observações</label>
                <textarea id="fech-obs" class="input" rows="2"></textarea>
              </div>
              <div class="form-actions">
                <button type="submit" class="btn btn-primary btn-lg">Fechar OS e Gerar Parcela</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;

    if (currentOS.tipo === 'diaria') calcFechamento();
    else calcFechamentoNormal();
  }

  function _renderFechamentoDiaria(diarias, itens, totalItens) {
    return `
      <div class="card">
        <div class="card-header"><h3>Dias a Faturar</h3></div>
        <div class="card-body">
          ${diarias.length === 0 ? '<p class="text-muted">Nenhum dia registrado</p>' : `
            <div id="fechamento-dias">
              ${diarias.map(d => `
                <label class="checkbox-item">
                  <input type="checkbox" class="dia-check" value="${d.id}"
                    data-valor="${d.valor_manual || d.valor_calculado}"
                    onchange="OS.calcFechamento()" checked>
                  <span>${Fmt.date(d.data)} — ${Fmt.currency(d.valor_manual || d.valor_calculado)}</span>
                </label>
              `).join('')}
            </div>
          `}
          ${itens.length > 0 ? `
            <div class="info-row mt-3">
              <span>Total itens:</span>
              <strong>${Fmt.currency(totalItens)}</strong>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  function _renderFechamentoNormal(cfg, fatores) {
    const hManut = Fmt.currency(Number(cfg.valor_hora_manutencao) || 155);
    const hProj  = Fmt.currency(Number(cfg.valor_hora_projeto)    || 200);
    const vPrx   = Fmt.currency(Number(cfg.valor_chamada_proximo) || 200);
    const vDst   = Fmt.currency(Number(cfg.valor_chamada_distante)|| 250);
    return `
      <div class="card">
        <div class="card-header"><h3>Calculadora de Serviço</h3></div>
        <div class="card-body">
          <div class="form-group">
            <label>Tipo de Serviço</label>
            <select id="calc-tipo" class="input" onchange="OS.calcFechamentoNormal()">
              <option value="manutencao">🔧 Manutenção (${hManut}/h)</option>
              <option value="projeto">🏗️ Projeto Novo (${hProj}/h)</option>
            </select>
          </div>
          <div class="form-group">
            <label>Horas Trabalhadas</label>
            <input type="number" id="calc-horas" class="input" step="0.5" value="1" min="0"
              oninput="OS.calcFechamentoNormal()">
          </div>
          <p style="font-size:.78rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin:14px 0 8px">Fatores de Ajuste</p>
          <div id="calc-fatores">
            ${fatores.map(f => `
              <label class="checkbox-item">
                <input type="checkbox" class="fator-check" data-perc="${f.percentual}"
                  onchange="OS.calcFechamentoNormal()">
                <span>${f.label} <small style="color:var(--text-muted)">(+${f.percentual}%)</small></span>
              </label>
            `).join('')}
          </div>
          <p style="font-size:.78rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin:14px 0 8px">Material e Chamada</p>
          <div class="form-row">
            <div class="form-group">
              <label>Material (R$)</label>
              <input type="number" id="calc-material" class="input" step="0.01" value="0" min="0"
                oninput="OS.calcFechamentoNormal()">
            </div>
            <div class="form-group">
              <label>Admin. Material (%)</label>
              <input type="number" id="calc-taxa-admin" class="input" step="0.5" min="0"
                value="${cfg.taxa_admin_material || 15}" oninput="OS.calcFechamentoNormal()">
            </div>
          </div>
          <label class="checkbox-item">
            <input type="checkbox" id="calc-chamada" onchange="OS.calcFechamentoNormal()">
            <span>Chamada Técnica</span>
          </label>
          <div id="calc-chamada-tipo-wrap" class="hidden mt-2">
            <select id="calc-chamada-tipo" class="input" onchange="OS.calcFechamentoNormal()">
              <option value="proximo">Próximo (${vPrx})</option>
              <option value="distante">Distante (${vDst})</option>
            </select>
          </div>
          <div class="form-row mt-3">
            <div class="form-group">
              <label>Desconto (%)</label>
              <input type="number" id="calc-desconto-perc" class="input" step="1" value="0" min="0" max="30"
                oninput="OS.calcFechamentoNormal()">
            </div>
            <div class="form-group">
              <label>Simples Nacional (%)</label>
              <input type="number" id="calc-simples" class="input" step="0.1" min="0" max="20"
                value="${cfg.simples_aliquota || 0}" oninput="OS.calcFechamentoNormal()">
            </div>
          </div>
          <div id="calc-breakdown" class="mt-3"></div>
        </div>
      </div>
    `;
  }

  function calcFechamento() {
    const checks = qsa('.dia-check:checked');
    if (checks.length > 0) {
      const valorDias = checks.reduce((s, c) => s + Number(c.dataset.valor || 0), 0);
      if (qs('#fech-bruto')) qs('#fech-bruto').value = valorDias.toFixed(2);
    }
    const bruto   = Number(qs('#fech-bruto')?.value) || 0;
    const desconto = Number(qs('#fech-desconto')?.value) || 0;
    const liquido  = Math.max(0, bruto - desconto);
    if (qs('#fech-liquido')) qs('#fech-liquido').value = liquido.toFixed(2);
    if (qs('#fech-liquido-display')) qs('#fech-liquido-display').textContent = Fmt.currency(liquido);
  }

  async function calcFechamentoNormal() {
    const chamadaOn = qs('#calc-chamada')?.checked || false;
    qs('#calc-chamada-tipo-wrap')?.classList.toggle('hidden', !chamadaOn);

    const cfg = await Calculator.getConfig();
    const tipo = qs('#calc-tipo')?.value;
    const horaBase = tipo === 'projeto'
      ? Calculator.cfgNum(cfg, 'valor_hora_projeto', 200)
      : Calculator.cfgNum(cfg, 'valor_hora_manutencao', 155);

    const fatoresAtivos = qsa('.fator-check:checked').map(c => ({ percentual: Number(c.dataset.perc) }));
    const params = {
      horaBase,
      horas:             Number(qs('#calc-horas')?.value         || 0),
      material:          Number(qs('#calc-material')?.value      || 0),
      taxaAdminMaterial: Number(qs('#calc-taxa-admin')?.value    || 0),
      fatoresAtivos,
      chamadaTecnica:    chamadaOn,
      tipoChamada:       qs('#calc-chamada-tipo')?.value          || 'proximo',
      desconto:          Number(qs('#calc-desconto-perc')?.value || 0),
      simples:           Number(qs('#calc-simples')?.value        || 0),
    };

    const r = await Calculator.calcularServico(params);

    const bd = qs('#calc-breakdown');
    if (bd) {
      const row = (label, val, style = '') =>
        `<div class="info-row" ${style ? `style="${style}"` : ''}><span>${label}</span><span>${val}</span></div>`;
      bd.innerHTML = `<div style="border-top:1px solid var(--border);padding-top:10px">
        ${row('Hora base:', `${Fmt.currency(horaBase)}/h`)}
        ${r.totalPerc > 0 ? row(`Fatores (+${r.totalPerc}%):`, `<strong>${Fmt.currency(r.horaFinal)}/h</strong>`) : ''}
        ${row(`Mão de obra (${Fmt.hours(params.horas)}):`, Fmt.currency(r.subtotalMao))}
        ${params.material > 0 ? row(`Material + admin (${params.taxaAdminMaterial}%):`, Fmt.currency(r.subtotalMat)) : ''}
        ${r.valorChamada > 0 ? row('Chamada técnica:', Fmt.currency(r.valorChamada)) : ''}
        ${row('Subtotal:', Fmt.currency(r.subtotalBruto), 'border-top:1px solid var(--border);margin-top:6px;padding-top:6px')}
        ${r.valorDesconto > 0 ? row(`Desconto (${params.desconto}%):`, `-${Fmt.currency(r.valorDesconto)}`, 'color:var(--danger)') : ''}
        ${r.valorSimples > 0 ? row(`Simples (${params.simples}%):`, `+${Fmt.currency(r.valorSimples)}`, 'color:var(--text-muted)') : ''}
        <div class="info-row total-row"><span><strong>Total:</strong></span><strong style="color:var(--success)">${Fmt.currency(r.total)}</strong></div>
      </div>`;
    }

    if (qs('#fech-bruto'))           qs('#fech-bruto').value           = r.subtotalBruto.toFixed(2);
    if (qs('#fech-desconto'))        qs('#fech-desconto').value        = r.valorDesconto.toFixed(2);
    if (qs('#fech-liquido'))         qs('#fech-liquido').value         = r.total.toFixed(2);
    if (qs('#fech-liquido-display')) qs('#fech-liquido-display').textContent = Fmt.currency(r.total);
  }

  async function saveFechamento(e) {
    e.preventDefault();
    const osId    = qs('#fech-os-id').value;
    const bruto   = Number(qs('#fech-bruto').value) || 0;
    const desconto= Number(qs('#fech-desconto').value) || 0;
    const liquido = Number(qs('#fech-liquido').value) || 0;
    const comp    = qs('#fech-competencia').value + '-01';
    const venc    = qs('#fech-vencimento').value;
    const catId   = qs('#fech-categoria').value;
    const obs     = qs('#fech-obs').value;
    const diariaIds = qsa('.dia-check:checked').map(c => c.value);

    Loading.show();
    const res = await API.db.fecharOS({
      os_id: osId, valor_bruto: bruto, desconto, valor_liquido: liquido,
      data_competencia: comp, data_vencimento: venc, categoria_id: catId,
      diaria_ids: diariaIds, observacoes: obs,
    });
    Loading.hide();

    if (res?.success) {
      Toast.success('OS fechada! Parcela gerada no financeiro.');
      await loadData();
      await App.loadGlobals();
      renderList();
    } else {
      Toast.error('Erro: ' + (res?.error || ''));
    }
  }

  // ─── LISTA DE COMPRAS ───────────────────────────────────
  async function openListaCompras() {
    const [lcRes, cliRes, estRes] = await Promise.all([
      API.db.read('lista_compras'),
      API.db.read('clientes'),
      API.db.read('estoque'),
    ]);
    const lista   = lcRes?.data  || [];
    const clientes= cliRes?.data || [];
    const estoque = (estRes?.data || []).filter(e => e.ativo !== false && e.ativo !== 'false');

    const section = qs('#page-os');
    section.innerHTML = `
      <div class="page-header">
        <button class="btn btn-outline" onclick="OS.render()">← Voltar</button>
        <h1>Lista de Compras</h1>
        <button class="btn btn-primary" onclick="OS.openListaItemForm()">+ Adicionar Item</button>
      </div>
      ${clientes.filter(c => c.tipo === 'cliente' || c.tipo === 'ambos').map(c => {
        const itens = lista.filter(l => l.cliente_id === c.id && l.status !== 'comprado');
        if (itens.length === 0) return '';
        return `
          <div class="card mt-3">
            <div class="card-header"><h3>${c.nome}</h3></div>
            <div class="table-responsive">
              <table class="table">
                <thead><tr><th>Item</th><th>Qtd</th><th>No Estoque</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  ${itens.map(i => {
                    const noEst = estoque.find(e => e.descricao.toLowerCase() === i.descricao.toLowerCase());
                    return `
                      <tr>
                        <td>${i.descricao}</td>
                        <td>${i.quantidade} ${i.unidade || ''}</td>
                        <td>${noEst ? `<span class="badge badge-success">✓ ${noEst.quantidade} ${noEst.unidade||''}</span>` : '<span class="badge badge-danger">Não tem</span>'}</td>
                        <td>${statusBadge(i.status || 'pendente')}</td>
                        <td>
                          <button class="btn btn-sm btn-success" onclick="OS.marcarComprado('${i.id}')">Comprado</button>
                          <button class="btn btn-sm btn-danger"  onclick="OS.deleteListaItem('${i.id}')">✕</button>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
      }).join('')}
      <div id="modal-lista-item-form" class="hidden card mt-3">
        <div class="card-header"><h3>Adicionar Item à Lista</h3></div>
        <div class="card-body">
          <form id="lista-item-form" onsubmit="OS.saveListaItem(event)">
            <div class="form-row">
              <div class="form-group">
                <label>Cliente</label>
                <select name="cliente_id" class="input" required>
                  ${App.clienteOptions('cliente')}
                </select>
              </div>
              <div class="form-group">
                <label>Item</label>
                <input type="text" name="descricao" class="input" required>
              </div>
              <div class="form-group">
                <label>Qtd</label>
                <input type="number" name="quantidade" class="input" value="1" min="1">
              </div>
              <div class="form-group">
                <label>Unidade</label>
                <input type="text" name="unidade" class="input" placeholder="un, m, kg...">
              </div>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary">Adicionar</button>
              <button type="button" class="btn btn-outline" onclick="qs('#modal-lista-item-form').classList.add('hidden')">Cancelar</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  function openListaItemForm() {
    qs('#modal-lista-item-form')?.classList.remove('hidden');
  }

  async function saveListaItem(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = { ...Object.fromEntries(fd.entries()), status: 'pendente', data_criacao: DateUtil.today() };
    const res = await API.db.create('lista_compras', data);
    if (res?.success) { Toast.success('Item adicionado!'); openListaCompras(); }
    else Toast.error('Erro: ' + res?.error);
  }

  async function marcarComprado(id) {
    await API.db.update('lista_compras', id, { status: 'comprado' });
    Toast.success('Marcado como comprado!');
    openListaCompras();
  }

  async function deleteListaItem(id) {
    Modal.confirm('Remover item da lista?', async () => {
      await API.db.delete('lista_compras', id);
      openListaCompras();
    });
  }

  async function confirmDelete(id) {
    Modal.confirm('Excluir esta OS? Os itens serão devolvidos ao estoque.', async () => {
      Loading.show();
      const res = await API.db.excluirOS(id);
      Loading.hide();
      if (res?.success) {
        Toast.success('OS excluída');
        await loadData();
        renderList();
      } else Toast.error('Erro: ' + res?.error);
    });
  }

  return {
    render, renderList, applyFilters, openDetail, openForm, toggleTipo, saveForm,
    openDiaria, calcDiariaPreview, saveDiaria, deleteDiaria,
    openItemForm, saveItem, deleteItem,
    openFechamento, calcFechamento, calcFechamentoNormal, saveFechamento,
    openListaCompras, openListaItemForm, saveListaItem, marcarComprado, deleteListaItem,
    confirmDelete,
  };
})();
