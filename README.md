# GnuCash Mobile Companion

A private, phone-friendly transaction capture page for GnuCash CSV imports.

Open `index.html` in a modern browser, or publish this folder with a static HTTPS host. The app stores drafts only in that browser's local storage. It fetches EUR/CHF reference rates from Frankfurter only when requested for an EUR entry.

## Import note

The generated CSV follows GnuCash's multi-split transaction import model: one row per split, a shared transaction ID, balanced Deposit values, full Account paths, a `CURRENCY::` transaction commodity, and Price values for cross-currency splits. Enable Multi-split in GnuCash's Transaction CSV Importer, map the columns by their headers, and save the mapping. Review a small import before importing a larger batch.

## Mobile interface

The standalone HTML uses three bottom-navigation destinations: Capture, Drafts, and Settings. Capture keeps the guided transaction flow, adds a progress bar, Today/Yesterday shortcuts, and a complete review summary before saving. Switching screens preserves the in-progress form. Drafts show prominent amounts, pending export counts, and edit/delete controls.

The interface uses system fonts and inline styles/scripts, with no new network dependencies. Existing browser storage and CSV/backup formats are retained. Dates default to the device's local calendar day.

Each exported draft has a **Mark unexported** action. It clears only that draft's export marker so the transaction is included in the next CSV download; the draft itself is unchanged.

Use **Save quick transaction** on a draft to add it to Quick transactions on the Capture screen. A shortcut retains the transaction type, category, account, destination, memo, currency, saved amount, and whether a UBS reimbursement should be generated. Selecting it uses today's date and asks only to confirm or edit the prefilled amount. Cross-currency shortcuts additionally require a current exchange rate. Open **Settings → Manage quick transactions** to rename shortcuts with nicknames or delete them; the manager is also included in JSON backups.

Validation: JavaScript syntax, static HTML/reference checks, and `node --test tests/capture.test.cjs` for currency selection, saved drafts, and balanced CSV splits. Visual checks on a physical phone and Safari remain to be done.

## Revolut currency selection

REV-G (EUR) and REV-N2 (CHF) ask for the transaction currency immediately after account selection. Cross-currency entries request an explicit EUR/CHF rate; native-currency Revolut entries skip that step. Transfers also require a rate when the receiving account uses a different currency.

Native EUR expenses/refunds can be saved without a CHF conversion. To export them to the configured CHF expense account, open Edit and use **Add CHF value for CSV**. Export reports missing conversions instead of assuming a rate. Existing drafts and backups remain readable; new drafts retain transaction currency separately from account currency.

Today and Yesterday highlight the selected date and advance after 500 ms. Selecting another shortcut restarts the timer; manual date editing or navigating away cancels it.

Shared UBS expenses can generate a second transfer draft after the expense is entered. When UBS-G pays, UBS-N reimburses Nico's configured share; when UBS-N pays, UBS-G reimburses Gio's configured share. Settings expose both percentages, defaulting to 43% and 57%, and require them to total 100%.

REV-G exports always use EUR as the GnuCash transaction currency. CHF receipt amounts are converted with the explicit rate and retained in the memo; CHF account amounts are represented through the split Price. Capture IDs are kept only in the Transaction ID column and are never added to a split memo.
