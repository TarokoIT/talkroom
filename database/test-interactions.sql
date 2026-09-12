-- Run after production-turn-interactions.sql. All fixtures are rolled back.
BEGIN;
DO $$ DECLARE u uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); x uuid:=gen_random_uuid(); r jsonb;
BEGIN
 INSERT INTO talkroom_private.sessions(id,user_id,room,username,peer_id,role) VALUES
 (s,u,'HK','QA sender','qa-'||s,'member'),(t,gen_random_uuid(),'HK','QA target','qa-'||t,'member'),(x,gen_random_uuid(),'FD','QA other','qa-'||x,'member');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 BEGIN PERFORM public.talkroom_interact(s,'beep',x);RAISE EXCEPTION 'cross-room allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.talkroom_interact(s,'beep',s);RAISE EXCEPTION 'self allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM public.talkroom_interact(s,'beep',t);
 BEGIN PERFORM public.talkroom_interact(s,'beep',t);RAISE EXCEPTION 'cooldown missing';EXCEPTION WHEN raise_exception THEN IF SQLERRM='cooldown missing' THEN RAISE;END IF;END;
 PERFORM public.talkroom_interact(s,'ack');
 ASSERT EXISTS(SELECT 1 FROM talkroom_private.messages WHERE session_id=s AND message='收到');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',(SELECT user_id FROM talkroom_private.sessions WHERE id=t),'role','authenticated')::text,true);
 r:=public.talkroom_interact(t,'poll');ASSERT jsonb_array_length(r->'senders')=1;
 r:=public.talkroom_interact(t,'poll');ASSERT jsonb_array_length(r->'senders')=0;
 BEGIN PERFORM public.talkroom_interact(s,'ack');RAISE EXCEPTION 'foreign owner allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 UPDATE talkroom_private.sessions SET room='BROADCAST',role='listener' WHERE id=t;
 PERFORM public.talkroom_interact(t,'ack');
 ASSERT EXISTS(SELECT 1 FROM talkroom_private.messages WHERE session_id=t AND room='BROADCAST' AND message='收到');
 ASSERT NOT has_function_privilege('anon','public.talkroom_interact(uuid,text,uuid)','EXECUTE');
END $$;
ROLLBACK;
