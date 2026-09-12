import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isVoiceConnected,voiceFailure,shouldPruneIncoming,preferOutgoing} from '../voice-core.js';
import {channelLabel} from '../core.js';
test('duplex calls survive microphone mute but end when peer leaves',()=>{
 assert.equal(shouldPruneIncoming([{id:'a',mic:false}],'a',100,200,true),false);
 assert.equal(shouldPruneIncoming([],'a',100,200,true),true);
 assert.equal(shouldPruneIncoming([{id:'a',mic:false}],'a',100,200,false),true);
 assert.equal(preferOutgoing('a','b'),true);assert.equal(preferOutgoing('b','a'),false);
});
test('channel labels preserve the five stable room identities',()=>{
 assert.deepEqual(['HK','FD','SEC','FB','LOBBY'].map(channelLabel),['一號頻道','二號頻道','三號頻道','四號頻道','五號頻道']);
 assert.equal(channelLabel('BROADCAST'),'廣播頻道');
});
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
