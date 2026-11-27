import type {MailClaim,MailResult} from "./club-invite-smtp";
type Reservation = {status:string;operation_id?:string;generation?:number};
export type Claim = {status:string;kind?:string;operation_id?:string;generation?:number;invite_id?:string;email?:string;secret?:string;club_name?:string;member_name?:string;inviter_name?:string};
export type DeliveryDependencies = {reserve:()=>Promise<Reservation>;claim:(id:string)=>Promise<Claim>;send:(claim:MailClaim)=>Promise<MailResult>;finalize:(id:string,generation:number,result:MailResult)=>Promise<{status:string}>};
export type PublicDelivery = {status:"sent"|"failed"|"unknown"|"temporarily_unavailable"};
// Service-only orchestration. Never return the claimed address or link secret.
export async function deliverClaimedInvitation(operationId:string,deps:DeliveryDependencies):Promise<PublicDelivery>{
 let reservation:Reservation;try{reservation=await deps.reserve();}catch{return {status:"unknown"};}
 // A replay in any later state must never cause another delivery attempt.
 if(reservation.status!=="reserved")return {status:reservation.status==="sent"?"sent":reservation.status==="unknown"||reservation.status==="sending"?"unknown":"temporarily_unavailable"};
 if(reservation.operation_id!==operationId||!Number.isSafeInteger(reservation.generation)||Number(reservation.generation)<=0)return {status:"unknown"};
 let claim:Claim;try{claim=await deps.claim(operationId);}catch{return {status:"unknown"};}
 if(claim.status!=="claimed")return {status:claim.status==="unknown"||claim.status==="sending"?"unknown":"temporarily_unavailable"};
 if(claim.kind!=="group_invite"||claim.operation_id!==operationId||claim.generation!==reservation.generation||typeof claim.email!=="string"||typeof claim.secret!=="string"||typeof claim.invite_id!=="string"||typeof claim.club_name!=="string"||typeof claim.member_name!=="string"||typeof claim.inviter_name!=="string")return {status:"unknown"};
 const safeClaim:MailClaim={inviteId:claim.invite_id,generation:claim.generation!,email:claim.email,secret:claim.secret,clubName:claim.club_name,memberName:claim.member_name,inviterName:claim.inviter_name};
 let result:MailResult;try{result=await deps.send(safeClaim);}catch{result={result:"unknown",failure:"uncertain"};}
 try{const final=await deps.finalize(operationId,claim.generation!,result);return {status:final.status==="sent"?"sent":final.status==="failed"?"failed":"unknown"};}catch{return {status:"unknown"};}
}
