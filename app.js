import {CONFIG} from './config.js';
import {ROOMS,canTransmit,roleFor,voiceTargets,messageNode} from './core.js';
import {isVoiceConnected,voiceFailure,shouldPruneIncoming} from './voice-core.js';
const $=id=>document.getElementById(id);
const client=window.supabase.createClient(CONFIG.url,CONFIG.key,{
 auth:{storage:window.sessionStorage,storageKey:'talkroom-auth-v2'},
 global:{fetch:(url,options={})=>fetch(url,{...options,signal:options.signal||AbortSignal.timeout(15000)})}
});
let selected='HK',state=null,peer=null,stream=null,mic=false,speaker=true;
let timer=null,syncTask=null,peers=[],messagesKey='',generation=0,lastSync=0;
let audioContext=null,wakeLock=null,joining=false,micBusy=false;
const outgoing=new Map(),incoming=new Map(),pending=new Set();
const catalog=new Map();let catalogBusy=false;
let historyRevision=null;
const meters=new Map();
function removeMeter(id){const meter=meters.get(id);if(meter){meter.source.disconnect();meter.analyser.disconnect();meters.delete(id);}}
function watchAudio(id,media){
 removeMeter(id);if(!audioContext)return;
 const source=audioContext.createMediaStreamSource(media),analyser=audioContext.createAnalyser();
 analyser.fftSize=512;source.connect(analyser);
 meters.set(id,{source,analyser,samples:new Float32Array(512),activeUntil:0});
}
setInterval(()=>{
 const now=performance.now();
 for(const [id,meter] of meters){
  meter.analyser.getFloatTimeDomainData(meter.samples);
  const rms=Math.sqrt(meter.samples.reduce((sum,v)=>sum+v*v,0)/meter.samples.length);
  if(audioContext?.state==='running'&&rms>.025&&(id!==state?.session_id||mic))meter.activeUntil=now+280;
 }
 for(const tag of $('user-list').children){
  const talking=!!state&&!!peers.find(p=>p.id===tag.dataset.session&&p.mic)&&
   (meters.get(tag.dataset.session)?.activeUntil||0)>now;
  tag.classList.toggle('speaking',talking);
 }
},100);
function errorText(e){return e?.message||String(e);}
function status(text){$('connection-status').textContent=text;}
function report(e){$('room-error').textContent=errorText(e);}
function choose(code){
 selected=code;
 for(const button of $('rooms').children)button.setAttribute('aria-checked',String(button.dataset.room===code));
 const room=catalog.get(code)||ROOMS.find(r=>r.code===code);
 $('selected-title').textContent=room.title;
 $('selected-description').textContent=code==='BROADCAST'?'1 台控制台 · 最多 15 台收聽工作站':'部門獨立通訊 · 最多 15 人';
 $('broadcast-role').hidden=code!=='BROADCAST';
 $('join-button').textContent='進入'+room.title+' →';
 $('password').value='';$('login-status').textContent='';
 updateRole();
}
function updateRole(){
 const control=selected==='BROADCAST'&&$('role').value==='controller';
 $('password-label').textContent=control?'控制台專用密碼':'房間密碼';
 $('role-description').textContent=control?'使用獨立控制台密碼，僅向廣播工作站發話。':'只接收廣播，不需要麥克風。';
}
for(const room of ROOMS){
 const button=document.createElement('button');button.type='button';button.className='room-card';
 button.dataset.room=room.code;button.setAttribute('role','radio');
 button.setAttribute('aria-label',room.code+' '+room.title);
 for(const [tag,cls,text] of [['span','code',room.code],['strong','',room.title],['span','desc',room.code==='BROADCAST'?'單向廣播':'獨立通訊頻道'],['span','room-icon',room.icon],['span','occupancy','人數讀取中…']]){
  const el=document.createElement(tag);el.className=cls;el.textContent=text;button.append(el);
 }
 button.addEventListener('click',()=>choose(room.code));$('rooms').append(button);
}
$('rooms').setAttribute('role','radiogroup');$('rooms').setAttribute('aria-label','選擇房間');
$('role').addEventListener('change',()=>{$('password').value='';updateRole();});choose('HK');
async function refreshCatalog(){
 if(state||document.hidden||catalogBusy)return;catalogBusy=true;
 try{
  const {data,error}=await client.rpc('talkroom_catalog');if(error)throw error;
  if(state)return;
  for(const room of data){
   catalog.set(room.code,room);
   const button=[...$('rooms').children].find(b=>b.dataset.room===room.code);if(!button)continue;
   button.querySelector('strong').textContent=room.title;button.setAttribute('aria-label',room.code+' '+room.title);
   const count=button.querySelector('.occupancy');
   const full=room.code==='BROADCAST'?room.listeners>=room.capacity:room.online>=room.capacity;
   count.classList.toggle('full',full);
   count.textContent=room.code==='BROADCAST'
    ?room.listeners+' / '+room.capacity+' 工作站 · 控制台 '+room.controllers
    :room.online+' / '+room.capacity+' 人'+(full?' · 已滿':'');
  }
  if(!joining){const selectedRoom=catalog.get(selected);if(selectedRoom){$('selected-title').textContent=selectedRoom.title;$('join-button').textContent='進入'+selectedRoom.title+' →';}}
  $('catalog-status').textContent='人數約每 10 秒更新；意外斷線最多約 1 分鐘後移除。';
 }catch{$('catalog-status').textContent='目前無法更新人數；顯示可能已過期，加入時會由伺服器確認名額。';}
 finally{catalogBusy=false;}
}
refreshCatalog();setInterval(refreshCatalog,10000);

