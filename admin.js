import {setupServerSettings} from './server-settings.js?v=2.4.0';
import {channelLabel} from './core.js?v=2.1.2';
import {CONFIG} from './config.js';
const $=id=>document.getElementById(id);
const client=window.supabase.createClient(CONFIG.url,CONFIG.key,{auth:{storage:sessionStorage,storageKey:'talkroom-admin-auth'}});
const serverSettings=setupServerSettings(client);
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
 const data=await api('list');$('admin-login').hidden=true;$('admin-panel').hidden=false;$('admin-rooms').replaceChildren();
 serverSettings.refresh();
 const order=['BROADCAST','HK','FD','SEC','FB','LOBBY','VOICE_TEST'];data.rooms.sort((a,b)=>order.indexOf(a.code)-order.indexOf(b.code));
 for(const room of data.rooms){
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
client.auth.getSession().then(({data})=>{if(data.session)load().catch(e=>status(e.message));});
