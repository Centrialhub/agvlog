# Adiantamentos pagos e projeções already_paid — diagnóstico de resolução por IDs

Data: 2026-09-10. Escopo: leitura e protótipo executável; nenhuma alteração ao classificador B, migração ou ambiente remoto.

## Conclusão

Há caminho positivo por IDs para adiantamento com título próprio e pagamentos canônicos íntegros, e para item de folha originado de pagamento de acerto canônico. Ambos são projeções de dinheiro já registrado: não podem criar saída, reservar novamente capacidade nem produzir outro crédito. O caminho não existe para todos os registros históricos marcados como pagos.

## Cadeias existentes e produtores

| Fonte | Cadeia por IDs | Prova e ressalvas |
|---|---|---|
| employee_advances paid | advance.payable_id → payable.id, conferindo também payable.source_table=employee_advances/source_id=advance.id → active_payable_payments → link ativo → finance_movements | A origem direta é produzida por register_employee_advance na baseline, linhas 10368–10421. Exigir tenant em todas as arestas, título único, identidade empregado/motorista, valor integral e todas as parcelas canônicas. |
| advance via financial_obligations | advance.financial_obligation_id → obligation.id, origem employee_advances/id → payable.source_table=financial_obligations/source_id=obligation.id | Coluna existe, mas não foi encontrado produtor atual dessa cadeia na rotina de cadastro. O protótipo expõe candidato; não o aprova. Status/matching_status da obrigação não prova saída. |
| payroll_entry_items already_paid de adiantamento | item.source_table=employee_advances/source_id → advance → cadeia acima | Gerador baseline10135–10150 usa advance_date como competência e status=paid. Conferir item→entry→period→employee e valor igual à origem; item não é outra parcela financeira. |
| payroll_entry_items already_paid de acerto | item.source_table=driver_settlement_payments/source_id → pagamento → link de acerto ativo → movimento | Gerador baseline10188–10203 já usa ID do pagamento. Comando33421, linhas75–95, produz item atomicamente com pagamento e vínculo e inclui movement_id/settlement_id/request_id em metadata. Reutilizar legacy_cut_settlement_evidence170213, adicionando validação da identidade/valor da folha. |
| already_paid de payables_payments | item.source_id → pagamento → título | Não foi encontrado produtor atual. A whitelist de inventário não autoriza semanticamente essa origem. Se for pagamento do próprio título líquido da folha, tratá-lo como already_paid pode descontar duas vezes. Manter pendência até política de origem explícita. |

Metadata legada ausente não invalida por si só o gerador antigo. Se presente, IDs declarados devem concordar com a cadeia canônica atual; nunca substituir joins por metadata. Nome, descrição, valor/data semelhantes não formam vínculo.

## Registros não resolvíveis automaticamente

- `_mark_paid=true` em register_employee_advance (baseline10385–10410) marca adiantamento e opcionalmente título como pagos sem inserir payables_payments ou movimento. O hook usePayroll.tsx334–337 também atualiza status/paid_at diretamente. Esses estados não provam dinheiro.
- sync_employee_advance_from_payable (baseline11261) propaga paid/cancelled, mas não desfaz paid quando uma reversão deixa título parcial/pendente. É necessário verificar os pagamentos ativos atuais.
- Mais de um título candidato, título de outra origem, empregado/motorista divergente, parcela sem vínculo ou soma ativa diferente do adiantamento continuam pendentes.
- Reversão canônica elimina o pagamento da visão ativa; reversão de adoção legada mantém o pagamento histórico real sem associação. Nenhuma pode ressuscitar uma nova saída ou ser ignorada.
- Fonte already_paid inexistente, tenant cruzado, pai incompatível, valor divergente e duplicação do mesmo source por empregado (inclusive sobreposição de períodos) exigem resolução explícita.

## Modelo mínimo para implementação posterior

Resolver toda a origem antes de filtrar conta/corte. Um adiantamento pode ter várias parcelas, contas e dias: retornar `footprints:[{payment_id,link_id,movement_id,account_id,occurred_on,amount_cents}]`, além de source IDs, revision, estado e blockers. O atual formato singular de conta/data do B não comporta isso sem extensão. Não escolher a primeira parcela, menor conta ou data final.

`advance_date` e a competência do item pertencem à folha. `advance.paid_at` pode ser horário de alteração de status. O dia do dinheiro vem da perna canônica, conferida contra a data São Paulo do pagamento. Um item sem data própria pode ter origem monetária exata; filtrar pela data bruta antes de resolver a origem causaria omissão indevida.

Classificar avanço/item válidos como aliases de projeção. A capacidade é validada uma única vez pelos pagamentos canônicos subjacentes, incluindo outros usos do movimento. As origens, todos os títulos/pagamentos/links/reversões usados e pais da folha entram no fingerprint. Integridade bancária e identidade ainda são obrigatórias. Conta desconhecida real bloqueia possíveis contas; múltiplas contas identificadas não são uma conta desconhecida.

A guarda de fechamento precisa usar o mesmo resolvedor se for permitir inclusão tardia dessas projeções. A exceção64942 não resolve automaticamente employee_advances/payroll_entry_items. Só mudar o classificador não basta para esse fluxo. Não mudar competência histórica silenciosamente.

## Validação executada

`finance-paid-projection-chain-model.sql` é consulta proposta, somente leitura, `$1=tenant UUID`; não RPC de produção. Executada e EXPLAIN compilado em PGlite com schemas reais da baseline e visão ativa43833, sobre helper closedPeriodLateCompositionDatabase. `src/test/financePaidProjectionChainModel.test.ts`: **3 testes passaram**:

1. Consulta completa e EXPLAIN em schemas reais, resultado vazio consistente.
2. Adiantamento paid com título exato, sem pagamento: condição monetária falsa.
3. Comando real apply_finance_payable_movement cria pagamento/vínculo; perna necessária monetária positiva, mas empregado ausente permanece explicitamente falso na identidade. Flush de constraints executado.

O campo necessary_money_conditions é deliberadamente só uma condição necessária: não é autorização de corte, não integra capacidade completa/banco/autoria e não aceita ponte de obrigação ainda não comprovada. A fixture omite FKs externos como a fixture compartilhada; o caso sem empregado demonstra que condição monetária não equivale à elegibilidade. Sem teste nativo novo nesta leitura, sem ensaio de implantação completa, sem dados remotos. Os itens de folha são examinados pela consulta, mas a rodada de três testes não prova ainda geração/reversão concorrente da folha; isso pertence à próxima implementação.
