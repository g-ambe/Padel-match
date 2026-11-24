const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const audit = fs.readFileSync("supabase/maintenance/group-foundation/56_h14_score_semantics_readonly.sql", "utf8");
const scope = fs.readFileSync("lib/stats-history.ts", "utf8");
const members = fs.readFileSync("supabase/migrations/0055_group_read_consumer_support.sql", "utf8");
const group = fs.readFileSync("app/groups/[id]/page.tsx", "utf8");
const profile = fs.readFileSync("app/profile/page.tsx", "utf8");

test("H14 legacy production audit is read-only and emits aggregate fields only", () => {
  assert.match(audit, /^BEGIN READ ONLY;/m);
  assert.match(audit, /^ROLLBACK;/m);
  assert.match(audit, /current_setting\('transaction_read_only'\)/);
  assert.doesNotMatch(audit, /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|GRANT|REVOKE|CREATE)\b/im);
  for (const expected of [
    "score_signature_groups", "flagged_event_distribution", "counted_tie_winner_conflicts",
    "counted_negative_score_matches", "saved_B_win_credit_slots",
    "inactive_members_with_event_participation"
  ]) assert(audit.includes("'" + expected + "'"), expected);
  // No raw identity/time data is projected by the final report.
  assert.doesNotMatch(audit, /'share_token'\s*,|'email'\s*,|'match_id'\s*,|'event_id'\s*,|'player_profile_id'\s*,|'display_name'\s*,/);
});

test("H14 official cumulative history excludes deleted/record-only events without deleting any rows", () => {
  assert.match(scope, /\.eq\("status",\s*"closed"\)\.eq\("is_deleted",\s*false\)\.eq\("stats_mode",\s*"official"\)/);
  assert.match(scope, /readStatsMembers\(s,clubId\)/);
  assert.match(group, /getHistoricalGroupMatchTeams/);
});

test("H14 retired group members remain in historical basis but not current ranking", () => {
  const begin = members.indexOf("CREATE FUNCTION public.get_club_stats_members(");
  const end = members.indexOf("CREATE FUNCTION public.get_club_selection_candidates(", begin);
  assert(begin >= 0 && end > begin);
  const body = members.slice(begin, end);
  assert.match(body, /SELECT cm\.player_profile_id,cm\.is_active FROM public\.club_members cm WHERE cm\.club_id=p_club_id/);
  assert.doesNotMatch(body, /WHERE cm\.club_id=p_club_id AND cm\.is_active/);
  assert.match(group, /const memberProfileSet = new Set\(\(membersRaw \?\? \[\]\)\.map/);
  assert.match(group, /const currentProfileSet = new Set\(\(membersRaw \?\? \[\]\)\.filter\(\(m: any\) => m\.is_active\)/);
  assert.match(group, /setIndividualRows\(indiv\.filter\(row => currentProfileSet\.has\(row\.playerId\)\)\)/);
});

test("H14 known-score interpretation difference is tracked, not silently rewritten", () => {
  // Regression guard only. Decision whether winner_team or scores are canonical
  // for historical 2-2/B rows is pending; never fix stored records here.
  assert.match(group, /if \(sA > sB\) pStats\[prof\]\.wins \+= 1;/);
  assert.match(group, /else pStats\[prof\]\.draws \+= 1;/);
  assert.match(profile, /if \(result\.winner_team === row\.team\) wins \+= 1;/);
});
