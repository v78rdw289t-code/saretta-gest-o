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

  // ─── Relatório financeiro (receitas / despesas de um período) ────
  // d: { periodoLabel, receitasList[], despesasList[], totalReceitas,
  //      totalDespesas, recebido, pago }
  async function relatorioFinanceiro(d) {
    const cfg  = await Calculator.getConfig();
    const emp  = _empresa(cfg);
    const hoje = new Date().toLocaleDateString('pt-BR');
    const logo = 'assets/img/logo-app.png?v=2.7.1';
    const resultado = (d.totalReceitas || 0) - (d.totalDespesas || 0);
    const corResult = resultado >= 0 ? '#1a7f37' : '#c81e1e';

    const catNome = (id) => { const n = App.categoriaNome(id); return (n && n !== '—') ? n : '—'; };
    const linhas = (arr) => arr.map(p => `
      <tr>
        <td>${Fmt.date(p.data_competencia)}</td>
        <td>${p.descricao || '—'}</td>
        <td>${p.categoriaNome || catNome(p.categoria_id)}</td>
        <td class="r">${p.status === 'pago' ? '✓' : '○'}</td>
        <td class="r">${Fmt.currency(p.valor || 0)}</td>
      </tr>`).join('');

    const secao = (titulo, arr, total) => `
      <section class="doc-bloco">
        <div class="doc-bloco-titulo">${titulo}</div>
        ${arr.length ? `
        <table class="doc-table">
          <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th class="r">Pg</th><th class="r">Valor</th></tr></thead>
          <tbody>
            ${linhas(arr)}
            <tr class="doc-tr-total"><td colspan="4">Total ${titulo.toLowerCase()} (${arr.length})</td><td class="r">${Fmt.currency(total)}</td></tr>
          </tbody>
        </table>` : '<p class="doc-cli-info">Nenhum lançamento no período.</p>'}
      </section>`;

    const html = `
      <div class="doc-page">
        <header class="doc-head">
          <img src="${logo}" class="doc-logo" alt="" onerror="this.style.display='none'">
          <div class="doc-emp">
            <div class="doc-emp-nome">${emp.nome}</div>
            <div class="doc-emp-sub">${emp.sub}</div>
            <div class="doc-emp-contato">${[emp.doc, emp.telefone, emp.cidade].filter(Boolean).join(' · ')}</div>
          </div>
          <div class="doc-meta">
            <div class="doc-tipo">RELATÓRIO FINANCEIRO</div>
            <div class="doc-num">${d.periodoLabel || ''}</div>
            <div class="doc-data">${hoje}</div>
          </div>
        </header>

        <section class="doc-resumo" style="margin-top:0;margin-bottom:14px">
          <div class="doc-row"><span>Receitas (competência)</span><span>${Fmt.currency(d.totalReceitas || 0)}</span></div>
          <div class="doc-row"><span>Despesas (competência)</span><span>${Fmt.currency(d.totalDespesas || 0)}</span></div>
          <div class="doc-row doc-total"><span>Resultado</span><span style="color:${corResult}">${Fmt.currency(resultado)}</span></div>
          <div class="doc-row" style="font-size:11px;color:#666"><span>Realizado no caixa — recebido / pago</span><span>${Fmt.currency(d.recebido || 0)} / ${Fmt.currency(d.pago || 0)}</span></div>
        </section>

        ${secao('Receitas', d.receitasList || [], d.totalReceitas || 0)}
        ${secao('Despesas', d.despesasList || [], d.totalDespesas || 0)}

        <footer class="doc-foot">
          <div class="doc-foot-slogan">${emp.slogan}</div>
          <div>${emp.nome}${emp.telefone ? ' · ' + emp.telefone : ''}</div>
        </footer>
      </div>
    `;
    _abrir(html, `relatorio financeiro ${d.periodoLabel || ''}`.trim());
  }

  let _nomeArquivo = 'documento';

  // Mostra o documento em overlay com ações (Baixar / Enviar / Fechar)
  function _abrir(html, nome) {
    _nomeArquivo = (nome || 'documento').replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
    let ov = qs('#doc-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'doc-overlay';
      document.body.appendChild(ov);
    }
    // Mostra "Enviar" só onde o aparelho suporta compartilhar arquivos (celular)
    const podeCompartilhar = !!(navigator.canShare && navigator.canShare({ files: [new File([''], 'x.pdf', { type: 'application/pdf' })] }));
    ov.innerHTML = `
      <div class="doc-bar">
        <button class="btn btn-outline btn-sm" onclick="Doc.fechar()">✕</button>
        <span class="doc-bar-title">Documento</span>
        <div style="display:flex;gap:6px">
          <button class="btn btn-outline btn-sm" onclick="Doc.baixar()">⬇ Baixar</button>
          ${podeCompartilhar ? `<button class="btn btn-primary btn-sm" onclick="Doc.compartilhar()">📤 Enviar</button>` : ''}
        </div>
      </div>
      <div id="doc-scroll">${html}</div>
    `;
    ov.classList.add('open');
    document.body.classList.add('doc-open');
  }

  // Gera o PDF (Blob) a partir do HTML do documento — funciona em PC e celular
  async function _gerarBlob() {
    const el = qs('#doc-scroll .doc-page');
    if (!el || typeof html2pdf === 'undefined') throw new Error('PDF indisponível');
    const opt = {
      margin:      [10, 10, 12, 10],
      filename:    _nomeArquivo + '.pdf',
      image:       { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak:   { mode: ['avoid-all', 'css', 'legacy'] }, // não corta linhas; cria folhas extras sozinho
    };
    return await html2pdf().set(opt).from(el).outputPdf('blob');
  }

  async function baixar() {
    try {
      Loading.show();
      const blob = await _gerarBlob();
      Loading.hide();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = _nomeArquivo + '.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { Loading.hide(); Toast.error('Não foi possível gerar o PDF'); }
  }

  async function compartilhar() {
    try {
      Loading.show();
      const blob = await _gerarBlob();
      const file = new File([blob], _nomeArquivo + '.pdf', { type: 'application/pdf' });
      Loading.hide();
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: _nomeArquivo });
      } else {
        baixar(); // fallback
      }
    } catch (e) {
      Loading.hide();
      if (e && e.name === 'AbortError') return; // usuário cancelou
      Toast.error('Não foi possível compartilhar o PDF');
    }
  }

  function fechar() {
    const ov = qs('#doc-overlay');
    if (ov) ov.classList.remove('open');
    document.body.classList.remove('doc-open');
  }

  return { gerar, relatorioFinanceiro, baixar, compartilhar, fechar };
})();
