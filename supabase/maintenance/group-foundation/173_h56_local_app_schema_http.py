"""H56: real application SDK against synthetic local Auth + app schema.
Capture is READ ONLY, schema and metadata only, never application rows.
Restore/test steps never receive hosted credentials.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import subprocess
import uuid
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[2]
ROOT=Path(os.environ["RUNNER_TEMP"])/"task08-h56-schema"
SCHEMAS=("public","events_identity_private","events_operation_private",
 "fixed_pair_private","lineup_private","match_identity_private",
 "participants_identity_private","profile_link_private","profile_media_private",
 "shared_read_private","team_attendance_private","team_rounds_private")
S="("+",".join("'"+x+"'" for x in SCHEMAS)+")"

def load(name,file):
    spec=importlib.util.spec_from_file_location(name,HERE/file)
    obj=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

h44=load("h44","151_h43_cost_free_isolated_rehearsal.py")
b=h44.b
h55=load("h55","172_h55_local_auth_http_environment.py")
h54=load("h54","170_h54_atomic_cutover_rehearsal.py")
require=h55.require
FINGERPRINT=f"""SELECT jsonb_build_object(
 'relations',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner),
 (SELECT coalesce(jsonb_agg(jsonb_build_array(a.grantee::regrole::text,a.privilege_type,a.is_grantable) ORDER BY a.grantee::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) a)) ORDER BY n.nspname,c.relname),'[]'::jsonb)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN {S} AND c.relkind IN ('r','p','v','m','S')),
 'functions',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),md5(pg_get_functiondef(p.oid)),pg_get_userbyid(p.proowner),
 (SELECT coalesce(jsonb_agg(jsonb_build_array(a.grantee::regrole::text,a.privilege_type,a.is_grantable) ORDER BY a.grantee::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN {S} AND p.prokind='f'),
 'policies',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY schemaname,tablename,policyname),'[]'::jsonb) FROM pg_policies t WHERE schemaname IN {S}),
 'columns',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),
 (SELECT coalesce(jsonb_agg(jsonb_build_array(x.grantee::regrole::text,x.privilege_type,x.is_grantable) ORDER BY x.grantee::regrole::text,x.privilege_type,x.is_grantable),'[]'::jsonb) FROM aclexplode(a.attacl) x)) ORDER BY n.nspname,c.relname,a.attnum),'[]'::jsonb)
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname IN {S} AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,t.relname,c.conname,pg_get_constraintdef(c.oid),c.convalidated) ORDER BY n.nspname,t.relname,c.conname),'[]'::jsonb) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname IN {S}),
 'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)) ORDER BY n.nspname,c.relname,t.tgname),'[]'::jsonb) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN {S} AND NOT t.tgisinternal),
 'views',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,pg_get_viewdef(c.oid),c.reloptions) ORDER BY n.nspname,c.relname),'[]'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN {S} AND c.relkind IN ('v','m')),
 'indexes',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY schemaname,tablename,indexname),'[]'::jsonb) FROM pg_indexes i WHERE schemaname IN {S})
)"""

# Managed defaults belong to the Supabase platform, not the application.
# Compare the existing local managed defaults instead of trying to ALTER a
# role that postgres cannot administer. No membership or privilege escalation.
MANAGED_DEFAULTS="""SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,d.defaclobjtype,
 (SELECT coalesce(jsonb_agg(jsonb_build_array(a.grantee::regrole::text,a.privilege_type,a.is_grantable)
  ORDER BY a.grantee::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb)
  FROM aclexplode(d.defaclacl) a)) ORDER BY n.nspname,d.defaclobjtype),'[]'::jsonb)
 FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace
 WHERE pg_get_userbyid(d.defaclrole)='supabase_admin' AND n.nspname='public'"""
MANAGED_DEFAULT_LINE=re.compile(r"^ALTER DEFAULT PRIVILEGES FOR ROLE (?:supabase_admin|\"supabase_admin\") IN SCHEMA (?:public|\"public\") GRANT (?:ALL(?: PRIVILEGES)?|[A-Z, ]+) ON (?:TABLES|SEQUENCES|FUNCTIONS) TO (?:postgres|anon|authenticated|service_role);[ \t]*$",re.I)

def preserve_managed_defaults(rendered,expected):
    # Only this exact reviewed class of app-dump statements can be omitted.
    # No CREATE/ALTER/GRANT for app objects or postgres defaults is filtered.
    local=query(MANAGED_DEFAULTS,"local_managed_default_acl")
    require(local==expected and len(expected)==3,"managed_default_acl_diff")
    lines=rendered.splitlines(keepends=True)
    kept=[];count=0
    for line in lines:
        if MANAGED_DEFAULT_LINE.fullmatch(line.rstrip("\r\n")):
            count+=1
        else:
            kept.append(line)
    require(count>0,"managed_default_acl_dump_statements_missing")
    print("H56 PASS: existing managed supabase_admin default ACL matches source; skip "+str(count)+" redundant managed-only statements",flush=True)
    return "".join(kept)

# Use exact function identities, not their catalog collation-dependent order.
# Only the local synthetic stack may reproduce a source ACL. The source
# fingerprint is read-only, and definitions/owners must match before ACL work.
FUNCTION_ACL_REVIEW=f"""SELECT jsonb_build_object(
 'unexpected_owner_or_grantor',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE n.nspname IN {S} AND p.prokind='f'
 AND (pg_get_userbyid(p.proowner)<>'postgres' OR pg_get_userbyid(a.grantor)<>'postgres'
 OR a.grantee::regrole::text NOT IN ('-','postgres','anon','authenticated','service_role')
 OR a.privilege_type<>'EXECUTE' OR a.is_grantable)),
 'functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN {S} AND p.prokind='f'))"""

