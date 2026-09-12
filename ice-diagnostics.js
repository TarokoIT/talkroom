export function candidateInfo(value){
 const text=typeof value==='string'?value:value?.candidate||'';
 if(!text)return {end:true};const a=text.replace(/^a=/,'').trim().split(/\s+/),get=k=>{const i=a.indexOf(k);return i<0?undefined:a[i+1];};
 return {protocol:a[2],address:a[4],port:a[5],type:get('typ'),relatedAddress:get('raddr'),relatedPort:get('rport'),tcpType:get('tcptype'),sdpMid:value?.sdpMid,sdpMLineIndex:value?.sdpMLineIndex};
}
export function installDiagnostics(){
 const trace=[],history=[],pcs=new Map();let counter=0;
 const note=(event,data={})=>{trace.push({at:new Date().toISOString(),elapsedMs:Math.round(performance.now()),event,...data});if(trace.length>3000)trace.shift();};
 const environment={userAgent:navigator.userAgent,platform:navigator.platform,language:navigator.language,secureContext:isSecureContext,timeOrigin:performance.timeOrigin};
 if(navigator.userAgentData){environment.userAgentData=navigator.userAgentData.toJSON();navigator.userAgentData.getHighEntropyValues(['platform','platformVersion','fullVersionList','model','architecture']).then(v=>environment.detailedUserAgent=v).catch(()=>{});}
 const network=()=>({online:navigator.onLine,type:navigator.connection?.type,effectiveType:navigator.connection?.effectiveType,rtt:navigator.connection?.rtt,downlink:navigator.connection?.downlink});
 environment.network=network();navigator.connection?.addEventListener('change',()=>note('network-change',network()));window.addEventListener('online',()=>note('online'));window.addEventListener('offline',()=>note('offline'));document.addEventListener('visibilitychange',()=>note('visibility',{state:document.visibilityState}));
 const Native=window.RTCPeerConnection;
 window.RTCPeerConnection=class extends Native{
 constructor(...args){super(...args);const id=++counter;pcs.set(this,id);note('pc-created',{pc:id});
 this.addEventListener('icecandidate',e=>note('candidate-generated',{pc:id,candidate:candidateInfo(e.candidate)}));
 this.addEventListener('icecandidateerror',e=>note('candidate-gather-error',{pc:id,url:e.url,address:e.address,port:e.port,errorCode:e.errorCode,errorText:e.errorText}));
 for(const event of ['icegatheringstatechange','iceconnectionstatechange','connectionstatechange','signalingstatechange'])this.addEventListener(event,()=>note(event,{pc:id,ICE:this.iceConnectionState,connection:this.connectionState,SDP:this.signalingState,gathering:this.iceGatheringState}));
 }
 addIceCandidate(value,...rest){const pc=pcs.get(this),candidate=candidateInfo(value);note('add-candidate-attempt',{pc,candidate});return super.addIceCandidate(value,...rest).then(v=>{note('add-candidate-ok',{pc,candidate});return v;},e=>{note('add-candidate-error',{pc,candidate,error:e.name,message:e.message});throw e;});}
 setRemoteDescription(value,...rest){const pc=pcs.get(this);note('remote-description-attempt',{pc,type:value?.type,candidates:(value?.sdp||'').split('\n').filter(x=>x.startsWith('a=candidate:')).map(candidateInfo)});return super.setRemoteDescription(value,...rest).then(v=>{note('remote-description-ok',{pc});return v;},e=>{note('remote-description-error',{pc,error:e.name,message:e.message});throw e;});}
 };
 function watchPeer(peer,who){const send=peer.socket.send;peer.socket.send=function(message){recordSignal('signal-send-attempt',message,who);return send.call(this,message);};peer.socket.on('message',m=>recordSignal('signal-received',m,who));}
 function recordSignal(event,m,who){if(!['OFFER','ANSWER','CANDIDATE','LEAVE','EXPIRE'].includes(m.type))return;note(event,{type:m.type,endpoint:who(m.src||m.dst),connection:m.payload?.connectionId,candidate:m.type==='CANDIDATE'?candidateInfo(m.payload?.candidate):undefined});}
 async function snapshot(){const rows=[];for(const [pc,id] of pcs){if(pc.signalingState==='closed')continue;try{const list=[];for(const s of (await pc.getStats()).values()){
 if(['local-candidate','remote-candidate'].includes(s.type))list.push({type:s.type,id:s.id,address:s.address,port:s.port,protocol:s.protocol,candidateType:s.candidateType,url:s.url,relayProtocol:s.relayProtocol});
 if(s.type==='candidate-pair')list.push({type:s.type,id:s.id,state:s.state,nominated:s.nominated,localCandidateId:s.localCandidateId,remoteCandidateId:s.remoteCandidateId,requestsSent:s.requestsSent,responsesReceived:s.responsesReceived,requestsReceived:s.requestsReceived,responsesSent:s.responsesSent,bytesSent:s.bytesSent,bytesReceived:s.bytesReceived});
 if(s.type==='transport')list.push({type:s.type,dtlsState:s.dtlsState,selectedCandidatePairId:s.selectedCandidatePairId});
 if(['inbound-rtp','outbound-rtp'].includes(s.type))list.push({type:s.type,bytesSent:s.bytesSent,bytesReceived:s.bytesReceived,packetsSent:s.packetsSent,packetsReceived:s.packetsReceived,totalAudioEnergy:s.totalAudioEnergy});
 }rows.push({pc:id,ICE:pc.iceConnectionState,SDP:pc.signalingState,stats:list});}catch{}}
 history.push({at:new Date().toISOString(),connections:rows});if(history.length>180)history.shift();for(const [pc] of pcs)if(pc.signalingState==='closed')pcs.delete(pc);
 }
 return {watchPeer,note,pcId:pc=>pcs.get(pc),snapshot,report:()=>({environment,trace,history})};
}
