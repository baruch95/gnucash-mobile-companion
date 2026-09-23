/* Pure capture validation, exact decimal arithmetic and CSV serialization. */
(function (root) {
  'use strict';
  function decimal(value) {
    const text = String(value ?? '').trim().replace(',', '.');
    if (!/^\d+(\.\d{1,12})?$/.test(text)) throw new Error('Enter a positive decimal number (up to 12 decimal places).');
    const [whole, fraction = ''] = text.split('.');
    return [BigInt(whole + fraction), 10n ** BigInt(fraction.length)];
  }
  function rounded(n, d) { return (n * 2n + d) / (2n * d); }
  function minor(value) {
    const text = String(value ?? '').trim().replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Amounts must have at most two decimal places.');
    const [n,d] = decimal(text), cents = n * 100n / d;
    if (cents <= 0n || cents > 999999999999n) throw new Error('Amount must be positive and below 10 billion.');
    return cents;
  }
  function fixed(cents) { return `${cents / 100n}.${String(cents % 100n).padStart(2,'0')}`; }
  function convert(value, rate, inverse = false) {
    const cents = minor(value), [n,d] = decimal(rate);
    if (!n) throw new Error('Exchange rate must be positive.');
    const result = inverse ? rounded(cents*d,n) : rounded(cents*n,d);
    if (!result) throw new Error('Converted amount rounds to zero.');
    return fixed(result);
  }
  function share(value, percentage) { const [n,d] = decimal(percentage); return fixed(rounded(minor(value)*n,d*100n)); }
  function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value; }
  function validateState(raw, defaults) {
    const fail = () => { throw new Error('Invalid saved data. Existing data has not been replaced.'); };
    if (!raw || !Array.isArray(raw.entries) || !raw.config || !Array.isArray(raw.config.accounts)) fail();
    const result = JSON.parse(JSON.stringify(raw));
    result.config = {...defaults,...result.config}; result.presets ??= [];
    const c = result.config, ids = new Set();
    if (!c.accounts.length || !Array.isArray(c.categories) || !c.categories.every(x=>typeof x==='string') || !Array.isArray(result.presets)) fail();
    for (const a of c.accounts) {
      if (!a || typeof a.id!=='string' || !/^[\w-]+$/.test(a.id) || ids.has(a.id) || !['CHF','EUR'].includes(a.currency) || ![a.label,a.path].every(x=>typeof x==='string' && x.trim())) fail();
      ids.add(a.id);
    }
    if (![c.necessaryPath,c.leisurePath].every(x=>typeof x==='string' && x.trim())) fail();
    const n=Number(c.nicoSharePercent), g=Number(c.gioSharePercent);
    if (!(n>0 && g>0) || Math.abs(n+g-100)>0.000001) fail();
    for (const collection of [result.entries,result.presets]) {
      const seen = new Set();
      for (const e of collection) {
        if (!e || typeof e.id!=='string' || !e.id || seen.has(e.id) || !ids.has(e.accountId) || !['expense','refund','transfer'].includes(e.type) || !['CHF','EUR'].includes(e.currency)) fail();
        seen.add(e.id); minor(e.amount);
        if (e.type==='transfer' ? !ids.has(e.toAccountId) || e.accountId===e.toAccountId : !['Necessary','Leisure'].includes(e.spendingClass)) fail();
        for (const key of ['title','memo','nickname']) if (e[key]!=null && typeof e[key]!=='string') fail();
        if (e.accountCurrency!=null && !['CHF','EUR'].includes(e.accountCurrency)) fail();
        if (collection===result.entries) {
          if (!validDate(e.date)) fail();
          if (e.fxRate!=null && (!decimal(e.fxRate)[0] || !validDate(e.fxDate))) fail();
          if (e.chfAmount!=null) minor(e.chfAmount);
          for (const key of ['exportedAt','importedAt','changedSinceExport']) if(e[key]!=null && typeof e[key]!== (key==='changedSinceExport'?'boolean':'string')) fail();
        }
      }
    }
    for (const e of result.entries) if(e.generatedFrom && (!result.entries.some(p=>p.id===e.generatedFrom && p.type==='expense') || e.type!=='transfer')) fail();
    return result;
  }
  function splitRows(entry, config) {
    const source=config.accounts.find(a=>a.id===entry.accountId), destination=config.accounts.find(a=>a.id===entry.toAccountId);
    if(!source || (entry.type==='transfer' && !destination)) throw new Error('An account is missing. Edit this draft before exporting.');
    const currency=entry.currency, sourceCurrency=entry.accountCurrency || source.currency;
    const converted = target => {
      if(target===currency) return fixed(minor(entry.amount));
      if(!entry.fxRate || !entry.chfAmount) throw new Error(`Add a CHF value to ${entry.title || 'Transfer'} before exporting. Open Edit, then Add CHF value for CSV.`);
      if(currency==='EUR' && convert(entry.amount,entry.fxRate)!==fixed(minor(entry.chfAmount))) throw new Error('CHF value disagrees with the rate. Edit this draft and confirm the rate.');
      return convert(entry.amount,entry.fxRate,currency==='CHF');
    };
    const exportCurrency=entry.accountId==='revg'?'EUR':currency, value=converted(exportCurrency);
    const memo=entry.memo || '';
    const refund=entry.type==='refund';
    const splits=[{path:source.path,currency:sourceCurrency,negative:!refund},{path:entry.type==='transfer'?destination.path:entry.spendingClass==='Necessary'?config.necessaryPath:config.leisurePath,currency:entry.type==='transfer'?destination.currency:'CHF',negative:refund}];
    return splits.map(s=>{
      const amount=converted(s.currency);
      // GnuCash: value = account amount * price. Explicit Value avoids price-rounding imbalance.
      const price=s.currency===exportCurrency?'':(()=>{const scaled=rounded(minor(value)*1000000000000n,minor(amount));return `${scaled/1000000000000n}.${String(scaled%1000000000000n).padStart(12,'0')}`;})();
      return [entry.id,entry.date,entry.title,'',`CURRENCY::${exportCurrency}`,memo,s.path,`${s.negative?'-':''}${amount}`,price,`${s.negative?'-':''}${value}`];
    });
  }
  function csvCell(value) { const text=String(value??''); return /[",\r\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text; }
  const api={minor,fixed,convert,share,validDate,validateState,splitRows,csvCell};
  if(typeof module!=='undefined') module.exports=api; else root.CaptureCore=api;
})(globalThis);
