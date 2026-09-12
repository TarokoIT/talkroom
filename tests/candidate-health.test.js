import {test} from 'node:test';
import assert from 'node:assert/strict';
import {staleCallReason} from '../candidate-health.js';
test('unanswered offers are removed so roster polling can retry',()=>{
 assert.equal(staleCallReason({iceConnectionState:'checking'},0,null,19999),null);
 assert.equal(staleCallReason({iceConnectionState:'checking'},0,null,20000),'setup-timeout');
});
test('connected calls stay; later prolonged disconnection is removed',()=>{
 assert.equal(staleCallReason({iceConnectionState:'connected'},0,null,120000),null);
 assert.equal(staleCallReason({iceConnectionState:'disconnected'},0,120000,125000),null);
 assert.equal(staleCallReason({iceConnectionState:'disconnected'},0,120000,128000),'disconnected-timeout');
 assert.equal(staleCallReason({iceConnectionState:'connected'},0,null,128001),null);
});
test('failed or closed calls cannot block subsequent calls',()=>{
 assert.equal(staleCallReason({iceConnectionState:'failed'},0,null,1),'failed');
 assert.equal(staleCallReason({signalingState:'closed'},0,null,1),'closed');
});
