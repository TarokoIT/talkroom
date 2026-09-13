export async function deviceInfo(version){
 const connection=navigator.connection;
 const info={client_type:'web',app_version:version,user_agent:navigator.userAgent,platform:navigator.platform,language:navigator.language,languages:navigator.languages,
 timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,screen:{width:screen.width,height:screen.height,pixel_ratio:devicePixelRatio},
 touch_points:navigator.maxTouchPoints,display_mode:matchMedia('(display-mode: standalone)').matches?'standalone':'browser',
 connection:connection?{reported_type:connection.type||'unknown',effective_quality:connection.effectiveType||'unknown',rtt:connection.rtt,downlink:connection.downlink,save_data:connection.saveData}:null};
 if(navigator.userAgentData){info.ua_data={brands:navigator.userAgentData.brands,mobile:navigator.userAgentData.mobile,platform:navigator.userAgentData.platform};
 try{info.ua_details=await Promise.race([navigator.userAgentData.getHighEntropyValues(['platformVersion','model','fullVersionList']),new Promise(resolve=>setTimeout(()=>resolve(null),1000))]);}catch{}}
 return info;
}
