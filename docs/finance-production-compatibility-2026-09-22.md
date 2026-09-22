# Correção de compatibilidade financeira — 22/09/2026

Aplicada ao projeto `qcvnsdrbcchaxvawcngk` a migration
`20260922210823_finance_production_rpc_compatibility`, registrada com sucesso no histórico remoto.
As **12 RPCs ausentes e 4 assinaturas incompatíveis** da auditoria foram corrigidas.
Nenhum pagamento, lançamento ou valor financeiro foi alterado nesta aplicação.

## Resultado verificado

| Verificação | Antes | Depois |
|---|---:|---:|
| Funções ausentes no conjunto identificado | 12 | 0 |
| Funções com parâmetros incompatíveis | 4 | 0 |
| Pontos de chamada afetados | 17 | 0 |
| Chamadas literais com assinatura identificada e compatível | 154 | 171 |
| Chamadas literais cujos argumentos exigem análise manual | 7 | 7 |

O inventário original abrange 457 arquivos, 178 chamadas literais e outros 35 pontos com nome dinâmico.
As 171 chamadas identificáveis têm um único candidato por nomes de argumentos, EXECUTE para
`authenticated` e USAGE no schema. As outras **7 chamadas literais foram resolvidas manualmente e também são compatíveis**.
Foram ainda conferidos 21 destinos explícitos de comandos condicionais, todos compatíveis. Os 35 pontos
classificados como dinâmicos pelo scanner incluem transportes genéricos e chamadas de adapters;
não representam necessariamente 35 RPCs diferentes. Isso não certifica todas as respostas ou a versão publicada da interface.

[Evidência da conferência manual de 28 contratos](F:/agvlog-main/docs/qa/finance-production-manual-rpc-check-20260922.json).

## Alterações

- Instaladas as consultas versionadas de despesas, extratos, receber, fila fiscal, folha, revisão de despesas, conciliação legada e portal.
- Atualizadas as consultas de movimentos, pagamentos e cargas disponíveis para aceitar `_expected_revision`. O parâmetro opcional preserva chamadas anteriores.
- Adicionado `_request_id` à troca de conta de extrato. A assinatura anterior permanece autorizada durante a atualização da interface.
- Instalados aprovação e fechamento recuperáveis da folha, com validação de empresa ativa, autor do pedido e permissão de administrador no fechamento, inclusive na repetição.
- Preservado o comportamento da aprovação antiga: ela ainda lança erro diante de pendências. A aprovação versionada usa uma função privada derivada da definição ativa para preservar diagnósticos e retornar `approved=false`.
- Corrigidos três problemas encontrados no ensaio: cursor JSON `null` rejeitado nas primeiras páginas; ambiguidade de `payment_status` na folha; ambiguidade da chave de repetição na troca de conta.
- Mantidas as proteções de contexto financeiro contra usuários com papel de motorista. Recarregamento do schema do PostgREST solicitado no commit.

## Validação

- **23 testes passaram em 9 arquivos**, incluindo 10 novos testes de execução SQL com PGlite.
- O fixture contém somente estrutura e funções capturadas do banco ativo, com registros sintéticos. Executa as consultas contra os nomes e tipos reais das colunas; não representa uma cópia integral de constraints, triggers, RLS ou concorrência.
- Verificados contratos de resposta consumidos pelo frontend, paginação com registros, rejeição de revisão desatualizada, acesso por empresa, papéis mistos, repetição de aprovação/fechamento e um único evento na troca de conta.
- **13 verificações de leitura passaram no banco ativo**, em transação `READ ONLY` com papel `authenticated` e contexto válido de empresa. A consulta de folha foi omitida no teste remoto porque não havia período naquele contexto; ela passou com registros sintéticos no ensaio local.
- ESLint dos novos testes e verificação do contrato de migrations passaram.
- O typecheck completo continua com os mesmos 9 diagnósticos anteriores, sem erro nos arquivos novos. Entre eles, `BillingEdi.tsx` usa `DataPagination` sem import; esse gate ainda impede a liberação completa do frontend.
- Nenhum comando financeiro de escrita foi executado para testar produção. Não houve publicação do frontend.

## Publicação e pendências

Esta correção resolve o conjunto de incompatibilidades de RPC comprovado. O histórico local e remoto
continua divergente; foi aplicada uma migration nova e específica, sem reproduzir toda a cadeia local.
O arquivo local usa a versão efetivamente registrada pelo Supabase. Não usar `db push --include-all`
como substituto da revisão do histórico.

A auditoria geral continua válida para os demais achados. A constraint `payables_amount_positive`,
os triggers de autor/auditoria material de contas a pagar, os cadastros manuais recuperáveis e os
demais problemas funcionais não fazem parte desta migration. A liberação completa também depende
do gate TypeScript e das jornadas da interface publicada.

Evidências: [catálogo e verificações após a aplicação](F:/agvlog-main/docs/qa/finance-production-compatibility-20260922.json).
As [definições anteriores](F:/agvlog-main/docs/qa/finance-production-rpc-before-20260922.json) foram
guardadas como referência, não como rollback automático: restaurá-las removeria contratos já consumidos
pelo código novo. Em caso de incidente, preparar uma migration corretiva compatível com os consumidores ativos.

Reprodução local:

```powershell
npx vitest run src/test/financeProductionRpcCompatibility.test.ts
npx eslint src/test/financeProductionRpcCompatibility.test.ts src/test/helpers/financeProductionRpcDatabase.ts
npm run supabase:release:check
```
