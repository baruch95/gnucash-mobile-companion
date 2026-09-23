// Run with Playwright available through NODE_PATH; uses an isolated browser profile.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{
  const name=req.url==='/'?'index.html':req.url.slice(1);
  if(!['index.html','app.js','core.js','storage.js','styles.css'].includes(name)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(path.join(root,name)));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try {
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  const url=`http://127.0.0.1:${server.address().port}/`;await page.goto(url);
  const click=selector=>page.locator(selector).click();
  await click('[data-type="expense"]');await click('[data-class="Necessary"]');await click('[data-category="Food"]');await click('[data-account-choice="ubsg"]');await click('[data-date-offset="0"]');
  await page.locator('#amount').fill('100');await click('[data-step="amount"] [data-next]');await page.locator('#memo').fill('Browser test');await click('#save-entry');await click('[data-ubs-split="yes"]');
  await page.locator('[data-step="done"]').waitFor({state:'visible'});
  await click('[data-nav="drafts"]');assert.equal(await page.locator('.entry').count(),2);
  await click('[data-save-preset]');
  await click('.entry:has([data-save-preset]) [data-edit]');
  // Editing through the review's Back returns to Amount via Note.
  await click('[data-step="note"] [data-back]');await page.locator('#amount').fill('200');await click('[data-step="amount"] [data-next]');await click('#save-entry');
  await click('[data-nav="drafts"]');
  let state=await page.evaluate(()=>JSON.parse(localStorage.getItem('gnucash-mobile-capture-v1')));
  assert.equal(state.entries.find(e=>e.generatedFrom).amount,'86.00');
  const downloadPromise=page.waitForEvent('download');await click('#export-csv');const download=await downloadPromise;
  const csv=fs.readFileSync(await download.path(),'utf8');assert.match(csv,/-200.00/);assert.match(csv,/-86.00/);
  assert.equal(await page.locator('[data-imported]').count(),2);assert.equal(await page.locator('#clear-exported').isDisabled(),true);
  await page.locator('[data-imported]').first().click();await click('#clear-exported');
  // A parent cannot be cleared while its reimbursement awaits import.
  assert.ok(await page.locator('.entry').count()>=1);
  await page.locator('[data-imported]').first().click();await click('#clear-exported');assert.equal(await page.locator('.entry').count(),0);
  // Actual browser backup and FileReader restore round trip retains preset nickname.
  await click('[data-nav="settings"]');await click('#manage-quick');await page.locator('[data-preset-nickname]').fill('Groceries');await page.locator('[data-preset-nickname]').blur();await click('#close-quick-management');
  const backupPromise=page.waitForEvent('download');await click('#backup-data');const backup=await backupPromise;const backupPath=await backup.path();
  await click('#manage-quick');await click('[data-delete-managed-preset]');await click('#close-quick-management');await page.locator('#restore-file').setInputFiles(backupPath);
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('gnucash-mobile-capture-v1')).presets.length===1);await page.reload();
  await click('#quick-toggle');await page.getByRole('button',{name:/Groceries/}).click();await page.locator('#quick-amount').fill('25');await click('#save-quick');await page.locator('[data-step="done"]').waitFor({state:'visible'});
  state=await page.evaluate(()=>JSON.parse(localStorage.getItem('gnucash-mobile-capture-v1')));assert.equal(state.entries.length,2);
  // Storage failures keep the form available and do not show success or corrupt stored state.
  await click('#new-entry');await click('#quick-toggle');await page.getByRole('button',{name:/Groceries/}).click();await page.locator('#quick-amount').fill('30');
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new Error('Simulated quota failure');};});await click('#save-quick');
  await page.waitForFunction(()=>document.querySelector('#storage-status').textContent.includes('not saved'));
  assert.equal(await page.locator('#quick-amount').inputValue(),'30');assert.equal(await page.locator('[data-step="done"]').isVisible(),false);
  await page.reload();await click('[data-nav="drafts"]');assert.equal(await page.locator('.entry').count(),2);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.SCREENSHOT_PATH) await page.screenshot({path:process.env.SCREENSHOT_PATH,fullPage:true});
  // Invalid backups never replace the stored collection.
  await click('[data-nav="settings"]');
  await page.locator('#restore-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'gnucash-mobile-companion-backup',version:1,data:{entries:[{id:'bad'}],config:{accounts:[]}}}))});
  await page.waitForFunction(()=>document.querySelector('#backup-status').textContent.includes('Invalid'));
  assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('gnucash-mobile-capture-v1')))).entries.length,2);
  // A delayed reference response cannot overwrite a manually corrected rate.
  let release, requested;
  const received=new Promise(resolve=>requested=resolve);
  const responseGate=new Promise(resolve=>release=resolve);
  await page.route('https://api.frankfurter.dev/**',async route=>{requested();await responseGate;await route.fulfill({json:[{base:'EUR',quote:'CHF',date:'2026-09-11',rate:0.91}]});});
  await click('[data-nav="capture"]');await click('[data-type="expense"]');await click('[data-class="Necessary"]');await click('[data-category="Food"]');await click('[data-account-choice="revg"]');await click('[data-currency="CHF"]');await click('[data-date-offset="0"]');await page.locator('#amount').fill('100');await click('[data-step="amount"] [data-next]');
  await click('#fetch-fx');await received;await page.locator('#fx-rate').fill('0.95');release();
  await page.waitForFunction(()=>!document.querySelector('#fetch-fx').disabled);assert.equal(await page.locator('#fx-rate').inputValue(),'0.95');
  await click('[data-step="fx"] [data-next]');await click('#save-entry');await page.locator('[data-step="done"]').waitFor({state:'visible'});
  assert.deepEqual(errors,[]);
  console.log('PASS: mobile capture, linked edit, CSV download/import lifecycle, backup restore, quick capture, reload, failed storage, no horizontal overflow, invalid backup rejection, stale FX response rejection.');
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
