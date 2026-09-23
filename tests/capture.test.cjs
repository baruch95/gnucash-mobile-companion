const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function capture() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value:'', classList:{toggle(){}}, setAttribute(){}, reset(){}, focus(){}, select(){} });
    return elements.get(id);
  };
  const context = vm.createContext({
    document:{getElementById:element, querySelectorAll:()=>[], querySelector:()=>null},
    localStorage:{getItem:()=>null, setItem(){}}, crypto:{randomUUID:()=> require('node:crypto').randomUUID()}, CaptureCore:require('../core.js'), CaptureStorage:require('../storage.js'), confirm:()=>true,
    window:{scrollTo(){}}, clearTimeout(){}, setTimeout(){}, console,
  });
  const end = script.indexOf('      document.querySelectorAll("[data-type]").forEach((button) => button.addEventListener');
  vm.runInContext(script.slice(0, end) + '\n globalThis.api = { splitRows, renderEntries, markImported, deleteEntry, clearImported, fetchFx, invalidateFx, needsFx, stepsForType, canOfferUbsSplit, validateAndSave, loadEntry, resetForm, markUnexported, savePreset, applyPreset, deletePreset, renamePreset, ubsSplitDetails, chooseUbs:(value)=>{ubsSplitChoice=value;currentStep="ubs-split"}, startExpense:(accountId)=>{resetForm();type="expense";spendingClass="Necessary";$("account").value=accountId;currentStep="account"}, setShares:(nico,gio)=>{state.config.nicoSharePercent=nico;state.config.gioSharePercent=gio}, setQuickAmount:(value)=>{$("quick-amount").value=value}, read:()=>state.entries, presets:()=>state.presets, step:()=>currentStep }; })();', context);
  const configure = (accountId, currency, type = 'expense', to = '') => {
    // Set through loadEntry so the same restoration path used by real saved drafts is exercised.
    context.api.loadEntry({id:'test-id',type,spendingClass:'Necessary',title:'Food',date:'2026-09-06',amount:'100',currency,accountId,toAccountId:to,fxRate:null,chfAmount:currency === 'CHF' ? '100' : null});
  };
  return {api:context.api, element, configure};
}

test('hidden quick amount does not block normal form submission', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /id="quick-amount"/);
  assert.doesNotMatch(html, /id="quick-amount"[^>]*\brequired\b/);
});

test('quick transaction launcher is placed below the three transaction choices', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const choices = html.indexOf('data-type="transfer"');
  const launcher = html.indexOf('id="quick-toggle"');
  assert.ok(launcher > choices);
  assert.match(html.slice(launcher, launcher + 180), /Quick transaction/);
});

test('quick transaction launcher opens a dedicated list with one preset container', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /data-step="quick-list"/);
  assert.equal((html.match(/id="quick-presets"/g) || []).length, 1);
  assert.match(fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8'), /Math\.max\(1, progressSteps\.length - 1\)/);
  assert.match(html, /id="manage-quick"/);
  assert.match(html, /id="quick-management"/);
  assert.doesNotMatch(html, /data-delete-preset=/);
  assert.match(fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8'), /data-delete-managed-preset=/);
  assert.match(fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8'), /data-preset-nickname=/);
});

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
    assert.equal(rows[0][7], account === 'revg' ? '-111.11' : '-90.00');
    assert.equal(rows[0][4],`CURRENCY::${account === 'revg' ? 'EUR' : currency}`);
    if (account === 'revg') assert.equal(sourceAmount,'-111.11');
    assert.equal(rows[0][5],'');
    assert.doesNotMatch(rows[0][5], /capture:|test-id/);
    assert.equal(Number(rows[0][9]) + Number(rows[1][9]),0);
    const refund = c.api.splitRows({...entry,type:'refund'});
    assert.equal(Number(refund[0][7]),-Number(rows[0][7]));
    assert.equal(Number(refund[0][9]) + Number(refund[1][9]),0);
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
  assert.equal(rows[0][7],'-100.00'); assert.equal(rows[1][7],'90.00');
  assert.ok(Math.abs(Number(rows[1][8])-(100/90))<0.00002);
});

