import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('any signed-in HP can trigger the archive after the end date',async()=>{
  process.env.SUPABASE_SECRET_KEY='test-only';
  const token='b'.repeat(64),calls=[],originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{
    const parsed=new URL(url),table=parsed.pathname.split('/').at(-1);
    calls.push(parsed.pathname);
    if(table==='app_sessions')return Response.json([{user_id:'hp-id',expires_at:new Date(Date.now()+86400000).toISOString()}]);
    if(table==='app_users')return Response.json(parsed.searchParams.get('username')?[]:[{id:'hp-id',username:'najwa',name:'Najwa',role:'hp',active:true}]);
    if(table==='close_team_month')return Response.json(false);
    if(table==='report_settings')return Response.json([{period_start:'2020-01-01',period_end:'2020-01-31',timeline_start:'2020-01-01',timeline_end:'2020-06-30'}]);
    if(table==='weekly_plans')return Response.json([1,2,3,4].map(week_no=>({period_start:'2020-01-01',week_no,end_date:`2020-01-${String(week_no*7).padStart(2,'0')}`,goals:[]})));
    if(table==='team_dashboard')return Response.json([{values:{}}]);
    if(table==='team_hps'||table==='monthly_reports')return Response.json([]);
    throw new Error(`Unexpected table ${table}`);
  };
  try{
    const {default:handler}=await import('../netlify/functions/api.mjs');
    const request=new Request('https://example.test/.netlify/functions/api',{method:'POST',headers:{cookie:`jiha_session=${token}`,'content-type':'application/json'},body:JSON.stringify({action:'state'})});
    const response=await handler(request);
    assert.equal(response.status,200);
    assert.equal((await response.json()).user.role,'hp');
    assert.equal(calls.filter(path=>path.endsWith('/close_team_month')).length,1);
    assert.match(readFileSync(new URL('../supabase/month-end-archive.sql',import.meta.url),'utf8'),/period_end < \(now\(\) at time zone 'Asia\/Kuala_Lumpur'\)::date/);
  }finally{globalThis.fetch=originalFetch}
});
