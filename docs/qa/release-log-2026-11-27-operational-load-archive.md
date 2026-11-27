# Remoção operacional preservando histórico — 27/11/2026

Base: main 6826fcec654296e16fcfa8486df549ca20903430. Alvo: AGVLog qcvnsdrbcchaxvawcngk.
Estado: candidato, sem alterações produtivas executadas.

## Contrato e limite

O usuário autorizou remover as cargas não JMacêdo, inclusive com vínculos, preservando os documentos fiscais e o histórico. O inventário identifica duas cargas elegíveis e 21 protegidas, incluindo duas mistas. Os dois CNPJs protegidos são conferidos novamente sob bloqueio no comando.

A exclusão física conflita com FKs RESTRICT de conferências imutáveis. A remoção operacional mantém a carga original como referência histórica, cancela a programação exclusiva e sua jornada física, e retira a carga das leituras autenticadas com uma política restritiva adicional. Nenhuma política anterior é ampliada. Documentos, itens, valores, emissões, conferências e vínculos permanecem byte a byte.

O comando é privado, SECURITY INVOKER e exclusivo do administrador postgres. Não é RPC de navegador e não altera o botão de exclusão geral. Esta mudança atende à limpeza administrativa autorizada; não libera replanejamento genérico de notas com CT-e nem cancelamento fiscal. Nenhuma emissão ou mensagem real é usada como teste.

Bloqueios preservados: tenant, versão obsoleta, concorrência NOWAIT, JMacêdo/mistas, viagens/jornadas compartilhadas e registros de entrega/financeiro que exigem suas APIs próprias. Repetição exata retorna a confirmação anterior. A auditoria privada e a carga arquivada ficam imutáveis.

## Verificação e promoção

- PGlite: 12 testes executam o SQL com FKs, RLS, gatilho de histórico imutável e verificação diferida de trânsito. É fixture parcial; não equivale ao staging completo.
- CI completo obrigatório antes da promoção: validate, oito shards unit-tests e database-and-e2e. O job de banco aplica o forward no banco loopback existente e executa o contrato de permissões. Não usa dados ou credenciais produtivos.
- Antes da limpeza: conferir backup local já produzido, versões esperadas, exclusividade de viagem/jornada e hashes completos das 21 cargas e 1.072 notas JMacêdo.
- Após a limpeza: confirmar 21 cargas visíveis, duas arquivadas, notas/JMacêdo inalteradas, jornadas retiradas do app e ausência de mudanças em documentos fiscais/conferências.

## Retorno

Não há alteração de frontend ou Edge. O frontend anterior é compatível com a política aditiva e com status cancelado. Não remover a política nem reativar viagens para simular retorno: isso recolocaria a operação antiga no app. Uma eventual restauração de dados exige compensação auditada revisada contra o snapshot, com todas as proteções anteriores preservadas. Não existe botão de restauração nesta entrega.

## Pendente

Gate hospedado, aplicação produtiva e limpeza autorizada ainda pendentes. Evidências finais serão registradas após execução real.
