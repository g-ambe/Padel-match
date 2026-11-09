// WranglerがNext.jsビルドだけの成果物を配信しないよう、対応するOpenNext Workerを確認する。
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
function current(root=process.cwd()){
 try{
  const nextId=fs.readFileSync(path.join(root,'.next/BUILD_ID'),'utf8').trim();
  return Boolean(nextId)&&fs.existsSync(path.join(root,'.open-next/worker.js'))&&nextId===fs.readFileSync(path.join(root,'.open-next/assets/BUILD_ID'),'utf8').trim();
 }catch{return false;}
}
function ensure(){
 if(current())return;
 const built=fs.existsSync('.next/BUILD_ID');
 const cli=path.resolve('node_modules/@opennextjs/cloudflare/dist/cli/index.js');
 const result=spawnSync(process.execPath,[cli,'build',...(built?['--skipNextBuild']:[])],{stdio:'inherit',env:process.env});
 if(result.error||result.status!==0||!current())throw new Error('Cloudflare Workerの生成・ビルドID照合に失敗しました');
}
module.exports={current};
if(require.main===module){try{ensure();}catch{console.error('Cloudflare Workerを確認できませんでした');process.exitCode=1;}}
