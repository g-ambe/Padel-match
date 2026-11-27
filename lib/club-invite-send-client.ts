export class InviteDeliveryNotReady extends Error {}
export async function requestInviteDelivery(accessToken:string,body:Record<string,unknown>):Promise<string>{
 const response=await fetch('/api/club-invitations/send',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${accessToken}`},body:JSON.stringify(body),cache:'no-store'});
 const data=await response.json();
 if(response.status===503&&data?.status==='not_ready')throw new InviteDeliveryNotReady();
 if(!response.ok||!data||typeof data.status!=='string')throw new Error('delivery result unavailable');
 return data.status;
}
