# Pendências de integridade histórica — interface

`LegacyUnresolvedInventory({tenant,actor})` consulta a empresa inteira sem conta ou período. Integrado ao inventário temporal como painel independente; `includeUnresolved=false` permite ao coordenador apresentá-lo uma única vez antes da seleção de conta. Os fluxos atuais de associação foram preservados.

Consulta `get_finance_legacy_integrity_inventory` com empresa e página. O cliente valida escopo, totais dos grupos, classificação de conta e ausência de data válida. Os grupos de conta identificada e conta ausente/incompatível paginam separadamente pela mesma página. O painel informa que registros podem reaparecer no inventário por período e não devem ser somados entre contas. Motivos de pendência também podem se sobrepor.

Valor não validado permanece sem conversão nem soma; o dado original fica identificado como original, inclusive NaN ou infinito. Não se inventa data para encaixar um registro no período. IDs de origem e dados originais permanecem disponíveis para rastreio. Nenhuma ação de escrita ou associação automática é oferecida. Lista vazia não aprova adoção nem libera fechamento; erro de consulta não é apresentado como vazio.

Confirmações das associações de pagamentos/recebimentos e callback do inventário invalidam a nova consulta. Vinte e sete testes passaram, incluindo a manutenção dos dois fluxos de associação, consulta independente, opção de painel externo, fontes corretas e cliente. Lint passou. Códigos finais de pendência do banco foram mapeados; a frente de banco confirmou 12 testes SQL com schema real e 5 cenários PG17. Nenhuma migration editada nesta frente.
