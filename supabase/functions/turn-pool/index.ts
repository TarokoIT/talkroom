const cors={'Access-Control-Allow-Origin':'https://tarokoit.github.io','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:cors});
const base=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
async function rpc(name:string,body:unknown,auth:string,key:string){
 const r=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('rpc');const text=await r.text();return text?JSON.parse(text):null;
}
Deno.serve(async req=>{
 if(req.headers.get('origin')&&req.headers.get('origin')!=='https://tarokoit.github.io')return reply(403,{error:'來源錯誤'});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return reply(405,{error:'請使用 POST'});
 const auth=req.headers.get('authorization')||'';
 if(!auth.startsWith('Bearer '))return reply(401,{error:'請先登入'});
 let session=null;
 try{const text=await req.text();if(text.length>200)throw Error();session=JSON.parse(text||'{}').session_id||null;if(session&&!/^[a-f0-9-]{36}$/i.test(session))throw Error();}catch{return reply(400,{error:'格式錯誤'});}
 try{await rpc('talkroom_turn_authorize',{p_session:session},auth,anon);}catch{return reply(403,{error:'登入已失效或沒有管理權限'});}
 try{
  const claims=await rpc('talkroom_turn_usage_claim',{},'Bearer '+service,service);
  await Promise.all(claims.map(async(c:{slot:string,domain:string,secret:string,revision:number})=>{
   try{
    if(!/^[a-z0-9-]+\.metered\.live$/.test(c.domain))throw Error();
    const url=new URL('https://'+c.domain+'/api/v1/turn/current_usage');url.searchParams.set('secretKey',c.secret);
    const r=await fetch(url,{signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error();const d=await r.json();
    if([d.usageInGB,d.quotaInGB].some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0))throw Error();
    await rpc('talkroom_turn_usage_store',{p_slot:c.slot,p_revision:c.revision,p_usage:d.usageInGB*1000,p_quota:d.quotaInGB*1000,p_error:null},'Bearer '+service,service);
   }catch{await rpc('talkroom_turn_usage_store',{p_slot:c.slot,p_revision:c.revision,p_usage:null,p_quota:null,p_error:'官方用量查詢失敗'},'Bearer '+service,service);}
  }));
  const data=session?await rpc('talkroom_turn_resolve',{p_session:session},auth,anon):await rpc('talkroom_turn_manage',{p_action:'list',p_payload:{}},auth,anon);
  return reply(200,data);
 }catch{return reply(503,{error:'TURN 設定暫時無法取得，可能額度已用完且沒有備援，請管理員確認'});}
});
