# Prova de origem do registro de movimento

185517 acrescenta movement_recording_origin, helper privado que verifica a correspondência entre movimento, um único comando record_movement e um único evento recorded. Confere autoria, campos financeiros, referência, comprovante, motivo e resultado confirmado. Conserva todas as evidências consultadas no snapshot e deriva a revisão desse conjunto. O ID do movimento continua separado do pedido original.

Valores normalizados pelo escritor são reconhecidos: espaços em textos, opcionais vazios, centavos com zeros à esquerda e grafia equivalente de UUID no payload. Comandos concorrentes que usam grafia equivalente de UUID no resultado entram na contagem e tornam a origem ambígua. Payload com campos que o escritor não permite é inconsistente. Não altera o comando nem tenta escolher automaticamente uma das origens concorrentes.

Sete testes PGlite passaram: registro real com normalização, origem não comprovada, comando de outra ação que aponta ao mesmo ID, duas origens concorrentes, divergência financeira, evento ausente/incompatível, campo de payload não permitido e limites de acesso por empresa/motorista. ESLint aprovado. A revisão independente apontou a comparação textual de UUID no filtro e a ausência da lista de campos permitidos; ambos foram corrigidos e exercitados antes de congelar a versão.

SHA256185517 `d2e4601ab095e1245845036ab5c0965425e3f89443962789ca19690e6b1eaa2e`. Tabelas e helper não ganham escrita pública ou execução de aplicativo. verified comprova somente a origem registrada: não comprova ausência de pagamentos, conciliações, períodos fechados, ciclos ou outras dependências. Esses controles ainda antecedem qualquer comando de invalidação. Nenhuma alteração remota ou envio financeiro.
