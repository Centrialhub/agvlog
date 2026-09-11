# Vínculo de pagamentos existentes de acerto — 10/09/2026

Implementação local candidata. Nenhuma migration foi aplicada remotamente.

## Entrega

- `SettlementMovementLink.tsx` abre a consulta e o vínculo a partir de cada pagamento do `DriverSettlementDrawer`. Não altera o registro antigo de novos pagamentos.
- `settlementMovementContract.ts` e `settlementMovementClient.ts` validam pedido/resposta e escopo. O cliente não fornece o valor: o comando existente deriva o valor integral do pagamento.
- Migration `20260910130921_finance_settlement_movement_options.sql`: consulta privada com wrapper público invoker, autorização `finance_private.can_access`, página de 20 saídas, total exato e autoria/motivo/data do vínculo. Filtra mesmo motorista e data efetiva em São Paulo, direção de saída, natureza diferente de transferência e capacidade compartilhada suficiente. Motorista ausente e pagamento inválido geram erro explícito.
- O diálogo guarda o pedido em sessionStorage por empresa, usuário e pagamento antes do envio. Retoma exatamente o mesmo pedido após resposta perdida, inclusive quando a saída desaparece da lista por já estar vinculada. Rejeição SQL conhecida na primeira tentativa libera seleção; pedidos previamente incertos não são descartados por uma rejeição subsequente.
- Acesso do diálogo passa por FinanceAccessBoundary; consulta e comando usam autorização no banco, incluindo negação a perfis mistos de motorista. Cache é separado por ator e empresa, e dados antigos deixam de aparecer quando a consulta falha.
- Atualiza caches de capacidade, gastos, pagamentos, movimentos e auditoria após confirmação. A apresentação esclarece que vincular não cria dinheiro nem substitui conciliação bancária.

## Verificação

`npx vitest run src/test/settlementMovementOptions.test.ts src/test/settlementMovementWorkspace.test.tsx src/test/settlementMovementClient.test.ts`: 12 testes passaram (4 PGlite com SQL real candidato, 5 interface com adaptador simulado, 3 adaptador).

Cobertura: capacidade compartilhada, motorista/data, autoria, paginação, perfil misto negado, escopo da resposta, falha de armazenamento, resposta perdida/replay, primeira rejeição conhecida, preservação de pedido incerto e ocultação de cache após falha.

ESLint passou nos sete arquivos TypeScript alterados/adicionados. TypeScript global inicialmente apontou dois usos de replaceAll em `financePeriodEvidence.test.ts`, pertencente à frente paralela. A execução final terminou com oito erros de tipagem de tupla/mock em `activeTenantRequest.test.ts` (linhas 12, 24, 35) e `authClientConfiguration.test.ts` (linha 33), sem erros nos arquivos desta entrega. Coordenador avisado; esses arquivos não foram alterados por esta frente. Não houve ensaio em PostgreSQL nativo nem navegador real deste diálogo.

## Limites

O fluxo vincula apenas pagamentos existentes inteiros. Não cria novos pagamentos, não altera total do acerto e não resolve correções/reversões de vínculos. Acertos que reembolsam despesas já atribuídas à mesma saída precisam de composição explícita; a interface informa essa pendência, sem contornar capacidade ou duplicar gastos. A consulta é atual e não congela a capacidade: a transação de vínculo revalida ao gravar. Históricos antigos sem vínculo continuam pendentes de tratamento. O registro legado de novos pagamentos permanece para ser substituído pela frente coordenadora.

## Complemento: correção de vínculo

`SettlementLinkReversal.tsx` acrescenta correção recuperável pelo RPC `reverse_finance_settlement_link`. O diálogo exige motivo e esclarece que pagamento e dinheiro não são excluídos. Guarda o pedido por empresa, usuário e pagamento antes do envio; retoma exatamente o mesmo pedido mesmo quando o vínculo deixa de estar ativo após resposta perdida. Primeira rejeição SQL conhecida libera correção; tentativa restaurada ou previamente incerta continua preservada. Correção pendente bloqueia envio de outro vínculo no mesmo diálogo.

O contrato da consulta passa a exigir `history`, com autoria, motivo e momento de vínculo e reversão. A interface mantém texto “Vínculo manual”, status ativo/desfeito e nomes/IDs dos responsáveis permanentemente no histórico; a cor é reforço visual, não a única indicação.

Esta frente não alterou SQL da reversão, que é de responsabilidade da coordenação. Atualizou contratos, adaptador, diálogo principal e novos testes de reversão. 13 testes de interface/adaptador passaram: 6 em settlementMovementWorkspace, 4 em settlementMovementClient e 3 em settlementLinkReversal. ESLint passou nesses arquivos. A limitação anterior de ausência de reversão de vínculo fica superada pela implementação conjunta da UI e do backend candidato, sujeita à validação integrada. Não foi implementada devolução financeira nem exclusão de pagamentos.

TypeScript global (`npx tsc --noEmit -p tsconfig.app.json`) terminou com código 0 após esse complemento; os erros anteriores de outras frentes já não apareceram na execução final.
