BEGIN;
DO $$
DECLARE uid uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid();
 r jsonb; preview jsonb; latest uuid; pending_id uuid; failed boolean;
BEGIN
 INSERT INTO talkroom_private.rooms(code,title,password_hash) VALUES('QA_RECORD_A','甲','unused'),('QA_RECORD_B','乙','unused');
 INSERT INTO talkroom_private.admin_emails(email) VALUES('qa-records@example.invalid');
 INSERT INTO auth.users(id,email,email_confirmed_at,is_anonymous) VALUES(uid,'qa-records@example.invalid',now(),false);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',stranger,'role','authenticated','email','qa-records@example.invalid')::text,true);
 BEGIN PERFORM public.talkroom_records('search','{}');RAISE EXCEPTION 'unauthorized search';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
 INSERT INTO talkroom_private.sessions(id,user_id,room,username,peer_id,role) VALUES(sid,uid,'QA_RECORD_A','QA','qa-record-peer','member');
 ASSERT EXISTS(SELECT 1 FROM talkroom_private.activity_events WHERE session_id=sid AND event='登入');
 INSERT INTO talkroom_private.messages(room,session_id,username,message,created_at) VALUES
 ('QA_RECORD_A',sid,'QA',E'毛巾\n301','2026-01-01 16:00:00+00'),
 ('QA_RECORD_A',sid,'QA','毛巾','2026-01-02 15:59:59+00'),
 ('QA_RECORD_A',sid,'QA','其他','2026-01-02 16:00:00+00'),
 ('QA_RECORD_B',sid,'QA','毛巾 301','2026-01-01 16:00:00+00');
 r:=public.talkroom_records('search','{"room":"QA_RECORD_A","from":"2026-01-02","to":"2026-01-02","keywords":["毛巾","301"],"keyword_mode":"AND","mode":"AND"}');
 ASSERT (r->>'total')::int=1,'AND keyword/date filter';
 ASSERT r->'rows'->0->>'content'=E'毛巾\n301','multiline lost';
 r:=public.talkroom_records('search','{"room":"QA_RECORD_A","from":"2026-01-02","to":"2026-01-02","keywords":["毛巾","301"],"keyword_mode":"OR","mode":"AND"}');
 ASSERT (r->>'total')::int=2,'OR keywords/date bounds';
 r:=public.talkroom_records('search','{"room":"QA_RECORD_A","keywords":["301"],"mode":"OR"}');
 ASSERT (r->>'total')::int>=4,'OR condition groups';
 r:=public.talkroom_records('export','{"room":"QA_RECORD_A","from":"2026-01-02","to":"2026-01-02"}');
 ASSERT (r->>'total')::int=2 AND jsonb_array_length(r->'rows')=2,'export mismatch';
 failed:=false;BEGIN PERFORM public.talkroom_records('delete_preview','{"from":"2026-01-02","to":"2026-01-02"}');EXCEPTION WHEN raise_exception THEN failed:=true;END;
 ASSERT failed,'delete without room accepted';
 preview:=public.talkroom_records('delete_preview','{"room":"QA_RECORD_A","from":"2026-01-02","to":"2026-01-02","mode":"OR"}');
 ASSERT (preview->>'count')::int=2,'preview scope';
 INSERT INTO talkroom_private.messages(room,session_id,username,message,created_at)
 VALUES('QA_RECORD_A',sid,'QA','after preview','2026-01-02 01:00:00+00') RETURNING id INTO pending_id;
 SELECT id INTO latest FROM talkroom_private.messages WHERE room='QA_RECORD_A' ORDER BY created_at DESC,id DESC LIMIT 1;
 r:=public.talkroom_api('sync',sid,jsonb_build_object('history_revision',0,'latest_message_id',latest));
 ASSERT r->'messages'='null'::jsonb,'unchanged history should be omitted';
 r:=public.talkroom_records('delete_confirm',jsonb_build_object('token',preview->>'token'));
 ASSERT (r->>'deleted')::int=2,'wrong deletion count';
 ASSERT EXISTS(SELECT 1 FROM talkroom_private.messages WHERE id=pending_id),'deleted message created after preview';
 ASSERT EXISTS(SELECT 1 FROM talkroom_private.messages WHERE id=latest),'deleted outside date';
 ASSERT EXISTS(SELECT 1 FROM talkroom_private.messages WHERE room='QA_RECORD_B'),'deleted other room';
 ASSERT (SELECT count(*) FROM talkroom_private.activity_events WHERE session_id=sid)=1,'deleted activity log';
 r:=public.talkroom_api('sync',sid,jsonb_build_object('history_revision',0,'latest_message_id',latest));
 ASSERT jsonb_array_length(r->'messages')=2,'middle-history deletion did not refresh';
 failed:=false;BEGIN PERFORM public.talkroom_records('delete_confirm',jsonb_build_object('token',preview->>'token'));EXCEPTION WHEN raise_exception THEN failed:=true;END;
 ASSERT failed,'delete preview reused';
 UPDATE talkroom_private.sessions SET last_seen=now()-interval '2 minutes' WHERE id=sid;
 r:=public.talkroom_records('search','{"kind":"events","room":"QA_RECORD_A"}');
 ASSERT (r->>'total')::int=2,'timeout event missing';
 PERFORM public.talkroom_api('sync',sid,'{}');
 ASSERT EXISTS(SELECT 1 FROM talkroom_private.activity_events WHERE session_id=sid AND event='重新連線');
 PERFORM public.talkroom_api('leave',sid,'{}');
 ASSERT EXISTS(SELECT 1 FROM talkroom_private.activity_events WHERE session_id=sid AND event='登出');
 ASSERT NOT has_table_privilege('authenticated','talkroom_private.activity_events','SELECT');
 ASSERT NOT has_function_privilege('anon','public.talkroom_records(text,jsonb)','EXECUTE');
END $$;
ROLLBACK;
SELECT 'Records authorization, AND/OR, Taiwan date boundaries, multiline, export, exact preview deletion, revision refresh and lifecycle tests passed; fixtures rolled back' AS result;
