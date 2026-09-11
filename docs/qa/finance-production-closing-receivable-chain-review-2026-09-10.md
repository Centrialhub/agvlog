# Revisão técnica sequência151949–192908 — 2026-09-10

Parecer local de escopo/efeitos/ACL após leitura dos contratos, DDL e corpos. Não autoriza ignorar recusa automática, pré-requisito, guard ou erro de aplicação. Nenhuma escrita remota por este agente. Preflights dependentes continuam aguardando autorização/confirmação do coordenador após140248.

| Ordem | Arquivo20260830 | Efeito e limite de implantação |
|---|---|---|
|1|151949 audit_delivery_document_metadata|Tabela append-only, API auditada de conferência, guard de escrita direta e aliases de resultado. Mantém dados antigos; mudanças futuras exigem API. Reentrega limpa conferência atual preservando snapshot da anterior. Nenhuma quitação/fatura implícita.|
|2|161722 make_closing_reports_attempt_aware|Somente fontes/leitura por tentativa. Original/atual/histórico separados; universo completo de rateio antes filtro. Limites500selecionados/2000relacionados recusam excesso54000, sem truncamento silencioso. Frete de tentativa nova0 com revisão explícita; não prova preço comercial novo.|
|3|165149 make_closing_drafts_atomic|Criação de cabeçalho/itens/resumos/history/ack na mesma transação; fontes relidas após locksNOWAIT e revisão, snapshotfingerprint. Importação planilha permanece nãoverificada e requer revisão. Revoga DML direto das tabelas fechamento e sequenceAPI; novos wrappersauthoperador. Guard congela valores/fontes e bloqueia fechamento sependência. Sembackfill dos legados.|
|4|174819 audit_closing_lifecycle_and_charge_claims|close/cancel/reopen/mark_sent auditados e replay. Reopenadmin; vínculos financeiros bloqueiam cancel/reopen simples. Claimsúnicos por documento/tentativa, locks compartilhados com cobrançaCTe. Consulta legados existentes para recusar duplicação sem criar claimsretroativos. lifecycle_revisiondefault0 é única inicialização de campo, não recálculo de negócio. APIs antigas revogadas.|
|5|183929 audit_receivable_payments_and_reversals|Comandos receive/reverse/reconcile; pagamento original append-only e reversão separada, bank_transactions credit/debit internos (não API bancária). Recalc atualiza projeções após fatos. Rever/reconciliaradmin, receberoperador. Gráficos/contas/tenant/revisão/reamembership conferidos. Revoga DMLpayments inclusive service e APIs antigas. FKs compostas do legado NOTVALID preservam registros anteriores; novos inserts conferidos. Sembaixa/reconciliação retroativa automática duranteDDL.|
|6|192908 audit_client_invoice_lifecycle|Geração, marcação de envio (apenasregistro), cancelamento/reativação auditados, títulos/vínculos/money preservados. Cancelamento somente net0 e grafo comprovado; releaseclaim mantémtrilha. Reativação revalida fontes/reservas antes reutilizar identidade. DMLdireto de fatura/charge/detail revogadoinclusive service; assemblerprivado semgrant. Histórico/listagens atuais são bounded20/500 comflag, não carteira temporal.|

## Critérios transversais

Não há atualização em lote de montantes financeiros existentes durante estas instalações. Novos triggers têm efeito imediato sobre UPDATE/DELETE futuro de registros antigos: dado financeiro legado inconsistente pode exigir revisão em vez de salvar edição genérica. Isso é comportamento intencional, não promessa de todoslegados editáveis. RLSusa autorização atual por tenant; novoshelpers semgrant salvo wrappers deconsulta/comando. Locks apósmembership são majoritariamenteNOWAIT e erro40001; requestlock esperaantesreautorização/replay.

can_accessfinancefalse não suspende as APIs públicas destas etapas: usam is_tenant_operator_or_admin. Portanto instalação não é ativação inerte de TODOproduto. Coordenar frontend compatível, sem teste destrutivo de negócio em produção, e seguir cadeia final antesabrir módulos. Nenhum desses SQL chama fornecedor fiscal, gatewaybancário, email ou SSX.

## Dependência fiscal concreta antes uso

192908 _client_invoice_draft_snapshot/create_client_invoice aceitam CT-e/NFS-e com valor/tenant/devedor compatíveis e não cancelados; esta versão isolada não exige statusauthorized/ambienteproduction completo. Não declarar validaçãofiscal final aqui. Instalar/verificar etapa20260831144530 e projeções financeiras posteriores conformemanifesto antespermitir usocanônico completo. Não alterar hash de192908 para incorporar mudança silenciosa.

## Execução pelo coordenador

Após140248 aprovada/aplicada, executar emordem os SELECTs docs/qa/finance-forward-preflight-20260830NNNNNN.sql. Resultadoall_passed deve sertrue no catálogo observado; então enviar arquivooriginal integral comguards/timeouts preservados, confirmarresultadoantespróximo. Os guards permanecem defesa contra mudança entre SELECT e aplicação. Verificar RLS/grants/triggers efetivos apósbloco e can_accessstaged preservado. Ausência deobjeto ou hashdivergente não autoriza pular/adaptar guard. Nenhum teste novo foi rodado nesta revisão.
