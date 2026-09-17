# Revisão independente da ativação final — 2026-09-11

Nenhuma ativação, alteração remota, job ou PG nativo executado.30716 permanece com sentinel desarmado.

## Consultas finais

finance-final-runtime-readiness-2026-09-11.sql confere funções/ACL/hash, readiness real, guarda cargo+movimentos ativos e lista exclusões do sweep. finance-final-cron-readiness-2026-09-11.sql consulta os dois jobs e últimos resultados. Complementam o manifesto AST de RPCs, scope-preflight e catalog-checkpoint existentes; não autorizam aplicação.

## Ordem validada

financeFinalCargoOrderingIntegration.test.ts:1 PASS/3,98s, lint0.211800(d961453fa8c1839ce1d481dc7cc4f45621c96e46d9d61ff7a9494657bde2ad27),213156(68a7b3d136871db47094bfa170b62c6abef78f2acc1fcfffd12d12a66ecd9d4c),220847(e43bad1fcf218eb51b2feba659e8a119ddce40be066afb483cf05d1e230b0ee6) inteiras ANTES190516. Depois toda cadeia190516 até212550 instalou com readiness final true/missing[]. Sem rebaseline posterior. A ordem anterior invalidaria fingerprint pois211800 altera expense_options. Patches205941/211156/212550 não invalidaram o fingerprint nesta ordem.

Fixture acrescentou somente trip_cargo_controls DDL real142606, request_tenant_id real140823 e reader baseline list_driver_settlements ANTES235237. Quarentena213156 examinou histórico vazio nessa fixture; não prova volume/impacto do histórico remoto.224136/30716 têm testes próprios anteriores e não foram aplicadas neste ensaio.

## Limites concretos de30716

Sweep cobre tabelas públicas selecionadas com tenant_id UUID; views, privados e linhas que herdam tenant pelo pai ficam fora. SELECT de exclusões exige revisão por objeto. Policies restrictive não controlam owner/SECURITY DEFINER; RPCs precisam sua cadeia de autorização e reauth após espera. Pistas textuais do SELECT de funções não são prova automática de enforcement.

Checkpoint cobre seis schemas, mas não storage nem cron. Readiness confere presença de triggers de retenção, não todos grants/policies/buckets/endpoints hospedados. Verificar storage/gateway à parte. Can_accessfalse não pausa workers SECURITY DEFINER.30716 não retoma jobs.

## Cron

Jobs exatos: finance-fiscal-projection-every-minute, comando SET statement_timeout='25s'; SELECT finance_private.run_fiscal_queue(50); e finance-bank-reconciliation-every-minute, comando SET statement_timeout='25s'; SELECT finance_private.run_automatic_reconciliation_queue(); frequência por minuto. Conferir uma única definição por nome, activefalse durante rollout, corpo/ACL final dos workers, contagem agregada de pendências e erros antes de retomada separada. A fila fiscal projeta observações, não emite documentos, mas pode criar/reverter títulos antigos ao retomar. Não usar emissão fiscal como smoke. Observar primeira execução e retries antes de declarar automação pronta.

## Core sem scanner

Manter fail-closed de secure-upload. Contas, movimentos registrados, pagar/receber, folha, consultas e baixas sem novo arquivo podem funcionar. Custo sem comprovante somente com justificativa verdadeira e pendência visível pelo fluxo existente; não orientar usuário a dizer que não há comprovante quando apenas upload está indisponível. Objetos já verificados podem ser usados segundo permissões/retenção.

Novos extratos/comprovantes seguem bloqueados sem scanner. Não anunciar conciliação por upload e fechamento bancário sem evidência suficiente. Caixa por contagem tem prova própria; não inventar extrato. Nenhum scanned:true fabricado, fingerprint removido ou evidência aprovada para contornar infraestrutura. Disponibilizar core com limitações explícitas e uploads indisponíveis é uma opção; fornecer serviço real depois. Quarentena/CDR exigem implementação nova, não são configuração já pronta.

## Bloqueios não provados pelo ensaio

Claims assinados hospedados e seleção de empresa no browser, EICAR real, disponibilidade do scanner, storage/CORS hospedados, concorrência completa após mudanças operacionais, grants service-role necessários aos jobs e histórico real de quarentena. Teste CORS não prova scanner. Não armar checkpoint com hash de fixture nem inferir prontidão pela maior versão aplicada. Reexecutar SELECTs no catálogo final real.
