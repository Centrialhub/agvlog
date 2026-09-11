# Histórico capturado de recebíveis — UI — 2026-09-10

Botão global **Histórico de alterações** na página `Receivables.tsx`, independente da lista atual de títulos. Abre `ReceivableHistoryDialog` protegido por `FinanceAccessBoundary`, com workspace identificado por empresa/usuário. Permite consultar todos os eventos ou filtrar por UUID de título, inclusive excluído.

O painel usa somente `readReceivableHistory` e o contrato fornecidos pelo coordenador. Não escreve dados, não altera `ReceivableFinancialDialog` e não calcula saldo histórico.

## Apresentação

- Início e tipo de cobertura, baseline observada e passado anterior desconhecido.
- Contagem de eventos, não títulos/receitas. Página de 50, revisão preservada na navegação; resposta 40001 reinicia a primeira página com aviso.
- Antes/depois: nominal e baixas em centavos exatos, referência, descrição, vencimento, status, ID/nome do devedor preservado e IDs das origens. Null permanece indeterminado.
- Criação/alteração/exclusão/baseline com ID do título, captura e autor. Usuário autenticado não é automaticamente rotulado intervenção manual; sistema identificado separadamente. Nenhum motivo ausente foi inventado.
- Datas e sequência de captura não são descritas como visibilidade ou ordem de commit. Limitações e campos inválidos recebem rótulos legíveis.
- Consulta pendente/erro esconde os eventos anteriores. Filtro e paginação pertencem ao escopo de cache `finance-receivable-history`, com empresa e usuário.

## Verificação

Seis testes em `receivableHistoryPanel.test.tsx` passaram: tombstone/valores/autoria, filtro UUID e troca de revisão, stale/erro, sistema/null, acesso financeiro recusado de perfil misto sem executar consulta e filtro explícito de título fora da lista atual. ESLint dos quatro arquivos alterados passou. Nenhum TSC executado, conforme coordenação.

Arquivos de produto: `ReceivableHistoryDialog.tsx`, `ReceivableHistoryEvent.tsx`, integração `src/pages/Receivables.tsx`. Contrato/client/SQL continuam sob propriedade dos outros agentes. Nenhuma implantação remota.

Revisão de recuperação: a query key agora inclui uma geração de consulta incrementada após revisão alterada (40001). Isso força uma nova primeira página mesmo com `staleTime: Infinity`, sem reutilizar a revisão anterior em cache. Teste adicional comprovou três chamadas (primeira, segunda rejeitada, primeira renovada), apresentação da versão nova e ausência da antiga. Rótulos de navegação: Página anterior / Próxima página. Sete testes UI passaram; lint dos arquivos modificados passou. Sem TSC.
