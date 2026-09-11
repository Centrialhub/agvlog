import {previewExpenseArtifact} from './artifact-preview.ts';
import {readBoundedBody} from './bounded-request.ts';
import { withFiscalCors } from '../_shared/fiscal-cors.ts';
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { corsHeaders } from "../_shared/cors.ts";
import { requireActiveTenant } from "../_shared/active-tenant.ts";
import { expenseReceiptUpload } from "./expense-receipt.ts";
import { secureCleanup } from "./secure-cleanup.ts";
import {preserveStatementOriginal,statementFileType} from "./statement-original.ts";
import {isFinancialReceiptFolder} from './financial-upload-policy.ts';
import {quarantineUpload,quarantineSha256} from './quarantine-workflow.ts';

const MAX_BYTES = 10 * 1024 * 1024;
const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };
const encoder = new TextEncoder();
const BUCKET_ROLES: Record<string, readonly string[]> = {
  receipts: ["owner", "admin", "operator", "driver"],
  "occurrence-return-proofs": ["owner", "admin", "operator"],
  "pallet-return-proofs": ["owner", "admin", "operator"],
  "finance-statements": ["owner", "admin", "operator"],
};
const KIND_MIMES: Record<string, readonly string[]> = {
  image: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
  proof: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"],
  financial: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf", "application/xml"],
  statement: ["text/csv","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/x-ofx"],
};

function response(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function detectMime(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12).toLowerCase();
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) return "image/heic";
    if (["mif1", "msf1"].includes(brand)) return "image/heif";
  }
  if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  const text = new TextDecoder().decode(bytes.slice(0, 2_048)).replace(/^\uFEFF/, "").trimStart();
  if (text.startsWith("<") && !/<!DOCTYPE/i.test(text) && !/<script[\s>]/i.test(text)) return "application/xml";
  return null;
}

