// ============================================================
// DOC / PDF — Geração de documentos (OS e Orçamento)
// Estratégia: monta HTML do documento + CSS @media print.
// O usuário usa "Imprimir → Salvar/Compartilhar PDF" do próprio
// aparelho (funciona offline, texto real, compartilha no WhatsApp).
// ============================================================

const Doc = (() => {

  // Lê dados da empresa da config (com fallbacks). Campos extras
  // (telefone/doc/cidade/pix) aparecem só se preenchidos em Configurações.
  function _empresa(cfg) {
    return {
      nome:     cfg.empresa_nome     || 'Saretta Serviços',
      sub:      cfg.empresa_sub      || 'Gestão de Serviços',
      telefone: cfg.empresa_telefone || '',
      doc:      cfg.empresa_doc      || '',     // CNPJ/CPF
      cidade:   cfg.empresa_cidade   || '',
      slogan:   cfg.empresa_slogan   || 'Tudo funcionando!',
    };
  }

  // Linhas de execução: só data + total de horas do dia (sem horários nem valor por dia)
  function _linhasExecucao(diarias) {
    return diarias
      .sort((a, b) => (a.data > b.data ? 1 : -1))
      .map(d => ({ data: Fmt.date(d.data), horas: Number(d.horas_totais || 0) }));
  }

  // ─── Documento principal (OS ou Orçamento) ───────────────────
  // modo: 'os' (serviço realizado) | 'orcamento' (proposta)
  async function gerar(osId, modo = 'os') {
    Loading.show();
    const [osRes, cliRes, diaRes, itRes] = await Promise.all([
      API.db.read('os'),
      API.db.read('clientes'),
      API.db.read('diarias'),
      API.db.read('os_itens'),
    ]);
    const cfg = await Calculator.getConfig();
    Loading.hide();

    const os = (osRes?.data || []).find(o => o.id === osId);
    if (!os) { Toast.error('OS não encontrada'); return; }
    const cliente  = (cliRes?.data || []).find(c => c.id === os.cliente_id) || {};
    const diarias  = (diaRes?.data || []).filter(d => d.os_id === osId);
    const itens    = (itRes?.data  || []).filter(i => i.os_id === osId);
    const emp      = _empresa(cfg);

    const totalItens = itens.reduce((s, i) => s + Number(i.valor_total || 0), 0);
    const maoObra    = diarias.reduce((s, d) => s + Number(d.valor_manual || d.valor_calculado || 0), 0);
    const totalHoras = diarias.reduce((s, d) => s + Number(d.horas_totais || 0), 0);
    const total      = Number(os.valor_calculado || 0) || (maoObra + totalItens);

    const linhas    = _linhasExecucao(diarias);
    const isOrc     = modo === 'orcamento';
    const titulo    = isOrc ? 'ORÇAMENTO' : 'ORDEM DE SERVIÇO';
    const catNome   = os.categoria_id ? App.categoriaNome(os.categoria_id) : '';
    const hoje      = new Date().toLocaleDateString('pt-BR');

    const logo = 'assets/img/logo-app.png?v=2.0.3';

    const html = `
      <div class="doc-page">
        <!-- Cabeçalho -->
        <header class="doc-head">
          <img src="${logo}" class="doc-logo" alt=""
            onerror="this.style.display='none'">
          <div class="doc-emp">
            <div class="doc-emp-nome">${emp.nome}</div>
            <div class="doc-emp-sub">${emp.sub}</div>
            <div class="doc-emp-contato">
              ${[emp.doc, emp.telefone, emp.cidade].filter(Boolean).join(' · ')}
            </div>
          </div>
          <div class="doc-meta">
            <div class="doc-tipo">${titulo}</div>
            <div class="doc-num">${os.numero || ''}</div>
            <div class="doc-data">${hoje}</div>
          </div>
        </header>

        <!-- Cliente -->
        <section class="doc-bloco">
          <div class="doc-bloco-titulo">Cliente</div>
          <div class="doc-cli-nome">${cliente.nome || '—'}</div>
          <div class="doc-cli-info">
            ${[cliente.endereco, cliente.telefone].filter(Boolean).join(' · ') || ''}
          </div>
        </section>

        <!-- Serviço -->
        <section class="doc-bloco">
          <div class="doc-bloco-titulo">Serviço</div>
          <div class="doc-serv-nome">${os.nome || catNome || 'Serviço'}</div>
          ${catNome && os.nome ? `<div class="doc-cli-info">Categoria: ${catNome}</div>` : ''}
          ${os.observacoes ? `<div class="doc-obs">${os.observacoes}</div>` : ''}
        </section>

        <!-- Dias trabalhados (só data + horas) -->
        ${linhas.length > 0 ? `
        <section class="doc-bloco">
          <div class="doc-bloco-titulo">${isOrc ? 'Previsão de execução' : 'Dias trabalhados'}</div>
          <table class="doc-table">
            <thead>
              <tr><th>Data</th><th class="r">Horas</th></tr>
            </thead>
            <tbody>
              ${linhas.map(l => `
                <tr>
                  <td>${l.data}</td>
                  <td class="r">${Fmt.hours(l.horas)}</td>
                </tr>`).join('')}
              <tr class="doc-tr-total">
                <td>Total trabalhado</td>
                <td class="r">${Fmt.hours(totalHoras)}</td>
              </tr>
            </tbody>
          </table>
        </section>` : ''}

        <!-- Itens / materiais -->
        ${itens.length > 0 ? `
        <section class="doc-bloco">
          <div class="doc-bloco-titulo">Materiais e itens</div>
          <table class="doc-table">
            <thead><tr><th>Item</th><th class="r">Qtd</th><th class="r">Valor</th></tr></thead>
            <tbody>
              ${itens.map(i => `
                <tr>
                  <td>${i.descricao || i.nome || 'Item'}</td>
                  <td class="r">${i.quantidade || 1}</td>
                  <td class="r">${Fmt.currency(i.valor_total || 0)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </section>` : ''}

        <!-- Resumo de valores -->
        <section class="doc-resumo">
          ${maoObra > 0 ? `<div class="doc-row"><span>Mão de obra (${Fmt.hours(totalHoras)})</span><span>${Fmt.currency(maoObra)}</span></div>` : ''}
          ${totalItens > 0 ? `<div class="doc-row"><span>Materiais e itens</span><span>${Fmt.currency(totalItens)}</span></div>` : ''}
          <div class="doc-row doc-total"><span>${isOrc ? 'Total estimado' : 'Total'}</span><span>${Fmt.currency(total)}</span></div>
        </section>

        ${isOrc ? `<p class="doc-validade">Orçamento válido por 15 dias. Sujeito a confirmação após avaliação no local.</p>` : ''}

        <footer class="doc-foot">
          <div class="doc-foot-slogan">${emp.slogan}</div>
          <div>${emp.nome}${emp.telefone ? ' · ' + emp.telefone : ''}</div>
        </footer>
      </div>
    `;

    _abrir(html, `${titulo.toLowerCase()} ${os.numero || ''}`.trim());
  }

  // Mostra o documento em overlay com ações (Imprimir/PDF, Fechar)
  function _abrir(html, _titulo) {
    let ov = qs('#doc-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'doc-overlay';
      document.body.appendChild(ov);
    }
    ov.innerHTML = `
      <div class="doc-bar">
        <button class="btn btn-outline btn-sm" onclick="Doc.fechar()">✕ Fechar</button>
        <span class="doc-bar-title">Pré-visualização</span>
        <button class="btn btn-primary btn-sm" onclick="Doc.imprimir()">📄 Imprimir / PDF</button>
      </div>
      <div id="doc-scroll">${html}</div>
    `;
    ov.classList.add('open');
    document.body.classList.add('doc-open');
  }

  function imprimir() { window.print(); }

  function fechar() {
    const ov = qs('#doc-overlay');
    if (ov) ov.classList.remove('open');
    document.body.classList.remove('doc-open');
  }

  return { gerar, imprimir, fechar };
})();
