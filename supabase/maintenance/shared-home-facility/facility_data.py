"""提供されたJPA掲載スナップショットと明示的な採用判断だけからSQLを生成する。通信・DB操作なし。"""
import csv, hashlib, json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
CSV=ROOT/'docs/facilities/jpa-courts-2026-11-18.csv'
DECISIONS=ROOT/'docs/facilities/jpa-courts-decisions-2026-11-18.json'
MIGRATION=ROOT/'supabase/migrations/0052_jpa_existing_facility_corrections.sql'
SOURCE='https://www.japanpadel.com/court-list/'

def reviewed_rows():
    with CSV.open(encoding='utf-8-sig') as source:rows=list(csv.DictReader(source))
    decisions=json.loads(DECISIONS.read_text())
    if len(rows)!=24 or [int(r['jpa_listing_no']) for r in rows]!=list(range(1,25)) or [r['jpa_listing_no'] for r in decisions]!=list(range(1,25)):
        raise ValueError('JPA掲載24件と判断表の対応が不正')
    if any(r['source_url']!=SOURCE for r in rows):raise ValueError('JPA以外の正本を拒否')
    accepted=[]
    for row,decision in zip(rows,decisions):
        if decision['decision']=='hold':continue
        if decision['decision']!='correct_existing' or not decision.get('existing_name') or not decision.get('reason'):raise ValueError('未承認の新規追加・判断を拒否')
        accepted.append({'key':decision['facility_key'],'name':row['facility_name_as_listed'],'old_name':decision['existing_name'],'prefecture':row['prefecture'],'old_prefecture':decision['previous_prefecture'],'address':row['address_as_listed']})
    if len(accepted)!=9 or len({r['key'] for r in accepted})!=9:raise ValueError('既存9件の補正だけを許可')
    return accepted

def sql():
    payload=json.dumps(reviewed_rows(),ensure_ascii=False).replace("'","''")
    return """BEGIN;
-- JPA公式一覧の提供CSVに基づく既存9施設の補正のみ。新規施設・営業中判定・参照変更は行わない。
-- 生成元: shared-home-facility/facility_data.py / 掲載確認と営業確認は別。
DO $jpa$
DECLARE item record; ids uuid[]; current_row public.padel_facilities;
BEGIN
 LOCK TABLE public.padel_facilities IN SHARE ROW EXCLUSIVE MODE;
 FOR item IN SELECT * FROM jsonb_to_recordset('"""+payload+"""'::jsonb)
 AS x(key text,name text,old_name text,prefecture text,old_prefecture text,address text) LOOP
  SELECT array_agg(id) INTO ids FROM public.padel_facilities
   WHERE facility_key=item.key OR EXISTS(
    SELECT 1 FROM unnest(aliases||ARRAY[name]) candidate,
     unnest(ARRAY[item.name,item.old_name]) reviewed
    WHERE lower(regexp_replace(normalize(candidate,NFKC),'[[:space:]・&＆]+','','g'))
     =lower(regexp_replace(normalize(reviewed,NFKC),'[[:space:]・&＆]+','','g')));
  IF coalesce(cardinality(ids),0)<>1 THEN RAISE EXCEPTION '0052_existing_facility_missing_or_ambiguous';END IF;
  SELECT * INTO STRICT current_row FROM public.padel_facilities WHERE id=ids[1] FOR UPDATE;
  IF (current_row.facility_key IS NOT NULL AND current_row.facility_key<>item.key)
   OR current_row.name NOT IN(item.name,item.old_name)
   OR current_row.prefecture IS NULL OR current_row.prefecture NOT IN(item.prefecture,item.old_prefecture)
   OR (current_row.address IS NOT NULL AND current_row.address<>item.address)
   OR current_row.source_url IS NULL OR current_row.source_url NOT IN('https://www.japanpadel.com/','https://www.japanpadel.com/court-list/')
  THEN RAISE EXCEPTION '0052_existing_facility_changed_stop';END IF;
  UPDATE public.padel_facilities SET facility_key=item.key,name=item.name,prefecture=item.prefecture,address=item.address,
   source_url='https://www.japanpadel.com/court-list/',
   aliases=ARRAY(SELECT DISTINCT a COLLATE "C" FROM unnest(current_row.aliases||ARRAY[item.old_name]) a WHERE a<>item.name ORDER BY a COLLATE "C"),
   usage_note=coalesce(current_row.usage_note,'JPA公式一覧掲載（提供CSV: 2026-11-18）。営業・一般利用可否は未確認。')
   WHERE id=current_row.id;
 END LOOP;
END $jpa$;
COMMIT;
"""

if __name__=='__main__':
    import sys
    if sys.argv[1:] == ['--write']:MIGRATION.write_text(sql())
    else:
        if MIGRATION.read_text()!=sql():raise SystemExit('0052_SQLとCSV/判断表が不一致')
        print('PASS: JPA 24掲載 / 既存9補正 / 新規0 / 保留15 / SQL一致')
