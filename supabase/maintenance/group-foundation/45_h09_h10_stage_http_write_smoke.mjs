/**
 * TASK-08 H09/H10: STAGING-ONLY, one-time, isolated real Auth + PostgREST test.
 * Precondition: 43_h09_h10_stage_http_fixture_setup.sql created the private
 * synthetic club and unlinked player. Always execute guarded cleanup 44 after.
 * Uses only synthetic club/member records. Existing linked owner save is a
 * true no-op (all six values preserved). Never print IDs/tokens/profile content.
 */
import { createClient } from '@supabase/supabase-js';

const url = 'https://zzjwpresqkefnyjyisgd.supabase.co';
const name = 'TASK08-H09H10-HTTP-20261119';
const unlinkedName = 'TASK08-H09H10-HTTP-UNLINKED';
const renamed = 'TASK08-H09H10-HTTP-RENAMED';
const fields = ['display_name', 'bio', 'play_level', 'dominant_hand', 'preferred_position', 'activity_area'];
const results = [];
function mark(id, actor, expectation, pass, detail = {}) {
  results.push({ id, actor, expectation, outcome: pass ? 'PASS' : 'FAIL', ...detail });
  if (!pass) process.exitCode = 1;
}
function safe(res) {
  return { http_status: res?.status ?? null, error_code: res?.error?.code ?? null,
    row_count: Array.isArray(res?.data) ? res.data.length : res?.data ? 1 : 0,
    count: typeof res?.count === 'number' ? res.count : null };
}
function rejected(res, codes = ['42501']) {
  return !!res?.error && codes.includes(res.error.code) &&
    [400,401,403,409].includes(res.status) && res.data === null;
}
function noRows(res) {
  return !res.error && res.status === 200 &&
    Array.isArray(res.data) && res.data.length === 0 &&
    (res.count === 0 || res.count === null);
}
function client(key) {
  return createClient(url, key, { auth: { persistSession: false,
    autoRefreshToken: false, detectSessionInUrl: false } });
}
async function run() {
  const k = process.env.TASK08_STAGING_PUBLISHABLE_KEY;
  if (process.env.TASK08_STAGE_H09_H10_WRITE !== '1' ||
    !k?.startsWith('sb_publishable_') ||
    ['TASK08_STAGING_MAIN_A_PASSWORD','TASK08_STAGING_RECIPIENT_PASSWORD','TASK08_STAGING_OUTSIDER_PASSWORD']
      .some(x => !process.env[x])) {
    results.push({id:'SETUP',expectation:'staging-only opt-in and all test credentials',outcome:'BLOCKED'});
    process.exitCode = 2; return;
  }
  const main=client(k), recipient=client(k), outsider=client(k);
  try {
    const actors=[
      [main,'main-A@example.com',process.env.TASK08_STAGING_MAIN_A_PASSWORD],
      [recipient,'recipient@example.com',process.env.TASK08_STAGING_RECIPIENT_PASSWORD],
      [outsider,'outsider@example.com',process.env.TASK08_STAGING_OUTSIDER_PASSWORD],
    ];
    const ids=[];
    for (const [c,email,password] of actors) {
      const res=await c.auth.signInWithPassword({email,password});
      if (res.error || !res.data?.user?.id || !res.data?.session?.access_token) {
        results.push({id:'AUTH',expectation:'all three stage fixture actors logged in',outcome:'BLOCKED'});
        process.exitCode = 2; return;
      }
      ids.push(res.data.user.id);
    }
    mark('AUTH','all','3 staged test Auth users signed in',true);
    const [mainId,recipientId,outsiderId]=ids;

    // owner_id is intentionally NOT readable to authenticated users. The
    // fixture creation SQL already checks owner_id=mainA; only read public
    // columns here so the HTTP test does not weaken or bypass that ACL.
    const club=await main.from('clubs').select('id,name,visibility')
      .eq('name',name).single();
    if (club.error || club.data?.name!==name || club.data?.visibility!=='private') {
      results.push({id:'FIXTURE',expectation:'exact one private staged club owned by mainA',outcome:'BLOCKED',...safe(club)});
      process.exitCode=2;return;
    }
    const clubId=club.data.id;
    const roster=await main.from('club_members')
      .select('id,club_id,profile_id,player_profile_id,role,is_active')
      .eq('club_id',clubId);
    if(roster.error||roster.data?.length!==3||
      roster.data.filter(r=>r.role==='main_admin'&&r.profile_id===mainId).length!==1||
      roster.data.filter(r=>r.role==='sub_admin'&&r.profile_id===outsiderId).length!==1||
      roster.data.filter(r=>r.role==='member'&&r.profile_id===null).length!==1) {
      results.push({id:'FIXTURE_ROSTER',expectation:'exactly 3 synthetic members with designated roles',outcome:'BLOCKED',...safe(roster)});
      process.exitCode=2;return;
    }
    const mainMember=roster.data.find(r=>r.role==='main_admin');
    const unlinkedMember=roster.data.find(r=>r.role==='member');
    const unlinked=await main.from('player_profiles')
      .select('id,display_name,linked_auth_user_id').eq('id',unlinkedMember.player_profile_id).single();
    if(unlinked.error || unlinked.data?.linked_auth_user_id!==null ||
      unlinked.data?.display_name!==unlinkedName){
      results.push({id:'FIXTURE_PLAYER',expectation:'exact isolated unlinked player',outcome:'BLOCKED',...safe(unlinked)});
      process.exitCode=2;return;
    }

    // Existing UI's five-field UPDATE...RETURNING, now on a synthetic club.
    const roleChange=await main.from('club_members').update({role:'sub_admin'},{count:'exact'})
      .eq('id',unlinkedMember.id).eq('club_id',clubId).eq('role','member')
      .select('id,club_id,player_profile_id,role,is_active');
    const roleOk=!roleChange.error&&roleChange.data?.length===1&&roleChange.data[0].role==='sub_admin'&&roleChange.count===1;
    mark('H09_MAIN_ROLE_RETURNING','mainA','正常許可：main changes synthetic member role, returns one row',roleOk,safe(roleChange));
    if(!roleOk)return;
    const subEdit=await outsider.from('club_members').update({role:'member'},{count:'exact'})
      .eq('id',unlinkedMember.id).eq('role','sub_admin')
      .select('id,club_id,player_profile_id,role,is_active');
    const subOk=!subEdit.error&&subEdit.data?.length===1&&subEdit.data[0].role==='member';
    mark('H09_SUB_NONMAIN','outsider','正常許可：sub changes non-main role, returns one row',subOk,safe(subEdit));
    if(!subOk)return;
    const subMain=await outsider.from('club_members').update({role:'member'},{count:'exact'})
      .eq('id',mainMember.id).select('id,club_id,player_profile_id,role,is_active');
    mark('H09_SUB_MAIN','outsider','仕様どおり拒否：sub cannot demote main',
      rejected(subMain)||noRows(subMain),safe(subMain));
    const otherClub=await recipient.from('club_members').update({is_active:false},{count:'exact'})
      .eq('id',unlinkedMember.id).select('id,club_id,player_profile_id,role,is_active');
    mark('H09_CROSS_CLUB','recipient','仕様どおり拒否：another-club main cannot edit private synthetic club',
      rejected(otherClub)||noRows(otherClub),safe(otherClub));
    const inactive=await main.from('club_members').update({is_active:false},{count:'exact'})
      .eq('id',unlinkedMember.id).eq('role','member')
      .select('id,club_id,player_profile_id,role,is_active');
    const inactiveOk=!inactive.error&&inactive.data?.length===1&&inactive.data[0].is_active===false;
    mark('H09_DEACTIVATE','mainA','正常許可：deactivate non-main member and RETURNING',inactiveOk,safe(inactive));
    const restored=await main.from('club_members').update({is_active:true},{count:'exact'})
      .eq('id',unlinkedMember.id).eq('role','member')
      .select('id,club_id,player_profile_id,role,is_active');
    const restoredOk=!restored.error&&restored.data?.length===1&&restored.data[0].is_active===true;
    mark('H09_RESTORE','mainA','正常許可：restore non-main member and RETURNING',restoredOk,safe(restored));
    const lastMain=await main.from('club_members').update({is_active:false},{count:'exact'})
      .eq('id',mainMember.id).select('id,club_id,player_profile_id,role,is_active');
    mark('H09_LAST_MAIN','mainA','仕様どおり拒否：last active main cannot deactivate',
      rejected(lastMain),safe(lastMain));
    const lastDemote=await main.from('club_members').update({role:'member'},{count:'exact'})
      .eq('id',mainMember.id).select('id,club_id,player_profile_id,role,is_active');
    mark('H09_LAST_DEMOTE','mainA','仕様どおり拒否：last active main cannot demote',
      rejected(lastDemote),safe(lastDemote));

    // Owner-only RPCs: all detail columns are readable ONLY via this path.
    const own=await main.rpc('get_my_player_profiles').order('id').range(0,499);
    const selfOk=!own.error&&Array.isArray(own.data)&&own.data.length===1&&
      own.data[0].linked_auth_user_id===mainId&&
      fields.every(field=>Object.hasOwn(own.data[0],field));
    mark('H10_OWNER_READ','mainA','正常許可：owner-only RPC returns full details of self',selfOk,safe(own));
    if(!selfOk)return;
    const myself=own.data[0];
    const myselfValues=Object.fromEntries(fields.map(field=>[field,myself[field]??null]));
    const saved=await main.rpc('save_my_player_profile',{
      p_id:myself.id,p_values:myselfValues,p_expected:myselfValues,
    });
    const savedRow=Array.isArray(saved.data)?saved.data.length===1?saved.data[0]:null:saved.data;
    const ownerSaved=!saved.error&&saved.status===200&&savedRow?.id===myself.id&&
      savedRow?.linked_auth_user_id===mainId&&
      fields.every(field=>(savedRow[field]??null)===(myselfValues[field]??null));
    mark('H10_OWNER_SAVE_NOOP','mainA','正常許可：existing owner-only RPC safely saves unchanged details',ownerSaved,safe(saved));
    const stale=await main.rpc('save_my_player_profile',{
      p_id:myself.id,p_values:{display_name:myself.display_name},
      p_expected:{display_name:'TASK08-H10-INTENTIONALLY-STALE'},
    });
    mark('H10_STALE','mainA','仕様どおり拒否：stale compare-and-swap expected values',
      rejected(stale,['P0001']),safe(stale));
    const wrongUser=await outsider.rpc('save_my_player_profile',{
      p_id:myself.id,p_values:{display_name:myself.display_name},
      p_expected:{display_name:myself.display_name},
    });
    mark('H10_OTHER_OWNER','outsider','仕様どおり拒否：other owner cannot mutate linked profile',
      rejected(wrongUser,['P0001','42501']),safe(wrongUser));
    const forged=await main.rpc('save_my_player_profile',{
      p_id:myself.id,p_values:{linked_auth_user_id:outsiderId},
      p_expected:{linked_auth_user_id:mainId},
    });
    mark('H10_ID_IMMUTABLE','mainA','仕様どおり拒否：linked auth identity not an editable field',
      rejected(forged,['P0001','42501']),safe(forged));
    const rawSensitive=await main.from('player_profiles').select('id,bio').eq('id',myself.id);
    mark('H10_RAW_DETAIL_PRIVATE','mainA','仕様どおり拒否：raw table detail read is not globally granted',
      rejected(rawSensitive),safe(rawSensitive));

    const nameWrite=await main.from('player_profiles')
      .update({display_name:renamed},{count:'exact'})
      .eq('id',unlinked.data.id).is('linked_auth_user_id',null).eq('display_name',unlinkedName)
      .select('id,display_name,linked_auth_user_id');
    const edited=!nameWrite.error&&nameWrite.data?.length===1&&nameWrite.count===1&&
      nameWrite.data[0].display_name===renamed&&nameWrite.data[0].linked_auth_user_id===null;
    mark('H10_UNLINKED_MANAGER_EDIT','mainA','正常許可：manager updates an unlinked member name with RETURNING',edited,safe(nameWrite));
    const outsiderEdit=await recipient.from('player_profiles')
      .update({display_name:'TASK08-H10-FORBIDDEN'},{count:'exact'})
      .eq('id',unlinked.data.id).select('id,display_name,linked_auth_user_id');
    mark('H10_OUTSIDER_EDIT','recipient','仕様どおり拒否：nonmember may not rename another club unlinked player',
      rejected(outsiderEdit)||noRows(outsiderEdit),safe(outsiderEdit));
    // Restore the fixture display name if it was changed; cleanup 44 also accepts both names.
    if(edited){
      const restore=await main.from('player_profiles')
        .update({display_name:unlinkedName},{count:'exact'})
        .eq('id',unlinked.data.id).eq('display_name',renamed)
        .select('id,display_name,linked_auth_user_id');
      mark('H10_UNLINKED_RESTORE','mainA','正常許可：restore test-only unlinked name',
        !restore.error&&restore.data?.length===1&&restore.data[0].display_name===unlinkedName,safe(restore));
    }
  } finally {
    await Promise.all([main,recipient,outsider].map(c=>c.auth.signOut({scope:'local'}).catch(()=>{})));
  }
}
try { await run(); } catch {
  results.push({id:'RUNTIME',expectation:'complete safely without runtime errors',outcome:'BLOCKED'});
  process.exitCode=1;
} finally {
  console.log(JSON.stringify({environment:'padel-hub-staging',
    phase:'H09-H10-WRITE-HTTP',fixture_name:name,cleanup_required:true,
    P0_accepted:false,results},null,2));
}
