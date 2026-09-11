# Devolução registrada do crédito: revisão e fronteira pública

Migration10629 criada via CLI, somente local. Os originais publicados101312/102519/103921/104429 não foram editados. A migration104822 privada é do agente banco. Não houve escrita remota, commit, stage ou emissão fiscal.

## Revisão independente

Foi identificado que a nova posição refund_history poderia atravessar o contexto antigo de aplicação e seu source_snapshot. O proprietário corrigiu ambos em104822, removendo histórico bruto sem editar101312. O novo catálogo acrescenta returned_cents aos créditos por patch guardado; parsers de aplicação e devolução foram exercitados em SQL real. Contexto de devolução agora diagnostica competência fechada, mantendo asserção independente no writer e trigger.

## Provas

Três testes PGlite passaram (sessão37432, saída0), com lint sem erros: 31 saídas realmente registradas pelo comando financeiro em duas páginas; documento formatado normalizado e outro pagador excluído; revisão completa stale40001; devolução parcial/replay; histórico sem evidência bruta; compatibilidade da aplicação existente; isolamento anônimo/tenant/misto e núcleo sem grants. Contraprova de trigger de void com WHENfalse recusa a instalação antes de qualquer API pública ser criada. Constraints diferidas são verificadas explicitamente.

Seis casos PostgreSQL17.11 nativo passaram, sessão19470 saída0 e servidor encerrado:

1. Devolução200 primeiro: aplicação500 concorrente não consegue usar crédito600 duas vezes; replay não duplica devolução.
2. Aplicação300 primeiro, após devolução200: devolução200 concorrente não pode usar saldo100. Liberação auditada da aplicação preserva devolução anterior.
3. Pagamento100 primeiro em saída200 impede devolução200.
4. Devolução100 primeiro em saída200 impede pagamento200.
5. Revogação enquanto o writer aguarda trava financeira nega a operação.
6. Trava anterior da linha de saída produz40001 sem deadlock.

Final: crédito original600, devolvido300, disponível300, duas devoluções e registros bancários byte-equivalentes aos anteriores. O ensaio utiliza writers reais e disputa entre conexões; somente transporte PGlite é substituído por psql. Cada arquivo SQL tem SHA verificado antes/depois. Banco é exclusivamente loopback descartável, não Supabase hospedado.

A primeira execução85706 passou as seis disputas mas encerrou com erro na asserção do próprio runner: supunha que record_finance_movement criasse bank_transactions. Corrigida para comparar os registros bancários antes/depois, sem alterar produto; execução19470 repetiu todos os casos com saída0. PostgreSQL foi encerrado em ambas.

## Catálogo e autorização

get_finance_customer_credit_refund_options fornece movements/history paginados (limit máximo100, total e next_offset explícitos). A revisão inclui posição atual e conjunto inteiro. Seleção oferece somente saídas ativas, comprovadas, da mesma empresa e do documento do pagador, com capacidade disponível. Preview verifica contexto exato e não retorna _evidence. Dispatcher delega ao writer privado; raw context/writer/position permanecem sem grants. Pins verificam MD5 normalizado, volatilidade, search_path e ACL dos predecessores, quatro triggers exatos e journal privado com RLS.

A fixture de reembolso é baseada no grafo financeiro completo e definições capturadas. Ela cria apply_client_invoice_command afresh; o helper nativo e o teste público restauram sua ACL real capturada antes da instalação103921. A rejeição original do preflight foi preservada até esse ajuste de fixture; nenhum pin foi relaxado.

Hashes e allowlist estão no JSON adjacente. A própria documentação MD/JSON também integra a entrega.

## Suplemento: fechamento e reabertura reais

`src/test/customerCreditRefundPeriodClose.test.ts` passou (1 PGlite às08:20:22, lint0). Saída200 de10/08/2026, evidência de extrato com entrada bancária negativa200, conciliação única, saldo inicial1000/final800, cobertura, corte legado e fechamento usam helpers/writers reais completos. Após close, preview devoluçãoeligible/can_executefalse comcredit_refund_period_closed e writer23514 semrefund. Após reopen auditado, novaprévia elegível e devolução200 registrada, crédito disponível400. Movimento original e registros bancários byte-equivalentes; constraints diferidas verificadas. Nenhuma função de período simulada e nenhum PostgreSQL nativo repetido.
