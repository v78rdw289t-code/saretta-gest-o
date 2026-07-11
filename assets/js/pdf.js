// ============================================================
// DOC / PDF — Geração de documentos (OS e Orçamento)
// Estratégia: monta HTML do documento + CSS @media print.
// O usuário usa "Imprimir → Salvar/Compartilhar PDF" do próprio
// aparelho (funciona offline, texto real, compartilha no WhatsApp).
// ============================================================

const Doc = (() => {

  // Logo SEM query de versão: o service worker cacheia o caminho puro (SHELL),
  // então o documento sai com logo mesmo offline. (Antes apontava ?v= antigo,
  // que nunca estava no cache → offline o logo sumia.)
  const LOGO = 'assets/img/logo-app.png';

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

  // Cabeçalho e rodapé padrão de TODO documento (OS, orçamento, relatórios,
  // extratos, recibo) — visual único, um lugar só pra mexer.
  function _headHTML(emp, titulo, num) {
    const hoje = new Date().toLocaleDateString('pt-BR');
    return `
        <header class="doc-head">
          <img src="${LOGO}" class="doc-logo" alt="" onerror="this.style.display='none'">
          <div class="doc-emp">
            <div class="doc-emp-nome">${emp.nome}</div>
            <div class="doc-emp-sub">${emp.sub}</div>
            <div class="doc-emp-contato">${[emp.doc, emp.telefone, emp.cidade].filter(Boolean).join(' · ')}</div>
          </div>
          <div class="doc-meta">
            <div class="doc-tipo">${titulo}</div>
            <div class="doc-num">${num || ''}</div>
            <div class="doc-data">${hoje}</div>
          </div>
        </header>`;
  }

  function _footHTML(emp) {
    return `
        <footer class="doc-foot">
          <div class="doc-foot-slogan">${emp.slogan}</div>
          <div>${emp.nome}${emp.telefone ? ' · ' + emp.telefone : ''}</div>
        </footer>`;
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
    // OS fechada: o total do documento é o VALOR FECHADO (com desconto) — o que
    // o cliente paga de fato. Antes mostrava o calculado, sem o desconto.
    // OS com valor combinado (orçamento fechado): o bruto do documento é o
    // combinado + materiais à parte — as horas são só execução.
    const bruto      = maoObra + totalItens;
    const { combinado, inclusos } = Calculator.combinadoInfo(os);
    const brutoDoc   = combinado > 0 ? Math.round((combinado + (inclusos ? 0 : totalItens)) * 100) / 100 : bruto;
    const fechado    = os.status === 'fechado' && Number(os.valor_fechamento || 0) > 0;
    const desconto   = fechado ? Math.max(0, Math.round((brutoDoc - Number(os.valor_fechamento)) * 100) / 100) : 0;
    const total      = fechado ? Number(os.valor_fechamento)
                               : (combinado > 0 ? brutoDoc : (Number(os.valor_calculado || 0) || bruto));

    const linhas    = _linhasExecucao(diarias);
    const isOrc     = modo === 'orcamento';
    const titulo    = isOrc ? 'ORÇAMENTO' : 'ORDEM DE SERVIÇO';
    const catNome   = os.categoria_id ? App.categoriaNome(os.categoria_id) : '';

    const html = `
      <div class="doc-page">
        ${_headHTML(emp, titulo, os.numero || '')}

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
          ${combinado > 0
            ? `<div class="doc-row"><span>Valor combinado${inclusos ? ' (materiais inclusos)' : ''}</span><span>${Fmt.currency(combinado)}</span></div>` +
              (!inclusos && totalItens > 0 ? `<div class="doc-row"><span>Materiais e itens</span><span>${Fmt.currency(totalItens)}</span></div>` : '')
            : (maoObra > 0 ? `<div class="doc-row"><span>Mão de obra (${Fmt.hours(totalHoras)})</span><span>${Fmt.currency(maoObra)}</span></div>` : '') +
              (totalItens > 0 ? `<div class="doc-row"><span>Materiais e itens</span><span>${Fmt.currency(totalItens)}</span></div>` : '')}
          ${desconto >= 0.01 ? `<div class="doc-row"><span>Desconto</span><span>−${Fmt.currency(desconto)}</span></div>` : ''}
          <div class="doc-row doc-total"><span>${isOrc ? 'Total estimado' : 'Total'}</span><span>${Fmt.currency(total)}</span></div>
        </section>

        ${isOrc ? `<p class="doc-validade">Orçamento válido por 15 dias. Sujeito a confirmação após avaliação no local.</p>` : ''}

        ${_footHTML(emp)}
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
    const resultado = (d.totalReceitas || 0) - (d.totalDespesas || 0);
    const corResult = resultado >= 0 ? '#1a7f37' : '#c81e1e';

    const catNome = (id) => { const n = App.categoriaNome(id); return (n && n !== '—') ? n : '—'; };
    const linhas = (arr) => arr.map(p => `
      <tr>
        <td>${Fmt.date(p.data_pagamento)}</td>
        <td>${p.descricao || '—'}</td>
        <td>${p.categoriaNome || catNome(p.categoria_id)}</td>
        <td class="r">${Fmt.currency(p.valor || 0)}</td>
      </tr>`).join('');

    const secao = (titulo, arr, total) => `
      <section class="doc-bloco">
        <div class="doc-bloco-titulo">${titulo}</div>
        ${arr.length ? `
        <table class="doc-table">
          <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th class="r">Valor</th></tr></thead>
          <tbody>
            ${linhas(arr)}
            <tr class="doc-tr-total"><td colspan="3">Total ${titulo.toLowerCase()} (${arr.length})</td><td class="r">${Fmt.currency(total)}</td></tr>
          </tbody>
        </table>` : '<p class="doc-cli-info">Nenhum lançamento no período.</p>'}
      </section>`;

    const html = `
      <div class="doc-page">
        ${_headHTML(emp, 'RELATÓRIO FINANCEIRO', d.periodoLabel || '')}

        <section class="doc-resumo" style="margin-top:0;margin-bottom:14px">
          <div class="doc-row"><span>Recebimentos</span><span>${Fmt.currency(d.totalReceitas || 0)}</span></div>
          <div class="doc-row"><span>Pagamentos</span><span>${Fmt.currency(d.totalDespesas || 0)}</span></div>
          <div class="doc-row doc-total"><span>Saldo do período</span><span style="color:${corResult}">${Fmt.currency(resultado)}</span></div>
        </section>

        ${secao('Recebimentos', d.receitasList || [], d.totalReceitas || 0)}
        ${secao('Pagamentos', d.despesasList || [], d.totalDespesas || 0)}

        ${_footHTML(emp)}
      </div>
    `;
    _abrir(html, `relatorio financeiro ${d.periodoLabel || ''}`.trim());
  }

  // ─── Relatório de Estoque (aba Relatório em PDF) ─────────────
  // d: { catLabel, totalValor, itens[], catRows[[nome,valor]], baixos[],
  //      perdasLabel, perdaValor }
  async function relatorioEstoque(d) {
    const cfg = await Calculator.getConfig();
    const emp = _empresa(cfg);
    const linhaItem = (e) => {
      const qtd = Number(e.quantidade || 0);
      return `
        <tr>
          <td>${e.descricao || '—'}</td>
          <td class="r" style="${qtd < 0 ? 'color:#c81e1e;font-weight:700' : ''}">${qtd} ${e.unidade || 'un'}</td>
          <td class="r">${Fmt.currency(e.valor_unit || 0)}</td>
          <td class="r">${Fmt.currency(qtd * Number(e.valor_unit || 0))}</td>
        </tr>`;
    };
    const html = `
      <div class="doc-page">
        ${_headHTML(emp, 'RELATÓRIO DE ESTOQUE', d.catLabel || '')}

        <section class="doc-resumo" style="margin-top:0;margin-bottom:14px">
          <div class="doc-row"><span>Itens (${(d.itens || []).length})</span><span></span></div>
          <div class="doc-row"><span>${d.perdasLabel || 'Perdas'}</span><span style="color:#c81e1e">${Fmt.currency(d.perdaValor || 0)}</span></div>
          <div class="doc-row doc-total"><span>Valor em estoque</span><span>${Fmt.currency(d.totalValor || 0)}</span></div>
        </section>

        <section class="doc-bloco">
          <div class="doc-bloco-titulo">Itens</div>
          ${(d.itens || []).length ? `
          <table class="doc-table">
            <thead><tr><th>Item</th><th class="r">Qtd</th><th class="r">Custo médio</th><th class="r">Total</th></tr></thead>
            <tbody>${(d.itens || []).map(linhaItem).join('')}</tbody>
          </table>` : '<p class="doc-cli-info">Nenhum item.</p>'}
        </section>

        ${(d.catRows || []).length ? `
        <section class="doc-bloco">
          <div class="doc-bloco-titulo">Valor por categoria</div>
          <table class="doc-table">
            <tbody>
              ${d.catRows.map(([nome, v]) => `<tr><td>${nome}</td><td class="r">${Fmt.currency(v)}</td></tr>`).join('')}
            </tbody>
          </table>
        </section>` : ''}

        ${(d.baixos || []).length ? `
        <section class="doc-bloco">
          <div class="doc-bloco-titulo">Repor (abaixo do mínimo / negativo)</div>
          <table class="doc-table">
            <tbody>
              ${d.baixos.map(e => `<tr><td>${e.descricao}</td><td class="r">${Number(e.quantidade || 0)} / mín ${Number(e.estoque_minimo || 0)}</td></tr>`).join('')}
            </tbody>
          </table>
        </section>` : ''}

        ${_footHTML(emp)}
      </div>
    `;
    _abrir(html, `relatorio estoque ${d.catLabel || ''}`.trim());
  }

  // ─── Extrato da Ficha do sócio ───────────────────────────────
  // d: { pessoa, saldo (perspectiva empresa, + = empresa deve), saldoInicialAntigo,
  //      movs[{data, label, descricao, valor, empresaDeve, acertado}] }
  async function extratoFicha(d) {
    const cfg = await Calculator.getConfig();
    const emp = _empresa(cfg);
    const nome = (d.pessoa || '').charAt(0).toUpperCase() + (d.pessoa || '').slice(1);
    const zerado = Math.abs(d.saldo || 0) < 0.005;
    const saldoLabel = zerado ? 'Saldo zerado'
      : (d.saldo > 0 ? `A empresa deve a ${nome}` : `${nome} deve à empresa`);
    const html = `
      <div class="doc-page">
        ${_headHTML(emp, 'FICHA DO SÓCIO', nome)}

        <section class="doc-resumo" style="margin-top:0;margin-bottom:14px">
          ${d.saldoInicialAntigo > 0 ? `<div class="doc-row"><span>Fiado anterior (modelo antigo, pendente)</span><span>${Fmt.currency(d.saldoInicialAntigo)}</span></div>` : ''}
          <div class="doc-row doc-total"><span>${saldoLabel}</span><span style="color:${zerado ? '#334155' : (d.saldo > 0 ? '#c81e1e' : '#1a7f37')}">${Fmt.currency(Math.abs(d.saldo || 0))}</span></div>
        </section>

        <section class="doc-bloco">
          <div class="doc-bloco-titulo">Movimentações</div>
          ${(d.movs || []).length ? `
          <table class="doc-table">
            <thead><tr><th>Data</th><th>Movimento</th><th>Situação</th><th class="r">Valor</th></tr></thead>
            <tbody>
              ${d.movs.map(m => `
                <tr style="${m.acertado ? 'color:#94a3b8' : ''}">
                  <td>${Fmt.date(m.data)}</td>
                  <td>${m.label}${m.descricao ? ' — ' + m.descricao : ''}</td>
                  <td>${m.acertado ? 'já acertado' : 'ativo'}</td>
                  <td class="r">${m.empresaDeve ? '+' : '−'}${Fmt.currency(m.valor || 0)}</td>
                </tr>`).join('')}
            </tbody>
          </table>` : '<p class="doc-cli-info">Nenhuma movimentação.</p>'}
          <p class="doc-cli-info" style="margin-top:6px">+ = a empresa deve ao sócio · − = o sócio deve à empresa</p>
        </section>

        ${_footHTML(emp)}
      </div>
    `;
    _abrir(html, `ficha ${d.pessoa || ''}`.trim());
  }

  // ─── Extrato de conta (Carteira/Sicredi...) ──────────────────
  // d: { contaNome, saldoInicial, saldoAtual, linhas[{data, descricao, valor(±), saldoApos}] }
  // linhas do mais ANTIGO pro mais novo (extrato de papel clássico).
  async function extratoConta(d) {
    const cfg = await Calculator.getConfig();
    const emp = _empresa(cfg);
    const html = `
      <div class="doc-page">
        ${_headHTML(emp, 'EXTRATO DE CONTA', d.contaNome || '')}

        <section class="doc-resumo" style="margin-top:0;margin-bottom:14px">
          <div class="doc-row"><span>Saldo inicial</span><span>${Fmt.currency(d.saldoInicial || 0)}</span></div>
          <div class="doc-row doc-total"><span>Saldo atual</span><span style="color:${(d.saldoAtual || 0) >= 0 ? '#1a7f37' : '#c81e1e'}">${Fmt.currency(d.saldoAtual || 0)}</span></div>
        </section>

        <section class="doc-bloco">
          <div class="doc-bloco-titulo">Movimentações (${(d.linhas || []).length})</div>
          ${(d.linhas || []).length ? `
          <table class="doc-table">
            <thead><tr><th>Data</th><th>Descrição</th><th class="r">Valor</th><th class="r">Saldo</th></tr></thead>
            <tbody>
              ${d.linhas.map(l => `
                <tr>
                  <td>${Fmt.date(l.data)}</td>
                  <td>${l.descricao || '—'}</td>
                  <td class="r" style="color:${l.valor >= 0 ? '#1a7f37' : '#c81e1e'}">${l.valor >= 0 ? '+' : '−'}${Fmt.currency(Math.abs(l.valor || 0))}</td>
                  <td class="r">${Fmt.currency(l.saldoApos || 0)}</td>
                </tr>`).join('')}
            </tbody>
          </table>` : '<p class="doc-cli-info">Nenhuma movimentação paga nesta conta.</p>'}
        </section>

        ${_footHTML(emp)}
      </div>
    `;
    _abrir(html, `extrato ${d.contaNome || ''}`.trim());
  }

  // ─── Recibo de pagamento/recebimento de uma parcela paga ─────
  // d: { parcela, clienteNome, contaNome }
  async function recibo(d) {
    const cfg = await Calculator.getConfig();
    const emp = _empresa(cfg);
    const p = d.parcela || {};
    const receb = p.tipo === 'receber';
    const quem = d.clienteNome || '';
    const frase = receb
      ? `Recebemos${quem ? ` de <strong>${quem}</strong>` : ''} a importância de`
      : `Pagamos${quem ? ` a <strong>${quem}</strong>` : ''} a importância de`;
    const html = `
      <div class="doc-page">
        ${_headHTML(emp, 'RECIBO', receb ? 'Recebimento' : 'Pagamento')}

        <section class="doc-bloco" style="margin-top:8px">
          <p style="font-size:.95rem;line-height:1.7;margin:0">
            ${frase}
            <strong style="font-size:1.15rem">${Fmt.currency(p.valor || 0)}</strong>,
            referente a <strong>${p.descricao || '—'}</strong>${p.observacoes ? ` (${p.observacoes})` : ''}.
          </p>
        </section>

        <section class="doc-resumo" style="margin-top:14px">
          <div class="doc-row"><span>Data do ${receb ? 'recebimento' : 'pagamento'}</span><span>${Fmt.date(p.data_pagamento || p.data_vencimento)}</span></div>
          ${d.contaNome ? `<div class="doc-row"><span>Conta</span><span>${d.contaNome}</span></div>` : ''}
          <div class="doc-row doc-total"><span>Valor</span><span>${Fmt.currency(p.valor || 0)}</span></div>
        </section>

        <div style="margin-top:56px;text-align:center">
          <div style="border-top:1px solid #334155;width:60%;margin:0 auto 6px"></div>
          <div style="font-size:.85rem">${emp.nome}${emp.doc ? ' · ' + emp.doc : ''}</div>
        </div>

        ${_footHTML(emp)}
      </div>
    `;
    _abrir(html, `recibo ${(p.descricao || '').substring(0, 30)}`.trim());
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

  return { gerar, relatorioFinanceiro, relatorioEstoque, extratoFicha, extratoConta, recibo,
           baixar, compartilhar, fechar };
})();
