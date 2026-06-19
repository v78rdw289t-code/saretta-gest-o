// ============================================================
// CONFIGURAÇÕES
// ============================================================

const Config = (() => {
  let allConfig = [];
  let allCategorias = [];
  let allContas = [];

  async function render() {
    await loadData();
    renderView();
  }

  async function loadData() {
    Loading.show();
    const [cfgRes, catRes, conRes] = await Promise.all([
      API.db.read('config'),
      API.db.read('categorias'),
      API.db.read('contas'),
    ]);
    Loading.hide();
    allConfig     = cfgRes?.data || [];
    allCategorias = catRes?.data || [];
    allContas     = (conRes?.data || []).sort((a, b) => (Number(a.ordem)||0) - (Number(b.ordem)||0));
  }

  function getCfg(chave, def = '') {
    return allConfig.find(c => c.chave === chave)?.valor ?? def;
  }

  function renderView() {
    const section = qs('#page-config');
    const urlAtual = LocalConfig.getUrl();
    const tokenAtual = LocalConfig.getToken();

    section.innerHTML = `
      <div class="page-header"><h1>Configurações</h1></div>

      <div class="grid-2col">
        <div class="card">
          <div class="card-header"><h3>Conexão com Google Sheets</h3></div>
          <div class="card-body">
            <div class="form-group">
              <label>URL do Google Apps Script</label>
              <input type="url" id="cfg-url" class="input" value="${urlAtual}"
                placeholder="https://script.google.com/macros/s/...">
            </div>
            <div class="form-group">
              <label>Token de acesso <small style="color:var(--text-muted);font-weight:400">(segurança — deixe igual ao do Apps Script)</small></label>
              <input type="text" id="cfg-token" class="input" value="${tokenAtual}"
                placeholder="cole aqui o mesmo token do backend" autocomplete="off">
            </div>
            <button class="btn btn-primary" onclick="Config.saveUrl()">Salvar conexão</button>
            ${urlAtual ? `<button class="btn btn-outline ml-2" onclick="Config.testarConexao()">Testar Conexão</button>` : ''}
            <div id="cfg-status" class="mt-2"></div>
            ${!urlAtual ? `
              <div class="alert alert-warning mt-3">
                ⚠ <strong>Configure a URL do Apps Script</strong> para usar o sistema.<br>
                Veja as instruções no README.md do projeto.
              </div>
            ` : ''}
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>⚡ Calculadora de Serviços</h3></div>
          <div class="card-body">
            <form id="cfg-horas-form" onsubmit="Config.saveHoras(event)">
              <p style="font-size:.8rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:12px">Valores da Hora</p>
              <div class="form-row">
                <div class="form-group">
                  <label>🔧 Manutenção (R$/h)</label>
                  <input type="number" name="valor_hora_manutencao" class="input" step="0.01"
                    value="${getCfg('valor_hora_manutencao', '155')}" required>
                </div>
                <div class="form-group">
                  <label>🏗️ Projeto Novo (R$/h)</label>
                  <input type="number" name="valor_hora_projeto" class="input" step="0.01"
                    value="${getCfg('valor_hora_projeto', '200')}" required>
                </div>
              </div>
              <p style="font-size:.8rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin:14px 0 12px">Material e Chamada</p>
              <div class="form-row">
                <div class="form-group">
                  <label>Taxa Admin. Material (%)</label>
                  <input type="number" name="taxa_admin_material" class="input" step="0.5"
                    value="${getCfg('taxa_admin_material', '15')}">
                </div>
                <div class="form-group">
                  <label>Simples Nacional (%)</label>
                  <input type="number" name="simples_aliquota" class="input" step="0.1" max="20"
                    value="${getCfg('simples_aliquota', '0')}">
                </div>
                <div class="form-group">
                  <label>🚗 Chamada Próximo (R$)</label>
                  <input type="number" name="valor_chamada_proximo" class="input" step="1"
                    value="${getCfg('valor_chamada_proximo', '200')}">
                </div>
                <div class="form-group">
                  <label>🚗 Chamada Distante (R$)</label>
                  <input type="number" name="valor_chamada_distante" class="input" step="1"
                    value="${getCfg('valor_chamada_distante', '250')}">
                </div>
              </div>
              <p style="font-size:.8rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin:14px 0 12px">Custos do Negócio</p>
              <div class="form-group">
                <label>🏢 Custo fixo mensal (R$)</label>
                <input type="number" name="custo_fixo_mensal" class="input" step="50" min="0"
                  value="${getCfg('custo_fixo_mensal', '14500')}"
                  placeholder="Ex: 14500 — salários, combustível, manutenção, aluguel...">
                <small style="color:var(--text-muted);font-size:.75rem">Diluído pelos dias úteis do mês para calcular o custo por dia e o lucro real de cada OS.</small>
              </div>
              <div class="form-group">
                <label>Nome da Empresa</label>
                <input type="text" name="empresa_nome" class="input"
                  value="${getCfg('empresa_nome', 'Saretta Serviços')}">
              </div>
              <button type="submit" class="btn btn-primary btn-full">Salvar Configurações</button>
            </form>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>⚡ Fatores de Ajuste</h3>
            <button class="btn btn-sm btn-outline" onclick="Config.saveFatores()">Salvar</button>
          </div>
          <div class="card-body">
            <p style="font-size:.78rem;color:var(--text-muted);margin-bottom:12px">Percentuais aplicados sobre o valor hora na calculadora de manutenção.</p>
            <div id="fatores-list">
              ${(() => {
                const fatores = (() => { try { const s = getCfg('fatores_json'); if (!s) return Calculator.FATORES_DEFAULT; const p = JSON.parse(s); return p.length > 0 ? p : Calculator.FATORES_DEFAULT; } catch { return Calculator.FATORES_DEFAULT; } })();
                return fatores.map(f => `
                  <div class="info-row" style="gap:10px">
                    <span style="flex:1;font-size:.85rem">${f.label}</span>
                    <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
                      <input type="number" class="input fator-perc" style="width:70px;text-align:right;padding:6px 8px"
                        data-id="${f.id}" value="${f.percentual}" min="0" max="200">
                      <span style="font-size:.85rem;color:var(--text-muted)">%</span>
                    </div>
                  </div>
                `).join('');
              })()}
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>Categorias</h3>
            <button class="btn btn-sm btn-primary" onclick="Config.openCatForm()">+ Nova</button>
          </div>
          <div class="table-responsive">
            <table class="table">
              <thead><tr><th>Nome</th><th>Tipo</th><th>Ativo</th><th></th></tr></thead>
              <tbody>
                ${allCategorias.map(c => `
                  <tr>
                    <td>${c.nome}</td>
                    <td><span class="badge ${c.tipo==='entrada'?'badge-success':c.tipo==='saida'?'badge-danger':c.tipo==='os'?'badge-info':'badge-secondary'}">${c.tipo}</span></td>
                    <td>${c.ativo !== false && c.ativo !== 'false' ? '✓' : '—'}</td>
                    <td>
                      <button class="btn btn-sm btn-outline" onclick="Config.openCatForm('${c.id}')">Editar</button>
                      <button class="btn btn-sm btn-danger" onclick="Config.toggleCat('${c.id}', ${c.ativo})">
                        ${c.ativo !== false && c.ativo !== 'false' ? 'Desativar' : 'Ativar'}
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>💳 Contas</h3>
            <button class="btn btn-sm btn-primary" onclick="Config.openContaForm()">+ Nova Conta</button>
          </div>
          <div class="card-body">
            <p style="font-size:.78rem;color:var(--text-muted);margin-bottom:12px">
              O saldo inicial é o ponto de partida — não conta como receita.
              Cada pagamento/recebimento debita/credita a conta escolhida.
            </p>
            <div class="table-responsive">
              <table class="table">
                <thead><tr><th>Nome</th><th>Saldo Inicial</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  ${allContas.length === 0 ? `
                    <tr><td colspan="4" class="text-muted" style="text-align:center;padding:14px">Nenhuma conta cadastrada</td></tr>
                  ` : allContas.map(c => `
                    <tr>
                      <td><strong>${c.nome}</strong></td>
                      <td>${Fmt.currency(Number(c.saldo_inicial || 0))}</td>
                      <td>${c.ativo !== false && c.ativo !== 'false' ? '<span class="badge badge-success">Ativa</span>' : '<span class="badge badge-secondary">Inativa</span>'}</td>
                      <td>
                        <button class="btn btn-sm btn-outline" onclick="Config.openContaForm('${c.id}')">Editar</button>
                        <button class="btn btn-sm btn-danger"  onclick="Config.toggleConta('${c.id}', ${c.ativo})">
                          ${c.ativo !== false && c.ativo !== 'false' ? 'Desativar' : 'Ativar'}
                        </button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Banco de Dados</h3></div>
          <div class="card-body">
            <p class="text-muted mb-3">Inicializa as planilhas no Google Sheets pela primeira vez. Também corrige parcelas com conta vinculada errada.</p>
            <button class="btn btn-secondary" onclick="Config.initDB()">Inicializar Planilhas</button>
            <button class="btn btn-outline ml-2" onclick="Config.repairDB()" style="margin-top:8px">🔧 Reparar Dados</button>
          </div>
        </div>
      </div>
    `;
  }

  function saveUrl() {
    const url = qs('#cfg-url').value.trim();
    LocalConfig.setUrl(url);
    LocalConfig.setToken(qs('#cfg-token')?.value || '');
    API.clearCache();              // token novo → cache antigo pode ser inválido
    Calculator.invalidateConfig();
    Toast.success('Conexão salva!');
    qs('#cfg-status').innerHTML = '<span class="badge badge-success">Conexão configurada</span>';
    render();
  }

  async function testarConexao() {
    qs('#cfg-status').textContent = 'Testando...';
    const res = await API.db.stats();
    if (res?.success) {
      qs('#cfg-status').innerHTML = '<span class="badge badge-success">✓ Conexão OK!</span>';
    } else {
      qs('#cfg-status').innerHTML = '<span class="badge badge-danger">✕ Erro de conexão</span>';
    }
  }

  async function saveHoras(e) {
    e.preventDefault();
    const fd   = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());

    const ops = Object.entries(data).map(([chave, valor]) => {
      const existing = allConfig.find(c => c.chave === chave);
      return existing
        ? { action: 'update', sheet: 'config', id: existing.id, data: { valor } }
        : { action: 'create', sheet: 'config', data: { chave, valor, descricao: '' } };
    });

    Loading.show();
    await API.db.batch(ops);
    Loading.hide();
    Calculator.invalidateConfig();
    Toast.success('Configurações salvas!');
    await loadData(); renderView();
  }

  let _editCatId = '';
  function openCatForm(id = '') {
    _editCatId = id;
    const cat = id ? allCategorias.find(x => x.id === id) : null;
    qs('#cat-form-nome').value = cat?.nome || '';
    qs('#cat-form-tipo').value = cat?.tipo || 'ambos';
    qs('#cat-form-title').textContent = cat ? 'Editar Categoria' : 'Nova Categoria';
    qs('#cat-save-btn').textContent   = cat ? 'Salvar' : 'Criar';
    Modal.open('modal-categoria');
  }

  async function saveCat() {
    const nome = qs('#cat-form-nome').value.trim();
    const tipo = qs('#cat-form-tipo').value;
    if (!nome) { Toast.warning('Informe o nome'); return; }
    Loading.show();
    if (_editCatId) {
      await API.db.update('categorias', _editCatId, { nome, tipo });
    } else {
      await API.db.create('categorias', { nome, tipo, ativo: true });
    }
    Loading.hide();
    Toast.success(_editCatId ? 'Categoria atualizada!' : 'Categoria criada!');
    Modal.close('modal-categoria');
    _editCatId = '';
    await loadData();
    await App.loadGlobals();
    renderView();
  }

  async function toggleCat(id, atual) {
    await API.db.update('categorias', id, { ativo: !atual || atual === 'false' });
    await loadData();
    await App.loadGlobals();
    renderView();
  }

  async function saveFatores() {
    const inputs = qsa('.fator-perc');
    const fatores = inputs.map(inp => {
      const id = Number(inp.dataset.id);
      const base = Calculator.FATORES_DEFAULT.find(f => f.id === id);
      return { id, label: base?.label || '', percentual: Number(inp.value) || 0 };
    });
    const valor = JSON.stringify(fatores);
    const existing = allConfig.find(c => c.chave === 'fatores_json');
    const ops = [existing
      ? { action: 'update', sheet: 'config', id: existing.id, data: { valor } }
      : { action: 'create', sheet: 'config', data: { chave: 'fatores_json', valor, descricao: 'Fatores de ajuste da calculadora' } }
    ];
    Loading.show();
    await API.db.batch(ops);
    Loading.hide();
    Calculator.invalidateConfig();
    Toast.success('Fatores salvos!');
    await loadData(); renderView();
  }

  // ─── CONTAS ─────────────────────────────────────────────
  let _editContaId = '';
  function openContaForm(id = '') {
    _editContaId = id;
    const c = id ? allContas.find(x => x.id === id) : null;
    qs('#conta-form-nome').value     = c?.nome || '';
    qs('#conta-form-saldo').value    = c ? Number(c.saldo_inicial || 0) : 0;
    qs('#conta-form-obs').value      = c?.observacoes || '';
    qs('#conta-form-title').textContent = c ? 'Editar Conta' : 'Nova Conta';
    Modal.open('modal-conta');
  }

  async function saveConta() {
    const nome  = qs('#conta-form-nome').value.trim();
    const saldo = Number(qs('#conta-form-saldo').value) || 0;
    const obs   = qs('#conta-form-obs').value;
    if (!nome) { Toast.warning('Informe o nome da conta'); return; }
    Loading.show();
    let res;
    try {
      if (_editContaId) {
        res = await API.db.update('contas', _editContaId, { nome, saldo_inicial: saldo, observacoes: obs });
      } else {
        const ordem = (allContas.reduce((m, c) => Math.max(m, Number(c.ordem)||0), 0)) + 1;
        res = await API.db.create('contas', { nome, saldo_inicial: saldo, observacoes: obs, ativo: true, ordem });
      }
    } catch (e) {
      Loading.hide();
      console.error('[Config.saveConta] erro', e);
      Toast.error('Erro ao salvar: ' + (e?.message || e));
      return;
    }
    Loading.hide();
    if (!res?.success) {
      console.error('[Config.saveConta] backend retornou erro', res);
      Toast.error('Falhou: ' + (res?.error || 'verifique se a planilha "contas" existe (Inicializar Planilhas)'));
      return;
    }
    Toast.success(_editContaId ? 'Conta atualizada!' : 'Conta criada!');
    Modal.close('modal-conta');
    _editContaId = '';
    // Limpa o cache local pra garantir refetch fresco do backend
    try { API.clearCache(); } catch {}
    await loadData();
    await App.loadGlobals();
    renderView();
  }

  async function toggleConta(id, atual) {
    Loading.show();
    const res = await API.db.update('contas', id, { ativo: !atual || atual === 'false' });
    Loading.hide();
    if (!res?.success) { Toast.error('Erro: ' + (res?.error || 'falhou')); return; }
    try { API.clearCache(); } catch {}
    await loadData();
    await App.loadGlobals();
    renderView();
  }

  async function initDB() {
    if (!LocalConfig.getUrl()) { Toast.warning('Configure a URL do Apps Script primeiro'); return; }
    Loading.show();
    const res = await API.db.initDB();
    Loading.hide();
    if (res?.success) {
      const repaired = (res.results || []).find(r => r.includes('Reparadas'));
      Toast.success('Planilhas inicializadas!' + (repaired ? ' ' + repaired + '.' : ''));
      API.clearCache();
      await loadData(); renderView();
    } else Toast.error('Erro: ' + res?.error);
  }

  async function repairDB() {
    if (!LocalConfig.getUrl()) { Toast.warning('Configure a URL do Apps Script primeiro'); return; }
    Loading.show();
    const res = await API.db.repairDB();
    Loading.hide();
    if (res?.success) {
      const n = res.fixed || 0;
      Toast.success(n > 0 ? `${n} parcela(s) reparadas — saldo das contas atualizado!` : 'Nenhuma inconsistência encontrada.');
      if (n > 0) API.clearCache();
    } else Toast.error('Erro: ' + (res?.error || ''));
  }

  return { render, saveUrl, testarConexao, saveHoras, saveFatores,
           openCatForm, saveCat, toggleCat,
           openContaForm, saveConta, toggleConta,
           initDB, repairDB };
})();
