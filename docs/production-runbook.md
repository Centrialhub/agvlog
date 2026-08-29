# Runbook de produção

Este runbook descreve o contrato do release atual. SSX e emissão fiscal ficam
fora do SLA inicial e devem permanecer com `*_enabled=false`; os kill switches
são controles independentes e nunca devem ser usados para simular sucesso.

## Pré-deploy

1. Use Node 22 e npm 10.9.4. Execute `npm ci`, `npm audit --audit-level=high`
   e `npm run check` em checkout limpo.
2. Aguarde o job `database-and-e2e`: banco vazio, seed, baseline, pgTAP, E2E
   desktop/tablet/mobile e repetição tripla dos cenários críticos.
3. Gere um identificador imutável de release (SHA/versão) e injete-o como
   `VITE_APP_RELEASE`. Preserve o artefato aprovado para rollback sem rebuild.
4. Aplique migrações primeiro em staging isolado. Execute
   `supabase/verify/baseline_contract.sql`, linter/advisors e compare os tipos
   gerados. Nunca faça `db push` cego em banco populado.
5. No Auth hospedado, confirme `disable_signup=true`, senha mínima 12 com
   maiúscula/minúscula/número, proteção contra senha vazada quando contratada,
   sessão de 8 h/30 min, TOTP habilitado e redirect HTTPS exato para
   `/set-password`.
6. Teste convite expirado, nonce reutilizado, definição de senha e MFA AAL2 de
   owner/admin. Operadores, motoristas e clientes continuam em AAL1, sempre com
   RLS por tenant/papel.
7. Confirme que staging e produção usam secrets diferentes. Nenhum service role,
   token fiscal, senha SSX ou payload sensível pertence ao frontend ou ao log.
8. Configure `MALWARE_SCANNER_URL` HTTPS e `MALWARE_SCANNER_TOKEN` no cofre das
   Edge Functions. O gateway falha fechado, não grava arquivos sem scan limpo
   e limita uploads a 10/min e limpezas a 30/min por ator, de forma atômica.
9. Confirme backup/PITR, retenção e o último ensaio de restauração aprovado.

## Ordem de publicação

1. Mantenha SSX/fiscal desativados em `tenant_feature_policy`.
2. Publique as migrações forward-only e verifique as postconditions.
3. Publique Edge Functions do mesmo commit; funções de usuário usam JWT e
   webhooks/crons validam secret próprio.
4. Publique o artefato frontend já aprovado, sem source maps públicos.
5. Execute o smoke no domínio final e registre os links/horários no relatório
   de evidência.
6. Abra tráfego somente depois da aprovação go/no-go.

## Smoke pós-deploy

- Signup público retorna rejeição e não cria usuário.
- Owner/admin chega ao MFA; operador, motorista e cliente chegam apenas ao seu
  workspace.
- IDs conhecidos de tenant B não retornam linhas nem aceitam mutação por A.
- Carga, itens, rota, viagem e auditoria preservam os totais canônicos.
- Motorista abre viagem/paradas, registra evento e persiste após nova sessão.
- Portal abre dashboard, remessas, documentos/POD e neutraliza CSV.
- `/billing` e demais rotas fiscais exibem “Integração em implantação”; chamada
  direta recebe `INTEGRATION_DISABLED`. O mesmo vale para SSX.
- Headers CSP, HSTS, frame, MIME, referrer e permissions estão presentes; não há
  `.map` nem padrão de secret no artefato público.
- Um erro sintético autenticado chega a `application_error_events` com release
  e correlation ID, sem token, e aponta para o runbook.

## Rollback

1. Acione primeiro o kill switch da capacidade afetada. Para o núcleo, bloqueie
   a promoção e preserve o estado para diagnóstico.
2. Frontend: repromova o artefato imutável anterior; não gere um novo build.
3. Edge: republique o bundle anterior do mesmo release conhecido.
4. Banco: use migração corretiva forward-only. Reversão destrutiva exige backup
   verificado e aprovação do responsável pelo incidente.
5. Execute novamente smoke e reconciliação de filas/idempotência.
6. Registre correlações, janela afetada, impacto e decisão de reabrir tráfego.

O ensaio deve medir: tempo para detectar, tempo até kill switch, tempo de
rollback, resultado do smoke e responsável. Sem registro, o rollback não está
homologado.

## Incidente

- Severidade P0: vazamento cross-tenant, indisponibilidade geral, corrupção ou
  mutação fiscal indevida. Bloquear tráfego/capacidade e escalar imediatamente.
- Severidade P1: jornada crítica indisponível, erro persistente de upload/POD ou
  fila parada. Iniciar mitigação em até 15 minutos.
- Pesquise primeiro pelo `correlation_id`, depois por release e janela. Não copie
  tokens, documentos, cookies ou payloads completos para tickets/chat.
- Owner operacional: on-call da aplicação. Owner de dados: responsável Supabase.
  Decisão go/no-go: responsável de produto + engenharia.

## Recuperação e backups

1. Restaure o ponto escolhido em projeto/branch isolado, nunca sobre produção.
2. Registre início/fim para obter RTO e compare o ponto restaurado para obter
   RPO real.
3. Execute baseline, pgTAP, geração de tipos e E2E crítico.
4. Reconcilie filas, webhooks, PODs e operações idempotentes posteriores ao RPO.
5. Destrua apenas o ambiente isolado após anexar evidências.

Até que o ensaio real esteja registrado, backup/PITR permanece um bloqueio de
go-live, mesmo que o recurso esteja contratado.

Consulte também [SLOs e alertas](slo-and-alerts.md) e o
[relatório de evidência](release-evidence-2026-08-28.md).
