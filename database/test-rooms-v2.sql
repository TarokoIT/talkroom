-- Transactional acceptance checks. All fixture data and hashes roll back.
BEGIN;
DO $$
DECLARE
 u1 uuid:=gen_random_uuid(); u2 uuid:=gen_random_uuid(); u3 uuid:=gen_random_uuid();
 a jsonb; b jsonb; c jsonb; l jsonb; ctl jsonb; t jsonb; r jsonb; n int;
BEGIN
 INSERT INTO talkroom_private.rooms(code,title,password_hash)
 VALUES('QA_A','Test A',extensions.crypt('TestPass1234',extensions.gen_salt('bf',4))),
 ('QA_B','Test B',extensions.crypt('TestPass1234',extensions.gen_salt('bf',4)));
 UPDATE talkroom_private.rooms SET password_hash=extensions.crypt('ListenPass1234',extensions.gen_salt('bf',4)),
 controller_hash=extensions.crypt('ControlPass1234',extensions.gen_salt('bf',4)) WHERE code='BROADCAST';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u1,'role','authenticated')::text,true);
 r:=public.talkroom_api('join',null,jsonb_build_object('room','QA_A','role','member','username','A','peer_id','qa-peer-A','password','wrongpassword'));
 ASSERT NOT (r->>'ok')::boolean,'wrong password accepted';
 a:=public.talkroom_api('join',null,jsonb_build_object('room','QA_A','role','member','username','A','peer_id','qa-peer-A','password','TestPass1234'));
 ASSERT (a->>'ok')::boolean,'join A';
 PERFORM public.talkroom_api('message',(a->>'session_id')::uuid,'{"message":"room A only"}');
 PERFORM public.talkroom_api('sync',(a->>'session_id')::uuid,'{"mic":true}');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u2,'role','authenticated')::text,true);
 b:=public.talkroom_api('join',null,jsonb_build_object('room','QA_B','role','member','username','B','peer_id','qa-peer-B','password','TestPass1234'));
 ASSERT (b->>'ok')::boolean,'join B';
 r:=public.talkroom_api('sync',(b->>'session_id')::uuid,'{}');
 ASSERT jsonb_array_length(r->'messages')=0,'cross room messages leaked';
 ASSERT jsonb_array_length(r->'peers')=1,'cross room peers leaked';
 BEGIN
  PERFORM public.talkroom_api('sync',(a->>'session_id')::uuid,'{}');
  RAISE EXCEPTION 'spoofed session accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 c:=public.talkroom_api('join',null,jsonb_build_object('room','QA_A','role','member','username','C','peer_id','qa-peer-C','password','TestPass1234'));
 ASSERT (c->>'ok')::boolean,'join C';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u1,'role','authenticated')::text,true);
 BEGIN
  PERFORM public.talkroom_api('ticket',(a->>'session_id')::uuid,jsonb_build_object('recipient',b->>'session_id'));
  RAISE EXCEPTION 'cross room voice allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 t:=public.talkroom_api('ticket',(a->>'session_id')::uuid,jsonb_build_object('recipient',c->>'session_id'));
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u2,'role','authenticated')::text,true);
 r:=public.talkroom_api('accept',(c->>'session_id')::uuid,jsonb_build_object('ticket',t->>'ticket','peer_id','qa-peer-A'));
 ASSERT (r->>'ok')::boolean,'valid call denied';
 BEGIN
  PERFORM public.talkroom_api('accept',(c->>'session_id')::uuid,jsonb_build_object('ticket',t->>'ticket','peer_id','qa-peer-A'));
  RAISE EXCEPTION 'replayed ticket allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 r:=public.talkroom_api('join',null,jsonb_build_object('room','BROADCAST','role','controller','username','fake','peer_id','qa-fake-ctrl','password','ListenPass1234'));
 ASSERT NOT (r->>'ok')::boolean,'listener password can control';
 l:=public.talkroom_api('join',null,jsonb_build_object('room','BROADCAST','role','listener','username','speaker','peer_id','qa-listener','password','ListenPass1234'));
 ASSERT (l->>'ok')::boolean,'listener login';
 r:=public.talkroom_api('sync',(l->>'session_id')::uuid,'{"mic":true}');
 ASSERT NOT (SELECT mic FROM talkroom_private.sessions WHERE id=(l->>'session_id')::uuid),'listener can turn on mic';
 BEGIN
  PERFORM public.talkroom_api('message',(l->>'session_id')::uuid,'{"message":"forbidden"}');
  RAISE EXCEPTION 'listener sent message';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.talkroom_api('ticket',(l->>'session_id')::uuid,jsonb_build_object('recipient',a->>'session_id'));
  RAISE EXCEPTION 'listener can send voice';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u3,'role','authenticated')::text,true);
 ctl:=public.talkroom_api('join',null,jsonb_build_object('room','BROADCAST','role','controller','username','controller','peer_id','qa-controller','password','ControlPass1234'));
 ASSERT (ctl->>'ok')::boolean,'controller login';
 r:=public.talkroom_api('join',null,jsonb_build_object('room','BROADCAST','role','controller','username','controller2','peer_id','qa-controller2','password','ControlPass1234'));
 ASSERT NOT (r->>'ok')::boolean,'second controller accepted';
 PERFORM public.talkroom_api('sync',(ctl->>'session_id')::uuid,'{"mic":true}');
 t:=public.talkroom_api('ticket',(ctl->>'session_id')::uuid,jsonb_build_object('recipient',l->>'session_id'));
 BEGIN
  PERFORM public.talkroom_api('ticket',(ctl->>'session_id')::uuid,jsonb_build_object('recipient',a->>'session_id'));
  RAISE EXCEPTION 'broadcast escaped its room';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u2,'role','authenticated')::text,true);
 r:=public.talkroom_api('accept',(l->>'session_id')::uuid,jsonb_build_object('ticket',t->>'ticket','peer_id','qa-controller'));
 ASSERT (r->>'ok')::boolean,'broadcast ticket denied';
 INSERT INTO talkroom_private.sessions(user_id,room,username,peer_id,role)
 SELECT gen_random_uuid(),'QA_B','capacity','qa-capacity-'||g,'member' FROM generate_series(1,14) g;
 r:=public.talkroom_api('join',null,jsonb_build_object('room','QA_B','role','member','username','overflow','peer_id','qa-overflow','password','TestPass1234'));
 ASSERT NOT (r->>'ok')::boolean,'16th member accepted';
 PERFORM public.talkroom_api('leave',(c->>'session_id')::uuid,'{}');
 BEGIN
  PERFORM public.talkroom_api('sync',(c->>'session_id')::uuid,'{}');
  RAISE EXCEPTION 'left session accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 ASSERT NOT has_table_privilege('authenticated','talkroom_private.messages','SELECT'),'private table readable';
 ASSERT NOT has_function_privilege('anon','public.talkroom_api(text,uuid,jsonb)','EXECUTE'),'unauthenticated API callable';
END $$;
ROLLBACK;
SELECT 'Room isolation, ownership, password, capacity, broadcast and ticket checks passed; fixtures rolled back' AS result;
