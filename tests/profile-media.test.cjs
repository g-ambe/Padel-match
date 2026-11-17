const {test}=require('node:test'),assert=require('node:assert/strict');
require('node:module').registerHooks({resolve(s,c,next){return next(s==='./shared'&&c.parentURL?.includes('/profile-media/')?'./shared.ts':s,c);}});
const {instagramUsername,instagramHref,validateWebp,stripWebpMetadata,mergePrivateProfile,IMAGE_LIMIT}=require('../lib/profile-media/shared.ts');
const {changeImage,collectGarbage,MediaFailure}=require('../lib/profile-media/service.ts');
function webp(w=512,h=256){const a=new Uint8Array(26),v=new DataView(a.buffer);a.set(Buffer.from('RIFF'));v.setUint32(4,18,true);a.set(Buffer.from('WEBPVP8L'),8);v.setUint32(16,5,true);a[20]=0x2f;v.setUint32(21,(w-1)|((h-1)<<14),true);return a;}
test('Instagramはユーザーネームだけを正規化し、任意URL・スキーム・不正な点を拒否',()=>{
 for(const [v,out] of [[' @player.name_01 ','player.name_01'],['',''],['player','player']])assert.equal(instagramUsername(v),out||null);
 for(const v of ['https://instagram.com/test','javascript:alert(1)','foo/bar','a..b','@.bad','bad.','a'.repeat(31),'@@bad','日本語'])assert.throws(()=>instagramUsername(v));
 assert.equal(instagramHref('@name_01'),'https://www.instagram.com/name_01/');
});
test('WebPの実ヘッダー・寸法・容量・RIFF長を検査し、他形式とメタデータを拒否',()=>{
 assert.deepEqual(validateWebp(webp()),{width:512,height:256});
 for(const bytes of [new Uint8Array(0),new Uint8Array(IMAGE_LIMIT+1),Buffer.from('<svg onload=alert(1)>'),webp(513,1),webp(1,513)])assert.throws(()=>validateWebp(bytes));
 const wrong=webp();wrong[4]=0;assert.throws(()=>validateWebp(wrong));
 const exif=new Uint8Array(34);exif.set(webp());exif.set(Buffer.from('EXIF'),26);new DataView(exif.buffer).setUint32(4,26,true);assert.throws(()=>validateWebp(exif));
});
function setup(){
 const old='profiles/old.webp',fresh='profiles/new.webp',profile={profile_id:'p',owner_id:'u',instagram_username:null,instagram_version:0,avatar_version:1,avatar_key:old};
 let op={request_id:'r',status:'pending',object_key:fresh,old_key:old};let db={...profile},calls=[],objects=new Map([[old,{size:26}]]),fail={};
 const bucket={put:async(key,bytes,options)=>{calls.push(['put',key]);if(fail.put)throw Error('storage failure');if(objects.has(key))return null;const obj={key,size:bytes.byteLength,customMetadata:options.customMetadata};objects.set(key,obj);return obj;},head:async key=>objects.get(key)||null,delete:async key=>{calls.push(['delete',key]);if(fail.delete)throw Error();objects.delete(key);},get:async()=>null};
 const rpc=async(name,args)=>{calls.push([name,args]);if(name==='prepare_profile_image'){if(fail.prepare)throw new MediaFailure('quota',429);return {profile:db,operation:op};}
 if(name==='commit_profile_image'){if(fail.commit)throw new MediaFailure('db failure',503,true);if(op.status!=='committed'){op.status='committed';db={...db,avatar_key:fresh,avatar_version:2};}if(fail.reply)throw Error('reply lost');return db;}
 if(name==='abort_profile_image'){if(op.status==='committed')return false;op.status='aborted';return true;}
 if(name==='profile_media_gc_candidates')return [old,fresh];if(name==='claim_profile_media_gc')return args.p_key!==db.avatar_key;if(name==='finish_profile_media_gc')return null;
 };
 const run=()=>changeImage({profile:'p',request:'r',version:1,kind:'upload',ticket:'t',bytes:webp(),proof:'secret',bucket,rpc,read:async()=>{if(fail.read)throw Error();return {profile:db,operation:op};}});
 return {old,fresh,fail,objects,calls,bucket,rpc,run,get db(){return db;},get op(){return op;}};
}
test('差替え成功の後だけ旧画像を回収し、現参照は削除しない',async()=>{const f=setup();const out=await f.run();assert.equal(out.avatar_key,f.fresh);assert(f.objects.has(f.old));await collectGarbage(f.rpc,f.bucket,'secret');assert(!f.objects.has(f.old));assert(f.objects.has(f.fresh));});
test('R2/DB失敗では新参照へ切り替えず、未参照画像は24hの回収処理へ残す',async()=>{for(const kind of ['put','commit']){const f=setup();f.fail[kind]=true;await assert.rejects(f.run(),/以前の画像/);assert.equal(f.db.avatar_key,f.old);assert(f.objects.has(f.old));assert(!f.calls.some(c=>c[0]==='delete'));assert.equal(f.op.status,'aborted');}});
test('DB応答喪失は実際の確定状態から復旧し、再試行で上書き・二重更新しない',async()=>{const f=setup();f.fail.reply=true;assert.equal((await f.run()).avatar_key,f.fresh);assert.equal((await f.run()).avatar_version,2);assert.equal(f.calls.filter(c=>c[0]==='put').length,1);});
test('確定状態を取得できなければ成功・失敗を推測せず、画像を削除しない',async()=>{const f=setup();f.fail.commit=true;f.fail.read=true;await assert.rejects(f.run(),e=>e.uncertain===true);assert.equal(f.db.avatar_key,f.old);assert(!f.calls.some(c=>c[0]==='delete'||c[0]==='abort_profile_image'));});
test('旧画像削除失敗でも新参照を維持し、後日の再試行へ残す',async()=>{const f=setup();await f.run();f.fail.delete=true;await collectGarbage(f.rpc,f.bucket,'secret');assert.equal(f.db.avatar_key,f.fresh);assert(f.objects.has(f.old));assert(!f.calls.some(c=>c[0]==='finish_profile_media_gc'));});
test('上限拒否時はR2へ新規書込みせず、PUT応答喪失後の同一キーはハッシュ確認で復旧する',async()=>{const f=setup();f.fail.prepare=true;await assert.rejects(f.run(),/quota/);assert(!f.calls.some(c=>c[0]==='put'));const g=setup();const hash=Buffer.from(await crypto.subtle.digest('SHA-256',webp())).toString('hex');g.objects.set(g.fresh,{key:g.fresh,size:26,customMetadata:{sha256:hash}});assert.equal((await g.run()).avatar_key,g.fresh);});

