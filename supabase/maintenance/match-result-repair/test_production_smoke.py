import importlib.util
import os
import unittest
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('production_smoke_test',Path(__file__).with_name('production_smoke.py'))
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)


class ProductionSmokeGuards(unittest.TestCase):
    def test_wrong_merge_stops_before_db(self):
        with patch.dict(os.environ,{'EXPECTED_MAIN_SHA':'a'*40}),patch.object(p.b,'api',side_effect=[{'sha':'a'*40},{'merged':False}]),self.assertRaises(p.b.BackupError):p.identity()

    def test_failed_basic_browser_never_enables(self):
        with patch.object(p,'identity',return_value='worker'),patch.object(p.approved,'approval'),patch.object(p.common,'source_sql') as sql,patch.object(p,'db_smoke'),patch.object(p,'browser',side_effect=RuntimeError('synthetic')),patch('builtins.print'):
            self.assertEqual(p.main(),1)
            self.assertEqual(sql.call_count,1)
            self.assertNotIn('editing_enabled=true',sql.call_args[0][0])

    def test_failed_post_enable_validation_disables_and_stops(self):
        with patch.object(p,'identity',return_value='worker'),patch.object(p.approved,'approval'),patch.object(p.common,'source_sql') as sql,patch.object(p,'db_smoke',side_effect=[{},RuntimeError('synthetic')]),patch.object(p,'browser',return_value={}),patch('builtins.print'):
            self.assertEqual(p.main(),1)
            self.assertEqual(sql.call_count,3)
            self.assertIn('editing_enabled=true',sql.call_args_list[1][0][0])
            self.assertIn('editing_enabled=false',sql.call_args_list[2][0][0])


if __name__=='__main__':unittest.main()
