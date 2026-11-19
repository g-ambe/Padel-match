const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const rpc = fs.readFileSync("supabase/maintenance/group-foundation/54_h12_prod_compatible_rpc_candidate.sql", "utf8");
const acl = fs.readFileSync("supabase/maintenance/group-foundation/53_h12_anon_shared_base_acl_candidate.sql", "utf8");

test("H12 release candidate separates RPC introduction from destructive anonymous SELECT cutover", () => {
  assert.match(rpc, /CREATE SCHEMA IF NOT EXISTS security_private/i);
  assert.match(rpc, /CREATE OR REPLACE FUNCTION public\.get_shared_event\(p_token text,p_kind text DEFAULT 'event'\)/i);
  assert.match(rpc, /SECURITY DEFINER SET search_path=''/i);
  assert.match(rpc, /REVOKE ALL ON FUNCTION security_private\.shared_event\(text,text\) FROM PUBLIC,anon,authenticated/i);
  assert.match(rpc, /REVOKE ALL ON FUNCTION public\.get_shared_event\(text,text\) FROM PUBLIC,anon,authenticated/i);
  assert.match(rpc, /GRANT EXECUTE ON FUNCTION public\.get_shared_event\(text,text\) TO anon,authenticated/i);
  assert.doesNotMatch(rpc, /\b(?:GRANT|REVOKE)\s+SELECT\b/i);
  assert.doesNotMatch(rpc, /\b(?:DELETE|UPDATE|TRUNCATE)\s+public\./i);
  assert.match(acl, /REVOKE SELECT ON TABLE/i);
  assert.match(acl, /get_shared_event\(text,text\)/i);
});

test("H12 first-time production installation must not require a preexisting share function", () => {
  assert.match(rpc, /to_regprocedure\('public\.get_shared_event\(text,text\)'\)/);
  const preflight = rpc.slice(rpc.indexOf("DO $h12_preflight$"), rpc.indexOf("END $h12_preflight$;"));
  assert.doesNotMatch(preflight, /oid='public\.get_shared_event\(text,text\)'::regprocedure/);
});

test("H12 token scope and team mixed-field DTO remain checked", () => {
  for (const field of ["round_id","round_number","court_number","generation_mode",
    "pair_1_score","pair_2_score","pair_result","team_guests",
    "team_a_player1_source_side","team_a_player2_source_side",
    "team_b_player1_source_side","team_b_player2_source_side"]) {
    assert(rpc.includes("'" + field + "'"), field);
  }
  assert.match(rpc, /e\.share_token = p_token/);
  assert.match(rpc, /e\.share_enabled = true/);
  assert.match(rpc, /e\.status = 'closed'/);
  assert.match(rpc, /e\.is_deleted/);
  assert.doesNotMatch(rpc, /'share_token'\s*,/);
  assert.doesNotMatch(rpc, /'linked_auth_user_id'\s*,/);
});
