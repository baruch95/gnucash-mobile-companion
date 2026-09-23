const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../core.js');
const {create}=require('../storage.js');
const config={accounts:[{id:'revg',label:'EUR',path:'Assets:EUR',currency:'EUR'},{id:'chf',label:'CHF',path:'Assets:CHF',currency:'CHF'}],categories:['Food'],necessaryPath:'Expenses:Necessary',leisurePath:'Expenses:Leisure',nicoSharePercent:43,gioSharePercent:57};
const entry={id:'one',accountId:'revg',type:'expense',spendingClass:'Necessary',title:'Food',date:'2026-09-12',amount:'100',currency:'EUR',accountCurrency:'EUR',fxRate:'0.9',fxDate:'2026-09-11',chfAmount:'90'};
const fresh=()=>({config:structuredClone(config),entries:[structuredClone(entry)],presets:[{...entry,id:'shortcut',nickname:'Groceries'}]});
const validate=value=>core.validateState(value,config);
test('exact minor units, half-up conversion and shares',()=>{
 assert.equal(core.convert('1.01','0.5'),'0.51');
 assert.equal(core.share('0.05','50'),'0.03');
 assert.equal(core.convert('100','0.9',true),'111.11');
 for(const value of ['1.005','0','-1','Infinity','1e3','999999999999']) assert.throws(()=>core.minor(value));
});
test('split prices reproduce rounded account amounts and transaction values balance',()=>{
 for(const amount of ['0.01','1.01','1234.56','999999.99']) {
  const e={...entry,amount,currency:'CHF',chfAmount:amount,fxRate:'0.913457'};
  const rows=core.splitRows(e,config);
  assert.equal(Number(rows[0][9])+Number(rows[1][9]),0);
  assert.equal(rows[1][7],amount);
  assert.equal((Number(rows[1][7])*Number(rows[1][8])).toFixed(2), rows[1][9]);
 }
 assert.throws(()=>core.splitRows({...entry,chfAmount:'95'},config),/disagrees/);
});
test('CSV notes and memos exclude generated FX details',()=>{
 const rows=core.splitRows({...entry,memo:'Corner shop',fxSource:'manual'},config);
 for(const row of rows) { assert.equal(row[3],''); assert.equal(row[5],'Corner shop'); }
 const converted=core.splitRows({...entry,currency:'CHF',amount:'90',chfAmount:'90',memo:''},config);
 for(const row of converted) { assert.equal(row[3],''); assert.equal(row[5],''); }
});
test('REV-N2 EUR purchase exports CHF account amounts and EUR transaction values',()=>{
 const purchase={...entry,accountId:'chf',accountCurrency:'CHF',amount:'13.30',currency:'EUR',fxRate:'0.94611',chfAmount:'12.58',memo:'Autostrada'};
 const rows=core.splitRows(purchase,config);
 assert.deepEqual(rows.map(row=>row[7]),['-12.58','12.58']);
 assert.deepEqual(rows.map(row=>row[9]),['-13.30','13.30']);
 assert.deepEqual(rows.map(row=>row[4]),['CURRENCY::EUR','CURRENCY::EUR']);
 assert.deepEqual(rows.map(row=>row[5]),['Autostrada','Autostrada']);
});
test('backup validation retains presets and rejects malformed records and dangling links',()=>{
 assert.deepEqual(validate(fresh()).presets,fresh().presets);
 for(const mutate of [s=>s.entries.push(s.entries[0]),s=>s.entries[0].accountId='missing',s=>s.entries[0].date='2026-02-30',s=>s.entries[0].amount='oops',s=>s.entries[0].generatedFrom='missing',s=>s.presets[0].currency='USD',s=>s.config.accounts[0].id='bad"id']) {
  const state=fresh(); mutate(state); assert.throws(()=>validate(state));
 }
});
test('failed write preserves the committed state, recovery restores presets',()=>{
 let raw=JSON.stringify(fresh()), fail=false;
 const storage={getItem:()=>raw,setItem:(key,value)=>{if(fail)throw Error('Quota exceeded');raw=value;}};
 const store=create(storage,'key',validate,fresh);const next=store.read();next.entries[0].amount='200';
 fail=true;assert.throws(()=>store.save(next),/Quota/);assert.equal(store.read().entries[0].amount,'100');
 fail=false;store.save(next,true);assert.equal(store.read().entries[0].amount,'200');assert.equal(store.read().presets[0].nickname,'Groceries');
});
test('unreadable storage cannot be overwritten by ordinary saves',()=>{
 let raw='{broken';const store=create({getItem:()=>raw,setItem:(k,v)=>raw=v},'key',validate,fresh);
 assert.match(store.problem,/preserved/);assert.throws(()=>store.save(fresh()),/protected/);assert.equal(raw,'{broken');
 store.save(fresh(),true);assert.equal(JSON.parse(raw).presets.length,1);
});
test('CSV quotes carriage returns, line breaks and quotes',()=>{
 assert.equal(core.csvCell('a\rb'),'"a\rb"');assert.equal(core.csvCell('a"b'),'"a""b"');
});
test('documented import fixture exports exact Values and account amounts',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const fixtureConfig={accounts:[{id:'revg',path:'Assets:Test:EUR',currency:'EUR'}],necessaryPath:'Expenses:Necessary'};
 const base={date:'2026-09-12',accountId:'revg',type:'expense',spendingClass:'Necessary',title:'Food',currency:'EUR',amount:'100.00',chfAmount:'90.00',fxRate:'0.9',fxDate:'2026-09-12',fxSource:'manual'};
 const rows=[['Transaction ID','Date','Description','Notes','Commodity/Currency','Memo','Account','Deposit','Price','Value'],...core.splitRows({...base,id:'example-expense'},fixtureConfig),...core.splitRows({...base,id:'example-refund',type:'refund',amount:'10.00',chfAmount:'9.00'},fixtureConfig)];
 assert.equal(rows[2][7],'90.00');assert.equal(rows[2][9],'100.00');
 assert.equal(fs.readFileSync(path.join(__dirname,'import-example.csv'),'utf8'),rows.map(r=>r.map(core.csvCell).join(',')).join('\r\n')+'\r\n');
});
