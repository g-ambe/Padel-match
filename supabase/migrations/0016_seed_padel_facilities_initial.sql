insert into padel_facilities (name, prefecture, address, source_url)
values
('パデル東京','東京',null,'https://www.japanpadel.com/'),
('パデルワンところざわ','埼玉',null,'https://www.japanpadel.com/'),
('パデル＆フットサル 晴れのち晴れ','東京',null,'https://www.japanpadel.com/'),
('パデル東京ミズマチ','東京',null,'https://www.japanpadel.com/'),
('キャプテン翼パデル 調布','東京',null,'https://www.japanpadel.com/'),
('アッセンブル大宮','埼玉',null,'https://www.japanpadel.com/'),
('GIARDINO','千葉',null,'https://www.japanpadel.com/'),
('パデルアカデミア佐倉','千葉',null,'https://www.japanpadel.com/'),
('茅ヶ崎パデルクラブ','神奈川',null,'https://www.japanpadel.com/')
on conflict (name) do update set
  prefecture = excluded.prefecture,
  address = coalesce(padel_facilities.address, excluded.address),
  source_url = excluded.source_url;
