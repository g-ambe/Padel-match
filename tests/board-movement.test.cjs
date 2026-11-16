const {test}=require('node:test');
const assert=require('node:assert/strict');
const {evaluate}=require('./fixtures/stats-helpers.cjs');
const source=require('node:fs').readFileSync('lib/padel-board.ts','utf8').replaceAll('export ','');
const COURT={width:1000,height:2000,net:1000};
const courtPoint=evaluate(source,'courtPoint',{COURT});
const markerPoint=evaluate(source,'markerPoint',{COURT,courtPoint});
test('両チームの選手をネット・コートの内側に制限し、表示比率が変わっても同じ条件を使う',()=>{
 for(const scale of [0.3,0.7,1,2])for(const id of ['A1','A2','B1','B2'])for(const x of [-500,200,1500])for(const y of [-500,300,900,1100,1700,2500]){
  const p=markerPoint(id,{x,y},scale),inset=64/scale;
  assert(p.x>=64&&p.x<=936);assert(p.y>=inset&&p.y<=2000-inset);
  assert(id[0]==='A'?p.y>=1000+inset:p.y<=1000-inset);
  assert.deepEqual(markerPoint(id,p,scale),p);
 }
 assert.deepEqual(markerPoint('A1',{x:300,y:1400}),{x:300,y:1400});
 assert.deepEqual(markerPoint('B1',{x:700,y:600}),{x:700,y:600});
});
test('ボールと線の既存コート座標はネットを越えられる',()=>{
 for(const y of [200,900,1100,1800])assert.deepEqual(markerPoint('ball',{x:500,y}),{x:500,y});
 assert.deepEqual(courtPoint({x:500,y:1500},40),{x:500,y:1500});
});
