# GnuCash Mobile Companion

A separate, phone-friendly capture tool for preparing transaction CSVs. It never opens or writes a GnuCash book. The desktop visualizer's offline, read-only analytics rules still apply to the desktop application; this companion intentionally supports manual capture, optional static hosting, and explicit EUR/CHF reference-rate requests.

## Running and privacy

Keep `index.html`, `styles.css`, `core.js`, `storage.js`, and `app.js` together. Open `index.html` in a modern browser, or serve the folder from a static HTTPS host. There is no build step, external font, CDN, analytics, or runtime package dependency. Deploy all five files together. No site was published by this implementation.

Capture data is stored in this browser's local storage, not uploaded to the host. Only pressing **Fetch rate** contacts Frankfurter; the request contains the EUR/CHF pair and a date range, not amounts, account paths, categories, or notes. The host and rate service receive normal web request metadata. Keep backups somewhere you control; JSON backups and CSV downloads contain unencrypted financial details.

The site has no service worker or installation manifest. A hosted page already loaded can capture without network access, but reopening it offline is not guaranteed. Local-file storage behavior depends on the browser. Changing the hostname, browser, browser profile, or file location may make the previous storage inaccessible. Clearing website data, private browsing, device loss, or storage eviction can remove drafts. Download backups regularly and before moving devices. Unsaved form fields survive navigation between Capture, Drafts, and Settings, but not a reload.

## Capture and review

Capture supports Necessary/Leisure expenses, refunds, and internal transfers. Transaction description is the category; the memo contains the real-world detail. Transfers are separate transactions, not spending. Taxes capture is outside this companion's current scope.

Today and Yesterday use the device's local calendar day and advance after 500 ms. Editing the date or leaving the screen cancels that advance. Review shows the account, destination where applicable, class, category, date, amount, memo, and FX details. The shared-expense step shows the proposed reimbursement before saving. Quick transactions show the same review details, including a saved reimbursement choice.

Drafts are organized by action: changed after download, ready to export, downloaded awaiting import confirmation, and imported. Imported drafts start collapsed. Search matches category, memo, account, date, and amount; an optional selector groups each status by account or category. Search and grouping only change the display: **Export all** always includes every unexported draft. Each card keeps Edit and, when applicable, Mark imported visible; secondary actions are under More.

Use **Save quick transaction** on a draft to create a shortcut. It retains the type, category, accounts, memo, currency, amount, and reimbursement choice. A shortcut uses today's date and asks for the amount; cross-currency entries also require a newly confirmed rate. Settings → Manage quick transactions supports nicknames and deletion. Backups include all shortcuts and nicknames.

## Amounts and currencies

Amounts must be positive and have at most two decimal places. Use a dot or comma decimal separator, without thousands separators. Conversion and reimbursement calculations use exact decimal arithmetic and round half up to cents/rappen. Rates accept up to 12 decimal places. The rate is authoritative: the CHF equivalent is read-only and calculated from it. Correct the rate to match the statement before saving.

REV-G (EUR) and REV-N2 (CHF) ask for the receipt currency after account selection. Native-currency Revolut captures skip FX; cross-currency purchases and transfers require an explicit rate. Native EUR expenses/refunds can be saved without CHF conversion, but cannot be exported to CHF expense accounts until edited using **Add CHF value for CSV**. Missing or inconsistent conversions block export with an explanation. Delayed reference responses cannot overwrite a changed form or a manually corrected rate.

REV-G exports use EUR as the GnuCash transaction currency. A CHF receipt is converted to a rounded EUR account amount. The CSV memo contains only the detail entered by the user; conversion amounts and rates are not added to the memo or notes. Deposit holds the account-currency amount. Value holds the exact transaction-currency amount; each transaction’s Values sum to zero. Price is transaction value divided by account amount, emitted with 12 decimal places. Capture IDs occur only in the Transaction ID column. For example, a EUR 13.30 REV-N2 purchase at 0.94611 CHF/EUR exports CHF 12.58 as Deposit and EUR 13.30 as Value; older CSVs that put 13.30 in Deposit will import as CHF 13.30.

## Shared UBS expenses

When UBS-G pays, UBS-N reimburses Nico's share (43% by default). When UBS-N pays, UBS-G reimburses Gio's share (57%). Settings require positive percentages totaling 100%. Both UBS accounts must be configured in CHF for this shortcut.

Drafts identify linked expenses and reimbursements. Editing an expense asks to update its reimbursement using the current configured share; cancel leaves both unchanged. Editing a reimbursement preserves its link. Deleting an expense asks to delete both drafts. Deleting just the reimbursement removes the link. These actions never change transactions already imported into GnuCash. To change a linked expense to another transaction type or an incompatible account, remove its reimbursement first.

