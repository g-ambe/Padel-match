// Supabaseの取得上限で履歴が欠けないよう、必要なページだけを読む。
export async function readFriendlyRoundRows<T>(fetchPage: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  try {
    for (let start = 0; ; start += 500) {
      const { data, error } = await fetchPage(start, start + 499);
      if (error || !Array.isArray(data)) throw new Error("履歴を取得できませんでした");
      rows.push(...data);
      if (data.length < 500) return { data: rows, error: null };
    }
  } catch {
    return { data: null, error: new Error("試合履歴・参加者を確認できませんでした。再試行してください") };
  }
}
