import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('submitting Jiha 3 and Najwa 2 yields team Keyin 5, ignoring an old dashboard Actual',async()=>{
  process.env.SUPABASE_SECRET_KEY='test-only';
  const token='a'.repeat(64),hash=createHash('sha256').update(token).digest('hex');
  const user={id:'admin-id',username:'admin',name:'Admin',role:'admin',active:true};
  const stored={dashboard:{'score-0-actual':'4'},hps:[
    {code:'JIHA',owner_id:'jiha-id',parent_id:null,name:'Jiha',metrics:{'hp-0-actual':'2'},hidden_rows:[]},
    {code:'NAJWA',owner_id:'najwa-id',parent_id:null,name:'Najwa',metrics:{'hp-0-actual':'1'},hidden_rows:[]}
  ]};
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{
    const parsed=new URL(url),table=parsed.pathname.split('/').at(-1),method=options.method||'GET';
    if(table==='app_sessions')return Response.json([{user_id:user.id,expires_at:new Date(Date.now()+86400000).toISOString()}]);
    if(table==='app_users')return Response.json([user]);
    if(table==='team_dashboard'){
      if(method==='PATCH')stored.dashboard=JSON.parse(options.body).values;
      return Response.json([{values:stored.dashboard}]);
    }
    if(table==='team_hps'){
      if(method==='PATCH'){
        const code=decodeURIComponent(parsed.searchParams.get('code').slice(3));
        const hp=stored.hps.find(item=>item.code===code);
        hp.metrics=JSON.parse(options.body).metrics;
        return Response.json([hp]);
      }
      return Response.json(stored.hps);
    }
    throw new Error(`Unexpected table ${table}`);
  };
  try{
    const {default:handler}=await import('../netlify/functions/api.mjs');
    const request=new Request('https://example.test/.netlify/functions/api',{method:'POST',headers:{cookie:`jiha_session=${token}`,'content-type':'application/json'},body:JSON.stringify({action:'submitFigures',dashboardChanges:{'score-0-target':'15'},hpChanges:{JIHA:{'hp-0-actual':'3'},NAJWA:{'hp-0-actual':'2'}}})});
    const response=await handler(request);
    assert.equal(response.status,200);
    const data=await response.json();
    assert.equal(data.hps.find(hp=>hp.code==='JIHA').metrics['hp-0-actual'],'3');
    assert.equal(data.hps.find(hp=>hp.code==='NAJWA').metrics['hp-0-actual'],'2');
    assert.equal(data.dashboard['score-0-actual'],'4');
    assert.equal(data.dashboard['score-0-target'],'15');
    const source=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
    const math=source.match(/function teamActual\([^\n]+/)[0];
    const context={number:value=>Number(value)||0};
    vm.createContext(context);
    vm.runInContext(`${math}; this.total=teamActual`,context);
    assert.equal(context.total(data.hps,0),5);
    for(const [jihaKeyin,expectedTotal] of [['5',7],['2',4]]){
      const correction=new Request('https://example.test/.netlify/functions/api',{method:'POST',headers:{cookie:`jiha_session=${token}`,'content-type':'application/json'},body:JSON.stringify({action:'submitFigures',dashboardChanges:{},hpChanges:{JIHA:{'hp-0-actual':jihaKeyin}}})});
      const corrected=await handler(correction);
      assert.equal(corrected.status,200);
      assert.equal(context.total((await corrected.json()).hps,0),expectedTotal);
    }
  }finally{globalThis.fetch=originalFetch}
});
