"""スコア読取障害の集計だけを返す。本番データ・定義は一切変更しない。"""
import json
import sys
from pathlib import Path
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


def main():
    try:
        report=Source().query(SQL)
        print('::notice title=スコア読取障害の読み取り調査::'+json.dumps(report,ensure_ascii=False))
    except Exception:
        print('::error title=スコア読取障害の読み取り調査::readonly_diagnostic_failed_no_private_data_logged')
        return 1
    return 0


if __name__=='__main__':raise SystemExit(main())
