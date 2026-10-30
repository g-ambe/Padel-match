const {test}=require('node:test');
const assert=require('node:assert/strict');
const {handler,pageSource}=require('./fixtures/stats-helpers.cjs');
const file='app/groups/[id]/page.tsx';
function setup(extra={},response={data:{id:'club'},error:null}){
 const calls=[],errors=[],paths=[];
 const query={eq:(...args)=>{calls.push(['eq',...args]);return query;},select:value=>{calls.push(['select',value]);return query;},single:async()=>response};
 const binding={canDeleteGroupAction:true,confirmGroupDelete:true,confirmChecked:true,loading:false,groupDeleteInFlight:{current:false},id:'club',deny:()=>errors.push('denied'),getSupabaseClient:()=>({from:table=>{calls.push(['from',table]);return {update:patch=>{calls.push(['update',patch]);return query;}};}}),setLoading:()=>{},setError:e=>{if(e)errors.push(e);},setMessage:()=>{},setConfirmGroupDelete:()=>{},setConfirmChecked:()=>{},router:{push:p=>paths.push(p)},...extra};
 return {run:()=>handler(file,'doDeleteGroup',binding)(),binding,calls,errors,paths};
}
test('確認画面と削除実行の接続が存在する',()=>{
 const source=pageSource(file);
 assert.match(source,/<AppDialog open=\{confirmGroupDelete\}/);
 assert.match(source,/onClick=\{\(\) => void doDeleteGroup\(\)\}/);
 assert.match(source,/disabled=\{loading \|\| !confirmChecked\}/);
});
test('確認前・一般メンバー・処理中には送信しない',async()=>{
 for(const extra of [{canDeleteGroupAction:false},{confirmGroupDelete:false},{confirmChecked:false},{loading:true},{groupDeleteInFlight:{current:true}}]){
  const s=setup(extra);await s.run();assert.equal(s.calls.length,0);assert.equal(s.paths.length,0);
 }
});
test('論理削除1行成功時だけ一覧へ移動する',async()=>{
 const s=setup();await s.run();assert.deepEqual(s.calls,[['from','clubs'],['update',{is_active:false}],['eq','id','club'],['eq','is_active',true],['select','id']]);assert.deepEqual(s.paths,['/groups']);assert.equal(s.errors.length,0);assert.equal(s.binding.groupDeleteInFlight.current,false);
});
test('RLS拒否・0行・対象不一致は成功扱いにせず確認画面に残す',async()=>{
 for(const response of [{data:null,error:{code:'42501'}},{data:null,error:{code:'PGRST116'}},{data:null,error:null},{data:{id:'another'},error:null}]){
  const s=setup({},response);await s.run();assert.equal(s.paths.length,0);assert.equal(s.errors.length,1);assert.equal(s.binding.groupDeleteInFlight.current,false);
 }
});
test('通信失敗でもロックを解除し成功表示しない',async()=>{
 const s=setup({getSupabaseClient:()=>({from:()=>{throw Error('offline');}})});await s.run();assert.equal(s.errors.length,1);assert.equal(s.paths.length,0);assert.equal(s.binding.groupDeleteInFlight.current,false);
});
test('連打でも更新は1回',async()=>{
 let release,calls=0;const pending=new Promise(r=>release=r),lock={current:false};
 const s=setup({groupDeleteInFlight:lock,getSupabaseClient:()=>({from:()=>({update:()=>{calls++;const query={eq:()=>query,select:()=>query,single:()=>pending};return query;}})})});
 const first=s.run();await s.run();assert.equal(calls,1);release({data:{id:'club'},error:null});await first;assert.equal(lock.current,false);
});