def function_map(rows):
    out={}
    for row in rows:
        require(isinstance(row,list) and len(row)==6,"function_fingerprint_shape")
        key=tuple(row[:3])
        require(key not in out,"duplicate_function_identity")
        out[key]=row
    return out

def function_label(key):
    # Names only, never arguments, bodies, ACL text or user data.
    schema,name,_=key
    return schema+"."+name if schema in SCHEMAS and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,100}",name) else "unknown_function"

def acl_roles(row):
    require(row[4]=="postgres","unexpected_function_owner")
    roles=set()
    for a in row[5]:
        require(len(a)==3 and a[0] in ("-","postgres","anon","authenticated","service_role")
                and a[1]=="EXECUTE" and a[2] is False,"unexpected_function_acl_shape")
        roles.add(a[0])
    require("postgres" in roles,"function_owner_execute_missing")
    return roles

def reconcile_function_acl(expected_rows,actual_rows,review):
    want=function_map(expected_rows)
    got=function_map(actual_rows)
    require(review["unexpected_owner_or_grantor"]==0 and review["functions"]==len(want),
            "source_function_acl_not_reviewed")
    local=query(FUNCTION_ACL_REVIEW,"local_function_acl_review")
    require(local["unexpected_owner_or_grantor"]==0 and local["functions"]==len(got),
            "local_function_acl_not_reviewed")
    if set(want)!=set(got):
        print("H56 function identity differences: missing="+str(len(set(want)-set(got)))+
              " extra="+str(len(set(got)-set(want))),flush=True)
        require(False,"function_identity_diff")
    definition_diff=[k for k in want if want[k][3:5]!=got[k][3:5]]
    acl_diff=[k for k in want if acl_roles(want[k])!=acl_roles(got[k])]
    print("H56 function comparison: identities="+str(len(want))+" definition_or_owner_diff="+
          str(len(definition_diff))+" acl_diff="+str(len(acl_diff)),flush=True)
    for k in definition_diff[:12]:
        print("H56 definition/owner mismatch: "+function_label(k),flush=True)
    for k in acl_diff[:12]:
        print("H56 execute ACL mismatch: "+function_label(k),flush=True)
    require(not definition_diff,"function_definition_or_owner_diff")
    # pg_dump restores ACL deltas relative to the source defaults. The
    # Supabase local init defaults may differ when the CREATE runs. Reproduce
    # the exact catalog-derived EXECUTE set for these app functions only.
    # No blanket grants, no membership changes, no security-definer edits.
    if not acl_diff:
        return
    statements=["BEGIN; SET LOCAL search_path='';"]
    removed=added=0
    for k in acl_diff:
        identity=query("SELECT jsonb_build_object('identity',p.oid::regprocedure::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname="+b.literal(k[0])+" AND p.proname="+b.literal(k[1])+" AND pg_get_function_identity_arguments(p.oid)="+b.literal(k[2]),"local_function_identity")["identity"]
        require(isinstance(identity,str) and identity.startswith(k[0]+".") and ";" not in identity and "\n" not in identity,"function_identity_unsafe")
        target=acl_roles(want[k]);actual=acl_roles(got[k])
        role=lambda v:"PUBLIC" if v=="-" else b.ident(v)
        for v in sorted(actual-target):
            statements.append("REVOKE EXECUTE ON FUNCTION "+identity+" FROM "+role(v)+";")
            removed+=1
        for v in sorted(target-actual):
            statements.append("GRANT EXECUTE ON FUNCTION "+identity+" TO "+role(v)+";")
            added+=1
    statements.append("COMMIT;")
    local_sql("\n".join(statements),"reproduce_source_function_acl")
    print("H56 local ACL reproduction: removed="+str(removed)+" added="+str(added)+
          "; source exact-match verification follows",flush=True)

RELATION_ACL_REVIEW=f"""SELECT jsonb_build_object(
 'unexpected_owner_or_grantor',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) a
 WHERE n.nspname IN {S} AND c.relkind IN ('r','p','v','m','S')
 AND (pg_get_userbyid(c.relowner)<>'postgres' OR pg_get_userbyid(a.grantor)<>'postgres'
 OR a.grantee::regrole::text NOT IN ('-','postgres','anon','authenticated','service_role')
 OR a.is_grantable)),
 'relations',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN {S} AND c.relkind IN ('r','p','v','m','S')))"""

def rows_by_identity(rows,length,key_length,label):
    out={}
    for row in rows:
        require(isinstance(row,list) and len(row)==length,label+"_shape")
        k=tuple(row[:key_length])
        require(k not in out,label+"_duplicate_identity")
        out[k]=row
    return out

def safe_name(value):
    return value if isinstance(value,str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,100}",value) else "unknown"

def relation_acl(row):
    require(row[5]=="postgres","relation_owner_unreviewed")
    allowed={"SELECT","INSERT","UPDATE","DELETE","TRUNCATE","REFERENCES","TRIGGER","MAINTAIN"} if row[2]!="S" else {"SELECT","UPDATE","USAGE"}
    privileges=set()
    for a in row[6]:
        require(len(a)==3 and a[0] in ("-","postgres","anon","authenticated","service_role")
                and a[1] in allowed and a[2] is False,"relation_acl_shape_unreviewed")
        privileges.add((a[0],a[1]))
    return privileges

