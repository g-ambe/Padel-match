const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixedPairDatabase,id}=require('./fixtures/fixed-pair-db.cjs');

test('既存DB構成には原子的な編集RPCがなく、固定利用後の直接書込みを迂回しない',async()=>{
 const f=await fixedPairDatabase();
 try{
  const e=await f.event(910,8,{courts:2});await f.as(3);
  await f.rpc('replace_event_fixed_pairs',[e.eid,0,JSON.stringify([{id:id(930),a:e.participants[0],b:e.participants[1]}]),id(931)]);
  await f.rpc('create_fixed_pair_round',[e.eid,1,0,2,'normal',e.participants,JSON.stringify([{court:1,teamA:e.participants.slice(0,2),teamB:e.participants.slice(2,4)},{court:2,teamA:e.participants.slice(4,6),teamB:e.participants.slice(6,8)}]),id(932)]);
  const before=(await f.db.query('select id,match_id,participant_id,team from public.match_players order by id')).rows;
  assert.equal(before.length,8);
  await assert.rejects(f.db.query('update public.match_players set participant_id=$1 where id=$2',[e.participants[4],before[0].id]),/変更できません/);
  await assert.rejects(f.db.query("update public.match_players set team=case when team='A' then 'B' else 'A' end where id=$1",[before[0].id]),/専用/);
  assert.deepEqual((await f.db.query('select id,match_id,participant_id,team from public.match_players order by id')).rows,before);
  const functions=(await f.db.query("select proname from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public' and (proname like '%lineup%' or proname like '%swap%' or proname like '%edit%round%')")).rows;
  assert.deepEqual(functions,[]);
  // 既存の削除→再登録を流用しない理由。実際の権限で失敗し、明示ROLLBACKだけが全行を戻す。
  await f.db.exec('begin');
  await f.db.query('delete from public.match_players where match_id=$1',[before[0].match_id]);
  await assert.rejects(f.db.query('insert into public.match_players(match_id,participant_id,team) values($1,$2,$3)',[before[0].match_id,before[0].participant_id,before[0].team]),/専用/);
  await f.db.exec('rollback');
  assert.deepEqual((await f.db.query('select id,match_id,participant_id,team from public.match_players order by id')).rows,before);
 }finally{await f.db.close();}
});
