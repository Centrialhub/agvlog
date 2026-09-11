# Recebíveis históricos — revisão independente de apresentação — 2026-09-10

## Conclusão

Não apresentar a carteira atual como posição histórica. A entrega segura seguinte é um histórico de versões com cobertura declarada; a posição econômica passada depende de política de datas e prova de continuidade adicionais. A captura iniciada pela migration `20260910195941_finance_receivable_temporal_foundation.sql` preserva baseline e alterações futuras, mas não certifica estados anteriores nem a visibilidade de commits em um instante passado.

Revisão somente leitura; nenhum produto, contrato ou SQL alterado, nenhum TSC executado. Caminhos localizados com `rg`. Base: plano `docs/planejamento-financeiro-2026-09-09.md`, especialmente recebíveis/descarga, cancelamentos, abertura histórica e pacote de fechamento; comparação com implementação abaixo. A fundação temporal estava sendo integrada nesta rodada: sua existência no código não constitui implantação remota comprovada.

## O que existe e o que a tela pode afirmar

| Ponto atual | Evidência de código | Apresentação honesta / lacuna |
|---|---|---|
| Resumo integral de carteira | `receivablePortfolioContract.ts`, `ReceivablePortfolio.tsx`, `useReceivablePortfolio.ts`; migration `20260910151617_finance_receivable_portfolio_summary.sql` | Filtra criação do título em São Paulo, lê valores/status vigentes e calcula vencidos em hoje (`as_of`). É **carteira atual dos títulos criados no intervalo**, não saldo existente no fim desse intervalo. Os textos atuais já distinguem baixas alocadas de dinheiro bancário. |
| Lista operacional | `src/pages/Receivables.tsx`, `src/lib/financial/receivablesPageContract.ts`, migration `20260910154046_finance_receivables_paged_list.sql` | Lista paginada atual. Não reutilizar suas linhas como versões históricas. Há renderização com `Number(... || 0)` e saldo `Math.max(0,...)`; na futura tela histórica isso não pode converter valor inválido/ausente em zero nem esconder saldo inconsistente. |
| Recebimento e correção | `ReceivableFinancialDialog.tsx`, `receivableCommands.ts`, `receivableFinancialOutbox.ts` | Recebimentos parciais, devolução real, crédito fiscal e correção de alocação têm significados distintos. Histórico preserva pagamentos; exibe no máximo 500 e avisa que os anteriores exigem consulta administrativa. Falta acesso paginado integral para conferência histórica pelo usuário, sem depender dessa consulta externa. |
| Fiscal | `ReceivableFinancialDialog.tsx`; migrations `20260910010034_finance_fiscal_receivable_projection.sql`, `20260910012152_finance_receivable_fiscal_context.sql` | A UI bloqueia recebimento por cancelamento/suspensão/revisão e distingue crédito pendente. Ainda falta apresentar no histórico as datas de ocorrência declarada, observação e materialização financeira separadamente. Estado fiscal atual não reescreve o passado. |
| Descarga | migration `20260909212514_finance_delivery_unloading.sql` | Uma cobrança por entrega raiz, `supplier_id`, `receivable_id` e documentos da origem preservados. Fornecedor vem dos vínculos das NFs; usa cadastro unificado `clients`, não identidade genérica. No histórico, usar devedor e origem preservados, sem resolver novamente pelas NFs/cadastros atuais. Falta agrupamento histórico explícito por fornecedor com ligação entrega → descarga → título → baixas. |
| Versões do título | migration `20260910195941_finance_receivable_temporal_foundation.sql` | Captura INSERT/UPDATE/DELETE e baseline, antes/depois, autor humano/sistema, snapshot do pagador, `captured_at`, transação e sequência. Não oferece API pública de posição. A baseline prova estado observado no início da captura; não é autorização para projetar esse estado para trás. |

## Contrato mínimo de apresentação proposto

Sem fixar nome de RPC antes da definição do reader:

- Identidade: empresa, moeda BRL, fuso São Paulo, filtros de devedor por tipo+ID e origem por tabela+ID; separar fornecedor devedor, cliente da operação e pagador efetivo. Não filtrar fora uma origem cujo devedor histórico é indeterminado: incluí-la nas pendências de cobertura relevantes, sem revelar outra empresa.
- `basis`: distinguir **estado atual**, **histórico capturado** e **reconstituição econômica com evidências disponíveis nesta consulta**. A opção “o que era conhecido naquele instante” permanece indisponível sem prova própria de visibilidade transacional. Não renomear `captured_at` como “confirmado em” ou `event_order` como ordem de commit.
- `economic_cutoff`: fim do dia em São Paulo; `coverage_starts_at`, tipo de baseline, continuidade comprovada/indeterminada, cobertura por fonte, registros sem data e contagens de fontes desconhecidas. O horário de geração da consulta é metadado da consulta, não fronteira de conhecimento histórico.
- Totais integrais do servidor: nominal vigente, baixas alocadas, saldo aberto e vencido, com cancelados/creditados/devolvidos/correções separados para explicação. Valores string em centavos ou null; cobertura insuficiente torna o total indeterminado, não zero. Subtotais comprovados só podem aparecer com escopo explícito.
- Linhas: `receivable_id`, versão/baseline/tombstone, origem, devedor preservado, vencimento e valores da versão, IDs de pagamentos/eventos/créditos/correções, autor humano ou sistema, motivo quando existente, data econômica e data de captura separadas, retroatividade e pendências. Não inventar autor/motivo ausente no legado.
- Paginação: revisão de um conjunto estável ou manifesto persistido de leitura; mudou o conjunto, reiniciar com aviso. Ordenação por sequência resolve desempate técnico, não assegura que todas as transações anteriores já estavam confirmadas. Totais não dependem da página.

