const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { PGlite } = require("@electric-sql/pglite");
const root = "supabase/maintenance/event-member-controls/member-share";
const apply = fs.readFileSync(root + "/apply.sql", "utf8");
const rollback = fs.readFileSync(root + "/rollback.sql", "utf8");
const legacy = apply.split("$expected$")[1];
const uuid = n => "00000000-0000-4000-8000-" + String(n).padStart(12,"0");
test("isolated PostgreSQL: only current friendly members get sharing access", async () => {
 const db = new PGlite();
 const u=uuid(1),other=uuid(2),retired=uuid(3),admin=uuid(4),stale=uuid(5),club=uuid(10),disabled=uuid(11),outside=uuid(12),e=uuid(20),active=uuid(21),team=uuid(22),deleted=uuid(23),inactive=uuid(24),manual=uuid(25),personal=uuid(26);
 const q = (sql, args=[])=>db.query(sql,args);
 const actor=async(id,role="authenticated")=>{await db.exec("RESET ROLE; SET ROLE "+role);await q("SELECT set_config('request.jwt.claim.sub',$1,false)",[id||""]);};
 const share=(id,token="newtoken")=>q("UPDATE public.events SET share_enabled=true,share_token=$2,share_token_updated_at=now() WHERE id=$1 RETURNING id,share_token",[id,token]);
 const deny=async(fn)=>{try { const result=await fn(); assert.equal(result.rows.length,0); } catch (err) { if(err.code!=="42501")throw err; }};
 try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   GRANT USAGE ON SCHEMA auth TO PUBLIC;
   CREATE TABLE public.clubs(id uuid PRIMARY KEY,is_active boolean,is_deleted boolean);
   CREATE TABLE public.player_profiles(id uuid PRIMARY KEY,linked_auth_user_id uuid,is_active boolean);
   CREATE TABLE public.club_members(id uuid PRIMARY KEY,club_id uuid,profile_id uuid,player_profile_id uuid,role text,is_active boolean,status text);
   CREATE TABLE public.events(id uuid PRIMARY KEY,club_id uuid,event_mode text,status text,is_deleted boolean,created_by_auth_user_id uuid,name text,court_count int,stats_mode text,closed_at timestamptz,updated_at timestamptz,share_enabled boolean DEFAULT false,share_token text,share_token_updated_at timestamptz);
   CREATE SCHEMA events_operation_private;
   CREATE FUNCTION public.is_super_user() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
   CREATE FUNCTION public.can_manage_friendly_team_event_by_sides(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
   CREATE FUNCTION public.get_my_club_memberships() RETURNS TABLE(id uuid,club_id uuid,role text,is_active boolean,status text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    SELECT cm.id,cm.club_id,cm.role,cm.is_active,cm.status FROM public.club_members cm LEFT JOIN public.player_profiles pp ON pp.id=cm.player_profile_id WHERE (pp.is_active AND pp.linked_auth_user_id=auth.uid()) OR (cm.profile_id=auth.uid() AND (cm.player_profile_id IS NULL OR (pp.is_active AND pp.linked_auth_user_id=auth.uid()))) $$;
   GRANT SELECT ON public.club_members,public.player_profiles,public.clubs,public.events TO authenticated;
   GRANT UPDATE ON public.events TO authenticated;
   ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
   CREATE POLICY event_read ON public.events FOR SELECT TO authenticated USING (true);
   CREATE POLICY event_write ON public.events FOR UPDATE TO authenticated USING ((club_id IS NULL AND created_by_auth_user_id=auth.uid()) OR EXISTS (SELECT 1 FROM public.club_members cm LEFT JOIN public.player_profiles pp ON pp.id=cm.player_profile_id WHERE cm.club_id=events.club_id AND cm.is_active AND (cm.profile_id=auth.uid() OR pp.linked_auth_user_id=auth.uid()) AND (cm.role IN ('main_admin','sub_admin') OR (events.event_mode IN ('auto','manual') AND NOT coalesce(events.is_deleted,false))))) WITH CHECK ((club_id IS NULL AND created_by_auth_user_id=auth.uid()) OR EXISTS (SELECT 1 FROM public.club_members cm LEFT JOIN public.player_profiles pp ON pp.id=cm.player_profile_id WHERE cm.club_id=events.club_id AND cm.is_active AND (cm.profile_id=auth.uid() OR pp.linked_auth_user_id=auth.uid()) AND (cm.role IN ('main_admin','sub_admin') OR (events.event_mode IN ('auto','manual') AND NOT coalesce(events.is_deleted,false)))));
   `);
  await db.exec(legacy+"; CREATE TRIGGER guard_event_member_fields BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION events_operation_private.guard_member_fields();");
  for(const [id,on] of [[club,true],[disabled,false],[outside,true]])await q("INSERT INTO public.clubs VALUES($1,$2,false)",[id,on]);
  await q("INSERT INTO public.player_profiles VALUES($1,$2,true)",[uuid(30),u]);
  await q("INSERT INTO public.player_profiles VALUES($1,$2,true)",[uuid(31),other]);
  for(const row of [[uuid(40),club,null,uuid(30),"member",true],[uuid(41),club,retired,null,"member",false],[uuid(42),club,admin,null,"main_admin",true],[uuid(43),outside,other,null,"member",true],[uuid(44),disabled,u,null,"member",true],[uuid(45),club,stale,uuid(31),"member",true]])await q("INSERT INTO public.club_members VALUES($1,$2,$3,$4,$5,$6,'regular')",row);
  for(const [id,c,mode,status,del] of [[e,club,"auto","closed",false],[active,club,"auto","active",false],[team,club,"team","closed",false],[deleted,club,"auto","closed",true],[inactive,disabled,"auto","closed",false],[manual,club,"manual","closed",false],[personal,null,"auto","closed",false]])await q("INSERT INTO public.events(id,club_id,event_mode,status,is_deleted,created_by_auth_user_id,name,court_count) VALUES($1,$2,$3,$4,$5,$6,'event',2)",[id,c,mode,status,del,admin]);
  await actor(u);await deny(()=>share(e));await db.exec("RESET ROLE");
  await db.exec(apply);
  await actor(u);
  assert.equal((await share(e,"first_token")).rows[0].share_token,"first_token");
  assert.equal((await share(e,"second_token")).rows[0].share_token,"second_token");
  assert.equal((await q("UPDATE public.events SET share_enabled=false,share_token=NULL,share_token_updated_at=now() WHERE id=$1 RETURNING share_enabled",[e])).rows[0].share_enabled,false);
  assert.equal((await share(manual)).rows.length,1);
  assert.equal((await q("UPDATE public.events SET name='normal',status='closed' WHERE id=$1 RETURNING name",[active])).rows[0].name,"normal");
  await q("UPDATE public.events SET status='active' WHERE id=$1",[active]);
  for(const id of [active,team,deleted,inactive])await deny(()=>share(id));
  await deny(()=>share(e,"invalid/token"));
  await deny(()=>q("UPDATE public.events SET share_enabled=true,share_token='x',share_token_updated_at=now(),name='combined' WHERE id=$1 RETURNING id",[e]));
  await deny(()=>q("UPDATE public.events SET is_deleted=true WHERE id=$1 RETURNING id",[e]));
  for(const id of [retired,stale]){await actor(id);await deny(()=>share(e));}
  await actor(other);await deny(()=>share(inactive));
  await actor(null,"anon");await deny(()=>share(e));
  await actor(admin);assert.equal((await share(e,"admin_token")).rows.length,1);assert.equal((await share(personal)).rows.length,1);
  await db.exec("RESET ROLE");await db.exec(rollback);
  await actor(u);await deny(()=>share(e,"rollback_denied"));
 }finally{await db.close();}
});
test("UI only expands the normal share flag and checks returned row",()=>{
 const app=fs.readFileSync("app/events/[id]/page.tsx","utf8");
 assert.match(app,/allowManageShare = allowManageShare \|\| roles\.has\("main_admin"\) \|\| roles\.has\("sub_admin"\) \|\| \(roles\.has\("member"\) && \["auto", "manual"\]/);
 assert.match(app,/allowManageEventVideos = allowManageEventVideos \|\| roles\.has\("main_admin"\) \|\| roles\.has\("sub_admin"\);/);
 assert.equal((app.match(/\.eq\("status", "closed"\)\.eq\("is_deleted", false\)\.select\("id"\)\.maybeSingle\(\)/g)||[]).length,2);
});
