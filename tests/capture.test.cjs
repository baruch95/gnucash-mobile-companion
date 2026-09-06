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
  vm.runInContext(script.slice(0, end) + '\n globalThis.api = { splitRows, needsFx, stepsForType, validateAndSave, loadEntry, resetForm, read:()=>state.entries }; })();', context);
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
    assert.equal(rows[0][5],sourceAmount);
    assert.equal(rows[0][7],account === 'revg' ? 'EUR' : currency);
    if (account === 'revg') { assert.equal(rows[0][8],'-111.11'); assert.match(rows[0][3], /Original amount 100.00 CHF/); }
    assert.equal(Number(rows[0][8]) + Number(rows[1][8]),0);
    const refund = c.api.splitRows({...entry,type:'refund'});
    assert.equal(Number(refund[0][5]),-Number(rows[0][5]));
    assert.equal(Number(refund[0][8]) + Number(refund[1][8]),0);
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
  assert.equal(rows[0][5],'-100.00'); assert.equal(rows[1][5],'90.00');
});

test('cross-currency transfers convert both account splits and balance transaction values', () => {
  const c = capture(); c.configure('revg','CHF','transfer','revn2');
  c.element('fx-rate').value='0.9'; c.element('chf-amount').value='100';
  c.api.validateAndSave({preventDefault(){}});
  const rows = c.api.splitRows(c.api.read()[0]);
  assert.equal(rows[0][5],'-111.11'); assert.equal(rows[0][6],'EUR');
  assert.equal(rows[1][5],'100.00'); assert.equal(rows[1][6],'CHF');
  assert.equal(rows[0][7],'EUR'); assert.equal(rows[1][7],'EUR');
  assert.equal(rows[0][8],'-111.11'); assert.equal(rows[1][8],'111.11');
  assert.equal(Number(rows[0][8]) + Number(rows[1][8]),0);
});

test('legacy EUR drafts retain their explicit conversion on export', () => {
  const c = capture();
  const rows = c.api.splitRows({id:'old',accountId:'revg',type:'expense',spendingClass:'Necessary',currency:'EUR',amount:'100',fxRate:'0.95',chfAmount:'95'});
  assert.equal(rows[0][5],'-100.00'); assert.equal(rows[1][5],'95.00');
});
