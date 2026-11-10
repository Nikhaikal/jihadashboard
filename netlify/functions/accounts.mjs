const url = process.env.SUPABASE_URL || 'https://qsqsdhvfvqrckcridoiq.supabase.co';
const anon = process.env.SUPABASE_ANON_KEY || 'sb_publishable_fdgUL8ukWz9FwGBlGvV8LA_j_KvD_dN';
const secret = process.env.SUPABASE_SECRET_KEY;
const adminEmail = 'nikkhaikal@gmail.com';
const jihaEmail = 'nealia.najihah@gmail.com';
const json = (status, body) => new Response(JSON.stringify(body), {status, headers:{'content-type':'application/json','cache-control':'no-store'}});
async function api(path, method, key, body, bearer) {
  const headers={apikey:key,'content-type':'application/json'};
  if(bearer) headers.Authorization=`Bearer ${bearer}`;
  const response = await fetch(`${url}${path}`, {method, headers,body:body===undefined?undefined:JSON.stringify(body)});
  const data = await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.msg||data.message||data.error_description||data.error||`Supabase ${response.status}`);
  return data;
}
const validPassword = p => typeof p==='string'&&p.length>=12&&p.length<=128;
const validCode = s => typeof s==='string'&&/^[A-Z0-9-]{2,24}$/.test(s);
const loginEmail = code => `${code.toLowerCase()}@users.jihadashboard.invalid`;

export default async function handler(request) {
  if(request.method!=='POST') return json(405,{error:'POST required'});
  if(!secret) return json(503,{error:'Account service is not configured. Add SUPABASE_SECRET_KEY in Netlify.'});
  try {
    const bearer = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if(!bearer) return json(401,{error:'Sign in first'});
    const who = await api('/auth/v1/user','GET',anon,undefined,bearer);
    const email = who.email?.toLowerCase();
    const isAdmin = email===adminEmail;
    const isManager = isAdmin||email===jihaEmail;
    const {action,...input} = await request.json();
    if(action==='create') {
      if(!isManager) return json(403,{error:'Only admin and Jiha can create accounts'});
      const code=String(input.code||'').trim().toUpperCase(),name=String(input.name||'').trim();
      if(!validCode(code)||name.length<1||name.length>100||!validPassword(input.password)) return json(400,{error:'Use a valid HP code, name and password of 12–128 characters'});
      const existing=await api(`/rest/v1/hps?code=eq.${encodeURIComponent(code)}&select=code`,'GET',secret);
      if(existing.length) return json(409,{error:'HP code already exists'});
      const created=await api('/auth/v1/admin/users','POST',secret,{email:loginEmail(code),password:input.password,email_confirm:true,user_metadata:{name,hp_code:code}});
      try {
        await api('/rest/v1/hps','POST',secret,{code,uid:created.id,parent_uid:null,email:loginEmail(code),name,metrics:{}});
        await api('/rest/v1/profiles','POST',secret,{id:created.id,email:loginEmail(code),name,hp_code:code,parent_uid:null});
      } catch(error) {
        await api(`/rest/v1/hps?code=eq.${encodeURIComponent(code)}`,'DELETE',secret).catch(()=>{});
        await api(`/auth/v1/admin/users/${created.id}`,'DELETE',secret).catch(()=>{});
        throw error;
      }
      return json(200,{ok:true,code});
    }
    if(!isAdmin) return json(403,{error:'Only admin can manage passwords and inactive users'});
    if(action==='list') {
      const result=await api('/auth/v1/admin/users?per_page=1000','GET',secret);
      const users=result.users||[];
      return json(200,{users:users.filter(u=>u.email?.endsWith('@users.jihadashboard.invalid')||[adminEmail,jihaEmail].includes(u.email?.toLowerCase())).map(u=>({id:u.id,username:u.email?.toLowerCase()===adminEmail?'admin':u.email?.toLowerCase()===jihaEmail?'jiha':u.user_metadata?.hp_code||u.email.split('@')[0].toUpperCase(),name:u.user_metadata?.name||'',can_delete:u.email?.endsWith('@users.jihadashboard.invalid'),created_at:u.created_at,last_sign_in_at:u.last_sign_in_at}))});
    }
    if(!/^[0-9a-f-]{36}$/i.test(input.userId||'')) return json(400,{error:'Invalid user'});
    const target=await api(`/auth/v1/admin/users/${input.userId}`,'GET',secret);
    if(action==='password') {
      if(!target.email?.endsWith('@users.jihadashboard.invalid')&&![adminEmail,jihaEmail].includes(target.email?.toLowerCase())) return json(403,{error:'This account cannot be changed here'});
      if(!validPassword(input.password)) return json(400,{error:'Password must be 12–128 characters'});
      await api(`/auth/v1/admin/users/${input.userId}`,'PUT',secret,{password:input.password});
      return json(200,{ok:true});
    }
    if(action==='delete') {
      if(!target.email?.endsWith('@users.jihadashboard.invalid')) return json(403,{error:'Manager accounts cannot be deleted here'});
      const last=target.last_sign_in_at?new Date(target.last_sign_in_at).getTime():0;
      if(last && Date.now()-last<90*86400000) return json(409,{error:'Only accounts inactive for 90 days can be deleted'});
      await api(`/auth/v1/admin/users/${input.userId}`,'DELETE',secret);
      return json(200,{ok:true});
    }
    return json(400,{error:'Unknown action'});
  } catch(error) { return json(400,{error:error.message||'Request failed'}); }
}
