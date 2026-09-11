# Ensaio nativo delimitado de reentrega140248

Rodada21514:9casos passaram, exit0, PostgreSQL17.11 descartável em loopback e parada confirmada. SQL original SHA256 b39c73e86ed3881957b804e5ee5d39e774eeae9f5a425c4ff21402c4922f5987; hashes dos casos e runner no JSON adjacente. Nenhuma conexão ou aplicação de produção foi feita pelo ensaio.

Os8casos preexistentes executaram o arquivo integral com guards intactos: instalação não altera linhas de negócio;ACL; contexto obsoleto/tenant alheio sem resíduos; conflito de item40001; pedidos simultâneos com uma tentativa; preservação byte a byte dos itens, alocações, acertos e pagamentos; leitores históricos; bloqueio de reset e reaplicação.

A nona prova usa os mesmos helpers reais do teste redeliveryDatabase: reanexa a nota, planeja a segunda viagem, inicia, registra entrega e executa o builder por fluxo real. A primeira perna conserva frete125; a segunda fica com frete0 e redelivery_pricing_review/needs_recalculation. Não cria pagamento.

O adaptador substitui apenas o transporte PGlite por uma sessão psql persistente e parametriza dados sintéticos. Não substitui funções de negócio nem remove guards. Na segunda base omite somente CREATE ROLE dos três papéis já existentes no cluster. A fixture é a cadeia existente de delivery/planning/composition/outcomes/proofs/corrections/attempts: Auth/Storage são tabelas de ensaio, dependências fiscais externas permanecem instrumentadas conforme o helper original. Não é clone integral da produção, prova de objetos armazenados reais ou teste da plataforma Supabase hospedada.

A chegada da segunda viagem é preparada por UPDATE de teste, exatamente como no caso original, para focar a entrega/acerto. Não certifica GPS/chegada via aplicativo. A prova de pagamentos é invariância dos registros presentes nos8casos e contagemzero na segunda perna; não representa transação bancária.

O suplemento de contenção tem log separado; seus resultados não são contabilizados nos9casos acima. A primeira tentativa de suplemento falhou em coluna de ordenação do snapshot de teste e foi parada; nenhuma alteração do SQL140248 ou da contenção decorreu desse erro.
