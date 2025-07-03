import { cloneDom } from './core/domParser.js';
import { exportPdf } from './core/pdfExporter.js';

export async function htmlToPdf(element, options = {}) {
  const clone = cloneDom(element);
  await exportPdf(clone, options);
}
