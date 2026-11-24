const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const page = fs.readFileSync("app/share/events/[token]/page.tsx", "utf8");
const sql = fs.readFileSync(
  "supabase/maintenance/group-foundation/49_h12_shared_team_dto_stage_candidate.sql", "utf8"
);

test("通常・チーム共有はトークン専用RPCからのみ読み込む", () => {
  assert.match(page, /\.rpc\("get_shared_event",\s*\{/);
  assert.match(page, /p_token:\s*token/);
  assert.match(page, /p_kind:\s*"event"/);
  assert.doesNotMatch(page, /\.from\s*\(/);
  assert.doesNotMatch(page, /readSharedEventNames|readEventNames|readSharedOfficialNames/);
});

test("チーム共有DTOが不足した場合は結果を推測せず表示を停止する", () => {
  for (const field of ["team_sides", "team_matches", "team_guests", "generation_mode", "pair_1_score", "pair_2_score", "pair_result"]) {
    assert(page.includes(field), field);
  }
  assert.match(page, /return setError\("共有チームの戦績を取得できませんでした"\)/);
});

test("共有RPC候補に試合順・混合得点・所属元・ゲストの最小DTOがある", () => {
  for (const field of [
    "participant_type", "match_order", "round_id", "round_number", "court_number",
    "generation_mode", "pair_1_score", "pair_2_score", "pair_result",
    "team_a_player1_source_side", "team_a_player2_source_side",
    "team_b_player1_source_side", "team_b_player2_source_side",
    "team_a_player1_guest_id", "team_a_player2_guest_id",
    "team_b_player1_guest_id", "team_b_player2_guest_id", "team_guests"
  ]) assert(sql.includes("'" + field + "'"), field);
  assert.match(sql, /e\.share_token\s*=\s*p_token/);
  assert.match(sql, /e\.share_enabled\s*=\s*true/);
  assert.match(sql, /e\.status\s*=\s*'closed'/);
  assert.doesNotMatch(sql, /GRANT\s+SELECT\b/i);
  assert.doesNotMatch(sql, /'share_token'\s*,/);
});
