export type AppRole = "super_user" | "main_admin" | "sub_admin" | "member";

type Ctx = { isSuperUser: boolean; myRole: "main_admin" | "sub_admin" | "member" };

export const toAppRole = ({ isSuperUser, myRole }: Ctx): AppRole => (isSuperUser ? "super_user" : myRole);

export const canEditGroupProfile = (ctx: Ctx) => ctx.isSuperUser || ctx.myRole === "main_admin";
export const canDeleteGroup = (ctx: Ctx) => ctx.isSuperUser || ctx.myRole === "main_admin";
export const canManageMembers = (ctx: Ctx) => ctx.isSuperUser || ctx.myRole === "main_admin" || ctx.myRole === "sub_admin";
export const canManageEvents = (ctx: Ctx) => true; // memberもイベント編集可（現行仕様維持）

export const canSubAdminEditTarget = (ctx: Ctx, targetRole: "main_admin" | "sub_admin" | "member") => {
  if (ctx.isSuperUser) return true;
  if (ctx.myRole !== "sub_admin") return true;
  return targetRole !== "main_admin";
};

export const canDeactivateSelf = (memberProfileId: string | null, myProfileId: string | null) => memberProfileId !== myProfileId;
