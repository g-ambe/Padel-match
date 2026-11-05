const {createClient}=require('@supabase/supabase-js');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const user={id:id(1),email:'navigation@example.invalid',role:'authenticated',aud:'authenticated',user_metadata:{display_name:'本人'},app_metadata:{}};
const clubA=id(10),clubB=id(11),player=id(20),ordinary=id(30),manual=id(31),team=id(32),official=id(33),noGroup=id(34),match=id(50),newMatch=id(51);
function navigationFixture(){
 const event=(n,patch={})=>({id:id(n),name:`試合${n}`,status:'active',event_mode:'auto',stats_mode:'official',club_id:clubA,court_count:1,is_deleted:false,created_by_auth_user_id:user.id,created_at:'2026-11-01T00:00:00Z',share_enabled:false,...patch});
 const tables={
  app_admins:[],profiles:[{id:user.id,display_name:'本人'}],player_profiles:[{id:player,linked_auth_user_id:user.id,display_name:'本人',is_active:true}],
  clubs:[{id:clubA,name:'グループA',is_active:true,is_deleted:false,visibility:'public'},{id:clubB,name:'グループB',is_active:true,is_deleted:false,visibility:'public'}],
  club_members:[{id:id(21),club_id:clubA,player_profile_id:player,profile_id:user.id,role:'member',is_active:true,status:'active'},{id:id(22),club_id:clubB,player_profile_id:player,profile_id:user.id,role:'sub_admin',is_active:true,status:'active'}],
  events:[event(30,{name:'古い開催中',created_at:'2026-01-01T00:00:00Z'}),event(31,{name:'手動開催',event_mode:'manual'}),event(32,{name:'両グループのチーム戦',event_mode:'team',club_id:clubB}),event(34,{name:'本人のグループなし',club_id:null}),...Array.from({length:25},(_,i)=>event(100+i,{status:'closed',name:`過去フレンドリー${i}`})),event(200,{name:'過去チーム戦',status:'closed',event_mode:'team',club_id:clubB})],
  event_team_sides:[{id:id(60),event_id:team,side:'team_a',club_id:clubA,team_name:'Aチーム'},{id:id(61),event_id:team,side:'team_b',club_id:clubB,team_name:'Bチーム'},{id:id(62),event_id:id(200),side:'team_a',club_id:clubA,team_name:'Aチーム'}],event_team_guests:[],event_team_matches:[],
  official_events:[{id:official,title:'公式開催',status:'active',club_id:clubB,is_deleted:false,created_at:'2026-11-02T00:00:00Z',created_by_auth_user_id:user.id},{id:id(201),title:'過去公式',status:'closed',club_id:clubA,is_deleted:false,created_at:'2026-11-02T00:00:00Z',created_by_auth_user_id:user.id}],official_opponents:[],official_matches:[],
  event_participants:[{id:id(40),event_id:ordinary,player_profile_id:player,profile_id:user.id,participant_type:'member',guest_name:'本人',status:'active'},...Array.from({length:3},(_,i)=>({id:id(41+i),event_id:ordinary,player_profile_id:null,profile_id:null,participant_type:'guest',guest_name:`ゲスト${i}`,status:'active'}))],
  rounds:[{id:id(70),event_id:ordinary,round_number:1}],matches:[{id:match,event_id:ordinary,round_id:id(70),court_number:1,completed:true},{id:newMatch,event_id:ordinary,round_id:id(70),court_number:1,completed:false}],
  match_players:[match,newMatch].flatMap(m=>Array.from({length:4},(_,i)=>({id:m+'-'+i,match_id:m,participant_id:id(40+i),team:i<2?'A':'B'}))),match_results:[{id:id(80),match_id:match,score_a:4,score_b:2,winner_team:'A'}],event_video_links:[],user_preferences:[{auth_user_id:user.id,theme_mode:'dark'}],join_requests:[],padel_facilities:[],notifications:[{id:id(90),is_read:false,title:'テスト通知',created_at:'2026-11-05'}]
 };
 const calls=[];let seq=1000;
 const filter=(row,key,value)=> value==='is.null'?row[key]===null:value.startsWith('eq.')?String(row[key])===value.slice(3):value.startsWith('neq.')?String(row[key])!==value.slice(4):value.startsWith('in.(')?value.slice(4,-1).split(',').includes(String(row[key])):true;
 const s=createClient('http://127.0.0.1:54321','local-test-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url),table=url.pathname.split('/').at(-1),method=init.method??'GET',body=init.body?JSON.parse(init.body):null,headers=new Headers(init.headers);
  calls.push({table,method,body,url});
  if(url.pathname.includes('/rpc/')){
   const data=table==='get_event_fixed_pair_state'?{event_id:body.p_event_id,revision:0,used_fixed_pairs:false,pairs:[],eligible_rounds:[]}:[];
   return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
  }
  let rows=[...(tables[table]??[])];
  for(const [key,value]of url.searchParams){
   if(['select','order','limit','offset'].includes(key))continue;
   if(key==='or'){
    const clubs=value.match(/club_id\.in\.\(([^)]+)\)/)?.[1]?.split(',')??[],owner=value.match(/created_by_auth_user_id\.eq\.([^,)]+)/)?.[1];
    const players=value.match(/player_profile_id\.in\.\(([^)]+)\)/)?.[1]?.split(',')??[],profile=value.match(/profile_id\.eq\.([^,)]+)/)?.[1];
    rows=rows.filter(row=>clubs.includes(row.club_id)||(row.club_id===null&&owner&&row.created_by_auth_user_id===owner)||players.includes(row.player_profile_id)||(profile&&row.profile_id===profile));
   }else if(!key.includes('.'))rows=rows.filter(row=>filter(row,key,value));
  }
  if(method==='POST'){
   rows=(Array.isArray(body)?body:[body]).filter(row=>!headers.get('Prefer')?.includes('resolution=ignore-duplicates')||!(tables[table]??[]).some(old=>old.id===row.id)).map(row=>({id:id(seq++),status:'active',is_active:true,is_deleted:false,created_at:'2026-11-05T00:00:00Z',participant_type:'guest',...row}));
   tables[table]??=[];tables[table].push(...rows);
  }else if(method==='PATCH')for(const row of rows)Object.assign(row,body);
  else if(method==='DELETE')tables[table]=tables[table].filter(row=>!rows.includes(row));
  const total=rows.length,selection=url.searchParams.get('select')??'';
  const nestedMatch=m=>m?{...m,rounds:tables.rounds.find(r=>r.id===m.round_id),match_players:tables.match_players.filter(p=>p.match_id===m.id),match_results:tables.match_results.filter(r=>r.match_id===m.id)}:null;
  rows=rows.map(row=>({...row,
   ...(selection.includes('clubs(')?{clubs:tables.clubs.find(c=>c.id===row.club_id)??null}:{}),
   ...(selection.includes('player_profiles(')?{player_profiles:tables.player_profiles.find(p=>p.id===row.player_profile_id)??null}:{}),
   ...(table==='matches'?nestedMatch(row):{}),
   ...(selection.includes('matches!inner')?{matches:nestedMatch(tables.matches.find(m=>m.id===row.match_id))}:{})
  }));
  const order=url.searchParams.get('order');if(order)rows.sort((a,b)=>{for(const part of order.split(',')){const [key,direction]=part.split('.'),d=String(a[key]??'').localeCompare(String(b[key]??''));if(d)return direction==='desc'?-d:d;}return 0;});
  const start=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??1000);rows=rows.slice(start,start+limit);
  const out=headers.get('Accept')?.includes('vnd.pgrst.object+json')?(rows[0]??null):rows;
  return new Response(method==='HEAD'?null:JSON.stringify(out),{status:200,headers:{'Content-Type':'application/json','Content-Range':`0-${Math.max(0,total-1)}/${total}`}});
 }}});
 return {tables,calls,fetch:(url,init)=>s.rest.fetch(url,init)};
}
module.exports={navigationFixture,id,user,clubA,clubB,player,ordinary,manual,team,official,noGroup,match,newMatch};
