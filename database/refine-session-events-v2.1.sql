CREATE OR REPLACE FUNCTION talkroom_private.session_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE kind text; at_time timestamptz:=clock_timestamp(); sid uuid; room_code text; display_name text;
BEGIN
 IF TG_OP='INSERT' THEN kind:='登入';
 ELSIF TG_OP='DELETE' THEN
  IF OLD.expires_at<=now() OR OLD.offline_logged THEN RETURN OLD; END IF;
  kind:='登出';
 ELSE
  IF OLD.expires_at>now() AND NEW.expires_at<=now() THEN kind:='管理員撤銷登入';
  ELSIF NOT OLD.offline_logged AND NEW.offline_logged THEN
   IF EXISTS(SELECT 1 FROM talkroom_private.activity_events WHERE session_id=OLD.id AND event='管理員撤銷登入') THEN RETURN NEW; END IF;
   kind:=CASE WHEN OLD.expires_at<=OLD.last_seen+interval '60 seconds' THEN '登入到期' ELSE '逾時離線（推估）' END;
   at_time:=least(OLD.expires_at,OLD.last_seen+interval '60 seconds');
  ELSIF OLD.offline_logged AND NOT NEW.offline_logged THEN kind:='重新連線';
  ELSE RETURN NEW; END IF;
 END IF;
 IF TG_OP='DELETE' THEN sid:=OLD.id;room_code:=OLD.room;display_name:=OLD.username;
 ELSE sid:=NEW.id;room_code:=NEW.room;display_name:=NEW.username; END IF;
 INSERT INTO talkroom_private.activity_events(session_id,room,username,event,created_at)
 VALUES(sid,room_code,display_name,kind,at_time);
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;

CREATE INDEX activity_session_event ON talkroom_private.activity_events(session_id,event);
