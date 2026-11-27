import { isSupportedInviteEmail } from "./club-invite-email";
// Server-side adapter. It cannot choose its recipient; callers must pass the
// private claim returned by the service-only claim RPC. No automatic retry.
export type MailClaim = {inviteId:string;generation:number;email:string;secret:string;clubName:string;memberName:string;inviterName:string};
export type MailResult = {result:"sent";failure:null}|{result:"failed";failure:"smtp_rejected"|"pre_data_failure"}|{result:"unknown";failure:"uncertain"};
export type SmtpSocket = {readable:ReadableStream<Uint8Array>;writable:WritableStream<Uint8Array>;close:()=>void|Promise<void>};
export type SmtpConnect = (address:{hostname:string;port:number},options:{secureTransport:"on"})=>SmtpSocket;
const from="padelclubwebapp@gmail.com", encoder=new TextEncoder();
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escapeHtml=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
function base64(s:string){let raw="";for(const b of encoder.encode(s))raw+=String.fromCharCode(b);return btoa(raw);}
export function invitationMime(c:MailClaim,origin:string):string {
 if(!isSupportedInviteEmail(c.email)||!uuidPattern.test(c.inviteId)||!Number.isSafeInteger(c.generation)||c.generation<1||!/^[0-9a-f]{64}$/.test(c.secret))throw Error("invalid claim");
 const base=new URL(origin);if(base.protocol!=="https:"||base.username||base.password||base.pathname!=="/"||base.search||base.hash)throw Error("invalid origin");
 if(![c.clubName,c.memberName,c.inviterName].every(n=>typeof n==="string"&&n.length>0&&n.length<=200&&!/[\u0000-\u001f\u007f-\u009f]/u.test(n)))throw Error("invalid names");
 const fragment=new URLSearchParams({invite:c.inviteId,generation:String(c.generation),secret:c.secret});
 const link=base.origin+"/profile/invitations/redeem#"+fragment.toString();
 const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><body><h1>グループへの招待</h1><p>${escapeHtml(c.inviterName)}さんから、${escapeHtml(c.clubName)}へ招待されました。</p><p>対象：${escapeHtml(c.memberName)}</p><p><a href="${escapeHtml(link)}">招待を確認する</a></p><p>このリンクは本人専用です。第三者へ転送・共有しないでください。</p></body></html>`;
 const body=base64(html).match(/.{1,76}/g)?.join("\r\n")??"";
 return `From: PADEL MATCH <${from}>\r\nTo: <${c.email}>\r\nSubject: =?UTF-8?B?${base64("パデルグループへの招待")}?=\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${body}\r\n.\r\n`;
}
export async function sendInvitationSmtp(connect:SmtpConnect,c:MailClaim,origin:string,password:string,timeoutMs=20000):Promise<MailResult>{
 let socket:SmtpSocket|undefined,timer:ReturnType<typeof setTimeout>|undefined,dataStarted=false;
 try {
  if(!password||/[\r\n\0]/.test(password))throw Error();const mime=invitationMime(c,origin);
  socket=connect({hostname:"smtp.gmail.com",port:465},{secureTransport:"on"});const reader=socket.readable.getReader(),writer=socket.writable.getWriter();let buffer="";
  timer=setTimeout(()=>{try{Promise.resolve(socket?.close()).catch(()=>{});}catch{}},timeoutMs);const decoder=new TextDecoder();
  async function reply(expected:number[]){for(;;){let at=buffer.indexOf("\n");while(at!==-1){const line=buffer.slice(0,at).replace(/\r$/,"");buffer=buffer.slice(at+1);const m=/^(\d{3})([ -])/.exec(line);if(!m)throw Error();if(m[2]===" "){const code=Number(m[1]);if(!expected.includes(code))throw Object.assign(Error(),{smtpCode:code});return;}at=buffer.indexOf("\n");}const chunk=await reader.read();if(chunk.done)throw Error();buffer+=decoder.decode(chunk.value,{stream:true});if(buffer.length>16384)throw Error();}}
  async function command(s:string,codes:number[]){await writer.write(encoder.encode(s+"\r\n"));await reply(codes);}
  await reply([220]);await command("EHLO padel.invalid",[250]);await command("AUTH LOGIN",[334]);await command(btoa(from),[334]);await command(btoa(password.replace(/\s/g,"")),[235]);await command(`MAIL FROM:<${from}>`,[250]);await command(`RCPT TO:<${c.email}>`,[250,251]);await command("DATA",[354]);dataStarted=true;await writer.write(encoder.encode(mime));await reply([250]);return {result:"sent",failure:null};
 }catch(e){const code=typeof e==="object"&&e!==null&&"smtpCode" in e?Number(e.smtpCode):0;if(code>=400&&code<=599)return {result:"failed",failure:"smtp_rejected"};return dataStarted?{result:"unknown",failure:"uncertain"}:{result:"failed",failure:"pre_data_failure"};}
 finally{if(timer)clearTimeout(timer);try{await socket?.close();}catch{}}
}
