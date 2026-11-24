"""Offline only: render the reviewed migration plus atomic history registration.
Never connects to a database, deploys, or grants release authorization.
"""
import hashlib
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
VERSION = "20261124104619"
NAME = "group_member_avatar_read"
SOURCE = ROOT / f"supabase/migrations/{VERSION}_{NAME}.sql"
EXPECTED = "c58d8b7de3e4540486f578b295a705609797a41c2dadd0708a6fbde6a93f4dc6"

def render():
    raw = SOURCE.read_bytes()
    if hashlib.sha256(raw).hexdigest() != EXPECTED:
        raise RuntimeError("Reviewed migration checksum changed; stop")
    lines = raw.decode().splitlines()
    if lines.count("BEGIN;") != 1 or lines[-1] != "COMMIT;":
        raise RuntimeError("Unexpected migration transaction boundaries")
    body = "\n".join(line for line in lines[:-1] if line != "BEGIN;") + "\n"
    tag = "$group_avatar_history$"
    if tag in body:
        raise RuntimeError("History quote collision")
    return f"""-- UNAPPROVED FOR PRODUCTION: explicit authorization and release gates required.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
DO $history_guard$
BEGIN
 IF current_user<>'postgres' OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
  WHERE version='{VERSION}' OR name='{NAME}')
 THEN RAISE EXCEPTION 'Migration already registered or wrong role; stop'; END IF;
END $history_guard$;
{body}
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES('{VERSION}','{NAME}',ARRAY[{tag}{body}{tag}]::text[]);
COMMIT;
"""

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python 04_render_manual_release.py NEW_OUTPUT_FILE")
    raw = render().encode()
    with pathlib.Path(sys.argv[1]).open("xb") as output:
        output.write(raw)
    print("Rendered manual release SHA256=" + hashlib.sha256(raw).hexdigest())
