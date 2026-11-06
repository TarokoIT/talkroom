import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {ACCESS_PAGES,ALL_ACCESS,canAccess,getAccess} from '../access-core.js';
test('actions require the page grant and transport errors do not grant access',async()=>{
 assert.equal(canAccess(['records.export'],'records.export'),false);
 assert.equal(canAccess(['records.view','records.export'],'records.export'),true);
 assert.equal(canAccess(['records.view'],'records.delete'),false);
 await assert.rejects(()=>getAccess({rpc:async()=>({error:Error('denied')})}),/denied/);
});
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.hidden=true;this.value='';this.disabled=false;this.dataset={};this.events={};}
 append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}addEventListener(event,handler){this.events[event]=handler;}add(item){this.append(item);}
 querySelectorAll(selector){return this.children.filter(x=>typeof x==='object').flatMap(x=>[...(selector.split(',').includes(x.tag)?[x]:[]),...x.querySelectorAll(selector)]);}
 reset(){}reportValidity(){return true;}
}
function dom(){const nodes=new Map();return {nodes,document:{getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},createElement:tag=>new Element(tag),querySelectorAll:()=>[]}};}
const flush=()=>new Promise(resolve=>setTimeout(resolve,10));
test('permission editor protects owner and keeps page/action choices consistent',async()=>{
 const {nodes,document}=dom(),calls=[];
 const client={auth:{getSession:async()=>({data:{session:{}}})},rpc:async(name,args)=>{
  calls.push(args);return {data:args.p_action==='self'?{ok:true,permissions:ALL_ACCESS}:args.p_action==='list'?{admins:[{email:'owner',protected:true,permissions:ALL_ACCESS,enabled:true},{email:'reader',protected:false,permissions:['records.view'],enabled:true,revision:1}]}:{ok:true}};
 }};
 const code=(await readFile(new URL('../permissions.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
 vm.runInNewContext(code,{document,window:{supabase:{createClient:()=>client}},CONFIG:{},sessionStorage:{},ACCESS_PAGES,ALL_ACCESS,canAccess,getAccess,confirm:()=>true});await flush();
 const forms=nodes.get('permission-list').children;
 assert.ok(forms[0].querySelectorAll('input,button').every(x=>x.disabled));
 const recordGroup=forms[1].children.find(x=>x.tag==='fieldset'&&x.children[0].textContent==='記錄搜尋與匯出');
 const boxes=recordGroup.querySelectorAll('input');boxes[1].checked=true;boxes[1].onchange();assert.equal(boxes[0].checked,true);
 boxes[0].checked=false;boxes[0].onchange();assert.ok(boxes.every(x=>!x.checked));
 boxes[0].checked=true;await forms[1].onsubmit({preventDefault(){}});
 assert.deepEqual(Array.from(calls.find(x=>x.p_action==='save').p_payload.permissions),['records.view']);
});
test('records-only account does not fetch servers or render room controls on admin landing',async()=>{
 const {nodes,document}=dom();let serverReads=0;
 const client={auth:{onAuthStateChange(){},getSession:async()=>({data:{session:{}}})},rpc:async()=>({data:{ok:true,permissions:['records.view'],rooms:[{code:'HK',title:'房務部'}]}})};
 const code=(await readFile(new URL('../admin.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
 vm.runInNewContext(code,{document,window:{supabase:{createClient:()=>client}},CONFIG:{},sessionStorage:{},getAccess,canAccess,URLSearchParams,location:{hash:''},setupServerSettings:()=>({refresh(){serverReads++;}}),Option:function(t,v){this.text=t;this.value=v;}});await flush();
 assert.equal(serverReads,0);assert.equal(nodes.get('admin-rooms').children.length,0);assert.equal(nodes.get('management-view').hidden,true);
 assert.equal(nodes.get('turn-overview').hidden,true);assert.equal(nodes.get('records-link').hidden,false);assert.equal(nodes.get('permissions-link').hidden,true);
});

