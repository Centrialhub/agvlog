# Correção de complemento aberto — UI local

Implementação congelada em 2026-09-11. Nenhuma publicação, push ou escrita SQL remota por este agente. Allowlist exata de16 arquivos com SHA256: finance-open-complement-ui-allowlist-2026-09-11.json.

## Comportamento

A entrada contextual aparece no detalhe de um gasto ligado à descarga. Owner/admin/operator autorizados podem abrir a consulta; somente owner/admin e prévia atual com can_execute permitem confirmação. Ausência de RPC, erro ou atualização ocultam prévias antigas. Alterar o valor invalida a proposta.

A interface distingue custo original/vigente/proposto, vínculo reservado e complemento. Exemplo validado: custo150 para120, reserva100 preservada e complemento50 para20. Não usa a regra incorreta de tornar o pagável igual ao custo total. Alvo menor ou igual ao vínculo, pagamento, materialização e outras dependências seguem bloqueados, com a necessidade de plano explicada sem oferecer operação inexistente. Aprovação anterior exige reaprovação visível.

O overlay expenseCostOrigin.open_complement é opcional/null para compatibilidade. Histórico permanente preserva ator, motivo, data, pedido, valores anteriores/posteriores e aprovação retirada, com páginas20. Os contratos conferem identidade e diferença entre custo e complemento, sem converter diagnóstico desconhecido emzero.

Outbox exclusivo por empresa/ator protege abas com WebLocks, salva antes do transporte, preserva corpo original e efeitos esperados, confere todas as identidades da resposta e compara raw antes de remover. Resultado incerto mantém recuperação exata; rejeição definitiva só na primeira tentativa pode liberar pedido. Falha ao atualizar cache após confirmação não reabre possibilidade de nova execução.

## Evidências locais

Rodada62672 encerrou saída0:32 testes/6arquivos (13 novos de contrato/client/outbox/painel e19regressões de histórico/apresentação). Inclui alvo<=alocação bloqueado, valor de obrigação incorreto rejeitado, ator divergente, RPC ausente, recuperação após resposta perdida, preservação de outra aba, prévia desatualizada, operador sem confirmação e histórico de reaprovação. Lint dos16arquivos saiu0.

Native informou que os parsers foram aceitos por SQL real81653, incluindo segunda revisão, histórico e alvo<=alocado; essa execução pertence ao agente backend. TSC global autorizado64220 encerrou saída0 sem diagnósticos; log finance-open-complement-ui-typecheck-2026-09-11.log. Não houve ensaio navegador hospedado nesta rodada.
