import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('Jiha personal SHI and group SHI use their own collection denominators',()=>{
  const source=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
  const names=['number','shi','collections','teamCollections','teamActual','teamDashboardValues'];
  const declarations=names.map(name=>source.match(new RegExp(`function ${name}\\([^\\n]+`))[0]).join('\n');
  const context={
    dashboardRows:['Keyin','Net','Recruitment:','NAHP','AHP','Total HP','T/O','SHI Group','SHI Personal','WS Player','Target Collection','Actual Collection'],
    hpRows:['Keyin','Net','Recruitment:','NAHP','AHP','Total HP','T/O','SHI Personal','WS Player','Target Collection','Actual Collection']
  };
  vm.createContext(context);
  vm.runInContext(`${declarations}\nthis.calculate=teamDashboardValues`,context);
  const team=[
    {code:'JIHA',metrics:{'hp-9-target':'100','hp-10-actual':'60'}},
    {code:'NAJWA',metrics:{'hp-9-target':'300','hp-10-actual':'140'}}
  ];
  const result=context.calculate({},team);
  assert.equal(result['score-8-actual'],'60.0%');
  assert.equal(result['score-7-actual'],'50.0%');
  team[0].metrics['hp-10-actual']='100';
  assert.equal(context.calculate({},team)['score-7-actual'],'60.0%');
  assert.equal(context.calculate({},[{code:'JIHA',metrics:{}}])['score-8-actual'],'—');
});
