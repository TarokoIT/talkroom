BEGIN;
CREATE OR REPLACE FUNCTION talkroom_private.room_turn(p_session uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$ DECLARE result jsonb; BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM talkroom_private.sessions
 WHERE id=p_session AND user_id=auth.uid() AND expires_at>now() AND last_seen>now()-interval '60 seconds')
 THEN RAISE EXCEPTION '請先登入房間' USING ERRCODE='42501'; END IF;
 SELECT ice_servers INTO result FROM talkroom_private.candidate_turn_config WHERE id AND enabled;
 IF result IS NULL THEN RAISE EXCEPTION 'TURN 服務尚未設定'; END IF;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION talkroom_private.room_turn(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION talkroom_private.room_turn(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.talkroom_room_turn(p_session uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT talkroom_private.room_turn(p_session); $$;
REVOKE ALL ON FUNCTION public.talkroom_room_turn(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.talkroom_room_turn(uuid) TO authenticated;

ALTER TABLE talkroom_private.sessions ADD COLUMN IF NOT EXISTS last_beep_at timestamptz;
CREATE TABLE IF NOT EXISTS talkroom_private.beep_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),target uuid NOT NULL, sender_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS beep_target_idx ON talkroom_private.beep_events(target);
ALTER TABLE talkroom_private.beep_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON talkroom_private.beep_events FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION talkroom_private.interact(p_session uuid,p_action text,p_target uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$ DECLARE me talkroom_private.sessions%ROWTYPE; result jsonb;
BEGIN
 SELECT * INTO me FROM talkroom_private.sessions WHERE id=p_session AND user_id=auth.uid()
 AND expires_at>now() AND last_seen>now()-interval '60 seconds' FOR UPDATE;
 IF me.id IS NULL THEN RAISE EXCEPTION '房間登入已失效' USING ERRCODE='42501'; END IF;
 IF p_action='ack' THEN
  IF me.last_message_at>clock_timestamp()-interval '2 seconds' THEN RAISE EXCEPTION '請稍候再傳送'; END IF;
  INSERT INTO talkroom_private.messages(room,session_id,username,message) VALUES(me.room,me.id,me.username,'收到');
  UPDATE talkroom_private.sessions SET last_message_at=clock_timestamp() WHERE id=me.id;
  RETURN jsonb_build_object('ok',true);
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
REVOKE ALL ON FUNCTION talkroom_private.interact(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION talkroom_private.interact(uuid,text,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.talkroom_interact(p_session uuid,p_action text,p_target uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT talkroom_private.interact(p_session,p_action,p_target); $$;
REVOKE ALL ON FUNCTION public.talkroom_interact(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.talkroom_interact(uuid,text,uuid) TO authenticated;
COMMIT;
