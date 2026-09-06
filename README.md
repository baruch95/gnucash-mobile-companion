# GnuCash Mobile Companion

A private, phone-friendly transaction capture page for GnuCash CSV imports.

Open `index.html` in a modern browser, or publish this folder with a static HTTPS host. The app stores drafts only in that browser's local storage. It fetches EUR/CHF reference rates from Frankfurter only when requested for an EUR entry.

## Import note

The generated CSV has two balanced split rows for each saved transaction. Review a small export in GnuCash's Transaction CSV Importer and save the resulting column mapping before importing a larger batch.

## Mobile interface

The standalone HTML uses three bottom-navigation destinations: Capture, Drafts, and Settings. Capture keeps the guided transaction flow, adds a progress bar, Today/Yesterday shortcuts, and a complete review summary before saving. Switching screens preserves the in-progress form. Drafts show prominent amounts, pending export counts, and edit/delete controls.

The interface uses system fonts and inline styles/scripts, with no new network dependencies. Existing browser storage and CSV/backup formats are retained. Dates default to the device's local calendar day.

Validation: JavaScript syntax, static HTML/reference checks, and `node --test tests/capture.test.cjs` for currency selection, saved drafts, and balanced CSV splits. Visual checks on a physical phone and Safari remain to be done.

## Revolut currency selection

REV-G (EUR) and REV-N2 (CHF) ask for the transaction currency immediately after account selection. Cross-currency entries request an explicit EUR/CHF rate; native-currency Revolut entries skip that step. Transfers also require a rate when the receiving account uses a different currency.

Native EUR expenses/refunds can be saved without a CHF conversion. To export them to the configured CHF expense account, open Edit and use **Add CHF value for CSV**. Export reports missing conversions instead of assuming a rate. Existing drafts and backups remain readable; new drafts retain transaction currency separately from account currency.

Today and Yesterday highlight the selected date and advance after 500 ms. Selecting another shortcut restarts the timer; manual date editing or navigating away cancels it.

REV-G exports always use EUR as the GnuCash transaction currency. CHF receipt amounts are converted with the explicit rate and retained in the memo; CHF expense split amounts are preserved.
