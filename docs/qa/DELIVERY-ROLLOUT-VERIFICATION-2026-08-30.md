# Entregas — publicação privada, corte e recuperação

Estado: **etapa aditiva instalada em produção; APIs novas privadas; corte legado e frontend ainda não publicados**.

## O que foi publicado

- Migração `20260830050226_enforce_delivery_outcome_atomicity`, em 30/08/2026 05:02 UTC. O arquivo local foi alinhado à versão remota; não executar novamente com outro timestamp.
- Quatro helpers `SECURITY INVOKER` e duas APIs `SECURITY DEFINER`, todas sem execução por `PUBLIC`, `anon`, `authenticated` ou `service_role`. As APIs verificam identidade, motorista ativo, tenant, posse e vínculos da viagem.
- Índice parcial de idempotência dos eventos canônicos. Nenhuma carga, viagem, prova ou histórico é alterado pela migração.
- Os cinco corpos/ACLs legados permaneceram idênticos à captura anterior. Os assessores permaneceram em 140 avisos de funções privilegiadas para `authenticated`, três RLS sem política e proteção de senha vazada pendente; a etapa privada não aumentou a superfície pública.

## Fases e compatibilidade

| Fase | Estado | Efeito |
| --- | --- | --- |
| Aditiva privada | Publicada e verificada | Instala as novas funções sem expor dois caminhos de escrita simultâneos. APIs antigas continuam intactas. |
| Corte legado | Apenas local: `20260830050348_cutover_legacy_driver_delivery_writers.sql` | Na mesma transação, troca os wrappers, retira os agregadores implícitos e libera as duas APIs novas. Verifica hashes dos cinco contratos antigos e dos seis novos antes de executar. |
| Frontend compatível | Pendente | Exige resolver contratos GPS/carga/viagem, uploads e recuperação de envio, testar preview e estabelecer atualização dos clientes antigos antes da liberação coordenada. |

O alias de serviço `finalize_driver_delivery` ignorava `_fiscal_document_id`. O corte local agora exige correspondência exata quando um documento é informado, sem ampliar uma requisição de nota única para a parada inteira. O alias continua restrito a serviço e exige identidade de motorista no corpo.

Não foi feita publicação de frontend, revogação em massa, ativação de SSX ou chamada a provedor fiscal/pago.

## Efeitos interligados verificados

- Concluir uma viagem dispara `_on_dispatch_trip_completed_create_settlement` e `_build_driver_settlement`. O resultado novo atualiza cargas/documentos antes de concluir a viagem; o snapshot financeiro registra esses estados finais.
- O acerto automático fica `pending_review`, preserva ajustes em rascunhos e não reescreve acerto já aprovado. Não aprova, não paga e não chama sincronização de obrigações nessa transição. O financeiro permanece sujeito à revisão operacional.
- Os triggers de cliente/fornecedor, driver da carga e exclusividade CT-e/NFS-e usam `UPDATE OF` em outras colunas: uma mudança somente de status não os aciona.
- O trigger de liberação de notas de CT-e reage a documento `outbound` com falha. A nova entrega recusa vínculos de parada com documento que não seja `inbound`; os 156 vínculos existentes inspecionados eram de entrada. Os testes confirmam que resultados de entrega não limpam `cte_emitted_at`/`cte_emitted_outbound_id` nem alteram a autorização do documento de saída.
- Fixtures financeiras usam os corpos reais capturados e defaults/checks de colunas. Caminhos que não devem executar (sincronização financeira, exclusão de carga e cadastros automáticos) são instrumentados, sem acesso a fornecedores externos. Não são uma réplica completa de RLS/Storage/PostGIS.

## Prova no banco publicado

1. Chamadas reais das duas APIs negadas com `42501` para cada papel `anon`, `authenticated` e `service_role`: comportamento intencional da etapa privada.
2. Em transação revertida, execução pelo administrador do banco com a identidade do motorista atribuído, na viagem da carga 1012:
   - comunicação informativa interna;
   - resultado de falha nas 103 notas da parada; carga/parada `failed`, viagem `completed` dentro do ensaio;
   - replay retornou o mesmo evento, sem duplicação;
   - duas ocorrências internas, nenhum comprovante fabricado;
   - um acerto `pending_review`, 103 documentos, sem necessidade de recálculo, aprovação ou pagamento.
3. Identidade não atribuída recusada também na chamada pelo administrador do banco.
4. Após rollback, leitura independente confirmou hashes idênticos da carga, viagem, paradas e documentos; sete eventos e uma ocorrência originais; zero comprovantes/acertos. Consulta por marcador confirmou zero eventos/ocorrências QA persistidos.

Isso valida o corpo privado contra o esquema/triggers reais, **não** login JWT nem disponibilidade das APIs ao motorista. Prova com upload real e resposta da operação continua pendente.

## Recuperação ensaiada

- Antes de uso novo: `DELIVERY-CUTOVER-RECOVERY-2026-08-30.sql` restaura corpos/ACLs antigos e fecha novamente as APIs novas. Depois, `DELIVERY-ADDITIVE-RECOVERY-2026-08-30.sql` remove somente objetos novos, sem `CASCADE` ou exclusão de dados de negócio.
- Depois de entrega nova confirmada: não reabrir escritores antigos sobre provas novas. A recuperação preserva eventos, provas e índice de idempotência e coloca os escritores em quarentena; corrigir para frente. O script aditivo não remove evidência confirmada.
- Ordem errada, contrato alterado ou dependência inesperada abortam. Os scripts não foram executados em produção.

## Testes e limites

- Gate antes da instalação: **895 testes / 89 arquivos**; depois: **896 / 89**, incluindo um teste adicional de drift do contrato privado. Tipos, lint, baseline, sintaxe das 40 Edge Functions, build e inspeção do artefato público passaram. Maior chunk: 488,3 KiB.
- Suítes específicas: 69 testes de entrega no banco, 19 de rollout/recuperação, 12 de efeitos fiscais/financeiros, 31 de envio/retry e 11 da tela renderizada.
- Oito testes nativos multissessão passaram após a separação de privilégios. O executor tinha uma corrida `EPIPE` ao encerrar uma sessão SQL rejeitada; foi corrigida. Um cluster temporário remanescente da falha foi identificado pelo caminho/PID e encerrado; os ensaios seguintes terminaram com PostgreSQL encerrado. Arquivos de diagnóstico permanecem no cache ignorado.
- Browser integrado falhou na inicialização. Alternativa gratuita, Chrome isolado: `/driver/deliveries` redirecionou para `/auth`, Email/Senha/Entrar visíveis, nenhum erro de página; captura `delivery-stage-a-postdeploy-auth-2026-08-30.png` inspecionada e navegador fechado.
- Smoke é anônimo, não E2E autenticado. `.env.test.local` com a conta de QA ainda não está disponível. Testes renderizados simulam API/upload; não substituem verificação motorista → operação → portal.
- Ainda pendentes: carga 1003 e transições carga/viagem, escritores concorrentes restantes, GPS/PostGIS, fila durável, anexos/respostas, despesas, signup e revisão individual de privilégios, homologação/idempotência fiscal. **App ainda não liberado como 100% pronto.**

Contratos/evidências: `DELIVERY-ROLLOUT-PREDEPLOYMENT-2026-08-30.json`, `DELIVERY-STAGE-A-VERIFICATION-2026-08-30.json`, `DELIVERY-FINANCIAL-FUNCTIONS-2026-08-30.sql` e `DELIVERY-FINANCIAL-SCHEMA-2026-08-30.json`.
