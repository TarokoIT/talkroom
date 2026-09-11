-- TalkRoom v2: private storage, authenticated RPC and room-scoped voice tickets.
-- Room credentials are provisioned separately and never committed.
BEGIN;
CREATE SCHEMA talkroom_private;
REVOKE ALL ON SCHEMA talkroom_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA talkroom_private TO authenticated;
CREATE TABLE talkroom_private.rooms (
 code text PRIMARY KEY, title text NOT NULL, password_hash text NOT NULL,
 controller_hash text, capacity int NOT NULL DEFAULT 15
);
CREATE TABLE talkroom_private.sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
 room text NOT NULL REFERENCES talkroom_private.rooms(code),
 username text NOT NULL CHECK(char_length(username) BETWEEN 1 AND 32),
 peer_id text NOT NULL UNIQUE, role text NOT NULL CHECK(role IN ('member','listener','controller')),
 mic boolean NOT NULL DEFAULT false, speaker boolean NOT NULL DEFAULT true,
 last_seen timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '16 hours', last_message_at timestamptz
);
CREATE INDEX sessions_room_seen ON talkroom_private.sessions(room,last_seen);
CREATE INDEX sessions_user ON talkroom_private.sessions(user_id);
CREATE TABLE talkroom_private.messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room text NOT NULL REFERENCES talkroom_private.rooms(code),
 session_id uuid NOT NULL, username text NOT NULL,
 message text NOT NULL CHECK(char_length(message) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 name_color text NOT NULL DEFAULT '#1e90ff',text_color text NOT NULL DEFAULT '#2f3542',font_size text NOT NULL DEFAULT '17px'
);
CREATE INDEX messages_room_time ON talkroom_private.messages(room,created_at DESC,id);
CREATE TABLE talkroom_private.join_attempts (
 user_id uuid PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(), attempts int NOT NULL DEFAULT 0
);
CREATE TABLE talkroom_private.call_tickets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sender uuid NOT NULL REFERENCES talkroom_private.sessions(id) ON DELETE CASCADE,
 recipient uuid NOT NULL REFERENCES talkroom_private.sessions(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 seconds', UNIQUE(sender,recipient)
);
ALTER TABLE talkroom_private.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE talkroom_private.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE talkroom_private.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE talkroom_private.join_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE talkroom_private.call_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA talkroom_private FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION talkroom_private.api(p_action text,p_session uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
 uid uuid:=auth.uid();
 me talkroom_private.sessions%ROWTYPE;
 dest talkroom_private.sessions%ROWTYPE;
 rm talkroom_private.rooms%ROWTYPE;
 attempt talkroom_private.join_attempts%ROWTYPE;
 ticket talkroom_private.call_tickets%ROWTYPE;
 requested_role text; name_value text; peer_value text; expected_hash text;
 active_count int; result_id uuid; peers jsonb; msgs jsonb;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION '請先登入' USING ERRCODE='42501'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>12000
 THEN RAISE EXCEPTION '請求格式錯誤'; END IF;
 IF p_action='join' THEN
  name_value:=btrim(p_payload->>'username'); peer_value:=p_payload->>'peer_id';
  requested_role:=p_payload->>'role';
  IF name_value IS NULL OR char_length(name_value) NOT BETWEEN 1 AND 32
   OR peer_value IS NULL OR peer_value !~ '^[a-zA-Z0-9_-]{8,100}$'
   OR char_length(coalesce(p_payload->>'password','')) NOT BETWEEN 8 AND 128
  THEN RETURN jsonb_build_object('ok',false,'error','請檢查暱稱、密碼與連線狀態'); END IF;
  INSERT INTO talkroom_private.join_attempts(user_id) VALUES(uid) ON CONFLICT DO NOTHING;
  SELECT * INTO attempt FROM talkroom_private.join_attempts WHERE user_id=uid FOR UPDATE;
  IF attempt.started_at<now()-interval '1 minute' THEN
   UPDATE talkroom_private.join_attempts SET started_at=now(),attempts=0 WHERE user_id=uid;
   attempt.attempts:=0;
  END IF;
  IF attempt.attempts>=10 THEN RETURN jsonb_build_object('ok',false,'error','嘗試次數過多，請一分鐘後再試'); END IF;
  UPDATE talkroom_private.join_attempts SET attempts=attempts+1 WHERE user_id=uid;
  SELECT * INTO rm FROM talkroom_private.rooms WHERE code=p_payload->>'room';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','房間或密碼錯誤'); END IF;
  IF requested_role IS NULL OR (rm.code='BROADCAST' AND requested_role NOT IN ('listener','controller'))
   OR (rm.code<>'BROADCAST' AND requested_role<>'member')
  THEN RETURN jsonb_build_object('ok',false,'error','房間角色不正確'); END IF;
  expected_hash:=CASE WHEN requested_role='controller' THEN rm.controller_hash ELSE rm.password_hash END;
  IF expected_hash IS NULL OR extensions.crypt(p_payload->>'password',expected_hash)<>expected_hash
  THEN RETURN jsonb_build_object('ok',false,'error','房間或密碼錯誤'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('talkroom:'||rm.code));
  SELECT count(*) INTO active_count FROM talkroom_private.sessions
   WHERE room=rm.code AND last_seen>now()-interval '60 seconds' AND expires_at>now()
   AND (rm.code<>'BROADCAST' OR role=requested_role);
  IF active_count>=(CASE WHEN requested_role='controller' THEN 1 ELSE rm.capacity END) THEN
   RETURN jsonb_build_object('ok',false,'error',CASE WHEN requested_role='controller'
    THEN '已有廣播控制台在線' ELSE '房間已滿，請稍後再試' END);
  END IF;
  DELETE FROM talkroom_private.sessions WHERE expires_at<now();
  DELETE FROM talkroom_private.join_attempts WHERE started_at<now()-interval '1 day';
  INSERT INTO talkroom_private.sessions(user_id,room,username,peer_id,role)
   VALUES(uid,rm.code,name_value,peer_value,requested_role) RETURNING id INTO result_id;
  RETURN jsonb_build_object('ok',true,'session_id',result_id,'room',rm.code,'title',rm.title,
   'role',requested_role,'capacity',rm.capacity);
 END IF;
 SELECT * INTO me FROM talkroom_private.sessions WHERE id=p_session AND user_id=uid AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '登入已失效，請重新進入房間' USING ERRCODE='42501'; END IF;
 IF p_action='leave' THEN
  DELETE FROM talkroom_private.sessions WHERE id=me.id;
  RETURN jsonb_build_object('ok',true);
 END IF;
 IF p_action='sync' THEN
  IF me.last_seen<=now()-interval '60 seconds' THEN
   PERFORM pg_advisory_xact_lock(hashtext('talkroom:'||me.room));
   SELECT count(*) INTO active_count FROM talkroom_private.sessions WHERE room=me.room AND id<>me.id
    AND last_seen>now()-interval '60 seconds' AND expires_at>now() AND (me.room<>'BROADCAST' OR role=me.role);
   SELECT * INTO rm FROM talkroom_private.rooms WHERE code=me.room;
   IF active_count>=(CASE WHEN me.role='controller' THEN 1 ELSE rm.capacity END)
   THEN RETURN jsonb_build_object('ok',false,'error','房間已滿，請重新登入'); END IF;
  END IF;
  UPDATE talkroom_private.sessions SET last_seen=now(),
   mic=CASE WHEN me.role='listener' THEN false ELSE coalesce((p_payload->>'mic')::boolean,false) END,
   speaker=coalesce((p_payload->>'speaker')::boolean,true) WHERE id=me.id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'username',s.username,'peer_id',s.peer_id,
   'role',s.role,'mic',s.mic,'speaker',s.speaker) ORDER BY s.username,s.id),'[]'::jsonb) INTO peers
   FROM talkroom_private.sessions s WHERE room=me.room AND last_seen>now()-interval '60 seconds' AND expires_at>now();
  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.created_at,m.id),'[]'::jsonb) INTO msgs FROM
   (SELECT id,session_id,username,message,created_at,name_color,text_color,font_size FROM talkroom_private.messages
    WHERE room=me.room ORDER BY created_at DESC,id DESC LIMIT 100) m;
  RETURN jsonb_build_object('ok',true,'peers',peers,'messages',msgs);
 END IF;
 IF me.last_seen<=now()-interval '60 seconds' THEN RAISE EXCEPTION '連線已逾時，請重新連線' USING ERRCODE='42501'; END IF;
 IF p_action='message' THEN
  IF me.role='listener' THEN RAISE EXCEPTION '收聽工作站不能發送訊息' USING ERRCODE='42501'; END IF;
  IF char_length(btrim(coalesce(p_payload->>'message',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION '訊息須為 1 至 2000 字'; END IF;
  IF me.last_message_at>clock_timestamp()-interval '1 second' THEN RETURN jsonb_build_object('ok',false,'error','訊息傳送太快，請稍候'); END IF;
  INSERT INTO talkroom_private.messages(room,session_id,username,message,name_color,text_color,font_size)
   VALUES(me.room,me.id,me.username,btrim(p_payload->>'message'),
    CASE WHEN p_payload->>'name_color' ~ '^#[0-9a-fA-F]{6}$' THEN p_payload->>'name_color' ELSE '#1e90ff' END,
    CASE WHEN p_payload->>'text_color' ~ '^#[0-9a-fA-F]{6}$' THEN p_payload->>'text_color' ELSE '#2f3542' END,
    CASE WHEN p_payload->>'font_size' IN ('14px','17px','22px') THEN p_payload->>'font_size' ELSE '17px' END) RETURNING id INTO result_id;
  UPDATE talkroom_private.sessions SET last_message_at=clock_timestamp() WHERE id=me.id;
  RETURN jsonb_build_object('ok',true,'id',result_id);
 END IF;
 IF p_action='ticket' THEN
  IF me.role='listener' OR NOT me.mic THEN RAISE EXCEPTION '目前沒有發話權限' USING ERRCODE='42501'; END IF;
  SELECT * INTO dest FROM talkroom_private.sessions WHERE id=(p_payload->>'recipient')::uuid AND room=me.room
   AND id<>me.id AND last_seen>now()-interval '60 seconds' AND expires_at>now();
  IF NOT FOUND OR (me.room='BROADCAST' AND dest.role<>'listener') THEN RAISE EXCEPTION '無法連線至此對象' USING ERRCODE='42501'; END IF;
  INSERT INTO talkroom_private.call_tickets(sender,recipient) VALUES(me.id,dest.id)
   ON CONFLICT(sender,recipient) DO UPDATE SET id=gen_random_uuid(),expires_at=now()+interval '30 seconds'
   RETURNING id INTO result_id;
  RETURN jsonb_build_object('ok',true,'ticket',result_id,'peer_id',dest.peer_id);
 END IF;
 IF p_action='accept' THEN
  DELETE FROM talkroom_private.call_tickets WHERE id=(p_payload->>'ticket')::uuid AND recipient=me.id AND expires_at>now() RETURNING * INTO ticket;
  IF NOT FOUND THEN RAISE EXCEPTION '語音邀請無效或已過期' USING ERRCODE='42501'; END IF;
  SELECT * INTO dest FROM talkroom_private.sessions WHERE id=ticket.sender AND room=me.room
   AND peer_id=p_payload->>'peer_id' AND mic AND role<>'listener' AND last_seen>now()-interval '60 seconds' AND expires_at>now();
  IF NOT FOUND OR (me.room='BROADCAST' AND (me.role<>'listener' OR dest.role<>'controller'))
  THEN RAISE EXCEPTION '語音來源未授權' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('ok',true,'sender',dest.id);
 END IF;
 RAISE EXCEPTION '不支援的操作';
END;
$$;
REVOKE ALL ON FUNCTION talkroom_private.api(text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION talkroom_private.api(text,uuid,jsonb) TO authenticated;
CREATE FUNCTION public.talkroom_api(p_action text,p_session uuid DEFAULT NULL,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT talkroom_private.api(p_action,p_session,p_payload); $$;
REVOKE ALL ON FUNCTION public.talkroom_api(text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.talkroom_api(text,uuid,jsonb) TO authenticated;
COMMIT;
