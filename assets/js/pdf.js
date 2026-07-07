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
    if (!os) { Toast.error('Registro não encontrado'); return; }
    const cliente  = (cliRes?.data || []).find(c => c.id === os.cliente_id) || {};
    const diarias  = (diaRes?.data || []).filter(d => d.os_id === osId);
    const itens    = (itRes?.data  || []).filter(i => i.os_id === osId);
    const emp      = _empresa(cfg);

    const isOrc      = modo === 'orcamento';
    const totalItens = itens.reduce((s, i) => s + Number(i.valor_total || 0), 0);
    const maoObra    = diarias.reduce((s, d) => s + Number(d.valor_manual || d.valor_calculado || 0), 0);
    const totalHoras = diarias.reduce((s, d) => s + Number(d.horas_totais || 0), 0);
    // Orçamento: valor = soma dos itens; OS: valor calculado ou (mão de obra + itens).
    const total      = isOrc ? (maoObra + totalItens) : (Number(os.valor_calculado || 0) || (maoObra + totalItens));
    const prazoDias  = Number(os.prazo_dias || 0);

    const linhas    = _linhasExecucao(diarias);
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

        <!-- Dias trabalhados (só na OS executada; orçamento não tem sessões) -->
        ${linhas.length > 0 ? `
        <section class="doc-bloco">
          <div class="doc-bloco-titulo">Dias trabalhados</div>
          <table class="doc-table">
            <thead><tr><th>Data</th><th class="r">Horas</th></tr></thead>
            <tbody>
              ${linhas.map(l => `
                <tr><td>${l.data}</td><td class="r">${Fmt.hours(l.horas)}</td></tr>`).join('')}
              <tr class="doc-tr-total"><td>Total trabalhado</td><td class="r">${Fmt.hours(totalHoras)}</td></tr>
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
          ${maoObra > 0 ? `<div class="doc-row"><span>Mão de obra${!isOrc && totalHoras > 0 ? ` (${Fmt.hours(totalHoras)})` : ''}</span><span>${Fmt.currency(maoObra)}</span></div>` : ''}
          ${totalItens > 0 ? `<div class="doc-row"><span>${isOrc ? 'Itens e serviços' : 'Materiais e itens'}</span><span>${Fmt.currency(totalItens)}</span></div>` : ''}
          <div class="doc-row doc-total"><span>${isOrc ? 'Total estimado' : 'Total'}</span><span>${Fmt.currency(total)}</span></div>
        </section>

        ${isOrc ? `<p class="doc-validade">${prazoDias > 0 ? `Prazo estimado: ${prazoDias} dia(s). ` : ''}Sujeito a confirmação após avaliação no local.</p>` : ''}

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
    const logo = 'assets/img/logo-app.png?v=2.7.2';
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
          <div class="doc-row"><span>Recebimentos</span><span>${Fmt.currency(d.totalReceitas || 0)}</span></div>
          <div class="doc-row"><span>Pagamentos</span><span>${Fmt.currency(d.totalDespesas || 0)}</span></div>
          <div class="doc-row doc-total"><span>Saldo do período</span><span style="color:${corResult}">${Fmt.currency(resultado)}</span></div>
        </section>

        ${secao('Recebimentos', d.receitasList || [], d.totalReceitas || 0)}
        ${secao('Pagamentos', d.despesasList || [], d.totalDespesas || 0)}

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

  // Gera o PDF (Blob) a partir do HTML do documento — funciona em PC e celular.
  async function _gerarBlob() {
    const src = qs('#doc-scroll .doc-page');
    if (!src || typeof html2pdf === 'undefined') throw new Error('PDF indisponível');
    // Renderiza a partir de um CLONE fora do #doc-scroll, com largura fixa.
    // No celular o html2canvas cortava o documento (capturava só a 1ª "tela")
    // porque a .doc-page fica dentro de um container com altura fixa + overflow.
    // Clonar num container solto captura o documento INTEIRO e ainda deixa o
    // PDF com layout consistente, sem depender da largura do aparelho.
    const holder = document.createElement('div');
    // absolute em (0,0) atrás do overlay (z abaixo do #doc-overlay). Offset
    // negativo (left:-10000) QUEBRAVA a captura do html2canvas — por isso fica
    // em 0,0, invisível por trás do documento aberto.
    holder.style.cssText = 'position:absolute;left:0;top:0;width:760px;background:#fff;z-index:1;';
    const clone = src.cloneNode(true);
    clone.style.maxWidth = 'none';
    clone.style.width = '100%';
    holder.appendChild(clone);
    document.body.appendChild(holder);
    const opt = {
      margin:      [10, 10, 12, 10],
      filename:    _nomeArquivo + '.pdf',
      image:       { type: 'jpeg', quality: 0.98 },
      // windowWidth 760 → as media queries mobile (<=560px) NÃO se aplicam ao
      // clone (PDF sempre no layout completo). scrollX/Y:0 evita a captura sair
      // deslocada/cortada no celular.
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: 760, scrollX: 0, scrollY: 0 },
      jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' },
      // Pagina entre linhas (sem cortar uma linha no meio) e cria as folhas
      // seguintes sozinho — documentos longos não são mais truncados.
      pagebreak:   { mode: ['css', 'legacy'], avoid: 'tr' },
    };
    try {
      return await html2pdf().set(opt).from(clone).outputPdf('blob');
    } finally {
      holder.remove();
    }
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

  // ─── Helpers compartilhados dos documentos do cliente ───────
  function _docHead(emp, tipo, num) {
    const hoje = new Date().toLocaleDateString('pt-BR');
    const logo = 'assets/img/logo-app.png?v=3.5.6';
    return `
      <header class="doc-head">
        <img src="${logo}" class="doc-logo" alt="" onerror="this.style.display='none'">
        <div class="doc-emp">
          <div class="doc-emp-nome">${emp.nome}</div>
          <div class="doc-emp-sub">${emp.sub}</div>
          <div class="doc-emp-contato">${[emp.doc, emp.telefone, emp.cidade].filter(Boolean).join(' · ')}</div>
        </div>
        <div class="doc-meta">
          <div class="doc-tipo">${tipo}</div>
          ${num ? `<div class="doc-num">${num}</div>` : ''}
          <div class="doc-data">${hoje}</div>
        </div>
      </header>`;
  }

  function _clienteBloco(cliente) {
    return `
      <section class="doc-bloco">
        <div class="doc-bloco-titulo">Cliente</div>
        <div class="doc-cli-nome">${cliente?.nome || '—'}</div>
        <div class="doc-cli-info">${[cliente?.endereco, cliente?.telefone].filter(Boolean).join(' · ') || ''}</div>
      </section>`;
  }

  function _docFoot(emp) {
    return `
      <footer class="doc-foot">
        <div class="doc-foot-slogan">${emp.slogan}</div>
        <div>${emp.nome}${emp.telefone ? ' · ' + emp.telefone : ''}</div>
      </footer>`;
  }

  // ─── Resumo de várias OS (compacto, 1 linha por OS) ─────────
  // linhas: [{ numero, nome, horas, maoObra, materiais, total, recebida }]
  async function resumoOS(cliente, linhas, opts = {}) {
    const cfg = await Calculator.getConfig();
    const emp = _empresa(cfg);
    const desconto      = Number(opts.desconto || 0);
    const totalGeral    = linhas.reduce((s, l) => s + Number(l.total || 0), 0);
    const totalRecebido = linhas.filter(l => l.recebida).reduce((s, l) => s + Number(l.total || 0), 0);
    const totalFinal    = Math.max(0, totalGeral - desconto);
    const totalAReceber = Math.max(0, totalFinal - totalRecebido);

    const html = `
      <div class="doc-page">
        ${_docHead(emp, 'RESUMO DE SERVIÇOS', '')}
        ${_clienteBloco(cliente)}
        <section class="doc-bloco">
          <div class="doc-bloco-titulo">Ordens de serviço</div>
          ${linhas.map(l => `
            <div style="display:flex;justify-content:space-between;gap:10px;padding:9px 2px;border-bottom:1px solid #eef2f9">
              <div style="min-width:0">
                <div style="font-weight:700">${l.numero}${l.nome ? ` · ${l.nome}` : ''}
                  <span style="font-size:.7rem;font-weight:700;color:${l.recebida ? '#1a7f37' : '#b45309'};white-space:nowrap">• ${l.recebida ? 'Recebida' : 'A receber'}</span>
                </div>
                <div style="font-size:.76rem;color:#6b7a92;margin-top:2px">${l.horas ? Fmt.hours(l.horas) + ' · ' : ''}Mão de obra ${Fmt.currency(l.maoObra || 0)}${l.materiais > 0 ? ` · Materiais ${Fmt.currency(l.materiais)}` : ''}</div>
              </div>
              <div style="font-weight:800;white-space:nowrap">${Fmt.currency(l.total || 0)}</div>
            </div>`).join('')}
        </section>
        <section class="doc-resumo">
          ${desconto > 0 ? `
            <div class="doc-row"><span>Subtotal (${linhas.length} OS)</span><span>${Fmt.currency(totalGeral)}</span></div>
            <div class="doc-row"><span>Desconto</span><span>− ${Fmt.currency(desconto)}</span></div>` : ''}
          <div class="doc-row doc-total"><span>Total${desconto > 0 ? '' : ` (${linhas.length} OS)`}</span><span>${Fmt.currency(totalFinal)}</span></div>
          ${totalRecebido > 0 ? `<div class="doc-row"><span>Já recebido</span><span style="color:#1a7f37">${Fmt.currency(totalRecebido)}</span></div>` : ''}
          <div class="doc-row"><span>A receber</span><span style="color:#b45309;font-weight:700">${Fmt.currency(totalAReceber)}</span></div>
        </section>
        ${_docFoot(emp)}
      </div>`;
    _abrir(html, `resumo ${cliente?.nome || ''}`.trim());
  }

  // ─── Recibo de pagamento (total recebido OU pagamento avulso) ─
  // d: { valor, referencia, pagamentos?: [{data, descricao, valor}] }
  async function recibo(cliente, d = {}) {
    const cfg = await Calculator.getConfig();
    const emp = _empresa(cfg);
    const valor = Number(d.valor || 0);
    const hojeStr = new Date().toLocaleDateString('pt-BR');

    const html = `
      <div class="doc-page">
        ${_docHead(emp, 'RECIBO', '')}
        <section class="doc-bloco" style="margin-top:14px">
          <p style="font-size:.95rem;line-height:1.7;margin:0">
            Recebemos de <strong>${cliente?.nome || '—'}</strong> a quantia de
            <strong>${Fmt.currency(valor)}</strong>${d.referencia ? `, referente a <strong>${d.referencia}</strong>` : ''}.
          </p>
        </section>
        ${(d.pagamentos && d.pagamentos.length) ? `
        <section class="doc-bloco">
          <div class="doc-bloco-titulo">Pagamentos incluídos</div>
          <table class="doc-table">
            <thead><tr><th>Data</th><th>Descrição</th><th class="r">Valor</th></tr></thead>
            <tbody>
              ${d.pagamentos.map(p => `<tr><td>${p.data ? Fmt.date(p.data) : '—'}</td><td>${p.descricao || '—'}</td><td class="r">${Fmt.currency(p.valor || 0)}</td></tr>`).join('')}
              <tr class="doc-tr-total"><td colspan="2">Total</td><td class="r">${Fmt.currency(valor)}</td></tr>
            </tbody>
          </table>
        </section>` : ''}
        <p class="doc-cli-info" style="margin-top:18px">${emp.cidade ? emp.cidade + ', ' : ''}${hojeStr}.</p>
        <div style="margin-top:44px;text-align:center">
          <div style="border-top:1px solid #333;width:60%;margin:0 auto;padding-top:6px">${emp.nome}${emp.doc ? ' · ' + emp.doc : ''}</div>
        </div>
        ${_docFoot(emp)}
      </div>`;
    _abrir(html, `recibo ${cliente?.nome || ''}`.trim());
  }

  // ─── Extrato de valores em aberto (a receber pendente) ──────
  // d: { itens: [{descricao, vencimento, valor, atrasada}] }
  async function valoresEmAberto(cliente, d = {}) {
    const cfg = await Calculator.getConfig();
    const emp = _empresa(cfg);
    const itens = d.itens || [];
    const total = itens.reduce((s, i) => s + Number(i.valor || 0), 0);

    const html = `
      <div class="doc-page">
        ${_docHead(emp, 'VALORES EM ABERTO', '')}
        ${_clienteBloco(cliente)}
        <section class="doc-bloco">
          <div class="doc-bloco-titulo">Cobranças a receber</div>
          ${itens.length ? `
          <table class="doc-table">
            <thead><tr><th>Descrição</th><th class="r">Valor</th></tr></thead>
            <tbody>
              ${itens.map(i => `<tr>
                <td>${i.descricao || '—'}</td>
                <td class="r">${Fmt.currency(i.valor || 0)}</td>
              </tr>`).join('')}
              <tr class="doc-tr-total"><td>Total a receber (${itens.length})</td><td class="r">${Fmt.currency(total)}</td></tr>
            </tbody>
          </table>` : '<p class="doc-cli-info">Nenhum valor em aberto. 🎉</p>'}
        </section>
        ${_docFoot(emp)}
      </div>`;
    _abrir(html, `em aberto ${cliente?.nome || ''}`.trim());
  }

  return { gerar, relatorioFinanceiro, resumoOS, recibo, valoresEmAberto, baixar, compartilhar, fechar };
})();
