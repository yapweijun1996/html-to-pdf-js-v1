import jsPDF from 'jspdf';

export async function exportPdf(element, options = {}) {
  const doc = new jsPDF();
  doc.text(element.textContent || '', 10, 10);
  doc.save(options.filename || 'output.pdf');
}