def reconcile_relation_acl(expected_rows,actual_rows,review):
    want=rows_by_identity(expected_rows,7,2,"source_relation")
    got=rows_by_identity(actual_rows,7,2,"local_relation")
    local=query(RELATION_ACL_REVIEW,"local_relation_acl_review")
    require(review=={"unexpected_owner_or_grantor":0,"relations":len(want)}
            and local=={"unexpected_owner_or_grantor":0,"relations":len(got)},
            "relation_acl_review_required")
    require(set(want)==set(got),"relation_identity_diff")
    structure=[k for k in want if want[k][:6]!=got[k][:6]]
    acl_diff=[k for k in want if relation_acl(want[k])!=relation_acl(got[k])]
    print("H56 relation comparison: identities="+str(len(want))+" structure_diff="+
          str(len(structure))+" acl_diff="+str(len(acl_diff)),flush=True)
    for k in structure[:12]:
        print("H56 relation structure mismatch: "+safe_name(k[0])+"."+safe_name(k[1]),flush=True)
    require(not structure,"relation_structure_diff")
    statements=["BEGIN; SET LOCAL search_path='';"]
    removed=added=0
    for k in acl_diff:
        target,actual=relation_acl(want[k]),relation_acl(got[k])
        identity=b.ident(k[0])+"."+b.ident(k[1])
        kind="SEQUENCE" if want[k][2]=="S" else "TABLE"
        role=lambda v:"PUBLIC" if v=="-" else b.ident(v)
        for r,priv in sorted(actual-target):
            statements.append("REVOKE "+priv+" ON "+kind+" "+identity+" FROM "+role(r)+";")
            removed+=1
        for r,priv in sorted(target-actual):
            statements.append("GRANT "+priv+" ON "+kind+" "+identity+" TO "+role(r)+";")
            added+=1
    statements.append("COMMIT;")
    if acl_diff: local_sql("\n".join(statements),"reproduce_source_relation_acl")
    print("H56 local relation ACL reproduction: removed="+str(removed)+" added="+str(added),flush=True)

def canonical_rows(rows):
    # ORDER BY text can differ between source/local collation. Compare a
    # multiset of complete records (preserve duplicates and every field).
    return sorted(json.dumps(r,ensure_ascii=False,sort_keys=True,separators=(",",":")) for r in rows)

def normalize_relation_rows(rows):
    return [r[:6]+[sorted(r[6])] for r in rows]

def describe_constraint_diff(left,right):
    want=rows_by_identity(left,5,3,"source_constraint")
    got=rows_by_identity(right,5,3,"local_constraint")
    only_source=set(want)-set(got);only_local=set(got)-set(want)
    different=[k for k in want.keys()&got.keys() if want[k]!=got[k]]
    print("H56 constraint comparison: missing="+str(len(only_source))+
          " extra="+str(len(only_local))+" definition_or_validation_diff="+str(len(different)),flush=True)
    for k in sorted(only_source|only_local|set(different))[:25]:
        kind=("missing" if k in only_source else "extra" if k in only_local else
              "definition" if want[k][3]!=got[k][3] else "validation")
        print("H56 constraint mismatch: "+ ".".join(safe_name(v) for v in k)+" "+kind,flush=True)

COLUMN_ACL_REVIEW=f"""SELECT jsonb_build_object(
 'unexpected_grant',(SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(a.attacl) x
 WHERE n.nspname IN {S} AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped
 AND (pg_get_userbyid(c.relowner)<>'postgres' OR pg_get_userbyid(x.grantor)<>'postgres'
 OR x.grantee::regrole::text NOT IN ('-','postgres','anon','authenticated','service_role')
 OR x.privilege_type NOT IN ('SELECT','INSERT','UPDATE','REFERENCES') OR x.is_grantable)),
 'grants',(SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(a.attacl) x
 WHERE n.nspname IN {S} AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped))"""

def column_acl(row):
    out=set()
    for a in row[8]:
        require(len(a)==3 and a[0] in ("-","postgres","anon","authenticated","service_role")
                and a[1] in ("SELECT","INSERT","UPDATE","REFERENCES") and a[2] is False,
                "column_acl_shape_unreviewed")
        out.add((a[0],a[1]))
    return out

def reconcile_column_acl(expected_rows,actual_rows,review):
    # PostgreSQL REVOKE on a table also revokes corresponding column grants.
    # Restore exact source column ACLs AFTER relation ACL reconciliation.
    want=rows_by_identity(expected_rows,9,3,"source_column")
    got=rows_by_identity(actual_rows,9,3,"local_column")
    local=query(COLUMN_ACL_REVIEW,"local_column_acl_review")
    require(review=={"unexpected_grant":0,"grants":sum(len(r[8]) for r in want.values())}
            and local=={"unexpected_grant":0,"grants":sum(len(r[8]) for r in got.values())},
            "column_acl_review_required")
    require(set(want)==set(got),"column_identity_diff")
    require(all(want[k][:8]==got[k][:8] for k in want),"column_structure_diff")
    stmts=["BEGIN; SET LOCAL search_path='';"]
    removed=added=0
    for k in want:
        target,actual=column_acl(want[k]),column_acl(got[k])
        table=b.ident(k[0])+"."+b.ident(k[1]); col=b.ident(k[2])
        role=lambda r:"PUBLIC" if r=="-" else b.ident(r)
        for r,priv in sorted(actual-target):
            stmts.append("REVOKE "+priv+" ("+col+") ON TABLE "+table+" FROM "+role(r)+";")
            removed+=1
        for r,priv in sorted(target-actual):
            stmts.append("GRANT "+priv+" ("+col+") ON TABLE "+table+" TO "+role(r)+";")
            added+=1
    stmts.append("COMMIT;")
    if removed or added: local_sql("\n".join(stmts),"reproduce_source_column_acl")
    print("H56 local column ACL reproduction: removed="+str(removed)+" added="+str(added),flush=True)

