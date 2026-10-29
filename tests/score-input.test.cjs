const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scoreInputError } = require('../lib/score-input.ts');
const { readRoundMode, rememberRoundMode } = require('../lib/friendly-round-mode-selection.ts');
const { handler } = require('./fixtures/stats-helpers.cjs');

const restoreWindow = (run, storage = new Map()) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable:true, value:{ sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)} } });
  try { run(storage); } finally { if(previous) Object.defineProperty(globalThis,'window',previous);else delete globalThis.window; }
};

test('スコアの選択範囲を上限にせず、空欄・0・引き分け・大きな得点を保持する',()=>{
  for(const kind of ['number','non-negative-integer']) for(const value of [{a:'',b:''},{a:'0',b:'0'},{a:'4',b:'4'},{a:'123',b:'1000'},{a:'',b:'6'}]) assert.equal(scoreInputError(value,kind),'');
});

test('通常とチーム・公式の既存の入力条件を区別し、不正な数値は決定させない',()=>{
  for(const raw of ['文字','NaN','Infinity','1.2.3']) assert.match(scoreInputError({a:raw,b:'1'},'number'),/数値/);
  for(const raw of ['-1','1.5']) {
    assert.equal(scoreInputError({a:raw,b:'1'},'number'),''); // 通常の既存type=numberに新たな最小値や整数制限を加えない
    assert.match(scoreInputError({a:'1',b:raw},'non-negative-integer'),/0以上の整数/);
  }
  // チーム・公式の保存時の検証関数も、従来どおり0以上の整数を検証する。
  const validate=handler('app/team-matches/[id]/page.tsx','validate');
  const form={a1ProfileId:'',a2ProfileId:'',b1ProfileId:'',b2ProfileId:'',a1GuestName:'',a2GuestName:'',b1GuestName:'',b2GuestName:'',aScore:'-1',bScore:'0',youtubeUrl:''};
  assert.match(validate(form),/0以上の整数/);
});

test('各モードの選択はイベント・ユーザー単位で保持し、新規イベント・別アカウントには引き継がない',()=>restoreWindow(()=>{
  assert.equal(readRoundMode('user-a','event-a'),'normal');
  for(const mode of ['normal','balance','rival']) {
    rememberRoundMode('user-a','event-a',mode);
    assert.equal(readRoundMode('user-a','event-a'),mode);
    assert.equal(readRoundMode('user-a','event-b'),'normal');
    assert.equal(readRoundMode('user-b','event-a'),'normal');
  }
  rememberRoundMode('user-a','event-b','balance');
  assert.equal(readRoundMode('user-a','event-a'),'rival');
  assert.equal(readRoundMode('user-a','event-b'),'balance');
}));

test('保存なし・不正な保存値・Storage利用不可・ログイン前でも初期モードで安全に動作する',()=>{
  restoreWindow(storage=>{
    rememberRoundMode('u','e','balance');
    const key=[...storage.keys()][0];
    storage.set(key,'unknown');assert.equal(readRoundMode('u','e'),'normal');
    rememberRoundMode('u','e','unknown');assert.equal(storage.get(key),'unknown');
    rememberRoundMode('','e','rival');assert.equal(readRoundMode('','e'),'normal');
    window.sessionStorage={getItem(){throw Error('拒否')},setItem(){throw Error('容量超過')}};
    assert.equal(readRoundMode('u','e'),'normal');assert.doesNotThrow(()=>rememberRoundMode('u','e','rival'));
  });
  assert.equal(readRoundMode('u','e'),'normal');assert.doesNotThrow(()=>rememberRoundMode('u','e','rival'));
});

test('実際のRound生成処理が選択中の各モードを生成器へ渡し、成功後もモードを書き換えない',async()=>{
  const {database,fixture}=require('./fixtures/stats-helpers.cjs');
  const rounds=require('./fixtures/friendly-round-helpers.cjs');
  const {readFriendlyRoundRows}=require('../lib/friendly-round-history.ts');
  for(const mode of ['normal','balance','rival']) {
    const f=fixture();f.tables.events[0].status='active';f.tables.events[0].court_count=1;f.tables.events[0].club_id=null;
    f.tables.event_participants.forEach(p=>p.status='active');
    for(let i=0;i<10;i++)f.addMatch('event-a',[0,1,2,3],4,2);
    const db=database(f.tables),errors=[],modes=[];
    let loads=0;
    await handler('app/events/[id]/page.tsx','generateRound',{
      getSupabaseClient:()=>db.s,eventId:'event-a',eventMode:'auto',eventStatus:'active',guestMode:false,isGeneratingRound:false,roundUserId:'auth-a',selectedRoundMode:mode,latestRoundNumber:1,
      readFriendlyRoundRows,scoredFriendlyMatches:rounds.scoredFriendlyMatches,FRIENDLY_MODE_UNLOCK_MATCHES:10,
      generateFriendlyRound:params=>{modes.push(params.mode);return rounds.generateFriendlyRound(params)},
      setError:v=>{if(v)errors.push(v)},setIsGeneratingRound:()=>{},setEventStatus:()=>{},setIsDeletedEvent:()=>{},loadAll:async()=>{loads++},
      setRoundModeSelection:()=>{throw Error('ユーザー操作以外のモード変更は禁止')},
    })();
    assert.deepEqual(errors,[]);assert.deepEqual(modes,[mode]);assert.equal(loads,1);
    assert(db.calls.some(c=>c.table==='matches'&&c.method==='POST'));
  }
});