## Download, import, and corrections

1. **Download CSV** includes drafts that have not been downloaded. Confirm the download actually saved a file: browsers do not report successful file saving to this page.
2. Drafts become **Downloaded — confirm import**. Review and import the file into GnuCash yourself.
3. Use **Mark imported** only after verifying that exact draft in GnuCash.
4. **Clear imported** removes only confirmed, unchanged imported drafts. An expense stays until its linked reimbursement is also eligible for cleanup.

Editing a downloaded draft flags **Changed since download** and prevents import confirmation or cleanup of that changed version. It is not silently re-exported. After checking the previous import, choose **Mark unexported** to include the correction in a new download. That action also works when a download failed. Check for and correct/remove the earlier version in GnuCash before importing another copy; the capture ID is not a guarantee of duplicate prevention.

## Backups and recovery

**Download backup** includes drafts, download/import markers, account settings, shares, and quick transactions. **Restore backup** replaces the current collection after validation and confirmation; it does not merge. The existing version-1 backup envelope and browser-storage key remain supported. Legacy download markers are interpreted as downloaded, not proof of import.

Malformed records, duplicate IDs, invalid currencies/dates/amounts, missing accounts, or broken reimbursement links are rejected before storage is replaced. Failed storage writes keep the previous saved collection and leave the capture form available with an error. If existing storage cannot be read, its original contents remain untouched and ordinary saves are blocked until a valid backup is explicitly restored. An invalid or failed restore also leaves the previous saved data intact.

## Reproducible CSV import check

Use a new disposable GnuCash book, not your working book. Create these accounts with the indicated currencies, with zero starting balances:

- `Assets:Test:EUR` — EUR bank account
- `Assets:Test:CHF` — CHF bank account
- `Expenses:Necessary` — CHF expense account

Import `tests/import-example.csv` through File → Import → Import Transactions from CSV. Select comma-separated input, UTF-8, year-month-day dates, dot decimal formatting, skip the header, and enable Multi-split. Map Transaction ID, Commodity/Currency, Account, Deposit (the account Amount field), and Price to their matching fields. Map Value if the importer offers it; otherwise leave Value unmapped. Do not map Value to Amount/Deposit. Keep each transaction's two rows together. Review the account mapping and import preview before completing the disposable-book import. The [GnuCash CSV import manual](https://wiki.gnucash.org/docs/C/gnucash-manual/trans-import.html) describes the importer and its mapping controls.

The fixture represents one EUR 100 expense at 0.9 CHF/EUR and one EUR 10 refund at the same rate. Expected final balances are EUR −90 in `Assets:Test:EUR`, CHF +81 in `Expenses:Necessary`, and zero in `Assets:Test:CHF`. There should be two transactions with two splits each and no extra imbalance split. The fixture is generated and checked by the pure serializer tests; actual GnuCash import still needs this manual check on the installed version.

## Implementation and validation

- `core.js`: pure schema validation, exact monetary arithmetic, and CSV serialization.
- `storage.js`: validated, atomic local-storage boundary and protected recovery.
- `app.js`: capture navigation, rendering, draft lifecycle, and FX requests.
- `styles.css`: responsive presentation.

Run the dependency-free regression suite:

```sh
node --test mobile-companion-site/tests/*.test.cjs
```

Run browser coverage with Playwright available as a development dependency (or through `NODE_PATH`):

```sh
node mobile-companion-site/tests/browser.cjs
```

Optional `CHROMIUM_PATH` selects an installed Chromium executable; `SCREENSHOT_PATH` saves a phone-width Drafts screenshot. The browser test creates an isolated profile and temporary loopback server. FX responses are mocked; no financial data or rate request is sent externally.

Verified on this change: 26 unit/regression tests and Chromium mobile-viewport coverage for capture, linked edits, real downloads, import confirmation, backup/restore, quick capture, reload persistence, quota failure, malformed backups, delayed FX responses, and horizontal overflow. Physical iPhone/Safari testing and a real GnuCash importer check remain manual release checks.

CSV semantics were checked against [GnuCash’s importer source](https://github.com/Gnucash/gnucash/blob/stable/gnucash/import-export/csv-imp/gnc-imp-props-tx.cpp): the importer uses explicit Value when supplied, otherwise calculates value as account amount multiplied by price. The previous companion CSV placed transaction values in Deposit and inverted that price; regenerate unimported CSVs using this version. Review previously imported cross-currency transactions separately.
