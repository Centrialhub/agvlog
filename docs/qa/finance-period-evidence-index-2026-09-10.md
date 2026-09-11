# Índice de documentos e intervenções do fechamento

`accountPeriodEvidenceIndex.ts` lê exclusivamente o registro preservado do fechamento. Identifica comprovantes de movimentos, extratos do período/abertura e decisões manuais de conciliação/reversão. Não consulta arquivos nem dados atuais e não altera a exportação original. Uma conciliação manual revertida continua identificada com autor, motivo e situação no fechamento.

O índice diferencia ausência explícita de comprovante e metadados/conjuntos indisponíveis. Não limita o processamento à página exibida. Importações repetidas na abertura e na cobertura do período aparecem uma vez pelo ID, com divergência de localização sinalizada.

Verificação: quatro testes unitários passaram, incluindo 1.005 comprovantes, importação repetida, exportação original inalterada, autoria após reversão e histórico de reversões incompleto. ESLint sem erros. O painel apresenta páginas de 30 referências e os caminhos como texto; não busca originais.

`20260910165830_finance_period_manual_audit.sql` inclui fechamento, reabertura, revisão do corte e composição tardia no filtro global de intervenções manuais. O sexto teste de `accountPeriodHistory.test.ts` executa reabertura real e confirma sua presença nesse filtro, com autor e motivo preservados. A rodada de histórico e índice terminou com dez testes aprovados.

Escopo ainda incompleto: o índice não abrange todos os documentos de despesas, folha ou carteira. A exportação bancária não substitui o pacote completo de relatórios previsto no plano. Não houve implantação remota.
