const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {simulate,groups}=require('./fixtures/fixed-pair-simulation.cjs');
test('指定の人数・面数・全登録数を全3モードで50Round連続生成し、公平性・固定維持・重複・時間を集計する',async t=>{
 const reports=[];
 for(const[n,courts,max]of groups)for(const mode of ['normal','balance','rival'])await t.test(`${n}人・${courts}面・固定1〜${max}組・${mode}`,()=>{
  for(let fixed=1;fixed<=max;fixed++){
   const r=simulate(n,courts,fixed,mode);reports.push(r);assert.equal(r.success,50);assert.equal(r.formed,r.bothPlayed);
   assert(r.maxDeviation<=1.01,JSON.stringify(r));
   assert(r.maxStreak<=Math.ceil((n-4*Math.min(courts,Math.floor(n/4)))/(4*Math.min(courts,Math.floor(n/4)))),JSON.stringify(r));
   if(n===6&&fixed===3)assert.equal(r.split,0,'6人1面3組はペア単位でローテーションできる');
   if(n===8&&fixed===3){assert.equal(r.maintenanceRate,100);assert(r.freeConsecutive>=49,'回避不能な未固定ペアを許容する');}
   if(n===8&&fixed===4||n===20&&fixed===10)assert.equal(r.split,0);
  }
 });
 if(process.env.FIXED_PAIR_REPORT)fs.writeFileSync(process.env.FIXED_PAIR_REPORT,JSON.stringify(reports,null,2)+'\n');
});

test('途中参加・欠席・明示休み・参加復帰では参加機会ごとの期待休憩だけを累積する',()=>{
 for(const mode of ['normal','balance','rival']){
  const r=simulate(10,1,4,mode,50,7,(step,ids)=>step<10?ids.slice(0,6):step<20?ids:step<30?ids.filter(id=>id!=='p01'):step<40?ids.filter(id=>!['p03','p04'].includes(id)):ids);
  assert.equal(r.success,50);assert.deepEqual(r.eligible,[40,50,40,40,50,50,40,40,40,40]);assert(r.maxDeviation<1.1,JSON.stringify(r));
 }
});
