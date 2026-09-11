# Evidências de saldo e período — candidato local

Escopo entregue: consulta separada das declarações de período e saldos contábeis em OFX, incorporada à conferência por conta, e registro durável de revisão humana. Nada aplicado remotamente.

## Evidências consideradas

- A última verificação de cada importação deve conferir linhas/hash e identidade nativa. A conta precisa corresponder exatamente ao cadastro, sem ambiguidade. A consulta reaproveita `native_statement_account` para essas condições.
- Declarações de dias inteiros exigem início 00:00:00, término 23:59:59 e fuso explícito consistente. Formatos sem precisão suficiente não preenchem automaticamente lacunas. O intervalo é uma declaração do arquivo, não confirmação de completude.
- Abertura usa o saldo contábil informado às 23:59:59 do dia anterior; encerramento usa o saldo contábil informado às 23:59:59 do último dia. Não se usa saldo disponível, data sem horário, horário intermediário nem saldo derivado da própria soma como âncora independente.
- Valores conflitantes para a mesma âncora ficam explícitos; fusos incompatíveis bloqueiam a comparação. A diferença usa centavos e transações bancárias identificadas/ativas com sinal. Não soma movimentos internos ao extrato.
- `source_evidence` preserva **todos os IDs de importação/verificação, hashes e metadados nativos** consultados, inclusive os períodos usados para lacunas, além da lista de âncoras. Esses dados participam da revisão hash e são gravados no snapshot imutável. Uma verificação diferente altera a revisão mesmo se seus valores forem iguais.

## Revisão humana

`record_finance_period_evidence_review` grava responsável, motivo, conta, período e snapshot imutável; publica evento `period_evidence_reviewed`. O comando exige a revisão consultada e usa `finance_commands` para replay exato. Alteração de evidência antes de um pedido novo exige nova consulta; repetição de pedido já concluído devolve o resultado anterior. Drivers e perfis mistos ficam bloqueados pela mesma regra financeira.

A tela persiste o pedido em sessionStorage antes do envio e permite retomá-lo após resposta perdida. Pedido local corrompido fica preservado e bloqueia novos envios; validação não deixa o botão travado. Registrar a revisão não confirma cobertura nem concilia movimentos e nunca fecha o período.

## Verificação

- `npx vitest run src/test/financePeriodEvidence.test.ts src/test/periodEvidenceReview.test.tsx src/test/accountPeriodReview.test.tsx`: **17 testes passaram** (11 SQL em PGlite, 4 da nova UI, 2 de integração da tela existente).
- Lint dos cinco arquivos TypeScript/TSX próprios: passou.
- TypeScript global: inicialmente corrigidos os dois usos de `replaceAll` no teste próprio; execução seguinte não indicou erros nesta frente, mas falhou nos testes concorrentes `activeTenantRequest.test.ts` e `authClientConfiguration.test.ts` (tipagem do mock). Coordenação avisada; não foram editados aqui.
- Fixture de SQL usa migrations reais de intake, source verification, OFX, native account e esta migration, com tabelas básicas de dependência. Relatórios nativos são inseridos como evidência de worker na fixture; este teste não valida de novo o parser nem garante integração completa com produção.
- Não houve browser real, PostgreSQL nativo, migração de produção ou implantação.

## Pendências que continuam bloqueando fechamento

`can_close` permanece sempre falso e `coverage_status=requires_review`. Esta entrega **não** prova autenticidade do arquivo, ausência de omissões, cobertura efetiva do banco, reconciliação individual de movimentos, integração histórica, controles bancários independentes de contagem/totais, saldo do caixa físico ou fechamento congelado.

Precisam de implementação/homologação: outros formatos e evidências manuais de abertura com comprovantes, semântica dos limites e precisão dos extratos reais dos bancos, atestação de cobertura, verificação de controles externos disponíveis, saneamento do legado, pacote definitivo e reabertura auditada do fechamento. OFX que usa datas sem hora/fuso fica incompleto nesta conferência, mesmo que seus totais coincidam.

## Arquivos

- `supabase/migrations/20260910130956_finance_statement_period_evidence.sql`
- `src/lib/financial/periodEvidenceClient.ts`
- `src/components/financial/PeriodEvidenceReview.tsx`
- `src/components/financial/AccountPeriodReview.tsx` (integração pequena)
- `src/test/financePeriodEvidence.test.ts`
- `src/test/periodEvidenceReview.test.tsx`

A coordenação adicionou o rótulo de `period_evidence_reviewed` em `financeAuditContract.ts`. A migration desta frente inclui a ação na classificação e no filtro de intervenções manuais da auditoria.
