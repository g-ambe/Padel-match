const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
require('node:module').registerHooks({ resolve(specifier, context, next) { return next(['./friendly-round-history','./permissions'].includes(specifier) ? specifier + '.ts' : specifier, context); } });
const history = require('../../lib/stats-history.ts');
const results = require('../../lib/friendly-match-results.ts');
const { readProfileRows } = require('../../lib/player-profiles.ts');

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
  const values = { ...results, ...history, readProfileRows, ...bindings };
  const module = { exports: {} };
  new Function('module', ...Object.keys(values), code)(module, ...Object.values(values));
  return module.exports;
}
const pageSource = file => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
const handler = (file, name, bindings) => evaluate(pageSource(file), name, bindings);
const legacySource = () => fs.readFileSync(path.join(__dirname, 'legacy-stats.ts.txt'), 'utf8');

// 実Supabase SDKでURL・ページング・書込み対象まで検証。外部通信は行わない。
function database(tables, options = {}) {
  const calls = [];
  const s = createClient('https://stats-test.invalid', 'public-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      const table = url.pathname.split('/').at(-1);
      const call = { table, method: init.method ?? 'GET', url, body: init.body ? JSON.parse(init.body) : undefined };
      calls.push(call);
      const failure = options.fail?.(call);
      if (failure) return new Response(JSON.stringify({ code: '42501', message: '取得または更新を拒否' }), { status: 403 });
      let rows = [...(tables[table] ?? [])];
      for (const [key, value] of url.searchParams) {
        if (['select','order','limit','offset'].includes(key)) continue;
        if (key === 'or') {
          const ids = value.match(/player_profile_id\.in\.\(([^)]*)\)/)?.[1]?.split(',') ?? [];
          const owner = value.match(/profile_id\.eq\.([^,)]+)/)?.[1];
          rows = rows.filter(row => ids.includes(row.player_profile_id) || row.profile_id === owner);
        } else if (value.startsWith('eq.')) rows = rows.filter(row => String(row[key]) === value.slice(3));
        else if (value.startsWith('in.(')) {
          const values = value.slice(4,-1).split(',');
          rows = rows.filter(row => values.includes(String(row[key])));
        }
      }
      const affected = rows.length;
      if (call.method === 'PATCH') for (const row of rows) Object.assign(row, call.body);
      if (call.method === 'POST') {
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
