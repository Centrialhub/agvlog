import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResp = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResp({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) return jsonResp({ error: "Lovable AI não configurado" }, 500);

    const anonClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await anonClient.auth.getUser();
    if (userError || !userData?.user) return jsonResp({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => null);
    const files = Array.isArray(body?.files) ? body.files : [];
    if (files.length === 0 || files.length > 5) return jsonResp({ error: "Envie de 1 a 5 imagens/PDFs da ORT" }, 400);

    const content: any[] = [{
      type: "text",
      text: [
        "Extraia dados de ORTs brasileiras para criar documentos compatíveis com NF-e no TMS.",
        "Os arquivos podem conter scans de várias páginas que pertencem ao mesmo documento/cliente: quando o número da ORT, CNPJ, nome do destinatário ou endereço se repetirem, agrupe as páginas em UM ÚNICO documento, somando itens, peso, volume e paletes (sem duplicar linhas idênticas).",
        "Quando claramente forem ORTs diferentes (números/clientes distintos), retorne um documento por ORT.",
        "Em sourcePages liste os nomes dos arquivos que compõem o documento e em pageCount informe quantas páginas foram unidas.",
        "Extraia também: número da ORT (number), data de emissão (issueDate em YYYY-MM-DD), prazo de pagamento (paymentTerms — ex.: 'À VISTA', '30 DIAS', '30/60/90'), forma/responsável de cobrança (billing — ex.: 'CIF', 'FOB', 'Pago', 'A pagar', cliente faturado), descrição da carga (cargoDescription — natureza/tipo de mercadoria), telefone do cliente/destinatário (recipientPhone), endereço (recipientAddress — logradouro), número do endereço (recipientAddressNumber), complemento (recipientAddressComplement), bairro, cidade, UF, CEP (recipientZip), código IBGE do município (recipientCityCode quando visível), país (recipientCountry) e código do país (recipientCountryCode).",
        "Extraia também dados cadastrais do destinatário quando legíveis: nome fantasia (recipientFantasyName), Inscrição Estadual (recipientStateRegistration — use 'ISENTO' quando indicado), Inscrição Municipal (recipientMunicipalRegistration), indicador de IE (recipientIeIndicator: '1' contribuinte ICMS, '2' isento, '9' não contribuinte) e e-mail do destinatário (recipientEmail).",
        "Quando houver tabela/lista de mercadorias, extraia múltiplos itens com descrição, quantidade, unidade, valor unitário, valor total, peso e volume quando legíveis. Não invente itens: se a lista estiver ilegível, retorne items vazio e use productSummary com o melhor resumo possível ou 'Mercadoria ORT'.",
        "Preencha sourceFileName com o arquivo principal e sourcePages com todos os arquivos agrupados. Use confidence 0-1 e needsReview=true se algum campo essencial estiver ilegível.",
        "REGRA CRÍTICA DE FALLBACK: NUNCA invente CEP, telefone, número de endereço, CNPJ ou logradouro. Se o campo estiver totalmente ilegível, parcialmente cortado, manuscrito impreciso, ou se você tiver menos de 70% de confiança naquele dígito/caractere específico, retorne literalmente a string 'UNKNOWN' (em maiúsculas) e marque fieldConfidences[campo]=0 e needsReview=true. Não tente completar dígitos faltantes em CEP (sempre 8 dígitos) nem em telefone (sempre 10/11 dígitos com DDD); se faltar qualquer dígito, retorne 'UNKNOWN'.",
      ].join(" "),
    }];

    for (const file of files) {
      if (!file?.base64 || !file?.mimeType || !file?.name) return jsonResp({ error: "Arquivo ORT inválido" }, 400);
      content.push({ type: "text", text: `Arquivo: ${file.name}` });
      content.push({ type: "image_url", image_url: { url: `data:${file.mimeType};base64,${file.base64}` } });
    }

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "Você extrai ORTs logísticas com precisão. Não invente dados; deixe campos vazios e marque revisão quando houver dúvida." },
          { role: "user", content },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_ort_documents",
            description: "Retorna documentos ORT extraídos para pipeline NF-like.",
            parameters: {
              type: "object",
              properties: {
                documents: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      invoiceNumber: { type: "string" },
                      issueDate: { type: "string" },
                      paymentTerms: { type: "string", description: "Prazo/condição de pagamento (ex.: À VISTA, 30 DIAS, 30/60/90)." },
                      billing: { type: "string", description: "Tipo/responsável da cobrança (CIF, FOB, A pagar, Pago, cliente faturado)." },
                      cargoDescription: { type: "string", description: "Descrição/natureza da carga transportada." },
                      emitterName: { type: "string" },
                      emitterCnpj: { type: "string" },
                      recipientName: { type: "string" },
                      recipientCnpj: { type: "string" },
                      recipientPhone: { type: "string", description: "Telefone do cliente/destinatário com DDD." },
                      recipientCity: { type: "string" },
                      recipientState: { type: "string" },
                      recipientAddress: { type: "string" },
                      recipientAddressNumber: { type: "string", description: "Número do endereço do destinatário." },
                      recipientZip: { type: "string", description: "CEP do destinatário." },
                      recipientNeighborhood: { type: "string" },
                      recipientAddressComplement: { type: "string", description: "Complemento do endereço (sala, andar, bloco)." },
                      recipientCityCode: { type: "string", description: "Código IBGE do município (7 dígitos) quando visível." },
                      recipientCountry: { type: "string", description: "País do destinatário (default BRASIL)." },
                      recipientCountryCode: { type: "string", description: "Código BACEN do país (default 1058)." },
                      recipientFantasyName: { type: "string", description: "Nome fantasia do destinatário." },
                      recipientStateRegistration: { type: "string", description: "Inscrição Estadual (use 'ISENTO' quando indicado)." },
                      recipientMunicipalRegistration: { type: "string", description: "Inscrição Municipal." },
                      recipientIeIndicator: { type: "string", description: "Indicador IE: '1' contribuinte ICMS, '2' isento, '9' não contribuinte." },
                      recipientEmail: { type: "string", description: "E-mail do destinatário quando informado." },
                      totalValue: { type: "number" },
                      totalWeight: { type: "number" },
                      totalVolume: { type: "number" },
                      estimatedPallets: { type: "number" },
                      productSummary: { type: "string" },
                      items: {
                        type: "array",
                        description: "Mercadorias/produtos identificados na ORT; vazio quando a imagem não permitir leitura confiável.",
                        items: {
                          type: "object",
                          properties: {
                            description: { type: "string" },
                            quantity: { type: "number" },
                            unit: { type: "string" },
                            unitPrice: { type: "number" },
                            totalPrice: { type: "number" },
                            weightKg: { type: "number" },
                            volumeM3: { type: "number" },
                            confidence: { type: "number" },
                          },
                          required: ["description"],
                          additionalProperties: false,
                        },
                      },
                      confidence: { type: "number" },
                      needsReview: { type: "boolean" },
                      fieldConfidences: {
                        type: "object",
                        description: "Confiança por campo, de 0 a 1, usando os nomes dos campos retornados.",
                        additionalProperties: { type: "number" },
                      },
                      sourceFileName: { type: "string" },
                      sourcePages: {
                        type: "array",
                        description: "Lista de nomes de arquivos que compõem o documento (multi-página/scan).",
                        items: { type: "string" },
                      },
                      pageCount: { type: "number", description: "Número de páginas/folhas que foram unidas neste documento." },
                    },
                    required: ["invoiceNumber", "recipientName", "recipientCity", "recipientState", "confidence", "needsReview"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["documents"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_ort_documents" } },
      }),
    });

    if (aiResp.status === 429) return jsonResp({ error: "Limite da IA atingido, tente novamente em instantes." }, 429);
    if (aiResp.status === 402) return jsonResp({ error: "Créditos da Lovable AI insuficientes." }, 402);
    if (!aiResp.ok) return jsonResp({ error: "Falha ao extrair a ORT" }, 500);

    const aiJson = await aiResp.json();
    const args = aiJson?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    return jsonResp(args ? JSON.parse(args) : { documents: [] });
  } catch (e) {
    return jsonResp({ error: e instanceof Error ? e.message : "Erro ao processar ORT" }, 500);
  }
});