# Only the one diagnosed CHECK is eligible. Its original PostgreSQL 17
# source definition was reviewed independently against migration 0048.
IG_KEY=("public","player_profile_private","player_profile_private_instagram_username_check")
IG_DEFINITION=r"CHECK (((instagram_username IS NULL) OR (((length(instagram_username) >= 1) AND (length(instagram_username) <= 30)) AND (instagram_username ~ '^[A-Za-z0-9_](\.?[A-Za-z0-9_])*$'::text))))"

# PostgreSQL deparses BETWEEN into two AND terms. Re-parsing a dump
# can flatten the nested AND without changing the CHECK expression.
# Preserve the restored constraint; prove the only reviewed equivalence.
IG_CATALOG="""SELECT jsonb_build_object(
 'server_major',current_setting('server_version_num')::int/10000,
 'tree',c.conbin::text,'expression',pg_get_expr(c.conbin,c.conrelid),
 'flags',jsonb_build_array(c.contype,c.convalidated,c.connoinherit,c.conislocal,c.coninhcount,c.condeferrable,c.condeferred,c.conkey),
 'attribute',jsonb_build_array(a.attname,a.atttypid,a.attcollation))
 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
 WHERE c.conrelid='public.player_profile_private'::regclass
 AND c.conname='player_profile_private_instagram_username_check'"""
IG_CASES=[(None,True),("",False),("a",True),("_",True),("A9",True),("a.b",True),("a_b",True),
 ("a..b",False),(".a",False),("a.",False),("a-b",False),("a b",False),("a\\b",False),
 ("a@b",False),("日本語",False),("a\nb",False),("a"*30,True),("a"*31,False),("a.b.c",True)]

def check_tree(raw):
    # Strict parser for the limited built-in CHECK node types of this
    # single constraint. Preserve every token except parser locations and
    # associative grouping of consecutive AND nodes; never normalize CONST.
    require(isinstance(raw,str) and len(raw)<20000,"instagram_tree_shape")
    tokens=re.findall(r"[{}()\[\]]|[^\s{}()\[\]]+",raw)
    require(0<len(tokens)<4000,"instagram_tree_token_limit")
    closes={"{":"}","(":")","[":"]"}
    pos=0
    def parse(depth=0):
        nonlocal pos
        require(depth<80 and pos<len(tokens),"instagram_tree_parse")
        tok=tokens[pos];pos+=1
        if tok not in closes:
            require(tok not in closes.values(),"instagram_tree_unexpected_close")
            return tok
        children=[]
        while pos<len(tokens) and tokens[pos]!=closes[tok]:
            children.append(parse(depth+1))
        require(pos<len(tokens),"instagram_tree_unclosed")
        pos+=1
        if tok!="{":
            return (tok,tuple(children))
        require(children and children[0] in ("BOOLEXPR","NULLTEST","VAR","OPEXPR","FUNCEXPR","CONST"),"instagram_tree_unknown_node")
        tag=children[0];fields=[];i=1
        while i<len(children):
            field=children[i];i+=1
            require(isinstance(field,str) and field.startswith(":") and i<len(children),"instagram_tree_unknown_field")
            value=children[i];i+=1
            # CONST :constvalue is a byte count followed by a bracketed array.
            if field==":constvalue":
                require(i<len(children) and isinstance(children[i],tuple) and children[i][0]=="[","instagram_const_bytes")
                value=(value,children[i]);i+=1
            if field==":location":
                require(isinstance(value,str) and re.fullmatch(r"-?\d+",value),"instagram_tree_location")
                continue
            fields.append((field,value))
        if tag=="BOOLEXPR" and dict(fields).get(":boolop")=="and":
            args=dict(fields).get(":args")
            require(isinstance(args,tuple) and args[0]=="(","instagram_tree_and_args")
            flattened=[]
            for child in args[1]:
                if isinstance(child,tuple) and child[0]=="BOOLEXPR" and dict(child[1]).get(":boolop")=="and":
                    require(set(dict(child[1]))=={":boolop",":args"},"instagram_tree_nested_and_fields")
                    flattened.extend(dict(child[1])[":args"][1])
                else: flattened.append(child)
            fields=[(k,("(",tuple(flattened)) if k==":args" else v) for k,v in fields]
        return (tag,tuple(fields))
    result=parse()
    require(pos==len(tokens),"instagram_tree_trailing_tokens")
    return result

