BEGIN;
DO $$ DECLARE u uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); other_s uuid:=gen_random_uuid();
 m uuid:=gen_random_uuid(); foreign_m uuid:=gen_random_uuid(); r jsonb; admin_id uuid; initial_at timestamptz;
BEGIN
 INSERT INTO talkroom_private.sessions(id,user_id,room,username,peer_id,role) VALUES
 (s,u,'VOICE_TEST','Response QA','qa-'||s,'member'),
 (other_s,gen_random_uuid(),'HK','Other QA','qa-'||other_s,'member');
 INSERT INTO talkroom_private.messages(id,room,session_id,username,message) VALUES
 (m,'VOICE_TEST',s,'Response QA','response fixture'),(foreign_m,'HK',other_s,'Other QA','other fixture');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 BEGIN PERFORM public.talkroom_message_response(s,foreign_m,'list');RAISE EXCEPTION 'cross room readable';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.talkroom_message_response(s,foreign_m,'received');RAISE EXCEPTION 'cross room writable';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.talkroom_message_response(other_s,foreign_m,'completed');RAISE EXCEPTION 'foreign session writable';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.talkroom_message_response(s,NULL,'received');RAISE EXCEPTION 'no selection allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 r:=public.talkroom_message_response(s,m,'received');ASSERT jsonb_array_length(r->'responses')=1;
 SELECT created_at INTO initial_at FROM talkroom_private.message_responses WHERE message_id=m;
 PERFORM public.talkroom_message_response(s,m,'received');
 ASSERT (SELECT count(*)=1 AND min(created_at)=initial_at FROM talkroom_private.message_responses WHERE message_id=m);
 r:=public.talkroom_message_response(s,m,'completed');ASSERT jsonb_array_length(r->'responses')=2;
 ASSERT (SELECT count(*)=1 FROM talkroom_private.messages WHERE session_id=s),'response created a chat message';
 BEGIN PERFORM public.talkroom_records('search','{}');RAISE EXCEPTION 'nonadmin records allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 UPDATE talkroom_private.sessions SET expires_at=now() WHERE id=s;
 BEGIN PERFORM public.talkroom_message_response(s,m,'list');RAISE EXCEPTION 'revoked session readable';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 SELECT a.id INTO admin_id FROM auth.users a JOIN talkroom_private.admin_emails b ON lower(a.email)=b.email WHERE a.email_confirmed_at IS NOT NULL LIMIT 1;
 ASSERT admin_id IS NOT NULL;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
 r:=public.talkroom_records('search','{"room":"VOICE_TEST","keywords":["response fixture"]}');
 ASSERT r->>'total'='1';ASSERT jsonb_array_length(r->'rows'->0->'received')=1;
 ASSERT r->'rows'->0->'completed'->0->>'username'='Response QA';
 r:=public.talkroom_records('export','{"room":"VOICE_TEST","keywords":["response fixture"]}');ASSERT jsonb_array_length(r->'rows'->0->'completed')=1;
 DELETE FROM talkroom_private.messages WHERE id=m;
 ASSERT NOT EXISTS(SELECT 1 FROM talkroom_private.message_responses WHERE message_id=m);
 ASSERT NOT has_table_privilege('authenticated','talkroom_private.message_responses','SELECT');
 ASSERT NOT has_table_privilege('anon','talkroom_private.message_responses','INSERT');
 ASSERT NOT has_function_privilege('anon','public.talkroom_message_response(uuid,uuid,text)','EXECUTE');
END $$;
ROLLBACK;
