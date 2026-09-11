# Reparação de projeção de descarga — confirmação recuperável

Entrega frontend local em 2026-09-10. A confirmação usa o transporte público fornecido pelo coordenador; não altera a origem da descarga, custo ou dinheiro. Não houve implantação remota nesta tarefa.

## Arquivos
- `src/lib/financial/unloadingProjectionRepairOutbox.ts`: persistência anterior ao envio, validação integral de resposta, WebLocks por empresa/autor, comparação do registro bruto antes de remover, preservação de pedido incerto e coalescência de envio idêntico.
- `src/components/financial/UnloadingProjectionRepairConfirmation.tsx`: revisão, motivo, declaração explícita, recuperação com IDs originais e reação a alterações de storage. Pedido de outra descarga é identificado e nunca reinterpretado como reparação da tela atual.
- `src/components/financial/UnloadingProjectionRepairDialog.tsx`: confirmação ligada somente à consulta atual elegível; consultas em carregamento ou erro ocultam elegibilidade. Invalida contexto, histórico, carteira, origem e demonstrativos após resultado.
- Testes próprios de outbox e confirmação; regressões do painel e entrada existente preservadas.

## Evidência
- 25 testes passaram: outbox (12), confirmação (4), painel (3), edição/entrada por FK (6).
- ESLint dos cinco arquivos de implementação/teste diretamente alterados: saída 0.
- Casos: resposta perdida e replay idêntico mesmo após mudança de revisão; rejeição conhecida inicial versus rejeição após incerteza; resposta com identidade divergente; armazenamento corrompido/sem espaço; competição entre abas; identificação de outro título; sucesso seguido de falha de atualização; ausência de confirmação em consulta indisponível.
- TSC não executado, conforme coordenação. Testes de SQL/promoção pertencem ao coordenador e ao autor do backend.

## Limites explícitos
WebLocks é obrigatório: ambiente sem esse recurso não envia reparação. A atualização de cache pode falhar após confirmação; o sucesso permanece confirmado e a tela bloqueia novo envio nessa instância. O formulário não oferece alteração da origem real nem regularização automática de dependências financeiras.

## Revisão final de atualização integrada
O Workspace usa `throwOnError:true` na invalidação das consultas da reparação e dos contextos associados. Um novo teste do Workspace confirma resultado público bem-sucedido seguido de rejeição real do reader: o aviso de atualização aparece, os dados anteriores são ocultados, o sucesso permanece e não há segundo envio. Rodada focal: 8 testes (painel 4 + confirmação 4), saída 0; lint dos dois arquivos alterados, saída 0. Sem TSC adicional.
