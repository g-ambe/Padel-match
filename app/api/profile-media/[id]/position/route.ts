import { mediaContext, limitedBody, jsonResponse, mediaError } from "@/lib/profile-media/server";
import { MediaFailure } from "@/lib/profile-media/service";
import { validAvatarPosition } from "@/lib/profile-media/position";
import type { PrivateProfile } from "@/lib/profile-media/shared";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params, c = await mediaContext(request, id, true);
    const bytes = await limitedBody(request);
    if (bytes.length > 1024) throw new MediaFailure("入力が長すぎます", 413);
    let value;
    try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new MediaFailure("写真の表示設定を確認してください", 400); }
    if (!value || !validAvatarPosition(value.position) || !Number.isSafeInteger(value.avatarVersion) || value.avatarVersion < 0
      || !Number.isSafeInteger(value.poseVersion) || value.poseVersion < 0) throw new MediaFailure("写真の表示設定を確認してください", 400);
    const profile = await c.rpc<PrivateProfile>("save_my_avatar_position", {
      p_profile: id, p_expected_avatar: value.avatarVersion, p_expected_pose: value.poseVersion,
      p_x: value.position.x, p_y: value.position.y, p_zoom: value.position.zoom, p_ticket: c.ticket
    });
    return jsonResponse({ profile });
  } catch (error) { return mediaError(error); }
}
