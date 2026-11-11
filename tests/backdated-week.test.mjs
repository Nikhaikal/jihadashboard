import test from 'node:test';
import assert from 'node:assert/strict';

test('manager can move the active period start before today and save four past week ends',async()=>{
  process.env.SUPABASE_SECRET_KEY='test-only';
  const token='c'.repeat(64),originalFetch=globalThis.fetch;
  let saved=null;
  globalThis.fetch=async(url,options={})=>{
    const parsed=new URL(url),table=parsed.pathname.split('/').at(-1);
    if(table==='app_sessions')return Response.json([{user_id:'manager-id',expires_at:new Date(Date.now()+86400000).toISOString()}]);
    if(table==='app_users')return Response.json([{id:'manager-id',username:'jiha',name:'Jiha',role:'manager',active:true}]);
    if(table==='report_settings')return Response.json([{period_start:'2026-11-11',period_end:'2026-12-11'}]);
    if(table==='weekly_plans')return Response.json([1,2,3,4].map(week_no=>({period_start:'2026-11-11',week_no,end_date:`2026-12-${String(week_no*2).padStart(2,'0')}`,goals:[]})));
    if(table==='set_week_period'){saved=JSON.parse(options.body);return Response.json(null)}
    throw new Error(`Unexpected table ${table}`);
  };
  try{
    const {default:handler}=await import('../netlify/functions/api.mjs');
    const request=new Request('https://example.test/.netlify/functions/api',{method:'POST',headers:{cookie:`jiha_session=${token}`,'content-type':'application/json'},body:JSON.stringify({action:'setWeekEnds',start:'2026-10-01',ends:['2026-10-07','2026-10-14','2026-10-21','2026-10-28']})});
    const response=await handler(request);
    assert.equal(response.status,200);
    assert.deepEqual(saved,{p_start:'2026-10-01',p_ends:['2026-10-07','2026-10-14','2026-10-21','2026-10-28']});
  }finally{globalThis.fetch=originalFetch}
});
