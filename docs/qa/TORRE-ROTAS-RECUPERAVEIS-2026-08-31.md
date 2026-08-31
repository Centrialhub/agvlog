# Rotas recuperáveis e isolamento da estimativa financeira

Estado: **candidato local, não publicado**. SSX permanece inativo. Nenhuma emissão fiscal, pagamento externo ou chamada real ao roteador foi realizada neste bloco.

## Problemas reproduzidos e correções

Cinco testes iniciais reproduziram: GPS de 30 minutos aceito como origem, parada pendente sem coordenadas omitida, e gravação após mudança de parada, posição ou encerramento da viagem durante o cálculo. Depois da correção, os 18 testes dos handlers passaram. Foram acrescentados casos de identidade/contexto e os ensaios abaixo.

- `prepare_trip_route_v1` registra uma solicitação privada por tenant, viagem, ator e UUID. A preparação valida todas as paradas pendentes, exige GPS recente em trânsito e usa uma revisão consistente de viagem/paradas/posição/rota. Antes da partida, sem GPS recente, a primeira parada pode servir como origem se houver ao menos dois pontos válidos.
- `commit_trip_route_v1` confirma sob locks e revalida papel, tenant, MFA, revisão e prazo. A gravação da rota, os triggers financeiros reais e o recibo durável pertencem à mesma transação. Filhos ou acertos ocupados causam conflito recuperável, não espera em ordem invertida.
- Ambas são wrappers INVOKER; as operações privilegiadas ficam no schema não exposto `control_tower_private`, com `search_path` vazio e autorização explícita. As APIs usam o JWT do usuário; não há credencial de serviço para escrever a rota. DML direto de `authenticated` em `trip_routes` é revogado. A tabela de recibos tem RLS e nenhum acesso direto dos papéis API.
- A Edge exige conta/empresa/viagem/solicitação e rejeita contexto de sessão antigo. Uma repetição confirmada retorna o recibo, sem chamar o roteador nem regravar uma rota posterior. Preparações têm lease de 30 segundos e validade de dois minutos; nenhuma rotina automática chama provedores para recuperar uma falha.
- O frontend conserva apenas o UUID pendente no armazenamento local, isolado por conta/empresa/viagem. Recusa enviar se não puder preservar a identidade. Confirmações incompatíveis não viram sucesso; falhas de limpeza do armazenamento depois de um commit não desfazem seu resultado. O limite de 30 segundos cobre a requisição e a leitura de corpo de erro; a resposta tardia não limpa o pedido pendente, que pode ser consultado novamente com a mesma identidade.
- O cliente OSRM valida coordenadas finitas, geometria, métricas e waypoints e mantém timeout durante a leitura do corpo. A gravação SQL também valida endpoints, inclusão dos pontos e coerência mínima de distância/geometria. Um resultado submetido por operador autorizado não é tratado como atestado criptográfico do provedor.
- Leituras e avaliação da Torre só usam uma geometria vinculada ao plano atual. Rotas legadas ficam armazenadas, mas não são certificadas automaticamente. Novas posições invalidam a avaliação derivada, sem invalidar por si só o plano de navegação persistido.

## Efeito financeiro encontrado e corrigido

O leitor `_build_driver_settlement` usava `trip_routes.distance_meters` como estimativa total. Uma rota recalculada em trânsito representa o trecho restante. O candidato separa `planned_distance_meters`, `planned_duration_seconds` e `full_plan_revision` das métricas da navegação atual.

A estimativa completa só é estabelecida antes da partida, sem início real e sem paradas já finalizadas. Ela permanece válida com o avanço operacional das paradas, mas não com alteração de veículo ou do plano geográfico. O builder passa a consultar apenas essa estimativa validada; não há preenchimento retroativo a partir de uma rota legada ou parcial. A tela mostra “Sem estimativa validada”, não zero. Apenas a origem da estimativa foi alterada no corpo financeiro; ACLs, regras de tentativas, ajustes e pagamentos foram preservadas e comparadas em teste.

## Evidências e limites

