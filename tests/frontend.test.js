import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ROOMS,VERSION,roleFor,canTransmit,voiceTargets,messageNode} from '../core.js';
test('six required rooms and version',()=>{
 assert.deepEqual(ROOMS.map(r=>r.code),['HK','FD','SEC','FB','BROADCAST','LOBBY']);
 assert.equal(VERSION,'2.2.0');
});
test('broadcast listener cannot transmit; departments cannot pick controller role',()=>{
 assert.equal(canTransmit('listener'),false);
 assert.equal(canTransmit('controller'),true);
 assert.equal(roleFor('HK','controller'),'member');
 assert.equal(roleFor('BROADCAST','listener'),'listener');
});
test('broadcast sends only to listeners and excludes self',()=>{
 const peers=[{id:'self',role:'controller'},{id:'listener',role:'listener'},{id:'other',role:'member'}];
 assert.deepEqual(voiceTargets(peers,{session_id:'self',room:'BROADCAST'}).map(p=>p.id),['listener']);
});
test('normal rooms send to other room members returned by server',()=>{
 assert.deepEqual(voiceTargets([{id:'a'},{id:'b'}],{session_id:'a',room:'HK'}).map(p=>p.id),['b']);
});
test('message markup never enters HTML parser, identity uses session not nickname',()=>{
 const document={createElement(tag){return {tag,style:{},children:[],append(...nodes){this.children.push(...nodes);},
  set innerHTML(value){throw Error('untrusted HTML');}};}};
 const node=messageNode(document,{username:'<img onerror=alert(1)>',message:'<svg onload=alert(1)>',
  session_id:'other',created_at:'2026-09-11T00:00:00Z'},'self');
 assert.equal(node.className,'message');
 assert.equal(node.children[1].textContent,'<svg onload=alert(1)>');
 assert.ok(node.children[0].textContent.startsWith('<img'));
});
