# BHAGWATI ENTERPRISES — Invoice App PRD

## Original Problem Statement
User provided a React `InvoiceApp` component (with jsPDF, localStorage) and a photo of the printed BHAGWATI ENTERPRISES tax invoice. They asked to build a working app that visually replicates the printed bill with these specific corrections:
- "BHAGWATI ENTERPRISES" must be a single line
- Address number 304 → **306**
- GSTIN: **27ANSPK4430F1ZW**
- "Particulars" column → **Items**
- "Lorry" → **Lorry No.**
- GST No. printed on top, right after the email line
- "Order No." on a single line
- "Bill No." on a single line
- "Building Material Suppliers" → **Construction Material Supplier**
- "Subject to Kalyan Jurisdiction" rendered in regular (non-decorative) format

## User Personas
- **Shop owner / counter clerk** at Bhagwati Enterprises, Kalyan — needs quick invoice creation, repeat-customer autocomplete, auto-incrementing bill numbers, printable / PDF output that matches the existing physical bill book.

## Architecture
- **Frontend**: React 19 + react-router-dom + Tailwind. PDF via `jspdf` + `html2canvas` (captures the on-screen bill so the PDF == on-screen replica).
- **Backend**: FastAPI under `/api` prefix.
- **Database**: MongoDB (collections: `invoices`, `customers`, `counters`).

## Core Requirements
1. Pixel-close replica of the printed Bhagwati Enterprises bill (with the user-specified corrections).
2. Auto-incrementing Bill No. (server-side counter, atomic `$inc`).
3. Customer autocomplete from previously-saved customers (upserted by name on each save).
4. Invoice CRUD: create, list, search (by customer or order no.), edit, delete.
5. CGST 2.5% + SGST 2.5% auto-computed from line totals.
6. "Rupees in words" auto-generated (Indian numbering: Lakh / Crore).
7. PDF download (A4) and browser Print.

## Implemented (2026-01)
- ✅ FastAPI endpoints: `GET /api/`, `GET /api/next-bill-no`, full CRUD on `/api/invoices`, `GET|POST /api/customers`.
- ✅ Atomic bill-no counter (auto-increment + `$max` when explicit bill_no provided).
- ✅ Mongo `_id` always excluded from responses; UUID-based `id` field used as primary key.
- ✅ React routes: `/` (home), `/invoice/new`, `/invoice/:id` (edit), `/history`.
- ✅ Bill paper: single-line brand, Cormorant Garamond serif in deep maroon, Construction Material Supplier subtitle, address with **306**, GST No. on top after email, "Subject to Kalyan Jurisdiction" in plain Poppins, GSTIN footer cell, single-line Order No. & Bill No., Items + Lorry No. columns.
- ✅ Customer autocomplete dropdown.
- ✅ PDF download via html2canvas + jsPDF.
- ✅ Print stylesheet hides toolbar.
- ✅ Comprehensive `data-testid` coverage on every interactive element.
- ✅ 15/15 backend tests + full frontend Playwright flow passing.

## Prioritized Backlog
- **P1** Multi-page PDF for very long invoices (current implementation single-page A4).
- **P1** Customer DELETE endpoint + customer management page.
- **P2** Per-line discount / rounding rules.
- **P2** Year-prefixed bill no. (e.g., 26-27/0001) — currently a flat integer.
- **P2** Export bills as Excel/CSV monthly summary.
- **P2** Optional auth (PIN lock for the device).
- **P3** Cloud backup / Google Sheets sync.

## Tech Notes
- `bcrypt` is in requirements but unused (no auth this iteration).
- Bill counter resets only manually via Mongo (`db.counters.updateOne({_id:'bill_no'},{$set:{seq:0}})`).
- PDF capture uses `scale: 2` for crisp print output.
