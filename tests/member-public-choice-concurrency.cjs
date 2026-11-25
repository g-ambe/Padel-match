// Explicit disposable PostgreSQL only. No production/Stage URL accepted.
const assert=require('node:assert/strict');
const url=process.env.MEMBER_PUBLIC_TEST_DB_URL;
if(!url)throw Error('Set MEMBER_PUBLIC_TEST_DB_URL to an empty disposable local database');
const target=new URL(url);if(target.hostname!=='127.0.0.1'||target.pathname!=='/member_public_review')throw Error('Disposable local DB required');
const {Client}=require('pg');
const {memberPublicDatabase}=require('./fixtures/member-public-choice-db.cjs');
(async()=>{
 const c=new Client({connectionString:url}),a=new Client({connectionString:url}),b=new Client({connectionString:url});
 await c.connect();await a.connect();await b.connect();
 try{
 const fixture=await memberPublicDatabase(true,{exec:sql=>c.query(sql),query:(sql,args)=>c.query(sql,args),close:async()=>{}}),id=fixture.id;
 const row=(await c.query('select * from club_members where club_id=$1 and player_profile_id=$2',[id(600),id(103)])).rows[0];
 await c.query("update clubs set visibility='public' where id=$1",[id(600)]);
 for(const client of [a,b])await client.query(`set role authenticated;select set_config('request.jwt.claim.sub','${id(3)}',false)`);
 await a.query('begin');const args=[id(600),row.id,'name','先行した名前',null,row.club_display_name,null,false,'public'];
 await a.query('select save_club_member_field_v2($1,$2,$3,$4,$5,$6,$7,$8,$9)',args);
 const stale=b.query('select save_club_member_field_v2($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id(600),row.id,'public',null,false,row.club_display_name,null,false,'public']).then(()=>({code:'unexpected_success'}),e=>({code:e.code}));
 // Observe the second session actually waiting on the first transaction, rather than a timing guess.
 for(let n=0;;n++){const wait=(await c.query('select wait_event_type from pg_stat_activity where pid=$1',[b.processID])).rows[0];if(wait?.wait_event_type==='Lock')break;if(n>100)throw Error('second session did not wait');await new Promise(r=>setTimeout(r,20));}
 await a.query('commit');assert.equal((await stale).code,'PT409');
 assert.equal((await c.query('select club_display_name from club_members where id=$1',[row.id])).rows[0].club_display_name,'先行した名前');
 console.log('PostgreSQL actual concurrent CAS: second request waited, then PT409; first result preserved PASS');
 // Independently reproduce the candidate's DDL-before-global-lock order. No candidate source changed.
 await a.query('reset role;begin;select profile_link_private.serialize_operations()');
 await b.query('reset role;begin;alter table club_members add column isolated_lock_order_probe text');
 const global=b.query('select profile_link_private.serialize_operations()').then(()=>({code:'ok'}),e=>({code:e.code}));
 for(let n=0;;n++){if((await c.query('select wait_event_type from pg_stat_activity where pid=$1',[b.processID])).rows[0]?.wait_event_type==='Lock')break;if(n>100)throw Error('lock order reproduction did not wait');await new Promise(r=>setTimeout(r,20));}
 const reader=a.query('select id from club_members limit 1').then(()=>({code:'ok'}),e=>({code:e.code}));
 const first=await Promise.race([global.then(r=>({session:'b',...r})),reader.then(r=>({session:'a',...r}))]);
 assert.equal(first.code,'40P01');await(first.session==='a'?a:b).query('rollback');await Promise.all([global,reader]);await a.query('rollback');await b.query('rollback');
 assert.equal((await c.query("select count(*)::int n from information_schema.columns where table_name='club_members' and column_name='isolated_lock_order_probe'")).rows[0].n,0);
 console.log('Candidate DDL/global-lock order: deadlock 40P01 reproduced; rolled back with no leftover column. REVIEW FINDING, not a release PASS.');
 }finally{await Promise.all([a.end(),b.end(),c.end()]);}
})().catch(e=>{console.error(e.message);process.exitCode=1});
