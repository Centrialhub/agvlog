# Custo já coberto — núcleo privado72557

Candidato local: `supabase/migrations/20260911072557_finance_unloading_covered_cost_regularization.sql`.
SHA256: `cd41a809dfe98661351f9e9cdfc446169ea08289e723f678a66635ed6b288c9f`.
Catálogo real pós-instalação: `finance-covered-cost-core-catalog-2026-09-11.json` (prosrc MD5, ACL, security definer e search_path das cinco funções para promoção guardada).

O journal privado preserva a cadeia60519 e todos os registros originais. O resolvedor aplica a nova cadeia e valida fontes, propostas, eventos e comandos. Sem regularização, a revisão60519 permanece a mesma. A nova disposição é uma posição substitutiva:150→120→100 resulta responsabilidade/recuperação50, não80.

Envio driver_advance150 pode cobrir custo120 com driver_custody30, sem payable fictício. Título150 integralmente pago150 permanece nominal/pago150; custo120 reconhece payment_recovery30 separado. Nenhum UPDATE monetário, alocação, lançamento bancário ou conciliação é produzido. movement_used permanece150. Responsável por pagamento exige identidade da obrigação ligada à expense original e correspondência do beneficiário nominal registrado no movimento; não constitui verificação bancária da identidade civil. Nome do motorista vem do movimento histórico, não do cadastro atual.

Guardas aditivas avaliam OLD e NEW, serializam por finance trylock e impedem reversão da baixa, alteração do título, alocação adicional, cancelamento, invalidação da fonte e bifurcação pela cadeia antiga enquanto houver disposição. Os leitores de capacidade e guardas monetárias capturados não foram reescritos. Reautorização ocorre após travas e antes de replay/escrita. Journal/disposições são privados sem grants e possuem validação diferida com comando/evento obrigatório.

## Provas locais

`npx vitest run src/test/unloadingCoveredCostRegularization.test.ts --reporter=dot`:5 testes passaram em2026-09-11,04:42:56(local). ESLint do arquivo:0.

- Pagamento real150→retificações120/100, replay, constraints imediatas, original payable/payments/movements/expense byte-equivalente, reserva150 e recuperação final50.
- Envio real150 e lote/descarga real totalmente alocados: custo120, custódia30, payable null; alocação intacta; renomeação posterior do cadastro não invalida a cadeia.
- Falha de auditoria desfaz journal/disposições; reversão03529 real rejeitada sem resíduo; nova alocação rejeitada; revisão antiga, outro tenant e papel motorista misto negados.
- Beneficiário nominal contraditório não gera recuperação atribuída silenciosamente.
- Proposta duplicada não é elegível; alteração de tenant do título protegido falha pela identidade OLD.

A fixture usa os writers financeiros reais e cadeia60519. Acrescenta o trigger baseline `_recalc_payable_paid` com transformação real03529 para active_payable_payments, pois a fixture anterior não atualizava status/paid_amount ao pagar. O teste de reversão instala a função e wrapper03529 reais omitidos pela fixture-base. Não modifica manualmente o título para simular pagamento. Não é ensaio de concorrência PostgreSQL nativo nem autenticação de navegador/produção.

## Integração e trabalho ainda obrigatório

Sem RPC público nesta migração: root prepara74203 após leitores72723/interface. Os consumidores precisam exibir custo efetivo, bruto reservado, parcela aplicada e residual; carteira mantém título histórico e pendência separada. Não considerar somente KPI corrigido como módulo concluído.

Complemento ainda aberto fica explicitamente bloqueado por `finance_cost_open_obligation_requires_plan`. Acerto/folha materializados são identificados em materialization_plan e bloqueados por `finance_cost_materialization_requires_review`; dependências legadas/manutenção/adiantamentos possuem plano pendente explícito. Fechamentos são verificados também nos movimentos de origem. A revisão/reconstrução coordenada de acerto/folha e a correção do complemento aberto continuam necessárias no escopo completo. A resolução do residual (retorno real ou compensação autorizada) é comando futuro próprio; esta etapa registra pendência protegida, nunca afirma devolução feita.

Nenhuma aplicação remota, commit, TSC, PostgreSQL nativo ou publicação nesta entrega.
