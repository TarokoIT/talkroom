import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../supabase/functions/metered-usage/handler.js';
const req=()=>new Request('https://test',{method:'POST',headers:{Authorization:'Bearer test'}});
test('usage rejects non-admin before reading secrets or contacting provider',async()=>{
 let calls=0;const h=createHandler({env:()=>'',fetchImpl:async()=>{calls++;return Response.json({},{status:403});}});
 assert.equal((await h(req())).status,403);assert.equal(calls,1);
});
test('usage only returns allowed numeric metrics, clamps remaining, hides secrets',async()=>{
 let calls=0;const h=createHandler({env:()=>'',fetchImpl:async()=>Response.json([ {ok:true},{domain:'test.metered.live',secret:'PRIVATE'}, {quotaInGB:.5,usageInGB:.6,overageInGB:0,secret:'PRIVATE'} ][calls++])});
 const r=await h(req()),text=await r.text();assert.equal(r.status,200);assert.equal(JSON.parse(text).remainingInGB,0);assert.ok(!text.includes('PRIVATE'));
});
test('provider error never leaks URL with secret',async()=>{
 let calls=0;const h=createHandler({env:()=>'',fetchImpl:async()=>{calls++;if(calls===3)throw Error('https://provider?secretKey=PRIVATE');return Response.json(calls===1?{ok:true}:{domain:'test.metered.live',secret:'PRIVATE'});}});
 const r=await h(req());assert.equal(r.status,502);assert.ok(!(await r.text()).includes('PRIVATE'));
});