def prove_instagram_equivalence(expected_rows,actual_rows,source):
    want=rows_by_identity(expected_rows,5,3,"source_constraint")
    got=rows_by_identity(actual_rows,5,3,"local_constraint")
    require(set(want)==set(got),"constraint_identity_diff")
    diff=[k for k in want if want[k]!=got[k]]
    if diff:
        describe_constraint_diff(expected_rows,actual_rows)
    require(not diff or diff==[IG_KEY],"constraint_difference_requires_review")
    require(want[IG_KEY][3:]==[IG_DEFINITION,True] and got[IG_KEY][4] is True,
            "instagram_source_contract_changed")
    local=query(IG_CATALOG,"instagram_local_catalog")
    require(source["server_major"]==local["server_major"]==17
            and source["flags"]==local["flags"]==["c",True,False,True,0,False,False,[3]]
            and source["attribute"]==local["attribute"]==["instagram_username",25,100],
            "instagram_constraint_catalog_diff")
    require(check_tree(source["tree"])==check_tree(local["tree"]),"instagram_parsed_expression_diff")
    print("H56 PASS: Instagram CHECK parsed expression and flags match (AND grouping only)",flush=True)
    # Exercise the actual restored table CHECK, copied by PostgreSQL to a
    # temporary table. No changes to the application relation or real rows.
    values=",".join("("+str(i)+","+("NULL" if value is None else b.literal(value))+"::text,"+("true" if accepted else "false")+")" for i,(value,accepted) in enumerate(IG_CASES))
    probe="""BEGIN;
SET LOCAL standard_conforming_strings=on;
CREATE TEMP TABLE h56_instagram_probe (LIKE public.player_profile_private INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
DO $ig$
DECLARE r record; accepted boolean; constraint_name text;
BEGIN
 FOR r IN SELECT * FROM (VALUES """+values+""") v(i,username,expected) LOOP
  accepted:=true;
  BEGIN
   INSERT INTO h56_instagram_probe(profile_id,owner_id,instagram_username) VALUES(gen_random_uuid(),gen_random_uuid(),r.username);
  EXCEPTION WHEN check_violation THEN
   GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
   IF constraint_name<>'player_profile_private_instagram_username_check' THEN RAISE; END IF;
   accepted:=false;
  END;
  IF accepted IS DISTINCT FROM r.expected THEN RAISE EXCEPTION 'H56 Instagram behavioral mismatch at case %',r.i; END IF;
 END LOOP;
END $ig$;
ROLLBACK;"""
    local_sql(probe,"instagram_behavior")
    print("H56 PASS: "+str(len(IG_CASES))+" real CHECK acceptance/rejection cases; no constraint rebuilt",flush=True)
    return bool(diff)

def compare_fingerprints(expected,actual,instagram_equivalent=False):
    mismatches=[]
    for name in expected:
        if name=="functions":
            left,right=function_map(expected[name]),function_map(actual[name])
            same=(set(left)==set(right) and all(left[k][:5]==right[k][:5] and
                  sorted(left[k][5])==sorted(right[k][5]) for k in left))
        elif name=="relations":
            same=canonical_rows(normalize_relation_rows(expected[name]))==canonical_rows(normalize_relation_rows(actual[name]))
        else:
            same=canonical_rows(expected[name])==canonical_rows(actual[name])
            if name=="constraints" and not same:
                if instagram_equivalent:
                    # Only the proven equivalent CHECK's deparsed formatting
                    # may differ. Compare all 207 other full records.
                    same=canonical_rows([r for r in expected[name] if tuple(r[:3])!=IG_KEY])==canonical_rows([r for r in actual[name] if tuple(r[:3])!=IG_KEY])
                if not same: describe_constraint_diff(expected[name],actual[name])
        print("H56 fingerprint "+name+": "+("PASS" if same else "FAIL")+
              " source="+str(len(expected[name]))+" local="+str(len(actual[name])),flush=True)
        if not same: mismatches.append(name)
    require(not mismatches,"schema_fingerprint_diff_"+"_".join(sorted(mismatches)))

def trusted():
    require(os.getenv("GITHUB_ACTIONS")=="true" and os.getenv("GITHUB_REPOSITORY")=="g-ambe/Padel-match" and os.getenv("GITHUB_REF")=="refs/heads/codex/task-08-group-foundation","trusted_runner_required")
    require(ROOT.parent==Path(os.environ["RUNNER_TEMP"]),"runner_temp_required")

def capture():
    require(not ROOT.exists(),"fresh_capture_required")
    ROOT.mkdir(mode=0o700)
    ca=b.probe.custom_ca_file()
    require(ca is not None,"source_ca_missing")
    env=b.clean_env()
    env.update(b.probe.connection_environment(os.environ["SUPABASE_DB_URL"]))
    env["PGSSLROOTCERT"]="/run/padel-supabase-ca.crt"
    env["PGOPTIONS"]="-c default_transaction_read_only=on -c standard_conforming_strings=on"
    with b.Snapshot(b.source_prefix(ca),env) as snap:
        inv=snap.query(f"""SELECT json_build_object(
         'schemas',(SELECT json_agg(nspname ORDER BY nspname) FROM pg_namespace WHERE nspname IN {S}),
         'unexpected_private',(SELECT count(*) FROM pg_namespace WHERE nspname LIKE '%_private' AND nspname NOT IN {S}),
         'external_functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN {S} AND p.prokind='f' AND p.prosrc ~* '(net[.]http_|http_post|http_get|dblink|vault[.]|apikey|service_role_key|postgres(ql)?://|sb_secret_)'),
         'managed_auth_triggers',(SELECT count(*) FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND NOT tgisinternal),
         'foreign_tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN {S} AND c.relkind='f'))""")
        require(inv["schemas"]==sorted(SCHEMAS) and not any(v for k,v in inv.items() if k!="schemas"),"source_schema_review_required")
        catalog=snap.query(h44.remote_schema_catalog_query())
        require(catalog["legacy_fixed_pairs"] and catalog["legacy_media"] and not catalog["new_shared_rpc"],"source_baseline_changed")
        fingerprint=snap.query(FINGERPRINT)
        managed_defaults=snap.query(MANAGED_DEFAULTS)
        function_acl_review=snap.query(FUNCTION_ACL_REVIEW)
        relation_acl_review=snap.query(RELATION_ACL_REVIEW)
        column_acl_review=snap.query(COLUMN_ACL_REVIEW)
        instagram_catalog=snap.query(IG_CATALOG)
        require(isinstance(instagram_catalog,dict),"source_instagram_catalog_missing")
        require(column_acl_review["unexpected_grant"]==0,"source_column_acl_review_required")
        require(relation_acl_review["unexpected_owner_or_grantor"]==0,"source_relation_acl_review_required")
        require(function_acl_review["unexpected_owner_or_grantor"]==0,"source_function_acl_review_required")
        require(len(managed_defaults)==3,"source_managed_default_acl_review_required")
        history=snap.query("SELECT coalesce(json_agg(json_build_object('version',version,'name',name) ORDER BY version),'[]'::json) FROM supabase_migrations.schema_migrations")
        (ROOT/"metadata.json").write_text(json.dumps({"fingerprint":fingerprint,"history":history,"catalog":catalog,"managed_defaults":managed_defaults,"function_acl_review":function_acl_review,"relation_acl_review":relation_acl_review,"column_acl_review":column_acl_review,"instagram_catalog":instagram_catalog}))
        snap.dump(["--schema-only","--format=custom","--no-comments","--no-security-labels","--no-publications","--no-subscriptions"]+["--schema="+x for x in SCHEMAS],ROOT/"app-schema.dump")
    print("H56 PASS: source app schema only captured; no managed Auth/Storage or real rows",flush=True)

