const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const uid='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',pid='00000000-0000-4000-8000-000000000011';
const request=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,proof='a'.repeat(64);
async function fixture(){
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to public;create table player_profiles(id uuid primary key,linked_auth_user_id uuid,is_active boolean not null default true);grant select on player_profiles to authenticated,anon;`);
 await db.query('insert into player_profiles values($1,$2,true)',[pid,uid]);await db.exec(fs.readFileSync('supabase/migrations/0048_private_profile_media.sql','utf8'));
 await db.query("insert into profile_media_private.settings values(true,sha256(convert_to($1,'UTF8')))",[proof]);
 await db.exec(fs.readFileSync('supabase/maintenance/profile-media/02_verify.sql','utf8'));
 const as=async(actor=uid,role='authenticated')=>{await db.exec(`reset role;set role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor??'']);};
 const call=async(name,args=[])=>{const row=(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args)).rows[0];return row?.value;};
 const ticket=()=>call('profile_media_attempt');
 const prepare=async(n=100,version=0,kind='upload')=>call('prepare_profile_image',[pid,request(n),version,kind,await ticket(),kind==='upload'?'0'.repeat(64):null]);
 const commit=n=>call('commit_profile_image',[pid,request(n),proof]);
 return {db,as,call,ticket,prepare,commit};
}

module.exports={fixture,uid,other,pid,request,proof};
