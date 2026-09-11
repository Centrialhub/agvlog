# Publicação do financeiro: frontend, Edge e runtime — inspeção 2026-09-10

Somente leitura de código/configuração e relatório. Nenhum deploy, escrita de banco, TSC ou PostgreSQL iniciado. Estado de aplicação de migrations pertence ao coordenador; ausência observada em auditorias anteriores não é tomada como estado remoto atual.

## Destino e artefato

`supabase/config.toml` identifica `qcvnsdrbcchaxvawcngk`; isso é a configuração do checkout, que precisa coincidir com o destino confirmado pelo coordenador. `.vercel/project.json` não está disponível: organização/projeto/domínio Vercel não foram comprovados nesta frente. `vercel.json` configura SPA para index.html e headers. Não contém deployment de Edge ou banco.

Frontend é Vite/React, Node22/npm10.9.4, saída de build estático. Variáveis públicas lidas: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY; release usa VITE_APP_RELEASE. Não é suficiente alterar variável hospedada depois de gerar bundle: publicar artefato construído com configuração correta. Scripts existentes: `npm run build:check` (build + orçamento + inspeção artefato), `npm run smoke:deploy` (alvo obrigatório). Não os executei nesta inspeção.

O runbook existente descreve banco→Edge→frontend→smoke. Workflow quality valida instalação local; release-candidate verifica URL já publicada, não publica banco/Edge. O candidato hospedado de E2E depende de ambiente isolado e contas seed: não disparar jornadas destrutivas de staging contra produção por confundir essas configurações.

## Edge mínimo indispensável

1. `secure-upload`: comprovantes de gastos/movimentos e originais de extrato. JWT ativo em config.toml; autenticação/capacidade tenant e paths validados. Imports pinados em deno.json. Necessita SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY no runtime e scanner externo funcional.
2. `finance-statement-verify`: acionada pelo cliente após intake; não é cron permanente. Baixa original de finance-statements, compara hash e linhas, interpreta OFX/CSV/XLS/XLSX e grava verificação através de RPC restrita. Dependencies: inspect_finance_statement_source, get_finance_access, record_finance_statement_verification, policies de leitura do original. Deno imports incluem supabase-js2.108.2 e SheetJS0.20.3 + cpexcel. Não basta publicar index.ts sem dependências/shared.
3. Funções fiscais já existentes (hub-fiscal-proxy e demais integrações) permanecem dependências do processo emissor, não são substituídas pela fila financeira SQL. Manter capability/kill switches reais; não habilitar fiscal/SSX apenas para fazer o financeiro parecer disponível.

CLI local2.116.0 help confirma comando de publicação por nome e `--project-ref`/`--use-api`. Comando a ser executado pelo responsável, após confirmar destino, é `supabase functions deploy secure-upload finance-statement-verify --project-ref qcvnsdrbcchaxvawcngk --use-api`. Não foi executado. Não usar --prune nem --no-verify-jwt. Outros bundles alterados do candidato exigem inventário do release, não inferir que esses dois substituem publicação completa do app.

## Bloqueios que sobrevivem a migrations bem-sucedidas

- **Scanner**: secure-upload exige MALWARE_SCANNER_URL HTTPS e MALWARE_SCANNER_TOKEN; faz POST multipart, timeout20s, requer JSON clean:true. Sem configuração/saúde, falha fechado e comprovante/extrato não é gravado. Não consultei valores secretos.
- **CORS**: `_shared/cors.ts` padrão é https://agvlog.lovable.app; domínio Vercel diferente precisa AGVLOG_APP_ORIGIN exato. Verificar preflight com x-agvlog-tenant-id, autorização e apikey no domínio publicado.
- **Storage**: finance-statements privado10MiB; receipts com limites/MIME e tenant policies. SignedURLs são emitidas por usuário autorizado. Conferir upload→leitura autorizada→negação tenantB. Buckets/policies não são criados pelo frontend.
- **Crons**: migrations registram jobs somente se cron.schedule existir. Assim migrationpassada não comprova worker ativo. Confirmar finance-fiscal-projection-every-minute (run_fiscal_queue50) e finance-bank-reconciliation-every-minute (run_automatic_reconciliation_queue), frequência1min, timeout25s. Bootstraps existentes: supabase/bootstrap/finance_fiscal_worker.sql e finance_bank_reconciliation.sql; aplicação fica com coordenador após confirmar catálogo, não executar duplicadamente por suposição.
- **Atualização cliente**: main.tsx registra /sw.js em produção e anuncia atualização. Testar sessão já aberta/PWA e novo login recebendo o mesmo release; não limpar outboxes para forçar atualização.
- **Acesso**: can_accessfalse durante implantação é correto. Liberar exige respostas reais dos readers/writers e isolamento motorista/misto. Erro PGRST202/42883 de acesso agora mantém menu e informa indisponibilidade, sem fallback.

## Checklist verificável de disponibilidade

