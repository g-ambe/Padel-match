BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- ユーザー指示により、提供JPA掲載24件のうち残り15件を未確認状態で追加。
-- 出典CSVの住所表記を保持し、既存行・RLS・GRANT・個人/グループ参照は更新しない。
LOCK TABLE public.padel_facilities IN SHARE ROW EXCLUSIVE MODE;
DO $jpa$
DECLARE item record; ids uuid[]; existing public.padel_facilities; added integer:=0; reused integer:=0;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='0051' AND name='shared_home_facility')
  OR NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='0052' AND name='jpa_existing_facility_corrections')
 THEN RAISE EXCEPTION '0053_requires_0051_0052';END IF;
 FOR item IN SELECT * FROM jsonb_to_recordset('[{"key": "jpa:padelplus-niseko", "name": "PADEL+ Niseko", "prefecture": "北海道", "address": "北海道虻田郡倶知安町岩尾別３２８−３６", "note": "季節営業の可能性があります。営業日・利用条件を確認してください。"}, {"key": "jpa:padel-nagoya", "name": "パデル名古屋", "prefecture": "愛知県", "address": "愛知県名古屋市中区愛知県名古屋市中区大須3-10-26MultinaBox3F", "note": "JPA掲載住所に重複表記があります。所在地・営業状況は施設へ確認してください。"}, {"key": "jpa:solana", "name": "ソラナパデルスクール", "prefecture": "三重県", "address": "三重県鈴鹿市国府町7658-13", "note": "閉業情報の確認が必要です。営業中とは確認できていません。"}, {"key": "jpa:ariel-nabari", "name": "アリエルパデルクラブ", "prefecture": "三重県", "address": "三重県名張市希央台1-24", "note": "営業・一般利用可否は未確認です。"}, {"key": "jpa:padel-kuwana", "name": "パデル桑名", "prefecture": "三重県", "address": "三重県桑名市和泉字二ノ割470-1", "note": "営業・一般利用可否は未確認です。"}, {"key": "jpa:yokkaichi330", "name": "四日市パデル330", "prefecture": "三重県", "address": "三重県四日市市大治田3-2", "note": "営業・一般利用可否は未確認です。"}, {"key": "jpa:ys-sports-garden", "name": "Y''sスポーツガーデン", "prefecture": "京都府", "address": "京都府京都市左京区大原勝林院町445-1", "note": "営業・一般利用可否は未確認です。"}, {"key": "jpa:padelone-kunijima", "name": "パデルワンくにじま", "prefecture": "大阪府", "address": "大阪府大阪市淀川区柴島1-3-21", "note": "営業・一般利用可否は未確認です。"}, {"key": "jpa:padelone-shinkana", "name": "パデルワンしんかな", "prefecture": "大阪府", "address": "⼤阪府堺市北区新⾦岡町５丁１番1号 フレスポしんかな屋上エリア", "note": "住所はJPA掲載原文です。所在地・営業状況は施設へ確認してください。"}, {"key": "jpa:padel-osaka", "name": "パデル大阪", "prefecture": "大阪府", "address": "大阪府大阪市生野区巽東3-2-4", "note": "営業・一般利用可否は未確認です。"}, {"key": "jpa:padelone-hoshida", "name": "パデルワンほしだ", "prefecture": "大阪府", "address": "⼤阪府交野市星⽥北9丁⽬27-1", "note": "住所はJPA掲載原文です。所在地・営業状況は施設へ確認してください。"}, {"key": "jpa:kobe-plus", "name": "パデル神戸プラス", "prefecture": "兵庫県", "address": "兵庫県神戸市中央区港島南町7-1-56", "note": "営業・一般利用可否は未確認です。"}, {"key": "jpa:padel-dojo", "name": "PADEL DOJO", "prefecture": "兵庫県", "address": "兵庫県尼崎市南城内14-2", "note": "営業・一般利用可否は未確認です。"}, {"key": "jpa:padelvista-imabari", "name": "Padelvista imabari", "prefecture": "愛媛県", "address": "愛媛県今治市湯ノ浦12", "note": "営業・一般利用可否は未確認です。"}, {"key": "jpa:padel-fukuoka", "name": "パデル福岡", "prefecture": "福岡県", "address": "福岡県福岡市東区香椎浜三丁目1番3号　香椎いーなテラス内", "note": "営業・一般利用可否は未確認です。"}]'::jsonb)
 AS x(key text,name text,prefecture text,address text,note text) LOOP
  SELECT array_agg(id) INTO ids FROM public.padel_facilities
   WHERE facility_key=item.key OR EXISTS(
    SELECT 1 FROM unnest(aliases||ARRAY[name]) candidate
    WHERE lower(regexp_replace(normalize(candidate,NFKC),'[[:space:]・&＆]+','','g'))
     =lower(regexp_replace(normalize(item.name,NFKC),'[[:space:]・&＆]+','','g')));
  IF coalesce(cardinality(ids),0)=0 THEN
   INSERT INTO public.padel_facilities(name,prefecture,address,source_url,facility_key,aliases,availability,usage_note,verified_on)
   VALUES(item.name,item.prefecture,item.address,'https://www.japanpadel.com/court-list/',item.key,'{}','unverified',item.note,NULL);
   added:=added+1;
  ELSIF cardinality(ids)=1 THEN
   SELECT * INTO STRICT existing FROM public.padel_facilities WHERE id=ids[1];
   IF (existing.facility_key IS NOT NULL AND existing.facility_key<>item.key)
    OR existing.prefecture IS NULL
    OR regexp_replace(existing.prefecture,'[都府県]$','')<>regexp_replace(item.prefecture,'[都府県]$','')
   THEN RAISE EXCEPTION '0053_existing_facility_conflict';END IF;
   reused:=reused+1; -- 同一施設があれば既存ID・値を保持し、重複追加しない。
  ELSE RAISE EXCEPTION '0053_ambiguous_facility';END IF;
 END LOOP;
 PERFORM set_config('padel.facilities_added',added::text,true);
 PERFORM set_config('padel.facilities_reused',reused::text,true);
END $jpa$;
SELECT json_build_object('added',current_setting('padel.facilities_added')::int,'already_present',current_setting('padel.facilities_reused')::int,'total',(SELECT count(*) FROM public.padel_facilities));
COMMIT;
