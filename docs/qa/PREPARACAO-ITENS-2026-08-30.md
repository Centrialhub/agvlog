# Preparação de itens — contrato recuperável e evidências locais

Estado: **implementado e ensaiado localmente, não publicado**. Este lote não representa liberação integral do motorista/operação. Nenhuma migração ou alteração de negócio deste lote foi aplicada à produção.

## Falhas reproduzidas no legado

Sete testes executam a versão anterior de `upsert_load_item_v3` e demonstram valores negativos, valores não finitos, arredondamento silencioso de paletes fracionados, resultado físico registrado pela preparação, troca de identidade fiscal sem realocação da parada, mercadoria manual inserida em rota sem cobertura e inclusão de documento inadequado pelo caminho alternativo.

Os testes da candidata recusam esses mesmos desvios. Isso não significa que todos os outros escritores ou permissões de DML do sistema já tenham sido fechados.

## Contrato SQL candidato

Migração `20260830094049_harden_load_item_preparation_writer.sql`. Depende das candidatas anteriores de integridade carga/viagem, planejamento, composição, replanejamento e alteração documental. **Não aplicar isoladamente nem executar `db push` indiscriminado.**

- A assinatura de `upsert_load_item_v3` foi preservada. A função exige ator autenticado e operador/admin/owner ativo do tenant, bloqueia o grafo pai antes dos itens e recusa alteração de carga ou identidade da nota pelo caminho de preparação.
- Quantidade, peso e volume precisam ser finitos e não negativos; paletes precisam ser inteiros no intervalo suportado pelo banco. Valores nulos preexistentes de peso/volume são preservados em edições não relacionadas. Um verdadeiro no-op não altera timestamp nem gera nova auditoria.
- Preparação aceita apenas `pending`, `waiting_conference`, `in_stock`, `picking`, `ready_for_load`, `in_loading`, `loaded` e `divergence`. Trânsito, entrega, devolução e reentrega exigem o fluxo operacional; um resultado físico existente não é sobrescrito pela preparação.
- Pedidos são validados no mesmo tenant. Comprovantes e resultados de entrega impedem alteração. Mudanças de métricas/pedido de nota com emissão fiscal exigem revisão fiscal; anotações de preparação podem ser editadas sem modificar valores fiscais. Nenhuma emissão, cancelamento ou pagamento é chamado.
- Item manual novo só entra em carga sem viagem. A recusa em carga planejada evita mercadoria sem parada/comprovante, mas é **restrição provisória**, não conclusão do fluxo manual completo.
- Espelho fiscal e totais continuam sob os triggers próprios, sem uma segunda atualização fiscal redundante. A auditoria `item_preparation` contém antes/depois e participa da mesma transação.

Nova API `save_load_item_preparation(jsonb)`:

- Recebe tenant, carga, item (nulo para inclusão), valores, valores anteriores esperados e UUID da requisição. Em edição, cada campo enviado precisa ter seu valor anterior informado.
- Compara os campos editados sob lock: conflito no mesmo campo é recusado; alterações concorrentes em campos não editados são preservadas.
- Chave separada por tenant/ator, payload SHA-256 e resposta completa na mesma transação. Chave reutilizada com outro corpo é recusada. Membership é revalidada após a espera pela chave.
- Replay é consultado antes de exigir a existência atual da carga/item, permitindo recuperar confirmação de inclusão mesmo após uma exclusão posterior legítima.
- Ambas as APIs são executáveis por `authenticated`, com autorização interna; `PUBLIC`, `anon` e `service_role` não ganham execução. Helpers privados e políticas do cache são preservados.

A API legada permanece executável por `authenticated` para compatibilidade, já com as guardas de negócio, mas sem a revisão esperada e a chave exigidas pela API nova. A revisão/cutover dos demais escritores continua necessária.

## Frontend e ingestão

`useCreateLoadItem` e `useUpdateLoadItem` agora usam o contrato recuperável. `LoadItemsPanel` envia o valor de preparação que estava visível, associa labels aos campos manuais e não arredonda paletes fracionados. A coluna identifica preparação/registro legado; as opções físicas indicam o fluxo operacional e não podem ser usadas para forjar baixa.

A fila em armazenamento local tem versão, tenant, ator e escopo por carga/item. Persiste UUID e corpo antes do transporte, coordena abas com Web Locks e não substitui requisição incerta. Só confirmação correspondente limpa o registro. Erro SQL definitivo no primeiro envio pode liberar nova edição; um erro posterior não apaga a incerteza anterior. Mudança de contexto impede tratar a resposta da empresa original como sucesso na empresa atual.

`ItemPreparationRecoveryPanel`, montado globalmente em `AppLayout`, recupera a mesma solicitação após remontagem, independentemente da tela de origem. Não há reenvio automático. Armazenamento indisponível ou inválido bloqueia novos envios. A revisão orientada pela skill React manteve esquema versionado/mínimo, isolamento por contexto e estado incerto preservado.

`Ingestion` usa `prepareOrderItems` em vez do loop de RPC que silenciava falhas. O contador aumenta somente após confirmação. Uma falha interrompe os itens restantes daquela carga, preserva os já confirmados e apresenta resultado parcial com o pedido afetado. Resposta perdida após commit permanece recuperável, sem duplicar o item. Zero informado para paletes não é substituído pelo cálculo padrão.

**Limite:** o wizard completo ainda é multietapas, não uma transação única nem um lote integralmente retomável. Os fluxos de documentos, pedidos e limpeza legados precisam de revisão própria. A exclusão manual e o escopo das consultas existentes de itens também permanecem pendentes.

## Evidência de testes

