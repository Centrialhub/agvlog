# App Motorista — roteiro executável do piloto

Este roteiro é o gate operacional final do módulo. Ele deve ser executado em uma
empresa de homologação, com 3–5 motoristas, 1–2 operadores e aparelhos físicos.
Nenhum dado ou credencial de produção deve ser reutilizado na preparação.

## Pré-condições de entrada

- branch Supabase temporária criada e migrations aplicadas em ordem cronológica;
- Edge Functions e segredos de homologação configurados;
- provedor de geocodificação contratado ou endpoint de homologação autorizado;
- conta SSX, veículos e trackers reconciliados sem associação ambígua;
- remetente e webhook de e-mail validados;
- PWA instalada pela tela **Instalar aplicativo** em todos os aparelhos;
- operador treinado nas telas **Canhotos**, **Geofences**, saúde SSX e divergências;
- viagem urbana, viagem rural e cargas NF-e, NFS-e, mistas, com e sem CT-e preparadas.

Se qualquer pré-condição falhar, o piloto não começa.

## Matriz de aparelhos

| ID | Plataforma | Perfil | Verificações obrigatórias |
|---|---|---|---|
| A1 | Android atual / Chrome | aparelho principal | câmera, GPS preciso, instalação, modo avião, retomada e atualização |
| A2 | Android de menor memória | aparelho de contingência | scan, assinatura, 10+ evidências pendentes e reinício |
| I1 | iPhone atual / Safari/PWA | aparelho principal | permissões, captura, instalação, modo avião e retomada |

Registrar modelo, versão do sistema, versão do navegador, espaço livre e versão
do PWA antes de cada rodada. Uma execução em emulador não substitui a evidência
em A1, A2 e I1.

## Cenários fiscais e operacionais obrigatórios

Para cada linha, guardar IDs da empresa, viagem, parada, entrega, canhoto e lote
de envio; hash do original/processado; horário; aparelho; capturas da tela do
motorista e do operacional; e resultado `PASSOU`, `FALHOU` ou `BLOQUEADO`.

| # | Cenário | Resultado esperado |
|---:|---|---|
| 1 | entrega com uma NF-e | um canhoto, assinatura separada e PDF individual |
| 2 | entrega com várias NF-e | um canhoto associado a todas as notas |
| 3 | entrega somente com NFS-e | confirmação sem CT-e e documento pesquisável |
| 4 | entrega com várias NFS-e | um canhoto associado a todas as notas |
| 5 | entrega mista NF-e + NFS-e | um único canhoto na página operacional, ligado aos dois tipos de documento |
| 6 | entrega sem CT-e | nenhuma validação ou envio bloqueado pela ausência |
| 7 | entrega com CT-e relacionado | CT-e exibido apenas como documento relacionado |
| 8 | documentos de fornecedores diferentes | grupos separados por fornecedor, sem duplicar canhoto |
| 9 | entrega parcial | quantidades, devolução, motivo, canhoto e assinatura preservados |
| 10 | reentrega | nova entrega/tentativa com novo canhoto, histórico anterior intacto |
| 11 | substituição operacional de scan | original preservado, versão e auditoria da substituição |
| 12 | canhoto físico ausente no retorno | ocorrência, bloqueio normal e dispensa apenas por proprietário/administrador com justificativa |
| 13 | captura completamente offline | arquivos sobrevivem a fechamento e reinício; ACK posterior sem duplicação |
| 14 | falha de e-mail e reenvio | mesma composição congelada, status/auditoria e reenvio determinístico |

## Ensaios de geofence e SSX

Executar em rota real, mantendo os horários brutos das posições SSX:

1. destino geocodificado automaticamente e confirmado no mapa;
2. destino ambíguo corrigido por endereço ou marcador, com auditoria;
3. entrada e saída rápidas dentro do mesmo lote de posições;
4. oscilação na borda sem eventos repetidos;
5. GPS do aparelho impreciso ou negado sem registrar chegada;
6. placa/tracker ambíguo bloqueado para revisão;
7. conta SSX ausente exibida como indisponível, nunca saudável;
8. posição atrasada, fila atrasada e recuperação após indisponibilidade.

Durante as primeiras 72 horas, comparar cada chegada/saída registrada com as
posições brutas. O período reinicia após qualquer correção do motor de geofence,
associação viagem–veículo–tracker ou consumidor SSX.

## Ensaios offline e de recuperação

- alternar modo avião antes de chegada, saída, entrega, despesa, jornada,
  checklist, ocorrência e conferência de carga;
- encerrar o PWA depois de salvar cada comando e reabrir ainda sem rede;
- reiniciar A2 com pelo menos dez arquivos pendentes;
- interromper upload e reconectar com token válido e depois expirado;
- repetir sincronização e verificar o mesmo `request_id` e ausência de duplicidade;
- publicar uma atualização do shell com pendências e confirmar que elas permanecem;
- cancelar/alterar remotamente uma parada e confirmar que o registro local vai
  para conferência, sem ser apagado;
- efetuar logout e troca de empresa, confirmando isolamento dos dados locais.

## Indicadores e limites do piloto

| Indicador | Limite de aprovação |
|---|---:|
| perda de canhoto, assinatura, foto ou comando durável | 0 |
| entregas ou eventos duplicados após retry | 0 |
| avanço para próxima parada sem evidência durável | 0 |
| vazamento entre empresas/usuários | 0 |
| chegada aceita sem GPS | 0 |
| entrega NF-e/NFS-e bloqueada por ausência de CT-e | 0 |
| associação SSX ambígua aceita silenciosamente | 0 |
| e-mail marcado como entregue sem callback correspondente | 0 |
| falha crítica sem caminho de recuperação | 0 |

Tempos de scan, sincronização, geocodificação, fila SSX, geração de PDF e envio
de e-mail devem ser registrados por percentis p50/p95. O alvo inicial do scan é
até três segundos em A2; qualquer relaxamento exige aceite explícito de Produto.

## Cadência dos sete dias

- **Dia 0:** preparar dados, aparelhos, responsáveis e baseline de saúde.
- **Dias 1–3:** gate de 72 horas para SSX, geofence, durabilidade e duplicidade.
- **Dias 4–6:** ampliar rotas, documentos mistos, contingências e retorno físico.
- **Dia 7:** conciliar canhotos, filas, e-mails, despesas e ocorrências; revisar
  indicadores e assinar a decisão de expansão.

## Critério de parada e decisão final

Suspender novas viagens se houver perda de evidência, vazamento entre empresas,
duplicidade financeira/operacional, avanço indevido de parada, chegada sem GPS ou
fila local irrecuperável. Preservar aparelho, versão, logs e registros locais para
diagnóstico; não limpar o armazenamento antes da coleta.

O piloto só é aprovado após sete dias completos, 72 horas contínuas de estabilidade
de SSX/geofence, todos os 14 cenários aprovados, conciliação física concluída e
nenhum defeito P0/P1 aberto. Registrar responsáveis de Produto, Operação, QA e
Engenharia, data/hora da decisão e riscos residuais aceitos.
