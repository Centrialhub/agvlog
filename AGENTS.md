# Direção para mudanças no AGVLOG

Antes de alterar um fluxo publicado ou preparar um release, leia [o roteiro de estabilidade](docs/qa/production-stability-playbook-2026-09-26.md), [o log do incidente de 26/09](docs/qa/production-stability-log-2026-09-26.md) e, para trabalhos de banco, [a proposta de baseline](docs/qa/migration-baseline-plan-2026-09-26.md). Para cada novo release, crie um log próprio a partir do [template permanente](docs/qa/release-log-template.md), com as evidências e pendências da mudança. Preserve o log de 26/09 como histórico; não o use como registro contínuo de releases futuros.

## Regras de trabalho

- Confirme o SHA realmente publicado, as versões das Edge Functions e o contrato SQL em produção antes de assumir que `main` representa o ambiente público. O histórico local e o banco divergiam em 26/09/2026.
- Antes de publicar Edge Functions, compare o bundle completo de cada função afetada, incluindo módulos compartilhados, com a versão ativa. Não execute uma publicação de todas as funções a partir de um checkout sem essa reconciliação. Os checkpoints de `ssx-sync-governance` v14 e `agvlog-pipeline-run` v153 precisaram ser recuperados dos pacotes publicados; a comparação também inclui `ssx-sync-units` v146. O [registro de reconciliação](docs/qa/edge-reconciliation-2026-09-26.json) documenta fontes e diferenças candidatas. Reconfirme as versões ativas antes de promover.
- Faça a mudança em checkout isolado e preserve alterações de outros trabalhos. Use migrações novas e incrementais; não reescreva uma migração já aplicada para corrigir produção.
- Não execute `supabase db push` enquanto `npm run supabase:parity:check` falhar para o banco alvo. Aplique apenas SQL revisado e específico depois de conferir dependências, dados existentes, autorização e efeito em hotfixes já publicados.
- Para cada função `.rpc()` nova ou alterada, teste assinatura, permissões, isolamento entre empresas, repetição e erro. Para importação, fiscal e financeiro, inclua ao menos um cenário de dado realista e um de concorrência ou estado obsoleto.
- Antes de promover, exija o Quality gate completo: `validate`, todos os shards `unit-tests` e `database-and-e2e`. Compare o contrato do candidato com o mesmo banco de staging usado pelo smoke autenticado. Registre SHA, horários UTC, links, contagens e resultado no log.
- Publique na ordem migrações, contratos do banco, Edge Functions e frontend. Registre o estado anterior e o plano de retorno; trocar apenas o frontend não reverte mudanças de dados ou esquema.

Um teste local ou build verde não prova estabilidade da versão pública. Não marque uma correção como publicada antes de verificar o alias Vercel, as versões do banco/Edge e os fluxos críticos no ambiente final.
