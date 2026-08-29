# Registro de dívida estrutural

O audit de 28/08/2026 encontrou 106 arquivos TypeScript/TSX acima de 300 linhas,
57 acima de 500 e 10 acima de 1.000 (incluindo código gerado). Isso não autoriza
refatoração ampla durante o cutover; os fluxos de maior mudança são tratados
com extrações pequenas e testes de caracterização.

| Prioridade | Área | Owner de papel | Controle atual | Próxima extração |
|---|---|---|---|---|
| P1 | `OperationalEvents.tsx` | frontend operações | E2E smoke + contratos | queries e transformação de eventos |
| P1 | `Ingestion.tsx` | frontend dados | testes de parsing/ingestão | estado do fluxo e adaptadores |
| P1 | `DriverDeliveries.tsx` | mobile/driver | contratos driver + E2E | upload/POD e máquina de estado |
| P1 | `RoutePlanning.tsx` | otimização | testes puros de rota | consolidação e sugestões |
| P1 | `TeamManagement.tsx` | identidade | invite-only + MFA | formulários e serviço de membros |
| P2 | `OperationsCenter.tsx` | frontend operações | lazy chunk + smoke | queries/KPIs e cartões |
| P2 | `types.ts` gerado | dados | geração a partir do schema | não refatorar manualmente |

O workflow bloqueia warnings no conjunto `lint:critical-types`. Novos `any` ou
arquivo crítico >500 linhas exigem atualização explícita deste registro e teste
de caracterização; a direção aceita é apenas decrescente.
