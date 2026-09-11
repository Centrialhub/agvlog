# Associação auditada de despesa antiga a custo registrado

Implementação local: `20260910155442_finance_legacy_expense_cost_associations.sql`. SHA256: `74ba3d2af100d5c41643705037c9535836cda26cc88646a1360a06b13e718e19`. Nenhuma aplicação remota.

## Escopo entregue

Associação integral, escolhida explicitamente por um usuário financeiro, de `driver_expenses` a `finance_expense_items`. A origem deve estar aprovada, ser despesa da empresa e não reembolsável, com motorista e viagem identificados. Viagem, motorista, categoria, dia em São Paulo e centavos devem ser compatíveis. Essas condições não provam identidade: o comando exige a declaração `same_expense_confirmed: true` e motivo de 10 a 2000 caracteres.

O comando não cria nem altera movimento, pagamento ou obrigação. O título e as alocações existentes do custo canônico permanecem. Outro título derivado da despesa antiga ou de sua obrigação por IDs bloqueia a associação. Não há inferência por semelhança de valor ou data.

## Contrato e rastreabilidade

- `associate_finance_legacy_expense_cost(_payload)`: `version: 1`, `tenant_id`, `request_id`, `expense_id`, `cost_id`, `revision`, `reason`, `same_expense_confirmed: true`.
- Resultado: os IDs acima mais `link_id`, `amount_cents` como string, `cash_created: false`, `obligation_created: false`, `confirmed: true`.
- `reverse_finance_legacy_expense_cost_association(_payload)`: `version: 1`, `tenant_id`, `request_id`, `link_id`, `reason`.
- Resultado da reversão: IDs de origem/alvo/vínculo, `reversal_id`, centavos, `cash_changed: false`, `obligation_changed: false`, `confirmed: true`.

A revisão determinística abrange origem, custo, lote, obrigações, alocações, títulos, pagamentos pertinentes, acertos, folha e histórico das associações. O mesmo JSON é preservado no snapshot, junto da revisão e declaração. Mudança da revisão produz `finance_legacy_cost_changed` (40001). Replay exige mesmo autor, ação e payload. Nova associação depois da reversão recebe novo ID; nenhuma linha histórica é sobrescrita.

Eventos: `legacy_expense_cost_associated` e `legacy_expense_cost_association_reversed`, com autor, nome, horário, motivo e `manual_intervention: true`. A consulta e a interface dedicadas são de responsabilidade das frentes 55523/UI; a inclusão desses eventos no filtro genérico de intervenções manuais foi comunicada ao integrador.

## Acerto e folha

A representação `driver_expenses` é mantida no construtor real do acerto. Apenas a segunda representação, `finance_expense_items`, é excluída de `canonical_trip_costs` enquanto houver associação ativa. As fontes dos itens antigos e o reembolso de outras despesas permanecem. A associação/reversão marca acertos editáveis para recálculo e preserva motivos prévios; não reescreve snapshots automaticamente.

Acertos fora de `pending_review`, `in_review`, `reopened` bloqueiam. Entradas/períodos de folha relacionados por motorista/data ou IDs de fontes, fora de `draft`/`calculated`, bloqueiam. Isso inclui cancelados: sua eventual liberação exige revisão específica, não é presumida por este comando.

Ordem: autorização → trava financeira da empresa → períodos → viagem → acertos → entradas ordenadas por período/ID → despesa. A autorização é conferida novamente depois das esperas. Escritas concorrentes da origem usam tentativa da mesma trava para evitar espera em ordem inversa. Motoristas não possuem acesso, inclusive em perfil misto conforme `can_access` vigente.

## Validação

`npx vitest run src/test/financeLegacyExpenseCostAssociations.test.ts`: **10 testes passaram**. ESLint dos testes e helper: código 0.

Casos cobrem comando real de lote com título a pagar, ausência de novo dinheiro, replay, obrigação legada conflitante, revisão alterada por título, folha aprovada, origem imutável após reversão, reassociação com histórico, reembolso recusado, valores divergentes e acerto aprovado preservado. O construtor real demonstra 125 antes da associação → 75 após reconstrução, preservando 25 de reembolso e os IDs das despesas antigas.

A fixture usa definições reais de tabelas e funções de acerto/folha/custo. Fontes de distância/documentos de rota estão vazias; não testa entrega física. A visão de pagamentos ativos é simplificada nessa fixture porque o comando não modifica pagamentos. A validação PostgreSQL nativa concorrente é independente, sob responsabilidade de `bank_period_evidence`, e não está incluída nos 10 resultados acima.

## Limitações explícitas

Despesas reembolsáveis continuam em revisão: não se cria nem deduz crédito de motorista por aproximação. Manutenção permanece inventário de cabeçalho, sem incorporação automática de peças/mão de obra ou mistura de compra de estoque com consumo. Essa entrega não conclui adoção de todos os custos antigos nem conciliação bancária.

A origem fica imutável após qualquer associação histórica, inclusive desfeita. Desfazer o vínculo não autoriza UPDATE/DELETE da despesa. Ainda não existe comando de correção auditada dessa origem; será necessário um evento específico, preservando snapshot anterior e verificando novamente acerto, folha, obrigações e dependências. A interface deve explicar essa restrição, sem sugerir que a reversão libera edição.

Unicidade ativa é garantida nos comandos serializados pela trava financeira; as tabelas são somente leitura para papéis de aplicação. Escrita direta pelo proprietário do banco não faz parte do contrato e não deve ser usada para adoção.
