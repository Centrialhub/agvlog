import forge from 'node-forge';
import {parseFiscalPkcs12} from '../../../../supabase/functions/_shared/fiscal-certificate.ts';

Deno.serve(async () => {
  const keys=forge.pki.rsa.generateKeyPair({bits:1024});
  const certificate=forge.pki.createCertificate();certificate.publicKey=keys.publicKey;
  certificate.serialNumber='01';certificate.validity.notBefore=new Date(Date.now()-60000);
  certificate.validity.notAfter=new Date(Date.now()+86400000);
  const attrs=[{name:'commonName',value:'SYNTHETIC TEST:42985218002136'},{name:'countryName',value:'BR'}];
  certificate.setSubject(attrs);certificate.setIssuer(attrs);certificate.sign(keys.privateKey,forge.md.sha256.create());
  const passed=[];
  for(const algorithm of ['3des','aes256']){
    const p12=forge.pkcs12.toPkcs12Asn1(keys.privateKey,[certificate],'Synthetic-only-password',{algorithm});
    const bytes=Uint8Array.from(forge.asn1.toDer(p12).getBytes(),c=>c.charCodeAt(0));
    const result=await parseFiscalPkcs12(bytes,'Synthetic-only-password');
    if(result.certificateCnpj!=='42985218002136'||!result.privateKeyPem.includes('BEGIN RSA PRIVATE KEY')
      ||!result.certificatePem.includes('BEGIN CERTIFICATE')||!/^[a-f0-9]{64}$/.test(result.thumbprint))throw Error('PFX round-trip failed');
    let rejected=false;
    try{await parseFiscalPkcs12(bytes,'Wrong-synthetic-password');}catch{rejected=true;}
    if(!rejected)throw Error('Wrong password accepted');
    passed.push(algorithm);
  }
  const a=forge.asn1,md=forge.md.sha256.create();md.update('Synthetic RSA regression');
  const digest=md.digest().getBytes();let malformedRejected=0;
  for(const extra of [false,true]){
    const algorithm=[a.create(a.Class.UNIVERSAL,a.Type.OID,false,a.oidToDer('2.16.840.1.101.3.4.2.1').getBytes()),
      a.create(a.Class.UNIVERSAL,a.Type.NULL,false,extra?'':'invalid')];
    if(extra)algorithm.push(a.create(a.Class.UNIVERSAL,a.Type.OCTETSTRING,false,'unconsumed'));
    const info=a.create(a.Class.UNIVERSAL,a.Type.SEQUENCE,true,[a.create(a.Class.UNIVERSAL,a.Type.SEQUENCE,true,algorithm),
      a.create(a.Class.UNIVERSAL,a.Type.OCTETSTRING,false,digest)]);
    const signature=keys.privateKey.sign(a.toDer(info).getBytes(),'NONE');
    try{keys.publicKey.verify(digest,signature);}catch{malformedRejected++;}
  }
  if(malformedRejected!==2)throw Error('Malformed RSA structure accepted');
  return Response.json({passed:true,algorithms:passed,wrongPasswordRejected:true,rsaMalformedRejected:malformedRejected,emissionPerformed:false});
});
