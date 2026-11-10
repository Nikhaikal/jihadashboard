import {randomBytes,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
const base=process.env.SUPABASE_URL||'https://qsqsdhvfvqrckcridoiq.supabase.co';
const secret=process.env.SUPABASE_SECRET_KEY;
const setupCode=process.env.ADMIN_BOOTSTRAP_CODE;
const json=(status,data,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store',...headers}});
const sha=value=>createHash('sha256').update(value).digest('hex');
const safeEqual=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y)};
const validPassword=p=>typeof p==='string'&&p.length>=12&&p.length<=128;
const validUsername=u=>typeof u==='string'&&/^[a-z0-9-]{2,24}$/.test(u);
async function hashPassword(password){const salt=randomBytes(16).toString('hex');const hash=await scrypt(password,salt,64);return `scrypt:${salt}:${hash.toString('hex')}`}
async function verifyPassword(password,stored){const [kind,salt,hex]=String(stored).split(':');if(kind!=='scrypt'||!salt||!hex)return false;const hash=await scrypt(password,salt,64);return safeEqual(hash.toString('hex'),hex)}
async function db(path,method='GET',body){
  if(!secret)throw new Error('SUPABASE_SECRET_KEY is not configured in Netlify');
  const headers={apikey:secret,'content-type':'application/json',Prefer:'return=representation'};
  const res=await fetch(`${base}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const data=await res.json().catch(()=>null);
  if(!res.ok)throw new Error(data?.message||data?.msg||data?.error||`Database error ${res.status}`);
  return data;
}
const filter=value=>encodeURIComponent(value);
const rows=(table,query='')=>db(`/rest/v1/${table}?${query}`);
const one=async(table,query)=>{const result=await rows(table,query);return result?.[0]||null};
const patch=(table,query,body)=>db(`/rest/v1/${table}?${query}`,'PATCH',body);
const insert=(table,body)=>db(`/rest/v1/${table}`,'POST',body);
const del=(table,query)=>db(`/rest/v1/${table}?${query}`,'DELETE');
function cookie(request){return request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('jiha_session='))?.slice(13)||''}
const sessionCookie=(token,maxAge)=>`jiha_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
async function currentUser(request){const token=cookie(request);if(!/^[a-f0-9]{64}$/.test(token))return null;const session=await one('app_sessions',`token_hash=eq.${sha(token)}&select=user_id,expires_at`);if(!session||new Date(session.expires_at).getTime()<Date.now())return null;const user=await one('app_users',`id=eq.${filter(session.user_id)}&select=id,username,name,role,active,last_sign_in_at`);return user?.active?user:null}
function publicUser(user){return user?{id:user.id,username:user.username,name:user.name,role:user.role}:null}
const manager=user=>['admin','manager'].includes(user.role);
function checkKey(key,prefix){return typeof key==='string'&&(new RegExp(`^${prefix}-\\d+-(label|target|actual)$`).test(key)||prefix==='score'&&/^month-\d{4}-\d{2}$/.test(key))}
export default async function handler(request){
  if(request.method!=='POST')return json(405,{error:'POST required'});
  const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return json(403,{error:'Invalid origin'});
  try{
    const input=await request.json();const action=input.action;
    if(action==='me'){const user=await currentUser(request);const all=await rows('app_users','select=id&limit=1');return json(200,{user:publicUser(user),needsSetup:all.length===0})}
    if(action==='bootstrap'){
      const all=await rows('app_users','select=id&limit=1');if(all.length)return json(409,{error:'Admin is already set up'});
      if(!setupCode||setupCode.length<24||!safeEqual(input.setupCode,setupCode))return json(403,{error:'Invalid setup code'});
      if(!validPassword(input.password))return json(400,{error:'Password must be 12–128 characters'});
      await insert('app_users',{username:'admin',name:'Admin',role:'admin',password_hash:await hashPassword(input.password)});
      return json(200,{ok:true});
    }
    if(action==='login'){
      const username=String(input.username||'').trim().toLowerCase();const password=String(input.password||'');
      if(!validUsername(username)||!password)return json(401,{error:'Invalid username or password'});
      const user=await one('app_users',`username=eq.${filter(username)}&select=*`);
      if(!user||!user.active||user.locked_until&&new Date(user.locked_until).getTime()>Date.now())return json(401,{error:'Invalid username or password, or account temporarily locked'});
      if(!await verifyPassword(password,user.password_hash)){
        const failed=(user.failed_attempts||0)+1;await patch('app_users',`id=eq.${filter(user.id)}`,{failed_attempts:failed,locked_until:failed>=5?new Date(Date.now()+15*60000).toISOString():null});
        return json(401,{error:'Invalid username or password'});
      }
      const token=randomBytes(32).toString('hex');await insert('app_sessions',{token_hash:sha(token),user_id:user.id,expires_at:new Date(Date.now()+7*86400000).toISOString()});
      await patch('app_users',`id=eq.${filter(user.id)}`,{failed_attempts:0,locked_until:null,last_sign_in_at:new Date().toISOString()});
      return json(200,{user:publicUser(user)},{'set-cookie':sessionCookie(token,7*86400)});
    }
    const user=await currentUser(request);if(!user)return json(401,{error:'Sign in first'});
    if(action==='logout'){const token=cookie(request);await del('app_sessions',`token_hash=eq.${sha(token)}`);return json(200,{ok:true},{'set-cookie':sessionCookie('',0)})}
    if(action==='state'){
      if(manager(user))await db('/rest/v1/rpc/close_team_month','POST',{});
      const [dashboard,hps,settings,reports]=await Promise.all([
        one('team_dashboard','id=eq.main&select=values'),rows('team_hps','select=code,owner_id,parent_id,name,metrics&order=code.asc'),
        one('report_settings','id=eq.main&select=period_start,period_end,timeline_start,timeline_end'),
        rows('monthly_reports','select=period_start,period_end,dashboard_values,hp_values&order=period_end.desc')]);
      return json(200,{user:publicUser(user),dashboard:dashboard?.values||{},hps,settings,reports});
    }
    if(action==='updateDashboard'){
      if(!manager(user))return json(403,{error:'Managers only'});
      if(!checkKey(input.key,'score')||typeof input.value!=='string'||input.value.length>500)return json(400,{error:'Invalid field'});
      const row=await one('team_dashboard','id=eq.main&select=values');await patch('team_dashboard','id=eq.main',{values:{...(row?.values||{}),[input.key]:input.value}});return json(200,{ok:true});
    }
    if(action==='updateHp'){
      const hp=await one('team_hps',`code=eq.${filter(input.code||'')}&select=code,owner_id,parent_id,metrics`);
      if(!hp)return json(404,{error:'HP not found'});
      if(!manager(user)&&hp.owner_id!==user.id&&hp.parent_id!==user.id)return json(403,{error:'You cannot edit this HP'});
      if(!checkKey(input.key,'hp')||typeof input.value!=='string'||input.value.length>500)return json(400,{error:'Invalid field'});
      await patch('team_hps',`code=eq.${filter(hp.code)}`,{metrics:{...hp.metrics,[input.key]:input.value}});return json(200,{ok:true});
    }
    if(action==='settings'){
      if(!manager(user))return json(403,{error:'Managers only'});
      const current=await one('report_settings','id=eq.main&select=period_start,period_end,timeline_start,timeline_end');
      const date=/^\d{4}-\d{2}-\d{2}$/;
      if(input.period_end){if(!date.test(input.period_end)||input.period_end<current.period_start)return json(400,{error:'End date must be within the current period'});await patch('report_settings','id=eq.main',{period_end:input.period_end,closing_day:Number(input.period_end.slice(-2))})}
      if(input.timeline_start||input.timeline_end){const start=input.timeline_start,end=input.timeline_end;if(!date.test(start)||!date.test(end)||end<start||new Date(end)-new Date(start)>2*366*86400000)return json(400,{error:'Timeline must be within two years'});await patch('report_settings','id=eq.main',{timeline_start:start,timeline_end:end})}
      return json(200,{ok:true});
    }
    if(action==='createUser'){
      const username=String(input.username||'').trim().toLowerCase(),name=String(input.name||'').trim(),role=input.role==='manager'?'manager':'hp';
      if(role==='manager'&&user.role!=='admin')return json(403,{error:'Only admin can create a manager'});
      if(!validUsername(username)||name.length<1||name.length>100||!validPassword(input.password))return json(400,{error:'Enter a valid username, name and password of 12–128 characters'});
      if(await one('app_users',`username=eq.${filter(username)}&select=id`))return json(409,{error:'Username already exists'});
      const created=(await insert('app_users',{username,name,role,password_hash:await hashPassword(input.password)}))[0];
      if(role==='hp')try{await insert('team_hps',{code:username.toUpperCase(),owner_id:created.id,parent_id:user.role==='hp'?user.id:null,name,metrics:{}})}catch(error){await del('app_users',`id=eq.${filter(created.id)}`);throw error}
      return json(200,{ok:true});
    }
    if(user.role!=='admin')return json(403,{error:'Admin only'});
    if(action==='listUsers'){
      const users=await rows('app_users','select=id,username,name,role,active,last_sign_in_at,created_at&order=created_at.asc');return json(200,{users});
    }
    if(!/^[0-9a-f-]{36}$/i.test(input.userId||''))return json(400,{error:'Invalid user'});
    const target=await one('app_users',`id=eq.${filter(input.userId)}&select=id,username,role,last_sign_in_at`);if(!target)return json(404,{error:'User not found'});
    if(action==='setPassword'){
      if(!validPassword(input.password))return json(400,{error:'Password must be 12–128 characters'});
      await patch('app_users',`id=eq.${filter(target.id)}`,{password_hash:await hashPassword(input.password),failed_attempts:0,locked_until:null});
      await del('app_sessions',`user_id=eq.${filter(target.id)}`);return json(200,{ok:true});
    }
    if(action==='deleteUser'){
      if(target.role!=='hp')return json(403,{error:'Manager accounts cannot be deleted'});
      const last=target.last_sign_in_at?new Date(target.last_sign_in_at).getTime():0;
      if(last&&Date.now()-last<90*86400000)return json(409,{error:'Only HP accounts inactive for 90 days can be deleted'});
      await del('app_users',`id=eq.${filter(target.id)}`);return json(200,{ok:true});
    }
    return json(400,{error:'Unknown action'});
  }catch(error){return json(400,{error:error.message||'Request failed'})}
}
