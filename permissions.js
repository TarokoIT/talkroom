import {CONFIG} from './config.js';
import {ACCESS_PAGES,ALL_ACCESS,canAccess,getAccess} from './access-core.js?v=2.5.0';
const $=id=>document.getElementById(id),el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const client=window.supabase.createClient(CONFIG.url,CONFIG.key,{auth:{storage:sessionStorage,storageKey:'talkroom-admin-auth'}});
let mine=[],saving=false;
const status=t=>$('access-status').textContent=t;
async function api(action,payload={}){const {data,error}=await client.rpc('talkroom_access',{p_action:action,p_payload:payload});if(error)throw error;return data;}
async function load(){
 const self=await getAccess(client);mine=self.permissions;if(!canAccess(mine,'permissions.view'))throw Error('此帳號沒有管理員權限頁的存取權限，請返回後台。');
 const data=await api('list');$('access-login').hidden=true;$('access-panel').hidden=false;$('new-access').hidden=!canAccess(mine,'permissions.manage');$('permission-list').replaceChildren();
 for(const account of data.admins){
  const form=el('form');form.className='entry-panel';form.append(el('h2',account.email),el('p',account.protected?'主要管理員 · 完整權限受保護':!account.registered?'尚未註冊':account.verified?'信箱已驗證':'尚未驗證信箱'));
  const enabled=el('input');enabled.type='checkbox';enabled.checked=account.enabled;const label=el('label','啟用後台帳號 ');label.append(enabled);form.append(label);
  const boxes=new Map();
  for(const [page,title,actions] of ACCESS_PAGES){const group=el('fieldset');group.append(el('legend',title));for(const [action,title] of actions){const key=page+'.'+action,input=el('input');input.type='checkbox';input.checked=account.permissions.includes(key);boxes.set(key,input);const l=el('label',title+' ');l.append(input);group.append(l);input.onchange=()=>{if(action==='view'&&!input.checked){for(const [k,b] of boxes)if(k.startsWith(page+'.'))b.checked=false;}else if(input.checked)boxes.get(page+'.view').checked=true;};}form.append(group);}
  const presets=el('div');presets.className='record-actions';for(const [title,keys] of [['紀錄查詢員',['records.view','records.export']],['系統管理員（全部）',ALL_ACCESS]]){const b=el('button',title);b.type='button';b.className='secondary';b.onclick=()=>{for(const [k,input] of boxes)input.checked=keys.includes(k);};presets.append(b);}form.append(presets);
  const save=el('button','儲存權限');save.className='primary';form.append(save);
  const editable=canAccess(mine,'permissions.manage')&&!account.protected;for(const input of form.querySelectorAll('input,button'))input.disabled=!editable;
  form.onsubmit=async e=>{e.preventDefault();if(saving||!editable)return;const keys=[...boxes].filter(([,b])=>b.checked).map(([key])=>key);if(!confirm('儲存 '+account.email+' 的後台權限？設定會立即影響後續操作。'))return;
   saving=true;save.disabled=true;try{await api('save',{email:account.email,enabled:enabled.checked,permissions:keys,revision:account.revision});await load();status('已儲存 '+account.email+' 的權限。');}catch(e){status(e.message);}finally{saving=false;save.disabled=false;}};
  $('permission-list').append(form);
 }
}
$('access-login-form').onsubmit=async e=>{e.preventDefault();try{const {error}=await client.auth.signInWithPassword({email:$('access-email').value.trim(),password:$('access-password').value});if(error)throw error;$('access-password').value='';await load();status('已登入。');}catch(e){status(e.message);}};
$('new-access-form').onsubmit=async e=>{e.preventDefault();if(saving)return;saving=true;try{await api('save',{email:$('new-access-email').value,enabled:true,permissions:['records.view','records.export']});$('new-access-form').reset();await load();status('已新增授權；對方仍須完成註冊與信箱驗證。');}catch(e){status(e.message);}finally{saving=false;}};
$('access-refresh').onclick=()=>load().catch(e=>status(e.message));
$('access-signout').onclick=async()=>{await client.auth.signOut();mine=[];$('permission-list').replaceChildren();$('access-panel').hidden=true;$('access-login').hidden=false;status('已登出。');};
client.auth.getSession().then(({data})=>{if(data.session)load().catch(e=>status(e.message));});

