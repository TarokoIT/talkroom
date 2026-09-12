import {CONFIG} from './config.js';
import {ROOMS,canTransmit,roleFor,voiceTargets,messageNode,channelLabel} from './candidate-core.js?v=1';
import {isVoiceConnected,voiceFailure,shouldPruneIncoming,preferOutgoing,authorizedVoicePeer} from './voice-core.js?v=2.1.3';
const $=id=>document.getElementById(id);
const client=window.supabase.createClient(CONFIG.url,CONFIG.key,{
 auth:{storage:window.sessionStorage,storageKey:'talkroom-candidate-auth'},
 global:{fetch:(url,options={})=>fetch(url,{...options,signal:options.signal||AbortSignal.timeout(15000)})}
});
let selected='VOICE_TEST',state=null,peer=null,stream=null,mic=false,speaker=true;
let timer=null,syncTask=null,peers=[],messagesKey='',generation=0,lastSync=0;
let audioContext=null,wakeLock=null,joining=false,micBusy=false,toneCleanup=null;
const outgoing=new Map(),incoming=outgoing,allCalls=new Set(),mediaElements=new Map();
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
 button.setAttribute('aria-label',channelLabel(room.code)+' '+room.title);
 for(const [tag,cls,text] of [['span','code',channelLabel(room.code)],['strong','',room.title],['span','desc',room.code==='BROADCAST'?'單向廣播':'獨立通訊頻道'],['span','room-icon',room.icon],['span','occupancy','人數讀取中…']]){
  const el=document.createElement(tag);el.className=cls;el.textContent=text;button.append(el);
 }
 button.addEventListener('click',()=>choose(room.code));$('rooms').append(button);
}
$('rooms').setAttribute('role','radiogroup');$('rooms').setAttribute('aria-label','選擇房間');
$('role').addEventListener('change',()=>{$('password').value='';updateRole();});choose('VOICE_TEST');
async function refreshCatalog(){
 if(state||document.hidden||catalogBusy)return;catalogBusy=true;
 try{
  const {data,error}=await client.rpc('talkroom_catalog');if(error)throw error;
  if(state)return;
  for(const room of data){
   catalog.set(room.code,room);
   const button=[...$('rooms').children].find(b=>b.dataset.room===room.code);if(!button)continue;
   button.querySelector('strong').textContent=room.title;button.setAttribute('aria-label',channelLabel(room.code)+' '+room.title);
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
  const instance=new window.Peer({config:{iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'},{urls:'stun:stun2.l.google.com:19302'}]}});
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
  // Restore the original duplex setup: prepare a muted microphone before joining.
  // Broadcast listeners remain receive-only and never request microphone access.
  if(role==='member'){
   stream=await candidateMedia();
   stream.getAudioTracks().forEach(track=>track.enabled=false);
  }
  const {data:authData,error:authError}=await client.auth.getSession();if(authError)throw authError;
  if(!authData.session){const {error}=await client.auth.signInAnonymously();if(error)throw error;}
  const peerId=await createPeer();
  const joined=await rpc('join',{room,role,username,password,peer_id:peerId},null);
  state={...joined,username,peer_id:peerId};generation++;mic=false;speaker=true;peers=[];messagesKey='';historyRevision=null;
  $('password').value='';$('login-status').textContent='';$('login-screen').hidden=true;$('room-screen').hidden=false;
  if(stream)watchAudio(state.session_id,stream);
  $('room-title').textContent=joined.title;$('room-code').textContent=channelLabel(joined.room);
  $('broadcast-banner').hidden=joined.room!=='BROADCAST';
  $('mic-button').hidden=!canTransmit(joined.role);$('message-form').hidden=joined.role==='listener';
  $('text-tools').hidden=joined.role==='listener';
  $('room-error').textContent='';$('resume-audio').hidden=true;updateControls();
  await sync();timer=setInterval(()=>sync().catch(report),2000);requestWakeLock();
 }catch(e){
  if(state)await leave(false);
  peer?.destroy();peer=null;
  stream?.getTracks().forEach(track=>track.stop());stream=null;
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
 const connected=[...outgoing.values()].filter(e=>isVoiceConnected(e.call.peerConnection));
 const sending=state.room==='BROADCAST'?[...outgoing.values()].filter(e=>isVoiceConnected(e.call.peerConnection)).length:connected.length;
 const receiving=state.room==='BROADCAST'?[...incoming.values()].filter(e=>isVoiceConnected(e.call.peerConnection)).length:connected.length;
 const targets=canTransmit(state.role)?voiceTargets(peers,state).length:0;
 $('voice-status').textContent=(mic?'麥克風已開啟 · 語音接通 '+sending+'/'+targets+' 台':'麥克風已關閉')+
  (speaker?' · 收聽連線 '+receiving+' 台':' · 收聽已關閉');
}
function updateRemoteMute(){
 for(const map of [outgoing,incoming])for(const [id,entry] of map){
  if(entry.audio)entry.audio.muted=!speaker;
 }
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
   for(const entry of allCalls)if(!peers.some(p=>p.id===entry.id)){diag('roster-removes-call');entry.call.close();}
   updateRemoteMute();
   status(peer?.disconnected?'資料已連線 · 語音重新連線中':'● 房間已連線 · '+current.username);
   for(const [id,entry] of incoming){
    if(shouldPruneIncoming(peers,id,entry.acceptedAt,snapshotStartedAt,current.room!=='BROADCAST'))closeEntry(incoming,id,entry);
   }
   for(const [id,entry] of outgoing){
    if(!peers.some(p=>p.id===id)){diag('roster-removes-call');closeEntry(outgoing,id,entry);}
   }
   if(mic&&canTransmit(current.role))for(const dest of voiceTargets(peers,current))startCall(dest,epoch);
   updateVoiceStatus();
  }catch(e){
   if(state!==current)return;diag('sync-error',{code:e.code||'unknown'});
   status('連線中斷，正在重試…');
   if(Date.now()-lastSync>10000){stopSending();for(const map of [incoming,outgoing])for(const [id,entry] of map)closeEntry(map,id,entry);}
   if(e.code==='42501'||errorText(e).includes('房間已滿')){
    await leave(false);$('login-status').textContent=errorText(e);
   }else report(e);
  }
 })().finally(()=>{syncTask=null;});
 return syncTask;
}
function closeEntry(map,id,entry){
 if(map.get(id)!==entry)return;diag('remove-call');map.delete(id);clearTimeout(entry.timeout);entry.audio?.remove();
 if(entry.audio)removeMeter(id);
 try{entry.call.close();}catch{}
}
function watchCall(map,id,call){
 const entry={id,call,audio:null,timeout:null,acceptedAt:performance.now()};map.set(id,entry);allCalls.add(entry);diag('call',{direction:call._originator?'out':'in'});
 const cleanup=()=>{allCalls.delete(entry);closeEntry(map,id,entry);diag('call-close');};
 call.on('close',cleanup);call.on('error',()=>{cleanup();report('語音連線發生錯誤，請查看診斷。');});
 call.on('iceStateChanged',()=>{
  if(map.get(id)!==entry)return;
  diag('ice',{state:call.peerConnection?.iceConnectionState});
  updateVoiceStatus();
 });
 return entry;
}
function startCall(dest,epoch){
 if(epoch!==generation||!state||outgoing.has(dest.id)||(state.room!=='BROADCAST'&&incoming.has(dest.id))||!mic||peer?.disconnected)return;
 try{
  // As in the original client, send the media offer directly. The destination
  // comes exclusively from our authenticated, server-filtered room snapshot.
  const call=peer.call(dest.peer_id,stream);
  if(!call)throw new Error('無法建立語音連線');
  const entry=watchCall(outgoing,dest.id,call);
  if(state.room!=='BROADCAST')attachRemoteAudio(outgoing,dest.id,entry,epoch);
 }catch(e){if(epoch===generation&&state)report(e);}
}
function acceptCall(call){
 const epoch=generation;
 const sender=authorizedVoicePeer(peers,state,call.peer,Date.now()-lastSync);
 if(!sender){diag('reject-call',{reason:'not in recent authorized room roster'});call.close();return;}
 try{
  call.answer(stream);
  const entry=watchCall(incoming,sender.id,call);
  attachRemoteAudio(incoming,sender.id,entry,epoch);
  // Do not await a database request between PeerJS's offer event and answer.

 }catch(e){call.close();if(epoch===generation&&state)report('語音接聽失敗：'+errorText(e));}
}
function attachRemoteAudio(map,id,entry,epoch){
  entry.call.on('stream',remote=>{
   if(epoch!==generation||map.get(id)!==entry)return;
   // A remote track can arrive before ICE connects; keep the connection watchdog running.
   entry.audio?.remove();watchAudio(id,remote);
   const audio=mediaElements.get(id)||document.createElement('audio');mediaElements.set(id,audio);audio.autoplay=true;audio.setAttribute('playsinline','');
   audio.srcObject=remote;entry.audio=audio;updateRemoteMute();$('audio-container').append(audio);
   audio.play().catch(()=>{$('resume-audio').hidden=false;});
  });
}
function stopSending(){
 mic=false;if(stream)for(const track of stream.getAudioTracks())track.enabled=false;
 for(const entry of [...allCalls])entry.call.close();allCalls.clear();
 for(const [id,entry] of outgoing)closeEntry(outgoing,id,entry);diag('mic-stop-closes-calls');
 updateControls();
}
$('mic-button').addEventListener('click',async()=>{
 if(!state||!canTransmit(state.role)||micBusy)return;
 micBusy=true;$('mic-button').disabled=true;const epoch=generation;
 try{
  if(mic)stopSending();
  else{
   if(!stream){
    const acquired=await candidateMedia();
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
 speaker=!speaker;updateRemoteMute();
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
 toneCleanup?.();toneCleanup=null;const old=state;state=null;generation++;clearInterval(timer);timer=null;stopSending();
 for(const map of [incoming,outgoing])for(const [id,entry] of map)closeEntry(map,id,entry);
 stream?.getTracks().forEach(t=>t.stop());stream=null;peer?.destroy();peer=null;
 for(const id of meters.keys())removeMeter(id);
 mediaElements.clear();$('audio-container').replaceChildren();$('chat-win').replaceChildren();$('user-list').replaceChildren();
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

const diagnosticEvents=[];let diagnosticSample=[];
function diag(event,detail={}){diagnosticEvents.push({at:new Date().toISOString(),event,...detail});if(diagnosticEvents.length>200)diagnosticEvents.shift();$('diagnostic-log').textContent=diagnosticEvents.slice(-30).map(x=>JSON.stringify(x)).join('\n');}
async function candidateMedia(){
 if($('candidate-source').value!=='tone')return navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
 const dest=audioContext.createMediaStreamDestination(),o=audioContext.createOscillator(),g=audioContext.createGain();g.gain.value=.06;
 const notes=[261.63,329.63,392,523.25,392,329.63];for(let i=0;i<7200;i++)o.frequency.setValueAtTime(notes[i%6],audioContext.currentTime+i*.5);
 o.connect(g);g.connect(dest);o.start();toneCleanup=()=>{o.stop();o.disconnect();g.disconnect();};return dest.stream;
}
setInterval(async()=>{
 const rows=[];for(const entry of allCalls){const pc=entry.call.peerConnection;if(!pc||pc.signalingState==='closed')continue;
 try{let sent=0,received=0,energy=0;for(const v of (await pc.getStats()).values()){if(v.type==='outbound-rtp')sent+=v.bytesSent||0;if(v.type==='inbound-rtp'){received+=v.bytesReceived||0;energy+=v.totalAudioEnergy||0;}}
 rows.push({ICE:pc.iceConnectionState,SDP:pc.signalingState,sentBytes:sent,receivedBytes:received,audioEnergy:energy});}catch{}}
 diagnosticSample=rows;$('diagnostic-stats').textContent=JSON.stringify(rows,null,2);
},1000);
$('diagnostic-export').onclick=()=>{const u=URL.createObjectURL(new Blob([JSON.stringify({version:'candidate-1',events:diagnosticEvents,connections:diagnosticSample},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='candidate-voice.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
