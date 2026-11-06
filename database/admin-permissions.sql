BEGIN;
ALTER TABLE talkroom_private.admin_emails ADD COLUMN enabled boolean NOT NULL DEFAULT true;
ALTER TABLE talkroom_private.admin_emails ADD COLUMN permissions text[] NOT NULL DEFAULT '{}';
ALTER TABLE talkroom_private.admin_emails ADD COLUMN revision bigint NOT NULL DEFAULT 1;
ALTER TABLE talkroom_private.admin_emails ADD COLUMN protected boolean NOT NULL DEFAULT false;
UPDATE talkroom_private.admin_emails SET permissions=ARRAY['rooms.view','rooms.edit','rooms.revoke','servers.view','servers.edit','servers.probe','records.view','records.export','records.delete','devices.view','devices.export'];
UPDATE talkroom_private.admin_emails SET protected=true,permissions=permissions||ARRAY['permissions.view','permissions.manage'] WHERE email='urza@silksplace-taroko.com.tw';

CREATE FUNCTION talkroom_private.require_access(p_permission text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE grants text[];
BEGIN
 SELECT a.permissions INTO grants FROM auth.users u JOIN talkroom_private.admin_emails a ON a.email=lower(u.email)
 WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL AND NOT coalesce(u.is_anonymous,false) AND a.enabled;
 IF grants IS NULL OR cardinality(grants)=0 THEN RAISE EXCEPTION '沒有後台權限或帳號已停用' USING ERRCODE='42501'; END IF;
 IF p_permission<>'entry' AND (NOT p_permission=ANY(grants) OR NOT (split_part(p_permission,'.',1)||'.view')=ANY(grants))
 THEN RAISE EXCEPTION '沒有此頁面或動作的權限：%',p_permission USING ERRCODE='42501'; END IF;
END; $$;
REVOKE ALL ON FUNCTION talkroom_private.require_access(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION talkroom_private.access_api(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target text; grants text[]; current_row talkroom_private.admin_emails%ROWTYPE; rows_json jsonb;
 allowed text[]:=ARRAY['rooms.view','rooms.edit','rooms.revoke','servers.view','servers.edit','servers.probe','records.view','records.export','records.delete','devices.view','devices.export','permissions.view','permissions.manage'];
BEGIN
 PERFORM talkroom_private.require_access('entry');
 IF p_action='self' THEN
  RETURN (SELECT jsonb_build_object('ok',true,'email',a.email,'permissions',a.permissions,'protected',a.protected,'rooms',talkroom_private.catalog())
   FROM talkroom_private.admin_emails a JOIN auth.users u ON lower(u.email)=a.email WHERE u.id=auth.uid());
 END IF;
 PERFORM talkroom_private.require_access('permissions.view');
 IF p_action='list' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('email',a.email,'enabled',a.enabled,'permissions',a.permissions,'protected',a.protected,'revision',a.revision,
   'registered',EXISTS(SELECT 1 FROM auth.users u WHERE lower(u.email)=a.email),'verified',EXISTS(SELECT 1 FROM auth.users u WHERE lower(u.email)=a.email AND u.email_confirmed_at IS NOT NULL)) ORDER BY a.email),'[]') INTO rows_json FROM talkroom_private.admin_emails a;
  RETURN jsonb_build_object('ok',true,'admins',rows_json);
 END IF;
 PERFORM talkroom_private.require_access('permissions.manage');
 IF p_action<>'save' OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>6000 THEN RAISE EXCEPTION '權限設定格式錯誤'; END IF;
 target:=lower(btrim(p_payload->>'email'));
 IF target IS NULL OR length(target)>254 OR target!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Email 格式錯誤'; END IF;
 SELECT coalesce(array_agg(DISTINCT value),'{}') INTO grants FROM jsonb_array_elements_text(p_payload->'permissions');
 IF EXISTS(SELECT 1 FROM unnest(grants) g WHERE NOT g=ANY(allowed) OR NOT (split_part(g,'.',1)||'.view')=ANY(grants)) THEN RAISE EXCEPTION '動作必須同時允許進入該頁面，且不得包含未知權限'; END IF;
 IF coalesce((p_payload->>'enabled')::boolean,true) AND cardinality(grants)=0 THEN RAISE EXCEPTION '啟用帳號至少須選擇一個頁面'; END IF;
 SELECT * INTO current_row FROM talkroom_private.admin_emails WHERE email=target FOR UPDATE;
 IF FOUND THEN
  IF current_row.protected THEN RAISE EXCEPTION '主要管理員受保護，不可停用或修改其完整權限'; END IF;
  IF p_payload->>'revision' IS NULL OR current_row.revision<>(p_payload->>'revision')::bigint THEN RAISE EXCEPTION '資料已被其他人變更，請重新整理再儲存'; END IF;
  UPDATE talkroom_private.admin_emails SET permissions=grants,enabled=coalesce((p_payload->>'enabled')::boolean,true),revision=revision+1 WHERE email=target;
 ELSE
  IF p_payload->>'revision' IS NOT NULL THEN RAISE EXCEPTION '帳號不存在，請重新整理'; END IF;
  INSERT INTO talkroom_private.admin_emails(email,permissions,enabled) VALUES(target,grants,coalesce((p_payload->>'enabled')::boolean,true));
 END IF;
 INSERT INTO talkroom_private.admin_audit(actor,room,action) VALUES(auth.uid(),'SYSTEM','permissions_save '||jsonb_build_object('email',target,'enabled',coalesce((p_payload->>'enabled')::boolean,true),'permissions',grants)::text);
 RETURN jsonb_build_object('ok',true);
END; $$;
REVOKE ALL ON FUNCTION talkroom_private.access_api(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION talkroom_private.access_api(text,jsonb) TO authenticated;
CREATE FUNCTION public.talkroom_access(p_action text DEFAULT 'self',p_payload jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT talkroom_private.access_api(p_action,p_payload); $$;
REVOKE ALL ON FUNCTION public.talkroom_access(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.talkroom_access(text,jsonb) TO authenticated;

-- Add gates to the live definitions, preserving later bug fixes and all existing identity checks.
DO $$ DECLARE item record; definition text; gate text;
BEGIN
 FOR item IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='talkroom_private' AND p.proname IN ('admin_api','records_api','turn_manage','device_logs','turn_authorize') LOOP
  gate:=CASE item.proname
   WHEN 'admin_api' THEN $g$PERFORM talkroom_private.require_access(CASE WHEN p_action='list' THEN 'entry' WHEN p_action='update' THEN 'rooms.edit' WHEN p_action='revoke' THEN 'rooms.revoke' ELSE 'rooms.view' END);$g$
   WHEN 'records_api' THEN $g$PERFORM talkroom_private.require_access(CASE WHEN p_action='search' THEN 'records.view' WHEN p_action='export' THEN 'records.export' ELSE 'records.delete' END);$g$
   WHEN 'turn_manage' THEN $g$PERFORM talkroom_private.require_access(CASE WHEN p_action='list' THEN 'servers.view' WHEN p_action='probe' THEN 'servers.probe' ELSE 'servers.edit' END);$g$
   WHEN 'device_logs' THEN $g$PERFORM talkroom_private.require_access(CASE WHEN p_filter->>'action'='export' THEN 'devices.export' ELSE 'devices.view' END);$g$
   WHEN 'turn_authorize' THEN $g$IF p_session IS NULL THEN PERFORM talkroom_private.require_access('servers.view'); END IF;$g$ END;
  definition:=pg_get_functiondef(item.oid);
  EXECUTE regexp_replace(definition,'\mBEGIN\M',E'BEGIN\n '||gate);
 END LOOP;
END; $$;
COMMIT;

