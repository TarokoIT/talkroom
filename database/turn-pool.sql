BEGIN;
CREATE TABLE talkroom_private.turn_servers(
 slot text PRIMARY KEY CHECK(slot ~ '^[A-G]$'),label text NOT NULL DEFAULT '',provider text NOT NULL DEFAULT 'static' CHECK(provider IN ('metered','static')),
 ice_servers jsonb NOT NULL DEFAULT '[]',domain text,secret text,enabled boolean NOT NULL DEFAULT true,
 quota_mb numeric CHECK(quota_mb>=0),provider_quota_mb numeric,usage_mb numeric CHECK(usage_mb>=0),usage_at timestamptz,attempt_at timestamptz,error text,
 revision bigint NOT NULL DEFAULT 1
);
INSERT INTO talkroom_private.turn_servers(slot) SELECT chr(n) FROM generate_series(65,71)n;
UPDATE talkroom_private.turn_servers SET label='目前 Metered',provider='metered',ice_servers=c.ice_servers,domain=m.domain,secret=m.secret,quota_mb=500
 FROM talkroom_private.candidate_turn_config c,talkroom_private.metered_account m WHERE slot='A' AND c.id AND m.id;
CREATE TABLE talkroom_private.turn_routes(
 room text PRIMARY KEY REFERENCES talkroom_private.rooms(code),primary_slot text NOT NULL REFERENCES talkroom_private.turn_servers(slot),
 fallback_slots text[] NOT NULL DEFAULT '{}',active_slot text NOT NULL REFERENCES talkroom_private.turn_servers(slot)
);
INSERT INTO talkroom_private.turn_routes(room,primary_slot,active_slot) SELECT code,'A','A' FROM talkroom_private.rooms;
ALTER TABLE talkroom_private.turn_servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE talkroom_private.turn_routes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON talkroom_private.turn_servers,talkroom_private.turn_routes FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON talkroom_private.turn_servers TO service_role;
CREATE FUNCTION talkroom_private.turn_authorize(p_session uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF p_session IS NULL THEN PERFORM talkroom_private.admin_api('list','{}');
 ELSIF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM talkroom_private.sessions WHERE id=p_session AND user_id=auth.uid() AND expires_at>now() AND last_seen>now()-interval '60 seconds')
 THEN RAISE EXCEPTION '登入已失效' USING ERRCODE='42501'; END IF;
 RETURN true;
