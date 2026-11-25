import type { SVGProps } from "react";
export function GroupActionIcon({name,...props}: SVGProps<SVGSVGElement> & {name:"left"|"right"|"up"|"down"|"settings"|"info"|"pencil"|"check"}) {
 const paths={left:"m15 18-6-6 6-6",right:"m9 6 6 6-6 6",up:"m6 15 6-6 6 6",down:"m6 9 6 6 6-6",pencil:"m16 3 5 5-12 12-6 1 1-6Z M14 5l5 5",check:"m8 12 3 3 5-6",info:"M12 11v6 M12 7h.01",settings:"m9 3-1 3-3 1-2 3 2 2-1 3 3 3 3-1 2 2 3-2 1-3 3-1 1-3-2-2V7l-3-1-2-3Z"};
 return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{(name==="info"||name==="check")&&<circle cx="12" cy="12" r="9"/>}{name==="settings"&&<circle cx="12" cy="12" r="3"/>}<path d={paths[name]}/></svg>;
}
