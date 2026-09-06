const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function capture() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const script = html.split('<script>')[1].split('</script>')[0];
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value:'', classList:{toggle(){}}, reset(){}, focus(){}, select(){} });
    return elements.get(id);
  };
  const context = vm.createContext({
    document:{getElementById:element, querySelectorAll:()=>[], querySelector:()=>null},
    localStorage:{getItem:()=>null, setItem(){}}, crypto:{randomUUID:()=> 'test-id'},
    window:{scrollTo(){}}, clearTimeout(){}, setTimeout(){}, console,
  });
  const end = script.indexOf('      document.querySelectorAll("[data-type]").forEach((button) => button.addEventListener');
  vm.runInContext(script.slice(0, end) + '\n globalThis.api = { splitRows, needsFx, stepsForType, validateAndSave, loadEntry, resetForm, markUnexported, ubsSplitDetails, chooseUbs:(value)=>{ubsSplitChoice=value;currentStep="ubs-split"}, setShares:(nico,gio)=>{state.config.nicoSharePercent=nico;state.config.gioSharePercent=gio}, read:()=>state.entries }; })();', context);
  const configure = (accountId, currency, type = 'expense', to = '') => {
    // Set through loadEntry so the same restoration path used by real saved drafts is exercised.
    context.api.loadEntry({id:'test-id',type,spendingClass:'Necessary',title:'Food',date:'2026-09-06',amount:'100',currency,accountId,toAccountId:to,fxRate:null,chfAmount:currency === 'CHF' ? '100' : null});
  };
  return {api:context.api, element, configure};
}

test('Revolut currency determines FX step and appears immediately after account', () => {
  const c = capture();
  for (const [id,currency,fx] of [['revg','EUR',false],['revg','CHF',true],['revn2','CHF',false],['revn2','EUR',true]]) {
    c.configure(id,currency);
    assert.equal(c.api.needsFx(),fx);
    const steps = Array.from(c.api.stepsForType());
    assert.equal(steps[steps.indexOf('account') + 1],'currency');
    assert.equal(steps.includes('fx'),fx);
  }
  c.configure('cumulus','CHF');
  assert.equal(c.api.stepsForType().includes('currency'),false);
});

test('foreign Revolut purchases and refunds retain transaction and account amounts', () => {
  for (const [account,currency,sourceAmount] of [['revg','CHF','-111.11'],['revn2','EUR','-90.00']]) {
    const c = capture(); c.configure(account,currency);
    c.element('fx-rate').value='0,9'; c.element('chf-amount').value=currency === 'CHF' ? '100' : '90';
    c.api.validateAndSave({preventDefault(){}});
    const entry = c.api.read()[0]; assert.ok(entry);
    assert.equal(entry.currency,currency);
    const rows = c.api.splitRows(entry);
    assert.equal(rows[0][7], account === 'revg' ? '-111.11' : '-100.00');
    assert.equal(rows[0][4],`CURRENCY::${account === 'revg' ? 'EUR' : currency}`);
    if (account === 'revg') { assert.equal(sourceAmount,'-111.11'); assert.match(rows[0][5], /Original amount 100.00 CHF/); }
    assert.doesNotMatch(rows[0][5], /capture:|test-id/);
    assert.equal(Number(rows[0][7]) + Number(rows[1][7]),0);
    const refund = c.api.splitRows({...entry,type:'refund'});
    assert.equal(Number(refund[0][7]),-Number(rows[0][7]));
    assert.equal(Number(refund[0][7]) + Number(refund[1][7]),0);
    c.api.loadEntry(entry); assert.equal(c.api.needsFx(),true);
  }
});

test('native EUR draft saves without guessing CHF and requires conversion for expense CSV', () => {
  const c = capture(); c.configure('revg','EUR');
  c.api.validateAndSave({preventDefault(){}});
  const entry = c.api.read()[0];
  assert.equal(entry.chfAmount,null); assert.equal(entry.fxRate,null);
  assert.throws(()=>c.api.splitRows(entry), /Add a CHF value/);
  c.api.loadEntry({...entry,fxRate:'0.9',chfAmount:'90'});
  c.api.validateAndSave({preventDefault(){}});
  const rows = c.api.splitRows(c.api.read()[0]);
  assert.equal(rows[0][7],'-100.00'); assert.equal(rows[1][7],'100.00');
  assert.equal(rows[1][8],'0.900000');
});

test('cross-currency transfers convert both account splits and balance transaction values', () => {
  const c = capture(); c.configure('revg','CHF','transfer','revn2');
  c.element('fx-rate').value='0.9'; c.element('chf-amount').value='100';
  c.api.validateAndSave({preventDefault(){}});
  const rows = c.api.splitRows(c.api.read()[0]);
  assert.equal(rows[0][4],'CURRENCY::EUR'); assert.equal(rows[1][4],'CURRENCY::EUR');
  assert.equal(rows[0][7],'-111.11'); assert.equal(rows[1][7],'111.11');
  assert.equal(rows[1][8],'0.900000');
  assert.equal(Number(rows[0][7]) + Number(rows[1][7]),0);
});

test('legacy EUR drafts retain their explicit conversion on export', () => {
  const c = capture();
  const rows = c.api.splitRows({id:'old',accountId:'revg',type:'expense',spendingClass:'Necessary',currency:'EUR',amount:'100',fxRate:'0.95',chfAmount:'95'});
  assert.equal(rows[0][7],'-100.00'); assert.equal(rows[1][7],'100.00');
  assert.equal(rows[1][8],'0.950000');
});

test('UBS shared expense generates the reimbursement from the other account', () => {
  for (const [payer,from,percentage,amount] of [['ubsg','ubsn',43,'43.00'],['ubsn','ubsg',57,'57.00']]) {
    const c = capture(); c.configure(payer,'CHF');
    c.api.chooseUbs(true); c.api.validateAndSave({preventDefault(){}});
    const [expense,transfer] = c.api.read();
    assert.equal(expense.accountId,payer);
    assert.equal(transfer.type,'transfer'); assert.equal(transfer.accountId,from); assert.equal(transfer.toAccountId,payer);
    assert.equal(transfer.amount,amount); assert.equal(transfer.generatedFrom,expense.id);
    assert.match(transfer.memo,new RegExp(`${percentage}%`));
  }
});

test('configured UBS shares drive generated transfer amounts', () => {
  const c = capture(); c.api.setShares(40,60); c.configure('ubsg','CHF');
  assert.equal(c.api.ubsSplitDetails().percentage,40);
  c.api.chooseUbs(true); c.api.validateAndSave({preventDefault(){}});
  assert.equal(c.api.read()[1].amount,'40.00');
});

test('declining UBS split saves only the expense', () => {
  const c = capture(); c.configure('ubsn','CHF'); c.api.chooseUbs(false);
  c.api.validateAndSave({preventDefault(){}});
  assert.equal(c.api.read().length,1);
});

test('marking an exported draft unexported preserves it for the next CSV', () => {
  const c = capture(); c.configure('cumulus','CHF'); c.api.validateAndSave({preventDefault(){}});
  const entry = c.api.read()[0]; entry.exportedAt = '2026-09-06T12:00:00Z';
  c.api.markUnexported(entry.id);
  assert.equal(c.api.read().length,1); assert.equal(c.api.read()[0].exportedAt,null);
});
