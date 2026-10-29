const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, handler, pageSource, legacySource, database, fixture, groupStats, profileStats, readStatsRows, readStatsRowsByIds, fetchCountedFriendlyEvents } = require('./fixtures/stats-helpers.cjs');
const groupPage = 'app/groups/[id]/page.tsx';
const eventPage = 'app/events/[id]/page.tsx';
const { buildOfficialStats } = require('../lib/official-matches.ts');
const clone = value => structuredClone(value);

function eventActions(db, extra = {}) {
  const state = { loads:0, routes:[], errors:[], edits:{} };
  const viewMatches = db.tables.matches.map(m=>({ ...m, players:db.tables.match_players.filter(p=>p.match_id===m.id), result:db.tables.match_results.find(r=>r.match_id===m.id), round_number:1 }));
  const bindings = {
    getSupabaseClient:()=>db.s, eventId:'event-a', eventMode:'auto', eventStatus:'closed', statsMode:'official', closeStatsMode:'official', guestMode:false, canDeleteEvent:true,
    matches:viewMatches, scoreInputs:{}, getWinnerTeam:(a,b)=>a>b?'A':a<b?'B':'draw',
    setError:v=>state.errors.push(v), setMessage:v=>state.message=v, setShowCloseModal:v=>state.closeModal=v,
    setEditingMatchIds:fn=>state.edits=fn(state.edits), loadAll:async()=>{state.loads++}, router:{push:v=>state.routes.push(v)},
    ...extra,
  };
  return { state, run:(name,...args)=>handler(eventPage,name,bindings)(...args) };
}

test('有効な同一履歴の個人・グループ・ペアの結果が改修前コードと完全一致する', async () => {
  for (let seed=0; seed<30; seed++) {
    const f=fixture();
    for (let i=0;i<20;i++) f.addMatch(i%2?'event-a':'event-b',[0,1,2,3],(seed*3+i)%5,(seed+i*2)%5);
    const db=database(f.tables);
    assert.deepEqual(await profileStats(db.s), await profileStats(db.s, ['player-0'], true));
    const current=await groupStats(db.s), before=await groupStats(db.s,true);
    assert.deepEqual(current,before);
    for (const mode of ['総合ランキング','勝率ランキング']) {
      const b={individualRows:current.individual,individualMode:mode};
      assert.deepEqual(handler(groupPage,'rankedIndividuals',b)(),evaluate(legacySource(),'rankedIndividuals',b)());
    }
    assert(db.calls.every(c=>c.method==='GET'));
  }
});

test('個人は複数グループとゲスト混在を含め、4人が所属する試合だけをグループ・ペアに反映する', async () => {
  const {tables}=fixture();
  const db=database(tables);
  const p=await profileStats(db.s);
  assert.deepEqual(p,{matches:8,wins:3,winRate:37.5,avgScored:15/8,avgConceded:16/8});
  const g=await groupStats(db.s);
  const owner=g.individual.find(r=>r.playerId==='player-0');
  assert.deepEqual([owner.matches,owner.wins,owner.losses,owner.draws],[5,1,2,2]);
  const pair=g.pairs.find(r=>r.playerIds.join('|')==='player-0|player-1');
  assert.deepEqual([pair.matches,pair.wins,pair.losses,pair.draws,pair.matchPoints],[3,1,1,1,4]);
  assert(!g.individual.some(r=>r.playerId==='player-4'));
  assert(!g.pairs.some(r=>r.playerIds.includes('player-4')));
  assert(g.pairs.some(r=>r.playerIds.join('|')==='player-1|player-2')); // 退会者の対戦側は保持
  assert(tables.event_participants.some(p=>p.participant_type==='guest'));
  assert.equal(tables.matches.length,9);
});

test('70/20/10の正規化は退会者を含む元データで行い、参考記録と全同点条件の並びを維持する', async () => {
  const {tables}=fixture();
  const rows=await groupStats(database(tables).s);
  const owner=rows.individual.find(r=>r.playerId==='player-0');
  assert.equal(owner.totalPoint,34); // 勝率20*0.7 + 試合数100*0.2 + 正の得失点差0*0.1
  assert.equal(owner.isReference,false);
  tables.events.find(e=>e.id==='event-a').is_deleted=true;
  const few=await groupStats(database(tables).s);
  assert(few.individual.every(r=>r.matches===1&&r.isReference));
  const seed={totalPoint:50,matchPoints:4,rate:50,wins:1,draws:1,diff:0,matches:3,scored:4};
  const individualRows=[{...seed,name:'同点先'},{...seed,name:'同点後'},...Object.keys(seed).map((key,i)=>({...seed,name:key,[key]:seed[key]+1}))];
  for (const individualMode of ['総合ランキング','勝率ランキング']) {
    const bindings={individualRows,individualMode};
    assert.deepEqual(handler(groupPage,'rankedIndividuals',bindings)(),evaluate(legacySource(),'rankedIndividuals',bindings)());
  }
});

