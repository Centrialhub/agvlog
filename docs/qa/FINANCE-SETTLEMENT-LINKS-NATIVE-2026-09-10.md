# Vínculos de pagamentos de acerto — PostgreSQL nativo

Data: 2026-09-10. Execução local em PostgreSQL 17.11, Node 24.19.0.

## Reprodução

```powershell
$env:PG_QA_SUITE='finance-settlements'
node --experimental-strip-types scripts/test-delivery-concurrency.mjs
```

O runner cria um cluster descartável com autenticação por senha aleatória, escuta exclusivamente em loopback e porta livre, cria o banco `finance_settlement_links_qa`, executa as verificações e encerra o servidor em `finally`. O caminho `PG_QA_BIN`, quando informado, deve apontar para o runtime confiável local. Não utiliza configuração de banco da aplicação.

## Evidência

Arquivo de casos: `scripts/test-finance-settlements-native-cases.mjs`.
Log local: `node_modules/.cache/qa-postgres/finance-native-settlement-links-2026-09-10.log`.

Candidato `20260910130540_finance_settlement_movement_links.sql`, SHA256:
`a05183495df24000b81fd2976a6723df0c4700dbdf2d82b5dca679e47e1f1205`.

Oito testes passaram, processo terminou com código 0 e o runner confirmou ausência de `postmaster.pid` após `pg_ctl stop`.

| Caso | Evidência exigida |
| --- | --- |
| Acerto e movimento sem motorista | Par null/null rejeitado com `finance_settlement_payment_mismatch`, sem vínculo ou comando. |
| Mesma chave concorrente | Mesma resposta; exatamente um vínculo e um comando; movimento e pagamento originais permanecem únicos. |
| Chaves diferentes para o mesmo pagamento | Segunda chamada rejeitada com `finance_settlement_payment_already_linked`. |
| Acerto primeiro, pagável depois | Segundo uso de R$ 300 em saída de R$ 500 rejeitado; nenhum pagamento de pagável parcial persistido. |
| Pagável primeiro, acerto depois | Rejeição por capacidade; apenas vínculo do pagável usa R$ 300. |
| Acerto primeiro, gasto de viagem depois | Lote conflitante rejeitado por capacidade; apenas vínculo do acerto persiste. |
| Gasto de viagem primeiro, acerto depois | Apenas alocação do gasto persiste; vínculo do acerto rejeitado. |
| Acesso revogado durante a espera | Após revogação da associação à empresa, a chamada rejeita com `finance_access_denied`, sem vínculo, evento ou comando. |

Os casos de replay e capacidade comparam também as contagens globais de movimentos e pagamentos de acerto antes e depois e exigem zero linhas bancárias criadas. Todas as disputas usam sessões distintas e exigem que `pg_blocking_pids` identifique o processo detentor bloqueando o concorrente antes de liberar o primeiro. O intervalo de consulta de 25 ms serve apenas à observação; não substitui essa evidência por um atraso presumido.

## Limites

A fixture reproduz apenas as dependências necessárias; instala os comandos reais de ledger, lotes de despesas, vínculos de pagáveis, reversões e a migration alvo. Não é um ensaio integral da migration no schema de produção. O helper sintético `is_tenant_admin` retorna verdadeiro; estes casos exercitam a permissão financeira via associação à empresa, não a matriz completa de administradores.

Não testa renderização, extrato bancário, cálculo integral de acerto, criação de novos pagamentos, aplicação remota ou garantia de completude do módulo. A suite é optativa para evitar reexecutar todas as outras áreas; deve ser chamada explicitamente no gate antes da implantação.

A primeira execução em sandbox falhou ao iniciar `pg_ctl` devido ao token Windows (erro 87); a execução fora dessa restrição foi aprovada pelo revisor automático. Uma fixture inicial incorreta usava gasto de sede com movimento de motorista e recebeu a rejeição esperada de identidade. Foi corrigida para viagem concluída do mesmo motorista antes da execução bem-sucedida.
