export const VERSION='2.1.0';
export const ROOMS=[
 {code:'HK',title:'房務部',icon:'⌂',description:'HOUSEKEEPING'},
 {code:'FD',title:'櫃台',icon:'▣',description:'FRONT DESK'},
 {code:'SEC',title:'安全室',icon:'◇',description:'SECURITY'},
 {code:'FB',title:'餐飲部',icon:'♧',description:'FOOD & BEVERAGE'},
 {code:'BROADCAST',title:'廣播頻道',icon:'◉',description:'BROADCAST'},
 {code:'LOBBY',title:'大廳頻道',icon:'◎',description:'LOBBY'}
];
export function canTransmit(role){return role==='member'||role==='controller';}
export function safeColor(value,fallback){return /^#[0-9a-f]{6}$/i.test(value)?value:fallback;}
export function roleFor(room,choice){return room==='BROADCAST'?choice:'member';}
export function voiceTargets(peers,self){
 return peers.filter(p=>p.id!==self.session_id&&(self.room!=='BROADCAST'||p.role==='listener'));
}
export function messageNode(document,message,selfId){
 const node=document.createElement('article');
 node.className='message'+(message.session_id===selfId?' me':'');
 const label=document.createElement('small');
 const date=new Date(message.created_at);
 label.textContent=message.username+' · '+(Number.isNaN(date.getTime())?'':date.toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'}));
 const body=document.createElement('p');body.textContent=message.message;
 label.style.color=safeColor(message.name_color,'#1e90ff');
 body.style.color=safeColor(message.text_color,'#2f3542');
 body.style.fontSize=['14px','17px','22px'].includes(message.font_size)?message.font_size:'17px';
 node.append(label,body);return node;
}
