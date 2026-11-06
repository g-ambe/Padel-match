const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
require('node:module').registerHooks({ resolve(specifier, context, next) { return next(['./friendly-round-history','./permissions','./stats-history','./friendly-match-results'].includes(specifier) ? specifier + '.ts' : specifier, context); } });
const history = require('../../lib/stats-history.ts');
const results = require('../../lib/friendly-match-results.ts');
const { readProfileRows } = require('../../lib/player-profiles.ts');
const eventCourts = require('../../lib/event-courts.ts');
const { fetchBalancePastStats } = require('../../lib/friendly-balance-history.ts');
const fixedPairs = require('../../lib/event-fixed-pairs.ts');
const roundLineup = require('../../lib/round-lineup.ts');

// Reactを偽装せず、画面が実行する関数そのものをASTから取り出して検証する。
function expression(source, name) {
  const file = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(file);
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) {
      found = (ts.isCallExpression(node.initializer) && node.initializer.expression.getText(file) === 'useMemo' ? node.initializer.arguments[0] : node.initializer).getText(file);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!found) throw new Error(`検証対象の関数が見つかりません: ${name}`);
  return found;
}
function evaluate(source, name, bindings = {}) {
  const code = ts.transpileModule(`module.exports = (${expression(source, name)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const values = { ...results, ...history, ...eventCourts, ...fixedPairs, ...roundLineup, eventMode:"manual", fixedFeature:false, pendingFixedRound:{current:null}, pendingFixedOwner:{current:null}, fixedOwner:{current:null}, setFixedState:()=>{}, setFixedError:()=>{}, fetchBalancePastStats, readProfileRows, closingEvent:{current:false}, boardOperation:{current:null}, setCourtCount:()=>{}, setIsClosingEvent:()=>{}, setEventStatus:()=>{}, setEventTab:()=>{}, initializeEventTab:()=>{}, participantStatusRevision:{current:0}, scoreQueue:{hasUnsaved:()=>false,has:()=>false,invalidateReads:()=>{}}, scoreScope:'test#', scrollToResults:()=>{}, ...bindings };
  const module = { exports: {} };
  new Function('module', ...Object.keys(values), code)(module, ...Object.values(values));
  return module.exports;
}
const pageSource = file => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
const handler = (file, name, bindings) => evaluate(pageSource(file), name, bindings);
const legacySource = () => fs.readFileSync(path.join(__dirname, 'legacy-stats.ts.txt'), 'utf8');

// 実Supabase SDKでURL・ページング・書込み対象まで検証。外部通信は行わない。
function database(tables, options = {}) {
  const calls = [], operations = new Map();
  const s = createClient('https://stats-test.invalid', 'public-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      const table = url.pathname.split('/').at(-1);
      const call = { table, method: init.method ?? 'GET', url, body: init.body ? JSON.parse(init.body) : undefined };
      calls.push(call);
      const failure = await options.fail?.(call);
      if (failure) return new Response(JSON.stringify({ code: '42501', message: '取得または更新を拒否' }), { status: 403 });
      if (table === 'get_friendly_lineup_versions') return new Response(JSON.stringify({version:1,editing_enabled:false,event_revision:0,rounds:[]}),{status:200});
      if (table === 'get_friendly_round_lineup') {
        const b=call.body,cards=tables.matches.filter(m=>m.event_id===b.p_event_id&&m.round_id===b.p_round_id).map(m=>({id:m.id,completed:m.completed,players:roundLineup.canonicalPlayers(tables.match_players.filter(p=>p.match_id===m.id)),result:tables.match_results.filter(r=>r.match_id===m.id).map(({id,score_a,score_b,winner_team})=>({id,score_a,score_b,winner_team}))}));
        return new Response(JSON.stringify({event_id:b.p_event_id,round_id:b.p_round_id,revision:0,cards,people:[],eligible:[]}),{status:200});
      }
      if (table === 'delete_friendly_match') {
        const b=call.body;if(operations.has(b.p_request_id))return new Response(JSON.stringify(operations.get(b.p_request_id)),{status:200});
        for(const t of ['match_results','match_players'])tables[t]=tables[t].filter(r=>r.match_id!==b.p_match_id);
        tables.matches=tables.matches.filter(m=>m.id!==b.p_match_id);
        const data={request_id:b.p_request_id,match_id:b.p_match_id,deleted:true};operations.set(b.p_request_id,data);return new Response(JSON.stringify(data),{status:200});
      }
      if (table === 'save_friendly_match_score') {
        if(operations.has(call.body.p_request_id))return new Response(JSON.stringify(operations.get(call.body.p_request_id)),{status:200});
        const b=call.body,m=tables.matches.find(m=>m.id===b.p_match_id),prior=tables.match_results.find(r=>r.match_id===m?.id);
        if(await options.fail?.({table:'match_results',method:prior?'PATCH':'POST'})||await options.fail?.({table:'matches',method:'PATCH'}))return new Response(JSON.stringify({message:'試合の確定に失敗しました'}),{status:403});
        const result={id:prior?.id??'score-'+calls.length,score_a:b.p_a,score_b:b.p_b,winner_team:b.p_a===b.p_b?'draw':b.p_a>b.p_b?'A':'B'};
        if(prior)Object.assign(prior,result);else tables.match_results.push({...result,match_id:b.p_match_id});m.completed=true;
        const data={request_id:b.p_request_id,match_id:b.p_match_id,result};operations.set(b.p_request_id,data);return new Response(JSON.stringify(data),{status:200});
      }
      if (table === 'get_event_fixed_pair_state') return new Response(JSON.stringify({event_id:call.body.p_event_id,revision:0,used_fixed_pairs:false,pairs:[],eligible_rounds:[]}),{status:200});
      if (table === 'create_fixed_pair_round' || table === 'create_friendly_round') {
        const r=call.body.p_request;const b=r?{p_event_id:r.eventId,p_last_round:r.lastRound,p_matches:r.matches,p_request_id:r.requestId}:call.body,round={id:`round-rpc-${calls.length}`,event_id:b.p_event_id,round_number:b.p_last_round+1};tables.rounds.push(round);
        for(const [i,m] of b.p_matches.entries()) {const match={id:`match-rpc-${calls.length}-${i}`,event_id:b.p_event_id,round_id:round.id,court_number:m.court,completed:false};tables.matches.push(match);for(const [team,ids] of [['A',m.teamA],['B',m.teamB]])for(const participant_id of ids)tables.match_players.push({match_id:match.id,participant_id,team});}
        return new Response(JSON.stringify({event_id:b.p_event_id,request_id:b.p_request_id,round_id:round.id,round_number:round.round_number}),{status:200});
      }
      let rows = [...(tables[table] ?? [])];
      for (const [key, value] of url.searchParams) {
        if (['select','order','limit','offset'].includes(key)) continue;
        if (key === 'or') {
          const ids = value.match(/player_profile_id\.in\.\(([^)]*)\)/)?.[1]?.split(',') ?? [];
          const owner = value.match(/profile_id\.eq\.([^,)]+)/)?.[1];
          rows = rows.filter(row => ids.includes(row.player_profile_id) || row.profile_id === owner);
        } else if (value.startsWith('eq.')) rows = rows.filter(row => String(row[key]) === value.slice(3));
        else if (value.startsWith('neq.')) rows = rows.filter(row => String(row[key]) !== value.slice(4));
        else if (value.startsWith('lt.')) rows = rows.filter(row => row[key] != null && String(row[key]) < value.slice(3));
        else if (value.startsWith('in.(')) {
          const values = value.slice(4,-1).split(',');
          rows = rows.filter(row => values.includes(String(row[key])));
        }
      }
      const affected = rows.length;
      if (call.method === 'PATCH') for (const row of rows) Object.assign(row, call.body);
      if (call.method === 'POST') {
        if (call.body?.id && (tables[table]??[]).some(row=>row.id===call.body.id)) return new Response(JSON.stringify({code:'23505',message:'同じIDが存在'}),{status:409});
        const items = (Array.isArray(call.body) ? call.body : [call.body]).map((row, i) => ({ id: `insert-${calls.length}-${i}`, ...row }));
        tables[table] ??= [];
        tables[table].push(...items);
        rows = items;
      }
      if (call.method === 'DELETE') tables[table] = tables[table].filter(row => !rows.includes(row));
      const orders = url.searchParams.get('order')?.split(',') ?? [];
      if (orders.length) rows.sort((a,b) => {
        for (const order of orders) {
          const [key, dir] = order.split('.');
          const d = String(a[key]).localeCompare(String(b[key]));
          if (d) return dir === 'desc' ? -d : d;
        }
        return 0;
      });
      const start = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? options.cap ?? 1000);
      rows = rows.slice(start, start + Math.min(limit, options.cap ?? 1000));
      const data = table === 'match_players' && url.searchParams.get('select')?.includes('matches!inner')
        ? rows.map(row => { const match = tables.matches.find(match => match.id === row.match_id); return { ...row, matches: match ? { ...match, match_results: tables.match_results.filter(result => result.match_id === match.id) } : null }; })
        : table === 'matches' ? rows.map(row => ({ ...row, match_players: tables.match_players.filter(player => player.match_id === row.id), match_results: tables.match_results.filter(result => result.match_id === row.id) })) : rows;
      const single = new Headers(init.headers).get('accept')?.includes('application/vnd.pgrst.object+json');
      if (single && data.length !== 1) return new Response(JSON.stringify({ code:'PGRST116', message:'対象は1行ではありません' }),{ status:406 });
      return new Response(JSON.stringify(single ? data[0] : data), { status: 200, headers: { 'Content-Type':'application/json', ...(new Headers(init.headers).get('prefer')?.includes('count=exact') ? {'Content-Range':`*/${affected}`} : {}) } });
    } },
  });
  return { s, calls, tables };
}
function fixture() {
  const events = [
    { id:'event-a', club_id:'club-a', name:'A', created_at:'2026-01-01', status:'closed', is_deleted:false, stats_mode:'official', event_mode:'auto' },
    { id:'event-b', club_id:'club-a', name:'B', created_at:'2026-01-02', status:'closed', is_deleted:false, stats_mode:'official', event_mode:'manual' },
    { id:'event-other', club_id:'club-b', name:'他グループ', created_at:'2026-01-03', status:'closed', is_deleted:false, stats_mode:'official', event_mode:'auto' },
  ];
  const tables = { events, club_members:[], player_profiles:[], event_participants:[], rounds:[], matches:[], match_players:[], match_results:[], player_stats:[{id:'old-stat',match_count:999,win_count:999}], profiles:[{id:'auth-a'}] };
  for (const [index, name] of ['安倍','瀧田','青木','蓮見','退会済み'].entries()) {
    const id = `player-${index}`;
    tables.player_profiles.push({id,display_name:name,linked_auth_user_id:index===0?'auth-a':null,is_active:true});
    tables.club_members.push({id:`member-${index}`,club_id:'club-a',player_profile_id:id,is_active:index!==4,role:index===0?'main_admin':'member',created_at:'2026-01-01'});
  }
  tables.club_members.push({id:'other-member',club_id:'club-b',player_profile_id:'player-0',is_active:true});
  for (const event of events) {
    tables.rounds.push({id:`round-${event.id}`,event_id:event.id,round_number:1});
    for (let i=0; i<5; i++) tables.event_participants.push({id:`${event.id}-p${i}`,event_id:event.id,player_profile_id:`player-${i}`,participant_type:'member',profile_id:i===0?'auth-a':null});
    for (let i=5; i<7; i++) tables.event_participants.push({id:`${event.id}-p${i}`,event_id:event.id,player_profile_id:null,profile_id:null,guest_name:`ゲスト${i}`,participant_type:'guest'});
  }
  const addMatch = (event, ids, a, b, completed = true) => {
    const id=`match-${String(tables.matches.length).padStart(4,'0')}`;
    tables.matches.push({id,event_id:event,round_id:`round-${event}`,completed,youtube_url:'https://youtu.be/keep',created_at:'2026-01-01'});
    tables.match_results.push({id:`result-${id}`,match_id:id,score_a:a,score_b:b,winner_team:a>b?'A':a<b?'B':'draw'});
    ids.forEach((n,i) => tables.match_players.push({id:`${id}-${i}`,match_id:id,participant_id:`${event}-p${n}`,team:i<2?'A':'B'}));
    return id;
  };
  addMatch('event-a',[0,1,2,3],4,1);
  addMatch('event-a',[0,2,1,3],2,2);
  addMatch('event-a',[0,1,2,5],3,1); // 3人とゲスト
  addMatch('event-a',[0,5,1,6],0,4); // 2人とゲスト
  addMatch('event-a',[0,4,1,2],1,4); // 退会者も試合成立の判定に含む
  addMatch('event-a',[0,1,2,3],0,0); // 有効な引き分け
  addMatch('event-a',[0,1,2,3],4,0,false);
  addMatch('event-b',[0,1,2,3],1,4);
  addMatch('event-other',[0,1,2,3],4,0);
  return { tables, addMatch };
}
async function groupStats(s, legacy = false, initial = {}) {
  const state = { ...initial };
  const bindings = { console:{error() {}}, getSupabaseClient:() => s, id:'club-a', setError:v=>state.error=v, setIndividualRows:v=>state.individual=v, setPairRows:v=>state.pairs=v, setEventHistoryRows:v=>state.events=v };
  await (legacy ? evaluate(legacySource(),'loadStats',bindings) : handler('app/groups/[id]/page.tsx','loadStats',bindings))();
  return state;
}
async function profileStats(s, ids = ['player-0'], legacy = false) {
  return (legacy ? evaluate(legacySource(),'loadProfileStats') : handler('app/profile/page.tsx','loadProfileStats'))(s, ids.map(id=>({id})), 'auth-a');
}
module.exports = { expression, evaluate, pageSource, handler, legacySource, database, fixture, groupStats, profileStats, ...history };