def local_sql(s,phase):
    # Only the dedicated, already-verified H55 local stack. Do not emit raw
    # SQL, stderr, local auth credentials or source object definitions.
    require(not os.getenv("SUPABASE_DB_URL") and not os.getenv("PADEL_BACKUP_DB_URL"),"hosted_credential_forbidden")
    args=h55.DOCKER+["exec","-i",h55.DB,"psql","-U","postgres","-d","postgres",
                     "-X","-qAt","-v","ON_ERROR_STOP=1","-v","VERBOSITY=verbose","-f","-"]
    r=subprocess.run(args,input=s,text=True,capture_output=True,env=h55.ENV,timeout=180,check=False)
    if r.returncode:
        error=re.search(r"psql:<stdin>:(\d+):\s*(?:ERROR|FATAL):\s*([0-9A-Z]{5}):",r.stderr)
        line=int(error.group(1)) if error else 0
        state=error.group(2) if error else "unknown"
        reason="unclassified"
        for pattern,label in (
            (r"permission denied for schema","schema_permission"),
            (r"permission denied for database","database_permission"),
            (r"permission denied for (?:table|relation|sequence)","relation_permission"),
            (r"permission denied for function","function_permission"),
            (r"must be owner of","owner_required"),
            (r"must be (?:a )?superuser","superuser_required"),
            (r"permission denied to (?:create|alter)","ddl_permission"),
            (r"permission denied to set role","role_permission"),
            (r"permission denied to change default privileges","default_acl_permission"),
            (r"must be member of role","role_membership_required"),
            (r"grantor must","grantor_permission"),
            (r"permission denied","other_permission")):
            if re.search(pattern,r.stderr,re.I):
                reason=label
                break
        # Report only a fixed command category and allowlisted schema; even
        # if the error is in a function body, never print its source text.
        category="unknown"
        schema="unknown"
        if 0<line<=len(s.splitlines()):
            lines=s.splitlines()
            for candidate in reversed(lines[max(0,line-50):line]):
                m=re.match(r"^\s*(CREATE(?: OR REPLACE)?|ALTER|GRANT|REVOKE|SET|DROP|SELECT|INSERT|DO|COMMENT|NOTIFY)\b",candidate,re.I)
                if m:
                    category=m.group(1).upper().replace(" ","_")
                    for name in SCHEMAS+("auth","storage","extensions","supabase_migrations"):
                        if re.search(r"\b"+re.escape(name)+r"\b",candidate):
                            schema=name
                            break
                    break
        if 0<line<=len(s.splitlines()) and re.search(r"^\s*ALTER DEFAULT PRIVILEGES FOR ROLE (?:\"?supabase_admin\"?)\b",s.splitlines()[line-1],re.I):
            category="ALTER_MANAGED_DEFAULT_PRIVILEGES"
        require(False,phase+"_line_"+str(line)+"_state_"+state+"_"+reason+"_"+category+"_"+schema)
    return r.stdout

def query(s,phase="metadata_query"):
    return json.loads(local_sql("BEGIN READ ONLY; SET LOCAL standard_conforming_strings=on; SET LOCAL search_path=''; "+s+"; ROLLBACK;",phase))

