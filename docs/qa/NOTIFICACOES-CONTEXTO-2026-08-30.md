# Notificações vinculadas ao contexto de acesso

Estado: **implementação local e regressão ampla aprovadas; não publicada**. O objetivo integral continua ativo; este bloco não libera o aplicativo como pronto para produção.

## Reprodução e correção

Cinco falhas foram reproduzidas com AuthProvider/TenantProvider, SDK Supabase real e leitores financeiros SQL reais em transações revertidas no PGlite. Avisos Shadcn/Sonner permaneciam visíveis após trocar a conta; retornos tardios de leitura podiam publicar tanto toasts quanto um novo GlobalAlert na conta seguinte. O alerta já aberto era cancelado corretamente, mas isso não impedia um novo alerta tardio.

- Um identificador de contexto em memória invalida callbacks antes da limpeza. Ele muda no bootstrap/troca de conta, troca de empresa/papel e bloqueio do gate MFA. Renovação normal da mesma conta/empresa/papel de operador não descarta avisos válidos.
- Shadcn remove os avisos e seus temporizadores. O hook usa uma assinatura estável do armazenamento; criação, atualização, fechamento e botões de ação ficam vinculados ao contexto capturado.
- Sonner usa apenas APIs públicas, com IDs por contexto e remontagem imediata do componente para descartar renderizações internas já agendadas. Textos e callbacks privados são removidos também do histórico interno, inclusive de avisos já fechados. Mensagem de erro com ID encerra o loading associado.
- As chamadas globais foram substituídas por hooks em 73 arquivos, com 115 bindings, além dos consumidores que já usavam `useToast`. Confirmações/prompts receberam 26 bindings em 24 arquivos. O helper de download fiscal recebe o emissor de aviso do chamador; o fluxo de download em si não foi alterado.
- Confirmações tardias retornam `false`; prompts tardios retornam `null`. Callbacks antigos de confirmação fiscal não podem transmitir pelo diálogo do contexto seguinte. O resultado de confirmação também é revalidado ao resolver sua Promise.
- Os mocks de Sonner e logout foram alinhados à API nova. As regras de hooks identificaram dependências de `toast` e `confirmAction`, corrigidas sem mudar as operações.

Os números de bindings são o resultado da transformação sintática; não são um percentual de cobertura funcional. Um teste de contrato impede que consumidores voltem a importar APIs de notificação/confirmação sem contexto.

## Verificação até este checkpoint

- **32 testes novos aprovados:** 18 integrações frontend/SDK/SQL, 12 casos de estado/callback/renderização/histórico e dois contratos de imports.
- As integrações conferem troca de conta, resposta tardia, renovação comum, logout com fila durável preservada, outra empresa autorizada e perda de AAL2. O banco confirma acesso financeiro negado ao motorista/AAL1 privilegiado e ausência de acertos da primeira empresa na segunda.
- Antes da ampliação final, o conjunto de notificações/sessão/MFA aprovou 81 testes em cinco arquivos.
- A primeira rodada ampla encerrou com código um: **2.460 aprovações e 24 falhas**, em 209 arquivos. As falhas vinham de um único mock de confirmação sem `useScopedAlerts`; o mock foi removido e os testes passaram a usar o hook real, sem retirar as asserções. A rodada dirigida posterior passou com **56 testes em quatro arquivos**, incluindo esses 24 casos financeiros e os 32 novos. O lint dos módulos centrais passou sem avisos.
- **Gate final encerrado com código zero: 2.485 testes/209 arquivos**, tipos, lint, qualidade (104/113 avisos `any`, sem novo arquivo acima de 500 linhas), 41 sintaxes Edge, build e scanner de artefatos públicos aprovados. Testes em 369,67 s; build em 20,62 s; maior chunk 488,3 KiB; entrada principal 375,7 KiB.
- A cobertura configurada continua restrita a cinco arquivos: 93,03% de linhas/declarações, 65,83% de ramificações e 81,81% de funções. Não é cobertura de toda a aplicação nem percentual de prontidão de produção.
- Não houve nova execução dos 290 cenários PostgreSQL 17.11 nativos, que pertencem ao checkpoint anterior. Nenhuma migração SQL foi modificada neste bloco; os 18 testes integrados novos executam o SQL candidato local no PGlite.
- O gate completo imediatamente anterior, específico da coordenação MFA, passou: **2.453 testes/206 arquivos**, tipos, lint, Edge, build e scanner. Dezoito hashes permaneceram estáveis. Ver [MFA e sessão](MFA-SESSAO-2026-08-30.md). Esse resultado não valida automaticamente as alterações posteriores de notificações.

## Complemento identificado durante a revisão

Um ensaio isolado em memória com aviso sintético confirmou que `dismiss(id)` deixa o texto no histórico interno de Sonner, mesmo com zero itens ativos. A substituição do conteúdo e callbacks por valores vazios via `message` seguida de `dismiss` removeu o texto no ensaio. A limpeza foi aplicada à fronteira de contexto e o teste específico confirmou título, descrição, ação e callbacks limpos após a troca. Usa somente APIs públicas; não modifica internals do pacote.

A primeira rodada ampla não sofreu edições concorrentes: o hash agregado de **1.041 arquivos** de código, testes, configuração, Edge e SQL permaneceu `468365790dea86b418b7d7a9c18fd63d022aa470254cfab0cad2418ee79b0591` antes/depois. Após remover o mock e adicionar a limpeza histórica, o gate final manteve o hash `1583ee391182e25a256dda582a15bceb2ca9d06f16577c35e992495d144ea71a` idêntico antes/depois. Não houve edição de código/testes durante cada gate nem segundo processo de cobertura no mesmo diretório.

## Limites

- O Auth HTTP é sintético e Web Locks é simulado; não se trata de duas abas reais nem de GoTrue/PostgREST hospedados.
- O SQL de autorização da fixture é a candidata local. A conferência anterior de produção encontrou helpers sem a restauração de MFA; publicação exige banco e frontend coordenados.
- Invalidar notificações **não cancela operações já enviadas**, pagamentos, emissões, downloads ou outros efeitos externos. Nenhuma fila durável é apagada. Os demais fluxos continuam sujeitos às guardas e regressões próprias.
- Nenhum documento fiscal real, pagamento, SMS, serviço pago ou reintegração SSX foi acionado. Não houve escrita em produção neste bloco.
- A CLI administrativa foi revalidada somente por leitura e continua sem credencial (`LegacyPlatformAuthRequiredError`). O ajuste de signup hospedado continua pendente; nenhuma credencial foi exibida.

As skills Supabase/PostgreSQL orientaram a checagem de autorização também no SQL e os limites do gateway sintético. A revisão React orientou assinaturas estáveis, dependências de hooks e invalidação do estado visual sem apagar dados duráveis.
