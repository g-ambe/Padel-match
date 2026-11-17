BEGIN;
-- JPA公式一覧の提供CSVに基づく既存9施設の補正のみ。新規施設・営業中判定・参照変更は行わない。
-- 生成元: shared-home-facility/facility_data.py / 掲載確認と営業確認は別。
DO $jpa$
DECLARE item record; ids uuid[]; current_row public.padel_facilities;
BEGIN
 LOCK TABLE public.padel_facilities IN SHARE ROW EXCLUSIVE MODE;
 FOR item IN SELECT * FROM jsonb_to_recordset('[{"key": "jpa:padel-tokyo", "name": "パデル東京（善福寺公園テニスクラブ内）", "old_name": "パデル東京", "prefecture": "東京都", "old_prefecture": "東京", "address": "東京都練馬区関町南1-4-48"}, {"key": "jpa:padelone-tokorozawa", "name": "パデルワンところざわ", "old_name": "パデルワンところざわ", "prefecture": "埼玉県", "old_prefecture": "埼玉", "address": "埼玉県所沢市北原町1288"}, {"key": "jpa:harenochihare", "name": "パデル＆フットサル晴れのち晴れ", "old_name": "パデル＆フットサル 晴れのち晴れ", "prefecture": "千葉県", "old_prefecture": "東京", "address": "千葉県千葉市中央区浜野町840"}, {"key": "jpa:giardino", "name": "GIARDINO", "old_name": "GIARDINO", "prefecture": "千葉県", "old_prefecture": "千葉", "address": "千葉県千葉市稲毛区長沼原町129-1"}, {"key": "jpa:academia-sakura", "name": "パデルアカデミア佐倉", "old_name": "パデルアカデミア佐倉", "prefecture": "千葉県", "old_prefecture": "千葉", "address": "〒285-0835 千葉県佐倉市ユーカリが丘5-3-1"}, {"key": "jpa:chigasaki", "name": "CHIGASAKI PADEL CLUB", "old_name": "茅ヶ崎パデルクラブ", "prefecture": "神奈川県", "old_prefecture": "神奈川", "address": "〒253-0082 神奈川県茅ヶ崎市香川1－1－14－2"}, {"key": "jpa:tsubasa-chofu", "name": "キャプテン翼パデル調布", "old_name": "キャプテン翼パデル 調布", "prefecture": "東京都", "old_prefecture": "東京", "address": "〒182-0033 東京都調布市富士見町1-6-2"}, {"key": "jpa:assemble-omiya", "name": "アッセンブル大宮", "old_name": "アッセンブル大宮", "prefecture": "埼玉県", "old_prefecture": "埼玉", "address": "〒331-0064 埼玉県さいたま市西区佐知川1054-1"}, {"key": "jpa:tokyo-mizumachi", "name": "パデル東京ミズマチ", "old_name": "パデル東京ミズマチ", "prefecture": "東京都", "old_prefecture": "東京", "address": "〒131-0033 東京都墨田区向島1-32-4"}]'::jsonb)
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
