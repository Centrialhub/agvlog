# Conta unica AGV/LIRA: continuacao da homologacao nativa

A fonte integrada 85527443 passou validate completo e os shards executados ate
esta etapa, mas a homologacao real encontrou dois problemas que testes SQL
parciais nao demonstravam. Nenhuma alteracao desta frente foi publicada.

## Criacao real por GoTrue

O handler anterior enviava somente os marcadores de usuario e tenant. O BEFORE
INSERT acrescentava os marcadores de workspace verificados pelo banco, mas uma
atualizacao posterior feita pelo GoTrue usava os metadados originais. O guard
de credenciais diferido recusava o commit com driver_credential_command_required.
A transacao inteira foi revertida: nenhum usuario sintetico permaneceu.

O handler agora transporta tambem o workspace persistido no cadastro consultado
no backend. Ignora qualquer workspace fornecido no corpo da solicitacao e
recusa um cadastro sem workspace antes de reservar o acesso. A reserva privada,
validacao do grafo e todos os guards existentes continuam obrigatorios. Nao foi
alterada a migration para tolerar a perda dos marcadores nem dispensado o guard
de alteracoes de senha. Os testes focados do handler e banco passaram: 51/51.

## Execucao de pgTAP

O comando da CI apontava implicitamente para .local-staging/supabase/tests,
onde nao ha testes: Result NOTESTS, exit1. O workflow passa agora explicitamente
o diretorio dos testes versionados. A execucao diagnostica dos tres arquivos
originais realizou 175 assertions; duas esperavam mensagens anteriores ao guard
operacional atual. As duas continuam exigindo SQLSTATE42501 e agora exigem a
mensagem exata driver_operation_not_authorized. Nenhuma permissao ou guard foi
alterado, e as assertions de despesas de motorista permanecem preservadas.

## Bloqueios ainda abertos

O lint bruto continua exit1 com31achados:21assinaturas legadas incompatíveis e
10achados de contexto/dinamismo/PostGIS. A triagem de01/10 ja documentava essa
divisao. Nao remover APIs, fabricar tipos/campos ou mudar ACLs para obter PASS.
O inventario de consumidores externos e as decisoes por contrato continuam
necessarios. A coleta diagnostica e a homologacao especifica de conta unica
nao convertem o job database-and-e2e em aprovado.

Repetir o handler real corrigido, login por senha, troca de tenant assinado,
interface e limpeza exata das identidades sinteticas. Os recibos nativos e
demais gates devem identificar o novo SHA, sem reutilizar85527443 como se
contivesse esta correcao. Producao permanece na publicacao DOT a90eb6c.
