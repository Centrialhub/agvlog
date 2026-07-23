## Problema (o que verifiquei nos dados)

Auditei a tabela `TABELA J.MACEDO` (id `2743d048…`, `per_kg_value = 0.696`, todos os demais critérios `NULL`, `blocked = false`) e os últimos registros de `freight_calculation_log` + `fiscal_documents.freight_breakdown` para NFs do remetente `JMacêdo S/A`.

O que os dados mostram:

- Todas as NFs da J.Macêdo (ex.: NF 443666, valor R$ 8.800,16, peso 759,738 kg) armazenaram `freight_value = 528,0096`, calculado como `valor × 6%` usando **`TABELA TRANSVILA LASSANCE 6%`** (`rate_percent = 6`), com `fallbackUsed = true` e motivo *"Nenhuma tabela compatível — usando tabela genérica. Campos ausentes: payer_group"*.
- Isso ocorreu porque no momento do cálculo (ingestão) as tabelas TRANSVILA ainda estavam ativas e a tabela J.MACEDO tem `payer_group NULL`. O motor `computeSpecificity` compara `table.payer_group` (não-nulo nas TRANSVILA) contra `input.payerGroup = null` e aplica `-100` (desqualifica), mas quando **nenhuma tabela qualifica** o fallback escolhe a "menos específica" via `specificity_score`, que na prática está indefinido/0 para várias linhas — resultado não-determinístico e claramente incorreto.
- Hoje as TRANSVILA estão `blocked = true`. Somente J.MACEDO fica visível ao motor. **Porém os documentos existentes continuam com `freight_value`, `freight_breakdown` e `value` congelados do cálculo antigo** — daí a impressão de que "per_kg × preço da nota" não bate: o número gravado veio de `valor × 6%`, não de `peso × 0,696`.
- Bônus: o simulador/inbound grava `freight_breakdown` no próprio NF-e (ingestão faz preview), o que confunde o operador ao comparar com o CT-e depois.

Ou seja: **o vínculo tabela → CT-e está funcional, mas (a) o motor de fallback pode escolher tabela errada quando o único critério faltante é `payer_group`, e (b) valores antigos ficaram persistidos após o bloqueio das TRANSVILA e o cadastro da J.MACEDO.**

## Correções propostas (escopo curto e cirúrgico)

### 1. Motor de matching — `src/hooks/useFreightCalculator.tsx`
- Tratar `payer_group` como critério **suave**: quando `table.payer_group` está definido e `input.payerGroup` está vazio, não desqualificar (`-100`); apenas não pontuar. Idem para `payer`. Mantém desqualificação apenas em mismatch real (ambos preenchidos e diferentes).
- Corrigir a checagem sem sentido `check('payer', table.payer, input.clientId ? 'client' : null)` — comparar contra o `payer` do cliente/tabela real, não contra a string literal `"client"`. Preferimos remover essa linha (o payer já é coberto por `payer_group`/`client_id`).
- No branch de fallback (nenhuma tabela qualificada), ordenar por `score DESC` (menos negativo primeiro) em vez de `specificity_score ASC` indefinido, para tornar a escolha determinística.
- Anexar mais contexto em `fallbackReason` (qual tabela venceu e por quê).

### 2. Recalcular documentos afetados (dados existentes)
- Rodar um recálculo em lote (via `insert` tool, `UPDATE … SELECT public.recalc…` ou script pontual) sobre:
  - todos os CT-es (`fiscal_documents.document_type='outbound'`, `freight_overridden = false`) do tenant `6e874e6e…`;
  - opcionalmente as NF-e inbound cujo `freight_table_id` aponta para uma tabela hoje `blocked = true`, apenas para limpar o `freight_breakdown` de preview.
- O recálculo usa o hook `useRecalculateCTeFreight` (já existente) — precisamos apenas invocá-lo em massa a partir de uma RPC utilitária ou de um botão no `/freight` ("Recalcular CT-es com tabela obsoleta").

### 3. Diagnóstico visível no `FreightBreakdownPanel`
- Quando `fallbackUsed = true` **ou** a tabela escolhida tem `payer_group NULL` e o cliente tem `payer_group` definido (ou vice-versa), mostrar um alerta em destaque no painel de auditoria/CTe: *"Tabela genérica aplicada — verifique se o cliente possui `payer_group` compatível."*
- Já temos `FreightAuditDrawer`; apenas subir a severidade visual quando `fallbackUsed`.

### 4. Higienização de dados sensíveis (fora do preview)
- **Não** sobrescrever mais `value` nem gravar `freight_breakdown` no NF-e **inbound** durante ingestão — mover o preview de frete para um campo `freight_preview` (JSONB) ou apenas exibir em memória. Isso evita a confusão "NF mostra frete de 528 mas per_kg = 0,696".
- Mudança conservadora: manter comportamento atual para outbound; para inbound, apenas parar de escrever em `value` (linha 251) — que hoje corrompe o valor fiscal da NF sempre que o auto-recalc dispara. (Já protegido por `document_type === 'outbound'` no `useUpdateFiscalDocument`, mas o `Ingestion.tsx` faz gravações inbound com `freight_breakdown`; confirmar e limitar.)

### 5. Teste de regressão
- Novo caso em `src/test/`: dado uma tabela com todos critérios `NULL` exceto `per_kg_value`, e input sem `payer_group`, o motor deve escolher essa tabela (score = 0) em vez de cair no fallback.
- Caso adicional: com duas tabelas (uma com `payer_group="X"`, outra all-null) e input sem `payer_group`, escolher a all-null e não desqualificar por payer_group faltante.

## Fora do escopo
- Não vou redesenhar o esquema de `freight_tables` nem adicionar novos campos.
- Não vou tocar em regras de IBS/CBS, override manual, ou EDI.
- Não vou recadastrar clientes/fornecedores.

## Verificação final
- `bun run test` — os 200+ testes existentes + os 2 novos casos.
- Query manual: `SELECT invoice_number, weight_kg, freight_value FROM fiscal_documents WHERE freight_table_id = '2743d048…'` deve mostrar `freight_value ≈ weight_kg × 0.696` após o recálculo em massa.
- Abrir um CT-e da J.Macêdo em `/cte-hub` e conferir o `FreightBreakdownPanel`: `perKgValue = 0.696`, `perKgTotal = peso × 0.696`, `ratePercent = 0`, sem `fallbackUsed`.