# Candidato combinado: Demanda 5 e cinco bloqueios nativos

Origem manual preservada: `F:/AGVLOG/work/manual-updates`, branch `task/manual-updates`, HEAD `deda6fd1fa765648f8de1785a1a7693081ad11bb`. Snapshot de 32 caminhos às 21:26:28 UTC de 05/10/2026, com bytes/hashes/status em `merge-20261005/manual-additional/preservation/manifest.json`. Foram incorporados 22 caminhos adicionais e o documento ampliado por merge de três vias sem conflitos; nove caminhos de código da primeira entrega eram idênticos ao snapshot anterior e não foram recopiados. A fonte manual não foi editada. A evolução continua em `F:/AGVLOG/work/manual-driver-access-20261005`, tarefa `manual-driver-access-20261005`, dono `CodexMerge`.

Base congelada preservada: `fbefb1fb249120995cbcf08eec4ad8fd08a4d04e`, árvore `221236fa17f5fb1e76e2d9bebb59810cccec62ca`, em `native-blocker-followup-20261005`. Sua correção de armazenamento mantém 503 notas e o modelo completo de auditoria, com leitura/replay do mesmo pedido; não foi revertida pela importação manual. Não houve integração na base cumulativa, push, deploy, migration remota ou operação com conta real nesta tarefa.

## Correções verificáveis

| Objetivo | Problema observado | Correção e validação local |
| --- | --- | --- |
| M3 | Erro de refetch deixava o cache antigo selecionável quando isFetching retornava false. | Query pending/error/fetch e filtros em debounce bloqueiam nova seleção/criação; alert com atualização explícita. Seleções/filtros e recuperação durável permanecem. QueryClient real + cliente Supabase com transporte sintético reproduzem refresh retido, erro com cache, retry, recentes e recuperação sem dados. |
| A1 | Reimportar CSV recusava o pedido duplicado, mas criava nova carga/item sem order_id. | Exigir IDs únicos de pedidos criados nesta execução antes da criação da carga e antes de submeter itens. Grupo parcial falha com mensagem; outro grupo confirmado pode continuar. Constraints/FKs e writes PGlite verificam 1 pedido/1 carga/1 item após a repetição; quantidades/pallets/peso permanecem exatos. |
| A4 | Listas do Portal omitiam client_id/can_reply/can_cancel. | Forward acrescenta projeções, preservando filtros, paginação, revision, OID, ACL e escritores. can_reply exige permissão e visibilidade; estados resolvido/pendente continuam tratados pela UI. Fixture usa helpers/leitores/escritores reais e verifica negativos, revogação, replay/auditoria e drift. |
| A8 | secure-upload rejeitava recibo próprio autorizado com finance_access_denied antes do caminho canônico. | Caminho expense_receipt reservado usa sua inspeção com JWT verificado em vez do gate geral de finanças. Mantém tenant, papel driver, quota, assinatura/hash, scanner e revalidações antes/depois do objeto. Teste executa o index.ts real com SDK/HTTP sintéticos, incluindo fonte alheia, revogação durante scanner e disfarces de uploads financeiros. |
| A14 | Escape fechava lote/avulsa mas foco voltava ao BODY. | Captura e devolve foco ao disparador conectado em ExpenseBatchDialog e ManualExpenseWorkspace. Radix/DOM reais verificam foco, draft/pedido byte-idêntico e zero writes/uploads/remoções. |
| M5 | Novo acesso precisava conferir tenant assinado; helper invoker tentava acessar Auth; revogação do admin, retirada orphan/retry e cache podiam quebrar isolamento. | Verificação getUser antes de header/corpo/claim; wrapper invoker sobre helper privado SECDEF mínimo, sem grants auth.users; admin revalidado no Auth AFTER; retired provenance sem bypass NULL; marcador driver inativo para listagem/retry; sem promoção/compartilhamento/portal mesmo inativos. Cache somente em falha de transporte offline, nunca em negação/contexto inválido. |

A migration M5 aplica o grafo real de convite anterior, SHA-256 real de pgcrypto e índice parcial existente de drivers. Testes exercitam BEFORE/AFTER, rollback de UID/membership/link, nonce/replay/expiração, reservas concorrentes sequenciais, colisão global de usuário, convites comuns de operador/cliente, isolamento de grants, retirada normal/orphan, retry e FK histórica. PGlite não reproduz concorrência nativa nem GoTrue, sessões, RLS/Storage completos ou PostgREST real.

Os treze forwards originais e os nove suplementos anteriores permanecem byte-idênticos. `baseline-followup-manifest.json` acrescenta somente M5 `20261005204938` e A4 `20261005215852`, com hashes da versão final. O arquivo A4 foi gerado pelo Supabase CLI 2.116.0 após consultar `migration new --help`. Não foi criado um timestamp arbitrário nem vinculado um projeto remoto.

## Matriz de aceite do próximo SHA

