# Correção de descarga com complemento positivo ainda em aberto

Candidata local privada `20260911081653_finance_unloading_open_complement_corrections.sql`, criada via Supabase CLI. SHA-256: `98f6a882b590b0680c836e495a28cdd60521cbad5f7a470dea47b9544475310b`. Nenhuma aplicação remota ou promoção pública nesta entrega.

## Comportamento comprovado

Custo original150, alocação histórica100 e obrigação50 permanecem sob as mesmas identidades. A correção econômica para120 produz versão nova do custo e reduz a mesma obrigação para20. A obrigação aprovada retorna a pending, exigindo reaprovação. O pagamento canônico posterior de20 funciona: custo efetivo120, cobertura total120, saída e alocação originais100 preservadas. Não há recebimento, estorno, crédito ou liberação da capacidade original por esta correção.

O journal privado append-only registra antes/depois, fonte original completa, responsável, motivo, requisição, encadeamento e revisão. Nenhuma coluna foi acrescentada aos objetos históricos finance_expense_items/payables/finance_expense_allocations. A alteração pontual da obrigação usa o ticket transacional exato já existente de60519; o guard original continua consumindo e validando o ticket. O resolver pós74603 permanece como base e mantém intactos os retornos e disposições de outros custos.

Guards novos protegem OLD e NEW de alocações/obrigações, invalidadores de movimento, cancelamento de custo e inserção concorrente de outra família de correções. Metadados legítimos de aprovação/pagamento continuam admitidos sob os guards financeiros existentes. A versão corrente ignora somente esses campos mutáveis de pagamento/aprovação ao comprovar a identidade original da obrigação.

## Contratos privados

- `finance_private.unloading_open_complement_context(uuid,uuid,text)` retorna versão1, identidades tenant/actor/charge/expense/payable, revisão, cost_origin, allocated_reserved_cents, payable, target, approval_reset, blockers, eligible, can_correct e can_execute=false. `_evidence` existe somente na resposta privada e precisa ser removido na futura fronteira pública.
- `finance_private.correct_unloading_open_complement(jsonb)` aceita version1, tenant_id, request_id, charge_id, expense_id, payable_id, amount_cents:string, revision e reason. Retorna identidades, amendment_id, confirmed=true, efeitos explícitos e payable_status=pending. Replay exige mesmo ator/corpo/ação após reautorização sob locks.
- `expense_cost_effective` acrescenta open_complement nullable, contendo a última versão e history com ordinal/previous_id/revision_after, custos/complementos antes/depois, alocação preservada, ator, motivo, data e approval_reset. verified=false invalida effective_amount_cents.
- Efeitos da prévia/resultado: cost_before_cents, cost_after_cents, complement_before_cents, complement_after_cents, cash_changed=false, capacity_released_cents=0 e approval_reset. Valores desconhecidos permanecem null na prévia inelegível.

O cálculo de cobertura pós74603 já suporta o ramo sem disposição: allocated100 + payment20 = applied120. Sua definição não foi alterada. A apresentação precisa incorporar open_complement antes de publicação; o DTO é aditivo mas schemas strict anteriores podem recusá-lo. Não promover o escritor isoladamente.

## Validação local

`npx vitest run src/test/unloadingOpenComplementCorrection.test.ts --reporter=dot`: 6 testes aprovados em11/09/2026,05:37:27 local. ESLint do arquivo: saída0, sem diagnósticos.

1. Lote parcial real150/100/50, correção120/100/20, reaprovação e pagamento real20; replay, snapshots originais e reserva100 preservados.
2. Alvo abaixo da alocação diagnosticado, revisão obsoleta, outro tenant e rollback integral quando evento de auditoria falha.
3. Construtor real de acerto materializa o custo; correção bloqueada e itens preservados.
4. Duas revisões sucessivas sem pagamento, identidade da alocação congelada, motorista misto negado e writer sem EXECUTE authenticated.
5. Mudança de segurança do guard predecessor impede instalação antes de criar objetos da candidata.
6. Preview e comando reais de cancelamento coordenado após correção recusam extinção da dívida e preservam custo/alocação.

Fixture PGlite integra writers reais60519/72557/74603, leitores60700/72723, construtor canônico de acerto e recálculo real de pagamento. O cenário pago/regularizado separado do setup também atravessa a candidata sem mudança. Não representa ensaio concorrente PostgreSQL nativo, browser/Auth hospedado ou produção. Catálogo predecessor real capturado em `finance-open-complement-predecessors-2026-09-11.json`; contratos utilizados são validados por hash normalizado, ACL, search_path, volatilidade e trigger do ticket.

## Escopo ainda necessário

Esta é a primeira candidata privada, não a conclusão do objetivo completo. Se o alvo for menor ou igual ao já alocado, não se permite obrigação negativa nem liberação da saída: a próxima coordenação deve cancelar a obrigação histórica ainda não paga e classificar o excedente por disposição explícita, compatível com cobertura, carteira e devolução já implementadas. Pagamentos históricos de complemento e composições materializadas continuam separados e bloqueados até plano auditado próprio. Nenhum desses casos é apresentado como corrigido por esta entrega.
