// pdf-exporter.js
// Single-file, zero-dependency HTML → PDF with CSS box-model, styled inline, nested lists, and multi-page tables

class PDFExporter {
  constructor(opts = {}) {
    this.objects = [];
    this.offsets = [];
    this.pages = [];
    this.streams = {};
    this.pageWidth = opts.pageWidth || 595.28;
    this.pageHeight = opts.pageHeight || 841.89;
    this.margin = opts.margin != null ? opts.margin : 40;
    this.fontSizes = {
      h1: opts.h1FontSize || 24,
      h2: opts.h2FontSize || 18,
      normal: opts.fontSize || 12
    };
    this.leading = this.fontSizes.normal * 1.2;
    this.bulletIndent = opts.bulletIndent || 20;
    this.tableCellPadding = opts.tableCellPadding || 5;

    // Built-in fonts
    this.fH = this._addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    this.fB = this._addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    this.fI = this._addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>');
    this.fN = this._addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    // Canvas for text measurement
    try { const c = document.createElement('canvas'); this.ctx = c.getContext('2d'); }
    catch(e) { this.ctx = null; }
    this.fontFamily = opts.fontFamily || 'Helvetica';
    this.styleCache = new WeakMap();
  }

  _addObject(content) {
    this.objects.push(content);
    return this.objects.length;
  }

  _newPage() {
    const cid = this._addObject('');
    const pid = this._addObject(
      `<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] ` +
      `/Contents ${cid} 0 R /Resources << /Font << ` +
      `/H ${this.fH} 0 R /B ${this.fB} 0 R /I ${this.fI} 0 R /N ${this.fN} 0 R >> >> >>`
    );
    this.pages.push({ pid, cid });
    this.streams[cid] = [];
    this.cursorY = this.pageHeight - this.margin;
  }

  _write(txt) {
    const cid = this.pages[this.pages.length - 1].cid;
    this.streams[cid].push(txt);
  }

  _ensureSpace(lines = 1) {
    if (this.cursorY < lines * this.leading + this.margin) {
      this._newPage();
    }
  }

  _textWidth(text, size) {
    if (this.ctx) {
      this.ctx.font = `${size}px ${this.fontFamily}`;
      return this.ctx.measureText(text).width;
    }
    return text.length * size * 0.5;
  }

