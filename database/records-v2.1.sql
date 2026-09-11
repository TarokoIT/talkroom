BEGIN;
ALTER TABLE talkroom_private.rooms ADD COLUMN IF NOT EXISTS history_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE talkroom_private.sessions ADD COLUMN IF NOT EXISTS offline_logged boolean NOT NULL DEFAULT false;
CREATE TABLE talkroom_private.activity_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),session_id uuid NOT NULL,room text NOT NULL,
 username text NOT NULL,event text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX activity_room_time ON talkroom_private.activity_events(room,created_at DESC,id);
CREATE INDEX activity_time ON talkroom_private.activity_events(created_at DESC,id);
CREATE INDEX messages_time ON talkroom_private.messages(created_at DESC,id);
CREATE TABLE talkroom_private.delete_previews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor uuid NOT NULL,room text NOT NULL,
 start_at timestamptz NOT NULL,end_at timestamptz NOT NULL,ids uuid[] NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes'
);
ALTER TABLE talkroom_private.activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE talkroom_private.delete_previews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON talkroom_private.activity_events,talkroom_private.delete_previews FROM PUBLIC,anon,authenticated;
CREATE FUNCTION talkroom_private.session_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE kind text; at_time timestamptz:=clock_timestamp(); sid uuid; room_code text; display_name text;
BEGIN
 IF TG_OP='INSERT' THEN kind:='登入';
 ELSIF TG_OP='DELETE' THEN
  IF OLD.expires_at<=now() OR OLD.offline_logged THEN RETURN OLD; END IF;
  kind:='登出';
 ELSE
  IF OLD.expires_at>now() AND NEW.expires_at<=now() THEN kind:='管理員撤銷登入';
  ELSIF NOT OLD.offline_logged AND NEW.offline_logged THEN
   IF EXISTS(SELECT 1 FROM talkroom_private.activity_events WHERE session_id=OLD.id AND event='管理員撤銷登入') THEN RETURN NEW; END IF;
   kind:=CASE WHEN OLD.expires_at<=OLD.last_seen+interval '60 seconds' THEN '登入到期' ELSE '逾時離線（推估）' END;
   at_time:=least(OLD.expires_at,OLD.last_seen+interval '60 seconds');
  ELSIF OLD.offline_logged AND NOT NEW.offline_logged THEN kind:='重新連線';
  ELSE RETURN NEW; END IF;
 END IF;
 IF TG_OP='DELETE' THEN sid:=OLD.id;room_code:=OLD.room;display_name:=OLD.username;
 ELSE sid:=NEW.id;room_code:=NEW.room;display_name:=NEW.username; END IF;
 INSERT INTO talkroom_private.activity_events(session_id,room,username,event,created_at)
 VALUES(sid,room_code,display_name,kind,at_time);
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
REVOKE ALL ON FUNCTION talkroom_private.session_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER session_events AFTER INSERT OR UPDATE OR DELETE ON talkroom_private.sessions
 FOR EACH ROW EXECUTE FUNCTION talkroom_private.session_event();

