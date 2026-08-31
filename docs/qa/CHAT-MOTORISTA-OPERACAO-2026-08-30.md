# Chat motorista–operação — recuperação e autorização

Estado: candidato local não publicado. O chat completo ainda não está liberado como pronto para produção.

## Problemas reproduzidos e correções

A linha de base usa as políticas consolidadas de 25/08 e os helpers MFA de 28/08, não apenas o dump inicial. Sete testes legados reproduzem identidade de exibição fornecida pelo cliente, rótulo de papel inconsistente, vínculo driver/tenant inconsistente, duplicação após resposta perdida e acesso de motorista com membership revogada mas cadastro ainda ativo. Os controles negativos confirmam a negação a outro motorista e a exigência MFA no ramo administrativo antigo. Isto é evidência local; não comprova exploração nem estado atual de produção.

O novo contrato deriva remetente, papel, nome e destinatário no servidor. Exige membership ativa, motorista da empresa e MFA AAL2 para owner/admin. A operação preserva consulta ao histórico, mas não pode iniciar mensagens para destinatário inativo, sem usuário, com membership revogada ou com papel diferente de motorista. Mensagens anteriores não são entregues a um novo usuário associado ao mesmo cadastro de motorista.

O envio usa UUID de requisição, hash do corpo, revisão de contexto e confirmação compatível. Repetir a mesma requisição retorna a mesma mensagem; mudar seu corpo é recusado. A autorização é refeita após o lock de requisição. Membership do remetente, cadastro do motorista e membership do destinatário ficam protegidos durante a aceitação. Conflitos retornam erro de concorrência sem gravação parcial.

O frontend mantém o comando antes da transmissão, separado por empresa/ator e com versão. Falha de persistência impede envio. Uma resposta incerta conserva o comando, inclusive se uma tentativa posterior receber acesso negado. Não há descarte cego. O painel recupera a confirmação após remontagem; na conversa ainda aberta, limpa somente o rascunho correspondente, preservando texto novo. A confirmação significa registro no banco, não leitura pelo destinatário.

As duas telas compartilham a conversa. Consultas/cache incluem tenant, ator e motorista; erros não são apresentados como histórico vazio. Paginação usa 50 mensagens e cursor com timestamp/UUID. A atualização por evento tem consulta periódica de 15 segundos como alternativa. Eventos simulados nos testes não provam entrega real por Supabase Realtime.

## Segurança e integridade

- APIs públicas são wrappers `SECURITY INVOKER`. Implementações privilegiadas ficam em `driver_chat_private`, que deve permanecer fora dos schemas expostos da Data API.
- Grants explícitos: authenticated pode consultar a tabela sob RLS e chamar APIs autorizadas; escrita direta, anonimato e service_role não recebem permissões desta interface. A busca local não encontrou outro consumidor da tabela além da assinatura Realtime atual; consumidores externos precisam de inventário antes da publicação.
- Mensagens novas têm vínculo composto tenant/motorista, índice de idempotência e proteção contra alteração/exclusão. A FK começa `NOT VALID` para não apagar nem corrigir silenciosamente registros legados inconsistentes.
- Os dados locais de recuperação contêm texto e IDs necessários para replay, não credenciais. A política de retenção e o comportamento em dispositivo compartilhado precisam integrar a liberação final.
- Nenhuma emissão fiscal, pagamento, mensagem externa ou ativação SSX integra este fluxo.

As skills Supabase/Postgres orientaram a separação de grants/RLS, helpers privados e testes de lock/revogação; React orientou isolamento de sessão e persistência versionada mínima. Referências: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [locks PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-DEADLOCKS).

## Evidências locais

- 46 testes de chat: 7 de linha de base, 17 de contrato SQL, 11 de recuperação e 11 de frontend conectado ao SQL real em fixture.
- Regressão completa: **2.232 testes / 187 arquivos aprovados**, processo encerrado com código zero. Acréscimo de 46 testes de chat sobre os 2.186 do lote anterior.
- **267 cenários PostgreSQL 17.11 nativos aprovados**, incluindo os 259 casos anteriores e oito de chat. Processo encerrado com código zero; cluster descartável parado. Os novos casos comprovam repetição concorrente com uma única mensagem, duas mensagens distintas simultâneas, revogação do remetente durante espera, revogação do destinatário, troca do usuário associado ao motorista, MFA e rollback de falha tardia. Snapshots das dez tabelas operacionais/financeiras acompanhadas ficaram idênticos.
- TypeScript, lint de erros, lint de tipos críticos, baseline de qualidade e sintaxe das 41 Edge Functions aprovados. Tipos e lint do chat foram repetidos após o último ajuste de sincronização de rascunho, também com código zero.
- Build aprovado em 19,89 s; maior chunk 488,3 KiB, index 352,6 KiB. Scanner não encontrou source maps nem padrões reconhecidos de segredos. Cobertura do subconjunto configurado: 93,03% statements/linhas, 65,83% branches e 81,81% funções; não é cobertura do aplicativo inteiro.
- Advisors CLI 2.116.0: não executados com sucesso; conexão recusada em `127.0.0.1:54322`. O PostgreSQL portátil dos ensaios não substitui a stack Supabase completa.
- Navegador autenticado não foi usado nesta etapa. Renderização integrada com SQL não equivale a E2E HTTP/Auth/Storage/Realtime.

Migração candidata: `supabase/migrations/20260830221527_make_driver_chat_recoverable.sql`.
SHA-256: `70ed39766a83b80c49c651fce9b592997735c1ab63feb754036f863f36775fa4`.

Os hashes de criação de despesas e seus scripts de contenção/retomada permanecem idênticos ao lote anterior.

## Pendências que impedem a liberação integral

1. Conversas vinculadas a eventos foram integradas e validadas localmente em [chat por ocorrência](CHAT-OCORRENCIAS-2026-08-30.md). Anexos seguem pendentes; nada aqui autoriza expor URLs legadas.
2. Histórico anterior sem destinatário comprovável fica disponível apenas para a operação, rotulado como identidade não verificada. Reconciliação auditada é necessária para devolvê-lo ao motorista correto; não associar automaticamente ao usuário atual. Registros tenant/motorista inconsistentes são preservados para análise, não publicados pela nova API.
3. Ensaiar contenção/retomada específica e preflight de corpos, permissões, consumidores, políticas e schemas expostos. Não publicar o frontend antes das APIs; não fechar escritores legados enquanto telas antigas ainda dependem deles. Não reabrir escrita direta como rollback automático após uso do novo contrato.
4. Validar o fluxo em stack Supabase completa e navegador autenticado dos dois papéis, incluindo troca de sessão, MFA, concorrência, perda de resposta e Realtime. Repetir smoke após publicação coordenada.
5. Revisar MFA das outras APIs privilegiadas novas, especialmente financeiras: verificar papel ativo não substitui comprovar AAL2 quando exigido pela política. Isso ainda não foi reproduzido ponta a ponta nem corrigido neste lote de chat.

O objetivo geral permanece ativo: demais P1/P2, publicação coordenada, intercomunicação de todos os módulos e lógica SSX pronta sem ativação/custo adicional.
