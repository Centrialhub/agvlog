# Operador — ocorrências da viagem e falhas de leitura

Estado: correções locais validadas; publicação pendente.

## Problemas reproduzidos

- A ocorrência criada pelo motorista chegava a operational_events e à página
  global de eventos, mas não aparecia no detalhe da viagem da Torre.
- Uma falha ao consultar a carga era exibida como “Carga não encontrada”.
- Uma falha ao consultar dispatch_trip_loads era interpretada como ausência de
  viagem, permitindo uma orientação operacional incorreta.

## Correções

- useTripOperationalEvents consulta por tenant e dispatch_trip_id, inclui o
  usuário na chave de cache, não repete erro automaticamente e valida todas as
  linhas retornadas antes de renderizar.
- TripOperationalEventsPanel diferencia carregamento, erro recuperável, vazio
  confirmado e resultado. Exibe rótulos humanos, descrição, severidade e o
  escopo Somente operação, Visível no portal ou Ação necessária.
- O painel foi incluído no drawer da Torre e no detalhe da carga vinculada.
- LoadDetail separa erro de inexistência, oculta dados anteriores após falha e
  bloqueia a transição para in_transit enquanto o vínculo não estiver
  confirmado.
- OperationsCenter ganhou atalhos para Torre de Controle e Eventos
  Operacionais, sem substituir a correção de telemetria já presente.

## Validação

- 21 de 21 testes novos e focados passaram.
- Regressão da Torre passou.
- Lint dos arquivos alterados passou sem erro ou aviso.
- git diff --check passou.
- Um cenário antigo de planningScreens continua expirando no seletor Radix; os
  dois novos casos de falha de leitura e os demais seis cenários passaram.

Nenhuma mudança deste bloco foi publicada. Nenhuma emissão fiscal, chamada SSX
ou provedor externo ocorreu.
