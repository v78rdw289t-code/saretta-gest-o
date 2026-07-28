// ============================================================
// COMPRAS
// ============================================================

const Compras = (() => {
  let allCompras = [];
  let itensForm  = [];
  let estoqueList = [];
  let idemId     = '';   // id de idempotência da compra em edição (evita duplicar em reenvio)
  let editId     = '';   // id da compra sendo EDITADA (vazio = nova compra)

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
      <button class="btn btn-outline btn-sm" style="width:100%;margin-bottom:12px" onclick="Estoque.goTab('lista')">📝 Lista de compras</button>
      <div class="entity-list">
        ${allCompras.length === 0
          ? '<div class="entity-empty">Nenhuma compra registrada</div>'
          : allCompras.map(c => {
            const forn = App.clienteNome(c.fornecedor_id);
            const emNome = !!c.cliente_id;
            const cliNome = emNome ? App.clienteNome(c.cliente_id) : '';
            return `
              <div class="entity-item" onclick="Compras.tapCard('${c.id}')">
                <div class="avatar ${emNome ? 'av-teal' : avatarColor(forn)} avatar-icon">${emNome ? '🧾' : '🛒'}</div>
                <div class="entity-info">
                  <div class="entity-name">${forn || 'Fornecedor não informado'}${emNome ? ` <span class="badge badge-info" style="font-size:.62rem">em nome de ${Fmt.esc(cliNome)}</span>` : ''}</div>
                  <div class="entity-sub">${Fmt.date(c.data)}${c.observacoes ? ' · ' + c.observacoes : ''}</div>
                </div>
                <div class="entity-right">
                  <span class="entity-value ${emNome ? '' : 'text-red'}"${emNome ? ' style="color:var(--text-muted)"' : ''}>${Fmt.currency(c.valor_total)}</span>
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
        <div style="display:flex;gap:8px">
          <button class="btn btn-outline" onclick="Compras.openForm('${id}')">Editar</button>
          <button class="btn btn-danger" onclick="Compras.confirmDelete('${id}')">Excluir</button>
        </div>
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
                  <tr style="cursor:pointer" onclick="App.navigate('financeiro').then(() => Financeiro.tapParcela('${p.id}'))" title="Editar no Financeiro">
                    <td>${Fmt.date(p.data_vencimento)}</td>
                    <td>${Fmt.currency(p.valor)}</td>
                    <td>${statusBadge(p.status)}</td>
                    <td>
                      ${p.status === 'pendente' ? `<button class="btn btn-sm btn-success" onclick="event.stopPropagation();App.navigate('financeiro').then(() => Financeiro.openPagamento('${p.id}'))">Pagar</button>` : ''}
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
      'Excluir esta compra? O estoque será revertido (baixa dos itens que entraram) e as parcelas removidas.',
      async () => {
        Loading.show();
        const res = await API.db.excluirCompra(id);
        Loading.hide();
        if (res?.success) {
          Toast.success('Compra excluída e estoque revertido.');
          await loadData(); renderList();
        } else Toast.error('Erro: ' + (res?.error || ''));
      }
    );
  }

  async function openForm(id = null) {
    itensForm = [];
    editId = id || '';
    idemId = genUUID();   // um id por compra; um reenvio depois de timeout reaproveita e não duplica
    const compra = id ? allCompras.find(c => c.id === id) : null;

    qs('#compra-forn').innerHTML  = App.clienteOptions('fornecedor', compra?.fornecedor_id);
    qs('#compra-data').value      = compra?.data || DateUtil.today();
    qs('#compra-venc').value      = DateUtil.today();
    qs('#compra-comp').value      = (compra?.data || DateUtil.today()).substring(0, 7);
    qs('#compra-parc').value      = '1';
    if (qs('#ci-cat')) qs('#ci-cat').innerHTML = '<option value="">— Categoria —</option>' + App.categoriaOptions('saida');
    qs('#compra-obs').value       = compra?.observacoes || '';
    if (qs('#compra-desconto')) qs('#compra-desconto').value = compra?.desconto || '0';
    const qp = qs('#compra-quempagou');
    if (qp) qp.value = '';
    qs('#compra-quempagou-hint')?.classList.add('hidden');
    // Cliente (para "em nome do cliente")
    if (qs('#compra-cliente')) qs('#compra-cliente').innerHTML = App.clienteOptions('cliente', compra?.cliente_id || '');
    if (qs('#compra-em-nome')) {
      qs('#compra-em-nome').checked  = !!(compra && compra.cliente_id);
      // Na edição o tipo é fixo (converter normal↔registro deixaria parcela/estoque
      // órfãos) — pra mudar, exclua e recrie.
      qs('#compra-em-nome').disabled = !!id;
    }
    onNomeClienteChange();
    const titulo = qs('#modal-compra .modal-header h3');
    if (titulo) titulo.textContent = id ? 'Editar Compra' : 'Nova Compra';

    // Abre o modal NA HORA: o estoque (busca de item) carrega logo atrás.
    // Antes, o await abaixo segurava a abertura por 1 ida à rede (2-5s no Apps Script).
    renderItensForm();
    Modal.open('modal-compra');

    await loadEstoque();

    // Editando: recarrega itens + parcelas (nº, 1º vencimento, competência).
    if (id) {
      const [itRes, parRes] = await Promise.all([
        API.db.read('compras_itens', null, { compra_id: id }),
        API.db.read('parcelas', null, { origem_id: id }),
      ]);
      itensForm = (itRes?.data || []).map(i => ({
        estoque_id:  i.estoque_id || '',
        descricao:   i.descricao,
        quantidade:  Number(i.quantidade || 0),
        valor_unit:  Number(i.valor_unit || 0),
        valor_total: Number(i.valor_total || 0),
        unidade:     i.unidade || 'un',
        categoria_id:i.categoria_id || '',
      }));
      const parc = (parRes?.data || []).filter(p => p.origem === 'compra')
                     .sort((a, b) => String(a.data_vencimento || '') < String(b.data_vencimento || '') ? -1 : 1);
      if (parc.length) {
        qs('#compra-parc').value = String(parc.length);
        if (parc[0].data_vencimento)  qs('#compra-venc').value = parc[0].data_vencimento;
        if (parc[0].data_competencia) qs('#compra-comp').value = String(parc[0].data_competencia).substring(0, 7);
      }
      renderItensForm();
      return;
    }

    // Compra NOVA: se existe um rascunho com itens, oferece retomar (não perde
    // o que já foi digitado se o app fechou ou a rede caiu no meio).
    const draft = _loadDraft();
    if (draft && Array.isArray(draft.itens) && draft.itens.length) {
      const n = draft.itens.length;
      const quando = draft.ts ? new Date(draft.ts).toLocaleString('pt-BR') : '';
      Modal.confirm(
        `Compra em andamento (${n} ${n === 1 ? 'item' : 'itens'}${quando ? ' · ' + quando : ''}). Retomar de onde parou?`,
        () => _aplicarDraft(draft),
        () => _clearDraft()
      );
    }
    renderItensForm();
  }

  async function loadEstoque() {
    const res = await API.db.read('estoque');
    estoqueList = (res?.data || []).filter(e => e.ativo !== false && e.ativo !== 'false');
  }

  // ─── Rascunho local: não perde itens se o app fechar / a rede cair ──
  // Só para compra NOVA (na edição os itens já estão no servidor). Grava a
  // cada item adicionado/removido; limpa ao registrar ou ao descartar.
  const DRAFT_KEY = 'saretta_compra_rascunho';
  function _saveDraft() {
    if (editId) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        ts: Date.now(), idemId,
        fornecedor_id: qs('#compra-forn')?.value || '',
        data:  qs('#compra-data')?.value || '',
        venc:  qs('#compra-venc')?.value || '',
        comp:  qs('#compra-comp')?.value || '',
        parc:  qs('#compra-parc')?.value || '1',
        obs:   qs('#compra-obs')?.value || '',
        quempagou: qs('#compra-quempagou')?.value || '',
        desconto:  qs('#compra-desconto')?.value || '0',
        emNome:    !!qs('#compra-em-nome')?.checked,
        clienteId: qs('#compra-cliente')?.value || '',
        itens: itensForm,
      }));
    } catch (_) { /* localStorage cheio/indisponível — segue sem rascunho */ }
  }
  function _clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (_) {} }
  function _loadDraft()  { try { const s = localStorage.getItem(DRAFT_KEY); return s ? JSON.parse(s) : null; } catch (_) { return null; } }
  function _aplicarDraft(draft) {
    if (draft.idemId) idemId = draft.idemId;
    if (qs('#compra-forn'))     qs('#compra-forn').value     = draft.fornecedor_id || '';
    if (qs('#compra-data'))     qs('#compra-data').value     = draft.data || DateUtil.today();
    if (qs('#compra-venc'))     qs('#compra-venc').value     = draft.venc || DateUtil.today();
    if (qs('#compra-comp'))     qs('#compra-comp').value     = draft.comp || (draft.data || DateUtil.today()).substring(0, 7);
    if (qs('#compra-parc'))     qs('#compra-parc').value     = draft.parc || '1';
    if (qs('#compra-obs'))      qs('#compra-obs').value      = draft.obs || '';
    if (qs('#compra-quempagou'))qs('#compra-quempagou').value= draft.quempagou || '';
    if (qs('#compra-desconto')) qs('#compra-desconto').value = draft.desconto || '0';
    if (qs('#compra-em-nome'))  qs('#compra-em-nome').checked = !!draft.emNome;
    if (qs('#compra-cliente'))  qs('#compra-cliente').value   = draft.clienteId || '';
    onNomeClienteChange();
    onQuemPagouChange();
    itensForm = (draft.itens || []).map(i => ({ ...i }));
    renderItensForm();
    Toast.info('Compra em andamento retomada.');
  }

  function onQuemPagouChange() {
    const v = qs('#compra-quempagou')?.value || '';
    qs('#compra-quempagou-hint')?.classList.toggle('hidden', !v);
  }

  // "Compra em nome do cliente": só registro. Some os campos de despesa (venc,
  // parcelas, competência, quem pagou) e mostra o seletor de cliente.
  function onNomeClienteChange() {
    const on = !!qs('#compra-em-nome')?.checked;
    qs('#compra-cliente-wrap')?.classList.toggle('hidden', !on);
    qs('#compra-parc-row')?.classList.toggle('hidden', on);
    qs('#compra-comp-wrap')?.classList.toggle('hidden', on);
    qs('#compra-quempagou-wrap')?.classList.toggle('hidden', on);
  }

  // Resumo (só leitura) dentro do #modal-compra — tocar abre a sub-tela de itens.
  function renderItensForm() {
    const container = qs('#compra-itens-list');
    if (container) {
      container.innerHTML = itensForm.length === 0
        ? '<p class="text-muted" style="font-size:.85rem;text-align:center;padding:4px 0 2px">Nenhum item — toque acima para adicionar</p>'
        : itensForm.map((item) => {
            const cat = item.categoria_id ? (App.getCategorias().find(c => String(c.id) === String(item.categoria_id))?.nome || '') : '';
            return `
            <div class="item-row" style="cursor:pointer" onclick="Compras.openItens()">
              <span>${Fmt.esc(item.descricao)} × ${item.quantidade} ${Fmt.esc(item.unidade||'')}${cat ? ' · <em style="color:var(--text-muted)">'+Fmt.esc(cat)+'</em>' : ''} = ${Fmt.currency(item.valor_total)}
                ${item.estoque_id ? '<span class="badge badge-success">↑ estoque</span>' : '<span class="badge badge-secondary">novo</span>'}</span>
              <span class="entity-chevron">›</span>
            </div>`;
          }).join('');
    }
    const subtotal   = itensForm.reduce((s, i) => s + Number(i.valor_total || 0), 0);
    const desconto   = Number(qs('#compra-desconto')?.value) || 0;
    const totalFinal = Math.max(0, subtotal - desconto);
    if (qs('#compra-subtotal-display')) qs('#compra-subtotal-display').textContent = Fmt.currency(subtotal);
    if (qs('#compra-total-display'))    qs('#compra-total-display').textContent    = Fmt.currency(totalFinal);
  }

  // ─── Sub-tela cheia: entrada de itens (escanear + buscar, 1 por vez) ──
  function openItens() {
    resetItemEdit();
    renderItensTela();
    Modal.open('modal-compra-itens');
  }
  function concluirItens() {
    renderItensForm();
    Modal.close('modal-compra-itens');
  }

  // Cartão "item em edição": zera os campos e some do modo edição.
  function resetItemEdit() {
    ['#ci-estoque-id', '#ci-codigo', '#ci-edit-index', '#ci-desc', '#ci-unit', '#ci-und'].forEach(s => { if (qs(s)) qs(s).value = ''; });
    if (qs('#ci-qtd')) qs('#ci-qtd').value = '1';
    if (qs('#ci-cat')) qs('#ci-cat').value = '';
    if (qs('#ci-cancelar-edit')) qs('#ci-cancelar-edit').style.display = 'none';
    if (qs('#ci-resultados')) qs('#ci-resultados').innerHTML = '';
    if (qs('#ci-busca')) qs('#ci-busca').value = '';
    _renderBadges('', '');
    calcEdit();
  }

  function _renderBadges(estId, codigo) {
    const el = qs('#ci-badges'); if (!el) return;
    let html = '';
    if (codigo) { const c = String(codigo); html += `<span class="badge badge-navy">📷 ${Fmt.esc(c.length > 14 ? c.slice(0, 12) + '…' : c)}</span>`; }
    if (estId) html += '<span class="badge badge-success">↑ vinculado ao estoque</span>';
    else if (qs('#ci-desc')?.value.trim()) html += '<span class="badge badge-secondary">item novo</span>';
    el.innerHTML = html;
  }

  function calcEdit() {
    const qtd  = Number(qs('#ci-qtd')?.value)  || 0;
    const unit = Number(qs('#ci-unit')?.value) || 0;
    if (qs('#ci-total-display')) qs('#ci-total-display').textContent = Fmt.currency(Math.round(qtd * unit * 100) / 100);
  }

  function stepQtd(delta) {
    const el = qs('#ci-qtd'); if (!el) return;
    let v = Math.round(((Number(el.value) || 0) + delta) * 100) / 100;
    if (v < 0.01) v = 0.01;
    el.value = Number.isInteger(v) ? String(v) : String(v);
    if (typeof tapFeedback === 'function') tapFeedback();
    calcEdit();
  }

  // Lê um código pela câmera: casou com item do estoque → preenche e vincula;
  // não casou → item novo com o código guardado (entra no estoque com ele).
  async function scanItem() {
    const code = await Scanner.scan();
    if (!code) return;
    const achado = estoqueList.find(e => EstCod.matchCode(e.codigo_barras, code));
    if (achado) {
      _fillFromEstoque(achado, code);
      Toast.success('Item do estoque: ' + (achado.descricao || code));
    } else {
      resetItemEdit();
      if (qs('#ci-codigo')) qs('#ci-codigo').value = code;
      _renderBadges('', code);
      qs('#ci-desc')?.focus();
      Toast.warning('Código novo — descreva o item. Ele entra no estoque com esse código.');
    }
  }

  function buscarItem(q) {
    const termo = String(q || '').trim();
    const box = qs('#ci-resultados'); if (!box) return;
    if (!termo) { box.innerHTML = ''; return; }
    const t = termo.toLowerCase();
    const achados = estoqueList.filter(e =>
      filterRecords([e], termo, ['descricao', 'grupo', 'unidade']).length ||
      EstCod.searchText(e.codigo_barras).toLowerCase().includes(t)
    ).slice(0, 30);
    if (!achados.length) {
      box.innerHTML = '<div class="item-busca-hint">Nada no estoque — preencha abaixo para criar um item novo.</div>';
      return;
    }
    box.innerHTML = achados.map(e => `
      <div class="item-busca-row" onclick="Compras.escolherItem('${e.id}')">
        <div style="flex:1;min-width:0">
          <div class="item-busca-nome">${Fmt.esc(e.descricao)}${e.grupo ? ` <span class="item-busca-grp">📁 ${Fmt.esc(e.grupo)}</span>` : ''}</div>
          <div class="item-busca-sub">Qtd: ${e.quantidade} ${Fmt.esc(e.unidade || 'un')} · custo ${Fmt.currency(e.valor_unit)}</div>
        </div>
      </div>`).join('');
  }

  function escolherItem(id) {
    const e = estoqueList.find(x => String(x.id) === String(id));
    if (!e) return;
    _fillFromEstoque(e, '');
    if (qs('#ci-resultados')) qs('#ci-resultados').innerHTML = '';
    if (qs('#ci-busca')) qs('#ci-busca').value = '';
    qs('#ci-qtd')?.focus();
  }

  function _fillFromEstoque(e, codigo) {
    if (qs('#ci-estoque-id')) qs('#ci-estoque-id').value = e.id;
    if (qs('#ci-codigo'))     qs('#ci-codigo').value     = '';   // já está no estoque; não recadastra
    if (qs('#ci-desc'))       qs('#ci-desc').value       = e.descricao || '';
    if (qs('#ci-und'))        qs('#ci-und').value        = e.unidade || 'un';
    if (qs('#ci-unit'))       qs('#ci-unit').value       = e.valor_unit != null ? e.valor_unit : '';
    if (qs('#ci-cat') && e.categoria_id) qs('#ci-cat').value = e.categoria_id;
    _renderBadges(e.id, codigo);
    calcEdit();
  }

  // Grava o item em edição no rascunho (novo ou substituindo o que edita).
  function salvarItem(escanearProximo) {
    const desc = qs('#ci-desc').value.trim();
    if (!desc) { Toast.warning('Informe a descrição do item'); qs('#ci-desc')?.focus(); return; }
    const qtd = Number(qs('#ci-qtd').value) || 0;
    if (qtd <= 0) { Toast.warning('Quantidade inválida'); qs('#ci-qtd')?.focus(); return; }
    const unit  = Number(qs('#ci-unit').value) || 0;
    const und   = qs('#ci-und').value.trim() || 'un';
    const catId = qs('#ci-cat')?.value || '';
    const estId = qs('#ci-estoque-id').value || '';
    const codigo = qs('#ci-codigo').value || '';
    const item = {
      estoque_id: estId, descricao: desc, quantidade: qtd, valor_unit: unit,
      valor_total: Math.round(qtd * unit * 100) / 100, unidade: und, categoria_id: catId,
    };
    // Item NOVO escaneado leva o código p/ entrar no estoque já identificado.
    if (!estId && codigo) item.codigo_barras = EstCod.encode({ sku: '', marcas: [{ m: '', c: codigo, p: unit }] });

    const idx = qs('#ci-edit-index').value;
    if (idx !== '') itensForm[Number(idx)] = item; else itensForm.push(item);

    _saveDraft();
    renderItensTela();
    if (typeof tapFeedback === 'function') tapFeedback();
    Toast.success(idx !== '' ? 'Item atualizado' : 'Item adicionado');

    resetItemEdit();
    if (escanearProximo) scanItem();
  }

  function editarItem(i) {
    const item = itensForm[i];
    if (!item) return;
    const code = item.codigo_barras ? (EstCod.codigos(item.codigo_barras)[0] || '') : '';
    if (qs('#ci-estoque-id')) qs('#ci-estoque-id').value = item.estoque_id || '';
    if (qs('#ci-codigo'))     qs('#ci-codigo').value     = code;
    if (qs('#ci-edit-index')) qs('#ci-edit-index').value = String(i);
    if (qs('#ci-desc'))       qs('#ci-desc').value       = item.descricao || '';
    if (qs('#ci-qtd'))        qs('#ci-qtd').value        = item.quantidade != null ? String(item.quantidade) : '1';
    if (qs('#ci-unit'))       qs('#ci-unit').value       = item.valor_unit != null ? item.valor_unit : '';
    if (qs('#ci-und'))        qs('#ci-und').value        = item.unidade || 'un';
    if (qs('#ci-cat'))        qs('#ci-cat').value        = item.categoria_id || '';
    _renderBadges(item.estoque_id || '', code);
    if (qs('#ci-cancelar-edit')) qs('#ci-cancelar-edit').style.display = '';
    calcEdit();
    qs('#modal-compra-itens .modal-body')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function removeItem(i) {
    itensForm.splice(i, 1);
    _saveDraft();
    renderItensTela();
    renderItensForm();
  }

  // Lista dos itens já adicionados dentro da sub-tela.
  function renderItensTela() {
    const box = qs('#ci-lista');
    const subtotal = itensForm.reduce((s, i) => s + Number(i.valor_total || 0), 0);
    if (qs('#ci-subtotal')) qs('#ci-subtotal').textContent = Fmt.currency(subtotal);
    if (qs('#ci-count')) qs('#ci-count').textContent = itensForm.length === 0
      ? 'Nenhum item'
      : `${itensForm.length} ${itensForm.length === 1 ? 'item adicionado' : 'itens adicionados'}`;
    if (!box) return;
    if (itensForm.length === 0) {
      box.innerHTML = '<p class="text-muted" style="font-size:.85rem;text-align:center;padding:10px 0">Escaneie ou busque um item para começar.</p>';
      return;
    }
    box.innerHTML = itensForm.map((item, i) => {
      const cat = item.categoria_id ? (App.getCategorias().find(c => String(c.id) === String(item.categoria_id))?.nome || '') : '';
      const badge = item.estoque_id
        ? '<span class="badge badge-success" style="font-size:.6rem">↑</span>'
        : (item.codigo_barras ? '<span class="badge badge-navy" style="font-size:.6rem">📷</span>' : '<span class="badge badge-secondary" style="font-size:.6rem">novo</span>');
      return `
      <div class="ci-item">
        <div class="ci-item-main" onclick="Compras.editarItem(${i})">
          <div class="ci-item-nome">${Fmt.esc(item.descricao)} ${badge}</div>
          <div class="ci-item-sub">${item.quantidade} ${Fmt.esc(item.unidade || 'un')} × ${Fmt.currency(item.valor_unit)}${cat ? ' · ' + Fmt.esc(cat) : ''}</div>
        </div>
        <div class="ci-item-val" onclick="Compras.editarItem(${i})">${Fmt.currency(item.valor_total)}</div>
        <button type="button" class="ci-item-del" aria-label="Remover" onclick="Compras.removeItem(${i})">✕</button>
      </div>`;
    }).join('');
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
    const subtotal  = itensForm.reduce((s, i) => s + Number(i.valor_total || 0), 0);
    const total     = Math.max(0, subtotal - desconto);
    const emNome    = !!qs('#compra-em-nome')?.checked;
    const clienteId = emNome ? (qs('#compra-cliente')?.value || '') : '';

    if (itensForm.length === 0) { Toast.warning('Adicione ao menos um item'); return; }
    if (emNome && !clienteId) { Toast.warning('Escolha o cliente'); return; }

    const payload = {
      idempotency_id: idemId,
      fornecedor_id: fornId, data, valor_total: total,
      parcelas_count: parc, primeira_data_vencimento: venc,
      data_competencia: comp, desconto: desconto,
      quem_pagou: quemPagou || undefined,
      itens: itensForm, observacoes: obs,
    };

    Loading.show();
    let res;
    if (clienteId) {
      // Registro em nome do cliente: sem despesa, sem estoque.
      if (editId) {
        // Atualiza direto (editarCompra recalcularia estoque/financeiro — não é o caso).
        await API.db.update('compras', editId, {
          cliente_id: clienteId, fornecedor_id: fornId, data,
          valor_total: total, valor_bruto: subtotal, desconto, observacoes: obs, parcela_id: '',
        });
        const old = await API.db.read('compras_itens', null, { compra_id: editId });
        await Promise.all((old?.data || []).map(it => API.db.delete('compras_itens', it.id)));
        await Promise.all(itensForm.map(it => API.db.create('compras_itens', {
          compra_id: editId, descricao: it.descricao, estoque_id: '', categoria_id: it.categoria_id || '',
          quantidade: it.quantidade, valor_unit: it.valor_unit, valor_liq: it.valor_total, valor_total: it.valor_total,
        })));
        res = { success: true };
      } else {
        res = await API.db.registrarCompra({ ...payload, cliente_id: clienteId });
      }
    } else {
      res = editId
        ? await API.db.editarCompra({ ...payload, compra_id: editId })
        : await API.db.registrarCompra(payload);
    }
    Loading.hide();

    if (res?.success) {
      const msg = clienteId
        ? 'Registro em nome do cliente salvo — não é despesa nem estoque.'
        : (editId
            ? 'Compra atualizada! Estoque e financeiro recalculados.'
            : (res.jaRegistrada
                ? 'Compra já estava registrada — nada foi duplicado.'
                : (quemPagou
                    ? `Compra registrada! Foi pra ficha de ${quemPagou}.`
                    : 'Compra registrada! Estoque e financeiro atualizados.')));
      Toast.success(msg);
      _clearDraft();        // registrou: o rascunho da compra em andamento sai
      Modal.close('modal-compra-itens');
      Modal.close('modal-compra');
      editId = '';
      idemId = genUUID();   // próxima compra ganha um id novo
      await loadData(); renderList();
    } else Toast.error('Erro: ' + res?.error);
  }

  function tapCard(id) {
    openDetail(id);
  }

  return {
    render, renderList, tapCard, openDetail, confirmDelete, openForm, saveForm,
    onQuemPagouChange, onNomeClienteChange,
    // sub-tela de itens
    openItens, concluirItens, resetItemEdit, calcEdit, stepQtd,
    scanItem, buscarItem, escolherItem, salvarItem, editarItem, removeItem,
  };
})();
