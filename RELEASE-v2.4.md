# v2.4.0

- 正式六房及候選測試房：選取訊息後才可按收到／完成；浮窗显示姓名與台灣時間。每個登入身分、訊息、動作只保留第一次回覆，同名的不同身分仍分別記錄。
- 回覆存於 private.message_responses（實際 schema 為 talkroom_private），不新增獨立聊天訊息。登入必須有效、歸屬呼叫者、且訊息同房；姓名與時間由伺服器決定。
- records.html 獨立提供管理員搜尋、CSV 匯出及指定房間 AND 日期清除。搜尋與 CSV 增加收到／完成欄位；清除訊息會 cascade 清除其回覆，確認畫面已說明。
- A～G 燈號縮至 56px，顯示字母、已用量／上限（MB）、百分比；黑框與原有顏色規則保留。
- 管理順序：廣播、HK、FD、SEC、FB、LOBBY、VOICE_TEST。
- 語音頁面診斷預設隱藏；畫面頂端中央三秒內點五下開啟。關閉按鈕重新隱藏。此入口不是權限限制，診斷仍僅為本機資料。

部署順序：先執行 database/message-responses.sql，再部署靜態網站。舊頁面的未指定訊息收到快捷操作會提示重新整理。

驗證：26 項 Node 測試；database/test-message-responses.sql 與 test-interactions.sql 使用 rollback 測試；瀏覽器測試選取、兩種回覆、刪除後選取失效、登出忽略延遲回應、五連點入口，以及管理順序與搜尋顯示。語音連線邏輯未修改，未宣稱本次已用實體手機重新驗證聲音。

安全檢查：新表 RLS 開啟、anon/authenticated 無直接表權限，public RPC 為 invoker，private 函式驗證身分。Advisors 的 private 無 policy 提示是預期的拒絕直接存取；既有 legacy public 表與密碼保護提示不屬於本次新增。
