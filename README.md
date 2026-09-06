# GnuCash Mobile Companion

A private, phone-friendly transaction capture page for GnuCash CSV imports.

Open `index.html` in a modern browser, or publish this folder with a static HTTPS host. The app stores drafts only in that browser's local storage. It fetches EUR/CHF reference rates from Frankfurter only when requested for an EUR entry.

## Import note

The generated CSV has two balanced split rows for each saved transaction. Review a small export in GnuCash's Transaction CSV Importer and save the resulting column mapping before importing a larger batch.
