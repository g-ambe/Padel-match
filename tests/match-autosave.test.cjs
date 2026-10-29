const {test}=require('node:test');
const assert=require('node:assert/strict');
const {handler,database,fixture}=require('./fixtures/stats-helpers.cjs');
function normal(db) {
  const state={errors:[]};
  const b={getSupabaseClient:()=>db.s,eventId:'event-a',eventStatus:'active',guestMode:false,scoreInputs:{},scoreSaveState:{current:{saving:new Set(),resultIds:new Map()}},
    matches:db.tables.matches.map(m=>({...m,result:db.tables.match_results.find(r=>r.match_id===m.id)})),getWinnerTeam:(a,b)=>a>b?'A':a<b?'B':'draw',
    setMatches:fn=>b.matches=fn(b.matches),setScoreInputs:fn=>b.scoreInputs=fn(b.scoreInputs),setError:v=>state.errors.push(v),setMessage:()=>{},loadAll:async()=>{}};
  return {b,state,save:(id,scores)=>handler('app/events/[id]/page.tsx','saveScore',b)(id,scores)};
}

test('保存中の連打は同じスコアを二重送信せず、応答前は確定表示を更新しない',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  const db=database(fixture().tables,{fail:async c=>{if(c.table==='match_results'&&c.method==='PATCH')await gate;return false}}),a=normal(db);
  const original=structuredClone(a.b.matches[0]);
  const first=a.save('match-0000',{a:'0',b:'4'});
  assert.equal(await a.save('match-0000',{a:'0',b:'4'}),false);
  assert.deepEqual(a.b.matches[0],original);release();assert.equal(await first,true);
  assert.equal(db.calls.filter(c=>c.table==='match_results'&&c.method==='PATCH').length,1);
  assert.equal(a.b.matches[0].result.winner_team,'B');assert(!db.calls.some(c=>c.table==='player_stats'));
});

test('初回の確定失敗後も元の表示を保ち、再試行で結果行を増やさない',async()=>{
  const {tables}=fixture();tables.match_results=tables.match_results.filter(r=>r.match_id!=='match-0006');
  let fail=true;const db=database(tables,{fail:c=>fail&&c.table==='matches'&&c.method==='PATCH'}),a=normal(db);
  const before=structuredClone(a.b.matches.find(m=>m.id==='match-0006'));
  assert.equal(await a.save('match-0006',{a:'0',b:'0'}),false);
  assert.deepEqual(a.b.matches.find(m=>m.id==='match-0006'),before);
  fail=false;assert.equal(await a.save('match-0006',{a:'0',b:'0'}),true);
  assert.equal(tables.match_results.filter(r=>r.match_id==='match-0006').length,1);
  assert.equal(db.calls.filter(c=>c.table==='match_results'&&c.method==='POST').length,1);
  assert.equal(a.b.matches.find(m=>m.id==='match-0006').result.winner_team,'draw');
});

function loseResponse(db, table) {
  const fetch=db.s.rest.fetch;let lost=false;
  db.s.rest.fetch=async(input,init)=>{const result=await fetch(input,init);if(!lost&&String(input).includes('/'+table+'?')&&init.method==='POST'){lost=true;return new Response(JSON.stringify({message:'応答受信失敗'}),{status:400})}return result};
}

test('初回スコアの保存応答が失われても、履歴を再確認して同じ結果行へ保存する',async()=>{
  const {tables}=fixture();tables.match_results=tables.match_results.filter(r=>r.match_id!=='match-0006');
  const db=database(tables);loseResponse(db,'match_results');const a=normal(db);
  assert.equal(await a.save('match-0006',{a:'4',b:'2'}),false);
  assert.equal(await a.save('match-0006',{a:'4',b:'2'}),true);
  assert.equal(tables.match_results.filter(r=>r.match_id==='match-0006').length,1);
});

test('チーム・公式の新規カードは保存応答喪失後も同じIDで再試行し、カードを増殖させない',async()=>{
  for(const kind of ['team','official']) {
    const table=kind==='team'?'event_team_matches':'official_matches',tables={[table]:[]},db=database(tables);loseResponse(db,table);
    const file=kind==='team'?'app/team-matches/[id]/page.tsx':'app/official-matches/[id]/page.tsx';
    const b={id:'event',event:{status:'active'},canManage:true,canEdit:true,editingId:null,matches:[],cardWrites:{current:{saving:new Set(),newIds:new Map()}},
      emptyForm:()=>({}),getSupabaseClient:()=>db.s,setError:()=>{},setNotice:()=>{},setForm:()=>{},setShowForm:()=>{},setEditingId:()=>{},setEditingForm:()=>{},setMatches:fn=>b.matches=fn(b.matches),load:async()=>{},opponentMatches:()=>[]};
    let values,save;
    if(kind==='team') {
      values={a1ProfileId:'',a2ProfileId:'',b1ProfileId:'',b2ProfileId:'',a1GuestName:'A',a2GuestName:'B',b1GuestName:'C',b2GuestName:'D',aScore:'4',bScore:'0',result:'win',scoreDetail:'詳細',memo:'保管',youtubeUrl:'https://youtu.be/keep'};
      b.validate=handler(file,'validate',{isYoutubeUrl:()=>true});b.payload=handler(file,'payload');
      save=()=>handler(file,'saveMatch',b)(false,values);
    }else{
      values={our1ProfileId:'',our2ProfileId:'',our1GuestName:'A',our2GuestName:'B',opponent1Name:'C',opponent2Name:'D',ourScore:'4',opponentScore:'0',result:'win',scoreDetail:'詳細',memo:'保管',youtubeUrl:'https://youtu.be/keep'};
      b.validateMatchForm=handler(file,'validateMatchForm',{isYoutubeUrl:()=>true});b.matchPayload=handler(file,'matchPayload');
      save=()=>handler(file,'saveOfficialCard',b)(values,undefined,'opponent');
    }
    assert.equal(await save(),false);assert.equal(b.matches.length,0);assert.equal(tables[table].length,1);
    assert.equal(await save(),true);assert.equal(tables[table].length,1);assert.equal(b.matches.length,1);
    assert.equal(tables[table][0].youtube_url,'https://youtu.be/keep');assert.equal(tables[table][0].memo,'保管');
  }
});
