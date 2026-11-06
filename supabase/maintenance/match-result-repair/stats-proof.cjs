// 実データはファイル/メモリ内だけで処理する。stdoutには件数とハッシュだけを返す。
const fs=require('node:fs'),crypto=require('node:crypto');
const {database,profileStats,handler}=require('../../../tests/fixtures/stats-helpers.cjs');
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
(async()=>{
 const tables=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),db=database(tables),proof={groups:[],profiles:[],events:[]};
 for(const club of tables.clubs){const state={},bindings={console:{error(){}},getSupabaseClient:()=>db.s,id:club.id,setError:v=>state.error=v,setIndividualRows:v=>state.individual=v,setPairRows:v=>state.pairs=v,setEventHistoryRows:v=>state.events=v};
  await handler('app/groups/[id]/page.tsx','loadStats',bindings)();if(state.error)throw Error('グループ戦績を取得できません');
  proof.groups.push({id:club.id,statistics:state,rankings:['総合ランキング','勝率ランキング'].map(individualMode=>handler('app/groups/[id]/page.tsx','rankedIndividuals',{individualRows:state.individual??[],individualMode})())});
 }
 const scopes=new Map();for(const p of tables.player_profiles){const key=p.linked_auth_user_id||'unlinked:'+p.id;if(!scopes.has(key))scopes.set(key,[]);scopes.get(key).push(p.id);}
 for(const[key,ids]of scopes)proof.profiles.push({key,stats:await profileStats(db.s,ids,key.startsWith('unlinked:')?'':key)});
 for(const event of tables.events){const participants=tables.event_participants.filter(p=>p.event_id===event.id).map(p=>({...p,guest_name:tables.player_profiles.find(v=>v.id===p.player_profile_id)?.display_name||tables.profiles.find(v=>v.id===p.profile_id)?.display_name||p.guest_name||'ゲスト'}));
  const matches=tables.matches.filter(m=>m.event_id===event.id).map(m=>({...m,players:tables.match_players.filter(p=>p.match_id===m.id),result:tables.match_results.find(r=>r.match_id===m.id)||null}));
  const summary=handler('app/events/[id]/page.tsx','eventSummary',{participants,matches})(),summaryRankingRows=summary.rows.filter(r=>r.played>0);
  proof.events.push({id:event.id,summary,rankings:['winRanking','winRateRanking','diffRanking','mvp'].map(name=>handler('app/events/[id]/page.tsx',name,{summaryRankingRows})())});
 }
 if(db.calls.some(c=>c.method!=='GET'))throw Error('集計比較で書込みを検出');
 process.stdout.write(JSON.stringify({groups:proof.groups.length,profiles:proof.profiles.length,events:proof.events.length,digests:Object.fromEntries(Object.entries(proof).map(([k,v])=>[k,digest(v)]))}));
})().catch(()=>{process.stderr.write('非公開データの戦績比較に失敗しました\n');process.exitCode=1;});
