const $=id=>document.getElementById(id);
let peer,stream,ctx,osc,tick,statsTick,ids=[],slot,mic=false,speaker=true,epoch=0;
const active=new Map(),all=new Set(),audio=new Map(),events=[];
let samples=[],sequence=0,lastErrors=new Map();
function log(type,detail={}){events.push({at:new Date().toISOString(),type,...detail});if(events.length>500)events.shift();$('log').textContent=events.slice(-50).map(e=>JSON.stringify(e)).join('\n');}
function who(id){return ids.indexOf(id)+1;}
function controls(joined){for(const id of ['mic','speaker','leave'])$(id).disabled=!joined;$('join').disabled=joined;}
function attach(call){
 const number=who(call.peer),row={call,number,id:++sequence};all.add(row);active.set(call.peer,call);
 call.on('stream',remote=>{log('remote-stream',{端:number});let a=audio.get(call.peer);if(!a){a=document.createElement('audio');a.autoplay=true;a.setAttribute('playsinline','');audio.set(call.peer,a);$('audio').append(a);}a.srcObject=remote;a.muted=!speaker;a.play().then(()=>log('play-start',{端:number})).catch(e=>log('play-blocked',{端:number,error:e.name}));});
 call.on('close',()=>{log('call-close',{端:number});if(active.get(call.peer)===call){active.delete(call.peer);audio.get(call.peer)?.remove();audio.delete(call.peer);}});
 call.on('error',e=>{log('call-error',{端:number,error:e.type||e.name});if(active.get(call.peer)===call)active.delete(call.peer);});
 const pc=call.peerConnection;
 if(pc){pc.addEventListener('iceconnectionstatechange',()=>log('ice',{端:number,state:pc.iceConnectionState}));pc.addEventListener('connectionstatechange',()=>log('connection',{端:number,state:pc.connectionState}));}
}
function dial(){if(!peer||!mic||!stream||peer.disconnected)return;for(const id of ids){if(id===peer.id||active.has(id))continue;try{log('call-out',{端:who(id)});const call=peer.call(id,stream);if(call)attach(call);}catch(e){log('dial-error',{error:e.name});}}}
async function stats(){
 const result=[];
 for(const row of all){const pc=row.call.peerConnection;if(!pc||pc.signalingState==='closed')continue;try{const reports=await pc.getStats();let sent=0,received=0,packets=0,energy=0,local=0,remote=0,pair='none',dtls='unknown';for(const r of reports.values()){if(r.type==='outbound-rtp'&&!r.isRemote)sent+=r.bytesSent||0;if(r.type==='inbound-rtp'&&!r.isRemote){received+=r.bytesReceived||0;packets+=r.packetsReceived||0;energy+=r.totalAudioEnergy||0;}if(r.type==='local-candidate')local++;if(r.type==='remote-candidate')remote++;if(r.type==='transport'){dtls=r.dtlsState||dtls;const p=reports.get(r.selectedCandidatePairId);if(p){const a=reports.get(p.localCandidateId),b=reports.get(p.remoteCandidateId);pair=(a?.candidateType||'?')+' → '+(b?.candidateType||'?');}}}result.push({call:row.id,端:row.number,ICE:pc.iceConnectionState,SDP:pc.signalingState,DTLS:dtls,localCandidates:local,remoteCandidates:remote,pair,sentBytes:sent,receivedBytes:received,receivedPackets:packets,audioEnergy:energy});}catch(e){log('stats-error',{error:e.name});}}
 samples=result;$('stats').replaceChildren();for(const r of result){const el=document.createElement('pre');el.textContent=JSON.stringify(r,null,2);$('stats').append(el);}if(!result.length)$('stats').textContent='目前沒有語音連線。';
}
$('join').onclick=async()=>{
 const code=$('code').value.trim();if(code.length<12){$('status').textContent='配對碼至少需要 12 字元。';return;}
 const run=++epoch;$('join').disabled=true;slot=Number($('slot').value);mic=false;speaker=true;
 try{
 ctx=new AudioContext();await ctx.resume();
 if($('source').value==='tone'){const dest=ctx.createMediaStreamDestination(),gain=ctx.createGain();osc=ctx.createOscillator();osc.frequency.value=440;gain.gain.value=.06;osc.connect(gain);gain.connect(dest);osc.start();stream=dest.stream;}else stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
 if(run!==epoch)return;stream.getAudioTracks().forEach(t=>t.enabled=false);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code));const hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');ids=[1,2,3].map(i=>'trtest-'+hash+'-'+i);
 peer=new Peer(ids[slot-1],{config:{iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'},{urls:'stun:stun2.l.google.com:19302'}]}});
 peer.on('open',()=>{if(run!==epoch)return;controls(true);$('status').textContent='第 '+slot+' 端已加入 · 發話關閉 · 收聽開啟';log('peer-open',{slot,source:$('source').value});tick=setInterval(dial,2000);statsTick=setInterval(stats,1000);});
 peer.on('call',call=>{if(!ids.includes(call.peer)||call.peer===peer.id){call.close();return;}log('call-in',{端:who(call.peer)});call.answer(stream);attach(call);});
 peer.on('error',e=>{const now=Date.now();if(now-(lastErrors.get(e.type)||0)>5000){log('peer-error',{error:e.type});lastErrors.set(e.type,now);}if(e.type==='unavailable-id'){$('status').textContent='此端編號已有人使用，請選不同編號。';leave(false);}else if(e.type!=='peer-unavailable')$('status').textContent='語音服務錯誤：'+e.type;});
 peer.on('disconnected',()=>{log('signaling-disconnected');$('status').textContent='訊號服務已斷線，請退出再加入。';});
 }catch(e){log('join-error',{error:e.name});$('status').textContent='加入失敗：'+e.name;leave(false);}
};
$('mic').onclick=()=>{mic=!mic;stream.getAudioTracks().forEach(t=>t.enabled=mic);$('mic').textContent=mic?'停止發話':'開啟發話';log('mic',{enabled:mic});if(mic)setTimeout(dial,300);else{for(const call of active.values())call.close();active.clear();} }; // Original microphone-off lifecycle.
$('speaker').onclick=()=>{speaker=!speaker;$('speaker').textContent='收聽：'+(speaker?'開':'關');for(const a of audio.values()){a.muted=!speaker;if(speaker)a.play().catch(e=>log('play-blocked',{error:e.name}));}ctx?.resume();log('speaker',{enabled:speaker});};
function leave(update=true){epoch++;clearInterval(tick);clearInterval(statsTick);for(const row of all)row.call.close();active.clear();all.clear();for(const a of audio.values())a.remove();audio.clear();stream?.getTracks().forEach(t=>t.stop());stream=null;peer?.destroy();peer=null;osc?.stop();osc=null;ctx?.close();ctx=null;mic=false;controls(false);$('mic').textContent='開啟發話';if(update)$('status').textContent='已退出';log('leave');}
$('leave').onclick=()=>leave();
$('export').onclick=()=>{const blob=new Blob([JSON.stringify({version:'TEST 1.0',slot,at:new Date().toISOString(),events,samples},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='talkroom-test-'+(slot||'unknown')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
window.addEventListener('pagehide',()=>leave());