test('cross-currency transfers convert both account splits and balance transaction values', () => {
  const c = capture(); c.configure('revg','CHF','transfer','revn2');
  c.element('fx-rate').value='0.9'; c.element('chf-amount').value='100';
  c.api.validateAndSave({preventDefault(){}});
  const rows = c.api.splitRows(c.api.read()[0]);
  assert.equal(rows[0][4],'CURRENCY::EUR'); assert.equal(rows[1][4],'CURRENCY::EUR');
  assert.equal(rows[0][7],'-111.11'); assert.equal(rows[1][7],'100.00');
  assert.ok(Math.abs(Number(rows[1][8])-(100/90))<0.00002);
  assert.equal(Number(rows[0][9]) + Number(rows[1][9]),0);
});

test('legacy EUR drafts retain their explicit conversion on export', () => {
  const c = capture();
  const rows = c.api.splitRows({id:'old',accountId:'revg',type:'expense',spendingClass:'Necessary',currency:'EUR',amount:'100',fxRate:'0.95',chfAmount:'95'});
  assert.equal(rows[0][7],'-100.00'); assert.equal(rows[1][7],'95.00');
  assert.ok(Math.abs(Number(rows[1][8])-100/95)<0.000000001);
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

test('new expenses prompt for a UBS split after selecting the source account', () => {
  for (const accountId of ['ubsg', 'ubsn']) {
    const c = capture(); c.api.startExpense(accountId);
    assert.equal(c.api.canOfferUbsSplit(), true);
    assert.ok(c.api.stepsForType().includes('ubs-split'));
  }
  const card = capture(); card.api.startExpense('cumulus');
  assert.equal(card.api.canOfferUbsSplit(), false);
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

test('saved transaction shortcut restores details and asks only for amount', () => {
  const c = capture(); c.configure('cumulus','CHF'); c.element('memo').value='Weekly shop';
  c.api.validateAndSave({preventDefault(){}});
  const original = c.api.read()[0]; c.api.savePreset(original);
  const preset = c.api.presets()[0];
  assert.equal(preset.amount,'100.00'); assert.equal(preset.memo,'Weekly shop');
  c.api.applyPreset(preset);
  assert.equal(c.api.step(),'quick-amount'); assert.deepEqual(Array.from(c.api.stepsForType()),['quick-amount']);
  assert.equal(c.element('quick-amount').value,'100.00');
  c.api.setQuickAmount('125,50'); c.api.validateAndSave({preventDefault(){}});
  assert.equal(c.api.read()[1].amount,'125.50'); assert.equal(c.api.read()[1].memo,'Weekly shop');
});

test('saved transaction shortcut supports an independent nickname', () => {
  const c = capture(); c.configure('cumulus','CHF'); c.api.validateAndSave({preventDefault(){}});
  c.api.savePreset(c.api.read()[0]); const preset = c.api.presets()[0];
  c.api.renamePreset(preset.id, 'Saturday groceries');
  assert.equal(c.api.presets()[0].nickname, 'Saturday groceries');
  c.api.applyPreset(c.api.presets()[0]);
  assert.equal(c.api.step(), 'quick-amount');
});

test('UBS shortcut remembers whether to generate the configured split', () => {
  const c = capture(); c.configure('ubsg','CHF'); c.api.chooseUbs(true); c.api.validateAndSave({preventDefault(){}});
  c.api.savePreset(c.api.read()[0]); const preset = c.api.presets()[0]; assert.equal(preset.ubsSplit,true);
  c.api.applyPreset(preset); c.api.setQuickAmount('200'); c.api.validateAndSave({preventDefault(){}});
  const newExpense = c.api.read()[2], transfer = c.api.read()[3];
  assert.equal(transfer.generatedFrom,newExpense.id); assert.equal(transfer.amount,'86.00');
});

test('quick transaction shortcut can be removed without changing drafts', () => {
  const c = capture(); c.configure('cumulus','CHF'); c.api.validateAndSave({preventDefault(){}}); c.api.savePreset(c.api.read()[0]);
  c.api.deletePreset(c.api.presets()[0].id);
  assert.equal(c.api.presets().length,0); assert.equal(c.api.read().length,1);
});


test('editing downloaded drafts flags corrections and blocks imported cleanup', () => {
  const c=capture(); c.configure('cumulus','CHF'); c.api.validateAndSave({preventDefault(){}});
  const entry=c.api.read()[0]; entry.exportedAt='2026-09-12T12:00:00Z';
  c.api.markImported(entry.id); c.api.loadEntry(c.api.read()[0]); c.element('amount').value='200';
  c.api.validateAndSave({preventDefault(){}});
  assert.equal(c.api.read()[0].changedSinceExport,true);
  c.api.clearImported(); assert.equal(c.api.read().length,1);
  c.api.markUnexported(entry.id); assert.equal(c.api.read()[0].exportedAt,null);
});

test('linked reimbursements update, retain identity when edited and delete with the expense', () => {
  const c=capture(); c.configure('ubsg','CHF'); c.api.chooseUbs(true); c.api.validateAndSave({preventDefault(){}});
  const parent=c.api.read()[0], child=c.api.read()[1];
  c.api.loadEntry(parent); c.element('amount').value='200'; c.api.validateAndSave({preventDefault(){}});
  assert.equal(c.api.read()[1].amount,'86.00'); assert.equal(c.api.read()[1].id,child.id);
  c.api.loadEntry(c.api.read()[1]); c.element('memo').value='Reviewed'; c.api.validateAndSave({preventDefault(){}});
  assert.equal(c.api.read()[1].generatedFrom,parent.id);
  c.api.deleteEntry(parent.id); assert.equal(c.api.read().length,0);
});

test('draft search and grouping do not change the export set', () => {
  const c=capture();
  const base={createdAt:'2026-09-23T10:00:00Z',date:'2026-09-23',type:'expense',spendingClass:'Necessary',currency:'CHF',amount:'10.00',accountId:'revn2'};
  c.api.read().push(
    {...base,id:'food',title:'Food',memo:'Lunch'},
    {...base,id:'transport',title:'Transport',memo:'Train'},
    {...base,id:'downloaded',title:'Food',memo:'Shop',exportedAt:'2026-09-23T11:00:00Z'},
    {...base,id:'imported',title:'Food',memo:'Dinner',exportedAt:'2026-09-23T11:00:00Z',importedAt:'2026-09-23T12:00:00Z'},
    {...base,id:'changed',title:'Food',memo:'Changed',exportedAt:'2026-09-23T11:00:00Z',changedSinceExport:true}
  );
  c.element('draft-group-by').value='account';c.api.renderEntries();
  assert.match(c.element('entries').innerHTML,/Needs attention/);
  assert.match(c.element('entries').innerHTML,/Downloaded — confirm import/);
  assert.match(c.element('entries').innerHTML,/draft-imported" ><summary>/);
  assert.match(c.element('entries').innerHTML,/<summary>REV-N2 <span class="draft-count">2<\/span>/);
  c.element('draft-search').value='Lunch';c.api.renderEntries();
  assert.equal(c.element('draft-view-count').textContent,'Showing 1 of 5 drafts');
  assert.doesNotMatch(c.element('entries').innerHTML,/Train/);
  assert.equal(c.element('export-csv').textContent,'Export all 2 unexported drafts · CSV');
  c.element('draft-search').value='';c.element('draft-group-by').value='category';c.api.renderEntries();
  assert.match(c.element('entries').innerHTML,/<summary>Food <span class="draft-count">1<\/span>/);
});