## Gaps essenciais antes de habilitar posição econômica

1. **Política econômica por evento.** Recebimento tem `received_at`, devolução tem data efetiva, mas alteração de valor/vencimento/devedor/status do título e correção de alocação não ganham data econômica apenas por existir captura. Declarar base por tipo; na ausência de evidência, marcar indeterminado ou usar uma política de registro explicitamente limitada, nunca herdar silenciosamente a data do recebimento.
2. **Retroatividade.** Um recebimento ocorrido dia 5 e registrado dia 12 pode participar da reconstituição econômica do dia 10 feita hoje, com aviso de inclusão posterior. Não pode aparecer como algo comprovadamente visível dia 10. Uma consulta preservada antes da inclusão permanece imutável; a nova revisão explicita a diferença por IDs.
3. **Cobertura e baseline.** Cortes anteriores ao início da captura não recebem valores atuais. Títulos antigos têm estado de abertura observado, não histórico anterior completo. DELETE exige tombstone e preservação do universo; ausência na lista atual não prova ausência no corte.
4. **Eventos fiscais e parciais.** Cancelamento posterior ao corte não elimina cobrança que estava comprovadamente vigente antes. Cancelamento com recebimento preserva dinheiro e transfere alocação para crédito conforme evento; não cria devolução fictícia. Um pagamento não pode ser deduzido duas vezes por crédito+correção+devolução. Sem data econômica comprovada do cancelamento, mostrar observação/materialização e pendência.
5. **Descarga e contraparte.** Reembolso entra uma vez no conjunto de títulos; valor da descarga não é somado novamente como outra receita a receber. Alterar nome do fornecedor ou NFs depois não muda a contraparte histórica. Divergência título↔fornecedor da origem precisa ser visível por IDs, inclusive após pagamento parcial.
6. **Histórico acessível e integral.** Substituir o limite de 500 no detalhe por navegação paginada quando o reader histórico existir; indicar ainda hoje esse limite sem alegar histórico completo. A tela histórica deve conservar cancelados e apagados, com contribuição ativa explicitamente distinta.

## Critérios de aceite

- Título R$ 1.000, baixa R$ 300 antes do corte e R$ 200 depois: saldo econômico R$ 700 no corte apenas se versão do título e datas/eventos estiverem cobertos; carteira atual R$ 500 continua identificada separadamente.
- Registro retroativo altera a nova reconstituição por revisão identificada, sem alterar consulta preservada anterior nem afirmar que já era visível no passado.
- Transação A captura sequência menor e aguarda; B captura maior e confirma primeiro. Nenhuma UI/reader interpreta sequência ou timestamp de captura como conjunto de commits visíveis no instante de B. Rollback de A não produz evento confirmado fictício nem cobertura completa inferida por lacuna de sequência.
- Antes da cobertura, nominal/aberto/vencido históricos indeterminados, com motivo e baseline visível. Título excluído após a cobertura continua localizável pelo tombstone.
- Cancelamento fiscal antes/depois do corte, inclusive parcialmente recebido, conserva pagamento original e crédito/devolução distintos; ausência de prova temporal resulta em pendência.
- Entrega com várias NFs do mesmo fornecedor gera uma origem de descarga e um título; reembolso parcial reduz apenas esse título. Mudança cadastral posterior não altera fornecedor histórico.
- Mais de 1.000 títulos e mais de 500 recebimentos navegáveis sem truncar totais; mudança de revisão reinicia paginação; zero só com universo vazio e cobertura comprovada.
- Erro, atualização pendente, dado monetário inválido ou origem temporal ambígua ocultam valores anteriores como atuais. Tenant, usuário e filtros fazem parte do escopo de cache. Motoristas e perfis mistos permanecem bloqueados no servidor e na entrada da UI.

Próxima entrega recomendada: reader de histórico capturado com baseline/antes/depois/tombstones e cobertura explícita; só então habilitar reconstituição econômica dos eventos cujo tempo e cadeia estejam comprovados. Não é necessário nem correto renomear a carteira atual como histórica para entregar essa rastreabilidade.
