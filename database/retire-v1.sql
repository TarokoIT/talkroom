-- Apply with the v2 deployment. Preserve v1 records but block legacy clients.
BEGIN;
REVOKE ALL ON public.chat_messages,public.users_online,public.user_activity_log FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_offline_users() FROM PUBLIC,anon,authenticated;
DO $$
DECLARE p record;
BEGIN
 FOR p IN SELECT schemaname,tablename,policyname FROM pg_policies
  WHERE schemaname='public' AND tablename IN ('chat_messages','users_online','user_activity_log')
 LOOP
  EXECUTE format('DROP POLICY %I ON %I.%I',p.policyname,p.schemaname,p.tablename);
 END LOOP;
END $$;
CREATE POLICY archived_no_client_access ON public.chat_messages FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);
CREATE POLICY archived_no_client_access ON public.users_online FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);
CREATE POLICY archived_no_client_access ON public.user_activity_log FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);
COMMIT;
