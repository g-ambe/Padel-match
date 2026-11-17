import { IMAGE_LIMIT, stripWebpMetadata } from "./shared";
let compatibleEncoder: Promise<typeof import("@jsquash/webp/encode.js")> | undefined;
function loadCompatibleEncoder() {
  if (!compatibleEncoder) {
    compatibleEncoder = import("@jsquash/webp/encode.js").then(async encoder => {
      await encoder.init();
      return encoder;
    });
    // 読込み失敗を固定せず、利用者の再試行では初期化し直す。
    void compatibleEncoder.catch(() => { compatibleEncoder = undefined; });
  }
  return compatibleEncoder;
}
// Canvasへ描き直し、元ファイルのEXIF/位置情報等を引き継がない。
export async function compressProfileImage(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp|avif)$/.test(file.type) || file.size > 20 * 1024 * 1024) throw new Error("20MB以下のJPEG・PNG・WebP・AVIF画像を選択してください");
  const source = URL.createObjectURL(file), image = new Image();
  try {
    image.src = source; await image.decode();
    const w = image.naturalWidth, h = image.naturalHeight;
    if (!w || !h || w * h > 40_000_000) throw new Error("画像が大きすぎます。小さい画像を選択してください");
    let scale = Math.min(1, 512 / Math.max(w, h));
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { colorSpace: "srgb" });
    if (!ctx) throw new Error("画像を変換できませんでした");
    let result: Blob | null = null;
    let nativeEncoding = true;
    for (let step = 0; step < 8; step++) {
      canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale));
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const quality = Math.max(0.5, 0.85 - step * 0.05);
      if (nativeEncoding) {
        try { result = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", quality)); }
        catch { result = null; }
        nativeEncoding = result?.type === "image/webp";
      }
      if (!nativeEncoding) {
        // WebPの表示対応とCanvasの符号化対応は別。PNGへ戻るブラウザでも端末内で変換する。
        const encoder = await loadCompatibleEncoder();
        const encoded = await encoder.default(ctx.getImageData(0, 0, canvas.width, canvas.height), { quality: Math.round(quality * 100) });
        result = new Blob([encoded], { type: "image/webp" });
      }
      if (!result) throw new Error("画像を変換できませんでした。以前の画像は維持されています");
      if (result.size <= 100 * 1024) break;
      if (step >= 3) scale *= 0.85;
    }
    if (!result || result.size > IMAGE_LIMIT) throw new Error("画像を200KB以下に圧縮できませんでした");
    const cleaned=stripWebpMetadata(new Uint8Array(await result.arrayBuffer()));
    return new Blob([cleaned.slice().buffer as ArrayBuffer],{type:"image/webp"});
  } catch(error) { throw new Error(error instanceof Error && /[一-龯ぁ-んァ-ヶ]/.test(error.message) ? error.message : "画像を変換できませんでした。以前の画像は維持されています"); }
  finally { URL.revokeObjectURL(source); }
}
