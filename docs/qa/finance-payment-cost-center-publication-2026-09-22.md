# Publicação das correções financeiras — 2026-09-22

Base: `7a46fa90faa40deb7e6c07efd99bc6281ca51173`, que já inclui a importação do relatório Pix Sicoob.

## Escopo

- Compatibilidade das RPCs financeiras com o banco, incluindo contratos adicionais sem substituir os contratos usados pelas telas existentes.
- Baixa de conta a pagar com conta de origem, confirmação, idempotência e recuperação do pedido.
- Seleção de títulos e exclusão da lista com preservação do histórico e verificação de dependências.
- Centro de custo opcional no lançamento manual, confirmação do vínculo retornado pelo servidor e exibição nas movimentações.
- Preservação do contexto do cliente Supabase nas chamadas de pagamento e exclusão, com teste de regressão.

Inclui as três migrações descritas nos relatórios de compatibilidade, contas a pagar e centro de custo desta data. Esses relatórios registram a aplicação anterior no banco; esta publicação não reaplica migrações nem implanta Edge Functions.

## Validação da versão preparada para publicação

- 18 suítes selecionadas: **82 testes aprovados**, cobrindo RPCs, banco de teste, pagamentos, exclusão, carteira e lançamentos.
- `npm run build:check`: aprovado, incluindo limites de bundle e inspeção do artefato público.
- ESLint dos arquivos TypeScript alterados: sem erros.
- `npm run supabase:release:check`: aprovado, 593 migrações ordenadas e 48 Edge Functions.
- `npm run edge:syntax`: aprovado, 93 arquivos TypeScript.
- `git diff --check`: aprovado.

## Limitações anteriores

- `payablePortfolio.test.ts` falha na preparação do banco com `finance_statement_coverage_dependencies_changed`, deixando 14 casos sem execução. A mesma falha foi reproduzida na base `7a46fa90`, sem estas alterações.
- `npm run typecheck` permanece com 11 erros nos arquivos `usePendingLoadsForRouting.ts`, `useLoadItems.tsx`, `orderFormNormalization.ts` e `Loads.tsx`, fora do escopo desta publicação. Não há erros reportados nos arquivos desta correção.

A compilação local não comprova implantação nem execução das telas em produção; o resultado da publicação deve ser conferido no GitHub e no provedor de hospedagem.
