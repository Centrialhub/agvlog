# Planejamento da integração SSX Tracking

Data da análise: 10/09/2026
Escopo: integração completa do produto **SSX Tracking Integration** com o AGVLog, preservando a separação entre workspace (grupo operacional) e tenant (empresa fiscal).

## 1. Decisão executiva

A infraestrutura atual é uma boa base, mas **a SSX deve permanecer com `ssx_enabled=false` ou `ssx_kill_switch=true` em produção** até a conclusão dos bloqueadores P0 deste plano.

O caminho correto não é ampliar os fallbacks atuais. É consolidar um adaptador tipado para o contrato oficial, tornar a ingestão canônica no workspace, eliminar exposição de segredos, substituir o polling limitado a 500 registros por uma estratégia de saturação que não avance sem prova de completude e separar claramente:

1. **Tracking**, produto documentado e contratado para posições, telemetria e gestão de ativos;
2. **Administration**, produto/escopo separado, hoje usado pelo código para descobrir veículos e rastreadores;
3. **Trip**, produto separado e fora do contrato fornecido para esta análise.

"Integração total" neste documento significa cobrir conscientemente todo o contrato publicado — 53 paths e 81 schemas no snapshot obtido em 10/09/2026 — classificando cada path como `implementar`, `adiar` ou `não aplicável`, com justificativa na matriz da seção 13. Isso não significa chamar nem habilitar todos os endpoints: somente os módulos aprovados pelo produto entram no runtime, e mutações de alto risco permanecem desligadas até terem gate próprio.

## 2. Fontes oficiais estudadas

- Manual de Utilização SSX Tracking Integration: <https://docs.google.com/document/d/e/2PACX-1vTPATjkvOL6OWlzGjrmLPA2YxpV84nr1D0eV-YFdA8VqhAX2rmQtROpUCtfHxQshg0ifbIthMlbN5NB/pub>
- Swagger SSX Tracking Integration: <https://integration.systemsatx.com.br/index.html?urls.primaryName=SSX_Tracking_Integration>
- Contrato OpenAPI usado na análise: <https://integration.systemsatx.com.br/api-docs/tracking/v1/doc.json>
- Swagger SSX Administration Integration, consultado porque o runtime atual depende dele: <https://integration.systemsatx.com.br/index.html?urls.primaryName=SSX_Administration_Integration>
- Supabase Queues e agendamento de Edge Functions: <https://supabase.com/docs/guides/queues> e <https://supabase.com/docs/guides/functions/schedule-functions>
- Changelog Supabase, consultado para mudanças de plataforma: <https://supabase.com/changelog>

Constatações obrigatórias do manual/Swagger:

- o produto “SSX Tracking Integration” precisa estar habilitado no cliente SSX;
- a SSX exige configuração prévia dos dias de histórico e do intervalo de consulta;
- é necessário criar uma configuração de integração que gera o `HashAuth`;
- o usuário precisa ter permissão para a integração;
- `Hashcentral` é necessário quando o login não é e-mail;
- `POST /Login` recebe credenciais por query parameters no OpenAPI; o manual também apresenta um exemplo em `form-data`, uma divergência que deve ser homologada;
- o manual manda informar o `HashAuth` gerado pela configuração de integração no login do produto Tracking, mas o schema OpenAPI marca `HashAuth` como opcional; depois do login, as operações herdam autenticação Bearer global e não recebem `HashAuth` individualmente;
- o manual informa validade de 24 horas, enquanto o contrato retorna `ExpiresIn`; o runtime deve respeitar o valor retornado e usar 24 horas apenas como limite/documentação, nunca como constante superior ao token;
- o schema retorna `AccessToken`, embora o texto do manual use também `token` e `Access Token`; o parser deve aceitar somente variantes comprovadas por fixture de homologação e registrar drift sem armazenar o token em log;
- `POST /v3/Tracking/PositionHistory/List` exige pelo menos um filtro e devolve no máximo 500 resultados;
- a versão v3 acrescenta placa, reboques, CPF e identificação RFID/IButton do motorista;
- `Telemetry/List`, `Event/List`, `Sensor/List` e `Actuator/List` são catálogos sem filtros;
- a SSX declara também `204`, `401`, `403`, `409`, `415`, `416`, `429` e `5xx`, variando por operação; não se deve aplicar uma tabela genérica de status a todas as rotas;
- URLs de videotelemetria devem ser consumidas em até 15 segundos e não funcionam para câmeras Hikvision.

Há inconsistências documentais a homologar: exemplos usam tanto `Equal`/`GreaterThanOrEqualTo` quanto `=`/`>=` no campo `Condition`; o request body de PositionHistory é `nullable` no schema, embora a descrição da operação exija ao menos um filtro; e as descrições dos relatórios `ActuatorsActivation` e `SensorsActivation` aparentam estar trocadas. O cliente final deve sempre enviar ao menos um filtro e usar apenas contratos comprovados em homologação e cobertos por teste.

### Correções produzidas por esta revisão

- A versão anterior atribuía ao OpenAPI uma exigência de `HashAuth` em rotas específicas. Isso estava incorreto: `HashAuth` é parâmetro do login; as demais rotas usam Bearer.
- A versão anterior prometia uma classificação dos 53 paths, mas oferecia apenas uma tabela por módulo. A seção 14 agora fecha esse inventário endpoint a endpoint.
- PositionHistory não é catálogo completo de unidades. Ele oferece descoberta oportunística de unidades que tiveram posição na janela consultada; cadastro/onboarding explícito continua necessário quando Administration não estiver contratado.
- Uma resposta vazia de PositionHistory não comprova que a conta não tem unidades, nem autoriza inativação. Ela significa apenas ausência de registros para os filtros e a janela usados.
- A migração para um modelo canônico de workspace precisa preservar a empresa proprietária e as autorizações de cada veículo. "Uma posição física única" não autoriza visibilidade automática entre tenants irmãos.
- O plano depende de respostas externas da Systemsat para alegar ingestão sem perda. Antes dessas respostas, o resultado aceitável é bloquear com evidência em caso de saturação, e não declarar completude.