async function rpc(action,payload={},session=state?.session_id){
 const {data,error}=await client.rpc('talkroom_api',{p_action:action,p_session:session||null,p_payload:payload});
 if(error)throw error;
 if(!data?.ok)throw new Error(data?.error||'伺服器未回應，請稍後重試');
 return data;
}
function createPeer(){
 return new Promise((resolve,reject)=>{
  const instance=new window.Peer({config:{iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]}});
  peer=instance;
  const timeout=setTimeout(()=>{instance.destroy();reject(new Error('語音服務連線逾時，請再試一次'));},15000);
  instance.once('open',id=>{clearTimeout(timeout);resolve(id);});
  instance.on('call',call=>acceptCall(call));
  instance.on('error',e=>{
   clearTimeout(timeout);
   if(!state)reject(new Error('語音服務無法連線：'+e.type));
   else report('語音連線問題：'+e.type+'。若持續無聲，請退出後重新進入。');
  });
  instance.on('disconnected',()=>{
   if(state&&peer===instance){status('語音服務重新連線中…');try{instance.reconnect();}catch(e){report(e);}}
  });
 });
}
async function unlockAudio(){
 if(!audioContext)audioContext=new (window.AudioContext||window.webkitAudioContext)();
 if(audioContext.state==='suspended')await audioContext.resume();
 // Start a silent buffer during the user gesture; actual media may still require explicit play.
 const buffer=audioContext.createBuffer(1,1,22050),source=audioContext.createBufferSource();
 source.buffer=buffer;source.connect(audioContext.destination);source.start();
}
async function requestWakeLock(){
 try{if('wakeLock' in navigator&&!document.hidden)wakeLock=await navigator.wakeLock.request('screen');}catch{}
}
$('login-form').addEventListener('submit',async event=>{
 event.preventDefault();if(joining)return;joining=true;
 $('join-button').disabled=true;$('login-status').textContent='正在驗證裝置與房間…';
 const room=selected,role=roleFor(room,$('role').value),username=$('nickname').value.trim(),password=$('password').value;
 try{
  await unlockAudio();
  const {data:authData,error:authError}=await client.auth.getSession();if(authError)throw authError;
  if(!authData.session){const {error}=await client.auth.signInAnonymously();if(error)throw error;}
  const peerId=await createPeer();
  const joined=await rpc('join',{room,role,username,password,peer_id:peerId},null);
  state={...joined,username,peer_id:peerId};generation++;mic=false;speaker=true;peers=[];messagesKey='';historyRevision=null;
  $('password').value='';$('login-status').textContent='';$('login-screen').hidden=true;$('room-screen').hidden=false;
  $('room-title').textContent=joined.title;$('room-code').textContent=joined.room;
  $('broadcast-banner').hidden=joined.room!=='BROADCAST';
  $('mic-button').hidden=!canTransmit(joined.role);$('message-form').hidden=joined.role==='listener';
  $('text-tools').hidden=joined.role==='listener';
  $('room-error').textContent='';$('resume-audio').hidden=true;updateControls();
  await sync();timer=setInterval(()=>sync().catch(report),2000);requestWakeLock();
 }catch(e){
  if(state)await leave(false);
  peer?.destroy();peer=null;
  $('login-status').textContent=errorText(e);
 }finally{joining=false;$('join-button').disabled=false;}
});
function updateControls(){
 $('mic-button').setAttribute('aria-pressed',String(mic));
 $('mic-button').textContent=mic?'🎙 停止發話':'🎤 開啟麥克風';
 $('speaker-button').setAttribute('aria-pressed',String(speaker));
 $('speaker-button').textContent=speaker?'🔊 收聽開啟':'🔇 收聽關閉';
 $('voice-status').textContent=state?.role==='listener'?'收聽工作站 · 麥克風停用':mic?'正在向此房間發話':'麥克風已關閉'+(speaker?' · 仍可收聽':' · 收聽已關閉');
 updateVoiceStatus();
}
function updateVoiceStatus(){
 if(!state)return;
 const sending=[...outgoing.values()].filter(e=>isVoiceConnected(e.call.peerConnection)).length;
 const receiving=[...incoming.values()].filter(e=>isVoiceConnected(e.call.peerConnection)).length;
 const targets=canTransmit(state.role)?voiceTargets(peers,state).length:0;
 $('voice-status').textContent=(mic?'麥克風已開啟 · 語音接通 '+sending+'/'+targets+' 台':'麥克風已關閉')+
  (speaker?' · 收聽連線 '+receiving+' 台':' · 收聽已關閉');
}
function render(data){
 peers=data.peers;
 const list=$('user-list');list.replaceChildren();
 for(const p of peers){
  const tag=document.createElement('div');tag.className='user-tag '+(p.speaker?'listening':'not-listening');tag.dataset.session=p.id;
  tag.title=(p.speaker?'收聽開啟':'收聽關閉')+'；黃色底表示偵測到聲音';
  tag.setAttribute('aria-label',p.username+'，'+(p.speaker?'收聽開啟':'收聽關閉'));
  const name=document.createElement('span');name.textContent=p.username+(p.id===state.session_id?'（我）':'');
  tag.append(name);list.append(tag);
 }
 $('member-count').textContent=state.room==='BROADCAST'?peers.filter(p=>p.role==='listener').length+' / 15 台工作站':peers.length+' / 15 人';
 if(Array.isArray(data.messages)){
 const nextKey=data.messages.map(m=>m.id).join(',');
 if(nextKey!==messagesKey||!$('chat-win').children.length){
  const win=$('chat-win'),atBottom=win.scrollHeight-win.scrollTop-win.clientHeight<80;
  const previousIds=new Set(messagesKey.split(','));
  if(messagesKey&&data.messages.some(m=>!previousIds.has(m.id)&&m.session_id!==state.session_id))ding();
  win.replaceChildren();
  if(!data.messages.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='此房間還沒有訊息。';win.append(empty);}
  else for(const m of data.messages)win.append(messageNode(document,m,state.session_id));
  if(atBottom||!messagesKey)win.scrollTop=win.scrollHeight;
  messagesKey=nextKey;
 }
 }
 if(state.room==='BROADCAST'){
  const controller=peers.find(p=>p.role==='controller');
  $('broadcast-state').textContent=!controller?'等待廣播控制台':controller.mic?'控制台發話中':'控制台已連線';
  $('broadcast-detail').textContent=state.role==='controller'
   ?'廣播僅傳送至此頻道的工作站。其他部門不受影響。'
   :(incoming.size?'已建立語音連線。':'等待語音連線。')+' 此工作站不會發話。';
 }
}
function sync(){
 if(!state)return Promise.resolve();if(syncTask)return syncTask;
 const current=state,epoch=generation,snapshotStartedAt=performance.now();
 syncTask=(async()=>{
  try{
   const data=await rpc('sync',{mic,speaker,latest_message_id:messagesKey.split(',').at(-1)||null,history_revision:historyRevision});
   if(state!==current||epoch!==generation)return;
   lastSync=Date.now();render(data);historyRevision=data.history_revision??null;
   status(peer?.disconnected?'資料已連線 · 語音重新連線中':'● 房間已連線 · '+current.username);
   for(const [id,entry] of incoming){
    if(shouldPruneIncoming(peers,id,entry.acceptedAt,snapshotStartedAt))closeEntry(incoming,id,entry);
   }
   for(const [id,entry] of outgoing){
    if(!peers.some(p=>p.id===id))closeEntry(outgoing,id,entry);
   }
   if(mic&&canTransmit(current.role))for(const dest of voiceTargets(peers,current))startCall(dest,epoch);
   updateVoiceStatus();
  }catch(e){
   if(state!==current)return;
   status('連線中斷，正在重試…');
   if(Date.now()-lastSync>10000){stopSending();for(const [id,entry] of incoming)closeEntry(incoming,id,entry);}
   if(e.code==='42501'||errorText(e).includes('房間已滿')){
    await leave(false);$('login-status').textContent=errorText(e);
   }else report(e);
  }
 })().finally(()=>{syncTask=null;});
 return syncTask;
}
function closeEntry(map,id,entry){
 if(map.get(id)!==entry)return;map.delete(id);clearTimeout(entry.timeout);entry.audio?.remove();
 if(map===incoming)removeMeter(id);
 try{entry.call.close();}catch{}
}
function watchCall(map,id,call){
 const entry={call,audio:null,timeout:null,acceptedAt:performance.now()};map.set(id,entry);
 const cleanup=()=>closeEntry(map,id,entry);
 call.on('close',cleanup);call.on('error',()=>{cleanup();report('語音連線失敗，將自動重試；跨網路可能需要 TURN。');});
 call.on('iceStateChanged',()=>{
  if(map.get(id)!==entry)return;
  if(isVoiceConnected(call.peerConnection))clearTimeout(entry.timeout);
  updateVoiceStatus();
 });
 entry.timeout=setTimeout(()=>{
  const pc=call.peerConnection;
  if(!isVoiceConnected(pc)){
   const reason=voiceFailure(pc);cleanup();report(reason);updateVoiceStatus();
  }
 },20000);
 return entry;
}
async function startCall(dest,epoch){
 if(outgoing.has(dest.id)||pending.has(dest.id)||!mic||peer?.disconnected)return;
 pending.add(dest.id);
 try{
  const ticket=await rpc('ticket',{recipient:dest.id});
  if(epoch!==generation||!state||!mic)return;
  const call=peer.call(ticket.peer_id,stream,{metadata:{ticket:ticket.ticket,version:2}});
  if(!call)throw new Error('無法建立語音連線');
  watchCall(outgoing,dest.id,call);
  // Send-only: never play a remote stream returned on an outgoing connection.
 }catch(e){if(epoch===generation&&state)report(e);}
 finally{pending.delete(dest.id);}
}
async function acceptCall(call){
 const epoch=generation;
 if(!state||call.metadata?.version!==2||typeof call.metadata?.ticket!=='string'){call.close();return;}
 try{
  const result=await rpc('accept',{ticket:call.metadata.ticket,peer_id:call.peer});
  if(epoch!==generation||!state){call.close();return;}
  const old=incoming.get(result.sender);if(old)closeEntry(incoming,result.sender,old);
  const entry=watchCall(incoming,result.sender,call);
  call.on('stream',remote=>{
   if(epoch!==generation||incoming.get(result.sender)!==entry)return;
   // A remote track can arrive before ICE connects; keep the connection watchdog running.
   watchAudio(result.sender,remote);
   const audio=document.createElement('audio');audio.autoplay=true;audio.setAttribute('playsinline','');
   audio.srcObject=remote;audio.muted=!speaker;entry.audio=audio;$('audio-container').append(audio);
   audio.play().catch(()=>{$('resume-audio').hidden=false;});
  });
  call.answer(); // One-way receive: listeners never return a microphone stream.
 }catch(e){call.close();if(epoch===generation&&state)report('語音邀請驗證未通過：'+errorText(e));}
}
function stopSending(){
 mic=false;if(stream)for(const track of stream.getAudioTracks())track.enabled=false;
 for(const [id,entry] of outgoing)closeEntry(outgoing,id,entry);
 updateControls();
}
$('mic-button').addEventListener('click',async()=>{
 if(!state||!canTransmit(state.role)||micBusy)return;
 micBusy=true;$('mic-button').disabled=true;const epoch=generation;
 try{
  if(mic)stopSending();
  else{
   if(!stream){
    const acquired=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    if(epoch!==generation||!state){acquired.getTracks().forEach(t=>t.stop());return;}
    stream=acquired;
    watchAudio(state.session_id,stream);
   }
   mic=true;stream.getAudioTracks().forEach(t=>t.enabled=true);updateControls();
  }
  await sync();await sync(); // Flush current mic state after any already-running heartbeat.
 }catch(e){stopSending();report('麥克風無法啟用：'+errorText(e));}
 finally{micBusy=false;$('mic-button').disabled=false;}
});
$('speaker-button').addEventListener('click',()=>{
 speaker=!speaker;for(const audio of $('audio-container').children)audio.muted=!speaker;
 updateControls();if(speaker)resumeAudio();sync().catch(report);
});
async function resumeAudio(){
 try{
  await unlockAudio();
  const results=await Promise.allSettled([...$('audio-container').children].map(audio=>audio.play()));
  $('resume-audio').hidden=!results.some(r=>r.status==='rejected');
 }catch{$('resume-audio').hidden=false;}
}
$('resume-audio').addEventListener('click',resumeAudio);
$('message-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.isComposing){e.preventDefault();if(!$('send-button').disabled)$('message-form').requestSubmit();}});
$('message-form').addEventListener('submit',async event=>{
 event.preventDefault();if(!state||!canTransmit(state.role))return;
 const text=$('message-input').value.trim();if(!text)return;
 $('send-button').disabled=true;
 try{await rpc('message',{message:text,name_color:$('name-color').value,text_color:$('text-color').value,font_size:$('font-size').value});$('message-input').value='';$('room-error').textContent='';await sync();}
 catch(e){report(e);}finally{$('send-button').disabled=false;}
});
async function leave(notify=true){
 const old=state;state=null;generation++;clearInterval(timer);timer=null;stopSending();
 for(const [id,entry] of incoming)closeEntry(incoming,id,entry);
 pending.clear();stream?.getTracks().forEach(t=>t.stop());stream=null;peer?.destroy();peer=null;
 for(const id of meters.keys())removeMeter(id);
 $('audio-container').replaceChildren();$('chat-win').replaceChildren();$('user-list').replaceChildren();
 $('room-screen').hidden=true;$('login-screen').hidden=false;$('password').value='';
 try{await wakeLock?.release();}catch{}wakeLock=null;
 if(notify)$('login-status').textContent='已退出，可選擇其他房間。';
 if(old)try{await rpc('leave',{},old.session_id);}catch(e){if(notify)$('login-status').textContent='已退出；伺服器會在一分鐘內更新離線狀態。';}
 if(notify&&!$('login-status').textContent)$('login-status').textContent='已退出，可選擇其他房間。';
 refreshCatalog();
}
$('leave-button').addEventListener('click',()=>leave());
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state){resumeAudio();requestWakeLock();sync().catch(report);}});
window.addEventListener('online',()=>{if(state)sync().catch(report);});
window.addEventListener('offline',()=>{if(state){stopSending();status('網路已離線，等待恢復…');}});
window.addEventListener('pagehide',()=>{if(state)leave(false);});
function ding(){
 if(!speaker||!audioContext||audioContext.state!=='running')return;
 for(const offset of [0,.15]){
  const oscillator=audioContext.createOscillator(),gain=audioContext.createGain();
  oscillator.connect(gain);gain.connect(audioContext.destination);
  oscillator.frequency.value=1000;gain.gain.setValueAtTime(.12,audioContext.currentTime+offset);
  gain.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+offset+.1);
  oscillator.start(audioContext.currentTime+offset);oscillator.stop(audioContext.currentTime+offset+.1);
 }
}
