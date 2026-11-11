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
async function db(path,method='GET',body,prefer='return=representation'){
  if(!secret)throw new Error('SUPABASE_SECRET_KEY is not configured in Netlify');
  const headers={apikey:secret,'content-type':'application/json',Prefer:prefer};
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
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const dayMs=86400000;
const dateMs=value=>Date.parse(`${value}T00:00:00Z`);
const dateFromMs=value=>new Date(value).toISOString().slice(0,10);
function malaysiaToday(){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const part=type=>parts.find(item=>item.type===type).value;return `${part('year')}-${part('month')}-${part('day')}`}
function weekDefaults(start,end){const first=dateMs(start),length=Math.round((dateMs(end)-first)/dayMs)+1;return [1,2,3,4].map(week_no=>({period_start:start,week_no,end_date:dateFromMs(first+(Math.max(week_no,Math.floor(length*week_no/4))-1)*dayMs),goals:[]}))}
async function ensureWeeks(settings){const existing=await rows('weekly_plans',`period_start=eq.${settings.period_start}&select=period_start,week_no,end_date,goals&order=week_no.asc`);if(existing.length===4)return existing;const defaults=weekDefaults(settings.period_start,settings.period_end),missing=defaults.filter(week=>!existing.some(row=>row.week_no===week.week_no));if(missing.length)await db('/rest/v1/weekly_plans?on_conflict=period_start,week_no','POST',missing,'resolution=ignore-duplicates,return=representation');return rows('weekly_plans',`period_start=eq.${settings.period_start}&select=period_start,week_no,end_date,goals&order=week_no.asc`)}
function reminderDue(reminder,day){if(day<reminder.starts_on||reminder.ends_on&&day>reminder.ends_on)return false;const elapsed=Math.round((dateMs(day)-dateMs(reminder.starts_on))/dayMs),interval=reminder.repeat_interval;if(reminder.repeat_type==='none')return elapsed===0;if(reminder.repeat_type==='daily')return elapsed%interval===0;if(reminder.repeat_type==='weekly')return elapsed%(7*interval)===0;const [year,month,startDay]=reminder.starts_on.split('-').map(Number),[y,m,d]=day.split('-').map(Number),monthGap=(y-year)*12+m-month;const daysInMonth=new Date(Date.UTC(y,m,0)).getUTCDate();return monthGap>=0&&monthGap%interval===0&&d===Math.min(startDay,daysInMonth)}
async function ensureJihaHp(){
  const jiha=await one('app_users','username=eq.jiha&select=id,name,role');
  if(!jiha||jiha.role!=='manager')return;
  const existing=await one('team_hps','code=eq.JIHA&select=owner_id');
  if(!existing)await insert('team_hps',{code:'JIHA',owner_id:jiha.id,parent_id:null,name:jiha.name,metrics:{}});
  else if(!existing.owner_id)await patch('team_hps','code=eq.JIHA',{owner_id:jiha.id,name:jiha.name});
  else if(existing.owner_id!==jiha.id)throw new Error('The JIHA HP code belongs to another account');
}
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
      await ensureJihaHp();
      const today=malaysiaToday();
      let settings=await one('report_settings','id=eq.main&select=period_start,period_end,timeline_start,timeline_end');
      if(settings.period_end<today){await db('/rest/v1/rpc/close_team_month','POST',{});settings=await one('report_settings','id=eq.main&select=period_start,period_end,timeline_start,timeline_end')}
      const weeks=await ensureWeeks(settings),historyFrom=dateFromMs(dateMs(today)-30*dayMs);
      const [dashboard,hps,reports,reminders,reminderDays]=await Promise.all([
        one('team_dashboard','id=eq.main&select=values'),rows('team_hps','select=code,owner_id,parent_id,name,metrics,hidden_rows&order=code.asc'),
        rows('monthly_reports','select=period_start,period_end,dashboard_values,hp_values&order=period_end.desc'),
        manager(user)?rows('jiha_reminders','active=eq.true&select=*&order=created_at.asc'):Promise.resolve([]),
        manager(user)?rows('jiha_reminder_days',`day=gte.${historyFrom}&select=reminder_id,day,checked,items_snapshot&order=day.desc`):Promise.resolve([])]);
      return json(200,{user:publicUser(user),dashboard:dashboard?.values||{},hps,settings,reports,weeks,reminders,reminderDays,today});
    }
    if(action==='updateDashboard'){
      if(!manager(user))return json(403,{error:'Managers only'});
      if(!checkKey(input.key,'score')||typeof input.value!=='string'||input.value.length>500)return json(400,{error:'Invalid field'});
      const row=await one('team_dashboard','id=eq.main&select=values');await patch('team_dashboard','id=eq.main',{values:{...(row?.values||{}),[input.key]:input.value}});return json(200,{ok:true});
    }
    if(action==='updateDashboardBatch'){
      if(!manager(user))return json(403,{error:'Managers only'});
      const changes=input.changes;
      if(!changes||typeof changes!=='object'||Array.isArray(changes)||Object.keys(changes).length>80||Object.entries(changes).some(([key,value])=>!checkKey(key,'score')||typeof value!=='string'||value.length>500))return json(400,{error:'Invalid dashboard figures'});
      const row=await one('team_dashboard','id=eq.main&select=values');
      await patch('team_dashboard','id=eq.main',{values:{...(row?.values||{}),...changes}});
      return json(200,{ok:true});
    }
    if(action==='updateHp'){
      const hp=await one('team_hps',`code=eq.${filter(input.code||'')}&select=code,owner_id,parent_id,metrics`);
      if(!hp)return json(404,{error:'HP not found'});
      if(!manager(user)&&hp.owner_id!==user.id&&hp.parent_id!==user.id)return json(403,{error:'You cannot edit this HP'});
      if(!checkKey(input.key,'hp')||typeof input.value!=='string'||input.value.length>500)return json(400,{error:'Invalid field'});
      await patch('team_hps',`code=eq.${filter(hp.code)}`,{metrics:{...hp.metrics,[input.key]:input.value}});return json(200,{ok:true});
    }
    if(action==='updateHpBatch'){
      const hp=await one('team_hps',`code=eq.${filter(input.code||'')}&select=code,owner_id,parent_id,metrics`);
      if(!hp)return json(404,{error:'HP not found'});
      if(!manager(user)&&hp.owner_id!==user.id&&hp.parent_id!==user.id)return json(403,{error:'You cannot edit this HP'});
      const changes=input.changes;
      if(!changes||typeof changes!=='object'||Array.isArray(changes)||Object.keys(changes).length>60||Object.entries(changes).some(([key,value])=>!checkKey(key,'hp')||typeof value!=='string'||value.length>500))return json(400,{error:'Invalid HP figures'});
      await patch('team_hps',`code=eq.${filter(hp.code)}`,{metrics:{...(hp.metrics||{}),...changes}});
      return json(200,{ok:true});
    }
    if(action==='submitFigures'){
      const dashboardChanges=input.dashboardChanges||{},hpChanges=input.hpChanges||{};
      const validChanges=(changes,prefix,max)=>changes&&typeof changes==='object'&&!Array.isArray(changes)&&Object.keys(changes).length<=max&&Object.entries(changes).every(([key,value])=>checkKey(key,prefix)&&typeof value==='string'&&value.length<=500);
      if(!validChanges(dashboardChanges,'score',80)||!hpChanges||typeof hpChanges!=='object'||Array.isArray(hpChanges)||Object.keys(hpChanges).length>100||Object.values(hpChanges).some(changes=>!validChanges(changes,'hp',60)))return json(400,{error:'Invalid figures'});
      if(Object.keys(dashboardChanges).length&&!manager(user))return json(403,{error:'Managers only'});
      const currentHps=await rows('team_hps','select=code,owner_id,parent_id,name,metrics,hidden_rows&order=code.asc'),byCode=new Map(currentHps.map(hp=>[hp.code,hp]));
      for(const code of Object.keys(hpChanges)){const hp=byCode.get(code);if(!hp)return json(404,{error:`HP ${code} not found`});if(!manager(user)&&hp.owner_id!==user.id&&hp.parent_id!==user.id)return json(403,{error:`You cannot edit ${code}`})}
      if(Object.keys(dashboardChanges).length){const row=await one('team_dashboard','id=eq.main&select=values');await patch('team_dashboard','id=eq.main',{values:{...(row?.values||{}),...dashboardChanges}})}
      for(const [code,changes] of Object.entries(hpChanges)){const hp=byCode.get(code);await patch('team_hps',`code=eq.${filter(code)}`,{metrics:{...(hp.metrics||{}),...changes}})}
      const [savedDashboard,savedHps]=await Promise.all([one('team_dashboard','id=eq.main&select=values'),rows('team_hps','select=code,owner_id,parent_id,name,metrics,hidden_rows&order=code.asc')]);
      return json(200,{dashboard:savedDashboard?.values||{},hps:savedHps});
    }
    if(action==='setHpRows'){
      if(!manager(user))return json(403,{error:'Only admin and Jiha can change HP rows'});
      const allowed=new Set([2,3,4,5,6,8]);
      if(!Array.isArray(input.hiddenRows)||input.hiddenRows.length>allowed.size||input.hiddenRows.some(index=>!Number.isInteger(index)||!allowed.has(index)))return json(400,{error:'Invalid HP rows'});
      const hp=await one('team_hps',`code=eq.${filter(input.code||'')}&select=code`);
      if(!hp)return json(404,{error:'HP not found'});
      await patch('team_hps',`code=eq.${filter(hp.code)}`,{hidden_rows:[...new Set(input.hiddenRows)].sort((a,b)=>a-b)});
      return json(200,{ok:true});
    }
    if(action==='settings'){
      if(!manager(user))return json(403,{error:'Managers only'});
      const current=await one('report_settings','id=eq.main&select=period_start,period_end,timeline_start,timeline_end');
      const date=/^\d{4}-\d{2}-\d{2}$/;
      if(input.period_end){if(!date.test(input.period_end)||dateMs(input.period_end)-dateMs(current.period_start)<3*dayMs)return json(400,{error:'The month needs at least four days for four weeks'});const weeks=await ensureWeeks(current);if(input.period_end<=weeks[2].end_date)return json(400,{error:'Move week 3 earlier before shortening the month'});await patch('report_settings','id=eq.main',{period_end:input.period_end,closing_day:Number(input.period_end.slice(-2))});await patch('weekly_plans',`period_start=eq.${current.period_start}&week_no=eq.4`,{end_date:input.period_end})}
      if(input.timeline_start||input.timeline_end){const start=input.timeline_start,end=input.timeline_end;if(!date.test(start)||!date.test(end)||end<start||new Date(end)-new Date(start)>2*366*86400000)return json(400,{error:'Timeline must be within two years'});await patch('report_settings','id=eq.main',{timeline_start:start,timeline_end:end})}
      return json(200,{ok:true});
    }
    if(action==='setWeekEnds'){
      if(!manager(user))return json(403,{error:'Managers only'});
      const setting=await one('report_settings','id=eq.main&select=period_start,period_end'),ends=input.ends;
      if(!Array.isArray(ends)||ends.length!==4||ends.some(day=>typeof day!=='string'||!datePattern.test(day))||ends[0]<setting.period_start||ends.some((day,i)=>i>0&&day<=ends[i-1]))return json(400,{error:'Choose four increasing week-end dates within the reporting month'});
      const weeks=await ensureWeeks(setting),updates=weeks.map((week,i)=>({...week,end_date:ends[i]}));
      if(ends[3]!==setting.period_end)await patch('report_settings','id=eq.main',{period_end:ends[3],closing_day:Number(ends[3].slice(-2))});
      await db('/rest/v1/weekly_plans?on_conflict=period_start,week_no','POST',updates,'resolution=merge-duplicates,return=representation');
      return json(200,{ok:true});
    }
    if(action==='setWeekGoals'){
      if(!manager(user))return json(403,{error:'Managers only'});
      const week_no=Number(input.week_no),goals=input.goals;
      if(!Number.isInteger(week_no)||week_no<1||week_no>4||!Array.isArray(goals)||goals.length>20||goals.some(goal=>typeof goal?.id!=='string'||!/^[-0-9a-f]{36}$/i.test(goal.id)||typeof goal.title!=='string'||!goal.title.trim()||goal.title.length>100||typeof goal.target!=='string'||goal.target.length>30))return json(400,{error:'Enter up to 20 goals with a title and optional target'});
      const setting=await one('report_settings','id=eq.main&select=period_start,period_end');await ensureWeeks(setting);
      await patch('weekly_plans',`period_start=eq.${setting.period_start}&week_no=eq.${week_no}`,{goals:goals.map(goal=>({id:goal.id,title:goal.title.trim(),target:goal.target.trim()}))});
      return json(200,{ok:true});
    }
    if(action==='saveReminder'){
      if(!manager(user))return json(403,{error:'Only admin and Jiha can manage reminders'});
      const {title,checklist,repeat_type,repeat_interval,starts_on,ends_on}=input;
      const interval=Number(repeat_interval);
      if(typeof title!=='string'||!title.trim()||title.length>120||!Array.isArray(checklist)||checklist.length<1||checklist.length>20||checklist.some(item=>typeof item?.id!=='string'||!/^[-0-9a-f]{36}$/i.test(item.id)||typeof item.text!=='string'||!item.text.trim()||item.text.length>120)||!['none','daily','weekly','monthly'].includes(repeat_type)||!Number.isInteger(interval)||interval<1||interval>31||!datePattern.test(starts_on)||ends_on!==null&&(!datePattern.test(ends_on)||ends_on<starts_on))return json(400,{error:'Enter a title, checklist, repeat schedule, and valid dates'});
      const data={title:title.trim(),checklist:checklist.map(item=>({id:item.id,text:item.text.trim()})),repeat_type,repeat_interval:interval,starts_on,ends_on};
      if(input.id){if(!/^[0-9a-f-]{36}$/i.test(input.id))return json(400,{error:'Invalid reminder'});const existing=await one('jiha_reminders',`id=eq.${filter(input.id)}&select=id`);if(!existing)return json(404,{error:'Reminder not found'});await patch('jiha_reminders',`id=eq.${filter(input.id)}`,data)}
      else await insert('jiha_reminders',{...data,created_by:user.id});
      return json(200,{ok:true});
    }
    if(action==='archiveReminder'){
      if(!manager(user))return json(403,{error:'Only admin and Jiha can manage reminders'});
      if(!/^[0-9a-f-]{36}$/i.test(input.id||''))return json(400,{error:'Invalid reminder'});
      await patch('jiha_reminders',`id=eq.${filter(input.id)}`,{active:false});return json(200,{ok:true});
    }
    if(action==='checkReminder'){
      if(!manager(user))return json(403,{error:'Only admin and Jiha can track reminders'});
      if(!/^[0-9a-f-]{36}$/i.test(input.id||'')||!Array.isArray(input.checked))return json(400,{error:'Invalid reminder check'});
      const reminder=await one('jiha_reminders',`id=eq.${filter(input.id)}&active=eq.true&select=*`),today=malaysiaToday();
      if(!reminder||!reminderDue(reminder,today))return json(400,{error:'This reminder is not due today'});
      const valid=new Set(reminder.checklist.map(item=>item.id));
      if(input.checked.some(id=>!valid.has(id)))return json(400,{error:'Invalid checklist item'});
      await db('/rest/v1/jiha_reminder_days?on_conflict=reminder_id,day','POST',{reminder_id:reminder.id,day:today,checked:[...new Set(input.checked)],items_snapshot:reminder.checklist,updated_at:new Date().toISOString()},'resolution=merge-duplicates,return=representation');
      return json(200,{ok:true});
    }
    if(action==='createUser'){
      const username=String(input.username||'').trim().toLowerCase(),name=String(input.name||'').trim(),role=input.role==='manager'?'manager':'hp';
      if(role==='manager'&&user.role!=='admin')return json(403,{error:'Only admin can create a manager'});
      if(username==='admin'||username==='jiha'&&role!=='manager'||role==='manager'&&username!=='jiha')return json(400,{error:'Use jiha for the manager account and another code for HPs'});
      if(!validUsername(username)||name.length<1||name.length>100||!validPassword(input.password))return json(400,{error:'Enter a valid username, name and password of 12–128 characters'});
      if(await one('app_users',`username=eq.${filter(username)}&select=id`))return json(409,{error:'Username already exists'});
      const created=(await insert('app_users',{username,name,role,password_hash:await hashPassword(input.password)}))[0];
      if(role==='hp')try{await insert('team_hps',{code:username.toUpperCase(),owner_id:created.id,parent_id:user.role==='hp'?user.id:null,name,metrics:{}})}catch(error){await del('app_users',`id=eq.${filter(created.id)}`);throw error}
      if(role==='manager')try{await ensureJihaHp()}catch(error){await del('app_users',`id=eq.${filter(created.id)}`);throw error}
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
