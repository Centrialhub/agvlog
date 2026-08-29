# Matriz de prontidão do release candidate — 28/08/2026

## Decisão atual

**NO-GO até obtenção das evidências externas.** O pacote local e os workflows
necessários foram implementados, mas este checkout não possui Docker, `psql`,
repositório Git, credenciais Supabase de staging, URL/chave do candidato nem
scanner antimalware. Portanto não é possível transformar os testes definidos em
evidência executada de banco/E2E hospedado, restore, DAST, alertas, rollback e
soak.

Estados usados abaixo:

- **Local aprovado:** gate executado neste host e aprovado.
- **Pronto para CI:** implementação e teste existem, mas precisam do stack
  Supabase descartável ou do candidato hospedado.
- **Externo pendente:** depende de ambiente, autoridade ou janela operacional.
- **Controlado:** dívida remanescente tem teste/baseline, owner e prioridade.

## Cobertura das ondas e PRs

| PR | Estado | Evidência implementada | Evidência ainda necessária |
|---|---|---|---|
| 001 Capacidades por tenant | Local aprovado | Migrações, UI, Edge e crons usam políticas por tenant e falham fechados | Confirmar comportamento no projeto hospedado correto |
| 002 Auth hospedado | Pronto para CI | Signup desativado na config, convite one-time no banco, limites, senha de 12 caracteres e TOTP/AAL2 | Conferir painel/Auth hospedado, redirects, leaked-password e MFA real |
| 003 Toolchain | Local aprovado | Node 22, npm 10.9.4, `package-lock.json` único e lockfile gate | Rodar a mesma instalação congelada no SHA candidato |
| 010 Staging isolado | Externo pendente | Workflow recusa produção por padrão e aceita staging apenas com opt-in explícito | Criar/identificar staging, secrets e domínio isolados |
| 011 Seed E2E | Pronto para CI | Tenants A/B, cinco papéis e 126 clientes, veículos, rotas, documentos e cargas do tenant A | Executar `supabase db reset --local` |
| 012 Reset/teardown | Pronto para CI | Reset único no workflow, IDs determinísticos e teardown `--no-backup` | Provar execução idempotente no runner com Docker |
| 020 Base Playwright | Local aprovado | 75 casos descobertos em desktop, tablet 768×1024 e mobile 390×844; traces, screenshots e vídeos de falha | Executar navegadores contra stack descartável |
| 021 Auth/autorização | Pronto para CI | Papéis, redirect, logout, troca de tenant, MFA boundary e pgTAP de convite/nonce/reuse | Homologar convite recebido e MFA no Auth hospedado |
| 022 Cargas/operação | Pronto para CI | Carga/item/status/totais/auditoria em RPCs; pgTAP planeja rota, atribui motorista e inicia viagem | Execução verde do pgTAP/E2E no mesmo candidato |
| 023 Motorista | Pronto para CI | Início, chegada, checklist, despesa, ocorrência, finalização, POD, reload e erro/retry | Executar em navegador mobile e aparelho Android de referência |
| 024 Portal cliente | Pronto para CI | Dez rotas, escopo/IDOR, erro de RPC com retry e neutralização de CSV | Validar download assinado real e homologação do papel cliente |
| 025 Administração/smoke | Pronto para CI | Registry completo de rotas, lazy chunks, aliases, 404 e limites por papel | Executar smoke no preview imutável |
| 030 RLS/RPC real | Pronto para CI | 63 contratos pgTAP com tenant A/B, RPCs, convite, quota e paginação | Executar no PostgreSQL descartável |
| 031 Migração/drift | Externo pendente | Baseline vazio e `db lint` estão no CI; migrações são forward-only | Gerar/diferençar tipos e schema com staging/produção e rodar advisors |
| 032 Upload/conteúdo | Pronto para CI | Gateway único, autorização, assinatura binária, quota atômica e scanner obrigatório | Configurar scanner HTTPS e comprovar rejeição EICAR/download expirado |
| 033 Backup/desastre | Externo pendente | Procedimento e critérios estão no runbook | Restore/PITR real com RPO/RTO medidos |
| 034 Segurança publicada | Externo pendente | CSP/HSTS e demais headers estão versionados; artefato sem source maps/secrets | Validar domínio final, TLS, headers, DAST e vazamento de sourcemap |
| 040 Telemetria | Local aprovado | Exceções e Web Vitals com release, correlation ID, allowlist, rate limit e retenção | Provar recepção/consulta em staging |
| 041 Alertas/SLO | Externo pendente | SLOs, thresholds e roteiro sintético documentados | Receber alerta real e anexar incidente/evidência |
| 042 Runbook/rollback | Externo pendente | Deploy, incidente, rollback e forward-fix documentados | Ensaio de rollback frontend/Edge no artefato candidato |
| 050 Estados de tela | Pronto para CI | Erro/retry explícito em cargas, motorista, clientes, documentos e portal; smoke impede fallback fatal | Homologação abrangente de empty/loading/permission denied |
| 051 Paginação/volume | Pronto para CI | Clientes, documentos e cargas paginam no servidor; contagens/agregados sob RLS; busca debounced e filtros persistentes | Executar massa do seed e planos de execução no PostgreSQL real |
| 052 Acessibilidade | Pronto para CI | Axe WCAG A/AA em auth e workspaces críticos dos três papéis; nomes acessíveis corrigidos nos fluxos alterados | Rodar axe, teclado, foco, contraste e corrigir qualquer achado runtime |
| 053 Responsividade | Pronto para CI | Projetos desktop/tablet/mobile e cobertura de workspaces críticos | Homologação de overflow/alvos de toque e Android de referência |
| 054 Performance | Local aprovado | Web Vitals, lazy loading e budget; maior chunk 488,3 KiB sob teto de 500 KiB | Medir p50/p95 e budgets por rota durante soak |
| 060 Refatoração crítica | Controlado | Fluxos críticos estão cercados por contratos, smoke e baseline; upload/POD foi extraído do fluxo motorista | Extrações incrementais registradas no debt register, sem refatoração cosmética no cutover |
| 061 Tipagem/lint | Local aprovado | `any` caiu para 113, lint crítico tem zero warning e baseline impede regressão | Regenerar tipos Supabase do ambiente autoritativo |
| 062 Complexidade | Local aprovado | Nenhum novo arquivo crítico >500 linhas; validadores/mapeadores extraídos e testados | Continuar redução decrescente após o release |
| 070 Pipeline | Local aprovado | Workflows executam install, audit, tipos, lint, cobertura, Edge, banco, pgTAP, build, três viewports, repetição crítica e artefatos | Obter execução verde no SHA candidato |
| 071 Promoção | Pronto para CI | Workflow exige URL e release ID imutáveis e separa quality de release candidate | Conectar preview/staging e registrar promoção/rollback reais |
| 072 Release candidate | Externo pendente | Checklist/evidence register pronto | Três execuções críticas, smoke pós-deploy, soak 48–72 h e go/no-go formal |

## Resultado do gate local

- `npm run check`: aprovado.
- 57 arquivos e 468 testes: aprovados.
- Cobertura: 92,61% statements/lines, 61,76% branches e 81,81% functions.
- TypeScript, lint de erros, lint crítico e baseline estrutural: aprovados.
- Edge syntax: 39/39 arquivos.
- Build, budget e inspeção do artefato público: aprovados.
- Auditoria npm: 0 vulnerabilidades em todos os níveis.
- Playwright: 75 casos descobertos em seis arquivos.
- pgTAP: 63 contratos definidos, não executados neste host.

## Condições mínimas para mudar para GO

1. Executar `database-and-e2e` verde no mesmo SHA/artefato candidato.
2. Executar `release-candidate.yml` verde no preview imutável.
3. Anexar validação de Auth hospedado, scanner/EICAR, headers/DAST e tipos/drift.
4. Anexar restore com RPO/RTO, alerta sintético e rollback ensaiado.
5. Concluir homologação dos quatro papéis e soak de 48–72 horas dentro dos SLOs.
6. Registrar a decisão formal de produto + engenharia.
