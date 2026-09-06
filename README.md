# GnuCash Mobile Companion

A private, phone-friendly transaction capture page for GnuCash CSV imports.

Open `index.html` in a modern browser, or publish this folder with a static HTTPS host. The app stores drafts only in that browser's local storage. It fetches EUR/CHF reference rates from Frankfurter only when requested for an EUR entry.

## Import note

The generated CSV has two balanced split rows for each saved transaction. Review a small export in GnuCash's Transaction CSV Importer and save the resulting column mapping before importing a larger batch.

## Mobile interface

The standalone HTML uses three bottom-navigation destinations: Capture, Drafts, and Settings. Capture keeps the guided transaction flow, adds a progress bar, Today/Yesterday shortcuts, and a complete review summary before saving. Switching screens preserves the in-progress form. Drafts show prominent amounts, pending export counts, and edit/delete controls.

The interface uses system fonts and inline styles/scripts, with no new network dependencies. Existing browser storage and CSV/backup formats are retained. Dates default to the device's local calendar day.

Validation: JavaScript syntax and static HTML/reference checks. Visual checks on a physical phone and Safari remain to be done.
