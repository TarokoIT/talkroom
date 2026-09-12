BEGIN;
CREATE TABLE IF NOT EXISTS talkroom_private.metered_account (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), domain text NOT NULL, secret text NOT NULL
);
ALTER TABLE talkroom_private.metered_account ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON talkroom_private.metered_account FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA talkroom_private TO service_role;
GRANT SELECT ON talkroom_private.metered_account TO service_role;
CREATE OR REPLACE FUNCTION public.talkroom_metered_account()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT jsonb_build_object('domain',domain,'secret',secret) FROM talkroom_private.metered_account WHERE id; $$;
REVOKE ALL ON FUNCTION public.talkroom_metered_account() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.talkroom_metered_account() TO service_role;
COMMIT;
