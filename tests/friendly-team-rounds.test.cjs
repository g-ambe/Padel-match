const {test}=require('node:test'),assert=require('node:assert/strict');
const {seededRandom}=require('./fixtures/friendly-round-helpers.cjs');
const {generateTeamRound,teamCardPlayers}=require('../lib/friendly-team-rounds.ts');
const person=(n,source)=>({key:'profile:'+n,profile_id:String(n),guest_id:null,member_id:'m'+n,source,name:'選手'+n});
const context=(a,b)=>({revision:'test',court_count:5,roster:[...Array.from({length:a},(_,i)=>person(i,'team_a')),...Array.from({length:b},(_,i)=>person(100+i,'team_b'))],rounds:[],matches:[]});
function record(c,d){const n=c.rounds.length+1,rid='r'+n;c.rounds.push({id:rid,round_number:n,mode:d.mode,court_count:d.courts.length,eligible:structuredClone(c.roster)});for(const court of d.courts){const row={id:'m'+c.matches.length,match_order:c.matches.length+1,round_id:rid,round_number:n,court_number:court.court,generation_mode:d.mode,team_a_score:4,team_b_score:2,result:'win'};court.pairs.flat().forEach((p,i)=>{const slot=['team_a_player1','team_a_player2','team_b_player1','team_b_player2'][i];row[slot+'_profile_id']=p.profile_id;row[slot+'_guest_id']=p.guest_id;row[slot+'_guest_name']=p.guest_id?p.name:null;row[slot+'_source_side']=p.source;});c.matches.push(row);}}
test('対決・混合：1～5面、異人数、モード切替、全員の重複禁止・休憩公平性',()=>{
 for(const [a,b,courts]of[[2,2,1],[4,4,2],[7,5,2],[11,8,5],[10,10,5]]){
 const c=context(a,b),rng=seededRandom(a*100+b),counts=new Map(c.roster.map(p=>[p.key,0]));let lastRest=new Set();
 for(let n=0;n<40;n++){const mode=n%2?'mixed':'confrontation',d=generateTeamRound(c,mode,courts,rng),all=d.courts.flatMap(c=>c.pairs.flat());assert.equal(d.courts.length,Math.min(courts,Math.floor(a/2),Math.floor(b/2)));assert.equal(new Set(all.map(p=>p.key)).size,all.length);for(const court of d.courts){if(mode==='mixed')for(const pair of court.pairs)assert.deepEqual(pair.map(p=>p.source).sort(),['team_a','team_b']);else assert(court.pairs[0].every(p=>p.source==='team_a')&&court.pairs[1].every(p=>p.source==='team_b'));}const resting=new Set(d.resting.map(p=>p.key));assert([...resting].every(key=>!lastRest.has(key)),'今回の人数構成では連続休憩を回避');lastRest=resting;all.forEach(p=>counts.set(p.key,counts.get(p.key)+1));record(c,d);}
 for(const side of ['team_a','team_b']){const plays=c.roster.filter(p=>p.source===side).map(p=>counts.get(p.key));assert(Math.max(...plays)-Math.min(...plays)<=1);}
 }
});
test('両所属の割当を同時に解き、ゲストIDを区別し、人数不足・未完了・不整合を拒否する',()=>{
 const c=context(3,2);c.roster.push({...c.roster[0],source:'team_b'});for(let n=0;n<12;n++){const d=generateTeamRound(c,'mixed',2,seededRandom(n));assert.equal(new Set(d.courts.flatMap(c=>c.pairs.flat().map(p=>p.key))).size,4);}
 const shared=context(4,0);shared.roster.push(...shared.roster.map(p=>({...p,source:'team_b'})));assert.equal(generateTeamRound(shared,'mixed',2,seededRandom(8)).courts.length,1,'重複しない総人数による面数上限');
 const guests=context(1,1);for(const side of ['team_a','team_b'])guests.roster.push({key:'guest:'+side,profile_id:null,guest_id:side,member_id:null,source:side,name:'同名ゲスト'});assert.equal(generateTeamRound(guests,'mixed',1).courts.length,1);
 assert.throws(()=>generateTeamRound(context(1,8),'mixed',2),/各2名/);
 const duplicate=context(2,2);duplicate.roster.push(duplicate.roster[0]);assert.throws(()=>generateTeamRound(duplicate,'confrontation',1),/不整合/);
 const unfinished=context(2,2);unfinished.matches.push({result:'undecided',team_a_score:null,team_b_score:null});assert.throws(()=>generateTeamRound(unfinished,'mixed',1),/未完了/);
});
test('連続ペアの回避、固定シード再現、再抽選・キャンセルが元データを変更しない',()=>{
 const c=context(4,4),original=JSON.stringify(c),a=generateTeamRound(c,'mixed',2,seededRandom(10));assert.deepEqual(a,generateTeamRound(c,'mixed',2,seededRandom(10)));assert.equal(JSON.stringify(c),original);record(c,a);
 const last=new Set(a.courts.flatMap(c=>c.pairs.map(p=>p.map(x=>x.key).sort().join('|'))));const b=generateTeamRound(c,'mixed',2,seededRandom(11));assert(b.courts.flatMap(c=>c.pairs).every(p=>!last.has(p.map(x=>x.key).sort().join('|'))));
 assert(teamCardPlayers(c.matches[0]).every(p=>p.key&&p.source));
});

require('node:module').registerHooks({resolve(specifier,context,next){return next(specifier==='./friendly-team-rounds'?specifier+'.ts':specifier,context);}});
const {friendlyTeamStats}=require('../lib/friendly-team-results.ts');
test('混合は個人・ペアにだけ加算し、既存0-0除外・勝点・得失点・順位条件を維持する',()=>{
 const c=context(2,2);record(c,generateTeamRound(c,'confrontation',1,seededRandom(1)));record(c,generateTeamRound(c,'mixed',1,seededRandom(2)));
 const stats=friendlyTeamStats(c.matches,['A','B'],(source,pid,guest)=>pid||guest);assert.equal(stats.countedMatches,1);assert.equal(stats.allCountedMatches,2);assert.equal(stats.teams[0].wins,1);assert.equal(stats.teams[0].diff,2);assert.equal(stats.players.reduce((n,p)=>n+p.matches,0),8);assert.equal(stats.pairs.reduce((n,p)=>n+p.matches,0),4);
 c.matches[1].team_a_score=c.matches[1].team_b_score=0;assert.equal(friendlyTeamStats(c.matches,['A','B'],(s,p,g)=>p||g).allCountedMatches,1);
});
