import { IMAGE_LIMIT, isUuid } from "./profile-media/shared";
import { validAvatarPosition } from "./profile-media/position";
import { MediaFailure, type Bucket } from "./profile-media/service";

export type GroupAvatarContext = {
  proof?: string;
  bucket?: Pick<Bucket, "get">;
  lookup: (club: string, member: string, proof: string) => Promise<{ data: unknown; error: { code?: string } | null }>;
};
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization", "X-Content-Type-Options": "nosniff" };
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

// The caller supplies only club/member IDs. R2 keys and Worker proof never leave here.
export async function groupMemberAvatarResponse(request: Request, club: string, member: string,
  authenticate: (request: Request) => Promise<GroupAvatarContext>) {
  try {
    const context = await authenticate(request);
    if (!isUuid(club) || !isUuid(member)) throw new MediaFailure("画像を確認できません", 404);
    if (!context.proof || !context.bucket) throw new MediaFailure("画像を取得できません", 503);
    const { data, error } = await context.lookup(club, member, context.proof);
    if (error) throw new MediaFailure("画像を取得できません", error.code === "42501" ? 404 : 503);
    if (!Array.isArray(data)) throw new MediaFailure("画像を取得できません", 503);
    if (!data.length) throw new MediaFailure("画像を確認できません", 404);
    if (data.length !== 1) throw new MediaFailure("画像を取得できません", 503);
    const row = data[0];
    const position = { x: row?.avatar_focus_x, y: row?.avatar_focus_y, zoom: row?.avatar_zoom };
    if (!row || !isUuid(row.profile_id) || typeof row.avatar_key !== "string"
      || !new RegExp(`^profiles/${row.profile_id}/${uuid}[.]webp$`).test(row.avatar_key)
      || !validAvatarPosition(position)
      || !Number.isSafeInteger(row.avatar_version) || row.avatar_version < 0
      || !Number.isSafeInteger(row.avatar_pose_version) || row.avatar_pose_version < 0) {
      throw new MediaFailure("画像を取得できません", 503);
    }
    const image = await context.bucket.get(row.avatar_key);
    if (!image) throw new MediaFailure("画像を確認できません", 404);
    if (!Number.isSafeInteger(image.size) || image.size <= 0 || image.size > IMAGE_LIMIT) {
      throw new MediaFailure("画像を取得できません", 503);
    }
    return new Response(image.body, { headers: { ...headers, "Content-Type": "image/webp",
      "X-Avatar-Focus-X": String(position.x), "X-Avatar-Focus-Y": String(position.y),
      "X-Avatar-Zoom": String(position.zoom) } });
  } catch (error) {
    const status = error instanceof MediaFailure && [401, 404, 503].includes(error.status) ? error.status : 503;
    return Response.json({ error: status === 401 ? "ログインしてください" : status === 404 ? "画像を確認できません" : "画像を取得できません" }, { status, headers });
  }
}
