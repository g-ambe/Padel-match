"""ネットワークのない合成DBで、実際のCLI・pg_dump・暗号化・復元を試す。"""

import json
import os
import secrets
import shutil
import subprocess
import tempfile
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

import cloud_backup as backup


SEED = r"""
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE audit_reader NOLOGIN;
ALTER ROLE anon SET search_path TO public, auth;
GRANT anon TO audit_reader WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE SCHEMA supabase_migrations;
CREATE SCHEMA private_guards;
CREATE SCHEMA repair_archive;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,encrypted_password text);
CREATE TABLE auth.identities(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id));
CREATE TABLE auth.schema_migrations(version text PRIMARY KEY);
CREATE TABLE storage.migrations(id integer PRIMARY KEY,name text);
CREATE TABLE storage.objects(id uuid PRIMARY KEY,owner_id uuid REFERENCES auth.users(id),name text);
CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,statements text[]);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT '00000000-0000-0000-0000-000000000001'::uuid$$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id),display_name text);
CREATE TABLE public.player_profiles(id uuid PRIMARY KEY,linked_auth_user_id uuid REFERENCES auth.users(id),display_name text,bio text,is_active boolean DEFAULT true);
CREATE TABLE public.clubs(id uuid PRIMARY KEY,name text);
CREATE TABLE public.club_members(id uuid PRIMARY KEY,club_id uuid REFERENCES public.clubs(id),player_profile_id uuid REFERENCES public.player_profiles(id),role text,created_at timestamptz);
CREATE TABLE public.events(id uuid PRIMARY KEY,club_id uuid REFERENCES public.clubs(id),name text);
CREATE TABLE public.event_participants(id uuid PRIMARY KEY,event_id uuid REFERENCES public.events(id),player_profile_id uuid REFERENCES public.player_profiles(id));
CREATE TABLE public.rounds(id uuid PRIMARY KEY,event_id uuid REFERENCES public.events(id),round_number integer);
CREATE TABLE public.matches(id uuid PRIMARY KEY,round_id uuid REFERENCES public.rounds(id),youtube_url text);
CREATE TABLE public.match_players(id uuid PRIMARY KEY,match_id uuid REFERENCES public.matches(id),participant_id uuid REFERENCES public.event_participants(id));
CREATE TABLE public.match_results(id uuid PRIMARY KEY,match_id uuid REFERENCES public.matches(id),score_a integer,score_b integer);
CREATE TABLE public.event_team_matches(id uuid PRIMARY KEY,player_a uuid REFERENCES public.player_profiles(id),player_b uuid REFERENCES public.player_profiles(id));
CREATE TABLE public.official_matches(id uuid PRIMARY KEY,player_id uuid REFERENCES public.player_profiles(id),score integer);
CREATE TABLE repair_archive.old_profiles(id uuid PRIMARY KEY,bio text);
CREATE TABLE public.text_notes(body text);
CREATE FUNCTION private_guards.can_read() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT true$$;
REVOKE ALL ON FUNCTION private_guards.can_read() FROM PUBLIC;
GRANT USAGE ON SCHEMA private_guards TO authenticated;
GRANT EXECUTE ON FUNCTION private_guards.can_read() TO authenticated;
ALTER TABLE public.player_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY player_read ON public.player_profiles FOR SELECT TO authenticated USING(linked_auth_user_id=auth.uid());
GRANT SELECT ON public.player_profiles TO authenticated;
GRANT SELECT(bio) ON public.player_profiles TO audit_reader;
INSERT INTO auth.users VALUES('00000000-0000-0000-0000-000000000001','synthetic-only@example.invalid','synthetic-hash');
INSERT INTO auth.identities VALUES('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001');
INSERT INTO public.profiles VALUES('00000000-0000-0000-0000-000000000001','合成アカウント');
INSERT INTO public.player_profiles VALUES('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','合成選手','保持する設定',true);
INSERT INTO public.clubs VALUES('00000000-0000-0000-0000-000000000004','合成グループ');
INSERT INTO public.club_members VALUES('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003','main_admin','2026-01-01T00:00:00Z');
INSERT INTO public.events VALUES('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000004','合成イベント');
INSERT INTO public.event_participants VALUES('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000003');
INSERT INTO public.rounds VALUES('00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000006',1);
INSERT INTO public.matches VALUES('00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000008','https://example.invalid/synthetic-video');
INSERT INTO public.match_players VALUES('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000007');
INSERT INTO public.match_results VALUES('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000009',4,0);
INSERT INTO public.event_team_matches VALUES('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000003',NULL);
INSERT INTO public.official_matches VALUES('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000003',4);
INSERT INTO repair_archive.old_profiles VALUES('00000000-0000-0000-0000-000000000014','過去の修復用データ');
INSERT INTO auth.schema_migrations VALUES('synthetic-auth');
INSERT INTO storage.migrations VALUES(1,'synthetic-storage');
INSERT INTO supabase_migrations.schema_migrations VALUES('synthetic-app',ARRAY['-- synthetic only']);
INSERT INTO public.text_notes VALUES($note$--先頭がコメントに見える本文
\restrict 合成本文
そのまま保持$note$);
"""