## 3. Estado atual do repositório

### O que já existe e deve ser reaproveitado

- conta SSX, login e cache de token;
- catálogo de unidades (`provider_units`) e vínculo temporal com veículo;
- catálogo/mapeamento de telemetria;
- histórico bruto, última posição monotônica, cursor e fila;
- commit transacional por veículo em `commit_ssx_position_batch_v1`;
- deduplicação SHA-256 e vínculo versionado por `tracker_link_id`;
- claims de fila com `SKIP LOCKED`, lease, CAS no ACK e recuperação;
- mapa da frota, dashboard, portal, app do motorista e torre consumindo posições;
- capability flag, kill switch, health screen e runbook de rollout;
- base de sincronização de pessoa/motorista.

### Bloqueadores P0 encontrados

| Problema | Evidência atual | Risco | Correção exigida |
| --- | --- | --- | --- |
| URL SSX editável sem allowlist | `agvlog-integration-upsert` aceita `base_url` e depois envia usuário/senha | SSRF e exfiltração da credencial SSX | Fixar `https://integration.systemsatx.com.br`; permitir outro host somente por configuração server-side validada, TLS e sem redirect |
| Token administrativo potencialmente exposto | `admin_token_cache` é salvo em `integration_accounts.settings`; `get_workspace_ssx_accounts_v1` retorna `settings` a membros | Vazamento de bearer token no browser | Remover todo segredo de `settings`; retornar DTO seguro por RPC; migrar/rotacionar tokens existentes |
| Limite de 500 sem paginação documentada | polling normal faz uma consulta ampla por `EventDate >= ...` | Perda silenciosa de posições em frota/volume altos | Tratar 500 como saturação; subdividir janelas ou mudar a estratégia, sem assumir ordem/globalidade de `IdPosition` |
| GPS inválido pode virar posição atual | normalizador valida faixa, mas ignora `ValidGPS` | Mapa, ETA e alertas incorretos | Persistir como raw/quarentena e nunca promover `ValidGPS=false` para `positions_last` |
| Dados SSX ancorados em tenant | conta é do workspace, mas unidades, links, posições, health e guards ainda usam o `tenant_id` original | telemetria e torre inconsistentes entre empresas do mesmo grupo | Tornar unidade/posição/health canônicos no workspace; projetar acesso por tenant |
| Cron fixo em um tenant | `agvlog_tenant_id` agenda um pipeline específico | não escala para vários workspaces e deixa irmãos sem reavaliação | Dispatcher único enumera/claim contas habilitadas por workspace |
| Dependência indevida da API Administration | descoberta primária usa `/Administration/Vehicle/v2/List` e token sem `HashAuth` | falha para cliente que contratou apenas Tracking; escopo excessivo | Administration vira conector opcional e explícito; Tracking não depende dele |
| Respostas/payloads podem ir para logs | previews e mensagens de erro usam trechos do corpo SSX | endereço, placa, CPF, pessoa e dados operacionais podem vazar | logger estruturado por allowlist; nunca registrar corpo, token, query de login ou PII |

### Lacunas P1

- o polling descarta posições sem vínculo/ambíguas depois de apenas contar; precisa de quarentena reprocessável;
- a v3 não é a rota primária do runtime, embora seja a rota indicada pelo manual e tenha os campos necessários;
- endpoints sem versão são chamados primeiro com `/v3`, gerando tentativas desnecessárias;
- o runtime tenta formatos de body e nomes de propriedades por adivinhação; isso mascara drift de contrato;
- token refresh não possui singleflight/lock e pode gerar tempestade de login;
- `received_at` mistura o instante de ingestão com `UpdateDate` da SSX;
- `IdTrackedUnitType=2` não é separado explicitamente de veículo;
- múltiplos rastreadores/`TrackerSlot` não têm modelo próprio;
- o fluxo de pessoa envia campos que não existem no schema Tracking (por exemplo CNPJ e endereço), procura um `Id` que o `PersonResult` não publica e pode marcar sync como concluído sem identidade confirmada;
- só existe `InsertPerson`; falta `ListPerson` + reconciliação + `UpdatePerson`;
- o cron persiste posições, mas adia a reavaliação da torre por exigir JWT de usuário;
- o health fica dentro de `tenants.settings`, não em uma execução auditável da conta/workspace.

### Cobertura funcional ausente

Ainda não há integração completa para eventos, violações de regra, fórmulas de avaliação, sensores, atuadores, reboques, abastecimentos, geografias, mensagens Onboard, comandos, compartilhamento, videotelemetria, relatórios e manutenção.

## 4. Arquitetura alvo

```text
Supabase Cron
  -> dispatcher SSX por workspace (claim/lease)
      -> cliente SSX tipado + autenticação singleflight
          -> inbox imutável e restrito
              -> normalização/transação por stream
                  -> posição atual canônica do workspace
                  -> eventos/telemetria/violações
                  -> outbox de consumidores
                      -> estado do veículo
                      -> geofence/alertas/torre
                      -> projeções tenant e portal

Mutações AGVLog -> SSX
  -> outbox idempotente
      -> worker SSX
          -> status/reconciliação
              -> auditoria e DLQ
```

Princípios:

1. nenhuma chamada SSX parte do browser;
2. uma ingestão canônica por assinatura/conta SSX, vinculada ao workspace; o produto atual pode limitar uma conta por workspace, mas essa unicidade deve ser confirmada antes de virar constraint permanente;
3. canonicidade no workspace elimina ingestão duplicada, mas não amplia acesso: veículo, viagem e dados fiscais/operacionais continuam vinculados ao tenant, e qualquer compartilhamento exige vínculo/autorização explícitos;
4. resposta externa é validada antes de qualquer promoção;
5. cursor só avança no mesmo commit que tornou os dados duráveis;
6. toda mutação externa usa outbox, idempotency key local e reconciliação; a fila não torna o efeito HTTP exatamente uma vez;
7. operações perigosas são opt-in, auditadas e nunca automáticas.

## 5. Modelo de dados proposto

Os nomes finais podem seguir o padrão existente, mas os limites abaixo são obrigatórios. A implementação deve evoluir `positions_raw`, cursores, filas e tabelas atuais por migrações incrementais; não deve criar uma segunda inbox/outbox paralela sem uma análise de compatibilidade e migração.

### Configuração e execução

- evoluir a `workspace_ssx_accounts` existente: `workspace_id`, estado, capability, base URL server-side, referência do segredo e configuração não sensível;
- segredo da senha/HashAuth/Hashcentral fora de tabelas expostas; referência no Vault ou cofre equivalente;
- token em storage privado criptografado, nunca em `settings`, com `expires_at`, rotação e versão da credencial;
- `ssx_sync_runs`: execução, modo, início/fim, cursor inicial/final, contagens, erro sanitizado e correlation ID;
- `ssx_http_metrics`: rota lógica, status, duração, retry e request ID, sem corpo.

### Catálogo e vínculos

- `ssx_tracked_units`: chave `(account_id, tracked_unit_type, tracked_unit_integration_code)`;
- `ssx_trackers`: identificador do rastreador e metadados permitidos;
- `ssx_unit_tracker_assignments`: unidade, rastreador, `tracker_slot`, início/fim;
- `ssx_workspace_vehicle_bindings`: unidade SSX, `vehicle_id`, `tenant_id` proprietário, início/fim, origem e estado de revisão; a função de escrita valida que o tenant e o veículo pertencem ao workspace da conta, e nenhuma associação é inferida apenas por serem tenants irmãos;
- placa serve para sugerir vínculo; confirmação deve usar o código de integração e não pode ocorrer quando houver ambiguidade.

### Posições

- evoluir `positions_raw` para funcionar como inbox privada (ou renomeá-la com migração): envelope minimizado por padrão, hash, conta e instante de recepção; payload integral somente quando necessário, criptografado e com retenção curta;
- `ssx_positions`: `provider_position_id` (`IdPosition`), unidade, `EventDate`, `UpdateDate`, ingestão, coordenadas, `ValidGPS`, evento, ignição, motorista, reboques, sensores, atuadores, telemetria e hash;
- até a SSX confirmar o escopo de `IdPosition`, dedupe por `(account_id, tracked_unit_type, tracked_unit_integration_code, provider_position_id)`; só reduzir para `(account_id, provider_position_id)` após prova de unicidade global;
- `workspace_positions_last`: uma posição promovida por vínculo/veículo por comparador explícito (`EventDate` primeiro; empate resolvido por `UpdateDate` e identidade determinística homologada), sem presumir que ID maior significa evento mais novo; views/RPCs de leitura aplicam o tenant autorizado do vínculo;
- `ssx_stream_cursors`: por conta/unidade/stream, com cursor temporal e/ou `last_provider_id` conforme a estratégia homologada, lease e backoff;
- `ssx_unmatched_records`: causa, identificadores, primeira/última ocorrência, tentativas e resolução, com payload restrito.

### Mutações e demais streams

- `ssx_outbox`: tipo, aggregate, idempotency key, payload versionado, estado, tentativas e próxima tentativa;
- `ssx_commands`: solicitação, aprovação, `IdCommand`, status SSX, timestamps e resultado terminal;
- tabelas normalizadas para violações, mensagens e eventos com o ID externo como chave idempotente;
- retenção explícita: raw curto e restrito; normalizado conforme necessidade operacional/LGPD; logs técnicos sem PII.

## 6. Cliente SSX e contratos

Criar um único módulo server-side, por exemplo `supabase/functions/_shared/ssx-client/`, com:

- rotas exatas do OpenAPI, sem prefixar `/v3` em endpoints que são sem versão;
- `v3/Tracking/PositionHistory/List` como posição canônica;
- DTOs gerados ou schemas Zod derivados de um snapshot OpenAPI versionado;
- validação estrita de request e response, incluindo `204` sem conteúdo;
- erros tipados: autenticação, validação, conflito, rate limit, indisponibilidade e resposta inválida;
- timeout por operação, retry apenas para erros transitórios e jitter;
- um único retry após `401`, precedido de refresh singleflight;
- respeito a `Retry-After`, se retornado, e cooldown por conta;
- correlation ID local, métricas e redaction centralizados;
- job de CI que baixa o OpenAPI, compara o contrato normalizado e bloqueia drift incompatível.

Remover do caminho normal:

- tentativas de vários nomes de propriedade sem evidência;
- múltiplos formatos de body em produção;
- leitura permissiva de propriedades alternativas;
- fallback automático entre produtos Tracking e Administration.

Fallback pode existir somente como compatibilidade configurada, comprovada e observável por conta.

## 7. Fluxos de integração

### 7.1 Onboarding e preflight

