const {test}=require('node:test');
const assert=require('node:assert/strict');
const {canAutoCreateCard}=require('../lib/score-input.ts');
const {handler}=require('./fixtures/stats-helpers.cjs');

test('新規カードの選手が未設定・一部だけ・空白なら自動登録せず、全員設定済みなら自動保存できる',()=>{
  for(const values of [[],['','','',''],['登録選手','','',''],['A','B','C',' '],['A','B',null,undefined]]) assert.equal(canAutoCreateCard(values),false);
  assert.equal(canAutoCreateCard(['profile-a','profile-b','ゲストC','ゲストD']),true);
  assert.equal(canAutoCreateCard(['ゲストA','ゲストB','対戦相手1','対戦相手2']),true);
});

test('未設定カードを手動保存できる既存の検証条件は変更しない',()=>{
  const team={a1ProfileId:'',a2ProfileId:'',b1ProfileId:'',b2ProfileId:'',a1GuestName:'',a2GuestName:'',b1GuestName:'',b2GuestName:'',aScore:'0',bScore:'0',result:'draw',youtubeUrl:''};
  const official={our1ProfileId:'',our2ProfileId:'',our1GuestName:'',our2GuestName:'',opponent1Name:'',opponent2Name:'',ourScore:'0',opponentScore:'0',result:'draw',youtubeUrl:''};
  const validateTeam=handler('app/team-matches/[id]/page.tsx','validate',{isYoutubeUrl:()=>true});
  const validateOfficial=handler('app/official-matches/[id]/page.tsx','validateMatchForm',{isYoutubeUrl:()=>true});
  assert.equal(validateTeam(team),'');assert.equal(validateOfficial(official),'');
  assert.match(validateTeam({...team,a1GuestName:'同名',a2GuestName:'同名'}),/同一試合/);
  assert.match(validateOfficial({...official,our1GuestName:'同名',our2GuestName:'同名'}),/重複/);
});
