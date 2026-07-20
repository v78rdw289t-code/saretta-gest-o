// ============================================================
// AGENDA DA SEMANA (v3.5.0)
// Grade semanal na home + página completa. Integra compromissos
// (visita/orçamento/compromisso/lembrete) + marcadores read-only
// de contas a vencer (parcelas) e OS iniciando na semana.
// Entidade nova: sheet `compromissos` (CRUD genérico do API.db).
// ============================================================

const Agenda = (() => {
  const MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const TIPOS = {
    visita:      { label: 'Visita',      icon: '👤' },
    orcamento:   { label: 'Orçamento',   icon: '📄' },
    compromisso: { label: 'Compromisso', icon: '📌' },
    lembrete:    { label: 'Lembrete',    icon: '🔔' },
  };

  // Estado da grade: semana atual + dia selecionado (índice 0=seg … 6=dom).
  // Deriva de DateUtil.today() (mesma base da faixa) p/ não desencontrar do "hoje".
  let _semanaOffset = 0;
  let _diaSelIdx    = (new Date(DateUtil.today() + 'T00:00:00').getDay() + 6) % 7;
  let _compromissos = [];
  let _parcelas     = [];
  let _os           = [];
  let _loaded       = false;

  // ─── helpers ──────────────────────────────────────────────
  const curta = (d) => {
    const dt = new Date(String(d).substring(0, 10) + 'T00:00:00');
    return isNaN(dt.getTime()) ? '' : `${dt.getDate()} ${MESES[dt.getMonth()]}`;
  };
  const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const esc = (s) => String(s ?? '').replace(/[<>&"]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c]));

  const weekDates = () => DateUtil.weekDays(DateUtil.today(), _semanaOffset);
  const diaSel    = () => weekDates()[_diaSelIdx];

  function osById(id)   { return _os.find(o => o.id === id); }
  function osNumCurto(o){ return '#' + String(o?.numero || '').replace(/^OS-?/i, ''); }
  function osChip(id) {
    const o = osById(id);
    return o ? `<span class="ag-oschip">OS ${osNumCurto(o)}</span>` : '';
  }
  function osOptions(sel = '') {
    const list = _os.filter(o => o.status === 'andamento')
      .sort((a, b) => (a.numero || '').localeCompare(b.numero || '', 'pt-BR'));
    return '<option value="">Nenhuma</option>' + list.map(o =>
      `<option value="${o.id}" ${o.id === sel ? 'selected' : ''}>${esc(o.numero)} — ${esc(App.clienteNome(o.cliente_id))}</option>`).join('');
  }

  // ─── dados ────────────────────────────────────────────────
  async function loadData(force = false) {
    if (_loaded && !force) return;
    const [cRes, pRes, oRes] = await Promise.all([
      API.db.read('compromissos').catch(() => null),
      API.db.read('parcelas').catch(() => null),
      API.db.read('os').catch(() => null),
    ]);
    _compromissos = cRes?.data || [];
    _parcelas     = pRes?.data || [];
    _os           = oRes?.data || [];
    _loaded = true;
  }

  // Itens de um dia: compromissos (editáveis) + contas a vencer + OS iniciando (read-only).
  function itensDoDia(data) {
    const compromissos = _compromissos
      .filter(c => Fmt.dateInput(c.data) === data && c.status !== 'cancelado')
      .sort((a, b) => (Fmt.timeInput(a.hora_inicio) || '99:99').localeCompare(Fmt.timeInput(b.hora_inicio) || '99:99')
                   || (Number(a.ordem) || 0) - (Number(b.ordem) || 0));
    const contas = _parcelas.filter(p =>
      Fmt.dateInput(p.data_vencimento) === data &&
      p.status !== 'pago' && p.status !== 'cancelado' &&
      !origemForaResultado(p.origem));
    const os = _os.filter(o => o.status === 'andamento' && Fmt.dateInput(o.data_inicio) === data);
    return { compromissos, contas, os };
  }
  function countDoDia(data) {
    const { compromissos, contas, os } = itensDoDia(data);
    return compromissos.length + contas.length + os.length;
  }

  // ─── HTML ─────────────────────────────────────────────────
  function weekNavHTML() {
    const dates = weekDates();
    const label = `${curta(dates[0])} – ${curta(dates[6])}`;
    const suf = _semanaOffset === 0 ? ' · esta semana'
             : _semanaOffset === 1 ? ' · próxima' : '';
    return `<div class="ag-weeknav">
      <button class="ag-nav-btn" onclick="Agenda.homeWeek(-1)" aria-label="Semana anterior">‹</button>
      <span class="ag-weeklabel">${label}${suf}</span>
      <button class="ag-nav-btn" onclick="Agenda.homeWeek(1)" aria-label="Próxima semana">›</button>
    </div>`;
  }

  function weekStripHTML() {
    const dates = weekDates();
    const hoje = DateUtil.today();
    return `<div class="ag-strip">` + dates.map((d, i) => {
      const n = countDoDia(d);
      const cls = (d === hoje ? ' is-hoje' : '') + (i === _diaSelIdx ? ' is-sel' : '');
      return `<button class="ag-day${cls}" onclick="Agenda.selectDay(${i})">
        <span class="ag-day-wd">${DateUtil.weekdayShort(d)}</span>
        <span class="ag-day-n">${Number(d.substring(8, 10))}</span>
        <span class="ag-day-dot">${n > 0 ? '•' + n : ''}</span>
      </button>`;
    }).join('') + `</div>`;
  }

  function dayLabelHTML(data, count) {
    const rel = Fmt.dataRelativa(data);
    const relSuf = ['hoje', 'amanhã', 'ontem'].includes(rel) ? ` <span class="ag-rel">· ${rel}</span>` : '';
    return `<div class="ag-daylabel">
      <span>${cap(DateUtil.weekdayLong(data))}, ${curta(data)}${relSuf}</span>
      <span class="ag-daycount">${count} ${count === 1 ? 'item' : 'itens'}</span>
    </div>`;
  }

  function compromissoHTML(c) {
    const t = TIPOS[c.tipo] || TIPOS.compromisso;
    const hora = Fmt.timeInput(c.hora_inicio);
    const cli = c.cliente_id ? App.clienteNome(c.cliente_id) : '';
    const titulo = c.titulo || (cli ? `${t.label} — ${cli}` : t.label);
    const subParts = [];
    if (hora) subParts.push(`🕐 ${hora}`);
    if (cli && c.titulo) subParts.push(esc(cli));
    if (c.os_id) subParts.push(osChip(c.os_id));
    const feito = c.status === 'feito';
    return `<div class="ag-item${feito ? ' is-feito' : ''}" onclick="Agenda.tapItem('${c.id}')">
      <div class="ag-ico">${t.icon}</div>
      <div class="ag-body">
        <div class="ag-title">${esc(titulo)}</div>
        ${subParts.length ? `<div class="ag-sub">${subParts.join(' · ')}</div>` : ''}
      </div>
      <span class="ag-more">⋮</span>
    </div>`;
  }

  function contaHTML(p) {
    const rec = p.tipo === 'receber';
    return `<div class="ag-item is-conta ${rec ? 'is-rec' : 'is-pag'}" onclick="Agenda.abrirParcela('${p.id}')">
      <div class="ag-ico">${rec ? '↑' : '↓'}</div>
      <div class="ag-body">
        <div class="ag-title">${esc(p.descricao || '—')} <span class="ag-tag">${rec ? 'a receber' : 'a pagar'}</span></div>
        <div class="ag-sub">${Fmt.currency(p.valor)} · vence ${Fmt.dataRelativa(p.data_vencimento)}</div>
      </div>
      <span class="ag-more">›</span>
    </div>`;
  }

  function osHTML(o) {
    const cli = App.clienteNome(o.cliente_id);
    return `<div class="ag-item is-os" onclick="Agenda.abrirOS('${o.id}')">
      <div class="ag-ico">🔧</div>
      <div class="ag-body">
        <div class="ag-title">${esc(o.nome || ('OS ' + o.numero))}</div>
        <div class="ag-sub">OS ${osNumCurto(o)} · início${cli ? ' · ' + esc(cli) : ''}</div>
      </div>
      <span class="ag-more">›</span>
    </div>`;
  }

  // Lista de um dia (usada na home e em cada bloco da página).
  function diaItensHTML(data) {
    const { compromissos, contas, os } = itensDoDia(data);
    if (!compromissos.length && !contas.length && !os.length) {
      return `<div class="ag-empty">Nada nesse dia · <button class="ag-empty-add" onclick="Agenda.openForm('${data}')">＋ agendar</button></div>`;
    }
    return compromissos.map(compromissoHTML).join('')
         + os.map(osHTML).join('')
         + contas.map(contaHTML).join('');
  }

  // ─── HOME: faixa + dia selecionado ────────────────────────
  function fillHome() {
    const el = qs('#home-agenda');
    if (!el) return;
    const d = diaSel();
    el.innerHTML = weekNavHTML() + weekStripHTML()
      + dayLabelHTML(d, countDoDia(d)) + diaItensHTML(d);
  }

  async function renderHomeSection() {
    const el = qs('#home-agenda');
    if (!el) return;
    if (!LocalConfig.getUrl()) {
      el.innerHTML = '<p class="text-muted p-3" style="margin:0">Configure a conexão em Configurações</p>';
      return;
    }
    await loadData();
    fillHome();
  }

  // ─── PÁGINA: "A fazer" (checklist agrupado por prazo) ─────────
  // Lembrete manual (compromisso) com checkbox; contas a vencer e OS iniciando
  // entram como itens automáticos (read-only), encaixados nos grupos por data.
  function lembreteHTML(c) {
    const t = TIPOS[c.tipo] || TIPOS.compromisso;
    const cli = c.cliente_id ? App.clienteNome(c.cliente_id) : '';
    const titulo = c.titulo || (cli ? `${t.label} — ${cli}` : t.label);
    const feito = c.status === 'feito';
    const sub = [];
    const hora = Fmt.timeInput(c.hora_inicio);
    if (hora) sub.push(`🕐 ${hora}`);
    if (cli && c.titulo) sub.push(esc(cli));
    if (c.os_id) sub.push(osChip(c.os_id));
    return `<div class="afazer-item${feito ? ' is-feito' : ''}">
      <button class="afazer-check${feito ? ' on' : ''}" onclick="Agenda.toggleFeito('${c.id}')" aria-label="Concluir">${feito ? '✓' : ''}</button>
      <div class="afazer-body" onclick="Agenda.tapItem('${c.id}')">
        <div class="ag-title">${esc(titulo)}</div>
        ${sub.length ? `<div class="ag-sub">${sub.join(' · ')}</div>` : ''}
      </div>
    </div>`;
  }

  function _dateOf(it) {
    if (it.kind === 'lembrete') return it.obj.data ? Fmt.dateInput(it.obj.data) : '';
    if (it.kind === 'conta')    return Fmt.dateInput(it.obj.data_vencimento);
    return Fmt.dateInput(it.obj.data_inicio); // os
  }
  function _htmlOf(it) {
    if (it.kind === 'lembrete') return lembreteHTML(it.obj);
    if (it.kind === 'conta')    return contaHTML(it.obj);
    return osHTML(it.obj);
  }

  // Contagem p/ o atalho da Home (atrasados + hoje, só o que exige ação).
  function pendentesHojeAtrasados() {
    const hoje = DateUtil.today();
    let n = 0;
    (_compromissos || []).forEach(c => { if (c.status !== 'cancelado' && c.status !== 'feito' && c.data && Fmt.dateInput(c.data) <= hoje) n++; });
    (_parcelas || []).forEach(p => { if (p.status !== 'pago' && p.status !== 'cancelado' && !origemForaResultado(p.origem) && Fmt.dateInput(p.data_vencimento) <= hoje) n++; });
    return n;
  }

  function fillPage() {
    const el = qs('#page-agenda');
    if (!el) return;
    const hoje = DateUtil.today();
    const itens = [];
    (_compromissos || []).filter(c => c.status !== 'cancelado').forEach(c => itens.push({ kind: 'lembrete', obj: c }));
    (_parcelas || []).filter(p => p.status !== 'pago' && p.status !== 'cancelado' && !origemForaResultado(p.origem)).forEach(p => itens.push({ kind: 'conta', obj: p }));
    (_os || []).filter(o => o.status === 'andamento' && o.data_inicio).forEach(o => itens.push({ kind: 'os', obj: o }));

    const g = { atrasado: [], hoje: [], breve: [], semData: [], feito: [] };
    itens.forEach(it => {
      if (it.kind === 'lembrete' && it.obj.status === 'feito') { g.feito.push(it); return; }
      const d = _dateOf(it);
      if (!d) g.semData.push(it);
      else if (d < hoje) g.atrasado.push(it);
      else if (d === hoje) g.hoje.push(it);
      else g.breve.push(it);
    });
    const ordena = arr => arr.sort((a, b) => (_dateOf(a) || '9999').localeCompare(_dateOf(b) || '9999'));
    ['atrasado', 'hoje', 'breve'].forEach(k => ordena(g[k]));

    const secao = (titulo, arr, cls = '') => arr.length
      ? `<div class="afazer-group-head ${cls}">${titulo} <span>${arr.length}</span></div>${arr.map(_htmlOf).join('')}`
      : '';

    el.innerHTML = `
      <div class="page-header">
        <h1>✓ A fazer</h1>
        <button class="btn btn-primary" onclick="Agenda.openForm()">＋ Novo</button>
      </div>
      ${itens.length === 0 ? '<div class="ag-empty">Nada por aqui. Toque em <strong>＋ Novo</strong> pra anotar um lembrete.</div>' : ''}
      ${secao('⚠ Atrasados', g.atrasado, 'is-atrasado')}
      ${secao('Hoje', g.hoje)}
      ${secao('Em breve', g.breve)}
      ${secao('Sem prazo', g.semData)}
      ${secao('Concluídos', g.feito, 'is-feito')}`;
  }

  // Marca/desmarca um lembrete como feito (otimista + persiste).
  async function toggleFeito(id) {
    const c = (_compromissos || []).find(x => x.id === id);
    if (!c) return;
    const novo = c.status === 'feito' ? 'pendente' : 'feito';
    c.status = novo;
    if (typeof tapFeedback === 'function') tapFeedback();
    rerender();
    await API.db.update('compromissos', id, { status: novo });
  }

  async function render() {
    if (!LocalConfig.getUrl()) {
      const el = qs('#page-agenda');
      if (el) el.innerHTML = '<div class="page-header"><h1>✓ A fazer</h1></div><p class="text-muted p-3">Configure a conexão em Configurações</p>';
      return;
    }
    await loadData(true);
    fillPage();
  }

  // Re-renderiza o que estiver na tela (home e/ou página).
  function rerender() {
    if (qs('#home-agenda')) fillHome();
    const pg = qs('#page-agenda');
    if (pg && !pg.classList.contains('hidden')) fillPage();
  }
  async function refresh() { await loadData(true); rerender(); }

  // ─── navegação da grade ───────────────────────────────────
  function selectDay(idx) { _diaSelIdx = idx; rerender(); }
  function homeWeek(delta) { _semanaOffset += delta; rerender(); }

  // ─── abrir itens derivados (read-only) ────────────────────
  async function abrirParcela(id) {
    history.replaceState(null, '', '#financeiro');
    await App.navigate('financeiro');
    if (typeof Financeiro !== 'undefined') Financeiro.editarParcela(id);
  }
  async function abrirOS(id) {
    history.replaceState(null, '', '#os');
    await App.navigate('os');
    if (typeof OS !== 'undefined') OS.openDetail(id);
  }

  // ─── ações do compromisso ─────────────────────────────────
  function tapItem(id) {
    const c = _compromissos.find(x => x.id === id);
    if (!c) return;
    const feito = c.status === 'feito';
    ActionSheet.open(c.titulo || (TIPOS[c.tipo] || TIPOS.compromisso).label, [
      { label: 'Editar',               icon: '✏️', fn: () => openForm(null, id) },
      { label: 'Mover para outro dia', icon: '📅', fn: () => moverPrompt(id) },
      { label: feito ? 'Reabrir' : 'Marcar como feito', icon: feito ? '↩️' : '✅', fn: () => concluir(id) },
      { label: 'Excluir', icon: '🗑', danger: true, fn: () => excluir(id) },
    ]);
  }

  function moverPrompt(id) {
    const base = DateUtil.today();
    const opts = [];
    for (let i = 0; i < 14; i++) {
      const d = DateUtil.addDays(base, i);
      opts.push({ label: `${cap(Fmt.dataRelativa(d))} · ${curta(d)}`, icon: '📅', fn: () => mover(id, d) });
    }
    ActionSheet.open('Mover para...', opts);
  }

  async function mover(id, data) {
    const res = await API.db.update('compromissos', id, { data, data_atualizacao: new Date().toISOString() });
    if (res?.success) { Toast.success('Movido para ' + Fmt.dataRelativa(data)); await refresh(); }
    else Toast.error('Não foi possível mover');
  }

  async function concluir(id) {
    const c = _compromissos.find(x => x.id === id);
    if (!c) return;
    const novo = c.status === 'feito' ? 'agendado' : 'feito';
    const res = await API.db.update('compromissos', id, { status: novo, data_atualizacao: new Date().toISOString() });
    if (res?.success) { Toast.success(novo === 'feito' ? 'Marcado como feito' : 'Reaberto'); await refresh(); }
    else Toast.error('Não foi possível atualizar');
  }

  function excluir(id) {
    Modal.confirm('Excluir este compromisso?', async () => {
      const res = await API.db.delete('compromissos', id);
      if (res?.success) { Toast.success('Excluído'); await refresh(); }
      else Toast.error('Não foi possível excluir');
    });
  }

  // ─── formulário (novo/editar) ─────────────────────────────
  function openForm(diaPadrao = '', editId = null) {
    const c = editId ? _compromissos.find(x => x.id === editId) : null;
    qs('#modal-compromisso-title').textContent = c ? 'Editar compromisso' : 'Novo compromisso';
    qs('#comp-id').value    = c?.id || '';
    qs('#comp-data').value  = Fmt.dateInput(c?.data) || diaPadrao || diaSel();
    qs('#comp-tipo').value  = c?.tipo || 'visita';
    qs('#comp-titulo').value = c?.titulo || '';
    qs('#comp-hora-ini').value = Fmt.timeInput(c?.hora_inicio) || '';
    qs('#comp-hora-fim').value = Fmt.timeInput(c?.hora_fim) || '';
    qs('#comp-cliente').innerHTML = App.clienteOptions('cliente', c?.cliente_id || '');
    qs('#comp-os').innerHTML = osOptions(c?.os_id || '');
    qs('#comp-obs').value = c?.observacoes || '';
    Modal.open('modal-compromisso');
  }

  function saveForm() { return Guard.run('agenda-save', _saveForm); }
  async function _saveForm() {
    const id   = qs('#comp-id').value;
    const data = qs('#comp-data').value;
    const titulo = qs('#comp-titulo').value.trim();
    const cliente_id = qs('#comp-cliente').value;
    if (!data) { Toast.warning('Escolha a data'); return; }
    if (!titulo && !cliente_id) { Toast.warning('Dê um título ou escolha um cliente'); return; }

    const hi = qs('#comp-hora-ini').value;
    const hf = qs('#comp-hora-fim').value;
    const payload = {
      data,
      hora_inicio: hi ? '@' + hi : '',
      hora_fim:    hf ? '@' + hf : '',
      tipo:   qs('#comp-tipo').value || 'visita',
      titulo,
      cliente_id,
      os_id:  qs('#comp-os').value,
      observacoes: qs('#comp-obs').value.trim(),
      data_atualizacao: new Date().toISOString(),
    };

    let res;
    if (id) {
      res = await API.db.update('compromissos', id, payload);
    } else {
      payload.status = 'agendado';
      payload.data_criacao = new Date().toISOString();
      res = await API.db.create('compromissos', payload);
    }
    if (res?.success) {
      Modal.close('modal-compromisso');
      Toast.success(id ? 'Compromisso atualizado' : (res.queued ? 'Salvo (será sincronizado)' : 'Compromisso agendado'));
      // seleciona o dia do compromisso salvo (se estiver na semana visível)
      const idx = weekDates().indexOf(Fmt.dateInput(data));
      if (idx >= 0) _diaSelIdx = idx;
      await refresh();
    } else {
      Toast.error('Não foi possível salvar');
    }
  }

  return {
    render, renderHomeSection, selectDay, homeWeek,
    openForm, saveForm, tapItem, moverPrompt, mover, concluir, excluir,
    abrirParcela, abrirOS, toggleFeito, pendentesHojeAtrasados,
  };
})();
