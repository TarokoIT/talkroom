import {channelLabel} from './core.js?v=2.1.2';
import {CONFIG} from './config.js';
import {keywordsFrom,recordsCsv,responseText} from './records-core.js?v=2.4.0';
const $=id=>document.getElementById(id);
const client=window.supabase.createClient(CONFIG.url,CONFIG.key,{auth:{storage:sessionStorage,storageKey:'talkroom-admin-auth'}});
let busy=false;
function status(text){$('admin-status').textContent=text;}
async function api(action,payload={}){
 const {data,error}=await client.rpc('talkroom_admin',{p_action:action,p_payload:payload});
 if(error)throw error;if(!data?.ok)throw new Error(data?.error||'操作失敗');return data;
}
async function load(){
 const data=await api('list');$('admin-login').hidden=true;$('admin-panel').hidden=false;
 for(const id of ['search-room','delete-room']){const select=$(id),value=select.value;select.replaceChildren(new Option(id==='search-room'?'全部房間':'請選擇一個房間',''));for(const room of data.rooms)select.add(new Option(room.title+' ('+channelLabel(room.code)+')',room.code));select.value=value;}
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
$('admin-signout').addEventListener('click',async()=>{await client.auth.signOut();$('admin-panel').hidden=true;$('admin-login').hidden=false;$('search-results').replaceChildren();invalidatePreview();searchFilter=null;searchTotal=0;searchOffset=0;status('已登出。');});
let recordsBusy=false,searchFilter=null,searchOffset=0,searchTotal=0,deletePreview=null;
async function records(action,payload){
 const {data,error}=await client.rpc('talkroom_records',{p_action:action,p_payload:payload});
 if(error)throw error;if(!data?.ok)throw new Error('操作失敗');return data;
}
function filters(){return {kind:$('search-kind').value,room:$('search-room').value,from:$('search-from').value,to:$('search-to').value,
 mode:$('search-mode').value,keyword_mode:$('keyword-mode').value,keywords:keywordsFrom($('search-keywords').value)};}
function lockRecords(value){
 recordsBusy=value;for(const id of ['search-button','export-button','delete-preview'])$(id).disabled=value;
 $('search-prev').disabled=value||searchOffset===0;$('search-next').disabled=value||searchOffset+100>=searchTotal;
 $('delete-confirm').disabled=value||!deletePreview||deletePreview.count===0;
}
async function search(offset=0,newFilter=null){
 if(recordsBusy)return;lockRecords(true);$('search-status').textContent='正在搜尋…';
 try{
  const filter=newFilter||searchFilter||filters(),result=await records('search',{...filter,offset});
  searchFilter=filter;searchOffset=offset;searchTotal=result.total;$('search-results').replaceChildren();
  for(const row of result.rows){
   const tr=document.createElement('tr');for(const value of [new Date(row.created_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}),row.room_title+' ('+channelLabel(row.room)+')',row.username,row.content,responseText(row.received),responseText(row.completed)]){
    const td=document.createElement('td');td.textContent=value;tr.append(td);
   }$('search-results').append(tr);
  }
  $('search-status').textContent='共 '+result.total+' 筆'+(result.rows.length?'；顯示 '+(offset+1)+'–'+(offset+result.rows.length)+' 筆':'')+'。分頁期間若有新資料，請重新搜尋更新結果。';
 }catch(e){$('search-status').textContent=e.message;}finally{lockRecords(false);}
}
$('search-form').addEventListener('submit',e=>{e.preventDefault();search(0,filters());});
$('search-prev').addEventListener('click',()=>search(Math.max(0,searchOffset-100)));
$('search-next').addEventListener('click',()=>search(searchOffset+100));
$('export-button').addEventListener('click',async()=>{
 if(recordsBusy||!$('search-form').reportValidity())return;lockRecords(true);$('search-status').textContent='正在匯出目前搜尋條件…';
 try{
  const filter=filters(),result=await records('export',filter);
  const url=URL.createObjectURL(new Blob([recordsCsv(result.rows)],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download='TalkRoom-'+filter.kind+'-'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  $('search-status').textContent='已匯出 '+result.total+' 筆。';
 }catch(e){$('search-status').textContent=e.message;}finally{lockRecords(false);}
});
function invalidatePreview(){deletePreview=null;$('delete-confirm').disabled=true;$('delete-status').textContent='';}
$('delete-form').addEventListener('input',invalidatePreview);
$('delete-form').addEventListener('submit',async e=>{
 e.preventDefault();if(recordsBusy)return;invalidatePreview();lockRecords(true);
 const filter={room:$('delete-room').value,from:$('delete-from').value,to:$('delete-to').value};
 try{
  const result=await records('delete_preview',filter);
  // Ignore a preview if the operator edited its scope while the request was pending.
  if(filter.room!==$('delete-room').value||filter.from!==$('delete-from').value||filter.to!==$('delete-to').value)return;
  deletePreview={...result,...filter};$('delete-status').textContent=channelLabel(filter.room)+'，'+filter.from+' 至 '+filter.to+'：將永久清除 '+result.count+' 筆文字及關聯回覆紀錄。預覽有效 5 分鐘。';
 }catch(error){$('delete-status').textContent=error.message;}finally{lockRecords(false);}
});
$('delete-confirm').addEventListener('click',async()=>{
 if(recordsBusy||!deletePreview||!deletePreview.count)return;
 const preview=deletePreview;
 if(!confirm('永久清除 '+channelLabel(preview.room)+'，'+preview.from+' 至 '+preview.to+' 的 '+preview.count+' 筆文字及關聯回覆紀錄？此動作無法復原。'))return;
 lockRecords(true);
 try{
  const result=await records('delete_confirm',{token:preview.token});invalidatePreview();
  $('delete-status').textContent='已永久清除 '+result.deleted+' 筆。預覽之後新增的訊息不受影響。';
  $('search-results').replaceChildren();searchOffset=0;searchTotal=0;$('search-status').textContent='文字記錄已變更，請重新搜尋。';
 }catch(e){invalidatePreview();$('delete-status').textContent=e.message;}finally{lockRecords(false);}
});
client.auth.getSession().then(({data})=>{if(data.session)load().catch(e=>status(e.message));});