function safeName(value: string) {
  return value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 120) || "arquivo";
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function actorFingerprint(serviceKey: string, userId: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${serviceKey}:${userId}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function consumeQuota(
  adminClient: SupabaseClient,
  fingerprint: string,
  action: "upload" | "cleanup",
) {
  const { data, error } = await adminClient.rpc("consume_secure_upload_quota_v1", {
    p_actor_fingerprint: fingerprint,
    p_action: action,
    p_max_requests: action === "upload" ? 10 : 30,
    p_window_seconds: 60,
  });
  return !error && data === true;
}

async function scannerAccepts(file: File, correlationId: string) {
  const scannerUrl = Deno.env.get("MALWARE_SCANNER_URL")?.trim();
  const scannerToken = Deno.env.get("MALWARE_SCANNER_TOKEN")?.trim();
  if (!scannerUrl || !scannerToken) return { available: false, clean: false };
  const url = new URL(scannerUrl);
  if (url.protocol !== "https:") return { available: false, clean: false };

  const data = new FormData();
  data.set("file", file, file.name);
  const scan = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${scannerToken}`, "x-correlation-id": correlationId },
    body: data,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!scan.ok) return { available: false, clean: false };
  const result = await scan.json() as { clean?: boolean };
  return { available: true, clean: result.clean === true };
}

async function authorizeUpload(
  adminClient: SupabaseClient,
  userId: string,
  tenantId: string,
  bucket: string,
) {
  const { data: membership } = await adminClient
    .from("tenant_memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  if (!membership || !BUCKET_ROLES[bucket]?.includes(String(membership.role))) return false;
  return true;
}

Deno.serve(withFiscalCors(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response(405, { error: "method_not_allowed" });

  const authorization = request.headers.get("authorization");
  if (!authorization) return response(401, { error: "missing_authorization" });
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BYTES + 64 * 1024) return response(413, { error: "invalid_file_size" });
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return response(503, { error: "upload_gateway_not_configured" });

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) return response(401, { error: "invalid_token" });

    const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const fingerprint = await actorFingerprint(serviceKey, user.id);
    if (request.headers.get("content-type")?.includes("application/json")) {
      const cleanup = await request.json() as { action?: unknown; tenant_id?: unknown; bucket?: unknown; paths?: unknown; artifact_id?:unknown; expense_id?:unknown };
      const tenantId = String(cleanup.tenant_id ?? "");
      if(cleanup.action==='finance_artifact_preview_v2'){
        const artifact=String(cleanup.artifact_id??''),expense=String(cleanup.expense_id??'');
        if(!validUuid(tenantId)||!validUuid(artifact)||!validUuid(expense))return response(400,{error:'upload_invalid_request'});
        const tenantError=requireActiveTenant(request,tenantId);if(tenantError)return tenantError;
        const preview=await previewExpenseArtifact(tenantId,expense,artifact,{
          read:()=>callerClient.rpc('get_finance_upload_artifact',{_tenant_id:tenantId,_artifact_id:artifact}),
          sign:(target,path)=>callerClient.storage.from(target).createSignedUrl(path,300),
        });
        return response(200,preview);
      }
      const bucket = String(cleanup.bucket ?? "");
      const paths = Array.isArray(cleanup.paths) ? cleanup.paths.filter((path): path is string => typeof path === "string") : [];
      const validPaths = paths.length > 0 && paths.length <= 10 && paths.every((path) =>
        path.startsWith(`${tenantId}/`) && !path.includes("..") && path.length <= 500
      );
      if (cleanup.action !== "cleanup" || !validUuid(tenantId) || !BUCKET_ROLES[bucket] || !validPaths) {
        return response(400, { error: "invalid_cleanup_request" });
      }
      const tenantContextError = requireActiveTenant(request, tenantId);
      if (tenantContextError) return tenantContextError;
      if (paths.some(path => path.includes("\\") || path.includes("%") || path.split("/").some(segment => !segment || segment === "."))) {
        return response(400, { error: "invalid_cleanup_path" });
      }
      if (bucket === "receipts" && paths.some(path => ["expense-receipts", "finance-batches"].includes(path.split("/")[1]))) {
        return response(403, { error: "expense_receipt_retention_required" });
      }
      if(bucket==="finance-statements")return response(403,{error:"finance_statement_file_immutable"});
      if(paths.some(path=>isFinancialReceiptFolder(bucket,path.split('/').slice(1).join('/')))){
        const access=await callerClient.rpc('get_finance_access',{_tenant_id:tenantId});
        if(access.error||access.data!==true)return response(403,{error:'finance_access_denied'});
      }
      const cleanupResult = await secureCleanup({tenant:tenantId,actor:user.id,bucket,paths,correlationId},{
        authorize: args => callerClient.rpc("authorize_secure_upload_cleanup_v1",args),
        consumeQuota: () => consumeQuota(adminClient,fingerprint,"cleanup"),
        remove: (targetBucket,targetPaths) => adminClient.storage.from(targetBucket).remove(targetPaths),
      });
      return response(cleanupResult.status,cleanupResult.body);
    }

    const bodyBytes=await readBoundedBody(request,MAX_BYTES+64*1024);
    const form=await new Response(Uint8Array.from(bodyBytes).buffer,{headers:{'Content-Type':request.headers.get('content-type')||''}}).formData();
    const tenantId = String(form.get("tenant_id") ?? "");
    const bucket = String(form.get("bucket") ?? "");
    const folder = String(form.get("folder") ?? "");
    const kind = String(form.get("kind") ?? "");
    const file = form.get("file");
    const evidenceRequestId = String(form.get("request_id") ?? "");
    const evidenceSlot = String(form.get("file_slot") ?? "");
    const evidenceHash = String(form.get("sha256") ?? "").toLowerCase();
    const expenseReceipt = form.get("action") === "expense_receipt";
    const statementOriginal = bucket === "finance-statements";
    if(form.get('action')==='finance_upload_v2'){
      if(!validUuid(tenantId)||!(file instanceof File)||file.size<=0||file.size>MAX_BYTES)return response(400,{error:'upload_invalid_request'});
      const tenantContextError=requireActiveTenant(request,tenantId);
      if(tenantContextError)return tenantContextError;
      const access=await callerClient.rpc('get_finance_access',{_tenant_id:tenantId});
      if(access.error||access.data!==true)return response(403,{error:'finance_access_denied'});
      if(!await consumeQuota(adminClient,fingerprint,'upload'))return response(429,{error:'upload_rate_limited'});
      const delimiter=form.get('delimiter');
      const result=await quarantineUpload({tenant:tenantId,actor:user.id,request:evidenceRequestId,
        sourceType:String(form.get('source_type')??''),sourceId:String(form.get('source_id')??''),
        format:String(form.get('format')??'unknown'),mime:file.type||'application/octet-stream',bytes:new Uint8Array(await file.arrayBuffer()),
        delimiter:delimiter===';'||delimiter===','||delimiter==='\t'?delimiter:undefined,
      },{caller:(name,args)=>callerClient.rpc(name,args),service:(name,args)=>adminClient.rpc(name,args),
        image:async bytes=>{
          const {reencodeQuarantinedImage}=await import('./quarantine-magick.ts');
          return reencodeQuarantinedImage(bytes,async(target,path)=>{const result=await adminClient.storage.from(target).download(path);if(result.error||!result.data)throw new Error('image_runtime_unavailable');return new Uint8Array(await result.data.arrayBuffer());});
        },
        put:async(target,path,content,mime,metadata)=>{
          const stored=await adminClient.storage.from(target).upload(path,content,{contentType:mime,upsert:false,metadata,cacheControl:'0'});
          if(!stored.error)return;
          // Exact replays may already have created the immutable object. Never overwrite.
          const existing=await adminClient.storage.from(target).download(path);
          if(existing.error||!existing.data||existing.data.size!==content.length)throw new Error('upload_storage_unavailable');
          if(await quarantineSha256(new Uint8Array(await existing.data.arrayBuffer()))!==metadata.sha256)throw new Error('upload_storage_conflict');
          // Finalize validates metadata; matching bytes alone never grant usability.
        },
      });
      return response(200,result);
    }
    if (!validUuid(tenantId) || !(file instanceof File) || !BUCKET_ROLES[bucket] || !KIND_MIMES[kind]) {
      return response(400, { error: "invalid_upload_request" });
    }
    const tenantContextError = requireActiveTenant(request, tenantId);
    if (tenantContextError) return tenantContextError;
    if (file.size <= 0 || file.size > MAX_BYTES) return response(413, { error: "invalid_file_size" });

    const segments = folder.split("/").filter(Boolean);
    const hasEvidenceIdentity = Boolean(evidenceSlot);
    const hasDeliveryEvidenceFields = hasEvidenceIdentity || (segments[0] === "deliveries" && Boolean(evidenceRequestId || evidenceHash));
    if (hasDeliveryEvidenceFields && (!validUuid(evidenceRequestId)
      || !/^(receipt:(original|processed|thumbnail)|photo:[0-4]|signature)$/.test(evidenceSlot)
      || !/^[a-f0-9]{64}$/.test(evidenceHash)
      || segments[0] !== "deliveries")) {
      return response(400, { error: "invalid_delivery_evidence_identity" });
    }
    if((statementOriginal&&(folder!=="imports"||kind!=="statement"))||(!statementOriginal&&kind==="statement"))return response(400,{error:"finance_statement_scope_invalid"});
    if (segments.length < 1 || segments.length > 6 || segments.some((part) => !/^[a-zA-Z0-9_-]{1,80}$/.test(part))) {
      return response(400, { error: "invalid_upload_folder" });
    }
    if ((segments[0] === "expense-receipts" && !expenseReceipt)
      || (expenseReceipt && (bucket !== "receipts" || folder !== "expense-receipts" || kind !== "proof"))) {
      return response(400, { error: "expense_receipt_reserved_folder" });
    }

    if (!await authorizeUpload(adminClient, user.id, tenantId, bucket)) {
      return response(403, { error: "tenant_or_role_denied" });
    }
    const financeReceipt = bucket === "receipts" && segments[0] === "finance-batches";
    const financialScope=isFinancialReceiptFolder(bucket,folder);
    if(kind==='financial'&&!financialScope)return response(400,{error:'finance_invalid_receipt_folder'});
    const financialAccess=async()=>{const access=await callerClient.rpc('get_finance_access',{_tenant_id:tenantId});return !access.error&&access.data===true;};
    if(financialScope&&!await financialAccess())return response(403,{error:'finance_access_denied'});
    if(statementOriginal){
      const access=await callerClient.rpc("get_finance_access",{_tenant_id:tenantId});
      if(access.error||access.data!==true)return response(403,{error:"finance_access_denied"});
    }
    if (financeReceipt) {
      if (folder !== "finance-batches" || kind !== "proof") return response(400, { error: "finance_invalid_receipt_folder" });
      const access = await callerClient.rpc("get_finance_access", { _tenant_id: tenantId });
      if (access.error || access.data !== true) return response(403, { error: "finance_access_denied" });
    }
    if (!await consumeQuota(adminClient, fingerprint, "upload")) {
      return response(429, { error: "upload_rate_limited", correlation_id: correlationId });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = statementOriginal ? statementFileType(file.name,bytes)?.mime : detectMime(bytes);
    if (!mime || !KIND_MIMES[kind].includes(mime)) return response(415, { error: "file_signature_mismatch" });
    if (expenseReceipt) {
      const result = await expenseReceiptUpload({
        tenant: tenantId, actor: user.id, request: String(form.get("request_id") ?? ""),
        sourceType: String(form.get("source_type") ?? ""), sourceId: String(form.get("source_id") ?? ""),
        mime, bytes, declaredHash: String(form.get("sha256") ?? ""),
      }, {
        // Re-authorize using the verified caller JWT before/after scanning.
        // A service-role request cannot prove the actor's MFA assurance level.
        inspect: args => callerClient.rpc("inspect_expense_receipt_upload", args),
        upload: (path, content, options) => adminClient.storage.from("receipts").upload(path, content, options),
        scan: () => scannerAccepts(file, correlationId),
      });
      return response(result.status, result.body);
    }

    const scan = await scannerAccepts(file, correlationId);
    if (!scan.available) return response(503, { error: "malware_scanner_unavailable" });
    if (!scan.clean) return response(422, { error: "malware_detected" });

    if (financialScope || statementOriginal) {
      const access = await callerClient.rpc("get_finance_access", { _tenant_id: tenantId });
      if (access.error || access.data !== true) return response(403, { error: "finance_access_denied" });
    }

    if(statementOriginal){
      try{
        const original=await preserveStatementOriginal(tenantId,file.name,bytes,{
          upload:(path,content,contentType)=>adminClient.storage.from("finance-statements").upload(path,content,{contentType,upsert:false,cacheControl:"0"}),
          download:async path=>{const stored=await adminClient.storage.from("finance-statements").download(path);return stored.error||!stored.data?null:new Uint8Array(await stored.data.arrayBuffer());},
        });
        return response(201,{...original,correlation_id:correlationId});
      }catch{return response(503,{error:"finance_statement_storage_unconfirmed",correlation_id:correlationId});}
    }

    if (hasEvidenceIdentity) {
      const actualHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
        .map(value => value.toString(16).padStart(2, "0")).join("");
      if (actualHash !== evidenceHash) return response(409, { error: "delivery_evidence_hash_mismatch", correlation_id: correlationId });
    }
    const evidenceName = hasEvidenceIdentity
      ? `${evidenceRequestId}-${evidenceSlot.replace(":", "-")}-${evidenceHash}`
      : `${crypto.randomUUID()}-${safeName(file.name)}`;
    const path = `${tenantId}/${segments.join("/")}/${evidenceName}`;
    const { error: uploadError } = await adminClient.storage.from(bucket).upload(path, bytes, {
      contentType: mime,
      upsert: false,
      cacheControl: "3600",
    });
    if (uploadError) {
      if (hasEvidenceIdentity) {
        const stored = await adminClient.storage.from(bucket).download(path);
        if (!stored.error && stored.data) {
          const storedHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await stored.data.arrayBuffer())))
            .map(value => value.toString(16).padStart(2, "0")).join("");
          if (storedHash === evidenceHash) {
            return response(200, { path, content_type: mime, size: file.size, replayed: true, correlation_id: correlationId });
          }
          return response(409, { error: "delivery_evidence_existing_object_mismatch", correlation_id: correlationId });
        }
      }
      console.error("[secure-upload] storage failure", { correlation_id: correlationId, code: uploadError.name });
      return response(503, { error: "storage_unavailable", correlation_id: correlationId });
    }

    return response(201, { path, content_type: mime, size: file.size, correlation_id: correlationId });
  } catch (cause: unknown) {
    console.error("[secure-upload] rejected", {
      correlation_id: correlationId,
      error_name: cause instanceof Error ? cause.name : "UnknownError",
    });
    return response(400, { error: "invalid_upload", correlation_id: correlationId });
  }
}));
