const panel=document.querySelector('.voice-diagnostics');
if(panel){
 panel.hidden=true;
 const trigger=document.createElement('button');trigger.className='diagnostic-trigger';trigger.type='button';trigger.setAttribute('aria-label','語音診斷：三秒內連點五下');trigger.title='連點五下開啟語音診斷';
 let taps=0,last=0;
 trigger.onclick=()=>{const now=Date.now();if(now-last>3000||taps===0){taps=0;last=now;}taps++;if(taps===5){taps=0;panel.hidden=!panel.hidden;panel.open=!panel.hidden;}};
 const close=document.createElement('button');close.textContent='關閉診斷';close.onclick=()=>{panel.hidden=true;panel.open=false;};panel.append(close);document.body.append(trigger);
}
