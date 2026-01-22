import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { CommissionStatement } from '../types';

/**
 * Exports a commission statement as a PDF
 */
export const exportCommissionStatementPDF = (statement: CommissionStatement): void => {
  const doc = new jsPDF();
  
  // Header
  doc.setFontSize(20);
  doc.setTextColor(79, 70, 229); // indigo-600
  doc.text('Commission Statement', 14, 20);
  
  doc.setFontSize(12);
  doc.setTextColor(51, 65, 85); // slate-700
  doc.text(`Salesperson: ${statement.salesperson}`, 14, 30);
  doc.text(`Period: ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`, 14, 36);
  
  // Table data
  const tableData = statement.items.map(item => [
    item.date,
    item.clientName,
    item.serviceDescription.length > 40 ? item.serviceDescription.substring(0, 40) + '...' : item.serviceDescription,
    `$${item.amountReceived.toFixed(2)}`,
    `$${item.commissionAmount.toFixed(2)}`
  ]);
  
  // Add total row
  tableData.push([
    '',
    '',
    '',
    'Total Payout:',
    `$${statement.totalCommission.toFixed(2)}`
  ]);
  
  // Generate table
  autoTable(doc, {
    head: [['Date', 'Client', 'Service', 'Revenue', 'Commission']],
    body: tableData,
    startY: 45,
    styles: {
      fontSize: 9,
      cellPadding: 3,
    },
    headStyles: {
      fillColor: [248, 250, 252], // slate-50
      textColor: [71, 85, 105], // slate-500
      fontStyle: 'bold',
    },
    bodyStyles: {
      textColor: [15, 23, 42], // slate-900
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252], // slate-50
    },
    columnStyles: {
      3: { halign: 'right' }, // Revenue column
      4: { halign: 'right', fontStyle: 'bold' }, // Commission column
    },
    didParseCell: (data) => {
      // Style the total row
      if (data.row.index === tableData.length - 1) {
        data.cell.styles.fillColor = [238, 242, 255]; // indigo-50
        data.cell.styles.textColor = [67, 56, 202]; // indigo-700
        data.cell.styles.fontStyle = 'bold';
      }
    },
    margin: { top: 45, left: 14, right: 14 },
  });
  
  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184); // slate-400
    doc.text(
      `Page ${i} of ${pageCount}`,
      doc.internal.pageSize.getWidth() / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: 'center' }
    );
  }
  
  // Save the PDF
  const filename = `Commission_Statement_${statement.salesperson.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
};