test('イベントAの論理削除はBと他グループの戦績を残し、試合・スコア・参加者・プロフィールを変更しない', async () => {
  const {tables}=fixture(), before=clone(tables), db=database(tables);
  const action=eventActions(db);
  await action.run('deleteEvent');
  assert.equal(tables.events[0].is_deleted,true);
  assert.deepEqual(action.state.routes,['/home']);
  assert.deepEqual(action.state.errors,[]);
  const write=db.calls.filter(c=>c.method!=='GET');
  assert.deepEqual(write.map(c=>[c.table,c.method]),[['events','PATCH']]);
  assert.deepEqual(Object.keys(write[0].body).sort(),['deleted_at','is_deleted']);
  for(const table of Object.keys(before).filter(t=>t!=='events')) assert.deepEqual(tables[table],before[table]);
  const g=await groupStats(db.s);
  assert.deepEqual(g.events.map(e=>e.id),['event-b']);
  assert(g.individual.every(r=>r.matches===1));
  const p=await profileStats(db.s);
  assert.deepEqual(p,{matches:2,wins:1,winRate:50,avgScored:2.5,avgConceded:2});
  assert.equal((await fetchCountedFriendlyEvents(db.s,{clubId:'club-b'})).length,1);
  assert.equal(db.calls.some(c=>c.method==='DELETE'),false);
  // 復元UIは追加しない。保存済み履歴だけで元の値を再現可能。
  tables.events[0].is_deleted=false;
  assert.deepEqual(await profileStats(db.s),await profileStats(database(before).s));
});

test('終了・再開・記録のみ・削除・未確定は既存の対象条件どおり切り替わる', async () => {
  const {tables}=fixture(), db=database(tables), action=eventActions(db);
  const original=await profileStats(db.s);
  await action.run('reopenEvent');
  assert.equal(tables.events[0].status,'active');
  assert.equal((await profileStats(db.s)).matches,2);
  await action.run('closeEvent');
  assert.deepEqual(await profileStats(db.s),original);
  const manual=eventActions(db,{eventMode:'manual',closeStatsMode:'record_only'});
  await manual.run('closeEvent');
  assert.equal(tables.events[0].stats_mode,'record_only');
  assert.equal((await profileStats(db.s)).matches,2);
  assert.deepEqual((await groupStats(db.s)).events.map(e=>e.id),['event-b']);
  await manual.run('reopenEvent');
  assert.equal(tables.events[0].stats_mode,'undecided');
  // 未入力・不正数値は確定フラグだけでは戦績に入れない。
  tables.events[0].status='closed';tables.events[0].stats_mode='official';
  tables.match_results.find(r=>r.match_id==='match-0000').score_a=null;
  assert.equal((await profileStats(db.s)).matches,original.matches-1);
});

test('スコアの再保存・修正・引き分けで累計加算せず、最新履歴を1度だけ再計算する', async () => {
  const {tables}=fixture(), db=database(tables);
  const before=clone(tables.player_stats);
  const action=eventActions(db,{scoreInputs:{'match-0000':{a:0,b:4}}});
  await action.run('saveScore','match-0000');
  await action.run('saveScore','match-0000');
  assert.deepEqual(action.state.errors,[]);
  const p=await profileStats(db.s);
  assert.equal(p.matches,8);assert.equal(p.wins,2);
  assert.equal(p.avgScored,11/8);assert.equal(p.avgConceded,19/8);
  assert.deepEqual(tables.player_stats,before);
  assert(!db.calls.some(c=>c.table==='player_stats'));
  assert.equal(tables.match_results.filter(r=>r.match_id==='match-0000').length,1);
  const draw=eventActions(db,{scoreInputs:{'match-0000':{a:0,b:0}}});
  await draw.run('saveScore','match-0000');
  assert.equal(tables.match_results.find(r=>r.match_id==='match-0000').winner_team,'draw');
  assert.equal((await profileStats(db.s)).matches,8);
  assert.equal((await groupStats(db.s)).individual.find(r=>r.playerId==='player-0').draws,3);
});

test('初回スコアの登録も履歴だけを書き込み、未完了から完了へ移す', async () => {
  const {tables}=fixture();
  tables.matches.find(m=>m.id==='match-0006').completed=false;
  tables.match_results=tables.match_results.filter(r=>r.match_id!=='match-0006');
  const db=database(tables), action=eventActions(db,{scoreInputs:{'match-0006':{a:4,b:2}}});
  await action.run('saveScore','match-0006');
  assert.deepEqual(action.state.errors,[]);
  assert.equal(tables.matches.find(m=>m.id==='match-0006').completed,true);
  assert.equal((await profileStats(db.s)).matches,9);
  assert.deepEqual(db.calls.filter(c=>c.method!=='GET').map(c=>c.table),['match_results','matches']);
});

