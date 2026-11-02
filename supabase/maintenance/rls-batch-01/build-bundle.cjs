// Deterministic composition; source changes remain independently reviewable/reversible.
const fs=require('node:fs'),path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,file),'utf8').replace(/^BEGIN;\r?\n/m,'').replace(/^COMMIT;\r?$/m,'');
for(const direction of ['apply','rollback']){
 const parts=direction==='apply'
  ? ['../rls-events-insert/apply.sql','grants/events-delete-apply.sql','grants/clubs-truncate-apply.sql','grants/events-truncate-apply.sql']
  : ['grants/events-truncate-rollback.sql','grants/clubs-truncate-rollback.sql','grants/events-delete-rollback.sql','../rls-events-insert/rollback.sql'];
 const sql='-- Review candidate. Target padel-hub / ntczrmvffmpjzilfebyi. Explicit approval required.\nBEGIN;\nSET LOCAL lock_timeout=\'3s\';\nSET LOCAL statement_timeout=\'15s\';\nLOCK TABLE public.clubs, public.events IN SHARE ROW EXCLUSIVE MODE;\n'
  +parts.map(p=>'\n-- Source: '+p+'\n'+read(p)).join('\n')+'\nCOMMIT;\n';
 fs.writeFileSync(path.join(__dirname,direction+'.sql'),sql);
}
