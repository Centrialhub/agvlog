import type { PGlite } from '@electric-sql/pglite';
import { towerIds } from './controlTowerDatabase';

// Narrow PostgREST transport adapter: handlers and authorization SQL stay real.
// Not a hosted gateway/Auth test. All statements run as the caller's DB role.
export function towerEdgeClient(db:PGlite,service=false){
  async function execute(sql:string,values:unknown[]=[]){
    await db.exec('savepoint edge_request');
    try{await db.exec('set local role '+(service?'service_role':'authenticated'));
      const result=await db.query<Record<string,unknown>>(sql,values);await db.exec('reset role;release edge_request');return {data:result.rows,error:null};
    }catch(error){await db.exec('rollback to edge_request;release edge_request');return {data:null,error};}
  }
  const identifier=(value:string)=>{const s=value.trim();if(!/^[a-z_]+$/.test(s))throw new Error('Unsafe fixture identifier');return '"'+s+'"';};
  return {
    auth:{getUser:async()=>({data:{user:{id:towerIds.actor}},error:null}),mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:(await db.query<{aal:string}>("select auth.jwt()->>'aal' aal")).rows[0].aal},error:null})}},
    rpc:async(name:string,args:Record<string,unknown>)=>{
      let result;
      if(name==='is_tenant_operator_or_admin')result=await execute('select public.is_tenant_operator_or_admin($1) value',[args._tenant_id]);
      else if(name==='assert_tenant_integration_capability_v1')result=await execute('select public.assert_tenant_integration_capability_v1($1,$2) value',[args._tenant_id,args._capability]);
      else if(name==='evaluate_trip_live_status_v1')result=await execute('select public.evaluate_trip_live_status_v1($1,$2) value',[args._tenant_id,args._trip_id]);
      else if(name==='prepare_trip_route_v1')result=await execute('select public.prepare_trip_route_v1($1,$2,$3,$4) value',[args._tenant_id,args._trip_id,args._request_id,args._attempt_id]);
      else if(name==='commit_trip_route_v1')result=await execute('select public.commit_trip_route_v1($1,$2,$3,$4,$5) value',[args._tenant_id,args._trip_id,args._request_id,args._attempt_id,args._route]);
      else throw new Error('Unexpected Edge RPC '+name);
      return {data:result.data?.[0]?.value,error:result.error};
    },
    from:(table:string)=>{
      if(service)throw new Error('Service credential used for operational data');
      let columns='*',single=false,throwErrors=false,action='select',payload:Record<string,unknown>={},conflict:string|undefined;
      const values:unknown[]=[],filters:string[]=[],orders:string[]=[];let limit='';
      const param=(v:unknown)=>{values.push(v);return '$'+values.length;};
      const builder={select:(value='*')=>{columns=value.split(',').map(identifier).join(',');return builder;},
        eq:(k:string,v:unknown)=>{filters.push(identifier(k)+'='+param(v));return builder;},
        neq:(k:string,v:unknown)=>{filters.push(identifier(k)+'<>'+param(v));return builder;},
        in:(k:string,v:unknown[])=>{filters.push(identifier(k)+' in ('+v.map(param).join(',')+')');return builder;},
        gte:(k:string,v:unknown)=>{filters.push(identifier(k)+'>='+param(v));return builder;},
        lte:(k:string,v:unknown)=>{filters.push(identifier(k)+'<='+param(v));return builder;},
        lt:(k:string,v:unknown)=>{filters.push(identifier(k)+'<'+param(v));return builder;},
        order:(k:string,o:{ascending:boolean})=>{orders.push(identifier(k)+(o.ascending?' asc':' desc'));return builder;},
        limit:(n:number)=>{limit=' limit '+Number(n);return builder;},
        maybeSingle:()=>{single=true;return builder;},single:()=>{single=true;return builder;},
        throwOnError:()=>{throwErrors=true;return builder;},
        insert:(value:Record<string,unknown>)=>{action='insert';payload=value;return builder;},
        update:(value:Record<string,unknown>)=>{action='update';payload=value;return builder;},
        upsert:(value:Record<string,unknown>,options:{onConflict:string})=>{action='insert';payload=value;conflict=options.onConflict;return builder;},
        then:async(resolve:(result:unknown)=>unknown,reject:(error:unknown)=>unknown)=>{
          const where=filters.length?' where '+filters.join(' and '):'';
          let sql='select '+columns+' from public.'+identifier(table)+where+(orders.length?' order by '+orders.join(','):'')+limit;
          if(action==='insert'){
            const keys=Object.keys(payload);sql='insert into public.'+identifier(table)+'('+keys.map(identifier).join(',')+') values('+keys.map(k=>param(payload[k])).join(',')+')';
            if(conflict)sql+=' on conflict('+conflict.split(',').map(identifier).join(',')+') do update set '+keys.filter(k=>!conflict!.split(',').includes(k)).map(k=>identifier(k)+'=excluded.'+identifier(k)).join(',');
            sql+=' returning *';
          }else if(action==='update')sql='update public.'+identifier(table)+' set '+Object.entries(payload).map(([k,v])=>identifier(k)+'='+param(v)).join(',')+where+' returning *';
          try{const result=await execute(sql,values);if(result.error && throwErrors)throw result.error;return resolve({...result,data:single?result.data?.[0]??null:result.data});}catch(error){return reject(error);}
        },
      };return builder;
    },
  };
}
