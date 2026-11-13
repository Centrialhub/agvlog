# Log de release — enquadramento do canhoto

## Identidade e estado anterior

Pedido explícito do usuário: corrigir foto/corte do canhoto e leitura por IA.
Checkout isolado C:/Users/Budinha Yamaguti/Downloads/AGV CAPTURA ITENS,
base d640bb50201835805b0247fa84589c87db040531. Alias público confirmado nessa
base, buildHash f472544a3f231847; backend qcvnsdrbcchaxvawcngk.
Sem migrations, Edge, Secrets, Auth ou contrato fiscal/financeiro neste delta.
O chat por atendente permanece em checkout separado e não integra este release.

## Comportamento e risco

A prévia de vídeo tinha altura limitada separadamente da largura, enquanto o
polígono usava todo o contêiner. Vídeo e sobreposição agora compartilham o
retângulo proporcional às dimensões reais do sensor, limitado a 60vh. A câmera
solicita resolução maior por preferências, sem exigir hardware específico.
O recorte definitivo é detectado novamente na foto completa; os cantos da
prévia reduzida não são enviados como um ajuste manual confirmado.

A detecção automática ganha pequena margem externa, sem esconder bordas que
já encostem na foto. Quando a detecção é inconclusiva, a imagem completa é
preservada e o ajuste de cantos abre automaticamente; não se usa um recorte
adivinhado. Há alternativa explícita de câmera nativa do celular. Falha de
processamento encerra a captura para não repetir erros em um ciclo automático.
Os limiares de resolução, nitidez, corte e política por cliente permanecem.
Não se autentica identidade nem assinatura; a IA só reconhece presença visual.

## Evidências e limites

16 testes locais de qualidade, geometria e captura passaram. A captura de
4032x3024 usa toda a imagem e deixa a nova detecção ao processamento real;
teste de componente usa transporte/câmera simulados e não aprova câmera física.
Três E2E locais (desktop/tablet/mobile) também passaram com câmera sintética via
captureStream, medindo o retângulo real do vídeo/sensor e executando o recorte
Canvas/decodificação real. Foto inconclusiva permanece em 2400x1800 sem cortes;
os três navegadores abriram a revisão, sem rede externa, login ou uploads.
Revisão visual identificou puxadores cortados pelo contêiner nos extremos da
foto. O editor agora reserva espaço externo; o E2E verifica hit-testing real
nas metades superior/esquerda do puxador, além da geometria do vídeo.
Typecheck, lint e Quality gate completo exigidos no SHA final antes de promoção.
SHA final, jobs e alias final registrados no PR/recibo de entrega.

OpenAI Edge v18 já publicada antes deste delta. Chave inserida pelo usuário no
Supabase sem trânsito pelo chat. Health 250970 confirmou provider=openai/model
gpt-6-luna; self_test 250973 HTTP200 passed, duas imagens sintéticas, 1376 tokens
de entrada/174 saída. Data/assinatura presentes e ausência/revisão distinguidas,
sem gravar registros produtivos. Scheduler estava desativado; ativação operacional
deve ser registrada separadamente após teste e verificação da fila/configuração.

## Itens da ocorrência — pendência independente

A importação atual junta descrições em product_summary, limitado a 500 caracteres.
As 356 notas com current_load_items examinadas tinham uma única linha por nota;
as notas da carga 20260924 não têm produtos/quantidades individuais em delivery_meta.
Os originais XML não são persistidos pelo fluxo examinado. Não dividir resumos
em produtos fictícios, inventar quantidades ou mudar registros fiscais para
aparentar solução. Separação correta da carga antiga depende dos XMLs originais
ou outra fonte estruturada revisada. Este delta de câmera não resolve essa parte.

## Retorno e orientação operacional

Retorno de frontend ao deployment anterior, sem efeito no banco ou nos resultados
OCR. Preservar fotos originais, drafts offline, chaves e resultados já gravados.
Atualize o app; abra o scanner, enquadre todo o papel com margem e mantenha imóvel.
Revise a foto. Se necessário use a câmera nativa ou ajuste os quatro cantos; data
e assinatura devem permanecer inteiras. Não declarar câmera física homologada
sem validação no aparelho do motorista.
