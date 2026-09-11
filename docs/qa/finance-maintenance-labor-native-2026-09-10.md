# Mão de obra de manutenção — PostgreSQL nativo 2026-09-10

**13 testes passaram**, PostgreSQL 17.11 local descartável, execução 19717 exit 0 e servidor parado. Nenhum SQL de produto foi editado; sem remoto.

Suite: `scripts/test-finance-maintenance-labor-native-cases.mjs`; selector central `finance-maintenance-labor`. Log: `node_modules/.cache/qa-postgres/finance-maintenance-labor-native-2026-09-10.log`.

## Provas

- Replay simultâneo produz um vínculo, preservando obrigações e fornecedor cadastrado por ID. Texto livre da OS permanece diferente do cadastro: não é usado como identificação automática. Snapshot conserva parts_cost 70 enquanto reconhece apenas mão de obra 50.
- Dois pedidos para uma OS; duas OS disputando um custo; uma OS disputando dois custos: somente um vínculo ativo na identidade disputada.
- Mudança legítima da OS antes de liberar lock rejeita revisão antiga com 40001 e sem comando residual.
- Mudança de razão social do fornecedor durante espera também invalida o snapshot/revisão.
- Revogação de acesso durante espera financeira é revalidada e impede associação.
- Vínculo ativo permite editar observações operacionais, mas bloqueia labor_cost e DELETE. Após reversal permite corrigir labor_cost, mantendo snapshot antigo 50; novo custo incompatível fica explicitamente sinalizado para revisão.
- Reversal concorrendo com relink usando revisão antiga rejeita relink; nova revisão permite outro vínculo e mantém autoria/reversão no histórico.
- Custo com **5.000 centavos alocados** a movimento real: record_finance_movement + record_finance_expense_batch reais. Associação/reversal preservam integralmente movimentos, alocações e obrigações.
- Título canônico pago por **apply_finance_payable_movement real**, com recálculo de status paid e pagamento de 5.000 centavos: associação/reversal preservam títulos, pagamentos, links, movimentos e alocações preenchidos byte a byte.
- Fornecedor precisa resolver por ID no mesmo tenant. Sondagem com cadastro movido para outro tenant resulta em supplier_required; não aprova pelo nome armazenado. Motorista e tenant estrangeiro não leem contexto.
- Contexto e respostas de comando passam pelos schemas reais. Auditoria manual passa pelo financeAuditSchema e mantém ator nas decisões.

## Fixture e limites

Reutiliza baseline de custos legados e funções reais de lote, builder/folha e pagamentos. Instala integralmente readers60441/61129, core60950 e auditoria. A rota física continua vazia como na fixture de origem; não valida percurso/entrega. Grafo completo de FKs não está instalado e active_payable_payments é a projeção estreita da fixture, adequada aos pagamentos sem estorno usados aqui.

Status inicial de aprovação do título é preparado sob privilégio de QA; o pagamento e seu vínculo são comandos reais. Não simula conciliação/extrato nem testa estorno do pagamento. Mudança de tenant do fornecedor é cenário deliberado de inconsistência histórica na fixture sem FKs externas; não demonstra permissão equivalente em produção. A transferência por ID/tenant é rejeitada pelo comando testado.

Correção da OS após reversal é permitida pelo core atual, ao contrário de driver_expenses55442. Foi comunicado ao coordenador que o label da UI então dizia que desfazer não autorizava editar; a correção do texto fica fora desta frente.

Não houve medição de performance nem ensaio do schema integral. Esta prova não autoriza fechar período nem implantar sem os demais gates.

## Hashes SHA256

- 160950 core: `920a5e306cbef22499dc6b24746a6583e28d62bd0536dc15c640d7e3abc6fa76`
- 161129 reader: `4fc143c6d08ca1a1c0c429db3f4848a07b6bea1aea80387f63c928e737f895e6`
- 160441 contexto de componentes: `aa361402faf7a95a0f6ddea62d0f1107068c19e3a0ba1cab85755d0cab9d4495`
- 233625 auditoria: `4c5ffab49815e5f41e35ce68ed3321aa67bc0ac681bf491bb252c122c5303666`

Reprodução PowerShell: `$env:PG_QA_SUITE='finance-maintenance-labor'; node --experimental-strip-types scripts/test-delivery-concurrency.mjs`.
