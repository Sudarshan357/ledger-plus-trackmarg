import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatDate, formatDateShort, formatDateTime } from './format';
import type { ExportBundle } from './types';

// jsPDF's built-in fonts are WinAnsi-encoded and have no glyph for the rupee sign, so a "₹"
// written into a PDF comes out as a wrong character. Embedding a Unicode font to fix that
// would add a few hundred KB to the bundle for one symbol, so printed documents use "Rs."
// instead. The CSV is UTF-8 and carries plain numbers, which is what a spreadsheet wants.
function rs(amount: number): string {
  const abs = Math.abs(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return `${amount < 0 ? '-' : ''}Rs. ${abs}`;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download on some mobile browsers before it starts.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'ledger';
}

// ── PDF ───────────────────────────────────────────────────────────────────

export function exportPdf(bundle: ExportBundle): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = 48;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(bundle.group.name, margin, y);

  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(
    `Partnership Ledger  |  Group code ${bundle.group.displayCode}  |  Generated ${formatDateTime(
      bundle.generatedAt,
    )}`,
    margin,
    y,
  );

  y += 22;
  doc.setDrawColor(220);
  doc.line(margin, y, pageWidth - margin, y);
  y += 24;

  // Partners
  doc.setTextColor(20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Partners', margin, y);
  y += 6;
  autoTable(doc, {
    startY: y + 4,
    margin: { left: margin, right: margin },
    head: [['Name', 'Phone', 'Role', 'Joined']],
    body: bundle.partners.map((p) => [p.name, p.phone, p.role, formatDateShort(p.joinedAt)]),
    theme: 'grid',
    headStyles: { fillColor: [17, 24, 39], fontSize: 9 },
    bodyStyles: { fontSize: 9 },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 26;

  // Current session
  const session = bundle.currentSession;
  const current = bundle.current;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(
    `Current session #${String(session.seq).padStart(3, '0')}  (from ${formatDateShort(
      session.startedAt,
    )})`,
    margin,
    y,
  );

  autoTable(doc, {
    startY: y + 10,
    margin: { left: margin, right: margin },
    head: [['Partner', 'Received', 'Expenses', 'Net', 'Share balance']],
    body: [
      ...current.partners.map((p) => [
        p.name,
        rs(p.received),
        rs(p.expense),
        rs(p.net),
        `${p.shareBalance > 0 ? '+' : ''}${rs(p.shareBalance)}`,
      ]),
      [
        { content: 'Total', styles: { fontStyle: 'bold' as const } },
        { content: rs(current.totalReceived), styles: { fontStyle: 'bold' as const } },
        { content: rs(current.totalExpense), styles: { fontStyle: 'bold' as const } },
        { content: rs(current.totalProfit), styles: { fontStyle: 'bold' as const } },
        { content: `${rs(current.sharePerPartner)} each`, styles: { fontStyle: 'bold' as const } },
      ],
    ],
    theme: 'grid',
    headStyles: { fillColor: [17, 24, 39], fontSize: 9 },
    bodyStyles: { fontSize: 9 },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  if (current.from && current.to && current.amount > 0) {
    doc.text(`Settlement: ${current.from.name} pays ${current.to.name} ${rs(current.amount)}`, margin, y);
  } else {
    doc.text('Settlement: all square - nothing to transfer.', margin, y);
  }
  y += 26;

  // Transaction history
  doc.setFontSize(12);
  doc.text('Transaction history', margin, y);
  autoTable(doc, {
    startY: y + 10,
    margin: { left: margin, right: margin },
    head: [['Date', 'Session', 'Type', 'Category', 'Partner', 'Amount', 'Notes']],
    body: bundle.transactions.map((t) => [
      formatDate(t.date),
      `#${String(t.sessionSeq ?? 0).padStart(3, '0')}`,
      t.type === 'received' ? 'Received' : 'Expense',
      t.category,
      t.ownerName,
      `${t.type === 'received' ? '+' : '-'}${rs(t.amount)}`,
      t.notes,
    ]),
    theme: 'striped',
    headStyles: { fillColor: [17, 24, 39], fontSize: 9 },
    bodyStyles: { fontSize: 8.5 },
    columnStyles: { 6: { cellWidth: 110 } },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 26;

  // Past settlements
  if (bundle.settlements.length > 0) {
    if (y > doc.internal.pageSize.getHeight() - 140) {
      doc.addPage();
      y = 48;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Settlement history', margin, y);
    autoTable(doc, {
      startY: y + 10,
      margin: { left: margin, right: margin },
      head: [['Settlement', 'Period', 'Received', 'Expenses', 'Profit', 'Direction', 'Amount']],
      body: bundle.settlements.map((s) => [
        s.label,
        `${formatDateShort(s.startedAt)} - ${formatDateShort(s.closedAt)}`,
        rs(s.totalReceived),
        rs(s.totalExpense),
        rs(s.totalProfit),
        s.fromUserName ? `${s.fromUserName} -> ${s.toUserName}` : 'All square',
        rs(s.amount),
      ]),
      theme: 'grid',
      headStyles: { fillColor: [17, 24, 39], fontSize: 9 },
      bodyStyles: { fontSize: 8.5 },
    });
  }

  // Footer on every page, added at the end so the total page count is known.
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(
      `Ledger+  |  Powered by Trackmarg  |  Page ${page} of ${pages}`,
      margin,
      doc.internal.pageSize.getHeight() - 22,
    );
  }

  doc.save(`${safeName(bundle.group.name)}-ledger-${bundle.generatedAt.slice(0, 10)}.pdf`);
}

// ── CSV ───────────────────────────────────────────────────────────────────

/// RFC 4180 quoting: wrap every field and double any embedded quote. Notes routinely contain
/// commas and the occasional quotation mark, and an unescaped one silently shifts every
/// column after it.
function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export function exportCsv(bundle: ExportBundle): void {
  const header = [
    'Transaction ID',
    'Date',
    'Type',
    'Category',
    'Amount',
    'Owner',
    'Notes',
    'Created At',
    'Session ID',
    'Session No',
  ];

  const rows = bundle.transactions.map((t) => [
    t.id,
    t.date,
    t.type,
    t.category,
    // Unformatted so the column stays numeric in a spreadsheet; signed so a SUM over it is
    // the actual profit rather than the turnover.
    (t.type === 'received' ? t.amount : -t.amount).toFixed(2),
    t.ownerName,
    t.notes,
    t.createdAt,
    t.sessionId,
    t.sessionSeq ?? '',
  ]);

  const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');

  // The BOM is what makes Excel read this as UTF-8 rather than the local codepage - without
  // it, any non-ASCII character in a name or note is mangled on open.
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  download(blob, `${safeName(bundle.group.name)}-transactions-${bundle.generatedAt.slice(0, 10)}.csv`);
}