1. Confirmar com a Systemsat: produto Tracking habilitado, cobrança, dias de histórico, intervalo mínimo, limites, usuário e permissões.
2. Criar/obter `HashAuth`; obter `Hashcentral` apenas quando aplicável.
3. Cadastrar credencial com URL fixa e segredo protegido.
4. Validar login sem persistir query/body em log.
5. Validar os catálogos `Telemetry`, `Event`, `Sensor` e `Actuator`.
6. Executar uma consulta v3 curta e filtrada para uma unidade conhecida.
7. Conferir schema, timezone, ordenação, condição aceita e comportamento quando há exatamente 500 linhas.
8. Importar/reconciliar unidades e exigir revisão de conflitos.
9. Só então permitir canário de polling.

### 7.2 Login/token

- aplicar limites do Swagger: usuário 5–150 e senha 6–20;
- coletar `HashAuth` no onboarding e usá-lo nos módulos que o manual/contrato exigem; para PositionHistory v3 e RuleViolation v2, ativar somente após preflight provar a combinação aceita ou a Systemsat esclarecer a omissão do OpenAPI;
- nomear corretamente `Hashcentral` na UI;
- quando o token contiver `exp` JWT válido, usar como expiração efetiva o menor instante entre `exp` e um `ExpiresIn` saneado; se um deles for ausente/inválido, usar o outro com margem conservadora;
- renovar antes da expiração, com lock por conta;
- em troca de credencial, invalidar token e todos os backoffs dependentes;
- nunca obter um segundo token sem `HashAuth` a menos que Administration esteja contratado e habilitado separadamente.

### 7.3 Catálogo de unidades

Tracking não publica uma rota de catálogo completa de veículos. Portanto:

- modo padrão: lista/códigos fornecidos pelo onboarding + descoberta controlada em PositionHistory;
- modo opcional: Administration/Vehicle e Tracker, com capability, credencial, documentação e aceite próprios;
- unidades inativas sem posição recente não podem desaparecer silenciosamente;
- `TrackedUnitIntegrationCode` é a identidade externa principal;
- `IdTrackedUnit` é referência interna auxiliar;
- `IdTrackedUnitType=1` vai para frota; tipo 2 vai para pessoa/rastreamento humano, em fluxo separado;
- `TrackerSlot` e histórico de associação são preservados.

### 7.4 Polling de posições sem perda

1. Claim de uma unidade/stream, ou de uma janela da conta se os testes mostrarem que a consulta global é segura e mais eficiente.
2. Escolher a estratégia somente após homologação: cursor por `IdPosition` se unicidade, ordem e inclusividade forem comprovadas; caso contrário, janelas temporais adaptativas por unidade, com sobreposição.
3. Chamar v3 com pelo menos um filtro documentado e validar todos os registros; ordenar por `EventDate` e usar `IdPosition` apenas como desempate quando a semântica estiver comprovada.
4. Gravar inbox + normalizado + cursor na mesma transação lógica.
5. Tratar qualquer resposta com exatamente 500 registros como saturada, nunca como página completa.
6. Em saturação, subdividir a janela temporal até cada fatia ficar abaixo de 500 ou marcar o stream como bloqueado; não avançar cursor e não repetir cegamente a mesma consulta.
7. Se nem a subdivisão conseguir provar completude — por exemplo, mais de 500 eventos no menor intervalo aceito — interromper a ativação e exigir paginação/garantia da Systemsat.
8. Usar sobreposição temporal configurável e deduplicação por identidade externa composta/hash para lidar com atrasos.
9. `ValidGPS=false`, data futura, coordenada inválida, tipo errado ou identidade ambígua vão para quarentena e não para a posição atual.
10. Nunca interpretar resposta vazia como veículo parado.
11. Backfill usa filas e janelas limitadas; não usa `lookback_minutes=43200` em uma única consulta.

O comportamento de ordenação, inclusividade do filtro e paginação precisa ser confirmado em homologação com a SSX. Sem essa prova, não existe garantia de “sem perda”.

### 7.5 Telemetria e consumidores

- sincronizar o catálogo antes de normalizar `ListTelemetry`;
- mapear por `IdTelemetry`, preservar valor original e versão do mapping;
- promover apenas chaves canônicas conhecidas para ignição, odômetro, horímetro, combustível e baterias;
- guardar `EventDate`, `UpdateDate` e `ingested_at` separadamente;
- enfileirar somente veículos cuja última posição avançou;
- após commit, reavaliar estado, geofences, alertas e somente as viagens dos tenants explicitamente vinculados e autorizados para aquele veículo;
- o worker de cron deve ter uma API service-only própria para essa reavaliação, sem simular JWT de usuário.

### 7.6 Pessoas/motoristas

- sincronizar apenas pessoas reais; clientes PJ não pertencem ao schema `Person` do Tracking e, se esse sync for requisito, devem usar `Administration/Client` como capability separada;
- usar `PersonIntegrationCode` estável e nunca CPF como chave mutável/PII quando um UUID técnico serve;
- executar `ListPerson` para reconciliar antes de criar;
- criar com `InsertPerson`, atualizar com `UpdatePerson` e confirmar pelo código retornado/publicado;
- buscar `ListPersonRole` e validar `PersonRoleIntegrationCode` antes do update;
- dividir/normalizar DDI, DDD e telefone;
- não criar login SSX nem enviar senha de motorista sem requisito explícito e fluxo seguro separado;
- estados: `pending`, `sent`, `confirmed`, `conflict`, `failed`, nunca `synced` apenas por HTTP 200.

### 7.7 Módulos restantes da Tracking API