O último checkpoint nativo lido, `task-3/FBE-CHECKPOINT-HANDOFF.json` às 21:50:12 UTC, refere-se apenas a **fbef**: 18 objetivos, **2 aprovados (M1/M2), 5 falhos, 11 pendentes**. Esse resultado é histórico. Nenhum passe de fbef/aac/05d é herdado pelo candidato combinado. A matriz mantém os 18 IDs reais e acrescenta **M5**, totalizando **19 objetivos**; os 12 cenários de M5 são subcenários, não novos objetivos.

| IDs | Estado nativo do candidato combinado | Aceite necessário |
| --- | --- | --- |
| M1, M2 | Pendente | Repetir navegação e filtros/datas/preferências no mesmo SHA servido. |
| M3 | Pendente | 503 notas + auditoria completa, quota/reload/replay sem novo UUID ou carga extra; refresh retido/falho bloqueia novas seleções até retry bem-sucedido. |
| M4 | Pendente | União/cancel/chaining/split/none, capacidade, identidade, tenant, elegibilidade e recuperação. |
| A1 | Pendente | CSV real válido e repetido/erro parcial; 1 pedido/1 carga/1 item vinculado, sem somas duplicadas, sem apagar pedido existente. |
| A2, H2 | Pendente; provider fiscal indisponível no checkpoint | Ambiente/provider autorizado de homologação. Nenhuma emissão real de produção. |
| A3, A6, A9 | Pendente | Jornadas completas e negativos do catálogo de objetivos do candidato combinado. |
| A4 | Pendente | Criar/conversar/cancelar pela UI com sessão própria; readback de audit/estado, replay e cliente/tenant/grant/visibilidade alheios. Capturar owner/ACL atuais dos leitores antes do forward. |
| A5 | Pendente | Estoque/effects/rotas/produtividade/CAS e concorrência do próprio SHA. O forward7920 e a correção OUT anterior foram preservados. |
| A7 | Pendente; provider SSX indisponível no checkpoint | Provider de homologação autorizado, sem reutilizar produção. |
| A8 | Pendente | Driver próprio registra/recupera recibo e despesa; fonte alheia/revogada/MFA e uploads financeiros gerais continuam negados, com Storage real isolado. |
| H1, H3 | Pendente | Revalidar os hotfixes publicados incorporados na base cumulativa. |
| A13 | Pendente | Gates completos do SHA final, todos shards unitários/DB/E2E/hosted CI, catálogo e migrations atuais, rollback das quatro camadas. |
| A14 | Pendente | Escape nos dois fluxos reais retorna ao botão original e preserva drafts/pedidos, com zero writes financeiros. |
| M5 | Pendente | Os 12 cenários definidos na Demanda5 com Auth/SQL/RLS/Storage/browser isolados, incluindo criação dupla concorrente e sessão antiga. |

## Homologação e retorno

1. Revisor recebe bundle/prerequisito, SHA/tree/file hashes e worktree congelado; verifica origem servida/artefato/backend antes dos casos. Os serviços UI4183/API57323 pertencem exclusivamente ao revisor. Não trocar checkout, processos, contêineres, mocks ou dados de outra frente; task-2 frete permanece intocada.
2. Capturar catálogo completo dos três predecessores Auth/convite e das duas listas Portal: prosrc/OID/owner/ACL/config/triggers, migrations e roles atuais. Guardas só aceitam predecessor revisado. Divergência bloqueia aplicação e exige análise do contrato; não ampliar whitelist/limites para passar.
3. Aplicar os 13+11 forwards na réplica isolada coordenada; publicar exclusivamente os backends de homologação necessários e o frontend do SHA congelado. Criar apenas identidades/viagens/comprovantes sintéticos autorizados. Autenticação produtiva, mudança de senha, retirada/recriação de motorista real e divulgação de credenciais exigem autorização operacional separada.
4. Resolver/sincronizar filas offline do UID antigo **antes** da retirada. Preservar comandos/arquivos sob o UID original. Não reatribuir/reexecutar pedidos antigos como o novo UID nem apagar a fila para fazer o aceite passar. Comprovantes e dados persistidos devem continuar visíveis ao novo UID pelo mesmo drivers.id nas políticas reais.
5. Revalidar cada objetivo e publicar somente após 19 objetivos aceitos, gates completos do mesmo SHA/contrato, janela/backup/distribuição operacional e autorização de publicação. Depois, fila/enqueue/integrate pelo coordenador; eventual commit final isolado só após aceite combinado, sem reescrever histórico.
6. Rollback precisa separar frontend, Edge, banco e Auth. O leitor legado anterior ao codec v2 não recupera pedidos compactados: manter/backportar leitor compatível ou resolver filas antes de downgrade. Não contar fail-closed sem replay como rollback aprovado. Soft-delete/recriação não devolve as credenciais/UIDs antigos; conservar backend novo e corrigir acessos, ou coordenar restauração de backup sem perder operação posterior. Exercitar retorno em homologação isolada antes de publicar.

Aceite local está registrado separadamente por SHA no handoff. Os testes focados são evidência de correção, não aprovação de produção nem conclusão dos 19 objetivos. Nenhuma credencial real foi lida ou criada.
