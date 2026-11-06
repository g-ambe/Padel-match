// 実PostgreSQL/PostgRESTを外部通信のない専用Dockerネットワークで使用する。
const assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {firstMatchResult}=require('../../lib/friendly-match-results.ts');
const pg='score-shape-pg-'+process.pid,api='score-shape-api-'+process.pid,network='score-shape-'+process.pid;
function docker(args,input){const p=spawnSync('docker',args,{input,encoding:'utf8',timeout:120000});if(p.status!==0)throw Error('隔離PostgREST試験のDocker操作に失敗: '+args.slice(0,3).join(' '));return p.stdout.trim();}
const sql=q=>docker(['exec','-i',pg,'psql','-U','postgres','-d','shape_test','-q','-v','ON_ERROR_STOP=1'],q);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<100;n++){try{const v=fn();if(v)return v;}catch{}await wait(100);}throw Error('隔離APIの準備または再読込みに失敗');}
function query(){return JSON.parse(docker(['exec',pg,'wget','-Y','off','-qO-',`http://${api}:3000/matches?select=id,match_results(id,score_a,score_b,winner_team)&order=id`]));}
(async()=>{try{
 docker(['network','create','--internal',network]);
 docker(['run','-d','--name',pg,'--network',network,'-e','POSTGRES_PASSWORD=local-only-test','-e','POSTGRES_DB=shape_test','postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b']);
 await until(()=>{docker(['exec',pg,'pg_isready','-h','127.0.0.1','-U','postgres','-d','shape_test']);return true;});
 sql("create role shape_reader nologin;create table matches(id int primary key);create table match_results(id int primary key,match_id int references matches(id),score_a int,score_b int,winner_team text);insert into matches values(1),(2);insert into match_results values(1,1,0,0,'draw');grant usage on schema public to shape_reader;grant select on matches,match_results to shape_reader;");
 docker(['run','-d','--name',api,'--network',network,'-e',`PGRST_DB_URI=postgresql://postgres:local-only-test@${pg}:5432/shape_test`,'-e','PGRST_DB_ANON_ROLE=shape_reader','-e','PGRST_DB_SCHEMAS=public','postgrest/postgrest:v13.0.4@sha256:a312f4b2e48530a01fc26f5310d547d6c26d087858360e164522e415723a7732']);
 const before=await until(()=>query());assert(Array.isArray(before[0].match_results));assert.deepEqual(before[1].match_results,[]);
 sql("alter table match_results add constraint match_results_one_per_match unique(match_id);notify pgrst,'reload schema';");
 const after=await until(()=>{const rows=query();return !Array.isArray(rows[0].match_results)?rows:null;});
 assert.equal(after[0].match_results.score_a,0);assert.equal(after[1].match_results,null);assert.equal(after[0].match_results[0],undefined,'旧画面の配列参照は保存済み結果を見失う');
 assert.deepEqual(firstMatchResult(after[0].match_results),firstMatchResult(before[0].match_results));assert.equal(firstMatchResult(after[1].match_results),null);
 console.log('実PostgreSQL/PostgREST：UNIQUE追加による配列→object/null、旧読取の表示消失、修正後の同一結果保持を確認');
 }finally{for(const name of [api,pg])spawnSync('docker',['rm','-f',name],{stdio:'ignore'});spawnSync('docker',['network','rm',network],{stdio:'ignore'});}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