| Módulo | Direção/uso no AGVLog | Estratégia |
| --- | --- | --- |
| Event/Sensor/Actuator/Telemetry | SSX → AGVLog | catálogos versionados e cacheados |
| RuleViolation v2 | SSX → AGVLog | filtrar por `IdPosition` conforme o contrato atual; deduplicar pelo identificador retornado de violação e só usar `IdRuleViolation` como cursor se a Systemsat documentar ordem/filtro |
| EvaluationFormula/RuleList | SSX → AGVLog | leitura e reconciliação; não sobrescrever avaliação local sem decisão de produto |
| RuleCompatible/association | AGVLog → SSX | comando administrativo explícito via outbox e auditoria |
| Trailer | SSX → AGVLog | reconciliar implementos pelo integration code e associação temporal da posição |
| Fuel | bidirecional configurável | definir fonte de verdade; outbound por `FuellingIntegrationCode`, inbox deduplicado e conciliação |
| Geography | bidirecional configurável | definir autoridade; versionar geometry e usar integration code, sem delete direto automático |
| Message/Onboard | bidirecional | inbox/outbox, status por `IdCommandLog`, UTC explícito, anexos fora do escopo do schema |
| Command/free text | AGVLog → SSX | fila, confirmação e status terminal; timeout após envio deixa resultado `unknown` e exige consulta/reconciliação antes de novo POST |
| Block/unblock/cancel | AGVLog → SSX | feature flag própria, MFA, dupla confirmação/aprovação, motivo, auditoria e status; nunca automático nem reenviado cegamente após timeout |
| ShareTracking | AGVLog → SSX | gerar sob demanda, TTL, revogação e não persistir URL/token além do necessário; preferir portal próprio quando aplicável |
| Videotelemetry | sob demanda | obter URL somente ao abrir player autorizado, não cachear, mascarar log e respeitar janela de 15 s |
| Reports/Maintenance | SSX → AGVLog/on demand | cache por parâmetros, timezone e limites; não duplicar cálculos locais sem regra de precedência |

## 8. Segurança e isolamento

- capability de ingestão e kill switch no workspace; política de visibilidade/uso pode continuar por tenant;
- autorização pelo vínculo real em `workspace_memberships`, não pelo “melhor papel” encontrado entre tenants;
- RPCs públicas retornam DTOs explícitos, nunca `settings` brutos;
- manter tabelas SSX em schema privado; para qualquer objeto público, declarar explicitamente schema exposto, grants e RLS na migração — o rollout Supabase de 2026 remove a exposição automática de novas tabelas públicas no Data/GraphQL API e tem enforcement geral anunciado para 30/10/2026;
- funções `SECURITY DEFINER` ficam privadas, com `search_path=''`, validação interna de identidade e `EXECUTE` revogado de `PUBLIC`;
- service/secret key nunca vai ao browser;
- allowlist de host, HTTPS obrigatório, DNS/IP privado bloqueado, redirect desabilitado ou revalidado;
- senha, HashAuth, Hashcentral e tokens têm rotação, auditoria e referência de segredo;
- comandos de bloqueio exigem MFA recente, papel específico, justificativa e trilha imutável;
- LGPD: CPF, motorista, endereço e vídeo têm finalidade, acesso e retenção documentados.
- o dispatcher limita concorrência e fan-out; preferir fila/worker a cadeias de Edge Functions, considerando o limite mínimo vigente de 5.000 chamadas aninhadas por minuto em cada cadeia.

## 9. Observabilidade e SLOs

Indicadores mínimos por conta/workspace:

- sucesso e latência por rota SSX;
- idade do token e falhas de refresh;
- watermark e atraso de ingestão (`agora - EventDate` e `ingestão - UpdateDate`);
- respostas com 500 itens e quantidade de páginas/fatias drenadas;
- posições válidas, inválidas, duplicadas, sem vínculo e ambíguas;
- cobertura/frescor da frota, por workspace e tenant consumidor;
- fila: profundidade, mensagem mais antiga, tentativas, lease expirado e DLQ;
- mutações pendentes/confirmadas/rejeitadas;
- drift do OpenAPI;
- saúde do cron por execução real, não apenas HTTP aceito.

Alertas:

- P0: vazamento/escopo cruzado, cursor avançado sem commit, comando perigoso sem autorização;
- P1: 401 persistente, 429 recorrente, truncamento não drenado, posição fresca abaixo do limiar, fila > 2 períodos, DLQ crescendo;
- P2: catálogo desatualizado, drift compatível, unidade sem vínculo.

SLO inicial sugerido após o canário:

- 99,5% das execuções técnicas concluídas;
- 99% das posições válidas disponíveis no AGVLog em até 2 vezes o intervalo contratado;
- zero divergências não explicadas na janela/amostra de reconciliação acordada;
- 100% das respostas de 500 itens subdivididas até provar completude ou sinalizadas como bloqueio, nunca reconhecidas como completas;
- zero segredo/PII nos logs.

## 10. Testes obrigatórios

### Contrato SSX

- fixtures reais anonimizadas de cada resposta usada;
- request exato para todos os endpoints classificados como `implementar`;
- `200`, `204`, `401`, `409`, `415`, `429`, timeout, JSON inválido e `5xx`;
- condição `Equal` versus `=` e `GreaterThanOrEqualTo` versus `>=`;
- resposta com 499, 500 e mais de 500 registros acumulados;
- 500 registros dentro do menor intervalo aceito, que deve bloquear o stream em vez de avançar;
- ordem embaralhada, IDs repetidos, atraso e evento fora de ordem;
- `ValidGPS=false`, tipo pessoa, múltiplos trackers e `TrackerSlot`;
- timezone/DST e valores int64 preservados.

### Banco/concorrência

- dois polls do mesmo cursor;
- login simultâneo;
- remapeamento durante commit;
- falha entre inbox, projeção e cursor;
- replay após timeout incerto;
- timeout depois do envio de comando sem chave idempotente no provedor, que não pode provocar reenvio automático;
- claim vencido, worker atrasado e posição mais nova durante processamento;
- visibilidade cross-workspace/cross-tenant e revogação de acesso;
- rotação/exclusão de conta com jobs em andamento.

