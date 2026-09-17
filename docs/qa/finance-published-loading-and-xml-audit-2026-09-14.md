# Revisão dos fluxos publicados — 2026-09-14

Base inspecionada: be98fec6 (Sites37 informado pelo root). Não houve leitura de credenciais, navegador ou mutação remota. Os arquivos de defeito abaixo não diferiam dessa base antes das correções autorizadas. Adiantamentos novos permanecem WIP excluído.

## Correções pontuais
ClosingReports descartava erro da consulta e renderizava Nenhum fechamento + KPIs zero. Agora pendente/refetch oculta linhas e ações da lista, KPIs ficam Não conferido; erro tem mensagem e retry; vazio somente após consulta concluída. Diálogos de comandos já abertos conservam sua própria prévia autoritativa e recuperação (não são desmontados por simples refetch da lista).
PayrollEntryDrawer descartava erro/loading dos itens e usava selectedEntry antigo se atualização falhasse. Agora valores da folha exigem a linha atual consultada; erro/pendente/entrada ausente são distintos; itens também distinguem erro/pendente/vazio e têm retry. Inclusão/exclusão/recálculo ficam indisponíveis enquanto qualquer consulta necessária não está conferida.

Verificação: financialPublishedLoadingStates.test.tsx — 3 testes comportamentais PASS, início16:45:28, saída0. ESLint dos3 arquivos saída0. TypeScript global/build não executados; root coordena. Allowlist SHA-256 separada. Nenhuma alteração no WIP de adiantamentos.

## XML de contas a pagar — diagnóstico, sem correção aplicada
FiscalXmlUpload lê o arquivo no navegador via parseFiscalXml e preenche campos. Payables applyXmlToForm guarda o mesmo File em pendingReceipt. Salvar chama uploadSecureFile legado (sem action finance_upload_v2), folder payables, kind financial. secure-upload scannerAccepts exige MALWARE_SCANNER_URL e MALWARE_SCANNER_TOKEN; ramo legado retorna503 malware_scanner_unavailable quando ausentes. Essa dependência permanece nesse caminho, embora gastos/extratos v2 tenham alternativas.

Ressalva importante: Payables handleSave captura a falha de anexo e CONTINUA criando/atualizando a conta. Logo o código prova falha de preservação do XML e comunicação ambígua, não prova que todo cadastro falhou. A interface pode mostrar erro de anexo e depois Conta criada. Sem arquivo/erro real do usuário não se deve atribuir toda falha de importação ao scanner.

A API v2 atual não aceita source_type payable nem formato xml. Seus derivados são JSON de OFX/CSV ou JPEG/PNG; expense_item exige gasto canônico e não equivale a payable. Portanto trocar apenas o action/folder ou usar expense_item falso seria incorreto. Para preservar XML com Supabase-only será necessária uma ponte aditiva específica que vincule original em quarentena ao título; não há reader/writer publicado para esse vínculo nos contratos inspecionados. Autofill local pode funcionar independentemente do anexo, desde que a UI distinga isso explicitamente e não afirme original anexado. Nenhuma segurança foi removida.

Parser existente reconhece NF-e por infNFe e NFS-e ABRASF por InfNfse/infNfse/Rps. Não reconhece toda variante NFS-e nacional por esses nomes; requer reproduzir com XML fornecido/sintético do layout afetado antes de afirmar causa do arquivo real. Leitura não dispara emissão fiscal.

## Limites
Inspeção não confirma estado de secrets/deploy atuais. A ausência de scanner é informação anterior da tarefa, não consulta remota independente desta rodada. Nenhum bypass genérico de RPC financeiro foi encontrado nesta leitura limitada; adaptadores financeiros amostrados usam bind(supabase) ou chamada de membro, preservando this. A revisão não certifica todas as rotas.
