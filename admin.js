import {getAccess,canAccess} from './access-core.js?v=2.5.0';
import {setupServerSettings} from './server-settings.js?v=2.5.0';
import {channelLabel} from './core.js?v=2.1.2';
import {CONFIG} from './config.js';
const $=id=>document.getElementById(id);
let recovering=new URLSearchParams(location.hash.slice(1)).get('type')==='recovery';
const client=window.supabase.createClient(CONFIG.url,CONFIG.key,{auth:{storage:sessionStorage,storageKey:'talkroom-admin-auth'}});
const serverSettings=setupServerSettings(client,()=>grants);
let grants=[];
let busy=false;
function status(text){$('admin-status').textContent=text;}
async function api(action,payload={}){
 const {data,error}=await client.rpc('talkroom_admin',{p_action:action,p_payload:payload});
 if(error)throw error;if(!data?.ok)throw new Error(data?.error||'操作失敗');return data;
}
function field(label,type,value=''){
 const wrapper=document.createElement('label');wrapper.textContent=label;
 const input=document.createElement('input');input.type=type;input.value=value;
 if(type==='password'){input.autocomplete='new-password';input.minLength=12;input.maxLength=64;}
 else {input.maxLength=32;input.required=true;}
 wrapper.append(input);return {wrapper,input};
}
async function load(){
 if(recovering){showRecovery();return;}
 const data=await getAccess(client);grants=data.permissions;$('admin-login').hidden=true;$('admin-panel').hidden=false;$('admin-rooms').replaceChildren();
 for(const b of document.querySelectorAll('[data-admin-view]'))b.hidden=!canAccess(grants,({management:'rooms',servers:'servers',devices:'devices'})[b.dataset.adminView]+'.view');
 $('records-link').hidden=!canAccess(grants,'records.view');$('permissions-link').hidden=!canAccess(grants,'permissions.view');$('turn-overview').hidden=!canAccess(grants,'servers.view');
 for(const key of ['management','servers','devices'])$(key+'-view').hidden=true;
 const first=['management','servers','devices'].find(v=>canAccess(grants,({management:'rooms',servers:'servers',devices:'devices'})[v]+'.view'));if(first)$(first+'-view').hidden=false;
 if(!first)status('請選擇記錄搜尋或管理員權限頁面。');
 const devices=$('device-room');devices.replaceChildren(new Option('全部房間',''));for(const room of data.rooms)devices.add(new Option(room.title,room.code));
 $('device-export').hidden=!canAccess(grants,'devices.export');
 if(canAccess(grants,'servers.view'))serverSettings.refresh();
 const order=['BROADCAST','HK','FD','SEC','FB','LOBBY','VOICE_TEST'];data.rooms.sort((a,b)=>order.indexOf(a.code)-order.indexOf(b.code));
 for(const room of (canAccess(grants,'rooms.view')?data.rooms:[])){
  const form=document.createElement('form');form.className='entry-panel';
  const title=document.createElement('h2');title.textContent=channelLabel(room.code);
  const count=document.createElement('p');count.className='hint';count.textContent='目前 '+room.online+' 台裝置在線';
  const name=field('房間名稱','text',room.title),password=field(room.code==='BROADCAST'?'新的收聽密碼（空白表示不變）':'新房間密碼（空白表示不變）','password');
  form.append(title,count,name.wrapper,password.wrapper);
  let controller=null;
  if(room.code==='BROADCAST'){controller=field('新的控制台密碼（空白表示不變）','password');form.append(controller.wrapper);}
  const save=document.createElement('button');save.className='primary';save.textContent='儲存變更';save.type='submit';
  const revoke=document.createElement('button');revoke.className='secondary';revoke.textContent='讓全房重新登入';revoke.type='button';
  const buttons=document.createElement('p');buttons.append(save,document.createTextNode(' '),revoke);form.append(buttons);
  form.addEventListener('submit',async e=>{
   e.preventDefault();if(busy)return;
   const rotating=!!password.input.value||!!controller?.input.value;
   if(rotating&&!confirm('更改密碼會讓此房所有裝置重新登入。確定儲存？'))return;
   busy=true;save.disabled=true;revoke.disabled=true;
   try{
    const result=await api('update',{room:room.code,title:name.input.value,password:password.input.value,controller_password:controller?.input.value||''});
    password.input.value='';if(controller)controller.input.value='';
    status('已儲存 '+name.input.value+'，撤銷 '+result.revoked+' 個登入。');await load();
   }catch(error){status(error.message);}finally{busy=false;save.disabled=false;revoke.disabled=false;}
  });
  revoke.addEventListener('click',async()=>{
   if(busy||!confirm('讓此房所有裝置退出？若密碼未更改，知道密碼的人仍可重新加入。'))return;
   busy=true;save.disabled=true;revoke.disabled=true;
   try{const result=await api('revoke',{room:room.code});status('已撤銷 '+result.revoked+' 個登入。');await load();}
   catch(error){status(error.message);}finally{busy=false;save.disabled=false;revoke.disabled=false;}
  });
  name.input.disabled=!canAccess(grants,'rooms.edit');password.input.disabled=!canAccess(grants,'rooms.edit');if(controller)controller.input.disabled=!canAccess(grants,'rooms.edit');save.hidden=!canAccess(grants,'rooms.edit');revoke.hidden=!canAccess(grants,'rooms.revoke');
  $('admin-rooms').append(form);
 }
}
$('admin-login-form').addEventListener('submit',async e=>{
 e.preventDefault();$('admin-signin').disabled=true;status('正在登入…');
 try{
  const {error}=await client.auth.signInWithPassword({email:$('admin-email').value.trim(),password:$('admin-password').value});
  if(error)throw error;$('admin-password').value='';await load();status('管理員已登入。');
 }catch(error){status(error.message);}finally{$('admin-signin').disabled=false;}
});
$('admin-register').addEventListener('click',async()=>{
 if(!$('admin-login-form').reportValidity())return;
 $('admin-register').disabled=true;
 try{
  const {error}=await client.auth.signUp({email:$('admin-email').value.trim(),password:$('admin-password').value,
   options:{emailRedirectTo:'https://tarokoit.github.io/talkroom/admin.html'}});
  if(error)throw error;$('admin-password').value='';status('請至信箱完成驗證，再回來登入；仍需管理員授權。');
 }catch(error){status(error.message);}finally{$('admin-register').disabled=false;}
});
$('admin-refresh').addEventListener('click',()=>load().catch(e=>status(e.message)));
$('admin-signout').addEventListener('click',async()=>{await client.auth.signOut();$('admin-panel').hidden=true;$('admin-login').hidden=false;$('admin-rooms').replaceChildren();status('已登出。');});
function showRecovery(){
 recovering=true;$('admin-login').hidden=true;$('admin-panel').hidden=true;$('password-recovery').hidden=false;status('請設定新密碼。');
}
client.auth.onAuthStateChange(event=>{if(event==='PASSWORD_RECOVERY')showRecovery();});
$('admin-forgot').addEventListener('click',async()=>{
 const email=$('admin-email');if(!email.reportValidity())return;$('admin-forgot').disabled=true;
 try{const {error}=await client.auth.resetPasswordForEmail(email.value.trim(),{redirectTo:'https://tarokoit.github.io/talkroom/admin.html'});if(error)throw error;status('已提出寄送要求；若帳號存在，請至信箱開啟重設密碼信件。');}
 catch(e){status(e.message);}finally{$('admin-forgot').disabled=false;}
});
$('recovery-form').addEventListener('submit',async e=>{
 e.preventDefault();if(!recovering)return;
 if($('new-password').value!==$('confirm-password').value){status('兩次密碼不一致，請重新輸入。');return;}
 $('save-password').disabled=true;
 try{
  const {data,error:sessionError}=await client.auth.getSession();if(sessionError)throw sessionError;
  if(!data.session)throw Error('重設連結已失效，請返回後台重新寄送重設信。');
  const {error}=await client.auth.updateUser({password:$('new-password').value});if(error)throw error;
  $('recovery-form').reset();await client.auth.signOut();recovering=false;
  $('password-recovery').hidden=true;$('admin-login').hidden=false;history.replaceState(null,'',location.pathname);status('密碼已更新，請使用新密碼登入。');
 }catch(e){status(e.message);}finally{$('save-password').disabled=false;}
});
client.auth.getSession().then(({data,error})=>{
 if(error){status('重設連結無效或已過期，請重新寄送重設信。');return;}
 if(recovering){showRecovery();return;}if(data.session)load().catch(e=>status(e.message));
});

