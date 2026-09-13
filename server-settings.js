import {parseIce,parseAccount,lamp} from './turn-settings-core.js';
export function setupServerSettings(client){
 const $=id=>document.getElementById(id);let snapshot=null,working=false,offset=0,lastLogs=[],logFilter=null;
 const rpc=async(name,args)=>{const {data,error}=await client.rpc(name,args);if(error)throw error;return data;};
 const manage=(action,payload={})=>rpc('talkroom_turn_manage',{p_action:action,p_payload:payload});
 const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
 const input=(form,label,type,value='')=>{const l=el('label',label),i=el('input');i.type=type;i.value=value;l.append(i);form.append(l);return i;};
 function draw(data){
  snapshot=data;$('server-lamps').replaceChildren();$('server-list').replaceChildren();$('route-list').replaceChildren();
  for(const s of data.servers){
   const state=lamp(s),active=data.routes.filter(r=>r.active_slot===s.slot).map(r=>data.rooms.find(x=>x.code===r.room)?.title||r.room);
   const light=el('button','','server-lamp '+state.color+(active.length?' active':''));light.type='button';light.title=(s.label||s.slot)+'；'+(active.length?'目前指派：'+active.join('、'):'未指派');light.onclick=()=>{show('servers');$('server-'+s.slot).scrollIntoView({behavior:'smooth'});};$('server-lamps').append(light);
   const form=el('form',undefined,'entry-panel');form.id='server-'+s.slot;form.append(el('h2',s.slot+' · '+(s.label||'未設定')));
   const caps=[s.quota_mb,s.provider_quota_mb].filter(v=>v!=null).map(Number),cap=caps.length?Math.min(...caps):null;
   light.append(el('strong',s.slot),el('span',(s.usage_mb==null?'?':Number(s.usage_mb).toFixed(1))+'/'+(cap??'∞')),el('span',s.usage_mb!=null&&cap>0?(100*s.usage_mb/cap).toFixed(1)+'%':'—'));light.setAttribute('aria-label',s.slot+'：'+state.text+'；用量單位 MB');light.title+='；用量單位 MB；'+state.text;
   form.append(el('p',(s.usage_mb==null?'用量未知':Number(s.usage_mb).toFixed(2)+' MB 已用')+' / '+(cap??'未限制')+' MB'+(cap!==null&&s.usage_mb!==null?'；剩餘 '+Math.max(0,cap-s.usage_mb).toFixed(2)+' MB':'')+'；'+(s.usage_at?'查詢／手動更新：'+new Date(s.usage_at).toLocaleString('zh-TW'):'尚未查詢'),'hint'));
   if(s.error)form.append(el('p',s.error,'error'));
   const label=input(form,'名稱','text',s.label);label.maxLength=60;
   const kind=el('select');kind.add(new Option('Metered（官方 API 用量）','metered'));kind.add(new Option('自建／其他 TURN（手動用量）','static'));kind.value=s.provider;form.append(el('label','服務類型'),kind);
   const ice=input(form,'連線設定檔：turn-config.txt 或 ICE JSON（留空保留原設定）','file');ice.accept='.txt,.json';
   const account=input(form,'Metered 帳號檔：metered-secret.txt（自建不需要）','file');account.accept='.txt';
   const quota=input(form,'流量上限 MB（留空採官方額度；自建留空為未限制）','number',s.quota_mb??'');quota.min=0;quota.step='any';
   const usage=input(form,'自建／其他：手動填入目前已用 MB（未知請留空）','number',s.provider==='static'?s.usage_mb??'':'');usage.min=0;usage.step='any';
   const enabled=input(form,'啟用','checkbox');enabled.checked=s.enabled;
   const save=el('button','儲存／匯入','primary'),probe=el('button','測試此端 TURN 連線','secondary');probe.type='button';const result=el('p','','status-text');form.append(save,document.createTextNode(' '),probe,result);
   form.onsubmit=async e=>{e.preventDefault();save.disabled=true;result.textContent='正在儲存…';try{
    const payload={slot:s.slot,label:label.value,provider:kind.value,enabled:enabled.checked,quota_mb:quota.value||null,usage_mb:usage.value||null};
    if([ice.files[0],account.files[0]].some(f=>f&&f.size>24000))throw Error('設定檔不得超過 24KB');
    if(ice.files[0])payload.ice_servers=parseIce(await ice.files[0].text());
    if(account.files[0])Object.assign(payload,parseAccount(await account.files[0].text()));
    if(!s.configured&&!payload.ice_servers)throw Error('請先匯入連線設定檔');
    if(kind.value==='metered'&&!s.has_secret&&!payload.secret)throw Error('請匯入 Metered 帳號檔');
    await manage('save',payload);ice.value='';account.value='';await refresh();$('pool-status').textContent='已儲存 '+s.slot+'。使用此伺服器的裝置會於約一分鐘內重新建立語音。';
   }catch(e){result.textContent=e.message;}finally{save.disabled=false;}};
   probe.onclick=async()=>{probe.disabled=true;result.textContent='正在向 TURN 申請中繼位址…';let pc;try{const d=await manage('probe',{slot:s.slot});pc=new RTCPeerConnection({iceServers:d.iceServers,iceTransportPolicy:'relay'});pc.createDataChannel('probe');await new Promise(async(resolve,reject)=>{const timer=setTimeout(()=>reject(Error('未取得 relay 位址，請檢查憑證或網路')),15000);pc.onicecandidate=e=>{if(e.candidate?.type==='relay'){clearTimeout(timer);resolve();}};try{await pc.setLocalDescription(await pc.createOffer());}catch(e){clearTimeout(timer);reject(e);}});result.textContent='此瀏覽器已取得 relay 位址；不代表其他裝置或雙向語音必定正常。';}catch(e){result.textContent=e.message;}finally{pc?.close();probe.disabled=false;}};
   $('server-list').append(form);
  }
  for(const r of data.routes){
   const form=el('form',undefined,'entry-panel'),select=el('select');for(const s of data.servers)select.add(new Option(s.slot+' · '+(s.label||'未設定'),s.slot));select.value=r.primary_slot;
   form.append(el('h3',data.rooms.find(x=>x.code===r.room)?.title||r.room),el('p','目前使用：'+r.active_slot),el('label','主要伺服器'),select);
   const fallback=input(form,'備援順序（例如 B,C；額度達上限時依序切換）','text',r.fallback_slots.join(','));
   const save=el('button','套用頻道設定','primary'),result=el('p','','status-text');form.append(save,result);
   form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await manage('route',{room:r.room,slot:select.value,fallback:[...new Set(fallback.value.toUpperCase().split(/[,，\s]+/).filter(Boolean))]});await refresh();$('pool-status').textContent='已切換頻道設定；裝置約一分鐘內重建語音，期間可能短暫中斷。';}catch(e){result.textContent=e.message;}finally{save.disabled=false;}};$('route-list').append(form);
  }
  const choice=$('device-room'),previous=choice.value;choice.replaceChildren(new Option('全部房間',''));for(const r of data.rooms)choice.add(new Option(r.title,r.code));choice.value=previous;
 }
 async function refresh(){if(working)return;working=true;$('pool-refresh').disabled=true;$('pool-status').textContent='正在更新…';try{const {data,error}=await client.functions.invoke('turn-pool',{body:{}});if(error||data?.error)throw Error(data?.error||'官方查詢暫時失敗');if($('admin-panel').hidden)return;draw(data);$('pool-status').textContent='已更新。黑框為頻道目前選用；綠／黃／紅表示用量，不代表連線健康。';}catch(e){$('pool-status').textContent=e.message;try{draw(await manage('list'));}catch{}}finally{working=false;$('pool-refresh').disabled=false;}}
 function show(view){for(const key of ['management','servers','devices'])$(key+'-view').hidden=key!==view;}
 for(const b of document.querySelectorAll('[data-admin-view]'))b.onclick=()=>show(b.dataset.adminView);
 $('pool-refresh').onclick=refresh;
 const filter=()=>({room:$('device-room').value,from:$('device-from').value,to:$('device-to').value,keyword:$('device-keyword').value});
 const time=v=>v?new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}):'';
 const cells=r=>[time(r.joined_at),time(r.ended_at),r.exit_reason||(r.last_seen&&Date.now()-Date.parse(r.last_seen)>60000?'逾時離線（推估）':'在線／待確認'),r.room,r.username,r.role,r.auth_method,r.request_ip_chain||'未知',r.user_agent||'未知',JSON.stringify(r.client),r.user_id,r.session_id];
 async function logs(n=0){try{if(n===0)logFilter=filter();const data=await rpc('talkroom_device_logs',{p_filter:{...logFilter,offset:n}});offset=n;lastLogs=data.rows;$('device-results').replaceChildren();for(const row of data.rows){const tr=el('tr');for(const v of cells(row))tr.append(el('td',v));$('device-results').append(tr);}$('device-status').textContent=data.total?'共 '+data.total+' 筆，顯示 '+(n+1)+'～'+(n+data.rows.length):'沒有符合條件的紀錄';$('device-prev').disabled=n===0;$('device-next').disabled=n+100>=data.total;}catch(e){$('device-status').textContent=e.message;}}
 $('device-search').onclick=()=>logs(0);$('device-prev').onclick=()=>logs(Math.max(0,offset-100));$('device-next').onclick=()=>logs(offset+100);
 $('device-export').onclick=async()=>{const button=$('device-export');button.disabled=true;try{const f=filter(),rows=[];for(let n=0;n<10000;n+=100){const d=await rpc('talkroom_device_logs',{p_filter:{...f,offset:n}});if(d.total>10000)throw Error('超過 10,000 筆，請縮小條件');rows.push(...d.rows);if(n+100>=d.total)break;}const quote=v=>'"'+String(v??'').replace(/^[\s]*[=+@-]/,"'$&").replaceAll('"','""')+'"';const text='\uFEFF'+[['登入時間','登出時間','狀態','房間','姓名','角色','登入方式','請求 IP／代理鏈','User-Agent','裝置資料','使用者ID','工作階段ID'],...rows.map(cells)].map(r=>r.map(quote).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})),a=el('a');a.href=url;a.download='device-log.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){$('device-status').textContent=e.message;}finally{button.disabled=false;}};
 return {refresh};
}
