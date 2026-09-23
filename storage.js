/* Atomic browser storage boundary. Never overwrite unreadable data implicitly. */
(function(root) {
  'use strict';
  function create(storage, key, validate, empty) {
    let blocked=false, problem='', committed=empty();
    try { const raw=storage.getItem(key); if(raw) committed=validate(JSON.parse(raw)); }
    catch(error) { blocked=true; problem=`Saved data could not be read. It has been preserved. Restore a valid backup to recover. ${error.message}`; }
    const copy=()=>JSON.parse(JSON.stringify(committed));
    return {
      read:copy, problem,
      save(value, restoring=false) {
        if(blocked && !restoring) throw new Error('Existing unreadable data is protected. Restore a valid backup first.');
        const checked=validate(value);
        storage.setItem(key,JSON.stringify(checked));
        committed=checked; blocked=false;
        return copy();
      }
    };
  }
  if(typeof module!=='undefined') module.exports={create}; else root.CaptureStorage={create};
})(globalThis);
