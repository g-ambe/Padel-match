const {test}=require('node:test'),assert=require('node:assert/strict');
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
test('ローカルWorkersのR2 Bindingで条件付きPUT/HEAD/削除・RateLimit Bindingを確認する',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:`export default {async fetch(request,env){return Response.json(await env.PROFILE_MEDIA_RATE_LIMITER.limit({key:'synthetic'}));}}`,r2Buckets:['PROFILE_IMAGES'],ratelimits:{PROFILE_MEDIA_RATE_LIMITER:{namespace_id:'4801',simple:{limit:10,period:60}}}}));
 try{
  const bucket=await mf.getR2Bucket('PROFILE_IMAGES'),key='profiles/synthetic/request.webp',bytes=new Uint8Array([1,2,3]),opts={onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'image/webp'},customMetadata:{sha256:'synthetic-hash'}};
  const first=await bucket.put(key,bytes,opts);assert.equal(first.key,key);assert.equal(first.size,3);
  assert.equal(await bucket.put(key,new Uint8Array([9]),opts),null,'リトライでも既存オブジェクトを上書きしない');
  const head=await bucket.head(key);assert.equal(head.customMetadata.sha256,'synthetic-hash');assert.equal(head.size,3);
  const data=await bucket.get(key);assert.deepEqual(new Uint8Array(await data.arrayBuffer()),bytes);
  await bucket.delete(key);assert.equal(await bucket.head(key),null);
  const decisions=[];for(let i=0;i<20;i++)decisions.push((await (await mf.dispatchFetch('https://local.invalid/')).json()).success);
  assert.equal(decisions[0],true);assert(decisions.includes(false));
 }finally{await mf.dispose();}
});
