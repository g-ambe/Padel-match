// H62-2: actual Auth/PostgREST using only H56/H58 synthetic fixtures.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {createClient}=require('@supabase/supabase-js');
require('node:module').registerHooks({resolve(s,c,next){return next(['./player-profiles','./group-read','./permissions'].includes(s)?s+'.ts':s,c)}});
const {addMissingClubMembersToEvent}=require('../../lib/event-participants.ts');
const {url,key,actors,ids}=JSON.parse(fs.readFileSync(0,'utf8'));
let phase='setup',checks=0,httpStatus=null;
const mark=()=>checks++;
const localFetch=(input,init)=>{
 assert.equal(new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url).origin,url);
 return fetch(input,{...init,redirect:'error'});
};
const client=()=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:localFetch}});
async function ok(query){
 const r=await query;httpStatus=r.status??null;assert(!r.error);return r.data;
}
async function raw(db,club,cols='*'){
 return ok(db.from('club_members').select(cols).eq('club_id',club));
}
async function denied(query){
 const r=await query;httpStatus=r.status;assert(r.error&&[400,401,403].includes(r.status));
}
async function main(){
 assert.equal(url,'http://127.0.0.1:54321');assert.equal(actors.length,3);
 const db={};
 phase='auth';
 for(const a of actors){
  const c=client(),r=await c.auth.signInWithPassword({email:a.email,password:a.password});
  assert(!r.error&&r.data.user.id===a.uid&&r.data.session.access_token);db[a.role]=c;
 }
 const {owner,recipient,outsider}=db,anon=client();mark();
 phase='direct_nonmember';
 for(const id of [ids.public,ids.private]){
  assert.deepEqual(await raw(outsider,id),[]);
  assert.deepEqual(await raw(outsider,id,'id,role,profile_id,player_profile_id,club_display_name,club_display_name_public_confirmed_at'),[]);
  const count=await outsider.from('club_members').select('id',{head:true,count:'exact'}).eq('club_id',id);
  httpStatus=count.status;assert(!count.error&&count.count===0);
 }
 await denied(anon.from('club_members').select('id').limit(1));mark();
 phase='embedded';
 const emb=await ok(outsider.from('clubs').select('id,club_members(id,role,club_display_name)').eq('id',ids.public).single());
 assert.equal(emb.id,ids.public);assert.deepEqual(emb.club_members,[]);
 const hidden=await ok(outsider.from('clubs').select('id').eq('id',ids.private));assert.deepEqual(hidden,[]);mark();
 phase='public_rpc';
 const d=await ok(outsider.rpc('get_public_club_directory',{p_club_id:ids.public}));
 assert(d.some(x=>x.display_name==='H56 public chosen')&&d.every(x=>Object.keys(x).sort().join(',')==='display_name,is_unlinked,reference'));
 assert.equal(await ok(outsider.rpc('get_public_club_member_count',{p_club_id:ids.public})),3);
 await denied(outsider.rpc('get_club_roster',{p_club_id:ids.private}));mark();
 phase='member_reads';
 const mine=await raw(recipient,ids.private);
 assert(mine.some(x=>x.player_profile_id===ids.recipient_profile&&x.club_display_name==='H56 private chosen'&&x.club_display_name_public_confirmed_at===null));
 assert(mine.some(x=>x.player_profile_id===ids.owner_profile));
 assert.deepEqual(await raw(recipient,ids.join),[]);
 assert((await raw(outsider,ids.join)).some(x=>x.player_profile_id===ids.owner_profile));
 assert((await raw(owner,ids.public)).some(x=>x.id===ids.legacy_member));mark();
 phase='visibility_flip';
 const flip=await ok(owner.from('clubs').update({visibility:'public'}).eq('id',ids.private).select('id,visibility').single());
 assert.equal(flip.visibility,'public');
 assert.deepEqual(await raw(outsider,ids.private),[]);
 const after=await ok(outsider.rpc('get_public_club_directory',{p_club_id:ids.private}));
 assert(!after.some(x=>x.display_name==='H56 private chosen'));
 assert.equal(await ok(outsider.rpc('get_public_club_member_count',{p_club_id:ids.private})),2);
 assert((await raw(recipient,ids.private)).some(x=>x.club_display_name==='H56 private chosen'));
 const back=await ok(owner.from('clubs').update({visibility:'private'}).eq('id',ids.private).select('visibility').single());assert.equal(back.visibility,'private');mark();
 phase='manager_returning';
 const toggled=await ok(owner.from('club_members').update({is_active:false}).eq('id',ids.legacy_member).select('id,club_id,player_profile_id,role,is_active').single());
 assert.equal(toggled.id,ids.legacy_member);assert.equal(toggled.is_active,false);
 const restored=await ok(owner.from('club_members').update({is_active:true}).eq('id',ids.legacy_member).select('id,is_active').single());assert.equal(restored.is_active,true);
 const outsiderUpdate=await outsider.from('club_members').update({is_active:false}).eq('id',ids.legacy_member).select('id');
 assert(outsiderUpdate.error||outsiderUpdate.data.length===0);
 assert((await raw(owner,ids.public)).find(x=>x.id===ids.legacy_member).is_active===true);mark();
 phase='new_club';
 const club=await ok(outsider.from('clubs').insert({name:'H62 synthetic new club',description:null,owner_id:ids.outsider,is_active:true,visibility:'private'}).select('id').single());
 await ok(outsider.from('club_members').insert({club_id:club.id,profile_id:ids.outsider,player_profile_id:ids.outsider_profile,role:'main_admin',is_active:true}));
 assert((await raw(outsider,club.id)).some(x=>x.role==='main_admin'));
 assert.deepEqual(await raw(owner,club.id),[]);mark();
 phase='normal_event';
 const ev=await ok(owner.from('events').insert({name:'H62 synthetic event',court_count:1,category:'club',club_id:ids.public,event_mode:'manual',stats_mode:'undecided',created_by_auth_user_id:ids.owner}).select('id').single());
 const added=await addMissingClubMembersToEvent(owner,ev.id,ids.public);
 assert(added.insertedCount===3);
 const parts=await ok(recipient.from('event_participants').select('id,player_profile_id').eq('event_id',ev.id));
 assert(parts.length===3&&parts.some(x=>x.player_profile_id===ids.recipient_profile));
 const renamed=await ok(recipient.from('events').update({name:'H62 synthetic renamed'}).eq('id',ev.id).select('id,name').single());
 assert.equal(renamed.name,'H62 synthetic renamed');
 const deniedRename=await outsider.from('events').update({name:'H62 forbidden'}).eq('id',ev.id).select('id');
 assert(deniedRename.error||deniedRename.data.length===0);
 const saved=await ok(owner.from('events').select('name').eq('id',ev.id).single());assert.equal(saved.name,'H62 synthetic renamed');mark();
 phase='official_member';
 const official=await ok(recipient.from('official_events').select('id').eq('club_id',ids.public));
 assert(official.length===1);
 const results=await ok(recipient.from('official_matches').select('our_score,opponent_score').eq('official_event_id',official[0].id));
 assert(results.length===1&&results[0].our_score===4&&results[0].opponent_score===2);mark();
 phase='withdraw';
 const own=await raw(recipient,ids.private);
 const membership=own.find(x=>x.player_profile_id===ids.recipient_profile);
 assert(membership&&membership.is_active);
 assert.equal(await ok(recipient.rpc('leave_my_club',{p_club_id:ids.private,p_member_id:membership.id})),membership.id);
 const remaining=await raw(recipient,ids.private);
 assert(remaining.length===1&&remaining[0].id===membership.id&&!remaining[0].is_active);
 await denied(recipient.rpc('get_club_roster',{p_club_id:ids.private}));
 assert((await raw(owner,ids.private)).some(x=>x.id===membership.id&&!x.is_active));mark();
 return {ok:true,checks};
}
main().then(r=>console.log(JSON.stringify(r))).catch(e=>console.log(JSON.stringify({ok:false,phase,checks,httpStatus,errorKind:e?.name==='AssertionError'?'assertion':'other'})));
