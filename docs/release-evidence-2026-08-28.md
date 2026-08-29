# Evidência do release candidate — 28/08/2026

Este arquivo separa implementação verificável de validações que exigem ambiente
ou autoridade externa. Um item “pendente” não pode ser convertido em aprovação
por documentação.

## Evidência local/CI implementada

- npm 10.9.4, Node 22 e `package-lock.json` único; auditoria atual sem
  vulnerabilidade conhecida.
- Flags/kill switches SSX e fiscal, UI explícita, Edge fail-closed e crons
  condicionais.
- Auth invite-only em código, política de senha/sessão e gate TOTP/AAL2 de
  owner/admin com migração forward-only.
- Seed local idempotente com tenants A/B, cinco papéis, dados canônicos e IDs
  previsíveis; Playwright recusa backend não local sem autorização explícita.
- 57 arquivos/468 testes aprovados; cobertura crítica: 92,61% statements,
  61,76% branches, 81,81% functions e 92,61% lines.
- Typecheck, lint sem erros, lint crítico e build/budget aprovados localmente.
- 75 casos Playwright desktop/tablet/mobile descobertos (registry e mutações
  compartilhadas rodam apenas no desktop); cobrem rotas, papéis, IDOR, axe nos
  workspaces críticos, mutações canônicas de carga, ciclo do motorista com
  checklist/despesa/ocorrência/POD, portal, retry e paginação persistente.
  O CI executa banco vazio, baseline, 63 contratos pgTAP, E2E e repetição tripla
  de `@critical` com artefatos de falha.
- Seed com 126 clientes, veículos, rotas, documentos e cargas visíveis no tenant
  A. Clientes, documentos e cargas usam paginação server-side; busca é debounced,
  filtros são persistidos e agregações fiscais permanecem no banco sob RLS.
- Coletor de exceções autenticado com correlation ID, allowlist de campos,
  fingerprints, rate limit e retenção de 30 dias.
- Uploads graváveis somente pelo gateway autenticado, com autorização de
  tenant/papel, AAL2 privilegiado, assinatura binária, scanner antimalware
  obrigatório e quota atômica persistente por ator.

O host local desta execução não possui Docker/PostgreSQL. Por isso, descoberta
Playwright, contratos estáticos, unitários e build foram executados localmente;
`db reset`, pgTAP e os navegadores contra o banco descartável são evidência
obrigatória do job `database-and-e2e`, não uma aprovação local presumida.

## Bloqueios externos de go-live

| Evidência | Responsável | Estado |
|---|---|---|
| Staging Supabase hospedado e isolado com secrets próprios | Engenharia/infra | Pendente |
| `disable_signup`, senha vazada, redirects e MFA conferidos no projeto correto | Admin Supabase | Pendente |
| Pipeline `database-and-e2e` verde no commit candidato | Engenharia | Pendente |
| Advisors/drift/tipos comparados com staging e produção | Responsável de dados | Pendente |
| Restore/PITR ensaiado, com RPO/RTO medidos | Responsável de dados | Pendente |
| Scanner antimalware HTTPS configurado e arquivo EICAR rejeitado | Segurança/infra | Pendente |
| Headers/CSP/DAST/sourcemaps no domínio final | Segurança/engenharia | Pendente |
| Alerta sintético recebido e runbook seguido | On-call | Pendente |
| Rollback frontend/Edge ensaiado sem rebuild | Engenharia | Pendente |
| Homologação dos quatro papéis e acessibilidade móvel | QA/produto | Pendente |
| Soak de 48–72 h dentro dos SLOs | Produto/on-call | Pendente |
| Decisão formal go/no-go | Produto + engenharia | Pendente |

## Registro de execução

Para cada linha, anexar commit, ambiente/projeto, início/fim, executor, comando ou
roteiro, resultado, artefato e incidente associado. Qualquer P0/P1 reinicia a
janela de soak após a correção.
