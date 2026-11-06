export const ACCESS_PAGES=[
 ['rooms','房間管理',[['view','進入／查看'],['edit','修改名稱、密碼（換密碼會讓全房重新登入）'],['revoke','讓全房重新登入']]],
 ['servers','伺服器設定',[['view','進入／查看燈號與用量'],['edit','匯入設定、變更額度、指派／切換伺服器'],['probe','測試 TURN 連線']]],
 ['records','記錄搜尋與匯出',[['view','進入／搜尋文字及登入登出紀錄'],['export','匯出 CSV'],['delete','清除指定房間及日期的文字與回覆紀錄']]],
 ['devices','登入裝置紀錄',[['view','進入／搜尋（包含 IP、裝置資訊）'],['export','匯出 CSV']]],
 ['permissions','管理員權限',[['view','進入／查看帳號及授權'],['manage','新增、停用帳號及變更他人的權限']]]
];
export const ALL_ACCESS=ACCESS_PAGES.flatMap(([page,,actions])=>actions.map(([action])=>page+'.'+action));
export function canAccess(grants,key){return grants.includes(key)&&grants.includes(key.split('.')[0]+'.view');}
export async function getAccess(client){const {data,error}=await client.rpc('talkroom_access',{p_action:'self'});if(error)throw error;if(!data?.ok)throw Error('無法讀取管理權限');return data;}