  static _parseCssColor(cssColor) {
    // Parse rgb/rgba with optional alpha, and #rrggbb
    var m = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([01]?\.?\d*))?\)/);
    if (m) {
      return {
        r: parseInt(m[1], 10)/255,
        g: parseInt(m[2], 10)/255,
        b: parseInt(m[3], 10)/255,
        a: m[4] !== undefined ? parseFloat(m[4]) : 1
      };
    }
    m = cssColor.match(/^#([0-9a-fA-F]{6})$/);
    if (m) {
      var hex6 = m[1];
      return {
        r: ((hex6>>16)&0xFF)/255,
        g: ((hex6>>8)&0xFF)/255,
        b: (hex6&0xFF)/255,
        a: 1
      };
    }
    // 3-digit hex, e.g. #abc
    m = cssColor.match(/^#([0-9a-fA-F]{3})$/);
    if (m) {
      const h = m[1];
      return {
        r: parseInt(h[0] + h[0], 16)/255,
        g: parseInt(h[1] + h[1], 16)/255,
        b: parseInt(h[2] + h[2], 16)/255,
        a: 1
      };
    }
    // hsl and hsla
    m = cssColor.match(/^hsla?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%\s*(?:,\s*([01]?\.\d+)\s*)?\)$/);
    if (m) {
      const h = parseFloat(m[1]) % 360;
      const s = parseFloat(m[2]) / 100;
      const l = parseFloat(m[3]) / 100;
      const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
      let r, g, b;
      if (s === 0) {
        r = g = b = l;
      } else {
        const hue2rgb = (p, q, t) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1/6) return p + (q - p) * 6 * t;
          if (t < 1/2) return q;
          if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
          return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        const hk = h / 360;
        r = hue2rgb(p, q, hk + 1/3);
        g = hue2rgb(p, q, hk);
        b = hue2rgb(p, q, hk - 1/3);
      }
      return { r, g, b, a };
    }
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  // Parse CSS length strings (px, pt, em) into numeric px; defaults 0.
  static _parseCssLength(cssValue, baseFontSize = 0) {
    if (!cssValue || cssValue === 'auto') return 0;
    const m = cssValue.match(/^([\d.]+)(px|pt|em)?$/);
    if (m) {
      const v = parseFloat(m[1]);
      const unit = m[2] || 'px';
      switch (unit) {
        case 'px': return v;
        case 'pt': return v * (96/72); // convert pt to px
        case 'em': return v * baseFontSize;
      }
    }
    return parseFloat(cssValue) || 0;
  }

  // Get and cache computed style for an element
  _getStyle(el) {
    let cs = this.styleCache.get(el);
    if (!cs) {
      cs = window.getComputedStyle(el);
      this.styleCache.set(el, cs);
    }
    return cs;
  }

  // Low-level draw a single text run at x,y
  _drawCell(text, fontKey, size, x, y, color) {
    const safe = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    let cmd = `BT /${fontKey} ${size} Tf `;
    if (color) cmd += `${color.r.toFixed(3)} ${color.g.toFixed(3)} ${color.b.toFixed(3)} rg `;
    cmd += `${x} ${y} Td (${safe}) Tj ET\n`;
    this._write(cmd);
  }

  // Styled inline text with wrapping and indent
  _drawStyledText(text, styleState) {
    const { fontKey, size, color, indent = 0 } = styleState;
    this._ensureSpace(1);
    const maxWidth = this.pageWidth - 2 * this.margin - indent;
    let line = '';
    text.split(' ').forEach(word => {
      const test = line + word + ' ';
      if (this._textWidth(test.trim(), size) > maxWidth && line) {
        const y = this.cursorY;
        this._drawCell(line.trim(), fontKey, size, this.margin + indent, y, color);
        this.cursorY -= size * 1.2;
        line = word + ' ';
      } else line = test;
    });
    if (line) {
      const y = this.cursorY;
      this._drawCell(line.trim(), fontKey, size, this.margin + indent, y, color);
      this.cursorY -= size * 1.2;
    }
  }

  // Recursively process inline <strong>,<em>,<span style> etc.
  _processInline(node, styleState) {
    if (node.nodeType === Node.TEXT_NODE) {
      const txt = node.textContent.trim();
      if (txt) this._drawStyledText(txt, styleState);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const newStyle = { ...styleState };
      const tag = node.tagName.toUpperCase();
      if (tag === 'STRONG' || tag === 'B') newStyle.fontKey = 'B';
      if (tag === 'EM' || tag === 'I') newStyle.fontKey = 'I';
      const cs = this._getStyle(node);
      if (cs.color) newStyle.color = PDFExporter._parseCssColor(cs.color);
      newStyle.size = PDFExporter._parseCssLength(cs.fontSize, styleState.size);
      // Recursively process all child nodes with inherited styles
      Array.from(node.childNodes).forEach(child => this._processInline(child, newStyle));
    }
  }

  // Nested lists with indent and ASCII bullet
  _drawList(listEl, level, styleState, isOrdered) {
    const items = Array.from(listEl.children).filter(el => el.tagName === 'LI');
    items.forEach((li, idx) => {
      const bullet = isOrdered ? `${idx+1}. ` : '- ';
      this._drawStyledText(bullet + li.textContent.trim(), { ...styleState, indent: this.bulletIndent * level });
      Array.from(li.children).forEach(child => {
        if (['UL','OL'].includes(child.tagName))
          this._drawList(child, level+1, styleState, child.tagName==='OL');
      });
    });
  }

  // Prepare table cell elements
  _prepareTable(tableEl) {
    const headers = Array.from(tableEl.querySelectorAll('thead tr')).map(tr => Array.from(tr.querySelectorAll('th')));
    const body = tableEl.querySelector('tbody') || tableEl;
    const rows = Array.from(body.querySelectorAll('tr')).filter(tr => !tr.closest('thead')).map(tr => Array.from(tr.querySelectorAll('td')));
    const colCount = headers[0]?.length || rows[0]?.length || 0;
    return { headers, rows, colCount, columnWidths: [] };
  }

  // Measure minimum widths per column
  _measureTable(tableData, styleState) {
    const pad = this.tableCellPadding;
    const widths = Array(tableData.colCount).fill(0);
    tableData.headers.forEach(row => row.forEach((cell, i) => {
      const w = this._textWidth(cell.textContent.trim(), styleState.size) + pad*2;
      widths[i] = Math.max(widths[i], w);
    }));
    tableData.rows.forEach(row => row.forEach((cell, i) => {
      const w = this._textWidth(cell.textContent.trim(), styleState.size) + pad*2;
      widths[i] = Math.max(widths[i], w);
    }));
    tableData.columnWidths = widths;
  }

  // Distribute to fit page width
  _layoutTable(tableData) {
    const total = tableData.columnWidths.reduce((a,b)=>a+b,0);
    const avail = this.pageWidth - 2*this.margin;
    if (total < avail) {
      const extra = (avail-total)/tableData.columnWidths.length;
      tableData.columnWidths = tableData.columnWidths.map(w=>w+extra);
    } else if (total>avail) {
      const ratio = avail/total;
      tableData.columnWidths = tableData.columnWidths.map(w=>w*ratio);
    }
  }

  // Render table rows across pages with multi-line cell support
  _renderTable(tableData, styleState) {
    const pad = this.tableCellPadding;
    const fontSize = styleState.size;
    const lineHeight = fontSize * 1.2;
    const x0 = this.margin;
    const widths = tableData.columnWidths;
    const totalW = widths.reduce((a, b) => a + b, 0);

    // Combine headers and rows
    const allRows = [
      ...tableData.headers.map(r => ({ cells: r, header: true })),
      ...tableData.rows.map(r => ({ cells: r, header: false }))
    ];

    // Helper to wrap text within a cell
    const wrapText = (text, maxW) => {
      const words = text.split(' ');
      const lines = [];
      let current = '';
      words.forEach(word => {
        const test = current ? current + ' ' + word : word;
        if (this._textWidth(test, fontSize) > maxW - pad * 2 && current) {
          lines.push(current);
          current = word;
        } else {
          current = test;
        }
      });
      if (current) lines.push(current);
      return lines;
    };

    // Precompute wrapped lines and row heights
    const cellLines = allRows.map(({ cells }) =>
      cells.map((cell, ci) => wrapText(cell.textContent.trim(), widths[ci]))
    );
    const rowHeights = cellLines.map(linesArr => {
      const maxLines = Math.max(...linesArr.map(lines => lines.length));
      return maxLines * lineHeight + pad * 2;
    });

    let rowCursor = 0;
    while (rowCursor < allRows.length) {
      const yTop = this.cursorY;
      // Determine rows that fit on this page
      let sumH = 0;
      let end = rowCursor;
      while (end < allRows.length && sumH + rowHeights[end] <= yTop - this.margin) {
        sumH += rowHeights[end];
        end++;
      }

      // Draw grid lines
      this._write(`${x0} ${yTop} m ${x0 + totalW} ${yTop} l S\n`);
      let accH = 0;
      for (let i = rowCursor; i < end; i++) {
        accH += rowHeights[i];
        const yLine = yTop - accH;
        this._write(`${x0} ${yLine} m ${x0 + totalW} ${yLine} l S\n`);
      }
      // Vertical lines
      let accX = x0;
      widths.forEach(w => {
        this._write(`${accX} ${yTop} m ${accX} ${yTop - sumH} l S\n`);
        accX += w;
      });
      this._write(`${x0 + totalW} ${yTop} m ${x0 + totalW} ${yTop - sumH} l S\n`);

      // Render each row
      for (; rowCursor < end; rowCursor++) {
        const { cells, header } = allRows[rowCursor];
        const linesArr = cellLines[rowCursor];
        const height = rowHeights[rowCursor];
        const yTextStart = this.cursorY - pad - fontSize;
        accX = x0;

        cells.forEach((cellEl, ci) => {
          const cs = this._getStyle(cellEl);
          const align = cs.textAlign;
          const lines = linesArr[ci];
          const colW = widths[ci];
          lines.forEach((ln, li) => {
            const tw = this._textWidth(ln, fontSize);
            let x = accX + pad;
            if (align === 'center') x = accX + (colW - tw) / 2;
            else if (align === 'right') x = accX + colW - pad - tw;
            const y = yTextStart - li * lineHeight;
            this._drawCell(ln, header ? 'B' : 'N', fontSize, x, y, null);
          });
          accX += colW;
        });

        this.cursorY -= height;
        if (rowCursor + 1 < allRows.length && this.cursorY - rowHeights[rowCursor + 1] < this.margin) {
          this._newPage();
          break;
        }
      }
    }
    this.cursorY -= lineHeight * 0.2;
  }

  // Process any block-level element: margins, padding, background, border, then children
  _processBlock(el, styleState) {
    const cs = this._getStyle(el);
    const mt = PDFExporter._parseCssLength(cs.marginTop, styleState.size);
    this.cursorY -= mt;
    // Background fill
    const bg = cs.backgroundColor;
    const c = PDFExporter._parseCssColor(bg);
    const height = PDFExporter._parseCssLength(cs.height, styleState.size);
    if (c.a > 0 && height > 0) {
      const x = this.margin;
      const width = this.pageWidth - 2 * this.margin;
      const y = this.cursorY - height;
      this._write(`${c.r.toFixed(3)} ${c.g.toFixed(3)} ${c.b.toFixed(3)} rg\n`);
      this._write(`${x} ${y} ${width} ${height} re f\n`);
      this._write('0 0 0 rg\n');
    }
    const bw = PDFExporter._parseCssLength(cs.borderWidth, styleState.size);
    if (bw > 0) {
      const bc = PDFExporter._parseCssColor(cs.borderColor);
      this._write(`${bc.r.toFixed(3)} ${bc.g.toFixed(3)} ${bc.b.toFixed(3)} RG\n`);
      const x = this.margin;
      const y = this.cursorY - height;
      const w = this.pageWidth - 2 * this.margin;
      const h = height;
      this._write(`${x} ${y} ${w} ${h} re S\n`);
      this._write('0 0 0 RG\n');
    }
    const pt = PDFExporter._parseCssLength(cs.paddingTop, styleState.size);
    this.cursorY -= pt;
    Array.from(el.childNodes).forEach(child => {
      if (child.nodeType === 3) this._processInline(child, styleState);
      else if (child.nodeType === 1) {
        const tag = child.tagName;
        if (tag==='H1') {
          this._drawStyledText(child.textContent.trim(), { fontKey:'H', size:this.fontSizes.h1, color:styleState.color, indent:styleState.indent });
        } else if (tag==='H2') {
          this._drawStyledText(child.textContent.trim(), { fontKey:'B', size:this.fontSizes.h2, color:styleState.color, indent:styleState.indent });
        } else if (tag==='P') {
          this._drawStyledText(child.textContent.trim(), styleState);
        } else if (tag==='UL'||tag==='OL') {
          this._drawList(child, 0, styleState, tag==='OL');
        } else if (tag==='TABLE') {
          const td = this._prepareTable(child);
          this._measureTable(td, styleState);
          this._layoutTable(td);
          this._renderTable(td, styleState);
        } else {
          this._processBlock(child, styleState);
        }
      }
    });
    const pb = PDFExporter._parseCssLength(cs.paddingBottom, styleState.size);
    this.cursorY -= pb;
    const mb = PDFExporter._parseCssLength(cs.marginBottom, styleState.size);
    this.cursorY -= mb;
  }

  save(filename) {
    // Finalize streams for each page
    this.pages.forEach(function(p) {
      const content = this.streams[p.cid].join('');
      const stream = '<< /Length ' + content.length + ' >> stream\n' + content + '\nendstream\n';
      this.objects[p.cid - 1] = stream;
    }, this);

    // Pages tree
    const kids = this.pages.map(p => p.pid + ' 0 R').join(' ');
    const pagesObj = this._addObject('<< /Type /Pages /Count ' + this.pages.length + ' /Kids [' + kids + '] >>');

    // Update parent references
    this.objects = this.objects.map(obj => obj.replace('/Parent 0 0 R', '/Parent ' + pagesObj + ' 0 R'));

    // Catalog
    const catalog = this._addObject('<< /Type /Catalog /Pages ' + pagesObj + ' 0 R >>');

    // Build PDF
    let out = '%PDF-1.3\n';
    this.objects.forEach((obj, i) => {
      this.offsets[i] = out.length;
      out += (i+1) + ' 0 obj\n' + obj + 'endobj\n';
    });

    // Xref
    const xref = out.length;
    out += 'xref\n0 ' + (this.objects.length+1) + '\n';
    out += '0000000000 65535 f \n';
    this.offsets.forEach(o => {
      out += ('0000000000' + o).slice(-10) + ' 00000 n \n';
    });

    // Trailer
    out += 'trailer<< /Size ' + (this.objects.length+1) + ' /Root ' + catalog + ' 0 R >>\n';
    out += 'startxref\n' + xref + '\n%%EOF';

    // Download
    const blob = new Blob([out], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  static init(opts = {}) {
    const pdf = new PDFExporter(opts);
    pdf._newPage();
    const defaultStyle = { fontKey:'N', size:pdf.fontSizes.normal, color:{r:0,g:0,b:0}, indent:0 };
    document.querySelectorAll(opts.selector).forEach(root => {
      pdf._processBlock(root, defaultStyle);
    });
    pdf.save(opts.filename);
  }
}

// Expose globally
window.PDFExporter = PDFExporter;