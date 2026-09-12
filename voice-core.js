export function isVoiceConnected(pc){return !!pc&&['connected','completed'].includes(pc.iceConnectionState);}
export function voiceFailure(pc){
 if(!pc?.remoteDescription)return '對方尚未完成語音接聽，請確認對方頁面保持開啟並更新至相同版本。';
 return '雙方已完成語音協商，但網路通道未接通（ICE：'+pc.iceConnectionState+'）。請嘗試同一個 Wi-Fi；跨網路可能需要 TURN 中繼。';
}
export function shouldPruneIncoming(peers,id,acceptedAt,snapshotStartedAt){
 // An authorized offer can arrive while an older presence request is in flight.
 return snapshotStartedAt>=acceptedAt&&!peers.some(p=>p.id===id&&p.mic);
}
