// Invitation transport supports ASCII dot-atom local parts and ASCII domains,
// including pre-encoded Punycode. This does not normalize existing accounts.
const pattern=/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
export function isSupportedInviteEmail(value:string):boolean {
 return value.length<=254 && value.indexOf('@')<=64 && pattern.test(value);
}
