import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticatedMediaClient, type MediaEnv } from "@/lib/profile-media/server";
import { groupMemberAvatarResponse } from "@/lib/group-member-avatar-server";

export async function GET(request: Request, context: { params: Promise<{ clubId: string; memberId: string }> }) {
  const { clubId, memberId } = await context.params;
  return groupMemberAvatarResponse(request, clubId, memberId, async request => {
    const { db } = await authenticatedMediaClient(request);
    const { env } = await getCloudflareContext({ async: true });
    const media = env as MediaEnv;
    return { proof: media.PROFILE_MEDIA_COMMIT_SECRET, bucket: media.PROFILE_IMAGES,
      lookup: async (club, member, proof) => db.rpc("get_group_member_avatar_for_worker",
        { p_club_id: club, p_member_id: member, p_proof: proof }) };
  });
}
