BEGIN;
CREATE TABLE IF NOT EXISTS talkroom_private.message_responses (
 message_id uuid NOT NULL REFERENCES talkroom_private.messages(id) ON DELETE CASCADE,
 user_id uuid NOT NULL, session_id uuid NOT NULL, username text NOT NULL,
 action text NOT NULL CHECK(action IN ('received','completed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(message_id,user_id,action)
);
ALTER TABLE talkroom_private.message_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON talkroom_private.message_responses FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION talkroom_private.message_response(p_session uuid,p_message uuid,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$ DECLARE me talkroom_private.sessions%ROWTYPE; result jsonb;
BEGIN
 SELECT * INTO me FROM talkroom_private.sessions WHERE id=p_session AND user_id=auth.uid()
 AND expires_at>now() AND last_seen>now()-interval '60 seconds' FOR SHARE;
 IF me.id IS NULL THEN RAISE EXCEPTION '房間登入已失效' USING ERRCODE='42501'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('list','received','completed') THEN RAISE EXCEPTION '不支援的回覆'; END IF;
 PERFORM 1 FROM talkroom_private.messages WHERE id=p_message AND room=me.room FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION '訊息不存在或不屬於目前房間' USING ERRCODE='42501'; END IF;
 IF p_action<>'list' THEN
  INSERT INTO talkroom_private.message_responses(message_id,user_id,session_id,username,action)
  VALUES(p_message,me.user_id,me.id,me.username,p_action) ON CONFLICT DO NOTHING;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('username',username,'action',action,'created_at',created_at,'mine',user_id=me.user_id)
 ORDER BY created_at,user_id),'[]'::jsonb) INTO result FROM talkroom_private.message_responses WHERE message_id=p_message;
 RETURN jsonb_build_object('ok',true,'responses',result);
END; $$;
REVOKE ALL ON FUNCTION talkroom_private.message_response(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION talkroom_private.message_response(uuid,uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.talkroom_message_response(p_session uuid,p_message uuid,p_action text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT talkroom_private.message_response(p_session,p_message,p_action); $$;
REVOKE ALL ON FUNCTION public.talkroom_message_response(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.talkroom_message_response(uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION talkroom_private.records_with_responses(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$ DECLARE result jsonb; enriched jsonb;
BEGIN
 -- The existing records API checks verified admin identity before any lookup.
 result:=talkroom_private.records_api(p_action,p_payload);
 IF p_action IN ('search','export') AND coalesce(p_payload->>'kind','messages')='messages' THEN
  SELECT coalesce(jsonb_agg(item || jsonb_build_object(
   'received',coalesce((SELECT jsonb_agg(jsonb_build_object('username',r.username,'created_at',r.created_at) ORDER BY r.created_at,r.user_id)
    FROM talkroom_private.message_responses r WHERE r.message_id=(item->>'id')::uuid AND r.action='received'),'[]'::jsonb),
   'completed',coalesce((SELECT jsonb_agg(jsonb_build_object('username',r.username,'created_at',r.created_at) ORDER BY r.created_at,r.user_id)
    FROM talkroom_private.message_responses r WHERE r.message_id=(item->>'id')::uuid AND r.action='completed'),'[]'::jsonb)
   ) ORDER BY ord),'[]'::jsonb) INTO enriched FROM jsonb_array_elements(result->'rows') WITH ORDINALITY AS x(item,ord);
  result:=jsonb_set(result,'{rows}',enriched);
 END IF;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION talkroom_private.records_with_responses(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION talkroom_private.records_with_responses(text,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.talkroom_records(p_action text,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT talkroom_private.records_with_responses(p_action,p_payload); $$;
CREATE OR REPLACE FUNCTION talkroom_private.interact(p_session uuid,p_action text,p_target uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$ DECLARE me talkroom_private.sessions%ROWTYPE; result jsonb;
BEGIN
 SELECT * INTO me FROM talkroom_private.sessions WHERE id=p_session AND user_id=auth.uid()
 AND expires_at>now() AND last_seen>now()-interval '60 seconds' FOR UPDATE;
 IF me.id IS NULL THEN RAISE EXCEPTION '房間登入已失效' USING ERRCODE='42501'; END IF;
 IF p_action='ack' THEN
  RAISE EXCEPTION '請重新整理網頁，先選取訊息再按收到';
 ELSIF p_action='beep' THEN
  IF p_target=me.id OR NOT EXISTS(SELECT 1 FROM talkroom_private.sessions WHERE id=p_target AND room=me.room
   AND expires_at>now() AND last_seen>now()-interval '60 seconds')
  THEN RAISE EXCEPTION '只能提醒同房間的其他在線成員' USING ERRCODE='42501'; END IF;
  IF me.last_beep_at>clock_timestamp()-interval '5 seconds' THEN RAISE EXCEPTION '請隔 5 秒再提醒'; END IF;
  UPDATE talkroom_private.sessions SET last_beep_at=clock_timestamp() WHERE id=me.id;
  INSERT INTO talkroom_private.beep_events(target,sender_name) VALUES(p_target,me.username);
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action='poll' THEN
  DELETE FROM talkroom_private.beep_events WHERE created_at<now()-interval '30 seconds';
  WITH consumed AS (DELETE FROM talkroom_private.beep_events WHERE target=me.id RETURNING sender_name)
  SELECT coalesce(jsonb_agg(sender_name),'[]'::jsonb) INTO result FROM consumed;
  RETURN jsonb_build_object('ok',true,'senders',result);
 ELSE RAISE EXCEPTION '不支援的操作'; END IF;
END; $$;
COMMIT;