test('試合単体の削除後はその履歴だけを除外し、選手・所属・旧累計値を保つ', async () => {
  const {tables}=fixture(), db=database(tables), before=clone(tables);
  let cancelled=false;
  const action=eventActions(db,{
    eventStatus:'active',matchDeleteTarget:{id:'match-0000'},
    deleteEmptyRoundAndRenumber:async()=>true, cancelMatchDelete:()=>{cancelled=true},setScoreInputs:()=>{},
  });
  await action.run('deleteMatch');
  assert(cancelled);
  assert.equal((await profileStats(db.s)).matches,7);
  assert(!tables.matches.some(m=>m.id==='match-0000'));
  assert(!tables.match_results.some(m=>m.match_id==='match-0000'));
  assert(!tables.match_players.some(m=>m.match_id==='match-0000'));
  for (const t of ['player_profiles','profiles','club_members','event_participants','player_stats']) assert.deepEqual(tables[t],before[t]);
  assert(!db.calls.some(c=>c.table==='player_stats'));
});

test('同一選手の旧ID・新IDの参加記録が重なっても個人の同一試合を二重計上しない', async () => {
  const {tables}=fixture();
  const original=await profileStats(database(tables).s);
  tables.event_participants.push({id:'alias',event_id:'event-a',player_profile_id:'old-player',profile_id:'auth-a',participant_type:'member'});
  tables.match_players.push({id:'alias-mp',match_id:'match-0000',participant_id:'alias',team:'A'});
  assert.deepEqual(await profileStats(database(tables).s,['player-0','old-player']),original);
});

test('500件のページングと100件のID分割に対応し、重複IDと空IDでは余分に取得しない', async () => {
  const rows=Array.from({length:1001},(_,id)=>({id})), calls=[];
  assert.deepEqual(await readStatsRows(async(start,end)=>{calls.push([start,end]);return {data:rows.slice(start,end+1),error:null}}),rows);
  assert.deepEqual(calls,[[0,499],[500,999],[1000,1499]]);
  const ids=Array.from({length:205},(_,i)=>`id-${i}`), batches=[];
  await readStatsRowsByIds([...ids,...ids],async(ids)=>{batches.push(ids);return {data:[],error:null}});
  assert.deepEqual(batches.map(b=>b.length),[100,100,5]);
  assert.deepEqual(await readStatsRowsByIds([],()=>{throw Error('空IDでの要求は禁止')}),[]);
});

test('1000試合以上・100イベント以上でも全履歴を取得し、旧上限による欠落を解消する', async () => {
  const f=fixture();
  for(let i=0;i<1005;i++) f.addMatch('event-a',[0,1,2,3],4,2);
  for(let i=0;i<101;i++) f.tables.events.push({...f.tables.events[0],id:`empty-event-${i}`});
  const db=database(f.tables), g=await groupStats(db.s), p=await profileStats(db.s);
  assert.equal(g.individual.find(r=>r.playerId==='player-0').matches,1010);
  assert.equal(p.matches,1013);
  assert.equal(g.events.length,103);
  assert(db.calls.some(c=>c.table==='matches'&&Number(c.url.searchParams.get('offset'))>=1000));
  assert(db.calls.every(c=>c.url.searchParams.get('event_id')?.split(',').length<=100||!c.url.searchParams.has('event_id')));
});

test('取得失敗と空履歴を区別し、グループの古い戦績は残さない', async () => {
  for(const table of ['events','club_members','event_participants','player_profiles','matches']) {
    const {tables}=fixture(), db=database(tables,{fail:c=>c.table===table});
    const state=await groupStats(db.s,false,{individual:['古い値'],pairs:['古い値'],events:['古い値']});
    assert.match(state.error,/取得できません/);
    assert.deepEqual(state.individual,[]);assert.deepEqual(state.pairs,[]);assert.deepEqual(state.events,[]);
    assert(db.calls.every(c=>c.method==='GET'));
  }
  const {tables}=fixture();
  await assert.rejects(profileStats(database(tables,{fail:c=>c.table==='events'}).s),/確認できません/);
  await assert.rejects(readStatsRows(async()=>({data:null,error:null})),/確認できません/);
});

