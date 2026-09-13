BEGIN;
CREATE FUNCTION talkroom_private.turn_rebind(p_session uuid,p_peer text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM talkroom_private.turn_authorize(p_session);
 IF p_peer IS NULL OR p_peer!~'^talkroom-[a-f0-9-]{36}$' THEN RAISE EXCEPTION '語音識別碼格式錯誤';END IF;
 UPDATE talkroom_private.sessions SET peer_id=p_peer WHERE id=p_session AND user_id=auth.uid();RETURN FOUND;
END;$$;
REVOKE ALL ON FUNCTION talkroom_private.turn_rebind(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION talkroom_private.turn_rebind(uuid,text) TO authenticated;
CREATE FUNCTION public.talkroom_turn_rebind(p_session uuid,p_peer text) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT talkroom_private.turn_rebind(p_session,p_peer);$$;
REVOKE ALL ON FUNCTION public.talkroom_turn_rebind(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.talkroom_turn_rebind(uuid,text) TO authenticated;
COMMIT;