### Produto/E2E

- credencial → login → preflight → unidade → vínculo → posição → mapa;
- posição → estado → geofence → alerta → torre → portal;
- motorista insert/list/update/reconciliação;
- combustível/geografia/mensagem por outbox e replay;
- comandos com aprovação, polling de status e cancelamento;
- kill switch durante cada etapa e retomada sem duplicidade;
- canário 24–72 h e reconciliação amostral SSX × AGVLog.

Baseline revisado após o deployment em 10/09/2026: **114/114 testes SSX aprovados** em 16 arquivos, incluindo PostgreSQL, concorrência, polling, consumidores, encadeamento, contrato de segurança, dispatcher multiworkspace, pessoa, governança, violações, conflitos de mapeamento e fundação compartilhada. A validação de sintaxe aceitou 73/73 arquivos TypeScript de Edge Functions. Estes testes são evidência local e não substituem contrato ao vivo, homologação SSX nem canário.

### Estado de execução em 10/09/2026

- concluído localmente: allowlist/anti-SSRF, credencial e tokens criptografados, DTO seguro, redaction, gate explícito de Administration e PositionHistory v3 sem fallback automático;
- concluído localmente: janela adaptativa para o limite de 500, bloqueio sem avanço em saturação, validação de `ValidGPS`, tipo/identidade da unidade e quarentena;
- concluído localmente: registro SSX por workspace, dispatcher com claim/lease/CAS e cron único sem tenant fixo;
- concluído localmente: catálogos oficiais de atuador, evento, sensor e telemetria, substituídos atomicamente por conta no full sync;
- concluído localmente: snapshots backend-only de fórmulas de avaliação, cargos, carretas, regras visíveis, regras compatíveis por unidade e associações regra↔unidade, com substituição atômica e fan-out limitado;
- concluído localmente: `RuleViolation/v2/List` após o commit das posições, cursor por `IdPosition` tipado, sobreposição, janelas de até 50 milhões de IDs, subdivisão adaptativa no limite de 500, orçamento de 32 chamadas, avanço parcial seguro e deduplicação por `IdRuleViolation`; URLs efêmeras de vídeo não são persistidas;
- concluído localmente: pessoa física por `ListPerson` → `InsertPerson`/`UpdatePerson` → confirmação de `PersonIntegrationCode`; clientes PJ foram removidos do contrato `Tracking/Person` e o endpoint legado agora falha fechado;
- concluído local e remotamente: fila durável de conflitos unidade↔veículo, revisão manual auditada, isolamento pelo tenant ativo e índices em todas as FKs;
- estado remoto observado após reconexão: projeto Supabase `ACTIVE_HEALTHY`, 16 unidades/vínculos ativos e 86.976 posições históricas; 100% dessas posições possuem `IdPosition` válido e o Vault já contém `project_url` verificado para o dispatcher;
- decisão conservadora aplicada: não unir os tenants homônimos. O único membro do tenant secundário já pertence ao tenant principal; os workspaces podem permanecer isolados e somente o principal receberá a SSX;
- deployment remoto concluído: 27 migrations versionadas e 15 Edge Functions SSX/orquestradoras publicadas; o dispatcher foi desacoplado do pipeline de endereços e respondeu HTTP 200 em duas chamadas reais pelo segredo do cron;
- gate remoto pendente: regravação da credencial SSX pela UI, pois a conta atual está `invalid_credentials` com token expirado; `ssx_enabled=false` impede polling antes do preflight;
- homologação externa pendente: semântica de `QueryCondition`, ordenação/inclusividade, descoberta completa de unidades, limites e retenção, além de credencial executável para canário.

## 11. Plano de execução e gates

### Fase 0 — contrato e decisões externas

- confirmar produto/licença, limite, intervalo, histórico, ordenação/paginação e ambiente de homologação;
- definir se Administration e Trip serão contratados;
- congelar snapshot OpenAPI e fixtures.

**Saída:** matriz de contrato assinada e credencial exclusiva de homologação.

### Fase 1 — contenção P0

- allowlist/HTTPS/anti-SSRF;
- separar e rotacionar segredos/tokens;
- DTO seguro de conta;
- redaction de logs;
- capability/kill switch por workspace;
- atualizar o harness para o registro por workspace e corrigir qualquer falha funcional que permanecer.

**Saída:** nenhuma chamada arbitrária, segredo no browser/log ou falha de isolamento.

### Fase 2 — fundação canônica do workspace

- migrar conta, unidades, vínculos, posições, cursor e health para workspace;
- manter views/RPCs compatíveis para consumidores durante a transição;
- dispatcher/claim multiworkspace.

**Saída:** uma posição física única serve corretamente todos os tenants autorizados.

### Fase 3 — cliente tipado e ingestão v3

- cliente OpenAPI, login singleflight, catálogos;
- polling pela estratégia homologada, tratamento de saturação em 500, quarentena e backfill;
- `ValidGPS`, `UpdateDate`, tipo da unidade, slots e telemetria normalizada.

**Saída:** teste de carga sem resposta saturada tratada como completa e reconciliação sem divergência não explicada, duplicidade nociva ou posição inválida promovida.

### Fase 4 — consumidores operacionais

- fila service-only após commit;
- mapa, dashboard, estado, geofence, alerta, torre, app e portal;
- health/SLO dedicados.

**Saída:** jornada posição → decisão operacional automatizada e testada entre tenants do workspace.

### Fase 5 — pessoas e streams de leitura

