# Revisão financeira132411→140010

10/09/2026. Nove arquivos posteriores132406 e anteriores140500; não existe140500. Leitura integral concluída, hashes em finance-production-block-132411-140010-hashes-2026-09-10.json. Instalação INATIVA aceitável condicionada a preflight de catálogo e ausência de sobreposição com custódia. Nenhumcron criado, nenhumcan_access redefinido. Sem aplicação/PG/TSC/testes novos.

| Ordem | Arquivo | Pré-condição e efeito |
|---|---|---|
|1|132411 settlement_link_reversals|130540/130921 e auditoria existentes, UNIQUEpayment_id original presente. Abre histórico de múltiplas associações, garante única ativa porguard sobfinancelock. Reversão preserva pagamento/dinheiro. Atualiza movement_used_cents e leitor para excluir vínculo revertido, mantémhistórico.|
|2|133352 payroll_lifecycle_serialization|Sete writersfolha PLpgSQL+argumentosoriginais; approve contém os2needlesuppercase. Envolve prosrc atual sem substituir wrapper235237. Locksfinance→periods→entries; reauth; revoga browserDML e guards rowfirsttrylock. Stagefalse bloqueia folha inclusivewriterprivilegiado via trigger; semrecalc de folha existente duranteDDL.|
|3|133355 new_settlement_payment_candidates|movement_used_cents, pagamentos/acertos; leitor20 comcount completo, saldo comprovado, revisão obrigatória. Usa rawmovements inicialmente;184543 posterior ainda necessário antesvoid.|
|4|133421 settlement_payment_recording|active_payable_payments/folha/linksguards existentes; public/privatewriter novos devem estar ausentes. Registra pagamento contra saída existente, semnovo cash/custo. Reauthapóslocks; bloqueia folha protegida/overlap, atualiza folha mutável comalready_paid e totals. Finance→periods→settlement→entries; nãoinventa extrato.|
|5|133700 retire_legacy_settlement_payment_writers|133421+133355 presentes; doisregisterwritersPLpgSQL existentes, aceita outerguard235237. Revoga todosDMLpaymentsinclservice; append-only+constraintdeferred exige link. Aposenta doiswriters, não exclui histórico. Efeito imediato: legado não pode mais registrar pagamento avulso.|
|6|134943 settlement_expense_context|expensebatch/item/allocation/payables+activepayments/commands. Leitor30 e totalglobal; payee_type da declaração original, não inferido do fornecedor. Índice de commandbatch; nenhumvalor alterado.|
|7|134948 canonical_trip_cost_settlement|132406deduplicate_payroll_reimbursements e builderoperacional final comtodosanchors. Aceita explicitamentev2 ouv3attempts semreverterreentrega. Incorpora custocanônico uma vez emresultado e snapshot, não adiciona créditomotorista. Triggeritemnovo marcaacerto desatualizado semreescrever aprovado/pago; atualiza guarddeorigem dafolha para custocanônico exato.|
|8|135125 retire_bulk_obligation_projection|writerfinancial novo e _tg_sync_obligations_from_expense auditado203548. GuardbuscaTODOSdependentes sync_financial_obligations; qualquerextra aborta. Trêstriggers viramnoop e batchsyncaposentado; obrigaçõesexistentes ficam, expenseguard individual continua. Semapagardados/baixas.|
|9|140010 account_opening_balances|statement_period_evidence130956 e auditoria, account_type real. Novo abertura/reversão imutáveis; abertura bancária exige âncoraSPdiaanterior+revision, caixa recusado até141240. Nenhumopening gerado noDDL. Leitor calcula posição registrada ancorada; can_closefalse nestaetapa. Guardfechamento futuro ainda necessário.|

## Riscos de precedência reais

Nenhum dosnove depende da soma inline do snapshotreceivable183929;192908delegação não causa erro equivalente011121. 133352 usa outerblock sobrebodycom235237, preservando require_access; checar corpoPLpgSQL/argsantesexecutar pois não háfallback de linguagem. 134948 depende anchors textuais exatos do builder e132406, comnormalizeCRLF. Não restaurar builderantigo para satisfazerpatch.

A tarefa motorista deve aguardar estes contratos:133421 antes213156, que renomeia e envolve record_settlement_payment comgatecargo;134948 antesderivaçõesfinanceirasposteriores;211800 redefine expense_options e220847 deve fechar sua versão finalactive. Se213156jáaplicada, CREATE133421colide e não autorizaDROPwrapper. Interromper e conferir catálogo, nunca sobreporgatecustody.

135125 efetivamente desliga projeção bulk legado: conferir usuários/runtime ainda chamando sync_financial_obligations e mostraraposentadoria legível. Não usar can_accessfalse comoúnica descrição do impacto dosnovostriggers. Abertura140010 admite reversão semfechamento nessaetapa; não liberarproduto semguards posteriores deperíodofechado.

## Pré-checks mínimos locais para adaptar no remoto

132411: constraintfinance_settlement_movement_links_payment_id_key; funçõescheck_settlement_movement_link/link_settlement_payment/get_settlement_payment_movements/audit_events comneedles originais.133352:7regprocedures constantes noSQL eapprove2needles; nenhumlabel finance_payroll_lifecycle_guard preexistente.133421:record_settlement_payment e wrapperpublic ausentes; viewactive_payable_payments presente; payrolltables existentes.134948:buildercalculationversionv2/v3, anchorsstatus/trip/expenses/totals/estimatedkm todos; dedupsourceguard exato.135125:SELECTpg_proc doschamadoressync permitido somente3triggerslistados.140010:statement_period_evidence(uuid,uuid,date,date),audit_events eaccount_type presentes; tabelasaberturas ausentes. MantertodosguardsSQLoriginais e confirmarcan_accessfalse/cronspreviamenteparados apósbloco.

## Provas disponíveis

financeSettlementPaymentRecording.test.ts+helperfinanceSettlementPaymentDatabase instalamserialização e writersreais; financeCanonicalTripSettlement.test.ts cobrebuilder/custocanônico; financeAccountOpenings.test.ts e accountPeriodCloseDatabase usamaberturareal comstatementevidence; legacyExpenseCostDatabase incorpora134948 eguarddedup reais. Conferir resultados registrados de cada executor antesalegar broad pass; esta rodada apenasinspecionou testes/corpos. Nenhuma afirmação nova de SupabaseAuthhosted/browser/PGnativo.