test('Canvasの色プロファイル・EXIF・XMPを削除しても寸法を維持し、サーバーは除去前を拒否する',()=>{
 const frame=webp(),extended=new Uint8Array(18),icc=new Uint8Array(16),exif=new Uint8Array(16),xmp=new Uint8Array(16);
 extended.set(Buffer.from('VP8X'));new DataView(extended.buffer).setUint32(4,10,true);extended[8]=0x20|0x08|0x04;extended[12]=255;extended[13]=1;extended[15]=255;
 for(const [a,name] of [[icc,'ICCP'],[exif,'EXIF'],[xmp,'XMP ']]){a.set(Buffer.from(name));new DataView(a.buffer).setUint32(4,8,true);a.set(Buffer.from('metadata'),8);}
 const total=12+extended.length+icc.length+exif.length+xmp.length+frame.length-12,raw=new Uint8Array(total);raw.set(frame.subarray(0,12));let at=12;for(const c of [extended,icc,exif,xmp,frame.subarray(12)]){raw.set(c,at);at+=c.length;}new DataView(raw.buffer).setUint32(4,total-8,true);assert.throws(()=>validateWebp(raw));
 const clean=stripWebpMetadata(raw);assert.deepEqual(validateWebp(clean),{width:512,height:256});assert(!Buffer.from(clean).includes(Buffer.from('metadata')));
});

test('GCの開始に失敗しても、DB確定済みの新画像への切替は成功として維持する',async()=>{const f=setup();const out=await changeImage({profile:'p',request:'r',version:1,kind:'upload',ticket:'t',bytes:webp(),proof:'secret',bucket:f.bucket,rpc:f.rpc,read:async()=>({profile:f.db,operation:f.op}),onCommitted:()=>{throw Error('schedule failed');}});assert.equal(out.avatar_key,f.fresh);});

test('画像・Instagramの応答が逆転しても、各項目の新しい版と所有者分離を維持する',()=>{
 const current={profile_id:'p',owner_id:'u',avatar_key:'new.webp',avatar_version:2,instagram_username:'new',instagram_version:3};
 assert.deepEqual(mergePrivateProfile(current,{...current,avatar_version:1,avatar_key:'old.webp'}),current);
 assert.deepEqual(mergePrivateProfile(current,{...current,instagram_version:2,instagram_username:'old'}),current);
 const next=mergePrivateProfile(current,{...current,avatar_version:3,avatar_key:'latest.webp',instagram_version:2,instagram_username:'old'});assert.equal(next.avatar_version,3);assert.equal(next.instagram_username,'new');
 const other={...current,owner_id:'other',avatar_version:0,avatar_key:null,instagram_username:null,instagram_version:0};assert.equal(mergePrivateProfile(current,other),other);
});
