export function parseIce(text){
 if(text.length>20000)throw Error('設定檔太大');
 let data;
 try{data=JSON.parse(text);data=data.iceServers||data;}catch{
  const begin=text.indexOf('[');if(begin<0)throw Error('找不到 iceServers');
  let i=begin;
  const ws=()=>{while(/\s/.test(text[i]||'')&&i<text.length)i++;};
  const value=()=>{
   ws();const c=text[i++];
   if(c==='"'){const start=i-1;while(i<text.length){if(text[i++]==='\\'){i++;continue;}if(text[i-1]==='"')return JSON.parse(text.slice(start,i));}throw Error('字串未結束');}
   if(c==='['||c==='{'){const arr=c==='[',end=arr?']':'}',out=arr?[]:{};ws();while(text[i]!==end){if(i>=text.length)throw Error('設定未結束');if(arr)out.push(value());else{ws();let key;if(text[i]==='"')key=value();else{const m=/^[A-Za-z_][A-Za-z_0-9]*/.exec(text.slice(i));if(!m)throw Error('設定格式錯誤');key=m[0];i+=key.length;}ws();if(text[i++]!==':')throw Error('缺少冒號');if(!['urls','username','credential'].includes(key))throw Error('不支援的 ICE 欄位');out[key]=value();}ws();if(text[i]===','){i++;ws();}else if(text[i]!==end)throw Error('設定格式錯誤');}i++;return out;}
   throw Error('只接受 ICE 設定資料，不執行程式');
  };data=value();
 }
 if(!Array.isArray(data))throw Error('必須是 ICE 陣列');
 const result=data.flatMap(s=>(Array.isArray(s.urls)?s.urls:[s.urls]).map(url=>({urls:url,...(s.username?{username:s.username,credential:s.credential}:{})})));
 if(result.length<1||result.length>12||!result.some(s=>/^turns?:/.test(s.urls)))throw Error('必須包含 TURN，最多 12 組');
 for(const s of result){if(typeof s.urls!=='string'||!/^(stun|stuns|turn|turns):[A-Za-z0-9.\[\]:_-]+(\?transport=(udp|tcp))?$/.test(s.urls))throw Error('TURN 位址格式錯誤');if(/^turns?:/.test(s.urls)&&(!s.username||!s.credential))throw Error('缺少 TURN 帳號密碼');}
 return result;
}
export function parseAccount(text){
 const domain=text.match(/^METERED_DOMAIN\s*=\s*(\S+)\s*$/m)?.[1],secret=text.match(/^METERED_SECRET_KEY\s*=\s*(\S+)\s*$/m)?.[1];
 if(!domain||!/^[a-z0-9-]+\.metered\.live$/.test(domain)||!secret)throw Error('帳號檔需要 METERED_DOMAIN 與 METERED_SECRET_KEY');
 return {domain,secret};
}
export function lamp(server,now=Date.now()){
 if(!server.configured)return {color:'gray',text:'未設定'};
 if(!server.enabled)return {color:'gray',text:'已停用'};
 const caps=[server.quota_mb,server.provider_quota_mb].filter(v=>v!==null&&v!==undefined).map(Number),cap=caps.length?Math.min(...caps):null;
 if(server.error||server.usage_mb==null||!server.usage_at||(server.provider==='metered'&&now-Date.parse(server.usage_at)>180000))return {color:'blue',text:'用量未知／待更新'};
 if(cap===null)return {color:'blue',text:'未設額度'};
 const ratio=cap===0?1:Number(server.usage_mb)/cap;
 return {color:ratio>.95?'red':ratio<.5?'green':'yellow',text:(ratio*100).toFixed(1)+'%'};
}