- **105 testes novos em sete arquivos**: sete reproduções do legado; 25 de guardas SQL; 16 da API recuperável; 30 de fila/contrato; seis de painel/hook/SQL reais; 17 de preflight/recuperação; quatro de ingestão parcial/recuperação e apresentação de resultados.
- **119 ensaios PostgreSQL nativos aprovados**: 97 anteriores e 22 deste lote. Sessões reais cobrem chave repetida, payload divergente, edição concorrente, disputa por viagem/carga/documento/item/pedido/membership, revogação durante espera e corrida com partida.
- Fluxo cruzado: preparação → início → entrega. Resultado: carga `delivered`, viagem `completed`, dois comprovantes, duas notas entregues, identidade fiscal original preservada, um acerto `pending_review`, **zero pagamentos**. A coluna legada `load_items.status` não é tratada como fonte canônica de resultado físico.
- O ensaio de resposta perdida renderiza o painel real, usa hooks/fila reais e executa a candidata SQL; após remontagem, confirma exatamente o mesmo pedido sem segundo item. Os testes da ingestão executam o helper, fila, SQL e componente de resultados reais, não o wizard autenticado completo.
- **Gate completo aprovado: 1.378 testes em 123 arquivos**, TypeScript, lint de erros/críticos, baseline de qualidade, sintaxe das 40 Edge Functions, build e inspeção do artefato público. Node 22.23.2 / npm 10.9.4. Maior chunk: 488,3 KiB, abaixo do limite de 500 KiB. O artefato não contém source maps nem material secreto reconhecido pelas regras da inspeção; isso não equivale a auditoria irrestrita de segredos.
- Cobertura do subconjunto configurado: 93,03% statements/linhas, 65,83% branches e 81,81% funções, sem extrapolar para cobertura total do aplicativo.

As execuções iniciais não foram contadas como gates aprovados. Foram corrigidos a tipagem inválida de `exact` em seletores por papel (substituída por expressão regular ancorada, mantendo nome acessível exato) e o teste de contrato que ainda exigia chamada direta de `upsert_load_item_v3`. O contrato agora exige a API recuperável, proíbe a chamada legada direta no frontend e verifica a delegação auditada e a comparação dos valores anteriores. Nenhuma proteção de negócio foi removida para fazer o gate passar.

Uma tentativa nativa não foi contada como aprovada: a sondagem diagnóstica de lock tentou consultar uma tabela após o holder assumir `authenticated`, papel sem leitura naquela fixture. Foi acrescentado `reset role` apenas antes da sondagem de proprietário; nenhuma permissão da aplicação foi ampliada. A reexecução integral terminou com **119 aprovados e desligamento confirmado** do PostgreSQL descartável.

### Limites

PGlite usa esquema mínimo. O PostgreSQL nativo 17.11 roda localmente, em loopback, sem DSN de produção e com corpos/triggers operacionais e financeiros capturados. Não substitui Supabase completo, Auth/HTTP, Storage, RLS integrada, PostGIS ou Axe no navegador autenticado. A chegada do cenário cruzado é preparada pela fixture, não comprovação de GPS. Não houve chamada fiscal real.

## Recuperação protegida

[Contratos locais](ITEM-PREPARATION-LOCAL-CONTRACTS-2026-08-30.json) e [SQL de recuperação](ITEM-PREPARATION-RECOVERY-2026-08-30.sql) não são captura nem rollback executado em produção.

O roteiro verifica sete funções/privilégios e o contrato de coluna/RLS/políticas do cache. A barreira exclusiva espera escritores novos e legados; ambos participam dela. Recusa alterações de contrato, uso registrado no cache ou auditoria `item_preparation`, inclusive quando a chave já não existe. Não apaga auditoria/chaves nem desfaz negócios para forçar a guarda.

Antes do primeiro uso, remove a API nova e restaura exatamente corpo/ACL da versão anterior de `upsert_load_item_v3`. Depois de uso, o caminho esperado é corrigir adiante. A recuperação documental anterior agora recusa execução enquanto a API nova existir ou o corpo de upsert não corresponder ao predecessor, evitando remoção de helpers ainda usados por PL/pgSQL.

Passaram restauração/reaplicação antes do uso, recusa após entrega/financeiro, espera por commit concorrente, adulteração de corpo/grant/RLS/política/coluna e execução fora de ordem. Recuperação, verificação e reaplicação locais do lote sem uso: cerca de **576 ms**, sem previsão de duração em produção.

Hashes de definição, normalizados para LF:

- Predecessor `upsert_load_item_v3`: `62f819a77731d9fc694d7cd9bc4fe0db`.
- Candidata `upsert_load_item_v3`: `04a3da6fbb4fe20bf8fc0ef4d59d7908`.
- Candidata `save_load_item_preparation`: `effc26025f50cecaa5dd5c44818de186`.

## Produção e continuidade

Leitura independente nesta etapa confirmou `save_load_item_preparation(jsonb)` ausente e upsert com hash predecessor, `authenticated=true`, `anon=false`, `service_role=false`. Assessores: 140 alertas de funções privilegiadas, três RLS sem políticas e proteção contra senhas vazadas pendente. Não é revisão integral das funções.

Próximos passos: fechar DML direto/escritores legados; implementar baixa, reversão e reentrega atômicas no operacional; completar item manual até parada/comprovante/baixa; tornar exclusão e ingestão integralmente recuperáveis; validar Supabase completo e E2E autenticado; publicar SQL/Edge/frontend em ordem compatível. Não contornar a rejeição anterior dos triggers amplos nem publicar frontend contra RPC ausente.

Todas as cargas existentes estão autorizadas para testes. **Nenhum serviço pago adicional, emissão fiscal, pagamento ou reintegração SSX foi acionado.**

Referências: [funções e privilégios Supabase](https://supabase.com/docs/guides/database/functions), [revisão de SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [RLS sem políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [proteção contra senhas vazadas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
