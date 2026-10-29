const {test}=require('node:test');
const assert=require('node:assert/strict');
const {database,fixture,handler}=require('./fixtures/stats-helpers.cjs');
const {fetchBalancePastStats}=require('../lib/friendly-balance-history.ts');
const rounds=require('./fixtures/friendly-round-helpers.cjs');
const {readFriendlyRoundRows}=require('../lib/friendly-round-history.ts');

function historyFixture(options={}){
 const current={id:'today',club_id:'club',created_at:'2026-10-30T00:00:00Z'};
 const tables={events:[],club_members:[],player_profiles:[],event_participants:[],matches:[],match_players:[],match_results:[],app_admins:[]};
 for(let i=1;i<=4;i++){
  tables.player_profiles.push({id:`canonical-${i}`,linked_auth_user_id:i===1?'auth':null,is_active:true});
  tables.club_members.push({id:`membership-${i}`,club_id:'club',player_profile_id:`canonical-${i}`,is_active:i!==4});
 }
 const specs=[['past',{}],['manual',{event_mode:'manual'}],['other',{club_id:'other-club'}],['future',{created_at:'2026-11-01T00:00:00Z'}],['same-time',{created_at:current.created_at}],['deleted',{is_deleted:true}],['record',{stats_mode:'record_only'}],['undecided',{stats_mode:'undecided'}],['active',{status:'active'}],['team',{event_mode:'team'}],['today',{created_at:'2026-10-01T00:00:00Z'}]];
 for(const [id,extra]of specs){
  tables.events.push({id,name:id,club_id:'club',created_at:'2026-10-01T00:00:00Z',status:'closed',is_deleted:false,stats_mode:'official',event_mode:'auto',...extra});
  for(let i=1;i<=4;i++)tables.event_participants.push({id:`${id}-p${i}`,event_id:id,player_profile_id:`canonical-${i}`,participant_type:'member'});
 }
 function match(id,event,extra={}){
  tables.matches.push({id,event_id:event,created_at:'2026-10-02T00:00:00Z',completed:true,...extra});
  for(let i=1;i<=4;i++)tables.match_players.push({id:`${id}-slot${i}`,match_id:id,participant_id:`${event}-p${i}`,team:i<=2?'A':'B'});
  tables.match_results.push({id:`${id}-score`,match_id:id,score_a:4,score_b:0});
 }
 for(const[id]of specs)match(`${id}-match`,id);
 Object.assign(tables.match_results.find(r=>r.match_id==='manual-match'),{score_a:0,score_b:0});
 match('after-start','past',{created_at:'2026-11-01T00:00:00Z'});
 const participants=[{id:'new-event-id',player_profile_id:'canonical-1',participant_type:'member'}, {id:'no-history',player_profile_id:'no-prior-profile',participant_type:'member'}, {id:'guest-same-name',player_profile_id:'canonical-2',participant_type:'guest'}, {id:'legacy-only',profile_id:'canonical-1',player_profile_id:null,participant_type:'member'}];
 const db=database(tables,options);
 db.s.auth.getUser=async()=>({data:{user:{id:'auth'}},error:null});
 return{...db,current,participants,match};
}

test('同一グループの過去の正式通常戦績だけを永続選手IDで読み、ゲスト混在条件と0-0を維持する',async()=>{
 const f=historyFixture(),before=JSON.stringify(f.tables);
 const stats=await fetchBalancePastStats(f.s,f.current,f.participants);
 assert.deepEqual([...stats],[['new-event-id',{wins:1,draws:1,played:2,diff:4}]]);
 assert.equal(JSON.stringify(f.tables),before);assert(f.calls.every(c=>c.method==='GET'));
 const events=f.calls.find(c=>c.table==='events');
 for(const[key,value]of Object.entries({club_id:'eq.club',status:'eq.closed',is_deleted:'eq.false',stats_mode:'eq.official',created_at:`lt.${f.current.created_at}`,id:'neq.today',event_mode:'in.(auto,manual)'}))assert.equal(events.url.searchParams.get(key),value);
 for(const c of f.calls.filter(c=>['event_participants','matches'].includes(c.table)))assert.equal(c.url.searchParams.get('event_id'),'in.(manual,past)');
 assert(f.calls.filter(c=>c.table==='player_profiles').every(c=>c.url.searchParams.get('select')==='id'));
 const g=historyFixture();g.tables.event_participants.find(p=>p.id==='past-p4').participant_type='guest';
 assert.deepEqual([...await fetchBalancePastStats(g.s,g.current,g.participants)],[['new-event-id',{wins:0,draws:1,played:1,diff:0}]]);
});

test('未確定・不正得点・不成立・別イベントの参加者を混ぜた試合を評価に含めない',async()=>{
 for(const alter of [
  f=>f.tables.matches.find(m=>m.id==='past-match').completed=false,
  f=>f.tables.match_results.find(r=>r.match_id==='past-match').score_a=-1,
  f=>f.tables.match_results.find(r=>r.match_id==='past-match').score_a=1.5,
  f=>f.tables.match_results=f.tables.match_results.filter(r=>r.match_id!=='past-match'),
  f=>f.tables.match_players=f.tables.match_players.filter(p=>p.id!=='past-match-slot4'),
  f=>f.tables.match_players.find(p=>p.id==='past-match-slot4').participant_id='past-p1',
  f=>f.tables.match_players.find(p=>p.id==='past-match-slot4').participant_id='manual-p4'
 ]){
  const f=historyFixture();alter(f);const stats=await fetchBalancePastStats(f.s,f.current,f.participants);
  assert.deepEqual(stats.get('new-event-id'),{wins:0,draws:1,played:1,diff:0});
 }
 const f=historyFixture();f.tables.match_results.push({id:'duplicate',match_id:'past-match',score_a:0,score_b:0});
 await assert.rejects(fetchBalancePastStats(f.s,f.current,f.participants),/過去戦績を取得できません/);
 const same=historyFixture();same.tables.match_results.push({id:'duplicate',match_id:'past-match',score_a:4,score_b:0});
 assert.deepEqual((await fetchBalancePastStats(same.s,same.current,same.participants)).get('new-event-id'),{wins:1,draws:1,played:2,diff:4});
});