- List/Insert/Update de pessoa;
- eventos, regras/violações, trailers e relatórios;
- reconciliação e UI de conflitos.

**Saída:** streams idempotentes e auditáveis, sem falso `synced`.

### Fase 6 — mutações de negócio

- outbox para abastecimento, geografia, mensagens e associações;
- status, retries apenas quando seguros, resposta incerta `unknown`, reconciliação antes de reenvio e DLQ.

**Saída:** mutações recuperáveis e conciliadas.

### Fase 7 — operações de alto risco

- share tracking, vídeo e comandos;
- bloqueio/desbloqueio somente após aprovação de segurança e procedimento operacional.

**Saída:** auditoria, MFA, dupla confirmação, status terminal e kill switch específicos.

### Fase 8 — rollout

1. laboratório com mocks/fixtures;
2. homologação SSX com uma unidade;
3. staging com 1–3 veículos por 24–72 h;
4. produção canário com um workspace e limites conservadores;
5. expansão gradual por lotes;
6. habilitação separada de cada módulo de escrita/alto risco.

Rollback é forward-only no banco. Em incidente: acionar kill switch, parar dispatcher, preservar inbox/outbox/cursor, reprocessar após correção e nunca apagar histórico para “destravar”.

## 12. Definition of Done

A integração só está “total e correta” quando:

- todos os endpoints escolhidos têm contrato tipado e teste;
- Tracking não depende implicitamente de Administration;
- nenhum segredo ou PII aparece no browser/log;
- uma resposta de 500 itens nunca é reconhecida como completa sem subdivisão/prova;
- cursor, inbox e projeção são recuperáveis e idempotentes sem depender de unicidade/ordenação não documentada;
- GPS inválido e unidade ambígua nunca contaminam a posição atual;
- workspace/tenant estão corretos em banco, Edge, cron e UI;
- todos os consumidores atualizam automaticamente após telemetria;
- mutações possuem outbox, reconciliação, auditoria e DLQ;
- comandos perigosos têm autorização reforçada;
- testes unitários, contrato, PostgreSQL, concorrência, E2E e soak passam;
- o canário atende SLOs e o rollback foi ensaiado.

## 13. Matriz completa dos 53 paths

Critério de classificação:

- `implementar`: faz parte do alvo funcional aprovado, ainda que em fase posterior e atrás de feature flag;
- `adiar`: só entra após decisão de produto, definição de autoridade dos dados ou gate de segurança específico;
- `não aplicável`: versão substituída, transporte legado ou mutação massiva que não pertence ao fluxo AGVLog.