test('スコア更新拒否・確定失敗・0行更新・イベント更新拒否では成功扱いしない', async () => {
  for(const name of ['saveScore','closeEvent','reopenEvent','deleteEvent']) {
    const {tables}=fixture(), before=clone(tables), db=database(tables,{fail:c=>c.method!=='GET'});
    const action=eventActions(db,{scoreInputs:{'match-0000':{a:4,b:2}}});
    await action.run(name,'match-0000');
    assert.equal(action.state.errors.length,1);assert.equal(action.state.loads,0);assert.deepEqual(action.state.routes,[]);
    assert.deepEqual(tables,before);
  }
  const f=fixture(), db=database(f.tables,{fail:c=>c.table==='matches'&&c.method==='PATCH'});
  const action=eventActions(db,{scoreInputs:{'match-0000':{a:4,b:2}}});
  await action.run('saveScore','match-0000');
  assert.match(action.state.errors[0],/確定に失敗/);assert.equal(action.state.loads,0);
  const zero=eventActions(db,{eventId:'not-found'});
  await zero.run('deleteEvent');assert.match(zero.state.errors[0],/削除に失敗/);
});

test('チーム戦・公式戦の論理削除は履歴に触れず、失敗時は画面遷移しない', async () => {
  for(const [page,table,bindings] of [
    ['app/team-matches/[id]/page.tsx','events',{event:{id:'event-a'},id:'event-a',deleteOk:true,canManage:true}],
    ['app/official-matches/[id]/page.tsx','official_events',{id:'event-a',deleteEventChecked:true,canManageShare:true}],
  ]) for(const failed of [false,true]) {
    const {tables}=fixture();tables.official_events=[{id:'event-a',is_deleted:false}];
    tables.event_team_matches=[{id:'team-match',event_id:'event-a',team_a_score:4,team_b_score:1}];
    tables.official_matches=[{id:'official-match',official_event_id:'event-a',result:'win'}];
    const before=clone(tables), db=database(tables,{fail:c=>failed&&c.method==='PATCH'}), routes=[],errors=[];
    await handler(page,'deleteEvent',{...bindings,getSupabaseClient:()=>db.s,setError:v=>errors.push(v),setNotice:()=>{},router:{push:v=>routes.push(v)}})();
    assert.equal(tables[table][0].is_deleted,!failed);
    assert.equal(routes.length,failed?0:1);assert.equal(errors.filter(Boolean).length,failed?1:0);
    for(const t of Object.keys(tables).filter(t=>t!==table)) assert.deepEqual(tables[t],before[t]);
    assert.deepEqual(db.calls.map(c=>[c.table,c.method]),[[table,'PATCH']]);
  }
});

test('フレンドリーチーム戦の集計区分・計算・0-0扱いと順序は改修前のまま', () => {
  const page='app/team-matches/[id]/page.tsx';
  const memberName=(side,id,guest)=>id||guest||'名称未設定';
  const matches=[
    {team_a_score:4,team_b_score:1,result:'win'},
    {team_a_score:2,team_b_score:2,result:'draw'},
    {team_a_score:0,team_b_score:0,result:'draw'},
    {team_a_score:null,team_b_score:null,result:'undecided'},
  ].map(m=>({...m,team_a_player1_profile_id:'a',team_a_player2_guest_name:'ゲスト',team_b_player1_profile_id:'b',team_b_player2_profile_id:'c'}));
  function calc(legacy) {
    const b={teamAName:'チームA',teamBName:'チームB',memberName,matches};
    for(const n of ['emptyStatsRow','applyStatsResult','sortStatsRows','hasCountableTeamScore']) b[n]=legacy?evaluate(legacySource(),n):handler(page,n);
    return legacy?evaluate(legacySource(),'teamMatchStats',b)():handler(page,'teamMatchStats',b)();
  }
  const result=calc(false);
  assert.deepEqual(result,calc(true));assert.equal(result.countedMatches,2);
  assert.equal(result.players.length,4);assert.equal(result.pairs.length,2);
});

test('オフィシャル戦は独立した結果ベースの集計と相手別・選手別・ペア別順序を維持する', () => {
  const matches=['win','lose','draw','undecided'].map(result=>({result,official_opponent_id:'opp',our_player1_profile_id:'a',our_player2_profile_id:null,our_player1_guest_name:null,our_player2_guest_name:'ゲスト'}));
  const stats=buildOfficialStats({eventTitle:'公式',groupName:'所属',opponents:[{id:'opp',opponent_team_name:'対戦相手'}],matches,memberName:(id,guest)=>id||guest});
  assert.equal(stats.countedMatches,3);
  for(const row of [stats.summary,...stats.opponents,...stats.players,...stats.pairs]) assert.deepEqual([row.matches,row.wins,row.losses,row.draws,row.winRate],[3,1,1,1,33.3]);
});