test('履歴なしと取得失敗を区別し、権限・通信・途中ページのエラーで部分評価を返さない',async()=>{
 const empty=historyFixture();empty.tables.events=[];
 assert.equal((await fetchBalancePastStats(empty.s,empty.current,empty.participants)).size,0);
 for(const table of ['app_admins','player_profiles','club_members','events','event_participants','matches']){
  const f=historyFixture({fail:c=>c.table===table});
  await assert.rejects(fetchBalancePastStats(f.s,f.current,f.participants),/過去戦績を取得できません/);
  assert(f.calls.every(c=>c.method==='GET'));
 }
 const f=historyFixture({fail:c=>c.table==='matches'&&c.url.searchParams.get('offset')==='500'});
 for(let i=0;i<1001;i++)f.match(`large-${i}`,'past');
 await assert.rejects(fetchBalancePastStats(f.s,f.current,f.participants),/過去戦績を取得できません/);
 assert(f.calls.some(c=>c.table==='matches'&&c.url.searchParams.get('offset')==='500'));
});

test('一般メンバーとsuper_user・旧所属は既存権限で読み、未ログイン・無関係なグループは履歴を読まない',async()=>{
 for(const role of ['member','super_user','legacy']){
  const f=historyFixture();
  if(role==='super_user'){f.tables.club_members[0].is_active=false;f.tables.app_admins.push({id:'admin',profile_id:'auth',is_active:true});}
  if(role==='legacy'){f.tables.club_members[0].profile_id='auth';f.tables.player_profiles[0].linked_auth_user_id=null;}
  assert.equal((await fetchBalancePastStats(f.s,f.current,f.participants)).size,1);
 }
 for(const kind of ['anonymous','inactive','foreign','auth-error']){
  const f=historyFixture();
  if(kind==='anonymous')f.s.auth.getUser=async()=>({data:{user:null},error:null});
  if(kind==='auth-error')f.s.auth.getUser=async()=>({data:{user:null},error:new Error('拒否')});
  if(kind==='inactive')f.tables.club_members[0].is_active=false;
  if(kind==='foreign')f.tables.club_members[0].club_id='different';
  await assert.rejects(fetchBalancePastStats(f.s,f.current,f.participants),/過去戦績を取得できません/);
  assert(!f.calls.some(c=>['events','event_participants','matches'].includes(c.table)));
 }
 const f=historyFixture();await fetchBalancePastStats(f.s,{...f.current,club_id:null},f.participants);await fetchBalancePastStats(f.s,f.current,f.participants.filter(p=>p.participant_type==='guest'));assert.equal(f.calls.length,0);
});

test('過去戦績取得に失敗したバランスペアはRoundを保存せず、通常とライバルは追加取得しない',async()=>{
 for(const mode of ['normal','balance','rival']){
  const f=fixture();Object.assign(f.tables.events[0],{status:'active',event_mode:'auto',court_count:1});f.tables.event_participants.forEach(p=>p.status='active');for(let i=0;i<10;i++)f.addMatch('event-a',[0,1,2,3],4,2);
  const db=database(f.tables,{fail:c=>c.table==='events'&&c.url.searchParams.get('status')==='eq.closed'}),errors=[];
  db.s.auth.getUser=async()=>({data:{user:{id:'auth-a'}},error:null});
  await handler('app/events/[id]/page.tsx','generateRound',{
   getSupabaseClient:()=>db.s,eventId:'event-a',eventMode:'auto',eventStatus:'active',guestMode:false,isGeneratingRound:false,roundUserId:'auth-a',selectedRoundMode:mode,latestRoundNumber:1,
   readFriendlyRoundRows,scoredFriendlyMatches:rounds.scoredFriendlyMatches,FRIENDLY_MODE_UNLOCK_MATCHES:10,generateFriendlyRound:rounds.generateFriendlyRound,
   fetchActiveClubMemberParticipants:async()=>[0,1,2,3].map(i=>({playerProfileId:`player-${i}`})),setError:v=>{if(v)errors.push(v)},setIsGeneratingRound:()=>{},setEventStatus:()=>{},setIsDeletedEvent:()=>{},loadAll:async()=>{},
   setRoundModeSelection:()=>{throw Error('モードの自動変更は禁止')}
  })();
  if(mode==='balance'){assert(errors.some(e=>e.includes('過去戦績')));assert(!db.calls.some(c=>c.method==='POST'));}
  else{assert.deepEqual(errors,[]);assert(db.calls.some(c=>c.table==='rounds'&&c.method==='POST'));assert(!db.calls.some(c=>c.table==='events'&&c.url.searchParams.has('status')));}
 }
});
