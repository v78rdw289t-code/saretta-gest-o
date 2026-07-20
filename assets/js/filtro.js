// ─── Filtro (componente compartilhado) ───────────────────────────
// Padrão único de filtro do sistema: linha de busca + botão "Filtros"
// (com contador) + painel em grade que expande inline + chips dos
// filtros ativos. Nasceu do padrão do Financeiro; aqui vira um
// componente CONFIGURÁVEL, com o MESMO visual e uso em qualquer módulo.
//
// É STATELESS: só renderiza e ajuda a ler o DOM. Cada módulo mantém seu
// próprio `_filtros`/`_filtroAberto` e implementa 5 métodos (por convenção,
// no objeto global cujo nome vai em `handler`):
//   <handler>.onFiltroChange()      → chama Filtro.coletar + re-render
//   <handler>.toggleFiltro()        → Filtro.togglePanel(ns) (abre/fecha)
//   <handler>.setFiltroChip(k, v)   → seta _filtros[k]=v + re-render
//   <handler>.limparFiltros()       → zera _filtros + re-render
//   <handler>.removeChip(k)         → limpa _filtros[k] + re-render
//
// Tipos de campo (vocabulário fixo do padrão):
//   { tipo:'select',  key, label, opcoes:[{v,label}], full:false }
//   { tipo:'chips',   key, label, opcoes:[{v,label}], full:true }   // segmented; "Todos" (v:'') entra automático
//   { tipo:'periodo', key:'periodo' }  // toggle Mês | Intervalo (reusa MonthPicker); usa estado.periodoTipo/mes/de/ate
const Filtro = (() => {

  function _esc(v) { return String(v == null ? '' : v).replace(/"/g, '&quot;'); }

  // Renderiza a linha de busca + botão + painel + chips.
  // cfg: { ns, handler, busca:{value,placeholder}, aberto, campos, estado, chips }
  function render(cfg) {
    const ns      = cfg.ns;
    const H       = cfg.handler;
    const estado  = cfg.estado || {};
    const aberto  = !!cfg.aberto;
    const campos  = cfg.campos || [];
    const busca   = cfg.busca || {};
    const nAtivos = contarAtivos(estado, campos);
    const chips   = cfg.chips || chipsPadrao(estado, campos);

    return `
      <div class="filter-search-row">
        <input type="search" id="${ns}-busca" class="input-search" placeholder="${_esc(busca.placeholder || 'Buscar...')}"
          value="${_esc(busca.value || '')}" oninput="${H}.onFiltroBusca(this.value)">
        <button class="btn-filter-toggle ${aberto ? 'active' : ''}" id="${ns}-filter-btn" onclick="${H}.toggleFiltro()">
          Filtros${nAtivos > 0 ? ` <span class="filter-badge">${nAtivos}</span>` : ''}
        </button>
      </div>
      <div id="${ns}-filter-panel" class="filter-panel" style="${aberto ? '' : 'display:none'}">
        ${campos.map(c => _campoHTML(ns, H, c, estado)).join('')}
        <div class="full-col" style="display:flex;justify-content:flex-end">
          <button class="btn btn-outline btn-sm" onclick="${H}.limparFiltros()">Limpar filtros</button>
        </div>
      </div>
      <div class="filter-active-chips">${chipsHTML(chips, H)}</div>`;
  }

  function _campoHTML(ns, H, c, estado) {
    if (c.tipo === 'periodo') return _periodoHTML(ns, H, estado);
    const full = c.full ? ' full-col' : '';
    if (c.tipo === 'chips') {
      const val = estado[c.key] || '';
      const opts = [{ v: '', label: 'Todos' }, ...(c.opcoes || [])];
      return `
        <div class="form-group${full}">
          <label>${c.label || c.key}</label>
          <div class="filter-chips">
            ${opts.map(o => `<button type="button" class="filter-chip-opt ${String(val) === String(o.v) ? 'active' : ''}"
              onclick="${H}.setFiltroChip('${c.key}','${_esc(o.v)}')">${o.label}</button>`).join('')}
          </div>
        </div>`;
    }
    // select (default)
    const val = estado[c.key] || '';
    return `
      <div class="form-group${full}">
        <label>${c.label || c.key}</label>
        <select id="${ns}-${c.key}" onchange="${H}.onFiltroChange()">
          <option value="">${c.todosLabel || 'Todos'}</option>
          ${(c.opcoes || []).map(o => `<option value="${_esc(o.v)}" ${String(val) === String(o.v) ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
      </div>`;
  }

  function _periodoHTML(ns, H, estado) {
    const tipo = estado.periodoTipo === 'intervalo' ? 'intervalo' : 'mes';
    return `
      <div class="form-group ${tipo === 'intervalo' ? 'full-col' : ''}">
        <label>Período</label>
        <select id="${ns}-periodo-tipo" onchange="${H}.onFiltroChange()">
          <option value="mes"       ${tipo !== 'intervalo' ? 'selected' : ''}>Por mês</option>
          <option value="intervalo" ${tipo === 'intervalo' ? 'selected' : ''}>Intervalo de datas</option>
        </select>
      </div>
      ${tipo === 'intervalo' ? `
        <div class="form-group">
          <label>De</label>
          <input type="date" id="${ns}-de" value="${_esc(estado.de || '')}" onchange="${H}.onFiltroChange()">
        </div>
        <div class="form-group">
          <label>Até</label>
          <input type="date" id="${ns}-ate" value="${_esc(estado.ate || '')}" onchange="${H}.onFiltroChange()">
        </div>
      ` : `
        <div class="form-group">
          <label>Mês</label>
          ${MonthPicker.render(`${ns}-mes`, estado.mes, `${H}.onFiltroChange()`)}
        </div>
      `}`;
  }

  // Alterna o painel (abre/fecha) e o estado visual do botão. Devolve o novo estado.
  function togglePanel(ns) {
    const panel = document.getElementById(`${ns}-filter-panel`);
    const btn   = document.getElementById(`${ns}-filter-btn`);
    const aberto = panel ? panel.style.display === 'none' : true;
    if (panel) panel.style.display = aberto ? '' : 'none';
    if (btn)   btn.classList.toggle('active', aberto);
    return aberto;
  }

  // Lê os inputs do DOM e devolve um objeto parcial com os valores.
  // Campos fora do DOM (ex.: mês quando está em intervalo) usam ?? p/ preservar.
  function coletar(ns, campos, estadoAtual = {}) {
    const out = {};
    const busca = document.getElementById(`${ns}-busca`);
    if (busca) out.busca = busca.value;
    campos.forEach(c => {
      if (c.tipo === 'periodo') {
        const tp = document.getElementById(`${ns}-periodo-tipo`);
        out.periodoTipo = tp ? tp.value : (estadoAtual.periodoTipo || 'mes');
        out.mes = MonthPicker.value(`${ns}-mes`) || estadoAtual.mes || '';
        out.de  = document.getElementById(`${ns}-de`)?.value  ?? estadoAtual.de  ?? '';
        out.ate = document.getElementById(`${ns}-ate`)?.value ?? estadoAtual.ate ?? '';
      } else if (c.tipo === 'chips') {
        // chips gravam direto via setFiltroChip; preserva o estado atual
        out[c.key] = estadoAtual[c.key] || '';
      } else {
        const el = document.getElementById(`${ns}-${c.key}`);
        out[c.key] = el ? el.value : (estadoAtual[c.key] || '');
      }
    });
    return out;
  }

  // Conta filtros ativos (p/ o badge): valores não-vazios das chaves dos campos
  // (menos 'busca'). Período conta quando está em 'intervalo' com datas.
  function contarAtivos(estado, campos) {
    let n = 0;
    campos.forEach(c => {
      if (c.tipo === 'periodo') {
        if (estado.periodoTipo === 'intervalo' && (estado.de || estado.ate)) n++;
      } else if (estado[c.key]) {
        n++;
      }
    });
    return n;
  }

  // Chips padrão a partir do estado + labels dos campos.
  function chipsPadrao(estado, campos) {
    const chips = [];
    campos.forEach(c => {
      if (c.tipo === 'periodo') {
        if (estado.periodoTipo === 'intervalo' && (estado.de || estado.ate)) {
          chips.push({ key: 'periodo', label: `${estado.de || '…'} → ${estado.ate || '…'}` });
        }
      } else if (estado[c.key]) {
        const op = (c.opcoes || []).find(o => String(o.v) === String(estado[c.key]));
        chips.push({ key: c.key, label: op ? op.label : estado[c.key] });
      }
    });
    return chips;
  }

  function chipsHTML(chips, H) {
    return (chips || []).map(p => `
      <span class="filter-chip">${p.label}
        <button type="button" onclick="${H}.removeChip('${p.key}')" aria-label="Remover filtro">×</button>
      </span>`).join('');
  }

  return { render, togglePanel, coletar, contarAtivos, chipsPadrao, chipsHTML };
})();
