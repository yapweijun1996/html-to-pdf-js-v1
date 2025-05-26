/**
 * @jest-environment jsdom
 */
const PDFExporter = require('../pdf-exporter.js');

describe('PDFExporter utilities', () => {
  test('_parseCssColor parses rgb', () => {
    const c = PDFExporter._parseCssColor('rgb(255, 128, 0)');
    expect(c.r).toBeCloseTo(1);
    expect(c.g).toBeCloseTo(128/255);
    expect(c.b).toBeCloseTo(0);
    expect(c.a).toBe(1);
  });

  test('_parseCssColor parses #abc', () => {
    const c = PDFExporter._parseCssColor('#abc');
    expect(c.r).toBeCloseTo(parseInt('aa',16)/255);
    expect(c.g).toBeCloseTo(parseInt('bb',16)/255);
    expect(c.b).toBeCloseTo(parseInt('cc',16)/255);
    expect(c.a).toBe(1);
  });

  test('_parseCssColor parses hsl', () => {
    const c = PDFExporter._parseCssColor('hsl(0, 100%, 50%)');
    expect(c.r).toBeCloseTo(1);
    expect(c.g).toBeCloseTo(0);
    expect(c.b).toBeCloseTo(0);
    expect(c.a).toBe(1);
  });

  test('_parseCssLength parses px', () => {
    expect(PDFExporter._parseCssLength('16px')).toBe(16);
  });

  test('_parseCssLength parses pt', () => {
    expect(PDFExporter._parseCssLength('12pt')).toBeCloseTo(12*(96/72));
  });

  test('_parseCssLength parses em', () => {
    expect(PDFExporter._parseCssLength('2em', 10)).toBe(20);
  });

  test('custom list bullets', () => {
    const exporter = new PDFExporter({ ulBulletSymbols: ['* ', '• '], olBulletFormat: (i, lvl) => `${i+1}) ` });
    expect(exporter.ulBulletSymbols[0]).toBe('* ');
    expect(exporter.olBulletFormat(2, 0)).toBe('3) ');
  });
}); 