// Execute the actual group history loader and its unchanged page aggregation
// against PostgREST inside the disposable network. Only synthetic JWTs are used.
const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const root = path.resolve(__dirname,'../../../..');
const {createClient} = require('@supabase/supabase-js');
const {fetchGroupStatsHistory} = require(path.join(root,'lib/stats-history.ts'));
const helpers = require(path.join(root,'lib/friendly-match-results.ts'));
const input = JSON.parse(fs.readFileSync(0,'utf8'));
const fetchLocal = async (url, init={}) => {
  const parsed = new URL(String(url));
  const headers = new Headers(init.headers || {});
  const cmd = ['--host=unix:///var/run/docker.sock','exec','-e','http_proxy=','-e','https_proxy=','-e','HTTP_PROXY=','-e','HTTPS_PROXY=','-e','ALL_PROXY=','-e','all_proxy=',input.container,'wget','-S','-O','-','-T','10'];
  for (const [k,v] of headers) cmd.push('--header='+k+': '+v);
  if (init.body != null) cmd.push('--post-data='+String(init.body));
  // The local harness talks to PostgREST directly, without Supabase's /rest/v1 gateway.
  cmd.push('http://'+input.rest+parsed.pathname.replace(/^\/rest\/v1/,'')+parsed.search);
  const r=cp.spawnSync('docker',cmd,{encoding:'utf8'});
  const found=[...r.stderr.matchAll(/HTTP\/\S+\s+(\d+)/g)];
  if (!found.length) { console.error('local PostgREST transport failed:',r.stderr?.slice(-500),r.error?.message); throw new Error('local PostgREST request failed'); }
  const status=Number(found.at(-1)[1]);
  if (status >= 400) console.error('local PostgREST',parsed.pathname,status,r.stdout.slice(0,500));
  return new Response(r.stdout,{status,headers:{'content-type':'application/json'}});
};
(async()=>{
  const client=createClient('http://local.invalid','synthetic-key',{global:{fetch:fetchLocal,headers:{Authorization:'Bearer '+input.token}},auth:{persistSession:false,autoRefreshToken:false}});
  const history=await fetchGroupStatsHistory(client,input.club);
  const page=fs.readFileSync(path.join(root,'app/groups/[id]/page.tsx'),'utf8');
  const start=page.indexOf('    const { events, membersRaw, participants, pps, matches } = history;');
  const end=page.indexOf('    setIndividualRows(',start);
  if(start<0||end<0) throw Error('group aggregation source markers changed');
  const body=page.slice(start,end)+'\nreturn indiv.filter(row => currentProfileSet.has(row.playerId));';
  const js=ts.transpileModule('function aggregate(history,firstMatchResult,hasEnteredFriendlyMatchScore,getHistoricalGroupMatchTeams){'+body+'}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const aggregate=new Function(js+';return aggregate;')();
  const rows=aggregate(history,helpers.firstMatchResult,helpers.hasEnteredFriendlyMatchScore,helpers.getHistoricalGroupMatchTeams);
  const row=rows.find(x=>x.playerId===input.expected);
  if (input.forbidden && rows.some(x=>x.playerId===input.forbidden)) throw Error('old profile remained in ranking after merge');
  if(!row || rows.filter(x=>x.playerId===input.expected).length!==1 || row.matches!==1 || row.wins!==1 || row.losses!==0 || row.draws!==0 || row.rate!==100 || row.scored!==6 || row.conceded!==3 || row.diff!==3) throw Error('unexpected ranking data '+JSON.stringify(rows));
  console.log(JSON.stringify({rows:rows.length,playerId:row.playerId,matches:row.matches,wins:row.wins,losses:row.losses,draws:row.draws,rate:row.rate,scored:row.scored,conceded:row.conceded,diff:row.diff}));
})().catch(e=>{console.error(e.stack);process.exit(1)});
