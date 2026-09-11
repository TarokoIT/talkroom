BEGIN;
CREATE TABLE talkroom_private.admin_emails(email text PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE talkroom_private.admin_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor uuid NOT NULL,room text NOT NULL,
 action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE talkroom_private.admin_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE talkroom_private.admin_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON talkroom_private.admin_emails,talkroom_private.admin_audit FROM PUBLIC,anon,authenticated;
-- Deliberately public aggregate metadata requested for the lobby. No identities, passwords or peer ids.
CREATE FUNCTION talkroom_private.catalog()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.code),'[]'::jsonb)
 FROM (SELECT room.code,room.title,room.capacity,
  count(s.id)::int AS online,
  count(s.id) FILTER(WHERE s.role='listener')::int AS listeners,
  count(s.id) FILTER(WHERE s.role='controller')::int AS controllers
  FROM talkroom_private.rooms room
  LEFT JOIN talkroom_private.sessions s ON s.room=room.code
   AND s.last_seen>now()-interval '60 seconds' AND s.expires_at>now()
  GROUP BY room.code,room.title,room.capacity) r;
$$;
REVOKE ALL ON FUNCTION talkroom_private.catalog() FROM PUBLIC;
GRANT USAGE ON SCHEMA talkroom_private TO anon;
GRANT EXECUTE ON FUNCTION talkroom_private.catalog() TO anon,authenticated;
CREATE FUNCTION public.talkroom_catalog()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT talkroom_private.catalog(); $$;
REVOKE ALL ON FUNCTION public.talkroom_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.talkroom_catalog() TO anon,authenticated;

CREATE FUNCTION talkroom_private.admin_api(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE uid uuid:=auth.uid(); room_code text; new_name text; new_password text; control_password text;
 changed_password boolean; revoked integer:=0; result jsonb;
BEGIN
 IF uid IS NULL OR NOT EXISTS(
  SELECT 1 FROM auth.users u JOIN talkroom_private.admin_emails a ON lower(u.email)=a.email
   WHERE u.id=uid AND u.email_confirmed_at IS NOT NULL AND NOT coalesce(u.is_anonymous,false)
 ) THEN RAISE EXCEPTION '此帳號沒有管理員權限，請確認 Email 已驗證' USING ERRCODE='42501'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>4000
 THEN RAISE EXCEPTION '請求格式錯誤'; END IF;
 IF p_action='list' THEN
  RETURN jsonb_build_object('ok',true,'rooms',talkroom_private.catalog());
 END IF;
 room_code:=p_payload->>'room';new_name:=btrim(p_payload->>'title');
 new_password:=nullif(p_payload->>'password','');control_password:=nullif(p_payload->>'controller_password','');
 PERFORM pg_advisory_xact_lock(hashtext('talkroom:'||coalesce(room_code,'')));
 IF NOT EXISTS(SELECT 1 FROM talkroom_private.rooms WHERE code=room_code) THEN RAISE EXCEPTION '房間不存在'; END IF;
 IF p_action='update' THEN
  IF new_name IS NULL OR char_length(new_name) NOT BETWEEN 1 AND 32 THEN RAISE EXCEPTION '房間名稱須為 1 至 32 字'; END IF;
  IF (new_password IS NOT NULL AND (char_length(new_password)<12 OR octet_length(new_password)>64))
   OR (control_password IS NOT NULL AND (char_length(control_password)<12 OR octet_length(control_password)>64))
  THEN RAISE EXCEPTION '新密碼至少 12 字且不得超過 64 bytes'; END IF;
  IF control_password IS NOT NULL AND room_code<>'BROADCAST' THEN RAISE EXCEPTION '只有廣播房有控制台密碼'; END IF;
  changed_password:=new_password IS NOT NULL OR control_password IS NOT NULL;
  UPDATE talkroom_private.rooms SET title=new_name,
   password_hash=CASE WHEN new_password IS NULL THEN password_hash ELSE extensions.crypt(new_password,extensions.gen_salt('bf',10)) END,
   controller_hash=CASE WHEN control_password IS NULL THEN controller_hash ELSE extensions.crypt(control_password,extensions.gen_salt('bf',10)) END
  WHERE code=room_code;
  IF changed_password THEN
   UPDATE talkroom_private.sessions SET expires_at=now(),mic=false WHERE room=room_code AND expires_at>now();
   GET DIAGNOSTICS revoked=ROW_COUNT;
  END IF;
 ELSIF p_action='revoke' THEN
  UPDATE talkroom_private.sessions SET expires_at=now(),mic=false WHERE room=room_code AND expires_at>now();
  GET DIAGNOSTICS revoked=ROW_COUNT;
 ELSE RAISE EXCEPTION '不支援的操作';
 END IF;
 INSERT INTO talkroom_private.admin_audit(actor,room,action)
 VALUES(uid,room_code,CASE WHEN p_action='revoke' THEN 'revoke_sessions'
  WHEN changed_password THEN 'rename_rotate_and_revoke' ELSE 'rename' END);
 RETURN jsonb_build_object('ok',true,'revoked',revoked);
END;
$$;
REVOKE ALL ON FUNCTION talkroom_private.admin_api(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION talkroom_private.admin_api(text,jsonb) TO authenticated;
CREATE FUNCTION public.talkroom_admin(p_action text,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT talkroom_private.admin_api(p_action,p_payload); $$;
REVOKE ALL ON FUNCTION public.talkroom_admin(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.talkroom_admin(text,jsonb) TO authenticated;
COMMIT;
