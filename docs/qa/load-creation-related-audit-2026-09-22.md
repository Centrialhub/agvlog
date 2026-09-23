# Problemas relacionados à criação de carga — 22/09/2026

**Atualização:** os quatro achados abaixo foram corrigidos e publicados em produção.
Consulte [correções e evidências](load-creation-related-fixes-2026-09-22.md).
O conteúdo abaixo registra o diagnóstico anterior à correção.

Revisão dos fluxos de agrupamento, Nova Carga, importação e comando agregado.
Consultas em produção somente para leitura nesta revisão. Nenhuma regra fiscal
ou dado operacional foi alterado. A correção anterior de `status` permanece aplicada.

## 1. P1 — Notas oferecidas para criação são recusadas pela regra fiscal

`PendingDocsGrouping.tsx:70` busca notas inbound, confirmed, sem carga e sem
deleted_at. Não lê os campos de emissão fiscal. Já `_change_load_documents`
rejeita documentos com `cte_emitted_at`, `cte_emitted_outbound_id` ou
`nfse_emitted_at`, com `replanning_requires_fiscal_review`.

Na consulta à produção, a empresa AGV tinha 79 notas nessa lista:

- 70 com referência a documento outbound com status authorized e marcação de CT-e;
- 6 com marcação de NFS-e;
- 3 sem essas marcações fiscais;
- 7 notas com cidade Salinas/Ninheira, todas com bloqueio fiscal.

Portanto, a remoção do erro `unsupported_load_fields:status` não libera essas 76
notas. Uma única nota bloqueada aborta a criação do grupo inteiro. A Nova Carga
também considera uma nota selecionável somente pela ausência de `load_id`
(`src/lib/loads/newLoadDocumentSelection.ts:7`).

Prioridade: reconciliar a elegibilidade de notas e o fluxo permitido para documentos
já emitidos, mostrando o motivo antes de confirmar a carga. A presença de 70 CT-es
autorizados foi confirmada; não se deve presumir que as marcações sejam lixo.
Esta revisão não determinou por que esses documentos ficaram sem carga.

## 2. P1 — Repetição de pedido não protege a composição completa da carga

Os RPCs `create_grouped_load_v1` e `create_load_with_documents_v1` repassam ao
comando idempotente somente `changes`. As listas de notas, os patches de nota
e os eventos de auditoria não fazem parte da identidade verificada desse pedido.
Após um replay do cabeçalho, os RPCs continuam executando o vínculo/patch.

Reproduções locais com os corpos SQL dos RPCs e o comando agregado real:

1. Agrupar nota A com veículo de capacidade 1 palete; reenviar o mesmo request_id
   com nota B de 1 palete. A resposta retorna replayed=true e a carga passa a ter
   2 paletes. A validação mede apenas a lista enviada naquela chamada.
2. Nova Carga com nota A; reenviar o mesmo request_id e cabeçalho com nota B.
   A mesma carga passa a conter A e B.
3. Nova Carga com invoice_number 111; repetir o pedido com patch para 222.
   A nota muda mesmo com replayed=true.

Na tela Nova Carga, o request_id é mantido até uma resposta de sucesso
(`NewLoadDialog.tsx:103,524,552`), tornando o caso relevante quando a resposta
se perde e o operador altera os campos/notas antes de tentar novamente.

Correção recomendada: identidade e resposta idempotentes para a operação inteira,
incluindo documentos, patches e auditoria; rejeitar conteúdo diferente para o
mesmo pedido e não repetir efeitos após sucesso.

## 3. P2 — Resposta perdida deixa a criação sem recuperação confiável

`PendingDocsGrouping.tsx:215` gera um request_id novo em cada tentativa, sem
persistir o pedido anterior. Se o banco salva e a resposta se perde, uma nova
tentativa com os mesmos documentos falha com `document_already_linked`.
O teste reproduziu uma carga existente e uma mensagem de falha na repetição;
não demonstrou duplicação de carga, pois o vínculo transacional impediu isso.
A atualização posterior da lista pode retirar as notas do agrupamento, mas a
tela não recupera a confirmação nem informa qual carga foi criada.

Correção recomendada: guardar o pedido completo por grupo, recuperar usando o
mesmo identificador e validar load_id/document_count na resposta.

## 4. P2 — Sugestões automáticas sobrescrevem escolhas manuais

Inspeção de `PendingDocsGrouping.tsx:137-177`: os efeitos substituem os mapas
inteiros de veículo e motorista. Um refetch que altere as notas/rotas pode
refazer todas as atribuições. Trocar o veículo de uma rota também refaz os
motoristas de todas as rotas, apagando escolhas manuais de outros grupos.

Correção recomendada: preservar escolhas explícitas e sugerir somente para grupos
novos ou campos ainda não preenchidos. Este item foi confirmado por inspeção de
código, sem teste de interação no navegador nesta revisão.

## Verificações e limites

- 40 testes passaram em quatro suítes: `loadCreationRelatedAudit`,
  `documentChangesDatabase`, `newLoadDocumentSelection`, `groupedLoadInitialStatus`.
- Os quatro testes de auditoria reproduzem defeitos atuais; passar não significa
  que esses defeitos foram corrigidos.
- O vinculador downstream usado na reprodução de replay é um fixture; os dois
  wrappers e o comando agregado executam SQL real. A regra fiscal também foi
  conferida na definição vigente em produção e na suíte de composição.
- ESLint da nova suíte passou.
- Os caminhos padrão `useCreateLoad` filtram os campos e não repassam `status`
  ao comando agregado. Não foi encontrado outro emissor desse mesmo erro.
- O RPC de limpeza `delete_load_safely` existe e authenticated tem EXECUTE em
  produção; a hipótese de falta dessa permissão foi descartada.

Prioridade operacional: tratar o item 1 primeiro, pois já afeta as notas da AGV;
em seguida, fechar a identidade do pedido completo e a recuperação de respostas.
