// ============================================================
// ESTOQUE — módulo (Itens · Compras · Lista · Movimentações · Relatório)
// ============================================================

const Estoque = (() => {
  let allEstoque = [];
  let allMovs    = [];
  let _tab       = 'itens';          // itens | compras | lista | mov | rel
  let _detailId  = null;
  let _q         = '';
  let _catFiltro = null;   // null = ainda não inicializado (default = Material/Estoque)
  let _relCat    = null;   // filtro de categoria da aba Relatório (mesmo default)
  // Lista de compras (por cliente) — portada do módulo OS
  let _listaCache = { lista: [], estoque: [] };
  let _novaLista  = { cliente_id: '', itens: [], _aberto: false };
  let _comprasById = {};  // compra_id -> compra (p/ fornecedor no detalhe do item)
  let _movMotivo  = '';   // filtro de motivo na aba Movimentações
  let _movQ       = '';   // busca por item na aba Movimentações
  let _contagem   = {};   // estoque_id -> qtd contada (aba Inventário)
  let _gruposFechados = new Set(); // grupos recolhidos na aba Itens

  const SEM_GRUPO = '— Sem grupo —';
  // Grupos já usados (distintos, ordenados) — alimenta o datalist do form.
  function gruposExistentes() {
    return [...new Set(allEstoque.map(e => String(e.grupo || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  }

  const ativo   = e => e.ativo !== false && e.ativo !== 'false';
  const MOTIVOS = {
    compra: 'Compra', uso_os: 'Uso em OS', uso_interno: 'Uso interno',
    perda: 'Perda / Quebra', ajuste: 'Ajuste', devolucao: 'Devolução',
    entrada: 'Entrada', outro: 'Outro',
  };

  function catNome(id) {
    if (!id) return '';
    const c = (App.getCategorias() || []).find(x => String(x.id) === String(id));
    return c ? c.nome : '';
  }

  // Categoria default dos filtros = "Material/Estoque" (a mais controlável).
  function catMaterialId() {
    const c = (App.getCategorias() || []).find(x =>
      x.tipo === 'saida' && String(x.nome || '').toLowerCase() === 'material/estoque');
    return c ? c.id : '';
  }

  function catSelectHTML(atual, onchange) {
    const catsSaida = (App.getCategorias() || []).filter(c => c.tipo === 'saida');
    return `<select class="input" style="max-width:46%" onchange="${onchange}">
      <option value="">Todas categorias</option>
      ${catsSaida.map(c => `<option value="${c.id}" ${String(c.id) === String(atual) ? 'selected' : ''}>${c.nome}</option>`).join('')}
    </select>`;
  }

  // ─── Navegação por abas ──────────────────────────────────────
  // Itens/Lista/Mov/Relatório vivem em #page-estoque; Compras é página própria.
  function goTab(tab) {
    if (tab === 'compras') return App.navigate('compras');
    _tab = tab; _detailId = null;
    return App.navigate('estoque');
  }
  const switchTab = goTab;

  function tabsHTML(active) {
    const t = (id, label) =>
      `<button class="section-tab ${active === id ? 'active' : ''}" onclick="Estoque.goTab('${id}')">${label}</button>`;
    return `<div class="section-tabs">
      ${t('itens', '📦 Itens')}${t('compras', '🛒 Compras')}${t('lista', '📝 Lista')}
      ${t('mov', '🔄 Mov.')}${t('rel', '📊 Relat.')}${t('inventario', '📋 Invent.')}
    </div>`;
  }

  // ─── Carregamento + dispatch ─────────────────────────────────
  async function render() {
    const shown = Loading.maybeShow('estoque');
    if (_tab === 'lista') {
      const [lcRes, estRes] = await Promise.all([
        API.db.read('lista_compras'),
        API.db.read('estoque'),
      ]);
      if (shown) Loading.hide();
      _listaCache = { lista: lcRes?.data || [], estoque: (estRes?.data || []).filter(ativo) };
      return renderLista();
    }
    const [estRes, movRes, compRes] = await Promise.all([
      API.db.read('estoque'),
      API.db.read('estoque_movimentacoes'),
      API.db.read('compras'),
    ]);
    if (shown) Loading.hide();
    allEstoque = (estRes?.data || []).filter(ativo);
    allMovs    = (movRes?.data || []).sort((a, b) => (a.data > b.data ? -1 : 1));
    _comprasById = {};
    (compRes?.data || []).forEach(c => { _comprasById[String(c.id)] = c; });
    if (_detailId) return renderDetail();
    if (_tab === 'mov') return renderMov();
    if (_tab === 'rel') return renderRel();
    if (_tab === 'inventario') return renderInventario();
    return renderItens();
  }

  // ─── ABA ITENS ───────────────────────────────────────────────
  function isBaixo(e) {
    const min = Number(e.estoque_minimo || 0);
    return min > 0 && Number(e.quantidade || 0) <= min;
  }

  function renderItens() {
    if (_catFiltro === null) _catFiltro = catMaterialId();
    let items = allEstoque;
    if (_q) items = filterRecords(items, _q, ['descricao', 'unidade']);
    if (_catFiltro) items = items.filter(e => String(e.categoria_id || '') === String(_catFiltro));

    const baixos     = allEstoque.filter(isBaixo);
    const totalValor = items.reduce((s, e) => s + Number(e.valor_unit || 0) * Number(e.quantidade || 0), 0);

    qs('#page-estoque').innerHTML = `
      ${tabsHTML('itens')}
      <div class="page-header">
        <h1>Estoque</h1>
        <button class="btn btn-primary" onclick="Estoque.openForm()">+ Novo Item</button>
      </div>
      ${baixos.length > 0 ? `
        <div class="alert alert-warning mb-3">
          ⚠ ${baixos.length} item(ns) no/abaixo do mínimo: ${baixos.map(e => e.descricao).join(', ')}
        </div>` : ''}
      <div class="filters-bar" style="display:flex;gap:8px">
        <input type="text" id="est-search" placeholder="Buscar item..." class="input-search" value="${_q}"
          oninput="Estoque.onSearch(this.value)">
        ${catSelectHTML(_catFiltro, 'Estoque.onCatFiltro(this.value)')}
      </div>
      <div class="entity-list">
        ${items.length === 0
          ? '<div class="entity-empty">Nenhum item no estoque</div>'
          : renderItensAgrupados(items)}
        <div class="entity-item" style="background:var(--bg);cursor:default">
          <div class="entity-info"><strong>Total em estoque</strong></div>
          <div class="entity-right"><span class="entity-value">${Fmt.currency(totalValor)}</span></div>
        </div>
      </div>
    `;
  }

  // Uma linha de item na lista.
  function itemLinhaHTML(e) {
    const baixo = isBaixo(e);
    const cat   = catNome(e.categoria_id);
    return `
      <div class="entity-item" onclick="Estoque.openDetail('${e.id}')">
        <div class="avatar ${avatarColor(e.descricao)} avatar-icon">📦</div>
        <div class="entity-info">
          <div class="entity-name">${e.descricao}${baixo ? ' ⚠️' : ''}</div>
          <div class="entity-sub">${Number(e.quantidade || 0)} ${e.unidade || 'un'} · ${Fmt.currency(e.valor_unit)}/un${cat ? ' · ' + cat : ''}</div>
        </div>
        <div class="entity-right">
          <span class="entity-value">${Fmt.currency(Number(e.valor_unit || 0) * Number(e.quantidade || 0))}</span>
          <span class="entity-chevron">›</span>
        </div>
      </div>`;
  }

  // Itens com GRUPO viram pastas colapsáveis (ex.: "Parafuso · 12 tipos"); os
  // sem grupo aparecem soltos no fim. Se nenhum item tem grupo, lista simples.
  function renderItensAgrupados(items) {
    const semGrupo = items.filter(e => !String(e.grupo || '').trim());
    const comGrupo = items.filter(e => String(e.grupo || '').trim());
    if (comGrupo.length === 0) return items.map(itemLinhaHTML).join('');

    const porGrupo = {};
    comGrupo.forEach(e => { const g = String(e.grupo).trim(); (porGrupo[g] ||= []).push(e); });
    const nomes = Object.keys(porGrupo).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

    const blocoGrupo = (nome, lista) => {
      const fechado = _gruposFechados.has(nome);
      const val = lista.reduce((s, e) => s + Number(e.valor_unit || 0) * Number(e.quantidade || 0), 0);
      const baixos = lista.filter(isBaixo).length;
      return `
        <div class="estq-grupo-head" onclick="Estoque.toggleGrupo('${nome.replace(/'/g, "\\'")}')">
          <span class="estq-grupo-chev">${fechado ? '▸' : '▾'}</span>
          <div style="flex:1;min-width:0">
            <div class="estq-grupo-nome">📁 ${nome}${baixos ? ' <span style="color:var(--danger)">⚠️</span>' : ''}</div>
            <div class="estq-grupo-sub">${lista.length} ${lista.length === 1 ? 'tipo' : 'tipos'} · ${Fmt.currency(val)}</div>
          </div>
        </div>
        ${fechado ? '' : lista.map(itemLinhaHTML).join('')}`;
    };

    return nomes.map(n => blocoGrupo(n, porGrupo[n])).join('') +
      (semGrupo.length ? blocoGrupo(SEM_GRUPO, semGrupo) : '');
  }

  function toggleGrupo(nome) {
    if (_gruposFechados.has(nome)) _gruposFechados.delete(nome);
    else _gruposFechados.add(nome);
    renderItens();
  }

  function onSearch(v) {
    _q = v; renderItens();
    const el = qs('#est-search'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }
  function onCatFiltro(v) { _catFiltro = v; renderItens(); }
  function onRelCat(v)    { _relCat = v; renderRel(); }

  // ─── DETALHE DO ITEM (com histórico) ─────────────────────────
  function openDetail(id) { _detailId = id; renderDetail(); }

  function renderDetail() {
    const e = allEstoque.find(x => x.id === _detailId);
    if (!e) { _detailId = null; return renderItens(); }
    const movs  = allMovs.filter(m => String(m.estoque_id) === String(e.id));
    const baixo = isBaixo(e);
    const total = Number(e.valor_unit || 0) * Number(e.quantidade || 0);

    // Fornecedores = os das COMPRAS deste item (pode ter vários); o fornecedor_id
    // gravado no item é só fallback de legado (itens sem compra registrada).
    const fornIds = [];
    movs.filter(m => m.origem === 'compra').forEach(m => {
      const fid = _comprasById[String(m.origem_id)]?.fornecedor_id;
      if (fid && !fornIds.includes(String(fid))) fornIds.push(String(fid));
    });
    if (fornIds.length === 0 && e.fornecedor_id) fornIds.push(String(e.fornecedor_id));
    const fornNomes = fornIds.map(fid => App.clienteNome(fid)).filter(Boolean);
    const fornDaCompra = m => App.clienteNome(_comprasById[String(m.origem_id)]?.fornecedor_id) || '';

    qs('#page-estoque').innerHTML = `
      <div class="page-header">
        <button class="btn btn-outline" onclick="Estoque.voltarLista()">← Voltar</button>
        <h1 style="font-size:1.1rem">${e.descricao}</h1>
        <button class="btn btn-danger" onclick="Estoque.confirmDelete('${e.id}')">Excluir</button>
      </div>

      <div class="card mb-3"><div class="card-body">
        <div class="info-row"><span class="text-muted">Quantidade</span><strong>${Number(e.quantidade || 0)} ${e.unidade || 'un'}${baixo ? ' ⚠️' : ''}</strong></div>
        <div class="info-row"><span class="text-muted">Custo médio</span><strong>${Fmt.currency(e.valor_unit)}/un</strong></div>
        <div class="info-row"><span class="text-muted">Valor total</span><strong>${Fmt.currency(total)}</strong></div>
        ${e.grupo ? `<div class="info-row"><span class="text-muted">Grupo</span><strong>📁 ${e.grupo}</strong></div>` : ''}
        <div class="info-row"><span class="text-muted">Categoria</span><strong>${catNome(e.categoria_id) || '—'}</strong></div>
        <div class="info-row"><span class="text-muted">Estoque mínimo</span><strong>${Number(e.estoque_minimo || 0)}</strong></div>
        <div class="info-row"><span class="text-muted">Fornecedor${fornNomes.length > 1 ? 'es' : ''}</span><strong style="text-align:right">${fornNomes.join(', ') || '—'}</strong></div>
        ${e.observacoes ? `<div class="info-row"><span class="text-muted">Obs.</span><span>${e.observacoes}</span></div>` : ''}
      </div></div>

      <div style="display:flex;gap:8px;margin-bottom:14px">
        <button class="btn btn-outline" style="flex:1" onclick="Estoque.openForm('${e.id}')">✏️ Editar / Ajustar</button>
        <button class="btn btn-warning" style="flex:1" onclick="Estoque.openBaixa('${e.id}')">↓ Dar baixa</button>
      </div>

      <div class="home-section-head"><h2 class="home-section-title">🔄 Movimentações</h2></div>
      <div class="entity-list">
        ${movs.length === 0
          ? '<div class="entity-empty">Sem movimentações</div>'
          : movs.map(m => {
            const ent  = m.tipo === 'entrada';
            const cor  = ent ? 'var(--success)' : (m.motivo === 'perda' ? 'var(--danger)' : 'var(--text)');
            const sinal= ent ? '+' : (m.tipo === 'saida' ? '−' : '±');
            return `
              <div class="entity-item" style="cursor:default">
                <div class="entity-info">
                  <div class="entity-name">${MOTIVOS[m.motivo] || m.motivo || (ent ? 'Entrada' : 'Saída')}</div>
                  <div class="entity-sub">${Fmt.date(m.data)}${m.origem && m.origem !== 'manual' ? ' · ' + (m.origem === 'os' ? 'OS' : m.origem === 'compra' ? 'Compra' + (fornDaCompra(m) ? ' — ' + fornDaCompra(m) : '') : m.origem) : ''}${m.observacoes ? ' · ' + m.observacoes : ''}</div>
                </div>
                <div class="entity-right">
                  <span class="entity-value" style="color:${cor}">${sinal}${Number(m.quantidade || 0)}</span>
                </div>
              </div>`;
          }).join('')}
      </div>
    `;
  }

  function voltarLista() { _detailId = null; renderItens(); }

  // ─── FORM (criar / editar / ajustar) ─────────────────────────
  function openForm(id = null) {
    const e = id ? allEstoque.find(x => x.id === id) : null;
    qs('#est-form-id').value   = id || '';
    qs('#est-form-desc').value = e?.descricao || '';
    // Grupo é um SELETOR dos grupos já cadastrados (+ "＋ Novo grupo") — evita
    // que um typo crie um grupo duplicado.
    const selG = qs('#est-form-grupo');
    if (selG) {
      const atual  = String(e?.grupo || '').trim();
      const grupos = gruposExistentes();
      // Edição de item cujo grupo (raro) não esteja na lista → inclui p/ não perder.
      if (atual && !grupos.some(g => g === atual)) grupos.unshift(atual);
      selG.innerHTML =
        `<option value="">${SEM_GRUPO}</option>` +
        grupos.map(g => `<option value="${g.replace(/"/g, '&quot;')}" ${g === atual ? 'selected' : ''}>📁 ${g}</option>`).join('') +
        `<option value="__novo__">＋ Novo grupo…</option>`;
    }
    const novoG = qs('#est-form-grupo-novo');
    if (novoG) { novoG.value = ''; novoG.classList.add('hidden'); }
    qs('#est-form-qtd').value  = e?.quantidade ?? '0';
    qs('#est-form-unit').value = e?.valor_unit ?? '0';
    qs('#est-form-und').value  = e?.unidade || 'un';
    qs('#est-form-min').value  = e?.estoque_minimo ?? '0';
    qs('#est-form-cat').innerHTML  = '<option value="">— Sem categoria —</option>' + App.categoriaOptions('saida', e?.categoria_id);
    qs('#est-form-data').value = Fmt.dateInput(e?.data_entrada) || DateUtil.today();
    qs('#est-form-obs').value  = e?.observacoes || '';
    qs('#modal-est-title').textContent = id ? 'Editar / Ajustar Item' : 'Novo Item no Estoque';
    qs('#est-form-ajuste-hint')?.classList.toggle('hidden', !id);
    Modal.open('modal-estoque');
  }

  // Mostra o campo "novo grupo" quando o usuário escolhe "＋ Novo grupo…".
  function onGrupoChange() {
    const sel  = qs('#est-form-grupo');
    const novo = qs('#est-form-grupo-novo');
    if (!sel || !novo) return;
    const isNovo = sel.value === '__novo__';
    novo.classList.toggle('hidden', !isNovo);
    if (isNovo) novo.focus();
  }

  // Grupo final do form: a seleção OU o nome digitado em "novo grupo". Se o nome
  // novo bater (ignorando maiúsc/minúsc) com um grupo já existente, usa a grafia
  // que já existe — assim "parafuso" cai no mesmo "Parafuso".
  function _grupoEscolhido() {
    const sel = qs('#est-form-grupo');
    if (!sel) return '';
    if (sel.value !== '__novo__') return sel.value.trim();
    const novo = (qs('#est-form-grupo-novo')?.value || '').trim();
    if (!novo) return '';
    return gruposExistentes().find(g => g.toLowerCase() === novo.toLowerCase()) || novo;
  }

  // trava de duplo clique (Guard) — o corpo real está em _saveForm
  function saveForm() { return Guard.run('estq-save', _saveForm); }
  async function _saveForm() {
    const id   = qs('#est-form-id').value;
    const desc = qs('#est-form-desc').value.trim();
    if (!desc) { Toast.warning('Informe a descrição'); return; }
    const novaQtd  = Number(qs('#est-form-qtd').value) || 0;
    const novoUnit = Number(qs('#est-form-unit').value) || 0;
    const dadosBase = {
      descricao:      desc,
      grupo:          _grupoEscolhido(),
      unidade:        qs('#est-form-und').value.trim() || 'un',
      estoque_minimo: Number(qs('#est-form-min').value) || 0,
      categoria_id:   qs('#est-form-cat').value,
      data_entrada:   qs('#est-form-data').value,
      observacoes:    qs('#est-form-obs').value.trim(),
    };

    Loading.show();
    let res;
    if (id) {
      const orig = allEstoque.find(x => x.id === id) || {};
      // Campos descritivos via update normal
      res = await API.db.update('estoque', id, dadosBase);
      // Mudou quantidade e/ou custo → registra movimentação de ajuste (mantém o razão honesto)
      const mudouQtd  = novaQtd  !== Number(orig.quantidade || 0);
      const mudouUnit = novoUnit !== Number(orig.valor_unit || 0);
      if (mudouQtd || mudouUnit) {
        await API.db.registrarMovEstoque({
          estoque_id: id, tipo: 'ajuste',
          nova_quantidade: novaQtd, novo_valor_unit: novoUnit,
          origem: 'manual', observacoes: 'Ajuste manual',
        });
      }
    } else {
      // Novo item: cria e, se já nasce com saldo, registra a entrada inicial.
      res = await API.db.create('estoque', { ...dadosBase, quantidade: novaQtd, valor_unit: novoUnit, ativo: true });
      const novoId = res?.data?.id;
      if (res?.success && novoId && novaQtd > 0) {
        await API.db.registrarMovEstoque({
          estoque_id: novoId, tipo: 'entrada', motivo: 'ajuste',
          quantidade: novaQtd, valor_unit: novoUnit,
          origem: 'manual', observacoes: 'Saldo inicial',
        });
      }
    }
    Loading.hide();
    if (res?.success) {
      Toast.success(id ? 'Item atualizado!' : 'Item criado!');
      Modal.close('modal-estoque');
      await render();
    } else Toast.error('Erro: ' + res?.error);
  }

  // ─── BAIXA / PERDA ───────────────────────────────────────────
  function openBaixa(id) {
    const e = allEstoque.find(x => x.id === id);
    if (!e) return;
    qs('#baixa-id').value     = id;
    qs('#baixa-item').textContent = `${e.descricao} (disp.: ${Number(e.quantidade || 0)} ${e.unidade || 'un'})`;
    qs('#baixa-motivo').value = 'uso_interno';
    qs('#baixa-qtd').value    = '1';
    qs('#baixa-obs').value    = '';
    Modal.open('modal-baixa');
  }

  // trava de duplo clique (Guard) — o corpo real está em _saveBaixa
  function saveBaixa() { return Guard.run('estq-baixa', _saveBaixa); }
  async function _saveBaixa() {
    const id     = qs('#baixa-id').value;
    const motivo = qs('#baixa-motivo').value;
    const qtd    = Number(qs('#baixa-qtd').value) || 0;
    if (qtd <= 0) { Toast.warning('Informe a quantidade'); return; }
    Loading.show();
    const res = await API.db.registrarMovEstoque({
      estoque_id: id, tipo: 'saida', motivo, quantidade: qtd,
      origem: 'manual', observacoes: qs('#baixa-obs').value.trim(),
    });
    Loading.hide();
    if (res?.success) {
      Toast.success('Baixa registrada!');
      Modal.close('modal-baixa');
      await render();
    } else Toast.error('Erro: ' + res?.error);
  }

  // trava de duplo clique (Guard) — o corpo real está em _confirmDelete
  function confirmDelete(id) { return Guard.run('estq-excluir', () => _confirmDelete(id)); }
  async function _confirmDelete(id) {
    Modal.confirm('Excluir este item do estoque? (o histórico de movimentações é mantido)', async () => {
      await API.db.update('estoque', id, { ativo: false });
      Toast.success('Removido');
      _detailId = null;
      await render();
    });
  }

  // ─── ABA MOVIMENTAÇÕES (lista geral) ─────────────────────────
  function renderMov() {
    const nome = id => allEstoque.find(e => String(e.id) === String(id))?.descricao || '—';
    let movs = allMovs;
    if (_movMotivo) movs = movs.filter(m => m.motivo === _movMotivo);
    if (_movQ) { const q = _movQ.toLowerCase(); movs = movs.filter(m => nome(m.estoque_id).toLowerCase().includes(q)); }
    const motivos = [...new Set(allMovs.map(m => m.motivo).filter(Boolean))];
    qs('#page-estoque').innerHTML = `
      ${tabsHTML('mov')}
      <div class="page-header"><h1>Movimentações</h1></div>
      <div class="filters-bar" style="display:flex;gap:8px">
        <input type="text" id="mov-search" class="input-search" placeholder="Buscar item..." value="${_movQ}"
          oninput="Estoque.onMovSearch(this.value)">
        <select class="input" style="max-width:46%" onchange="Estoque.onMovMotivo(this.value)">
          <option value="">Todos os motivos</option>
          ${motivos.map(mo => `<option value="${mo}" ${mo === _movMotivo ? 'selected' : ''}>${MOTIVOS[mo] || mo}</option>`).join('')}
        </select>
      </div>
      <div class="entity-list">
        ${movs.length === 0
          ? '<div class="entity-empty">Nenhuma movimentação</div>'
          : movs.map(m => {
            const ent   = m.tipo === 'entrada';
            const cor   = ent ? 'var(--success)' : (m.motivo === 'perda' ? 'var(--danger)' : 'var(--text)');
            const sinal = ent ? '+' : (m.tipo === 'saida' ? '−' : '±');
            return `
              <div class="entity-item" style="cursor:default">
                <div class="entity-info">
                  <div class="entity-name">${nome(m.estoque_id)}</div>
                  <div class="entity-sub">${MOTIVOS[m.motivo] || m.motivo} · ${Fmt.date(m.data)}${m.origem && m.origem !== 'manual' ? ' · ' + (m.origem === 'os' ? 'OS' : 'Compra') : ''}</div>
                </div>
                <div class="entity-right">
                  <span class="entity-value" style="color:${cor}">${sinal}${Number(m.quantidade || 0)}</span>
                  <span class="entity-sub">${Fmt.currency(m.valor_total)}</span>
                </div>
              </div>`;
          }).join('')}
      </div>
    `;
  }

  function onMovSearch(v) {
    _movQ = v; renderMov();
    const el = qs('#mov-search'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }
  function onMovMotivo(v) { _movMotivo = v; renderMov(); }

  // ─── ABA INVENTÁRIO / CONTAGEM ───────────────────────────────
  // Conta o estoque físico: digita a qtd contada por item, vê a diferença ao vivo,
  // e ao finalizar gera um 'ajuste' por item que mudou. ✏️ abre o form (edita tudo).
  function _contagemPend() {
    return Object.keys(_contagem).filter(id => {
      const e = allEstoque.find(x => x.id === id);
      if (!e) return false;
      const c = _contagem[id];
      return c !== '' && c != null && Number(c) !== Number(e.quantidade || 0);
    });
  }

  function renderInventario() {
    const itens = allEstoque.slice().sort((a, b) => (a.descricao || '').localeCompare(b.descricao || ''));
    const pend = _contagemPend().length;
    qs('#page-estoque').innerHTML = `
      ${tabsHTML('inventario')}
      <div class="page-header"><h1>Inventário / Contagem</h1></div>
      <p class="text-muted mb-3" style="font-size:.82rem;line-height:1.45">
        Conte o estoque físico, digite a quantidade <strong>contada</strong> e finalize — o sistema gera os ajustes.
        Toque em ✏️ pra corrigir nome, custo ou categoria do item.
      </p>
      <div class="entity-list">
        ${itens.length === 0 ? '<div class="entity-empty">Sem itens</div>' : itens.map(e => {
          const sis = Number(e.quantidade || 0);
          const c   = _contagem[e.id];
          const tem = c !== '' && c != null;
          const dif = tem ? (Number(c) - sis) : 0;
          const difTxt = !tem ? '' : (dif === 0 ? '✓ ok' : (dif > 0 ? '+' : '') + dif);
          const difCor = dif > 0 ? 'var(--success)' : (dif < 0 ? 'var(--danger)' : 'var(--text-muted)');
          return `
            <div class="entity-item" style="cursor:default">
              <div class="entity-info" style="min-width:0">
                <div class="entity-name">${e.descricao}</div>
                <div class="entity-sub">sistema: ${sis} ${e.unidade || 'un'} · <span id="inv-dif-${e.id}" style="color:${difCor};font-weight:700">${difTxt}</span></div>
              </div>
              <div class="entity-right" style="display:flex;align-items:center;gap:8px">
                <input type="number" step="0.01" class="input" style="width:76px;text-align:center" placeholder="contar"
                  value="${tem ? c : ''}" oninput="Estoque.onContagem('${e.id}', this.value)">
                <button class="btn btn-sm btn-outline" title="Editar item" onclick="Estoque.openForm('${e.id}')">✏️</button>
              </div>
            </div>`;
        }).join('')}
      </div>
      <button id="inv-finalizar" class="btn btn-primary btn-full mt-3" onclick="Estoque.finalizarContagem()">
        Finalizar contagem${pend ? ` (${pend} ajuste${pend > 1 ? 's' : ''})` : ''}
      </button>
    `;
  }

  // Atualiza a diferença do item + o contador do botão SEM re-render (mantém o foco no input)
  function onContagem(id, val) {
    _contagem[id] = val;
    const e = allEstoque.find(x => x.id === id);
    if (e) {
      const sis = Number(e.quantidade || 0);
      const tem = val !== '' && val != null;
      const dif = tem ? (Number(val) - sis) : 0;
      const span = qs('#inv-dif-' + id);
      if (span) {
        span.textContent = !tem ? '' : (dif === 0 ? '✓ ok' : (dif > 0 ? '+' : '') + dif);
        span.style.color = dif > 0 ? 'var(--success)' : (dif < 0 ? 'var(--danger)' : 'var(--text-muted)');
      }
    }
    const pend = _contagemPend().length;
    const btn = qs('#inv-finalizar');
    if (btn) btn.textContent = 'Finalizar contagem' + (pend ? ` (${pend} ajuste${pend > 1 ? 's' : ''})` : '');
  }

  // trava de duplo clique (Guard) — o corpo real está em _finalizarContagem
  function finalizarContagem() { return Guard.run('estq-contagem', _finalizarContagem); }
  async function _finalizarContagem() {
    const ids = _contagemPend();
    if (!ids.length) { Toast.warning('Nada para ajustar — preencha as quantidades contadas'); return; }
    Modal.confirm(`Aplicar ${ids.length} ajuste(s) de contagem ao estoque?`, async () => {
      Loading.show();
      for (const id of ids) {
        await API.db.registrarMovEstoque({
          estoque_id: id, tipo: 'ajuste', nova_quantidade: Number(_contagem[id]),
          origem: 'inventario', observacoes: 'Contagem de inventário',
        });
      }
      Loading.hide();
      Toast.success(`${ids.length} ajuste(s) aplicado(s)!`);
      _contagem = {};
      await render();
    });
  }

  // ─── ABA RELATÓRIO (resumo) ──────────────────────────────────
  function renderRel() {
    if (_relCat === null) _relCat = catMaterialId();
    const base = _relCat
      ? allEstoque.filter(e => String(e.categoria_id || '') === String(_relCat))
      : allEstoque;
    const totalValor = base.reduce((s, e) => s + Number(e.valor_unit || 0) * Number(e.quantidade || 0), 0);
    const baixos     = base.filter(isBaixo);
    // Valor por categoria
    const porCat = {};
    base.forEach(e => {
      const k = catNome(e.categoria_id) || 'Sem categoria';
      porCat[k] = (porCat[k] || 0) + Number(e.valor_unit || 0) * Number(e.quantidade || 0);
    });
    // Perdas (saídas com motivo=perda) — restritas aos itens da categoria filtrada
    const baseIds = new Set(base.map(e => String(e.id)));
    const perdas = allMovs.filter(m => m.motivo === 'perda' && (!_relCat || baseIds.has(String(m.estoque_id))));
    const perdaValor = perdas.reduce((s, m) => s + Number(m.valor_total || 0), 0);
    const catRows = Object.entries(porCat).sort((a, b) => b[1] - a[1]);

    qs('#page-estoque').innerHTML = `
      ${tabsHTML('rel')}
      <div class="page-header"><h1>Relatório</h1></div>
      <div class="filters-bar" style="display:flex;justify-content:flex-end;margin-bottom:12px">
        ${catSelectHTML(_relCat, 'Estoque.onRelCat(this.value)')}
      </div>
      <div class="stats-grid-4 mb-3">
        <div class="stat-card"><div class="stat-label">Valor em estoque</div><div class="stat-value">${Fmt.currency(totalValor)}</div></div>
        <div class="stat-card"><div class="stat-label">Itens cadastrados</div><div class="stat-value">${base.length}</div></div>
        <div class="stat-card ${baixos.length ? 'stat-red' : ''}"><div class="stat-label">Abaixo do mínimo</div><div class="stat-value">${baixos.length}</div></div>
        <div class="stat-card ${perdaValor ? 'stat-red' : ''}"><div class="stat-label">Perdas (total)</div><div class="stat-value">${Fmt.currency(perdaValor)}</div></div>
      </div>
      <div class="card mb-3">
        <div class="card-header"><h3>Valor por categoria</h3></div>
        <div class="card-body">
          ${catRows.length === 0 ? '<p class="text-muted">Sem itens</p>' : catRows.map(([nome, v]) => `
            <div class="info-row"><span>${nome}</span><strong>${Fmt.currency(v)}</strong></div>`).join('')}
        </div>
      </div>
      ${baixos.length ? `
        <div class="card mb-3">
          <div class="card-header"><h3>⚠ Repor (abaixo do mínimo)</h3></div>
          <div class="card-body">
            ${baixos.map(e => `<div class="info-row"><span>${e.descricao}</span><strong>${Number(e.quantidade || 0)} / mín ${Number(e.estoque_minimo || 0)}</strong></div>`).join('')}
          </div>
        </div>` : ''}
    `;
  }

  // ─── ABA LISTA DE COMPRAS (por cliente) — portada do OS ──────
  function renderLista() {
    const { lista, estoque } = _listaCache;
    const grupos = {};
    lista.forEach(l => {
      const k = l.cliente_id || '_sem';
      (grupos[k] = grupos[k] || []).push(l);
    });
    Object.keys(grupos).forEach(k => {
      grupos[k].sort((a, b) => {
        const aP = (a.status || 'pendente') === 'pendente' ? 0 : 1;
        const bP = (b.status || 'pendente') === 'pendente' ? 0 : 1;
        if (aP !== bP) return aP - bP;
        return String(a.data_criacao || '').localeCompare(String(b.data_criacao || ''));
      });
    });
    const grupoIds = Object.keys(grupos).sort((a, b) => App.clienteNome(a).localeCompare(App.clienteNome(b)));

    qs('#page-estoque').innerHTML = `
      ${tabsHTML('lista')}
      <div class="page-header">
        <h1>Lista de Compras</h1>
        <button class="btn btn-primary" onclick="Estoque.openNovaListaForm()">+ Nova Lista</button>
      </div>
      ${grupoIds.length === 0 ? `
        <div class="card mt-3"><div class="card-body">
          <p class="text-muted" style="text-align:center;margin:0">Nenhum item na lista. Toque em <strong>+ Nova Lista</strong> para começar.</p>
        </div></div>` : grupoIds.map(cid => {
        const itens = grupos[cid];
        const pend  = itens.filter(i => (i.status || 'pendente') === 'pendente').length;
        return `
          <div class="card mt-3">
            <div class="card-header">
              <h3>${App.clienteNome(cid)}</h3>
              <div style="display:flex;gap:6px;align-items:center">
                <span class="badge ${pend > 0 ? 'badge-warning' : 'badge-success'}">${pend > 0 ? `${pend} pend.` : '✓ tudo comprado'}</span>
                <button class="btn btn-sm btn-outline" onclick="Estoque.addItensCliente('${cid}')">+ Item</button>
              </div>
            </div>
            <div class="card-body" style="padding:6px 8px">
              ${itens.map(i => {
                const comprado = (i.status || 'pendente') === 'comprado';
                const noEst = estoque.find(e => (e.descricao || '').toLowerCase() === (i.descricao || '').toLowerCase());
                return `
                  <label class="lista-row" style="display:flex;align-items:center;gap:12px;padding:10px 8px;border-bottom:1px solid var(--border);cursor:pointer">
                    <input type="checkbox" ${comprado ? 'checked' : ''}
                      style="width:22px;height:22px;flex:0 0 auto;accent-color:var(--success)"
                      onchange="Estoque.toggleComprado('${i.id}', this.checked)">
                    <div style="flex:1;min-width:0">
                      <div style="font-weight:600;${comprado ? 'text-decoration:line-through;color:var(--text-muted)' : ''}">${i.descricao}</div>
                      <div style="font-size:.78rem;color:var(--text-muted);margin-top:2px">
                        ${i.quantidade || 1} ${i.unidade || 'un'}
                        ${noEst ? ` · <span class="badge badge-success" style="font-size:.65rem">estoque: ${noEst.quantidade}</span>` : ''}
                      </div>
                    </div>
                    <button class="btn btn-sm btn-danger" style="flex:0 0 auto" onclick="event.preventDefault();Estoque.deleteListaItem('${i.id}')">✕</button>
                  </label>`;
              }).join('')}
            </div>
          </div>`;
      }).join('')}
      ${_renderNovaListaModal()}
    `;
  }

  function _renderNovaListaModal() {
    if (!_novaLista._aberto) return '';
    const cliFix = _novaLista.cliente_id;
    return `
      <div class="card mt-3" style="border:2px solid var(--primary)">
        <div class="card-header">
          <h3>Nova Lista de Compras</h3>
          <button class="btn btn-sm btn-outline" onclick="Estoque.fecharNovaLista()">✕</button>
        </div>
        <div class="card-body">
          <div class="form-group">
            <label>Cliente *</label>
            <select id="nl-cliente" class="input" ${cliFix ? 'disabled' : ''} onchange="Estoque._setNovaListaCliente(this.value)">
              ${App.clienteOptions('cliente', cliFix)}
            </select>
            ${cliFix ? '<small style="color:var(--text-muted);font-size:.72rem">Adicionando itens para este cliente. Para trocar, cancele e comece de novo.</small>' : ''}
          </div>
          <hr style="margin:12px 0;border:none;border-top:1px solid var(--border)">
          <div class="form-row">
            <div class="form-group">
              <label>Item</label>
              <input type="text" id="nl-desc" class="input" placeholder="Ex: Parafuso M8"
                onkeydown="if(event.key==='Enter'){event.preventDefault();Estoque.addItemNovaLista();}">
            </div>
            <div class="form-group" style="flex:0 0 80px"><label>Qtd</label>
              <input type="number" id="nl-qtd" class="input" value="1" min="0.01" step="0.01"></div>
            <div class="form-group" style="flex:0 0 80px"><label>Un.</label>
              <input type="text" id="nl-und" class="input" placeholder="un"></div>
          </div>
          <button type="button" class="btn btn-outline btn-full" onclick="Estoque.addItemNovaLista()">+ Adicionar à lista</button>
          ${_novaLista.itens.length > 0 ? `
            <div style="margin-top:14px">
              <div style="font-size:.78rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">
                ${_novaLista.itens.length} item(s) para salvar
              </div>
              ${_novaLista.itens.map((it, i) => `
                <div class="info-row" style="padding:6px 4px">
                  <span>${it.descricao} — ${it.quantidade} ${it.unidade}</span>
                  <button class="btn btn-sm btn-danger" onclick="Estoque.removeItemNovaLista(${i})">✕</button>
                </div>`).join('')}
            </div>` : ''}
        </div>
        <div class="card-body" style="padding-top:0;display:flex;gap:8px">
          <button class="btn btn-outline" onclick="Estoque.fecharNovaLista()">Cancelar</button>
          <button class="btn btn-primary" style="flex:1" onclick="Estoque.salvarNovaLista()" ${_novaLista.itens.length === 0 ? 'disabled' : ''}>
            Salvar ${_novaLista.itens.length > 0 ? `(${_novaLista.itens.length})` : ''}
          </button>
        </div>
      </div>`;
  }

  function openNovaListaForm() { _novaLista = { cliente_id: '', itens: [], _aberto: true }; renderLista(); }
  function fecharNovaLista()   { _novaLista = { cliente_id: '', itens: [], _aberto: false }; renderLista(); }
  function addItensCliente(clienteId) {
    _novaLista = { cliente_id: clienteId, itens: [], _aberto: true };
    renderLista();
    setTimeout(() => qs('#nl-desc')?.focus(), 50);
  }
  function _setNovaListaCliente(id) { _novaLista.cliente_id = id; }
  function addItemNovaLista() {
    const cli  = qs('#nl-cliente')?.value || _novaLista.cliente_id;
    const desc = qs('#nl-desc')?.value.trim();
    const qtd  = Number(qs('#nl-qtd')?.value) || 1;
    const und  = qs('#nl-und')?.value.trim() || 'un';
    if (!cli)  { Toast.warning('Selecione o cliente'); return; }
    if (!desc) { Toast.warning('Informe o item'); return; }
    _novaLista.cliente_id = cli;
    _novaLista.itens.push({ descricao: desc, quantidade: qtd, unidade: und });
    renderLista();
    setTimeout(() => { qs('#nl-desc').value = ''; qs('#nl-qtd').value = '1'; qs('#nl-und').value = ''; qs('#nl-desc')?.focus(); }, 30);
  }
  function removeItemNovaLista(i) { _novaLista.itens.splice(i, 1); renderLista(); }
  // trava de duplo clique (Guard) — o corpo real está em _salvarNovaLista
  function salvarNovaLista() { return Guard.run('estq-lista', _salvarNovaLista); }
  async function _salvarNovaLista() {
    if (!_novaLista.cliente_id || _novaLista.itens.length === 0) return;
    Loading.show();
    const ops = _novaLista.itens.map(it => ({
      action: 'create', sheet: 'lista_compras',
      data: { cliente_id: _novaLista.cliente_id, descricao: it.descricao, quantidade: it.quantidade, unidade: it.unidade, status: 'pendente', data_criacao: DateUtil.today() },
    }));
    const res = await API.db.batch(ops);
    Loading.hide();
    if (res?.success) {
      Toast.success(`${ops.length} item(s) adicionado(s)!`);
      _novaLista = { cliente_id: '', itens: [], _aberto: false };
      await render();
    } else Toast.error('Erro ao salvar lista');
  }
  async function toggleComprado(id, comprado) {
    const novoStatus = comprado ? 'comprado' : 'pendente';
    const it = _listaCache.lista.find(l => l.id === id);
    if (it) it.status = novoStatus;
    renderLista();
    await API.db.update('lista_compras', id, { status: novoStatus });
  }
  async function deleteListaItem(id) {
    Modal.confirm('Remover item da lista?', async () => {
      _listaCache.lista = _listaCache.lista.filter(l => l.id !== id);
      renderLista();
      await API.db.delete('lista_compras', id);
    });
  }

  return {
    render, goTab, switchTab, tabsHTML,
    onSearch, onCatFiltro, onRelCat, toggleGrupo, openDetail, voltarLista,
    openForm, saveForm, onGrupoChange, openBaixa, saveBaixa, confirmDelete,
    // movimentações + inventário
    onMovSearch, onMovMotivo, onContagem, finalizarContagem,
    // lista
    openNovaListaForm, fecharNovaLista, addItensCliente, _setNovaListaCliente,
    addItemNovaLista, removeItemNovaLista, salvarNovaLista, toggleComprado, deleteListaItem,
  };
})();
