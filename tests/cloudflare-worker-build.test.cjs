const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {current}=require('../scripts/ensure-cloudflare-worker.cjs');
test('WranglerのWorkerがNext.jsと同じビルドIDの場合だけ既存成果物を再利用する',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'worker-build-'));
 try{
 assert.equal(current(root),false);fs.mkdirSync(path.join(root,'.next'));fs.mkdirSync(path.join(root,'.open-next/assets'),{recursive:true});
 fs.writeFileSync(path.join(root,'.next/BUILD_ID'),'new');fs.writeFileSync(path.join(root,'.open-next/worker.js'),'// worker');fs.writeFileSync(path.join(root,'.open-next/assets/BUILD_ID'),'old');assert.equal(current(root),false);
 fs.writeFileSync(path.join(root,'.open-next/assets/BUILD_ID'),'new\n');assert.equal(current(root),true);
 fs.unlinkSync(path.join(root,'.open-next/worker.js'));assert.equal(current(root),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
