const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const rpc = fs.readFileSync('supabase/maintenance/group-foundation/60_h15_self_withdraw_stage_candidate.sql','utf8');
const probe = fs.readFileSync('supabase/maintenance/group-foundation/61_h15_self_withdraw_rollback_probe.sql','utf8');
const ui = fs.readFileSync('app/groups/[id]/page.tsx','utf8');
const manual = fs.readFileSync('lib/tutorial-content.ts','utf8');

test('H15 self exit uses narrowly scoped authenticated RPC, owner and last-main guard',()=>{
  assert.match(rpc,/CREATE FUNCTION public\.leave_my_club\(p_club_id uuid,p_member_id uuid\)/);
  assert.match(rpc,/SECURITY DEFINER SET search_path = ''/);
  assert.match(rpc,/v_auth := auth\.uid\(\)/);
  assert.match(rpc,/FOR UPDATE;/);
  assert.match(rpc,/cm\.club_id=p_club_id AND cm\.id=p_member_id/);
  assert.match(rpc,/pp\.linked_auth_user_id=v_auth/);
  assert.match(rpc,/cm\.player_profile_id IS NULL AND cm\.profile_id=v_auth/);
  assert.match(rpc,/IF v_owner=v_auth THEN/);
  assert.match(rpc,/v_target\.role='main_admin'/);
  assert.match(rpc,/other\.role='main_admin' AND other\.is_active AND other\.status='active'/);
  assert.match(rpc,/SET is_active=false/);
  assert.match(rpc,/REVOKE ALL ON FUNCTION public\.leave_my_club\(uuid,uuid\) FROM PUBLIC,anon,authenticated/);
  assert.match(rpc,/GRANT EXECUTE ON FUNCTION public\.leave_my_club\(uuid,uuid\) TO authenticated/);
  assert.doesNotMatch(rpc,/DELETE FROM public\./);
  assert.doesNotMatch(rpc,/UPDATE public\.(?:player_profiles|events|matches|clubs)/);
  assert.doesNotMatch(rpc,/GRANT SELECT/);
});

test('H15 rollback tests include owner, third party, active member, sub admin and replay',()=>{
  assert.match(probe,/^BEGIN;/m);
  assert.match(probe,/^ROLLBACK;/m);
  for(const key of ['owner_blocked','third_party_blocked','member_leave','sub_admin_leave',
    'repeated_leave_blocked','last_main_remains','retired_rows_retained','history_player_profiles_intact']){
    assert(probe.includes("'"+key+"'"),key);
  }
});

test('H15 UI uses existing common confirm popup, RPC only, and returns to profile groups',()=>{
  assert.match(ui,/<AppDialog open=\{confirmSelfLeave\} title="グループを退会しますか？"/);
  assert.match(ui,/disabled=\{selfLeaveBusy \|\| !selfLeaveConfirmed \|\| loading\}/);
  assert.match(ui,/\.rpc\("leave_my_club", \{/);
  assert.match(ui,/p_club_id: id, p_member_id: myMemberId/);
  assert.match(ui,/router\.replace\("\/profile#profile-groups"\)/);
  assert.match(ui,/setSelfLeaveError\("通信に失敗しました/);
  assert.match(manual,/グループの設定画面から本人が退会する場合は/);
});
