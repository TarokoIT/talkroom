BEGIN;
DO $$
DECLARE admin_id uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); joined jsonb; result jsonb;
BEGIN
 INSERT INTO talkroom_private.rooms(code,title,password_hash)
 VALUES('QA_ADMIN','Before',extensions.crypt('BeforePass1234',extensions.gen_salt('bf',4)));
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated','email','qa-admin@example.invalid')::text,true);
 BEGIN
  PERFORM public.talkroom_admin('list');
  RAISE EXCEPTION 'unauthorized administrator accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 INSERT INTO talkroom_private.admin_emails(email) VALUES('qa-admin@example.invalid');
 INSERT INTO auth.users(id,email,is_anonymous) VALUES(admin_id,'qa-admin@example.invalid',false);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
 BEGIN
  PERFORM public.talkroom_admin('list');
  RAISE EXCEPTION 'unverified email accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE auth.users SET email_confirmed_at=now() WHERE id=admin_id;
 result:=public.talkroom_admin('list');ASSERT (result->>'ok')::boolean;
 joined:=public.talkroom_api('join',null,'{"room":"QA_ADMIN","role":"member","username":"QA","peer_id":"qa-admin-peer","password":"BeforePass1234"}');
 ASSERT (joined->>'ok')::boolean;
 result:=public.talkroom_admin('update','{"room":"QA_ADMIN","title":"Borrowed room","password":"AfterPass1234"}');
 ASSERT (result->>'revoked')::int=1,'password rotation did not revoke session';
 BEGIN
  PERFORM public.talkroom_api('sync',(joined->>'session_id')::uuid,'{}');
  RAISE EXCEPTION 'revoked session accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 result:=public.talkroom_api('join',null,'{"room":"QA_ADMIN","role":"member","username":"QA","peer_id":"qa-admin-peer2","password":"BeforePass1234"}');
 ASSERT NOT (result->>'ok')::boolean,'old password still accepted';
 result:=public.talkroom_api('join',null,'{"room":"QA_ADMIN","role":"member","username":"QA","peer_id":"qa-admin-peer3","password":"AfterPass1234"}');
 ASSERT (result->>'ok')::boolean,'new password rejected';
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(public.talkroom_catalog()) r WHERE r->>'code'='QA_ADMIN' AND r->>'title'='Borrowed room' AND (r->>'online')::int=1),'catalog name/count not updated';
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.talkroom_catalog()) r WHERE r ? 'password_hash' OR r ? 'peer_id' OR r ? 'username'),'catalog exposes private fields';
 result:=public.talkroom_admin('revoke','{"room":"QA_ADMIN"}');
 ASSERT (result->>'revoked')::int=1;
 ASSERT (SELECT count(*) FROM talkroom_private.admin_audit WHERE room='QA_ADMIN')=2;
END $$;
ROLLBACK;
SELECT 'Admin authorization, verified email, name/count, password rotation and revocation checks passed; fixtures rolled back' AS result;
