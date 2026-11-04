const {createHash}=require('node:crypto');
const fields={
 tables:['table','rls','force_rls'],
 policies:['tablename','policyname','cmd','roles','permissive','qual','with_check'],
 table_acl:['table','role','privilege','grantable'],column_acl:['table','column','role','privilege'],
 triggers:['table','name','enabled','definition','function'],
 permission_helpers:['signature','security_definer','owner','config','acl','definition'],
 constraints:['table','name','definition'],indexes:['table','name','definition'],
};
function normalise(value){
 if(typeof value==='string')return value.replace(/\s+/g,' ').trim();
 if(Array.isArray(value))return value.map(normalise).sort((a,b)=>{const x=JSON.stringify(a),y=JSON.stringify(b);return x<y?-1:x>y?1:0;});
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalise(value[key])]));
 return value;
}
function metadataFingerprints(snapshot){return Object.fromEntries(Object.entries(fields).map(([name,columns])=>[name,createHash('sha256').update(JSON.stringify(normalise(snapshot[name].map(row=>Object.fromEntries(columns.map(key=>[key,row[key]])))))).digest('hex')]));}
module.exports={metadataFingerprints};
