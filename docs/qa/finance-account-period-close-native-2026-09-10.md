# Fechamento bancário integrado — ensaio PostgreSQL nativo

**9 casos aprovados em PostgreSQL 17.11**, 2026-09-10. Handle final 75129 exit 0; servidor descartável parado. Runner `PG_QA_SUITE=finance-account-period-close node --experimental-strip-types scripts/test-delivery-concurrency.mjs`; casos próprios em `scripts/test-finance-account-period-close-native-cases.mjs`. Log `node_modules/.cache/qa-postgres/finance-account-period-close-native-2026-09-10.log`.

O harness instala o classificador B, produtor de snapshot, comandos de fechamento/reabertura, guards, retenção real de Storage e comando/guard de composição tardia. Não substitui funções de elegibilidade, classificador, capacidade ou guards por valores fixos. Extração de schemas e funções é explícita nas fixtures compartilhadas.

Fluxo positivo executado: abertura de 10000 centavos, entrada registrada de 1000 e saída de 500, ambas presentes no extrato e conciliadas por comando real; saldo final 10500. Após fechamento, snapshot/dependências são comparados pelo reader64923 e parser real. Mês seguinte preserva a âncora e exige contiguidade.

Provas de concorrência executadas: fechar versus novo movimento retroativo; revisão versus fechamento; replay simultâneo de fechamento e reabertura; revogação durante espera; duas baixas tardias competindo pela mesma saída já congelada; pagamento sem vínculo ou conta estrangeira rejeitado no flush de constraint; fechamento seguinte impede reabertura do predecessor.

Limites da fixture: baseline monetário e SQL de produto reais, sem grafo inteiro de FKs e plataforma Supabase. Linhas de extrato/verificações são evidência sintética instalada em tabelas reais, não atestação de autenticidade de arquivo externo. A retenção está instalada de verdade, mas não se testa aqui o serviço HTTP Storage. A baixa tardia pagável usa comando real. A cadeia de recebimento tardio é escrita atomicamente nas tabelas reais para testar a constraint final; não equivale a chamar o fluxo fiscal completo de recebimento. O teste separado financeLegacyCutCorrectionIntegration usa receive/correction/receive reais para a regra de reatribuição monetária.

## Hashes da execução final

- 62807 foundation: 4dd0e61229f86c1826b50f945cceaad12ee2233188dfa0913522969ceccd9b29.
- 62958 snapshot: fc425b1e8b9e6ee22a04603bf2b86de1375ecc390512a847092c8267e8ff152c.
- 63109 guards: 10a3e77207b379485e3ce4e1016ebd826c6ec83bb3e2316db218c5e5a40bc4bc.
- 63116 classificador: 6baa25c2e21533aae152f6c61fbda8ecb891541888b133f2c325dd546bc21e0d.
- 64923 evidência: 882ed7914eb25e877f1ccbddc0930bd0473868002ea3b76140b9d05cd59eecae.
- 64942 composição tardia: 8909c59453111cdd2ca6d001f49707926c032c26a466a59adf3c5745e1c748e7.

As constraints deferred foram verificadas no commit ou explicitamente com SET CONSTRAINTS ALL IMMEDIATE. Sem vínculo e conta estrangeira não deixaram pagamentos residuais. Duas baixas reais disputando a saída de 500 centavos preservaram uma única baixa; segunda rejeitada finance_movement_overallocated. Primeiro handle81598 encerrou no teste porque a asserção esperava outro nome de erro; apenas regex do harness foi corrigida. Nenhuma alteração SQL foi necessária.

Ampliações posteriores do classificador exigem nova validação e não são retroativamente cobertas por estes hashes.
