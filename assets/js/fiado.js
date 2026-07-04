// ============================================================
// FICHA DOS SÓCIOS (conta-corrente: Rodrigo / Odinei)
// Cada sócio tem uma ficha com extrato de movimentos (razão 'fiado_mov').
// Saldo na PERSPECTIVA DA EMPRESA:
//   > 0  → a empresa deve ao sócio (ele cobriu despesa do bolso)
//   < 0  → o sócio deve à empresa (a empresa emprestou pra ele)
// "Saldo inicial" = reembolsos do modelo antigo ('fiado') ainda pendentes.
// ============================================================

const Fiado = (() => {
  const PESSOAS = ['rodrigo', 'odinei'];
  let allMov      = [];  // fiado_mov (modelo novo)
  let allFiadoOld = [];  // sheet 'fiado' (modelo antigo — vira saldo inicial)
  let _pessoa     = 'rodrigo';

  async function render() {
    await loadData();
    renderView();
  }

  async function loadData() {
    const shown = Loading.maybeShow('fiado_mov', 'fiado');
    const [mRes, fRes] = await Promise.all([
      API.db.read('fiado_mov'),
      API.db.read('fiado'),
      App.loadGlobals(), // popula App.getContas() p/ os modais
    ]);
    if (shown) Loading.hide();
    allMov = (mRes?.data || []).map(m => ({ ...m, pessoa: (m.pessoa || '').toLowerCase() }));
    allFiadoOld = (fRes?.data || []).map(f => ({ ...f, pessoa: (f.pessoa || '').toLowerCase() }));
  }

  const cap = p => (p || '').charAt(0).toUpperCase() + (p || '').slice(1);

  // ─── Saldos ──────────────────────────────────────────────────
  function saldoInicial(pessoa) {
    return allFiadoOld
      .filter(f => f.pessoa === pessoa && f.status === 'pendente')
      .reduce((s, f) => s + Number(f.valor || 0), 0);
  }
  function saldoMov(pessoa) {
    return allMov
      .filter(m => m.pessoa === pessoa && m.status === 'ativo')
      .reduce((s, m) => s + (m.direcao === 'socio_deve' ? -1 : 1) * Number(m.valor || 0), 0);
  }
  function saldo(pessoa) {
    return Math.round((saldoInicial(pessoa) + saldoMov(pessoa)) * 100) / 100;
  }

  // ─── Extrato (movimentos da pessoa, mais recente primeiro) ───
  function movsDaPessoa(pessoa) {
    return allMov
      .filter(m => m.pessoa === pessoa)
      .sort((a, b) => (a.data || '') < (b.data || '') ? 1 : -1);
  }

  const MOTIVO = {
    despesa_bolso: { ico: '🛒', label: 'Pagou do bolso' },
    emprestimo:    { ico: '💵', label: 'Empréstimo' },
    acerto:        { ico: '✅', label: 'Acerto' },
    ajuste:        { ico: '✏️', label: 'Ajuste' },
  };

  // ─── View ────────────────────────────────────────────────────
  function renderView() {
    const section = qs('#page-fiado');
    const s = saldo(_pessoa);
    const empresaDeve = s > 0;
    const zerado = Math.abs(s) < 0.005;

    const saldoLabel = zerado
      ? 'Tudo certo · saldo zerado'
      : (empresaDeve ? `A empresa deve a ${cap(_pessoa)}` : `${cap(_pessoa)} deve à empresa`);
    const saldoCls = zerado ? 'is-zero' : (empresaDeve ? 'is-deve' : 'is-haver');

    const ini = saldoInicial(_pessoa);
    const movs = movsDaPessoa(_pessoa);

    section.innerHTML = `
      <div class="section-tabs">
        <button class="section-tab" onclick="App.navigate('financeiro')">↓ Receber</button>
        <button class="section-tab" onclick="App.navigate('financeiro'); setTimeout(()=>Financeiro.switchTab('pagar'),50)">↑ Pagar</button>
        <button class="section-tab active" onclick="App.navigate('fiado')">Ficha</button>
        <button class="section-tab" onclick="App.navigate('financeiro'); setTimeout(()=>Financeiro.switchTab('resumo'),50)">Resumo</button>
      </div>
      <div class="page-header">
        <h1>Ficha dos Sócios</h1>
      </div>

      <div class="tab-bar mb-3">
        ${PESSOAS.map(p => {
          const sp = saldo(p);
          const sub = Math.abs(sp) < 0.005 ? 'zerado'
            : (sp > 0 ? `empresa deve ${Fmt.currency(sp)}` : `deve ${Fmt.currency(-sp)}`);
          return `<button class="tab-btn ${_pessoa === p ? 'active' : ''}" onclick="Fiado.switchPessoa('${p}')">
                    ${cap(p)}<span class="ficha-tab-sub">${sub}</span>
                  </button>`;
        }).join('')}
      </div>

      <div class="ficha-saldo-card ${saldoCls}">
        <div class="ficha-saldo-label">${saldoLabel}</div>
        <div class="ficha-saldo-value">${zerado ? Fmt.currency(0) : Fmt.currency(Math.abs(s))}</div>
        ${ini > 0 ? `<div class="ficha-saldo-ini">Inclui ${Fmt.currency(ini)} de fiado anterior</div>` : ''}
        <div class="ficha-actions">
          <button class="btn btn-sm ficha-btn-emp" onclick="Fiado.openEmprestimo()">💵 Emprestar</button>
          <button class="btn btn-sm ficha-btn-aj" onclick="Fiado.openAjuste()">✏️ Ajuste</button>
          ${zerado ? '' : `<button class="btn btn-sm ficha-btn-ac" onclick="Fiado.openAcerto()">✅ Acerto</button>`}
        </div>
      </div>

      <div class="ficha-extrato-head">Movimentações</div>
      <div class="entity-list">
        ${movs.length === 0 && ini === 0
          ? '<div class="entity-empty">Nenhuma movimentação ainda</div>'
          : movs.map(m => movRow(m)).join('') +
            (ini > 0 ? `
              <div class="entity-item ficha-mov is-ini">
                <div class="ficha-mov-ico">📋</div>
                <div class="entity-info">
                  <div class="entity-name">Saldo anterior (fiado)</div>
                  <div class="entity-sub">modelo antigo · pendente</div>
                </div>
                <div class="entity-right">
                  <span class="entity-value ficha-v-deve">+${Fmt.currency(ini)}</span>
                </div>
              </div>` : '')
        }
      </div>
    `;
  }

  function movRow(m) {
    const info = MOTIVO[m.motivo] || { ico: '•', label: m.motivo || '' };
    const empresaDeve = m.direcao === 'empresa_deve';
    const sinal = empresaDeve ? '+' : '−';
    const vcls  = empresaDeve ? 'ficha-v-deve' : 'ficha-v-haver';
    const acertado = m.status === 'acertado';
    return `
      <div class="entity-item ficha-mov ${acertado ? 'is-acertado' : ''}" onclick="Fiado.tapMov('${m.id}')">
        <div class="ficha-mov-ico">${info.ico}</div>
        <div class="entity-info">
          <div class="entity-name">${m.descricao || info.label}</div>
          <div class="entity-sub">${Fmt.date(m.data)} · ${info.label}${acertado ? ' · <strong>já acertado</strong>' : ''}</div>
        </div>
        <div class="entity-right">
          <span class="entity-value ${vcls}">${sinal}${Fmt.currency(Number(m.valor || 0))}</span>
          ${acertado ? '<span class="badge badge-success">acertado</span>' : ''}
        </div>
      </div>`;
  }

  function switchPessoa(p) { _pessoa = p; renderView(); }

  // ─── Emprestar (empresa → sócio) ─────────────────────────────
  function openEmprestimo() {
    qs('#femp-pessoa').value = _pessoa;
    qs('#femp-pessoa-label').textContent = cap(_pessoa);
    qs('#femp-valor').value = '';
    qs('#femp-desc').value  = '';
    qs('#femp-data').value  = DateUtil.today();
    qs('#femp-conta').innerHTML = App.contaOptions('', '— Selecione a conta —');
    Modal.open('modal-fiado-emprestimo');
  }
  // trava de duplo clique (Guard) — o corpo real está em _confirmEmprestimo
  function confirmEmprestimo() { return Guard.run('fiado-emprestimo', _confirmEmprestimo); }
  async function _confirmEmprestimo() {
    const pessoa = qs('#femp-pessoa').value;
    const valor  = Number(qs('#femp-valor').value) || 0;
    const conta  = qs('#femp-conta').value;
    const data   = qs('#femp-data').value;
    const desc   = qs('#femp-desc').value.trim();
    if (!valor) { Toast.warning('Informe o valor'); return; }
    if (!conta) { Toast.warning('Selecione a conta de onde sai o dinheiro'); return; }
    Loading.show();
    const res = await API.db.registrarEmprestimoSocio({
      pessoa, valor, conta_id: conta, data,
      descricao: desc || `Empréstimo a ${cap(pessoa)}`,
    });
    Loading.hide();
    if (res?.success) {
      Toast.success(`Empréstimo de ${Fmt.currency(valor)} para ${cap(pessoa)} registrado.`);
      Modal.close('modal-fiado-emprestimo');
      _pessoa = pessoa;
      await loadData(); renderView();
    } else Toast.error('Erro: ' + (res?.error || 'falha ao registrar'));
  }

  // ─── Ajuste manual (sem efeito em conta) ─────────────────────
  function openAjuste() {
    qs('#faj-pessoa').value = _pessoa;
    qs('#faj-pessoa-label').textContent = cap(_pessoa);
    qs('#faj-direcao').value = 'empresa_deve';
    qs('#faj-valor').value = '';
    qs('#faj-desc').value  = '';
    qs('#faj-data').value  = DateUtil.today();
    Modal.open('modal-fiado-ajuste');
  }
  // trava de duplo clique (Guard) — o corpo real está em _confirmAjuste
  function confirmAjuste() { return Guard.run('fiado-ajuste', _confirmAjuste); }
  async function _confirmAjuste() {
    const pessoa  = qs('#faj-pessoa').value;
    const direcao = qs('#faj-direcao').value;
    const valor   = Number(qs('#faj-valor').value) || 0;
    const data    = qs('#faj-data').value;
    const desc    = qs('#faj-desc').value.trim();
    if (!valor) { Toast.warning('Informe o valor'); return; }
    Loading.show();
    const res = await API.db.registrarFiadoMovManual({
      pessoa, direcao, valor, data, descricao: desc || 'Ajuste manual',
    });
    Loading.hide();
    if (res?.success) {
      Toast.success('Ajuste registrado na ficha.');
      Modal.close('modal-fiado-ajuste');
      _pessoa = pessoa;
      await loadData(); renderView();
    } else Toast.error('Erro: ' + (res?.error || 'falha'));
  }

  // ─── Acerto (zera o saldo) ───────────────────────────────────
  function openAcerto() {
    const s = saldo(_pessoa);
    if (Math.abs(s) < 0.005) { Toast.warning('Nada a acertar — saldo zerado'); return; }
    const empresaDeve = s > 0;
    qs('#fac-pessoa').value = _pessoa;
    qs('#fac-desc').innerHTML = empresaDeve
      ? `A empresa vai <strong>pagar ${Fmt.currency(s)}</strong> para <strong>${cap(_pessoa)}</strong> e zerar a ficha.`
      : `<strong>${cap(_pessoa)}</strong> vai <strong>devolver ${Fmt.currency(-s)}</strong> para a empresa e zerar a ficha.`;
    qs('#fac-conta-label').textContent = empresaDeve ? 'Conta de onde sai o pagamento' : 'Conta que recebe';
    qs('#fac-data').value  = DateUtil.today();
    qs('#fac-conta').innerHTML = App.contaOptions('', '— Selecione a conta —');
    Modal.open('modal-fiado-acerto');
  }
  // trava de duplo clique (Guard) — o corpo real está em _confirmAcerto
  function confirmAcerto() { return Guard.run('fiado-acerto', _confirmAcerto); }
  async function _confirmAcerto() {
    const pessoa = qs('#fac-pessoa').value;
    const data   = qs('#fac-data').value;
    const conta  = qs('#fac-conta').value;
    if (!data)  { Toast.warning('Informe a data'); return; }
    if (!conta) { Toast.warning('Selecione a conta'); return; }
    Loading.show();
    const res = await API.db.acertarFiado({ pessoa, conta_id: conta, data });
    Loading.hide();
    if (res?.success) {
      Toast.success(`Acerto de ${Fmt.currency(res.valor)} — ficha de ${cap(pessoa)} zerada.`);
      Modal.close('modal-fiado-acerto');
      _pessoa = pessoa;
      await loadData(); renderView();
    } else Toast.error('Erro: ' + (res?.error || 'falha ao acertar'));
  }

  // ─── Tap num movimento ───────────────────────────────────────
  function tapMov(id) {
    const m = allMov.find(x => x.id === id);
    if (!m) return;
    if (m.status === 'acertado') {
      Toast.show('Movimento já acertado (histórico).', 'info', 3000);
      return;
    }
    const actions = [];
    if (m.motivo === 'ajuste') {
      actions.push({ icon: '🗑', label: 'Excluir ajuste', danger: true, fn: () => excluirAjuste(id) });
    } else if (m.motivo === 'emprestimo') {
      actions.push({ icon: 'ℹ️', label: 'Excluir pelo Financeiro', fn: () =>
        Toast.show('Para apagar um empréstimo, exclua o lançamento no Financeiro.', 'info', 4000) });
    } else if (m.motivo === 'despesa_bolso') {
      actions.push({ icon: 'ℹ️', label: 'Vem de uma despesa', fn: () =>
        Toast.show('Esta linha veio de uma despesa paga pelo sócio. Edite/exclua a despesa no Financeiro.', 'info', 4500) });
    }
    if (actions.length === 0) return;
    ActionSheet.open(m.descricao || 'Movimento', actions);
  }
  // trava de duplo clique (Guard) — o corpo real está em _excluirAjuste
  function excluirAjuste(id) { return Guard.run('fiado-excluir', () => _excluirAjuste(id)); }
  async function _excluirAjuste(id) {
    Modal.confirm('Excluir este ajuste da ficha?', async () => {
      await API.db.delete('fiado_mov', id);
      Toast.success('Ajuste excluído');
      await loadData(); renderView();
    });
  }

  return {
    render, renderView, switchPessoa,
    openEmprestimo, confirmEmprestimo,
    openAjuste, confirmAjuste,
    openAcerto, confirmAcerto,
    tapMov,
  };
})();
