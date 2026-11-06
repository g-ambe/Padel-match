"""スコア読取障害の集計だけを返す。本番データ・定義は一切変更しない。"""
import json
import html
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import quote
sys.path.insert(0,str(Path(__file__).parent))
from release_approved import Source

SQL="""
WITH targets AS (
 SELECT e.id,e.event_mode,e.status,e.created_at
 FROM public.events e WHERE NOT e.is_deleted AND e.event_mode IN ('auto','manual')
), cards AS (
 SELECT m.id,m.completed,m.event_id,count(r.id) results,max(r.created_at) last_score
 FROM public.matches m JOIN targets t ON t.id=m.event_id
 LEFT JOIN public.match_results r ON r.match_id=m.id GROUP BY m.id
)
SELECT jsonb_build_object(
 'unique_match_id',EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.match_results'::regclass AND contype='u' AND pg_get_constraintdef(oid)='UNIQUE (match_id)'),
 'recent_active_events',(SELECT coalesce(jsonb_agg(jsonb_build_object('created_before_release',t.created_at<'2026-11-06T08:07:20Z'::timestamptz,'matches',x.cards,'with_score',x.scored,'without_score',x.empty,'latest_score_minute',date_trunc('minute',x.latest))), '[]')
 FROM targets t JOIN LATERAL(SELECT count(*) cards,count(*) FILTER(WHERE results=1) scored,count(*) FILTER(WHERE results=0) empty,max(last_score) latest FROM cards c WHERE c.event_id=t.id)x ON true
 WHERE t.status='active' AND t.created_at>'2026-11-05T00:00:00Z'::timestamptz),
 'duplicate_matches',(SELECT count(*) FROM cards WHERE results>1),
 'score_read_format','unique FK: object/null; previous FK: array'
)
"""


def public_display_probe(source):
    # 公開済みの1試合だけを匿名ブラウザで読み取る。URL・得点・DOMはログ禁止。
    chrome=shutil.which('google-chrome') or shutil.which('chromium')
    if not chrome:return {'public_browser_available':False}
    sample=source.query("""SELECT (SELECT jsonb_build_object('token',e.share_token,'a',r.score_a,'b',r.score_b)
      FROM public.events e JOIN public.matches m ON m.event_id=e.id JOIN public.match_results r ON r.match_id=m.id
      WHERE e.status='closed' AND e.share_enabled AND NOT e.is_deleted AND e.event_mode IN('auto','manual')
      AND e.share_token IS NOT NULL AND e.share_token<>'' AND m.completed
      ORDER BY e.created_at DESC,m.created_at DESC LIMIT 1)""")
    if not sample:return {'public_browser_available':True,'public_sample_available':False}
    expected=str(sample['a'])+' - '+str(sample['b'])+('（引き分け）' if sample['a']==sample['b'] else '')
    url='https://padel-match.ranbo-ga.workers.dev/share/events/'+quote(sample['token'],safe='')
    with tempfile.TemporaryDirectory(prefix='padel-public-score-') as profile:
        result=subprocess.run([chrome,'--headless','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--user-data-dir='+profile,'--dump-dom','--virtual-time-budget=15000',url],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=45)
    rendered=result.returncode==0 and bool(re.search(r'<p(?:\s[^>]*)?>\s*'+re.escape(expected)+r'\s*</p>',html.unescape(result.stdout.decode('utf-8',errors='replace'))))
    return {'public_browser_available':True,'public_sample_available':True,'public_saved_score_rendered':rendered}


def main():
    try:
        source=Source()
        report=source.query(SQL)
        report.update(public_display_probe(source))
        print('::notice title=スコア読取障害の読み取り調査::'+json.dumps(report,ensure_ascii=False))
    except Exception:
        print('::error title=スコア読取障害の読み取り調査::readonly_diagnostic_failed_no_private_data_logged')
        return 1
    return 0


if __name__=='__main__':raise SystemExit(main())