- Identidade do Supabase e projeto/domínio frontend confirmados; release/SHA registrado.
- Migrations/postconditions concluídas pelo coordenador; get_finance_access responde corretamente para operador e nega driver/misto.
- Bundles Edge do mesmo candidato publicados, logs sem falha de import; JWT/CORS testados no domínio final.
- Scanner limpo, limite/rejeição e upload de original funcional; buckets privados e negação cross-tenant verificados.
- Crons presentes/ativos e execução recente sem erro; filas fiscal/conciliação avançam, revisão humana fica visível quando necessária.
- Frontend build aprovado com URL/chave pública corretas; deep links /financial/movements, /financial/recorded-expenses e /financial/statements retornam SPA, sem .map público.
- Piloto saída500/gastos480/extrato identifica saldo20 sem criar segundo pagamento; verificação original e conciliação reais; recibos recuperáveis.
- Smoke de domínio/headers e sessão/PWA no release correto; erros de RPC não viram lista vazia ou saldo0.

## Limites e fontes

Inspeção não comprovou secrets remotos, scanner ativo, jobs remotos, upload real, projeto Vercel ou release atualmente servido. Nenhum AGENTS.md foi encontrado pela busca em arquivos do checkout nesta etapa. Skills Supabase/deployments-cicd lidas. Documentação oficial Vercel consultada: https://vercel.com/docs/deployments. Changelog Supabase markdown não pôde ser lido pelo navegador (content-type não suportado); não houve implementação de API nova baseada nessa ausência. Sintaxe Supabase foi conferida no --help local.

## Descoberta remota posterior — destino confirmado

Consultas somente leitura Vercel list_teams/list_projects/get_project/list_deployments/get_deployment em10/09:
- Team centrialhubs-projects: team_XlojJB7ssbSr7EvBetvDMD8b.
- Projeto agvlogistica: prj_oQHCFCnDYiY6qrYXvh18U2ECNCVb; GitHub Centrialhub/agvlog, frameworkVite.
- Alias **https://agvlogistica.vercel.app** resolvido pela própria API para dpl_CbmB1EYSMfBQHDso74gTkUgGsRX7, targetproduction, READY, sourcegit/main, SHA b9af33dfc37b32ef3654feba62ff6041a4507151, aliasErrornull. URL imutável agvlogistica-7xa9aftm3-centrialhubs-projects.vercel.app. HTTP HEAD /auth respondeu200, ServerVercel e x-vercel-id presente. ConsultaDNS não trouxe CNAME útil; não foi usada como prova do alias.
- Outros aliases do mesmo deployment: agvlogistica-centrialhubs-projects.vercel.app e agvlogistica-git-main-centrialhubs-projects.vercel.app. A origem de produção preferida coincide com os relatórios anteriores: agvlogistica.vercel.app.
- Setting de projeto nodeVersion24.x difere engineslocal >=22<23; conferir versão efetiva do build candidato e alinhar configuração. Não foi alterada.

## Presença de secrets — nomes somente

CLI `supabase secrets list --project-ref qcvnsdrbcchaxvawcngk --output json` executada com sucesso; saída foi filtrada em memória para nomes permitidos, sem imprimir valores ou hashes.

Presentes: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
Ausentes na listagem observada: MALWARE_SCANNER_URL, MALWARE_SCANNER_TOKEN, AGVLOG_APP_ORIGIN.

Isso torna o scanner uma dependência pendente concreta e o default CORS Lovable incompatível com o domínio Vercel quando publicar o código atual. O coordenador é proprietário das alterações de configuração.

Busca de implementação scanner no checkout encontrou apenas scannerAccepts em secure-upload e testes de rejeição. Não há servidor ClamAV/clamd, container/serviço de scan pronto nem handler que produza clean:true. Não é possível afirmar que existe alternativa implantável sem custo externo a partir do código atual. Nenhum scanner foi criado nem proteção desabilitada nesta inspeção.

## Viabilidade do scanner e Node — documentação oficial

Não existe serviço scanner implantável no checkout. Para ClamAV com base padrão, a documentação recomenda mínimo3GiB de RAM; Edge Supabase tem limite256MB. Vercel Functions limita corpo a4.5MB, abaixo dos10MiB aceitos pelo gateway. Portanto não é um simples novo endpoint no stack atual capaz de manter o contrato completo.

Solução mínima identificada: host/container persistente com memória compatível (3GiB mínimo recomendado; dimensionar margem, por exemplo4GiB), cerca5GiB livres, ClamAV/freshclam, wrapper HTTPS aceitando multipart e Bearer e respondendo clean:true somente após scan concluído. Ajustar limites de arquivo/concorrência, timeout do gateway20s, atualização de assinaturas e disponibilidade. Isso exige infraestrutura adicional ou host já disponível; não implica contratar fornecedor de API, mas também não é gratuito por definição. Nada foi criado, contratado ou enviado a scanner nesta frente.

Fontes: [ClamAV Docker](https://docs.clamav.net/manual/Installing/Docker.html), [requisitos ClamAV](https://docs.clamav.net/Introduction.html), [limites Edge Supabase](https://supabase.com/docs/guides/functions/limits), [limites Vercel Functions](https://vercel.com/docs/functions/limitations).

Precisão sobre Node: a diferença setting24.x/engines22 NÃO comprova bloqueio. [Vercel documenta que engines em package.json sobrescreve Project Settings](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions); o range >=22<23 do candidato deve selecionar22 suportado. Recomendo manter engine validado e comprovar Node efetivo no log do build, sem alterar para24 apenas para coincidir com o painel.
