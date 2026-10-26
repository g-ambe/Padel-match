// 文章をDOMへ表示しない。古いブラウザでは一時的なcopyイベントだけで代替する。
export async function copyMatchShareText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // 権限拒否などでも、ユーザー操作中に利用できる従来のコピーを試す。
  }
  let copied = false;
  const onCopy = (event: ClipboardEvent) => {
    event.preventDefault();
    if (!event.clipboardData) return;
    try {
      event.clipboardData.setData("text/plain", text);
      copied = true;
    } catch {
      copied = false;
    }
  };
  document.addEventListener("copy", onCopy);
  try {
    if (!document.execCommand?.("copy") || !copied) throw new Error("文章のコピーに失敗しました");
  } finally {
    document.removeEventListener("copy", onCopy);
  }
}

export function openLineShare(url: string) {
  let popup: Window | null = null;
  try {
    popup = window.open("", "_blank");
    if (!popup) return false;
    popup.opener = null;
    popup.location.replace(url);
    return true;
  } catch {
    try { popup?.close(); } catch { /* 開始失敗としてコピーへ切り替える。 */ }
    return false;
  }
}
