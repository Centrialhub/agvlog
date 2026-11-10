# Despacho aproveita a roteirização e as entregas da carga

## Identidade e estado

Base e alias público conferidos: `0a288b4a4d87bad36a8ae00c0969a26bed833992`, build `3c2258d796fa006c`, backend `qcvnsdrbcchaxvawcngk`. Checkout isolado em C: autorizado pelo usuário, branch `codex/reuse-load-routing-20261110`. Banco, Auth, RLS, RPCs e Edge Functions não mudam. Nenhuma viagem real é criada e nenhuma emissão fiscal é testada.

SHA candidato, run completo e publicação final serão registrados na descrição do PR. A validação final usa CI isolado, contrato do alias e revisão do fluxo; a dispensa anterior do smoke autenticado final permanece respeitada.

## Defeito e comportamento

O modal de despacho descartava as entregas e criava uma única parada com `load.destination`, localização nula e todas as notas. A confirmação manual era exigida mesmo quando um planejamento já havia definido as paradas. Na carga indicada pelo usuário, a leitura revelou 74 notas, 44 clientes, nenhum planejamento persistido e nenhum cliente com localização verificada. O nome de uma rota comercial não é coordenada física.

Ao abrir Despachar, a preparação consulta rascunhos da empresa que incluem a carga. Um único planejamento da carga é reaproveitado com ordem manual, locais verificados, horários, janelas, serviço, notas, motorista e veículo. Documentos ausentes/repetidos, composição alterada, destinatário alterado, planos concorrentes ou rota com outras cargas não são divididos silenciosamente: a tela mostra o motivo e permite abrir a Roteirização. A versão do rascunho é relida antes de enviar.

Sem planejamento salvo, a mesma consolidação e sequência automática do roteirizador monta as paradas por entrega, preservando destinatário e fornecedor e distribuindo todas as notas. Coordenadas verificadas dos clientes são reutilizadas pela RPC existente. Endereços completos ainda sem ponto são pesquisados automaticamente, em no máximo três chamadas simultâneas, com reaproveitamento por endereço. Só um resultado único, confiança >= 0,8 e precisão <= 150 m é aceito. Ambiguidade, baixa precisão, falha de serviço ou endereço incompleto permanecem pendentes; não há coordenadas padrão nem exceção operacional inventada.

O geocodificador é consultado sem alvo de entidade, aproveitando seu cache existente, sem marcar cadastros de clientes como verificados. O ponto aceito será persistido somente pelo despacho oficial já existente, quando o operador confirmar. A preparação é cancelável e resultados atrasados não atravessam usuário, empresa, carga ou reabertura do modal. A distribuição das notas fica recolhida para revisão opcional; as pendências são contadas no topo.

## Verificação e limites

Testes focados exercitam a preparação real com transporte isolado e as telas: sequência salva, preservação de horários/notas, geração por notas, isolamento de empresa, deduplicação de pesquisas, locais já verificados, resposta ambígua/imprecisa/offline, cancelamento, documento ausente e revisão obsoleta. Testes de tela mantêm os cenários de validação/exceção e envio idempotente pelo outbox, acrescentando despacho direto de roteiro verificado, erro de preparação e versão alterada. Não simulam aprovação de uma execução autenticada em produção. O Quality gate completo é exigido antes da promoção.

Automação organiza as entregas usando as regras atuais do roteirizador; não promete otimização por distância real nem transforma nome de cidade/rota em ponto exato. Cadastros sem endereço utilizável ainda precisam de revisão. Rotas com múltiplas cargas são despachadas juntas pela tela de roteirização, preservando a proteção contra despacho parcial.

## Retorno

Retorno do frontend ao SHA anterior é compatível com as viagens gravadas: não há novo formato persistido, RPC, banco ou Edge Function. As viagens continuam sendo criadas por `dispatch_planned_route_v3` e pelo mesmo outbox com chave idempotente. Não remover viagens nem alterar seus documentos como retorno.

## Orientação operacional

Atualize a página e abra a carga → **Despachar**. Aguarde o carregamento da rota e a busca dos endereços. Confira motorista e veículo, revise somente os locais pendentes e clique em **Criar Viagem**. As notas já estarão distribuídas pelas entregas. Um planejamento salvo mantém sua sequência; roteiros com outras cargas devem ser despachados completos pela **Roteirização**.
