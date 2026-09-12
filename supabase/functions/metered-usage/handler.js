export function createHandler({env,fetchImpl=fetch,now=()=>new Date()}) {
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'https://tarokoit.github.io','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
 const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers});
 return async req=>{
  if(req.headers.get('origin')&&req.headers.get('origin')!=='https://tarokoit.github.io')return reply(403,{error:'禁止的來源'});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply(405,{error:'不支援的請求'});
  const authorization=req.headers.get('authorization');
  if(!authorization?.startsWith('Bearer '))return reply(401,{error:'請登入管理後台'});
  try {
   const base=env('SUPABASE_URL'),anon=env('SUPABASE_ANON_KEY'),service=env('SUPABASE_SERVICE_ROLE_KEY');
   const auth=await fetchImpl(base+'/rest/v1/rpc/talkroom_admin',{method:'POST',headers:{apikey:anon,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({p_action:'list',p_payload:{}}),signal:AbortSignal.timeout(10000)});
   if(!auth.ok||!(await auth.json())?.ok)return reply(403,{error:'需要已驗證的管理員帳號'});
   const config=await fetchImpl(base+'/rest/v1/rpc/talkroom_metered_account',{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
   if(!config.ok)throw Error('config');
   const {domain,secret}=await config.json();
   if(!/^[-a-z0-9]+\.metered\.live$/.test(domain)||!secret)throw Error('config');
   const url=new URL('https://'+domain+'/api/v1/turn/current_usage');url.searchParams.set('secretKey',secret);
   const response=await fetchImpl(url,{signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error('provider');
   const data=await response.json();
   const values=['quotaInGB','usageInGB','overageInGB'].map(k=>data[k]);
   if(values.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0))throw Error('format');
   const [quotaInGB,usageInGB,overageInGB]=values;
   return reply(200,{quotaInGB,usageInGB,overageInGB,remainingInGB:Math.max(0,quotaInGB-usageInGB),checkedAt:now().toISOString()});
  }catch {return reply(502,{error:'暫時無法取得 Metered 用量，請稍後重新整理'});}
 };
}
