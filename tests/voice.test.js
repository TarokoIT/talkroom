import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isVoiceConnected,voiceFailure,shouldPruneIncoming} from '../voice-core.js';
test('older heartbeat must not close a newly authorized incoming call',()=>{
 assert.equal(shouldPruneIncoming([{id:'a',mic:false}],'a',200,100),false);
 assert.equal(shouldPruneIncoming([{id:'a',mic:false}],'a',200,300),true);
 assert.equal(shouldPruneIncoming([{id:'a',mic:true}],'a',200,300),false);
 assert.equal(shouldPruneIncoming([],'a',200,300),true);
});
test('SDP or track presence is not evidence that audio transport connected',()=>{
 const pc={iceConnectionState:'checking',remoteDescription:{type:'answer'}};
 assert.equal(isVoiceConnected(pc),false);
 assert.match(voiceFailure(pc),/ICE/);
 assert.match(voiceFailure({iceConnectionState:'new'}),/尚未完成語音接聽/);
 assert.equal(isVoiceConnected({iceConnectionState:'connected'}),true);
 assert.equal(isVoiceConnected({iceConnectionState:'completed'}),true);
});
