export function isVoiceConnected(pc){return !!pc&&['connected','completed'].includes(pc.iceConnectionState);}
export function voiceFailure(pc){
 if(!pc?.remoteDescription)return '對方尚未完成語音接聽，請確認對方頁面保持開啟並更新至相同版本。';
 return '語音通道尚未接通（ICE：'+pc.iceConnectionState+'），正在重新連線。';
}
export function shouldPruneIncoming(peers,id,acceptedAt,snapshotStartedAt,duplex=false){
 // An authorized offer can arrive while an older presence request is in flight.
 return snapshotStartedAt>=acceptedAt&&!peers.some(p=>p.id===id&&(duplex||p.mic));
}
export function preferOutgoing(selfId,otherId){return selfId<otherId;}
export function authorizedVoicePeer(peers,state,peerId,snapshotAge){
 // Only use a recent server-authorized room roster, never caller metadata.
 if(!state||snapshotAge<0||snapshotAge>10000)return null;
 const sender=peers.find(p=>p.peer_id===peerId&&p.id!==state.session_id);
 if(!sender)return null;
 if(state.room==='BROADCAST')return state.role==='listener'&&sender.role==='controller'?sender:null;
 return state.role==='member'&&sender.role==='member'?sender:null;
}
