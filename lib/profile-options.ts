export const BROAD_ACTIVITY_AREAS = ["東北","関東","中部","北陸","関西","中国","四国","九州"] as const;
export const PREFECTURES = ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"] as const;
export function legacyActivityArea(value: string): string | null {
 return value && ![...BROAD_ACTIVITY_AREAS,...PREFECTURES].some(area=>area===value)?value:null;
}
export function homeCourtName(value: string): string | null {
 const name=value.trim();
 if(Array.from(name).length>80||/[\u0000-\u001f\u007f-\u009f]/u.test(name))throw new Error("ホームコートは80文字以内のコート名を入力してください");
 return name||null;
}
export function profileGroupPreview<T>(groups: readonly T[]) {
 return { visible: groups.slice(0,3), all: [...groups], hasMore: groups.length>3 };
}
