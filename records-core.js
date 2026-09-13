export function responseText(rows=[]){return rows.map(r=>r.username+' · '+new Date(r.created_at).toLocaleString('sv-SE',{timeZone:'Asia/Taipei'})).join('\n');}
export function keywordsFrom(text){return text.split(/[,，\n]/).map(s=>s.trim()).filter(Boolean);}
export function csvCell(value){
 let text=String(value??'');
 // Prevent spreadsheet formula execution, including whitespace-prefixed formula input.
 if(/^[\s\uFEFF]*[=+@-]/.test(text)||/^[\t\r]/.test(text))text="'"+text;
 return '"'+text.replaceAll('"','""')+'"';
}
export function recordsCsv(rows){
 const lines=[['時間（台灣）','房間代碼','房間名稱','姓名','內容／事件','收到（姓名／台灣時間）','完成（姓名／台灣時間）'],...rows.map(r=>[
  new Date(r.created_at).toLocaleString('sv-SE',{timeZone:'Asia/Taipei'}),r.room,r.room_title,r.username,r.content,responseText(r.received),responseText(r.completed)])];
 return '\uFEFF'+lines.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
