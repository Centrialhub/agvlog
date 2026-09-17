import {hasBenchmarkToken} from './benchmark-auth.ts';
import {createClient} from '@supabase/supabase-js';
import {readBoundedBody} from '../secure-upload/bounded-request.ts';
import {reencodeQuarantinedImage} from '../secure-upload/quarantine-magick.ts';
import {quarantineSha256} from '../secure-upload/quarantine-workflow.ts';
// Temporary dedicated-token diagnostic. Never creates upload artifacts, receipts or financial rows.
Deno.serve(async request=>{
 if(!hasBenchmarkToken(request.headers.get('authorization'),Deno.env.get('FINANCE_IMAGE_BENCH_TOKEN')))return Response.json({error:'unauthorized'},{status:401});
 const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!secret)return Response.json({error:'image_runtime_unavailable'},{status:503});
 if(request.method!=='POST')return Response.json({error:'method_not_allowed'},{status:405});
 const started=performance.now();
 try{
  const body=await readBoundedBody(request,5*1024*1024+65536);
  const form=await new Response(Uint8Array.from(body).buffer,{headers:{'Content-Type':request.headers.get('content-type')||''}}).formData(),file=form.get('file');
  if(!(file instanceof File)||file.size<=0||file.size>5*1024*1024)throw new Error('image_size_limit');
  const client=createClient(Deno.env.get('SUPABASE_URL')!,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const output=await reencodeQuarantinedImage(new Uint8Array(await file.arrayBuffer()),async(bucket,path)=>{
   const result=await client.storage.from(bucket).download(path);if(result.error||!result.data)throw new Error('image_runtime_unavailable');return new Uint8Array(await result.data.arrayBuffer());
  });
  return Response.json({version:1,probe_only:true,usable:false,reencoded:true,elapsed_ms:performance.now()-started,output_mime:output.mime,output_size:output.bytes.length,output_sha256:await quarantineSha256(output.bytes)});
 }catch(error){
  const code=error instanceof Error&&/^(image_|upload_body_)[a-z_]+$/.test(error.message)?error.message:'image_resource_or_codec_rejection';
  return Response.json({version:1,probe_only:true,usable:false,reencoded:false,error:code,elapsed_ms:performance.now()-started},{status:422});
 }
});