def restore_and_test(url,key,credentials):
    require(not os.getenv("SUPABASE_DB_URL") and not os.getenv("PADEL_BACKUP_DB_URL"),"hosted_credential_forbidden")
    metadata=json.loads((ROOT/"metadata.json").read_text())
    local_sql("DROP TABLE public.h55_auth_probe; DROP FUNCTION public.h55_whoami();","drop_sentinel")
    require(query("SELECT json_build_object('n',count(*)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')")=={"n":0},"local_public_not_empty")
    toc=b.run(b.DOCKER+["run","--rm","--interactive","--network","none",b.probe.POSTGRES_IMAGE,"pg_restore","--list"],phase="H56_archive_inventory_failed",data=(ROOT/"app-schema.dump").read_bytes(),timeout=120).decode()
    require(not re.search(r"(?m)^\d+;[^\n]*\b(?:TABLE DATA|SEQUENCE SET|MATERIALIZED VIEW DATA|BLOB DATA|BLOBS)\b",toc),"archive_must_be_schema_only")
    rendered=b.run(b.DOCKER+["run","--rm","--interactive","--network","none",b.probe.POSTGRES_IMAGE,"pg_restore","--schema-only","--no-owner","--no-comments","--file","-"],phase="H56_schema_render_failed",data=(ROOT/"app-schema.dump").read_bytes(),timeout=300).decode()
    rendered=re.sub(r"(?m)^CREATE SCHEMA public;[ \t]*$","",rendered)
    require(not re.search(r"(?mi)^(CREATE (?:SCHEMA|TABLE) (?:auth|storage|vault)\b|CREATE (?:PUBLICATION|SUBSCRIPTION|SERVER|USER MAPPING)\b)",rendered),"unexpected_schema_archive_content")
    rendered=preserve_managed_defaults(rendered,metadata["managed_defaults"])
    print("H56: restore schema-only archive into local app schemas",flush=True)
    local_sql(rendered,"schema_restore")
    actual=query(FINGERPRINT)
    reconcile_function_acl(metadata["fingerprint"]["functions"],actual["functions"],metadata["function_acl_review"])
    actual=query(FINGERPRINT)
    reconcile_relation_acl(metadata["fingerprint"]["relations"],actual["relations"],metadata["relation_acl_review"])
    actual=query(FINGERPRINT)
    reconcile_column_acl(metadata["fingerprint"]["columns"],actual["columns"],metadata["column_acl_review"])
    actual=query(FINGERPRINT)
    instagram_equivalent=prove_instagram_equivalence(metadata["fingerprint"]["constraints"],actual["constraints"],metadata["instagram_catalog"])
    compare_fingerprints(metadata["fingerprint"],actual,instagram_equivalent)
    require(query(h44.remote_schema_catalog_query())==metadata["catalog"],"source_catalog_diff")
    h55.sql(f"""DO $check$ DECLARE r record; v bigint; BEGIN
      FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN {S} AND c.relkind IN ('r','p') LOOP
       EXECUTE format('SELECT count(*) FROM %I.%I',r.nspname,r.relname) INTO v;
       IF v<>0 THEN RAISE EXCEPTION 'H56 unexpected nonempty app table'; END IF;
      END LOOP; END $check$;""")
    print("H56 PASS: source app schema fingerprint matches, app tables empty",flush=True)
    h55.sql("CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);")
    require(query("SELECT json_build_object('n',count(*)) FROM supabase_migrations.schema_migrations")=={"n":0},"local_migration_history_not_empty")
    rows=",".join("("+b.literal(x["version"])+","+b.literal(x["name"])+",ARRAY['H56 schema metadata only']::text[])" for x in metadata["history"])
    h55.sql("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES "+rows+";")
    local_sql(h44.PHASE1.read_text(),"phase1")
    h55.sql("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('20990101010001','task08_prod_phase1_additive',ARRAY['H56 isolated test']);")
    combined="BEGIN;\n"+h54.body(h44.PHASE2,require)+"""
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('20990101010002','task08_prod_phase2_atomic',ARRAY['H56 isolated test']);
"""+h54.body(HERE/"164_h51_postcommit_safe_legacy_approval_guard_CANDIDATE.sql",require)+"""
CREATE TABLE public.h51_postcutover_data_preservation(marker text PRIMARY KEY);
REVOKE ALL ON public.h51_postcutover_data_preservation FROM PUBLIC,anon,authenticated;
INSERT INTO public.h51_postcutover_data_preservation VALUES('retained');
"""+h54.body(HERE/"168_h52_media_reference_guard_CANDIDATE.sql",require)+"\nCOMMIT;"
    local_sql(combined,"atomic_phase2")
    require(query("SELECT json_build_object('guard',position('最新版の連携画面' IN pg_get_functiondef('public.review_player_profile_link(uuid,text,text)'::regprocedure))>0,'anon',has_any_column_privilege('anon','public.club_members','SELECT'),'count',to_regprocedure('public.get_public_club_member_count(uuid)') IS NOT NULL)")=={"guard":True,"anon":False,"count":True},"post_cutover_contract")
    print("H56 PASS: verified Phase1 plus atomic Phase2/H51/H52 on local stack",flush=True)
    ids=seed(credentials)
    local_sql("NOTIFY pgrst,'reload schema';","schema_cache_reload")
    payload=json.dumps({"url":url,"key":key,"actors":credentials,"ids":ids})
    raw=h55.run(["node",str(REPO/"tests/integration/task08-h56-real-sdk.cjs")],"real_sdk",data=payload,cwd=REPO,timeout=180)
    report=json.loads(raw)
    if report.get("ok") is not True:
        stage=report.get("phase")
        allowed={"setup","auth","count","directory","roster_boundary","manager","third_party","consent","cas","public_approval","private_approval","old_approval_denied","reject","join_no_consent","join_approval","readback"}
        require(False,"sdk_failed_"+(stage if stage in allowed else "unknown"))
    require(report.get("checks")==15,"sdk_report_failed")
    print("H56 PASS: 15 real SDK/RPC assertions including public/private approval and join",flush=True)
    q=lambda x:b.literal(ids[x])+"::uuid"
    check=query(f"""SELECT json_build_object(
     'public_link',(SELECT count(*)=1 FROM public.club_members WHERE club_id={q('public')} AND player_profile_id={q('recipient_profile')} AND club_display_name='H56 public chosen' AND club_display_name_public_confirmed_at IS NOT NULL),
     'private_link',(SELECT count(*)=1 FROM public.club_members WHERE club_id={q('private')} AND player_profile_id={q('recipient_profile')} AND club_display_name='H56 private chosen' AND club_display_name_public_confirmed_at IS NULL),
     'joined',(SELECT count(*)=1 FROM public.club_members WHERE club_id={q('join')} AND player_profile_id={q('outsider_profile')} AND club_display_name='H56 join chosen' AND club_display_name_public_confirmed_at IS NOT NULL),
     'retired',(SELECT count(*)=2 FROM public.player_profiles WHERE id IN ({q('public_source')},{q('private_source')}) AND NOT is_active),
     'rejected_source',(SELECT is_active FROM public.player_profiles WHERE id={q('legacy_source')}),
     'media',(SELECT count(*)=1 FROM public.player_profile_private WHERE profile_id={q('recipient_profile')} AND instagram_username='h56_synthetic' AND avatar_version=1),
     'audit',(SELECT count(*)=2 FROM public.player_profile_merges WHERE target_player_profile_id={q('recipient_profile')} AND restored_at IS NULL),
     'joins',(SELECT count(*)=1 FROM public.join_requests WHERE club_id={q('join')} AND status='approved')
    )""")
    require(all(v is True for v in check.values()),"committed_row_checks_failed")
    print("H56 PASS: 8 independent committed-row/merge/media checks",flush=True)
    print("H56 LIMITATION: SDK/HTTP only; browser/Worker local preview not tested; no real rows or R2 bytes",flush=True)

