export function staleCallReason(pc,createdAt,disconnectedAt,now){
 if(!pc)return now-createdAt>=20000?'setup-timeout':null;
 if(pc.connectionState==='closed'||pc.signalingState==='closed')return 'closed';
 if(pc.iceConnectionState==='failed'||pc.connectionState==='failed')return 'failed';
 if(pc.iceConnectionState==='disconnected')return disconnectedAt!==null&&now-disconnectedAt>=8000?'disconnected-timeout':null;
 if(!['connected','completed'].includes(pc.iceConnectionState)&&now-createdAt>=20000)return 'setup-timeout';
 return null;
}
