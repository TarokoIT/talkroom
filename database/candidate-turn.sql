-- Test-room-only static TURN credentials. Populate privately, never commit credentials.
BEGIN;
CREATE TABLE IF NOT EXISTS talkroom_private.candidate_turn_config (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), ice_servers jsonb NOT NULL,
 enabled boolean NOT NULL DEFAULT true
);
ALTER TABLE talkroom_private.candidate_turn_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON talkroom_private.candidate_turn_config FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION talkroom_private.candidate_turn(p_session uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
 SELECT 1 FROM talkroom_private.sessions WHERE id=p_session AND user_id=auth.uid()
 AND room='VOICE_TEST' AND expires_at>now() AND last_seen>now()-interval '60 seconds')
 THEN RAISE EXCEPTION '請先登入語音測試房' USING ERRCODE='42501'; END IF;
 SELECT ice_servers INTO result FROM talkroom_private.candidate_turn_config WHERE id AND enabled;
 IF result IS NULL THEN RAISE EXCEPTION 'TURN 測試尚未啟用'; END IF;
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION talkroom_private.candidate_turn(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION talkroom_private.candidate_turn(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.talkroom_candidate_turn(p_session uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT talkroom_private.candidate_turn(p_session); $$;
REVOKE ALL ON FUNCTION public.talkroom_candidate_turn(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.talkroom_candidate_turn(uuid) TO authenticated;
COMMIT;
