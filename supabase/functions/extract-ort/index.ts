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
      text: "Extraia dados de ORTs brasileiras para criar documentos compatíveis com NF-e no TMS. Cada imagem/PDF pode conter uma ORT diferente; retorne um item separado por ORT/documento encontrado. Deduplicate páginas repetidas ou scans do mesmo documento dentro do envio. Preencha sourceFileName com o arquivo de origem mais provável. Use confidence 0-1 e needsReview=true se algum campo essencial estiver ilegível.",
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
                      emitterName: { type: "string" },
                      emitterCnpj: { type: "string" },
                      recipientName: { type: "string" },
                      recipientCnpj: { type: "string" },
                      recipientCity: { type: "string" },
                      recipientState: { type: "string" },
                      recipientAddress: { type: "string" },
                      recipientNeighborhood: { type: "string" },
                      totalValue: { type: "number" },
                      totalWeight: { type: "number" },
                      totalVolume: { type: "number" },
                      estimatedPallets: { type: "number" },
                      productSummary: { type: "string" },
                      confidence: { type: "number" },
                      needsReview: { type: "boolean" },
                      fieldConfidences: {
                        type: "object",
                        description: "Confiança por campo, de 0 a 1, usando os nomes dos campos retornados.",
                        additionalProperties: { type: "number" },
                      },
                      sourceFileName: { type: "string" },
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