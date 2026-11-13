# Log de release — campos operacionais editáveis no romaneio

## Identidade e estado
Base publicada d9012c7a47ec1003d02ddabe9e26ed2fc0726b75. Checkout isolado C:/Users/Budinha Yamaguti/Downloads/AGV CAMPOS OPERACIONAIS. AGVLog qcvnsdrbcchaxvawcngk; ledger948/max20261111192940. Pedido: permitir editar dados operacionais, mantendo dados das notas protegidos. Preparação; SHA, gates e publicação registrados no PR.

## Contrato
Habilitar actual_load_at, gate_departure_at, arrival_at, driver_type, monitor_responsible, monitored, sm_manager e sm_release no formulário, schema e allowlist do comando existente. Datas manuais alteram o cabeçalho, sem emitir eventos de viagem/entrega ou alterar seus status/comprovantes/financeiro. Campos calculados de notas/itens permanecem bloqueados; criação automática do cadastro e placa derivada do veículo permanecem informações do sistema.

Salvar envia somente diferenças: compara timestamps na precisão de minutos da tela sem truncar segundos de dados não editados, preserva campos não editados e não tenta replanejar origem/destino/motorista/veículo quando somente uma data mudou. O backend mantém Auth/membership, tenant, CAS, idempotência, locks e auditoria. Em carga com viagem iniciada, permite exclusivamente os oito campos operacionais novos; os demais campos continuam sujeitos às regras de replanejamento/bloqueio. Três campos de data já participavam da revisão; acrescentar cinco campos de monitoramento/SM ao trigger de revisão evita sobrescrita concorrente. Monitorado exige boolean; textos <=160 caracteres e timestamps finitos.

## Estado anterior e retorno
Fontes completas das duas funções preservadas em load-fields-rollback-2026-11-12. MD5 prosrc apply_load_aggregate_command=1f88fddc3b0aada32f0fd724b396fa3b; bump_load_revision=2bbd79343d156c4499d61b06ea80c974. ACLs postgres/authenticated e postgres, respectivamente, preservadas pelo CREATE OR REPLACE. Forward incremental confere hashes anteriores; não reescreve históricos, tabelas ou dados. Sem db push. Retorno: frontend anterior, depois funções anteriores apenas após conferir que não houve outro hotfix; dados/auditoria já gravados ficam preservados. Formato de outbox/schema_version1 continua compatível; clientes antigos não escrevem os campos novos.

## Validação
28 testes focados aprovados: PGlite executa RPC/helper/trigger reais, grava datas e monitoramento, confere antes/depois, versão, repetição, estado obsoleto, tenant, valores inválidos, proteção de totais e bloqueio de roteiro em trânsito. Tela real com transporte isolado verifica edição, ISO/local e totais protegidos, inclusive aba de risco. Hook useUpdateLoad percorre outbox e RPC nativa no fixture. PGlite tem esquema Auth/financeiro parcial; não substitui PG17. Verificação nativa no CI exige os sete usuários sintéticos, executa criação/edição/repetição/negações e desfaz todas as gravações. Testes gerais de comandos antigos e pipeline237 aprovados/1skip preexistente. Typecheck, lint, qualidade, baseline46 e Quality completo exigidos no candidato. Workflow mantém alvo loopback55322, baseline privado e guardas existentes; apenas adiciona forward e verificação isolada.

Advisors security/health e logs consultados antes da alteração; health sem avisos. Sem novas permissões, RLS, função pública, Edge, Secret, SSX remoto ou emissão fiscal. Nenhuma carga real alterada para teste.