| # | Path | Classificação | Fase e justificativa |
| ---: | --- | --- | --- |
| 1 | `/Login` | implementar | Fases 1/3; autenticação Tracking, refresh singleflight e contrato de `AccessToken`/`ExpiresIn` |
| 2 | `/Tracking/Actuator/List` | implementar | Fase 3; catálogo necessário para interpretar saídas das posições |
| 3 | `/Tracking/Command/SendFreeTextMessage` | adiar | Fase 7; comando externo auditado, com aprovação e reconciliação |
| 4 | `/Tracking/Command/EnableBlock` | adiar | Fase 7; operação crítica com MFA, dupla confirmação e gate próprio |
| 5 | `/Tracking/Command/DisableBlock` | adiar | Fase 7; operação crítica com MFA, dupla confirmação e gate próprio |
| 6 | `/Tracking/Command/GetCommandStatus` | adiar | Implementar junto do primeiro comando habilitado; obrigatório para reconciliar resultado |
| 7 | `/Tracking/Command/CancelCommand` | adiar | Implementar junto dos comandos; cancelamento é solicitação, não garantia de interrupção |
| 8 | `/Tracking/EvaluationFormula/List` | implementar | Fase 5; leitura/reconciliação, sem sobrescrever avaliação local automaticamente |
| 9 | `/Tracking/Event/List` | implementar | Fase 3; catálogo necessário para interpretar `IdEvent` |
| 10 | `/Tracking/Fuel/Insert` | adiar | Fase 6; depende da escolha formal da fonte de verdade e de outbox |
| 11 | `/Tracking/Fuel/InsertList` | adiar | Fase 6; mesmo gate de Fuel/Insert, com confirmação item a item |
| 12 | `/Tracking/Fuel/List` | adiar | Fase 6; habilitar somente após definir conciliação com abastecimentos locais |
| 13 | `/Tracking/Geography/List` | adiar | Fase 6; depende de autoridade e versionamento de geometrias |
| 14 | `/Tracking/Geography/ListKml` | não aplicável | Exportação redundante para o runtime; usar dados estruturados de Geography/List |
| 15 | `/Tracking/Geography/ListCategories` | adiar | Fase 6; catálogo auxiliar se Geography for aprovado |
| 16 | `/Tracking/Geography/ListGroups` | adiar | Fase 6; catálogo auxiliar se Geography for aprovado |
| 17 | `/Tracking/Geography/Insert` | adiar | Fase 6; mutação via outbox, com integração code e reconciliação |
| 18 | `/Tracking/Geography/Update` | adiar | Fase 6; mutação versionada e conciliada |
| 19 | `/Tracking/Geography/Delete` | adiar | Fase 6; exclusão externa exige confirmação explícita e trilha de auditoria |
| 20 | `/Tracking/LastPosition/ShareTracking/Activate` | adiar | Fase 7; geração sob demanda, TTL e controle de acesso |
| 21 | `/Tracking/LastPosition/ShareTracking/Deactivate` | adiar | Fase 7; revogação auditada do compartilhamento |
| 22 | `/Tracking/Message/List` | adiar | Fase 6; inbox somente após decisão de produto para mensageria Onboard |
| 23 | `/Tracking/Message/SendToOnboard` | adiar | Fase 6; outbox e estado de entrega |
| 24 | `/Tracking/Message/CheckSendStatusOnboard` | adiar | Implementar junto do envio para reconciliar status terminal |
| 25 | `/Tracking/Person/ListPerson` | implementar | Fase 5; reconciliação deve preceder insert/update |
| 26 | `/Tracking/Person/ListPersonRole` | implementar | Fase 5; validação de `PersonRoleIntegrationCode` |
| 27 | `/Tracking/Person/InsertPerson` | implementar | Fase 5; somente pessoa física, com estado `sent` até confirmação |
| 28 | `/Tracking/Person/UpdatePerson` | implementar | Fase 5; atualização por integration code estável |
| 29 | `/Tracking/Person/AutoGenerateIntegrationCode` | não aplicável | Mutação massiva no SSX; o AGVLog deve fornecer códigos próprios e estáveis |
| 30 | `/v3/Tracking/PositionHistory/List` | implementar | Fase 3; fonte canônica de posições, com filtro, saturação e quarentena |
| 31 | `/Tracking/PositionHistory/List` | não aplicável | Versão legada; somente compatibilidade temporária, explícita e observável por conta |
| 32 | `/Tracking/PositionHistory/ListSoap` | não aplicável | Transporte legado fora da arquitetura HTTP/JSON escolhida |
| 33 | `/v2/Tracking/PositionHistory/List` | não aplicável | Substituída pela v3; somente compatibilidade excepcional homologada |
| 34 | `/Tracking/Report/DriverRanking` | adiar | Sob demanda, após decisão sobre precedência versus indicadores locais |
| 35 | `/Tracking/Report/AreaPassage` | adiar | Sob demanda, após homologar timezone, filtros e limites |
| 36 | `/Tracking/Report/TrackedUnitUsage` | adiar | Sob demanda; não duplicar BDV local sem regra de precedência |
| 37 | `/Tracking/Report/TrackedUnitUsageConsolidated` | adiar | Sob demanda; mesma decisão do relatório de utilização |
| 38 | `/Tracking/Report/ActuatorsActivation` | adiar | Homologar: a descrição publicada aparenta referir-se a sensores |
| 39 | `/Tracking/Report/SensorsActivation` | adiar | Homologar: a descrição publicada aparenta referir-se a atuadores |
| 40 | `/Tracking/Report/DailyConsolidatedWorkday` | adiar | Sob demanda; validar regras trabalhistas e precedência com jornada local |
| 41 | `/Tracking/Report/WorkdaySteps` | adiar | Sob demanda; validar timezone e semântica das etapas |
| 42 | `/Tracking/Report/Maintenance/List` | adiar | Sob demanda; reconciliar com manutenção AGVLog antes de habilitar |
| 43 | `/Tracking/RuleCompatible/List` | implementar | Fase 5; leitura das regras compatíveis, sem associação automática |
| 44 | `/Tracking/RuleCompatible/SetAssociationOfTrackedUnitWithRule` | adiar | Fase 6; mutação administrativa via outbox e aprovação |
| 45 | `/Tracking/RuleList/ListRulesByUnitTracked` | implementar | Fase 5; leitura/reconciliação por unidade |
| 46 | `/Tracking/RuleList/ListUnitTrackedByRule` | implementar | Fase 5; leitura/reconciliação por regra |
| 47 | `/Tracking/RuleList/ListRuleOfLoggedUser` | implementar | Fase 5; catálogo de regras visíveis ao usuário da integração |
| 48 | `/Tracking/RuleViolation/List` | não aplicável | Versão legada; v2 é a rota canônica escolhida |
| 49 | `/Tracking/RuleViolation/v2/List` | implementar | Fase 5; inbox idempotente e cursor somente após homologar ordenação |
| 50 | `/Tracking/Sensor/List` | implementar | Fase 3; catálogo necessário para interpretar entradas das posições |
| 51 | `/Tracking/Telemetry/List` | implementar | Fase 3; catálogo necessário para mapear `ListTelemetry` |
| 52 | `/Tracking/Trailer/List` | implementar | Fase 5; catálogo e associação temporal por integration code |
| 53 | `/Tracking/Videotelemetry/GetURLStreamLink` | adiar | Fase 7; acesso sob demanda, autorização e consumo em até 15 segundos |

Esta matriz é uma decisão de escopo do AGVLog, não uma afirmação de que os endpoints adiados ou não aplicáveis sejam defeituosos. Qualquer mudança de classificação exige atualizar requisitos, ameaça, testes e gate de rollout do módulo.

## 14. Pendências que exigem resposta da Systemsat

1. `IdPosition` é globalmente crescente e o retorno é ordenado? Qual é a direção?
2. Como paginar/drenar resultados quando a consulta atinge 500?
3. Quais grafias de `Condition` são oficialmente suportadas em produção?
4. Há `Retry-After` e qual é o limite por HashAuth, usuário, IP e endpoint?
5. Qual é o formato/semântica exata de `ExpiresIn`?
6. `UpdateDate` pode retroceder ou mudar para a mesma `IdPosition`?
7. Qual timezone/formato é usado quando a data não contém offset?
8. Tracking permite descobrir todas as unidades, inclusive sem posição recente?
9. Administration exige produto/permissão/cobrança separados para esse cliente?
10. Quais eventos/telemetrias identificam odômetro, horímetro, combustível e ignição na conta de homologação?
11. Existe ambiente sandbox/homologação e unidade simulada?
12. Quais requisitos e responsabilidades operacionais se aplicam a bloqueio/desbloqueio?

Sem respostas ou prova empírica para os itens 1–4, o polling pode ser funcional, mas não pode ser declarado sem perda.