- Última regressão focada: **82 testes em seis arquivos aprovados** — rotas SQL, tela → Edge → SQL, OSRM com rede simulada, builder financeiro real e tela de acertos.
- Gate amplo anterior ao último ajuste de timeout: **2.616 testes/220 arquivos aprovados**, tipos/lint/qualidade/42 sintaxes Edge/build/scanner aprovados. Hash dos 1.063 arquivos igual antes/depois: `882f760c95580dd1f113243e9ac74a641f9ef07b2857873a061ab0bb85a88f36`. Build em 27,28 s; maior chunk 488,3 KiB. A primeira tentativa terminou em dois erros de tipos dos testes e a segunda em uma regra de lint; foram corrigidos sem retirar testes e não foram contados como aprovações.
- Após acrescentar o timeout: **21 testes focados/quatro arquivos aprovados**, incluindo resposta tardia, erro com corpo pendurado, replay e integração da tela/Edge/SQL. **Gate geral final aprovado: 2.619 testes/221 arquivos**, tipos, lint, qualidade, 42 sintaxes Edge, build e scanner, processo encerrado com código zero. São 61 testes a mais que o checkpoint de avaliação transacional. Testes em 380,01 s; build em 17,83 s; maior chunk 488,3 KiB e entrada 375,7 KiB. Hash dos 1.064 arquivos idêntico antes/depois: `aac9434d8af18964df51402fd85539e946f3ed1035c7cfe252df636bac3f0871`.
- A cobertura de 93,03% de linhas/statements, 65,83% de branches e 81,81% de funções continua limitada aos cinco arquivos de biblioteca configurados. Não representa cobertura do aplicativo inteiro nem percentual de prontidão para produção.
- Regressão PostgreSQL nativa completa: **313 cenários aprovados** (290 anteriores + 23 da Torre), processo encerrado com código zero e servidor descartável parado. A rodada preliminar passou 21 cenários da Torre; a rodada final inclui também contenção financeira e distância planejada versus restante.
- Contenção/retomada ensaiadas em PGlite: os quatro pontos de execução foram negados; depois da retomada, o recibo original foi recuperado. Hashes de rotas e recibos permaneceram iguais. Nenhum histórico apagado.
- Analisador Supabase local: indisponível, `ECONNREFUSED 127.0.0.1:54322`. Docker CLI não encontrado e nenhum serviço Docker foi retornado pela consulta; `.env.test.local` ausente. O cluster nativo descartável não equivale à stack Supabase hospedada. Nenhuma credencial foi lida ou exposta nessas verificações.
- Os testes integrados de tela usam componentes/hooks/Edge/SQL reais com Auth/transporte controlados e provedor/mapa sem rede. Não equivalem a E2E autenticado hospedado, teste PostGIS nem certificação de qualidade das rotas do provedor real.
- Consulta agregada de produção em 31/08 confirmou **zero tenants com SSX efetivo**, ausência de `prepare_trip_route_v1(uuid,uuid,uuid,uuid)` e ausência de `trip_routes.planned_distance_meters`. Não houve publicação ou escrita em produção. As alterações anteriores e demais candidatos locais foram preservados.

## Publicação ainda necessária

O release depende das migrações de leitura/avaliação da Torre, seguidas das duas novas candidatas `20260831112949_make_trip_route_calculation_recoverable.sql` e `20260831114316_separate_planned_and_remaining_route_distance.sql`. Deve coordenar banco, Edge e frontend: o contrato antigo não contém identidade recuperável e o DML antigo será negado. Não promover a árvore inteira sem inventário de versões, preflight de ACLs/corpos e validação autenticada pós-publicação.

A [contenção](TORRE-ROTAS-CONTENCAO-2026-08-31.sql) fecha os quatro pontos de escrita sem apagar recibos nem reabrir DML legado. A [retomada](TORRE-ROTAS-RETOMADA-2026-08-31.sql) exige revisão do candidato instalado. O leitor financeiro antigo não deve ser restaurado automaticamente porque voltaria a misturar distância restante com estimativa total.

Próximo bloco: corrigir a ingestão monotônica SSX, seus heartbeats e a invalidação por remapeamento; encadear avaliação sem ativar a integração. Permanecem as demais pendências P1/P2, publicação coordenada e validação integral motorista → operação → portal; depois concluir a prontidão integral do operador. O objetivo completo continua ativo.

As orientações das skills Supabase/Postgres guiaram os wrappers com permissões restritas e a ordem de locks; a skill React orientou o armazenamento mínimo e versionado por contexto. Referências: [funções do Supabase](https://supabase.com/docs/guides/database/functions) e [locks do PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html).