def seed(credentials):
    # Auth users are the actual local signups, no manual auth.users inserts.
    ids={role: next(x["uid"] for x in credentials if x["role"]==role) for role in ("owner","recipient","outsider")}
    for role in ("owner","recipient","outsider"):
        ids[role+"_profile"]=str(uuid.uuid4())
    for club in ("public","private","join"):
        ids[club]=str(uuid.uuid4())
    for name in ("public","private","legacy"):
        ids[name+"_source"]=str(uuid.uuid4())
        ids[name+"_member"]=str(uuid.uuid4())
    q=lambda x:b.literal(str(uuid.UUID(ids[x])))+"::uuid"
    stmts=["BEGIN; SET LOCAL lock_timeout='5s';"]
    for role in ("owner","recipient","outsider"):
        email=next(x["email"] for x in credentials if x["role"]==role)
        stmts += [f"INSERT INTO public.profiles(id,display_name,email) VALUES({q(role)},'H56 {role}',{b.literal(email)});",
                  f"INSERT INTO public.player_profiles(id,display_name,linked_auth_user_id,created_by_auth_user_id,is_active) VALUES({q(role+'_profile')},'H56 {role}',{q(role)},{q(role)},true);"]
    for club in ("public","private","join"):
        vis="private" if club=="private" else "public"
        stmts += [f"INSERT INTO public.clubs(id,name,owner_id,is_active,visibility) VALUES({q(club)},'H56 {club}',{q('owner')},true,'{vis}');",
                  f"INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status) VALUES({q(club)},{q('owner')},{q('owner_profile')},'main_admin',true,'active');"]
    for name in ("public","private","legacy"):
        club="public" if name=="legacy" else name
        stmts += [f"INSERT INTO public.player_profiles(id,display_name,created_by_auth_user_id,is_active) VALUES({q(name+'_source')},'H56 {name} provisional',{q('owner')},true);",
                  f"INSERT INTO public.club_members(id,club_id,player_profile_id,role,is_active,status,club_display_name) VALUES({q(name+'_member')},{q(club)},{q(name+'_source')},'member',true,'active','H56 {name} current');"]
    media_request=str(uuid.uuid4()); media_key="profiles/"+ids["recipient_profile"]+"/"+media_request+".webp"
    stmts += [f"INSERT INTO public.profile_media_objects(object_key,profile_id,request_id,state) VALUES({b.literal(media_key)},{q('recipient_profile')},{b.literal(media_request)},'active');",
              f"INSERT INTO public.profile_media_operations(request_id,actor_id,profile_id,kind,status,object_key,expected_version,committed_at) VALUES({b.literal(media_request)},{q('recipient')},{q('recipient_profile')},'upload','committed',{b.literal(media_key)},0,now());",
              f"INSERT INTO public.player_profile_private(profile_id,owner_id,instagram_username,instagram_version,avatar_version,avatar_key) VALUES({q('recipient_profile')},{q('recipient')},'h56_synthetic',1,1,{b.literal(media_key)}) ON CONFLICT(profile_id) DO UPDATE SET owner_id=excluded.owner_id,instagram_username=excluded.instagram_username,instagram_version=1,avatar_version=1,avatar_key=excluded.avatar_key;",
              "COMMIT;"]
    local_sql("\n".join(stmts),"fixture_seed")
    return ids

if __name__=="__main__":
    try:
        trusted()
        if sys.argv[1:]==["capture"]: capture()
        elif sys.argv[1:]==["test"]:
            require(not os.getenv("SUPABASE_DB_URL"),"hosted_credential_forbidden")
            h55.main(restore_and_test)
        else: require(False,"mode_required")
    except (RuntimeError,b.BackupError,b.probe.ProbeError) as e:
        print("H56 FAIL: "+str(e),flush=True);sys.exit(1)
    except Exception as e:
        print("H56 FAIL: unexpected_"+type(e).__name__,flush=True);sys.exit(1)
