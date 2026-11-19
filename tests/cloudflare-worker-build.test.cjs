const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {current,ensure}=require('../scripts/ensure-cloudflare-worker.cjs');
test('WranglerのWorkerがNext.jsと同じビルドIDの場合だけ既存成果物を再利用する',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'worker-build-'));
 try{
 assert.equal(current(root),false);fs.mkdirSync(path.join(root,'.next'));fs.mkdirSync(path.join(root,'.open-next/assets'),{recursive:true});
 fs.writeFileSync(path.join(root,'.next/BUILD_ID'),'new');fs.writeFileSync(path.join(root,'.open-next/worker.js'),'// worker');fs.writeFileSync(path.join(root,'.open-next/assets/BUILD_ID'),'old');assert.equal(current(root),false);
 fs.writeFileSync(path.join(root,'.open-next/assets/BUILD_ID'),'new\n');assert.equal(current(root),true);
 fs.unlinkSync(path.join(root,'.open-next/worker.js'));assert.equal(current(root),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('通常next buildのBUILD_IDだけではNextビルドを省略せずWorkerを生成する',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'worker-build-normal-'));
 try{
  fs.mkdirSync(path.join(root,'.next'));fs.writeFileSync(path.join(root,'.next/BUILD_ID'),'normal-next');
  let calls=0;
  ensure(root,(command,args,options)=>{
   calls++;assert.equal(options.cwd,root);assert.equal(args.at(-1),'build');assert(!args.includes('--skipNextBuild'));
   fs.mkdirSync(path.join(root,'.open-next/assets'),{recursive:true});fs.writeFileSync(path.join(root,'.open-next/worker.js'),'// worker');fs.writeFileSync(path.join(root,'.open-next/assets/BUILD_ID'),'normal-next');return{status:0};
  });
  assert.equal(calls,1);assert(current(root));ensure(root,()=>{throw Error('matching worker should be reused')});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
