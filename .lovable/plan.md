## Objetivo
Em `/cte-hub` → aba **Faturamento**, trocar a aba "Por cliente / período" para "Por fornecedor / período", filtrando os documentos fiscais pelo **remetente** (campo `remitter` do `fiscal_documents`) em vez de pelo cliente cadastrado.

## Escopo
Somente `src/pages/Billing.tsx`. Nenhuma alteração de banco, hook, RPC ou outra aba do hub. A aba "Por cargas" mantém o seletor "Cliente (opcional)" como está.

## Alterações em `src/pages/Billing.tsx`

1. **Rótulo da aba** (linha 431): "Por cliente / período" → "Por fornecedor / período".

2. **Conteúdo da aba `period`** (linhas 435–456):
   - Remover o `<Select>` de clientes.
   - Substituir por um `<Input>` de texto "Fornecedor (remetente)" ligado ao estado `supplier` (que já alimenta `useBillingDocuments({ remitter })`).
   - Adicionar campo opcional "CNPJ do fornecedor" ligado a `supplierCnpj` (que já alimenta `remitterCnpj`), para busca precisa.
   - Manter os dois campos de data (`periodStart`, `periodEnd`).

3. **Efeitos colaterais controlados**:
   - Ao entrar na aba `period`, forçar `clientId = SENTINEL_NONE` (para não deixar um filtro de cliente "invisível" ativo herdado das preferências antigas).
   - `billableLoads` (linhas 361–363) e a criação do lote (linha 380) continuam usando `clientId`, mas como ele estará em `SENTINEL_NONE` na aba `period`, o comportamento fica correto (sem filtro por cliente e `client_id: null` no lote — que é o esperado quando faturamos por fornecedor).

4. **Preferências do usuário** (`BillingPreferences`): manter a chave `clientId` para não invalidar prefs salvas; apenas garantir que na aba `period` ela seja resetada. Não é preciso migrar dados persistidos.

## Fora de escopo
- Aba "Por cargas" (mantém "Cliente opcional").
- Abas Monitor e Consulta do `/cte-hub`.
- Estrutura da tabela `cte_batches` (o campo `client_id` continua sendo gravado como `null` quando não houver cliente selecionado, comportamento já existente).

## Validação
- `bun run build` e `tsgo` limpos.
- Verificação manual: aba mostra "Por fornecedor / período", digitar parte do nome do remetente filtra a lista de documentos elegíveis; limpar o campo volta a listar todos no período.