END;$$;
REVOKE ALL ON FUNCTION talkroom_private.turn_authorize(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION talkroom_private.turn_authorize(uuid) TO authenticated;
CREATE FUNCTION public.talkroom_turn_authorize(p_session uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT talkroom_private.turn_authorize(p_session); $$;
REVOKE ALL ON FUNCTION public.talkroom_turn_authorize(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.talkroom_turn_authorize(uuid) TO authenticated;

CREATE FUNCTION talkroom_private.turn_manage(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s text:=p_payload->>'slot';item jsonb;url text;rows jsonb;r text;fallback text[];
BEGIN
 PERFORM talkroom_private.admin_api('list','{}');
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>24000 THEN RAISE EXCEPTION '設定格式錯誤';END IF;
 IF p_action='probe' THEN
 RETURN (SELECT jsonb_build_object('iceServers',ice_servers) FROM talkroom_private.turn_servers WHERE slot=s);
 ELSIF p_action='list' THEN
 SELECT jsonb_agg(jsonb_build_object('slot',slot,'label',label,'provider',provider,'configured',jsonb_array_length(ice_servers)>0,'enabled',enabled,'quota_mb',quota_mb,'provider_quota_mb',provider_quota_mb,'usage_mb',usage_mb,'usage_at',usage_at,'error',error,'has_secret',secret IS NOT NULL) ORDER BY slot) INTO rows FROM talkroom_private.turn_servers;
 RETURN jsonb_build_object('servers',rows,'routes',(SELECT jsonb_agg(to_jsonb(t)) FROM talkroom_private.turn_routes t),'rooms',talkroom_private.catalog());
 ELSIF p_action='save' THEN
 IF s IS NULL OR s!~'^[A-G]$' OR p_payload->>'provider' NOT IN ('metered','static') THEN RAISE EXCEPTION '伺服器代號或類型錯誤'; END IF;
 IF p_payload ? 'ice_servers' THEN
 IF jsonb_typeof(p_payload->'ice_servers')<>'array' OR jsonb_array_length(p_payload->'ice_servers') NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'ICE 設定格式錯誤';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'ice_servers') LOOP
 url:=item->>'urls';
 IF url IS NULL OR url!~'^(stun|stuns|turn|turns):[A-Za-z0-9.\[\]:_-]+(\?transport=(udp|tcp))?$' OR length(url)>512 THEN RAISE EXCEPTION 'TURN 位址格式錯誤';END IF;
 IF url~'^turns?:' AND (coalesce(length(item->>'username'),0)=0 OR coalesce(length(item->>'credential'),0)=0) THEN RAISE EXCEPTION 'TURN 缺少帳號或密碼';END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'ice_servers') v WHERE v->>'urls'~'^turns?:') THEN RAISE EXCEPTION '必須包含 TURN';END IF;
 END IF;
 IF p_payload->>'provider'='metered' AND p_payload ? 'domain' AND (p_payload->>'domain')!~'^[a-z0-9-]+\.metered\.live$' THEN RAISE EXCEPTION 'Metered 網域格式錯誤';END IF;
 UPDATE talkroom_private.turn_servers SET label=left(coalesce(p_payload->>'label',''),60),provider=p_payload->>'provider',enabled=coalesce((p_payload->>'enabled')::boolean,true),
 ice_servers=coalesce(p_payload->'ice_servers',ice_servers),domain=CASE WHEN p_payload ? 'domain' THEN p_payload->>'domain' ELSE domain END,
 secret=CASE WHEN p_payload ? 'secret' THEN nullif(p_payload->>'secret','') ELSE secret END,
 quota_mb=nullif(p_payload->>'quota_mb','')::numeric,
 usage_mb=CASE WHEN p_payload->>'provider'='static' THEN nullif(p_payload->>'usage_mb','')::numeric WHEN p_payload ? 'secret' OR provider<>p_payload->>'provider' THEN NULL ELSE usage_mb END,
 usage_at=CASE WHEN p_payload->>'provider'='static' THEN now() ELSE NULL END,
 provider_quota_mb=CASE WHEN p_payload ? 'secret' OR provider<>p_payload->>'provider' THEN NULL ELSE provider_quota_mb END,
 error=NULL,attempt_at=NULL,revision=revision+1 WHERE slot=s;
 ELSIF p_action='route' THEN
 r:=p_payload->>'room';fallback:=ARRAY(SELECT jsonb_array_elements_text(coalesce(p_payload->'fallback','[]')));
 IF s IS NULL OR s!~'^[A-G]$' OR cardinality(fallback)>6 OR EXISTS(SELECT 1 FROM unnest(fallback) f WHERE f!~'^[A-G]$' OR f=s) THEN RAISE EXCEPTION '備援設定錯誤';END IF;
 IF NOT EXISTS(SELECT 1 FROM talkroom_private.turn_servers WHERE slot=s AND enabled AND jsonb_array_length(ice_servers)>0) THEN RAISE EXCEPTION '主要伺服器尚未設定或已停用';END IF;
 IF EXISTS(SELECT 1 FROM unnest(fallback) f JOIN talkroom_private.turn_servers t ON t.slot=f WHERE NOT t.enabled OR jsonb_array_length(t.ice_servers)=0) THEN RAISE EXCEPTION '備援伺服器尚未設定或已停用';END IF;
 UPDATE talkroom_private.turn_routes SET primary_slot=s,fallback_slots=fallback,active_slot=s WHERE room=r;
 IF NOT FOUND THEN RAISE EXCEPTION '房間不存在';END IF;
 ELSE RAISE EXCEPTION '未知操作'; END IF;
 INSERT INTO talkroom_private.admin_audit(actor,room,action) VALUES(auth.uid(),coalesce(r,'SYSTEM'),'turn_'||p_action||' slot='||coalesce(s,''));
 RETURN jsonb_build_object('ok',true);
END;$$;
REVOKE ALL ON FUNCTION talkroom_private.turn_manage(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION talkroom_private.turn_manage(text,jsonb) TO authenticated;
CREATE FUNCTION public.talkroom_turn_manage(p_action text,p_payload jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT talkroom_private.turn_manage(p_action,p_payload); $$;
REVOKE ALL ON FUNCTION public.talkroom_turn_manage(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.talkroom_turn_manage(text,jsonb) TO authenticated;

CREATE FUNCTION public.talkroom_turn_usage_claim() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 WITH claimed AS (UPDATE talkroom_private.turn_servers SET attempt_at=now() WHERE provider='metered' AND enabled AND secret IS NOT NULL AND (attempt_at IS NULL OR attempt_at<now()-interval '60 seconds') RETURNING slot,domain,secret,revision)
 SELECT coalesce(jsonb_agg(to_jsonb(claimed)),'[]') FROM claimed;
$$;
REVOKE ALL ON FUNCTION public.talkroom_turn_usage_claim() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.talkroom_turn_usage_claim() TO service_role;
CREATE FUNCTION public.talkroom_turn_usage_store(p_slot text,p_usage numeric,p_quota numeric,p_error text,p_revision bigint) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 UPDATE talkroom_private.turn_servers SET usage_mb=CASE WHEN p_error IS NULL THEN p_usage ELSE usage_mb END,provider_quota_mb=CASE WHEN p_error IS NULL THEN p_quota ELSE provider_quota_mb END,usage_at=CASE WHEN p_error IS NULL THEN now() ELSE usage_at END,error=p_error WHERE slot=p_slot AND revision=p_revision;
$$;
REVOKE ALL ON FUNCTION public.talkroom_turn_usage_store(text,numeric,numeric,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.talkroom_turn_usage_store(text,numeric,numeric,text,bigint) TO service_role;

CREATE FUNCTION talkroom_private.turn_resolve(p_session uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE room_code text;route talkroom_private.turn_routes%ROWTYPE;chosen talkroom_private.turn_servers%ROWTYPE;s text;cap numeric;
BEGIN
 PERFORM talkroom_private.turn_authorize(p_session);
 SELECT room INTO room_code FROM talkroom_private.sessions WHERE id=p_session AND user_id=auth.uid();
 IF room_code IS NULL THEN RAISE EXCEPTION '請先登入房間' USING ERRCODE='42501';END IF;
 SELECT * INTO route FROM talkroom_private.turn_routes WHERE room=room_code FOR UPDATE;
 FOREACH s IN ARRAY array_prepend(route.active_slot,array_prepend(route.primary_slot,route.fallback_slots)) LOOP
 SELECT * INTO chosen FROM talkroom_private.turn_servers WHERE slot=s;
 cap:=least(chosen.quota_mb,chosen.provider_quota_mb);
 IF chosen.enabled AND jsonb_array_length(chosen.ice_servers)>0 AND (cap IS NULL OR chosen.usage_mb IS NULL OR chosen.usage_mb<cap) THEN
 UPDATE talkroom_private.turn_routes SET active_slot=s WHERE room=room_code;
 RETURN jsonb_build_object('slot',s,'revision',chosen.revision,'iceServers',chosen.ice_servers);
 END IF;
 END LOOP;
 RAISE EXCEPTION '此房間的 TURN 額度已用完或沒有可用設定，請管理員切換服務';
END;$$;
REVOKE ALL ON FUNCTION talkroom_private.turn_resolve(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION talkroom_private.turn_resolve(uuid) TO authenticated;
CREATE FUNCTION public.talkroom_turn_resolve(p_session uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT talkroom_private.turn_resolve(p_session); $$;
REVOKE ALL ON FUNCTION public.talkroom_turn_resolve(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.talkroom_turn_resolve(uuid) TO authenticated;
COMMIT;
