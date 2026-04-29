import { useEffect, useState, useRef, useCallback } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Link, useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// ---------- Number to Words (Indian system) ----------
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigit(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
}
function threeDigit(n) {
  let str = "";
  if (n >= 100) { str += ONES[Math.floor(n / 100)] + " Hundred"; n %= 100; if (n) str += " "; }
  if (n) str += twoDigit(n);
  return str;
}
function numberToWords(num) {
  num = Math.floor(num);
  if (num === 0) return "Zero";
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  const rest = num;
  let s = "";
  if (crore) s += threeDigit(crore) + " Crore ";
  if (lakh) s += twoDigit(lakh) + " Lakh ";
  if (thousand) s += twoDigit(thousand) + " Thousand ";
  if (rest) s += threeDigit(rest);
  return s.trim();
}
function rupeesInWords(amount) {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  let str = numberToWords(rupees) + " Rupees";
  if (paise > 0) str += " and " + numberToWords(paise) + " Paise";
  return str + " Only";
}

// ---------- Empty row ----------
const emptyRow = () => ({ date: "", challan_no: "", items: "", hsn: "", lorry_no: "", qnty: "", rate: "" });

// ---------- Invoice Form ----------
function InvoiceForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const [billNo, setBillNo] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().substr(0, 10));
  const [paymentDays, setPaymentDays] = useState("");
  const [items, setItems] = useState(Array.from({ length: 8 }, emptyRow));
  const [customers, setCustomers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [showCustList, setShowCustList] = useState(false);
  const billRef = useRef(null);

  const loadCustomers = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/customers`);
      setCustomers(res.data || []);
    } catch (e) { console.error(e); }
  }, []);

  const loadNextBillNo = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/next-bill-no`);
      setBillNo(String(res.data.next_bill_no));
    } catch (e) { console.error(e); }
  }, []);

  const loadInvoice = useCallback(async (invId) => {
    try {
      const res = await axios.get(`${API}/invoices/${invId}`);
      const inv = res.data;
      setBillNo(String(inv.bill_no));
      setOrderNo(inv.order_no || "");
      setCustomerName(inv.customer_name || "");
      setCustomerAddress(inv.customer_address || "");
      setInvoiceDate(inv.invoice_date || "");
      setPaymentDays(inv.payment_within_days || "");
      const loaded = (inv.items || []).map(it => ({
        date: it.date || "", challan_no: it.challan_no || "", items: it.items || "",
        hsn: it.hsn || "", lorry_no: it.lorry_no || "",
        qnty: it.qnty || "", rate: it.rate || ""
      }));
      while (loaded.length < 8) loaded.push(emptyRow());
      setItems(loaded);
    } catch (e) { console.error(e); alert("Failed to load invoice"); }
  }, []);

  useEffect(() => {
    loadCustomers();
    if (isEdit) {
      loadInvoice(id);
    } else {
      loadNextBillNo();
    }
  }, [id, isEdit, loadCustomers, loadInvoice, loadNextBillNo]);

  const updateItem = (index, field, value) => {
    setItems(prev => prev.map((it, i) => i === index ? { ...it, [field]: value } : it));
  };

  const addRow = () => setItems(prev => [...prev, emptyRow()]);
  const removeRow = (idx) => setItems(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);

  const subtotal = items.reduce((sum, it) => sum + (Number(it.qnty) || 0) * (Number(it.rate) || 0), 0);
  const cgst = subtotal * 0.025;
  const sgst = subtotal * 0.025;
  const rawTotal = subtotal + cgst + sgst;
  const total = Math.round(rawTotal);
  const roundOff = +(total - rawTotal).toFixed(2);

  const filteredCustomers = customerName
    ? customers.filter(c => c.name.toLowerCase().includes(customerName.toLowerCase())).slice(0, 8)
    : customers.slice(0, 8);

  const buildPayload = () => ({
    bill_no: Number(billNo) || undefined,
    order_no: orderNo,
    customer_name: customerName.trim(),
    customer_address: customerAddress,
    invoice_date: invoiceDate,
    payment_within_days: paymentDays,
    items: items
      .filter(it => it.items || it.qnty || it.rate || it.challan_no || it.hsn || it.lorry_no || it.date)
      .map(it => ({
        date: it.date || "",
        challan_no: it.challan_no || "",
        items: it.items || "",
        hsn: it.hsn || "",
        lorry_no: it.lorry_no || "",
        qnty: Number(it.qnty) || 0,
        rate: Number(it.rate) || 0,
      })),
    subtotal, cgst, sgst, round_off: roundOff, total,
    amount_in_words: rupeesInWords(total),
  });

  const saveInvoice = async () => {
    if (!customerName.trim()) { alert("Please enter customer name"); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await axios.put(`${API}/invoices/${id}`, buildPayload());
        alert("Invoice updated");
      } else {
        const res = await axios.post(`${API}/invoices`, buildPayload());
        alert(`Invoice saved. Bill No: ${res.data.bill_no}`);
        navigate(`/invoice/${res.data.id}`);
      }
      loadCustomers();
    } catch (e) {
      console.error(e);
      alert("Failed to save invoice");
    } finally { setSaving(false); }
  };

  const downloadPDF = async () => {
    if (!billRef.current) return;
    setDownloading(true);
    try {
      const canvas = await html2canvas(billRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        onclone: (clonedDoc) => {
          // html2canvas does not paint live React-controlled <input> values.
          // Replace each input/textarea inside the cloned bill with a span
          // showing its current value so the captured image matches the screen.
          const root = clonedDoc.querySelector('[data-testid="bill-paper"]');
          if (!root) return;
          const fields = root.querySelectorAll("input, textarea");
          fields.forEach((el) => {
            const value = el.value || "";
            const span = clonedDoc.createElement("span");
            span.textContent = value;
            // Copy alignment for right-aligned numeric cells
            const cs = clonedDoc.defaultView.getComputedStyle(el);
            span.style.display = "inline-block";
            span.style.width = "100%";
            span.style.fontSize = cs.fontSize;
            span.style.fontFamily = cs.fontFamily;
            span.style.fontWeight = cs.fontWeight;
            span.style.color = cs.color;
            span.style.textAlign = cs.textAlign;
            span.style.padding = cs.padding;
            span.style.lineHeight = cs.lineHeight;
            span.style.whiteSpace = "pre-wrap";
            span.style.wordBreak = "break-word";
            el.parentNode.replaceChild(span, el);
          });
        },
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgProps = pdf.getImageProperties(imgData);
      const imgWidth = pageWidth;
      const imgHeight = (imgProps.height * imgWidth) / imgProps.width;
      const finalHeight = Math.min(imgHeight, pageHeight);
      pdf.addImage(imgData, "PNG", 0, 0, imgWidth, finalHeight);
      pdf.save(`Bhagwati_Invoice_${billNo || "draft"}.pdf`);
    } catch (e) {
      console.error(e);
      alert("Failed to generate PDF");
    } finally { setDownloading(false); }
  };

  const printInvoice = () => window.print();

  return (
    <div className="min-h-screen bg-stone-100 py-6 px-4 print:bg-white print:p-0" data-testid="invoice-form-page">
      {/* Top Toolbar (hidden in print) */}
      <div className="max-w-[900px] mx-auto mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-sm font-semibold text-stone-700 hover:text-red-700" data-testid="link-home">
            ← Home
          </Link>
          <Link to="/history" className="text-sm font-semibold text-stone-700 hover:text-red-700" data-testid="link-history">
            Invoice History
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={saveInvoice}
            disabled={saving}
            className="px-4 py-2 bg-red-800 hover:bg-red-900 text-white rounded font-semibold text-sm disabled:opacity-50"
            data-testid="btn-save-invoice"
          >
            {saving ? "Saving..." : isEdit ? "Update Invoice" : "Save Invoice"}
          </button>
          <button
            onClick={downloadPDF}
            disabled={downloading}
            className="px-4 py-2 bg-stone-800 hover:bg-black text-white rounded font-semibold text-sm disabled:opacity-50"
            data-testid="btn-download-pdf"
          >
            {downloading ? "Generating..." : "Download PDF"}
          </button>
          <button
            onClick={printInvoice}
            className="px-4 py-2 bg-stone-700 hover:bg-stone-800 text-white rounded font-semibold text-sm"
            data-testid="btn-print"
          >
            Print
          </button>
        </div>
      </div>

      {/* Bill area */}
      <div
        ref={billRef}
        className="bill-paper mx-auto bg-white text-stone-900 print:shadow-none"
        data-testid="bill-paper"
      >
        {/* Top: Subject + brand */}
        <div className="text-right pr-3 pt-2">
          <span className="bill-subject" data-testid="bill-subject">Subject to Kalyan Jurisdiction</span>
        </div>

        <div className="text-center px-4">
          <h1 className="bill-brand whitespace-nowrap" data-testid="bill-brand">BHAGWATI ENTERPRISES</h1>
          <div className="bill-subtitle" data-testid="bill-subtitle">Construction Material Supplier</div>
          <div className="bill-address" data-testid="bill-address">
            306, Jay Maharashtra Bldg., Agra Road, Kalyan (W) &nbsp;&nbsp; M : 9833987162
          </div>
          <div className="bill-email" data-testid="bill-email">
            Email : bhagwatient11@rediffmail.com
          </div>
          <div className="bill-gst-top" data-testid="bill-gst-top">
            GST No. : 27ANSPK4430F1ZW
          </div>
          <div className="bill-tax-invoice" data-testid="bill-tax-invoice">TAX INVOICE</div>
        </div>

        {/* Customer + Order/Bill/Date Box */}
        <div className="bill-grid-top">
          <div className="bill-cust-box">
            <div className="bill-row">
              <span className="bill-label">M/s.</span>
              <div className="relative flex-1">
                <input
                  type="text"
                  className="bill-input"
                  value={customerName}
                  onChange={(e) => { setCustomerName(e.target.value); setShowCustList(true); }}
                  onFocus={() => setShowCustList(true)}
                  onBlur={() => setTimeout(() => setShowCustList(false), 150)}
                  data-testid="input-customer-name"
                />
                {showCustList && filteredCustomers.length > 0 && (
                  <ul className="absolute z-20 left-0 right-0 top-full bg-white border border-stone-300 max-h-48 overflow-auto shadow-lg" data-testid="customer-suggestions">
                    {filteredCustomers.map((c) => (
                      <li
                        key={c.id}
                        className="px-3 py-1.5 text-sm hover:bg-red-50 cursor-pointer"
                        onMouseDown={() => { setCustomerName(c.name); setCustomerAddress(c.address || ""); setShowCustList(false); }}
                        data-testid={`customer-option-${c.id}`}
                      >
                        {c.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="bill-row">
              <input
                type="text"
                placeholder=""
                className="bill-input w-full"
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                data-testid="input-customer-address"
              />
            </div>
          </div>

          <div className="bill-meta-box">
            <div className="bill-meta-row">
              <span className="bill-label">Order No.</span>
              <input
                type="text"
                className="bill-input flex-1"
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
                data-testid="input-order-no"
              />
            </div>
            <div className="bill-meta-row">
              <span className="bill-label">Bill No.</span>
              <input
                type="text"
                className="bill-input flex-1"
                value={billNo}
                onChange={(e) => setBillNo(e.target.value)}
                data-testid="input-bill-no"
              />
            </div>
            <div className="bill-meta-row">
              <span className="bill-label">Date</span>
              <input
                type="date"
                className="bill-input flex-1"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                data-testid="input-date"
              />
            </div>
          </div>
        </div>

        {/* Items Table */}
        <table className="bill-table" data-testid="items-table">
          <thead>
            <tr>
              <th style={{ width: "9%" }}>Date</th>
              <th style={{ width: "9%" }}>Challan No.</th>
              <th style={{ width: "26%" }}>Items</th>
              <th style={{ width: "9%" }}>HSN</th>
              <th style={{ width: "11%" }}>Lorry No.</th>
              <th style={{ width: "8%" }}>Qnty</th>
              <th style={{ width: "10%" }}>Rate</th>
              <th colSpan="2" className="bill-amount-th">
                <div className="bill-amount-th-top">AMOUNT</div>
                <div className="bill-amount-th-bottom"><span>Rs.</span><span>P.</span></div>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const amt = (Number(item.qnty) || 0) * (Number(item.rate) || 0);
              const rs = Math.floor(amt);
              const ps = Math.round((amt - rs) * 100);
              return (
                <tr key={i} data-testid={`item-row-${i}`}>
                  <td><input className="bill-cell" value={item.date} onChange={(e) => updateItem(i, "date", e.target.value)} data-testid={`row-${i}-date`} /></td>
                  <td><input className="bill-cell" value={item.challan_no} onChange={(e) => updateItem(i, "challan_no", e.target.value)} data-testid={`row-${i}-challan`} /></td>
                  <td><input className="bill-cell" value={item.items} onChange={(e) => updateItem(i, "items", e.target.value)} data-testid={`row-${i}-items`} /></td>
                  <td><input className="bill-cell" value={item.hsn} onChange={(e) => updateItem(i, "hsn", e.target.value)} data-testid={`row-${i}-hsn`} /></td>
                  <td><input className="bill-cell" value={item.lorry_no} onChange={(e) => updateItem(i, "lorry_no", e.target.value)} data-testid={`row-${i}-lorry`} /></td>
                  <td><input className="bill-cell text-right" type="number" value={item.qnty} onChange={(e) => updateItem(i, "qnty", e.target.value)} data-testid={`row-${i}-qnty`} /></td>
                  <td><input className="bill-cell text-right" type="number" value={item.rate} onChange={(e) => updateItem(i, "rate", e.target.value)} data-testid={`row-${i}-rate`} /></td>
                  <td className="bill-amt-rs text-right">{amt > 0 ? rs : ""}</td>
                  <td className="bill-amt-ps text-right">{amt > 0 ? String(ps).padStart(2, "0") : ""}</td>
                </tr>
              );
            })}
            {/* Footer Totals rows */}
            <tr className="bill-total-row">
              <td colSpan="7" className="bill-words-cell">
                <div className="bill-words-label">Rupees in words</div>
                <div className="bill-words-value" data-testid="amount-in-words">
                  {total > 0 ? rupeesInWords(total) : ""}
                </div>
              </td>
              <td className="bill-tax-label">CGST 2.5%</td>
              <td className="bill-tax-val text-right" data-testid="cgst-value">
                {cgst > 0 ? cgst.toFixed(2) : ""}
              </td>
            </tr>
            <tr>
              <td colSpan="7" rowSpan="3" className="bill-gst-foot">
                GSTIN : 27ANSPK4430F1ZW
              </td>
              <td className="bill-tax-label">SGST 2.5%</td>
              <td className="bill-tax-val text-right" data-testid="sgst-value">
                {sgst > 0 ? sgst.toFixed(2) : ""}
              </td>
            </tr>
            <tr>
              <td className="bill-tax-label">Round Off</td>
              <td className="bill-tax-val text-right" data-testid="round-off-value">
                {rawTotal > 0 ? (roundOff >= 0 ? "+" : "") + roundOff.toFixed(2) : ""}
              </td>
            </tr>
            <tr>
              <td className="bill-total-label">TOTAL</td>
              <td className="bill-total-val text-right" data-testid="total-value">
                {total > 0 ? total.toFixed(2) : ""}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Footer */}
        <div className="bill-footer">
          <div className="bill-footer-left">
            Payment within&nbsp;
            <input
              type="text"
              className="bill-input bill-pay-days"
              value={paymentDays}
              onChange={(e) => setPaymentDays(e.target.value)}
              data-testid="input-payment-days"
            />
            &nbsp;day from the date of the bill
          </div>
          <div className="bill-footer-right">
            <div className="bill-footer-right-top">For BHAGWATI ENTERPRISES</div>
            <div className="bill-footer-right-bottom">Authorised Signature</div>
          </div>
        </div>
      </div>

      {/* Add row button (outside print) */}
      <div className="max-w-[900px] mx-auto mt-4 flex flex-wrap gap-2 print:hidden">
        <button
          onClick={addRow}
          className="px-4 py-2 bg-stone-700 hover:bg-stone-900 text-white rounded text-sm"
          data-testid="btn-add-row"
        >
          + Add Row
        </button>
        <button
          onClick={() => removeRow(items.length - 1)}
          className="px-4 py-2 bg-stone-200 hover:bg-stone-300 text-stone-800 rounded text-sm"
          data-testid="btn-remove-row"
        >
          − Remove Last Row
        </button>
        <div className="ml-auto text-sm text-stone-600">
          Subtotal: ₹{subtotal.toFixed(2)} &nbsp;|&nbsp; CGST: ₹{cgst.toFixed(2)} &nbsp;|&nbsp; SGST: ₹{sgst.toFixed(2)} &nbsp;|&nbsp; Round Off: ₹{roundOff.toFixed(2)} &nbsp;|&nbsp; <span className="font-bold text-red-800">Total: ₹{total.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

// ---------- History Page ----------
function HistoryPage() {
  const [invoices, setInvoices] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/invoices`, { params: q ? { q } : {} });
      setInvoices(res.data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [q]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this invoice? This cannot be undone.")) return;
    try {
      await axios.delete(`${API}/invoices/${id}`);
      load();
    } catch (e) { alert("Delete failed"); }
  };

  return (
    <div className="min-h-screen bg-stone-100 py-6 px-4" data-testid="history-page">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-stone-800">Invoice History</h2>
          <div className="flex gap-3">
            <Link to="/" className="text-sm font-semibold text-stone-700 hover:text-red-700" data-testid="link-home-from-history">← Home</Link>
            <Link to="/invoice/new" className="px-4 py-2 bg-red-800 hover:bg-red-900 text-white rounded text-sm font-semibold" data-testid="btn-new-invoice">+ New Invoice</Link>
          </div>
        </div>

        <div className="mb-4">
          <input
            type="text"
            placeholder="Search by customer or order no."
            className="w-full md:w-96 px-3 py-2 border border-stone-300 rounded text-sm bg-white"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="input-search"
          />
        </div>

        <div className="bg-white rounded shadow-sm border border-stone-200 overflow-hidden">
          {loading ? (
            <div className="p-6 text-center text-stone-500" data-testid="loading-msg">Loading...</div>
          ) : invoices.length === 0 ? (
            <div className="p-6 text-center text-stone-500" data-testid="no-invoices-msg">No invoices found.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-stone-100 text-stone-700">
                <tr>
                  <th className="px-3 py-2 text-left">Bill No.</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-left">Order No.</th>
                  <th className="px-3 py-2 text-right">Total ₹</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-t border-stone-200 hover:bg-stone-50" data-testid={`history-row-${inv.bill_no}`}>
                    <td className="px-3 py-2 font-semibold">{inv.bill_no}</td>
                    <td className="px-3 py-2">{inv.invoice_date}</td>
                    <td className="px-3 py-2">{inv.customer_name}</td>
                    <td className="px-3 py-2">{inv.order_no || "-"}</td>
                    <td className="px-3 py-2 text-right">{Number(inv.total || 0).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Link to={`/invoice/${inv.id}`} className="text-red-800 hover:underline mr-3" data-testid={`btn-edit-${inv.bill_no}`}>Edit</Link>
                      <button onClick={() => handleDelete(inv.id)} className="text-stone-600 hover:text-red-700" data-testid={`btn-delete-${inv.bill_no}`}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Home / Landing ----------
function Home() {
  return (
    <div className="min-h-screen bg-stone-100 py-12 px-4" data-testid="home-page">
      <div className="max-w-4xl mx-auto text-center">
        <div className="mb-6 text-xs uppercase tracking-widest text-stone-500">Subject to Kalyan Jurisdiction</div>
        <h1 className="text-4xl md:text-5xl font-bold text-red-800 mb-2 tracking-tight" style={{ fontFamily: "'Cormorant Garamond', serif" }} data-testid="home-brand">
          BHAGWATI ENTERPRISES
        </h1>
        <div className="text-lg text-stone-700 mb-1">Construction Material Supplier</div>
        <div className="text-xs text-stone-500 mb-1">306, Jay Maharashtra Bldg., Agra Road, Kalyan (W) &nbsp;|&nbsp; M : 9833987162</div>
        <div className="text-xs text-stone-500 mb-1">Email : bhagwatient11@rediffmail.com</div>
        <div className="text-xs text-stone-500 mb-10">GST No. : 27ANSPK4430F1ZW</div>

        <div className="grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
          <Link to="/invoice/new" className="block p-8 bg-white border-2 border-red-800 rounded shadow-sm hover:bg-red-50 transition" data-testid="card-create-invoice">
            <div className="text-2xl font-bold text-red-800 mb-1">+ New Invoice</div>
            <div className="text-sm text-stone-600">Create a fresh tax invoice</div>
          </Link>
          <Link to="/history" className="block p-8 bg-white border border-stone-300 rounded shadow-sm hover:bg-stone-50 transition" data-testid="card-history">
            <div className="text-2xl font-bold text-stone-800 mb-1">📋 Invoice History</div>
            <div className="text-sm text-stone-600">View, edit & download past invoices</div>
          </Link>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/invoice/new" element={<InvoiceForm />} />
          <Route path="/invoice/:id" element={<InvoiceForm />} />
          <Route path="/history" element={<HistoryPage />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
