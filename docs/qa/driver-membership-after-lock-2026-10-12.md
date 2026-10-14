# Revalidação após o lock de jornada — 2026-10-12

Candidato local separado, sobre `59a048bbf21e6b19d9e4003b0c6736c8e46baab3`, congelado pelo coordenador. Task `driver-membership-after-lock-20261012`, owner `CodexDriverAfterLock`. Nenhuma integração, publicação, conta ou infraestrutura compartilhada foi alterada.

## Evidência e correção

A revisão independente encontrou uma janela entre a descoberta do tenant e a releitura da viagem após o advisory lock. O candidato anterior validava membership antes da espera, mas podia devolver a viagem relida sob outro tenant sem repetir essa validação. O teste reproduz isso substituindo **somente** a chamada de advisory lock por uma mudança sintética da viagem para um tenant sem membership ativo. No predecessor, `driver_create_event` grava o evento nesse tenant; após o forward, recebe `42501 / driver_journey_context_changed` e a transação não deixa novos efeitos.

O forward `20261012221129_revalidate_driver_membership_after_journey_lock.sql` salva o tenant descoberto; depois da releitura e da checagem de propriedade, exige tenant idêntico e chama novamente `private.require_driver_operation_membership_v1`. Mudança para outro tenant também é negada quando ambos estão ativos: o advisory lock adquirido pertence ao tenant original. Uma solicitação direta para a viagem válida da outra operação continua funcionando.

Somente `public._lock_driver_journey_trip(uuid)` muda. MD5 do corpo: `a4fcca8c7b8d3f8a1aa92036e424dff4` → `82b1c6bb20a2135f513f813f9b15c2e8`. O forward valida o helper privado (`094c0e69e6b4c861e2d4b607a427bb23`), owner/SECURITY DEFINER/search_path e ausência de EXECUTE nas roles de API. Preserva toda metadata do helper alterado, é idempotente e recusa predecessor desconhecido. Não cria novo código 40001, grants, roles, RLS ou DML.

## Validação e limites

`driverMembershipAfterLock.test.ts`: **6/6 PASS**, 14,90 s, PGlite com schema parcial e claims sintéticos. Casos: contraprova antes/depois, troca de motorista, membership desativada na fronteira, troca para tenant ativo, operações ordinárias sem adapter, metadata/ACL/idempotência/drift. Lint e TypeScript direcionados aprovados. Node local 24.19, diferente do baseline esperado 22.

A fronteira injetada não é concorrência real de duas sessões. Aceitação Native permanece pendente: bloqueios NOWAIT, ordem de locks, mudança concorrente de tenant/atribuição e suspensão concorrente. Preserva as demais ressalvas de `59a048bb`, incluindo upload já iniciado e reconciliação live dos demais corpos. A revisão original está em `C:/Users/Thomaz/Documents/Codex/2026-10-01/task-2/driver-operational-59a048bb-review-20261012/REVIEW.md`, selo `f41550e7978fcf5aa48ef15d8f0e00b67b54339bdd58cbdb2a096e34ac4cd499`.

Aplicação futura depende do pacote operacional `59a048bb`, revisão independente e gate da árvore combinada pelo integrador. Este relatório não aprova publicação.
