# Tally Invoices

A small invoice maker for music gigs in the UK, built for iPhone (it works in any modern browser too). Add each performance with its date, venue, band or artist and fee, see the invoice as you type, and save it as a PDF to the Files app. Invoices themselves are not kept in the app.

**It runs entirely on your phone.** Once installed, it works with no internet connection. Your details, bank details and contacts are stored only on the device. They are never sent to this website or anywhere else, and the app is blocked from contacting other websites.

## Install on iPhone

1. Open the app's address in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open it from the new **Invoices** icon. From then on it works offline.

Always use the home-screen icon. The home-screen app keeps its own storage, separate from Safari tabs.

## Features

- Your details and optional logo
- **Contacts**: save a client (venue, promoter or agent) once, then pick them next time. A contact also remembers their usual venue.
- Optional contact person, printed as "FAO"
- One line per performance: **date of performance, venue, band or artist, fee**. Add several gigs to one invoice.
- Amounts in pounds sterling (£), A4 PDF
- Payment due on receipt, within 7, 14 or 30 days, or on a date you pick
- Deposit already paid, balance due, and a PAID stamp once it's settled
- No tax or VAT lines
- **Create PDF** opens the iPhone share sheet: choose Save to Files (or Mail, Messages). Invoices are not stored in the app.
- **Passcode lock**: AES-256-GCM encryption with a key derived from your passcode (PBKDF2-SHA-256, 600,000 iterations). Locks after 5 minutes idle or a minute away.
- Option to never store payment details on the device
- **Encrypted backup and restore** to Files or iCloud Drive
- One-tap erase of your details and contacts

## Back up your details and contacts

Your details and contacts exist only on your phone (the PDFs are in Files). If the phone is lost, broken or reset, they're gone, unless you have a backup. Use **Security on this device → Save backup** now and then and keep the file in iCloud Drive or Files. With the passcode lock on, the backup is encrypted and needs the same passcode to restore.

## Updating

When a new version is published here, the app shows **"A new version of the app is ready"** next time you open it with a connection. Tap **Update now**. Your data stays.

For maintainers: bump `VERSION` in `sw.js` whenever any file changes, or phones keep the old cached copy.

## Files

| File | Purpose |
|---|---|
| `index.html` | The page |
| `app.css`, `app.js` | Styles and app logic |
| `sw.js` | Offline cache (service worker) |
| `manifest.webmanifest`, `icons/` | Home-screen app name and icons |
| `vendor/jspdf.umd.min.js` | [jsPDF](https://github.com/parallax/jsPDF) 2.5.1 for PDF creation (MIT licence, see `vendor/jspdf-LICENSE.txt`) |

Hosted with GitHub Pages: Settings → Pages → Deploy from a branch.
