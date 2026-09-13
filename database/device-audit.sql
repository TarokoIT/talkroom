BEGIN;
CREATE TABLE talkroom_private.device_audit(
 session_id uuid PRIMARY KEY,user_id uuid NOT NULL,room text NOT NULL,username text NOT NULL,role text NOT NULL,
 joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),ended_at timestamptz,exit_reason text,last_seen timestamptz,
 auth_method text,request_ip_chain text,user_agent text,client jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX device_audit_time ON talkroom_private.device_audit(joined_at DESC);
ALTER TABLE talkroom_private.device_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON talkroom_private.device_audit FROM PUBLIC,anon,authenticated;
CREATE FUNCTION talkroom_private.capture_device() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE headers jsonb:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;method text;
BEGIN
 IF TG_OP='INSERT' THEN
 SELECT CASE WHEN is_anonymous THEN 'Supabase anonymous + room password' ELSE coalesce(raw_app_meta_data->>'provider','unknown')||' + room password' END INTO method FROM auth.users WHERE id=NEW.user_id;
 INSERT INTO talkroom_private.device_audit(session_id,user_id,room,username,role,auth_method,request_ip_chain,user_agent,last_seen)
 VALUES(NEW.id,NEW.user_id,NEW.room,NEW.username,NEW.role,method,left(coalesce(headers->>'cf-connecting-ip',headers->>'x-forwarded-for'),500),left(headers->>'user-agent',1000),NEW.last_seen);
 RETURN NEW;
 ELSIF TG_OP='DELETE' THEN
 UPDATE talkroom_private.device_audit SET ended_at=coalesce(ended_at,clock_timestamp()),exit_reason=coalesce(exit_reason,'登出'),last_seen=OLD.last_seen WHERE session_id=OLD.id;RETURN OLD;
 ELSE
 UPDATE talkroom_private.device_audit SET last_seen=NEW.last_seen,
 ended_at=CASE WHEN NEW.expires_at<=now() THEN coalesce(ended_at,now()) WHEN NEW.offline_logged THEN least(NEW.expires_at,NEW.last_seen+interval '60 seconds') ELSE NULL END,
 exit_reason=CASE WHEN NEW.expires_at<=now() THEN '登入到期或撤銷' WHEN NEW.offline_logged THEN '逾時離線（推估）' ELSE NULL END WHERE session_id=NEW.id;
 RETURN NEW;
 END IF;
END;$$;
REVOKE ALL ON FUNCTION talkroom_private.capture_device() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER capture_device AFTER INSERT OR UPDATE OR DELETE ON talkroom_private.sessions FOR EACH ROW EXECUTE FUNCTION talkroom_private.capture_device();
CREATE FUNCTION talkroom_private.device_context(p_session uuid,p_client jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM talkroom_private.turn_authorize(p_session);
 IF jsonb_typeof(p_client)<>'object' OR octet_length(p_client::text)>6000 THEN RAISE EXCEPTION '裝置資訊過長';END IF;
 UPDATE talkroom_private.device_audit SET client=p_client WHERE session_id=p_session AND user_id=auth.uid();RETURN true;
END;$$;
REVOKE ALL ON FUNCTION talkroom_private.device_context(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION talkroom_private.device_context(uuid,jsonb) TO authenticated;
CREATE FUNCTION public.talkroom_device_context(p_session uuid,p_client jsonb) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT talkroom_private.device_context(p_session,p_client);$$;
REVOKE ALL ON FUNCTION public.talkroom_device_context(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.talkroom_device_context(uuid,jsonb) TO authenticated;
CREATE FUNCTION talkroom_private.device_logs(p_filter jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;start_at timestamptz;end_at timestamptz;n int:=coalesce((p_filter->>'offset')::int,0);
BEGIN
 PERFORM talkroom_private.admin_api('list','{}');
 IF octet_length(p_filter::text)>2000 OR n<0 THEN RAISE EXCEPTION '篩選格式錯誤';END IF;
 start_at:=nullif(p_filter->>'from','')::date::timestamp AT TIME ZONE 'Asia/Taipei';end_at:=(nullif(p_filter->>'to','')::date+1)::timestamp AT TIME ZONE 'Asia/Taipei';
 WITH filtered AS (SELECT * FROM talkroom_private.device_audit WHERE (nullif(p_filter->>'room','') IS NULL OR room=p_filter->>'room')
 AND (start_at IS NULL OR joined_at>=start_at) AND (end_at IS NULL OR joined_at<end_at)
 AND (nullif(p_filter->>'keyword','') IS NULL OR strpos(lower(username||' '||coalesce(request_ip_chain,'')||' '||coalesce(user_agent,'')||' '||client::text),lower(p_filter->>'keyword'))>0)),
 page AS (SELECT * FROM filtered ORDER BY joined_at DESC,session_id LIMIT 100 OFFSET n)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'rows',coalesce((SELECT jsonb_agg(to_jsonb(page)) FROM page),'[]')) INTO result;
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION talkroom_private.device_logs(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION talkroom_private.device_logs(jsonb) TO authenticated;
CREATE FUNCTION public.talkroom_device_logs(p_filter jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT talkroom_private.device_logs(p_filter);$$;
REVOKE ALL ON FUNCTION public.talkroom_device_logs(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.talkroom_device_logs(jsonb) TO authenticated;
COMMIT;
