// TASK-08 / H32: keep the already-applied Stage SQL in the exact CLI migration
// version recorded in supabase_migrations.schema_migrations.
// This is a source-only test: it never connects to Stage or production.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const appliedName='task08_h31_stage_token_scoped_video_click_rpc';
const stageVersion='20261120091138';
const appliedSource='supabase/maintenance/group-foundation/120_p0_h31_stage_token_click_additive_apply.sql';
const committedSource=`supabase/migrations/${stageVersion}_${appliedName}.sql`;
const source=fs.readFileSync(appliedSource,'utf8');
const migrated=fs.readFileSync(committedSource,'utf8');

test('H32: CLI migration file matches Stage-applied SQL byte-for-byte',()=>{
 assert.equal(migrated,source,'Changing 120 or registered migration independently causes drift');
 assert.ok(migrated.startsWith('-- TASK-08 H31:'));
 assert.ok(migrated.trimEnd().endsWith('COMMIT;'));
 assert.equal((migrated.match(/CREATE FUNCTION public\.record_[a-z_]+_by_token\(/g)||[]).length,3);
});

test('H32: stage DB version has exactly one corresponding on-disk migration',()=>{
 const migrations=fs.readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql'));
 const v=migrations.filter(x=>x.startsWith(stageVersion+'_'));
 const named=migrations.filter(x=>x.includes(appliedName));
 assert.deepEqual(v,[`${stageVersion}_${appliedName}.sql`]);
 assert.deepEqual(named,[`${stageVersion}_${appliedName}.sql`]);
});

test('H32: additive-only migration does not silently remove legacy consumers before release gate',()=>{
 assert.doesNotMatch(migrated,/\bDROP\s+(?:TABLE|FUNCTION|POLICY)\b/i);
 assert.doesNotMatch(migrated,/\bREVOKE\s+(?:ALL|EXECUTE)\s+ON\s+FUNCTION\s+public\.record_(?:event|official)_video_(?:link_)?click\(/i);
 assert.doesNotMatch(migrated,/\bDELETE\s+FROM\b|\bTRUNCATE\b/i);
 assert.match(migrated,/e\.share_token\s*=\s*p_share_token/g);
});