CREATE FUNCTION talkroom_private.records_api(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE uid uuid:=auth.uid(); room_code text:=nullif(p_payload->>'room','');
 start_at timestamptz;end_at timestamptz;keywords text[];match_mode text:=coalesce(p_payload->>'mode','AND');
 keyword_mode text:=coalesce(p_payload->>'keyword_mode','AND');kind text:=coalesce(p_payload->>'kind','messages');
 rows_json jsonb;total bigint;offset_value int:=coalesce((p_payload->>'offset')::int,0);limit_value int;
 preview talkroom_private.delete_previews%ROWTYPE;target_ids uuid[];token uuid;deleted_count int;
BEGIN
 IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users u JOIN talkroom_private.admin_emails a ON lower(u.email)=a.email
  WHERE u.id=uid AND u.email_confirmed_at IS NOT NULL AND NOT coalesce(u.is_anonymous,false))
 THEN RAISE EXCEPTION '此帳號沒有管理員權限' USING ERRCODE='42501'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>6000 THEN RAISE EXCEPTION '請求格式錯誤'; END IF;
 IF p_action='delete_confirm' THEN
  DELETE FROM talkroom_private.delete_previews WHERE id=(p_payload->>'token')::uuid AND actor=uid AND expires_at>now() RETURNING * INTO preview;
  IF NOT FOUND THEN RAISE EXCEPTION '預覽已過期或已使用，請重新預覽'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('talkroom:'||preview.room));
  DELETE FROM talkroom_private.messages WHERE id=ANY(preview.ids) AND room=preview.room
   AND created_at>=preview.start_at AND created_at<preview.end_at;
  GET DIAGNOSTICS deleted_count=ROW_COUNT;
  UPDATE talkroom_private.rooms SET history_revision=history_revision+1 WHERE code=preview.room;
  INSERT INTO talkroom_private.admin_audit(actor,room,action) VALUES(uid,preview.room,
   'clear_messages count='||deleted_count||' from='||preview.start_at||' before='||preview.end_at);
  RETURN jsonb_build_object('ok',true,'deleted',deleted_count);
 END IF;
 IF room_code IS NOT NULL AND NOT EXISTS(SELECT 1 FROM talkroom_private.rooms WHERE code=room_code) THEN RAISE EXCEPTION '房間不存在'; END IF;
 IF nullif(p_payload->>'from','') IS NOT NULL THEN start_at:=((p_payload->>'from')::date)::timestamp AT TIME ZONE 'Asia/Taipei'; END IF;
 IF nullif(p_payload->>'to','') IS NOT NULL THEN end_at:=((p_payload->>'to')::date+1)::timestamp AT TIME ZONE 'Asia/Taipei'; END IF;
 IF start_at IS NOT NULL AND end_at IS NOT NULL AND start_at>=end_at THEN RAISE EXCEPTION '日期區間錯誤'; END IF;
 IF p_action='delete_preview' THEN
  IF room_code IS NULL OR start_at IS NULL OR end_at IS NULL THEN RAISE EXCEPTION '清除必須指定一個房間及起訖日期'; END IF;
  SELECT array_agg(id) INTO target_ids FROM (SELECT id FROM talkroom_private.messages
   WHERE room=room_code AND created_at>=start_at AND created_at<end_at ORDER BY created_at,id LIMIT 10001) m;
  IF cardinality(target_ids)>10000 THEN RAISE EXCEPTION '超過 10000 筆，請縮小清除日期區間'; END IF;
  DELETE FROM talkroom_private.delete_previews WHERE expires_at<=now();
  INSERT INTO talkroom_private.delete_previews(actor,room,start_at,end_at,ids)
   VALUES(uid,room_code,start_at,end_at,coalesce(target_ids,'{}'::uuid[])) RETURNING id INTO token;
  RETURN jsonb_build_object('ok',true,'token',token,'count',coalesce(cardinality(target_ids),0));
 END IF;
 IF p_action NOT IN ('search','export') OR kind NOT IN ('messages','events') OR match_mode NOT IN ('AND','OR') OR keyword_mode NOT IN ('AND','OR')
  OR offset_value<0 OR offset_value>100000 THEN RAISE EXCEPTION '搜尋條件錯誤'; END IF;
 SELECT coalesce(array_agg(btrim(value)) FILTER(WHERE btrim(value)<>''),'{}'::text[]) INTO keywords
  FROM jsonb_array_elements_text(coalesce(p_payload->'keywords','[]'::jsonb));
 IF cardinality(keywords)>10 THEN RAISE EXCEPTION '最多 10 個關鍵字'; END IF;
 -- Persist timeout estimates when an admin reviews logs, even when a room is idle.
 IF kind='events' THEN
  UPDATE talkroom_private.sessions SET offline_logged=true WHERE NOT offline_logged AND last_seen<=now()-interval '60 seconds';
 END IF;
 limit_value:=CASE WHEN p_action='export' THEN 10001 ELSE 100 END;
 WITH records AS (
  SELECT m.id,m.room,r.title AS room_title,m.username,m.message AS content,m.created_at
   FROM talkroom_private.messages m JOIN talkroom_private.rooms r ON r.code=m.room WHERE kind='messages'
  UNION ALL
  SELECT e.id,e.room,r.title,e.username,e.event,e.created_at
   FROM talkroom_private.activity_events e JOIN talkroom_private.rooms r ON r.code=e.room WHERE kind='events'
 ), matches AS (
  SELECT records.*,array_remove(ARRAY[
   CASE WHEN room_code IS NOT NULL THEN room=room_code END,
   CASE WHEN start_at IS NOT NULL OR end_at IS NOT NULL THEN (start_at IS NULL OR created_at>=start_at) AND (end_at IS NULL OR created_at<end_at) END,
   CASE WHEN cardinality(keywords)>0 THEN (SELECT CASE WHEN keyword_mode='AND' THEN bool_and(strpos(lower(records.content||' '||records.username),lower(k))>0)
    ELSE bool_or(strpos(lower(records.content||' '||records.username),lower(k))>0) END FROM unnest(keywords) k) END
  ],NULL) AS tests FROM records
 ), filtered AS (
  SELECT id,room,room_title,username,content,created_at FROM matches
   WHERE cardinality(tests)=0 OR CASE WHEN match_mode='AND' THEN true=ALL(tests) ELSE true=ANY(tests) END
 ), page AS (SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT limit_value OFFSET CASE WHEN p_action='export' THEN 0 ELSE offset_value END)
 SELECT (SELECT count(*) FROM filtered),coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY created_at DESC,id DESC) FROM page),'[]'::jsonb)
 INTO total,rows_json;
 IF p_action='export' AND total>10000 THEN RAISE EXCEPTION '結果超過 10000 筆，請縮小搜尋條件再匯出'; END IF;
 RETURN jsonb_build_object('ok',true,'total',total,'rows',rows_json);
END; $$;
REVOKE ALL ON FUNCTION talkroom_private.records_api(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION talkroom_private.records_api(text,jsonb) TO authenticated;
CREATE FUNCTION public.talkroom_records(p_action text,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT talkroom_private.records_api(p_action,p_payload); $$;
REVOKE ALL ON FUNCTION public.talkroom_records(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.talkroom_records(text,jsonb) TO authenticated;
COMMIT;
