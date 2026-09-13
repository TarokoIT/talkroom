import {responseText} from './records-core.js?v=2.4.0';
export function setupMessageResponses(client,getSession){
 const $=id=>document.getElementById(id),win=$('chat-win');
 let selected=null,busy=false,epoch=0,reading=false,sequence=0;
 const panel=document.createElement('aside');panel.className='response-popup';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','訊息回覆紀錄');
 const close=document.createElement('button');close.textContent='關閉';close.className='secondary';close.onclick=()=>{panel.hidden=true;};
 const title=document.createElement('h3');title.textContent='訊息回覆紀錄';
 const excerpt=document.createElement('p'),received=document.createElement('pre'),completed=document.createElement('pre'),status=document.createElement('p');
 panel.append(close,title,excerpt,received,completed,status);document.body.append(panel);
 const hint=document.createElement('p');hint.className='response-selection hint';hint.textContent='先點選一則訊息，再按「收到」或「完成」。';$('voice-status').before(hint);
 function buttons(){for(const id of ['ack-button','complete-button'])$(id).disabled=!selected||busy;}
 function draw(rows){received.textContent='收到\n'+(responseText(rows.filter(r=>r.action==='received'))||'尚無人回覆');completed.textContent='完成\n'+(responseText(rows.filter(r=>r.action==='completed'))||'尚無人回覆');}
 async function request(action){
  const session=getSession(),message=selected,token=epoch,requestId=++sequence;if(!session||!message)return;
  if(action!=='list'){busy=true;buttons();}status.textContent=action==='list'?'讀取中…':'儲存中…';
  try{
   const {data,error}=await client.rpc('talkroom_message_response',{p_session:session.session_id,p_message:message.id,p_action:action});
   if(token!==epoch||requestId!==sequence||getSession()!==session)return;
   if(error)throw error;if(!data?.ok)throw Error('回覆未能儲存');draw(data.responses);
   status.textContent=action==='list'?'':'已記錄'+(action==='received'?'收到':'完成')+'（重複點擊保留首次時間）';
  }catch(e){if(token===epoch&&requestId===sequence){status.textContent=e.message;panel.hidden=false;}}
  finally{if(token===epoch&&action!=='list'){busy=false;buttons();}}
 }
 function choose(node){
  if(busy||!getSession())return;selected={id:node.dataset.message,text:node.querySelector('p').textContent};epoch++;
  for(const item of win.querySelectorAll('.message'))item.classList.toggle('selected-message',item===node);
  excerpt.textContent=selected.text;hint.textContent='已選取：'+selected.text.slice(0,80);panel.hidden=false;draw([]);buttons();request('list');
 }
 win.addEventListener('click',e=>{const node=e.target.closest('[data-message]');if(node&&win.contains(node))choose(node);});
 win.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-message]')){e.preventDefault();choose(e.target);}});
 $('ack-button').onclick=()=>{if(!busy)request('received');};$('complete-button').onclick=()=>{if(!busy)request('completed');};
 document.addEventListener('keydown',e=>{if(e.key==='Escape')panel.hidden=true;});
 function reset(){epoch++;selected=null;busy=false;panel.hidden=true;hint.textContent='先點選一則訊息，再按「收到」或「完成」。';buttons();}
 setInterval(async()=>{if(!selected||panel.hidden||busy||reading||document.hidden)return;reading=true;try{await request('list');}finally{reading=false;}},4000);
 buttons();
 return {reset,bind(node,message){node.dataset.message=message.id;node.tabIndex=0;node.setAttribute('role','button');node.setAttribute('aria-label','查看訊息回覆：'+message.message.slice(0,60));node.classList.toggle('selected-message',selected?.id===message.id);},reconcile(messages){if(selected&&!messages.some(m=>m.id===selected.id))reset();}};
}
