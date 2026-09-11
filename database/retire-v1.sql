-- Applied after v2 deployment was verified. Fully reversible via GRANT.
-- Preserve v1 records, table definitions and every existing RLS policy.
BEGIN;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.chat_messages,public.users_online,public.user_activity_log FROM anon,authenticated;
COMMIT;