class SnapshotIntegrationTests(unittest.TestCase):
    def test_real_snapshot_and_encrypted_restore(self):
        binary = os.environ.get("SUPABASE_BIN", "/workspace/.cloud-onboarding/padel-backup/bin/supabase")
        self.assertTrue(Path(binary).is_file(), "SUPABASE_BINに検証済みCLIのパスを指定してください")
        names = []
        def docker(args, data=None, env=None):
            result = subprocess.run(backup.DOCKER + args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=90)
            if result.returncode:
                # 全てネットワークのない合成コンテナなので、fixtureのエラーだけを表示できる。
                raise AssertionError(result.stderr.decode(errors="replace"))
            return result.stdout
        def start(label):
            name = "padel-backup-test-" + label + "-" + uuid.uuid4().hex[:8]
            docker(["run", "--detach", "--rm", "--network", "none", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--name", name, backup.probe.POSTGRES_IMAGE])
            names.append(name)
            for _ in range(60):
                # initdb中の一時サーバー（Unix socketのみ）ではなく本起動を待つ。
                ready = subprocess.run(backup.DOCKER + ["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if ready.returncode == 0:
                    return name
                time.sleep(0.2)
            self.fail("合成DBの起動に失敗しました")
        try:
            source = start("source")
            destination = start("restore")
            docker(["exec", "--interactive", source, "psql", "-X", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], data=SEED.encode())
            docker(["exec", "--interactive", destination, "psql", "-X", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], data=b"CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;ALTER ROLE anon SET statement_timeout='3s';")
            with tempfile.TemporaryDirectory(prefix="padel-backup-fixture-") as directory:
                root = Path(directory)
                capture = root / "capture"
                capture.mkdir()
                env = backup.clean_env()
                env.update({"PGHOST": "/var/run/postgresql", "PGPORT": "5432", "PGUSER": "postgres", "PGDATABASE": "postgres", "PGPASSWORD": "synthetic-only"})
                prefix = backup.DOCKER + ["exec", "--interactive"]
                for key in ("PGHOST", "PGPORT", "PGUSER", "PGDATABASE", "PGPASSWORD"):
                    prefix += ["--env", key]
                prefix += [source]
                with patch.dict(os.environ, {"RUNNER_TEMP": str(root), "SUPABASE_BIN": binary, "PADEL_BACKUP_PASSPHRASE": secrets.token_urlsafe(48)}):
                    with backup.Snapshot(prefix, env) as snapshot:
                        # 別接続から更新しても、全dump・照合情報はexportした同じ時点を使う。
                        late = b"INSERT INTO auth.users(id,email) VALUES('00000000-0000-0000-0000-000000000099','late@example.invalid');UPDATE public.player_profiles SET display_name='late change';"
                        docker(["exec", "--interactive", source, "psql", "-X", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], data=late)
                        manifest = backup.collect(snapshot, capture)
                    self.assertTrue(backup.seal(capture, manifest)["dump_encrypted"])
                    downloaded = root / "downloaded"
                    downloaded.mkdir()
                    shutil.copyfile(capture / "backup.tar.gpg", downloaded / "backup.tar.gpg")
                    files, restored_manifest = backup.unpack(downloaded)
                    target = backup.LocalRestore(destination, user="postgres")
                    try:
                        result = backup.restore_files(target, files, restored_manifest)
                    except backup.BackupError as error:
                        if str(error) == "restored_rls_acl_or_definitions_mismatch":
                            expected = json.loads((files / "catalog.json").read_text())
                            actual = backup.catalog(target.query, manifest["tables"], manifest["function_schemas"])
                            differences = []
                            def compare(a, b, path=""):
                                if len(differences) >= 5:
                                    return
                                if isinstance(a, dict) and isinstance(b, dict):
                                    for key in a:
                                        compare(a[key], b.get(key), path + "/" + key)
                                elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
                                    for i, (x, y) in enumerate(zip(a, b)):
                                        compare(x, y, path + "/" + str(i))
                                elif a != b:
                                    differences.append({"path": path, "expected": a, "actual": b})
                            compare(expected, actual)
                            self.fail("合成DBだけの定義差分: " + json.dumps(differences, ensure_ascii=False))
                        raise
                    self.assertTrue(result["restore_verified"])
                    self.assertEqual(target.query("SELECT to_json(count(*)) FROM auth.users"), 1)
                    self.assertEqual(target.query("SELECT to_json(display_name) FROM public.player_profiles"), "合成選手")
                    self.assertEqual(target.query("SELECT to_json(score_a) FROM public.match_results"), 4)
                    self.assertEqual(target.query("SELECT to_json(role) FROM public.club_members"), "main_admin")
                    self.assertEqual(target.query("SELECT to_json(count(*)) FROM repair_archive.old_profiles"), 1)
                    self.assertTrue(any(x["schema"] == "private_guards" for x in json.loads((files / "catalog.json").read_text())["functions"]))
                    # 復元先での孤立参照を、FK検査をすり抜けたデータでも検出する。
                    target.sql("SET session_replication_role=replica; INSERT INTO public.match_players VALUES('00000000-0000-0000-0000-000000000088','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000099');SET session_replication_role=origin;")
                    with self.assertRaises(backup.BackupError):
                        backup.verify_foreign_keys(target, manifest["tables"])
        finally:
            for name in names:
                subprocess.run(backup.DOCKER + ["stop", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)


if __name__ == "__main__":
    unittest.main()
