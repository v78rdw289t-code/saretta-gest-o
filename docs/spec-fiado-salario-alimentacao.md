# Spec — Fiado + Salário + Alimentação (conta do sócio)

**Princípio:** tudo que a empresa deve/cobra de um sócio vive num lugar só — a **ficha**
(`fiado_mov`, que já existe). Salário, compras no cartão, alimentação em casa, empréstimos e
itens fixos recorrentes são apenas *tipos de movimento* dessa ficha. Uma vez por mês, o
**Fechamento do sócio** soma tudo + salário num pagamento só e zera a ficha. **Simétrico**:
Rodrigo e Odinie funcionam igual.

Nenhum "saldo paralelo". A aba de Alimentação é UI separada, mas contabiliza na ficha.

---

## 1. ENTIDADES

### 1.1 `socios` (NOVA sheet) — cadastro-mestre do sócio
| Campo | Tipo | Obs |
|---|---|---|
| id | texto (chave) | |
| pessoa | texto | minúsculo, casa com `fiado_mov.pessoa` (ex: 'rodrigo','odinie') |
| nome | texto | exibição |
| salario_base | número | valor fixo do salário/mês |
| ativo | booleano | |

Valor por dia da alimentação = 1 config global (`config.chave='alimentacao_valor_dia'`), não
por sócio.

### 1.2 `fiado_mov` (JÁ EXISTE) — a ficha. Só ADICIONA valores de `motivo`:
`motivo`: despesa_bolso | emprestimo | acerto | ajuste | **alimentacao** | **recorrente** | **salario**
- `alimentacao`: crédito gerado pela aba Alimentação (empresa_deve).
- `recorrente`: crédito gerado por um item fixo recorrente do sócio (empresa_deve).
- `salario`: entra só no fechamento (ver 1.5). Nenhuma coluna nova.

### 1.3 `alimentacao_mes` (NOVA sheet) — contagem de dias em casa por mês/sócio
| Campo | Tipo | Obs |
|---|---|---|
| id | texto (chave) | |
| ano_mes | texto | 'yyyy-MM' |
| pessoa | texto | sócio ANFITRIÃO (dono da casa) |
| dias | número | dias de refeição na casa dele no mês |
| valor_dia | número | snapshot do valor/dia no momento |
| fiado_mov_id | ref | o crédito gerado na ficha (p/ re-sincronizar ao editar) |

Regra: 1 linha por (ano_mes, pessoa). Restaurante NÃO entra aqui (despesa normal, à parte).
Ao salvar/editar os dias → cria/atualiza o `fiado_mov` (empresa_deve, motivo alimentacao,
valor = dias × valor_dia). Editar re-sincroniza o mesmo mov (não duplica).

### 1.4 `socio_recorrentes` (NOVA sheet) — itens fixos que repetem no cartão do sócio
| Campo | Tipo | Obs |
|---|---|---|
| id | texto (chave) | |
| pessoa | texto | de quem é o item |
| descricao | texto | ex: 'parcela furadeira' |
| valor | número | mesmo valor todo mês |
| dia | número | dia do mês (informativo) |
| ativo | booleano | |
| ultima_geracao | texto | 'yyyy-MM' do último mês gerado (idempotência) |

Todo mês, ao abrir/fechar, `gerarSocioRecorrentes` cria 1 `fiado_mov` (empresa_deve,
motivo recorrente) por item ativo ainda não gerado no mês. NÃO retroage antes do cadastro.
(Espelha o `gerarRecorrentes` das contas fixas, que já existe.)

### 1.5 `fecharMesSocio` (NOVA action) — o fechamento
Entrada: `{ pessoa, ano_mes, conta_id, data }`. Passos (sob LockService, idempotente):
1. Garante alimentação + recorrentes do mês gerados na ficha.
2. `saldo_ficha` = Σ(empresa_deve) − Σ(socio_deve) dos movs ATIVOS da pessoa.
3. `total = salario_base + saldo_ficha`.
4. Cria 1 `parcelas` (tipo pagar, origem **'salario'**, status pago, conta_id, valor=total,
   descrição "Fechamento <mês> — <sócio>"). É o pagamento único.
5. Zera a ficha: movs ativos da pessoa → status 'acertado' + 1 `fiado_mov` motivo acerto
   fechando o saldo (reusa a lógica do `acertarFiado`).
6. Idempotência: recusa fechar 2× o mesmo (pessoa, ano_mes) — marca o mês como fechado.

`origemForaResultado`: 'salario' NÃO é fora-do-resultado (é despesa real). Mas os movs de
ficha que já viraram parcela não podem contar 2×. Como hoje a ficha NÃO gera parcela por item
(só no acerto), o resultado conta o fechamento (salário+ficha) uma vez, no caixa. Validar no
teste que P&L não duplica.

---

## 2. TELAS (frontend)

### 2.1 Aba Alimentação (nova, dentro do Financeiro ou Config)
- Seletor de mês. Valor/dia editável (grava no config).
- Um card por sócio ativo: stepper de dias em casa + total (dias × valor/dia).
- Salvar → gera/atualiza o crédito na ficha de cada anfitrião. Toast de confirmação.

### 2.2 Fechar o mês do sócio (nova)
- Por sócio: mostra salário base + quebra da ficha (compras + alimentação + recorrentes −
  empréstimos) = total. Escolhe a conta. Botão "Fechar mês".
- Após fechar: some da lista de pendentes do mês; a ficha zera.
- Editável: permitir ajustar salário base na hora (atualiza `socios.salario_base`).

### 2.3 Config
- Cadastro de sócios (salário base) + valor/dia alimentação + itens fixos recorrentes por sócio.

---

## 3. REGRAS
1. Alimentação e recorrentes SEMPRE viram `fiado_mov` — nunca um saldo próprio.
2. Editar dias de alimentação re-sincroniza o mesmo mov (idempotente, não duplica).
3. Fechar o mês é idempotente por (pessoa, ano_mes).
4. Restaurante = despesa normal (categoria Alimentação), fora deste fluxo.
5. Simétrico: toda regra vale p/ Rodrigo e Odinie igual.

---

## 4. ORDEM DE IMPLEMENTAÇÃO
1. Backend: sheets `socios`, `alimentacao_mes`, `socio_recorrentes` + `SHEET_HEADERS` +
   `gerarSocioRecorrentes` + `fecharMesSocio` + config valor_dia. (exige initDB + republish)
2. Frontend: Config (sócios/valor-dia/recorrentes) → Aba Alimentação → Fechamento.
3. Testes (tests/run.js): geração idempotente, alimentação→ficha, fechamento não duplica P&L.
4. Bump de versão + deploy.

**Dependência:** o passo 1 (backend) precisa do dono (clasp + initDB). O frontend pode ser
codado e testado no mock em paralelo.
