import test from 'node:test';import assert from 'node:assert/strict';import {parseIce,parseAccount,lamp} from '../turn-settings-core.js';
test('parse provider snippet without executing JavaScript',()=>{
 const config=parseIce('var pc = new RTCPeerConnection({iceServers:[{urls:"turn:example.com:443?transport=tcp",username:"u",credential:"p",},],});');assert.equal(config[0].username,'u');
 assert.throws(()=>parseIce('[{urls:alert("bad"),username:"u",credential:"p"}]'));
 assert.throws(()=>parseIce('[{"urls":"https://example.com"}]'));
});
test('JSON array URLs and secret env format',()=>{assert.equal(parseIce(JSON.stringify([{urls:['turn:example.com:80','turns:example.com:443'],username:'u',credential:'p'}])).length,2);assert.equal(parseAccount('METERED_DOMAIN=test.metered.live\nMETERED_SECRET_KEY=secret').domain,'test.metered.live');assert.throws(()=>parseAccount('METERED_DOMAIN=evil.com\nMETERED_SECRET_KEY=secret'));});
test('lamps accurately distinguish quota boundaries and unknown usage',()=>{
 const s={configured:true,enabled:true,provider:'static',quota_mb:500,usage_mb:0,usage_at:new Date().toISOString()};
 assert.equal(lamp(s).color,'green');assert.equal(lamp({...s,usage_mb:250}).color,'yellow');assert.equal(lamp({...s,usage_mb:475}).color,'yellow');assert.equal(lamp({...s,usage_mb:476}).color,'red');assert.equal(lamp({...s,usage_mb:null}).color,'blue');assert.equal(lamp({...s,configured:false}).color,'gray');assert.equal(lamp({...s,provider:'metered',usage_at:'2020-01-01'}).color,'blue');
});
