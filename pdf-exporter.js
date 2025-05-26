// pdf-exporter.js
// Zero-dependency PDF engine: headings (H1,H2), paragraphs, lists, tables, text wrapping

class PDFExporter {
  constructor() {
    this.objects = [];
    this.offsets = [];
    this.pages = [];
    this.streams = {};
    this.tables = [];
    this.pageWidth = 595.28;
    this.pageHeight = 841.89;
    this.margin = 40;
    this.fontSizes = { h1:24, h2:18, normal:12 };
    this.leading = this.fontSizes.normal * 1.2;
    // Built-in fonts
    this.fH = this._addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    this.fB = this._addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    this.fI = this._addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>');
    this.fN = this._addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    // Set up off-screen canvas for accurate text measurement
    try {
      const canvas = document.createElement('canvas');
      this.ctx = canvas.getContext('2d');
    } catch (e) {
      this.ctx = null;
    }
    this.fontFamily = 'Helvetica';
  }

  _addObject(content) {
    this.objects.push(content);
    return this.objects.length;
  }

  _newPage() {
    var cid = this._addObject('');
    var pid = this._addObject(
      '<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ' + this.pageWidth + ' ' + this.pageHeight + '] ' +
      '/Contents ' + cid + ' 0 R /Resources << /Font << ' +
      '/H ' + this.fH + ' 0 R /B ' + this.fB + ' 0 R /I ' + this.fI + ' 0 R /N ' + this.fN + ' 0 R >> >> >>'
    );
    this.pages.push({ pid: pid, cid: cid });
    this.streams[cid] = [];
    this.cursorY = this.pageHeight - this.margin;
  }

  _write(txt) {
    var cid = this.pages[this.pages.length - 1].cid;
    this.streams[cid].push(txt);
  }

  _ensureSpace(lines) {
    if (this.cursorY < lines * this.leading + this.margin) {
      this._newPage();
    }
  }

  _textWidth(text, size) {
    if (this.ctx) {
      // Use canvas measureText for accurate width
      this.ctx.font = size + 'px ' + this.fontFamily;
      return this.ctx.measureText(text).width;
    }
    // Fallback heuristic
    return text.length * size * 0.5;
  }

  _drawText(text, style) {
    var fontKey = 'N', size = this.fontSizes.normal;
    if (style === 'h1') { fontKey = 'H'; size = this.fontSizes.h1; }
    else if (style === 'h2') { fontKey = 'B'; size = this.fontSizes.h2; }

    var maxWidth = this.pageWidth - 2 * this.margin;
    var words = text.split(' '), line = '';
    for (var i = 0; i < words.length; i++) {
      var testLine = line + words[i] + ' ';
      if (this._textWidth(testLine, size) > maxWidth && line) {
        this.text(line.trim(), style);
        line = words[i] + ' ';
      } else {
        line = testLine;
      }
    }
    if (line) this.text(line.trim(), style);
  }

  text(txt, style) {
    this._ensureSpace(1);
    var fontKey = 'N', size = this.fontSizes.normal;
    if (style === 'h1') { fontKey = 'H'; size = this.fontSizes.h1; }
    else if (style === 'h2') { fontKey = 'B'; size = this.fontSizes.h2; }

    var y = this.cursorY;
    this._write(
      'BT /' + fontKey + ' ' + size + ' Tf ' +
      this.margin + ' ' + y + ' Td (' +
      txt.replace(/\(/g, '\\(').replace(/\)/g, '\\)') +
      ') Tj ET\n'
    );
    this.cursorY -= size * 1.2;
  }

  save(filename) {
    this.pages.forEach(function(p) {
      // Join the buffered text for each page
      var content = this.streams[p.cid].join('');
      var stream =
        '<< /Length ' + content.length + ' >> stream\n' +
        content +
        '\nendstream\n';
      this.objects[p.cid - 1] = stream;
    }, this);

    var kids = this.pages.map(function(p) { return p.pid + ' 0 R'; }).join(' ');
    var pagesObj = this._addObject(
      '<< /Type /Pages /Count ' + this.pages.length + ' /Kids [' + kids + '] >>'
    );

    this.objects = this.objects.map(function(obj) {
      return obj.replace('/Parent 0 0 R', '/Parent ' + pagesObj + ' 0 R');
    });

    var catalog = this._addObject(
      '<< /Type /Catalog /Pages ' + pagesObj + ' 0 R >>'
    );

    var out = '%PDF-1.3\n';
    this.objects.forEach(function(obj, i) {
      this.offsets[i] = out.length;
      out += (i + 1) + ' 0 obj\n' + obj + 'endobj\n';
    }, this);

    var xref = out.length;
    out += 'xref\n0 ' + (this.objects.length + 1) + '\n';
    out += '0000000000 65535 f \n';
    this.offsets.forEach(function(o) {
      out += (('0000000000' + o).slice(-10)) + ' 00000 n \n';
    });

    out +=
      'trailer<< /Size ' + (this.objects.length + 1) +
      ' /Root ' + catalog + ' 0 R >>\n';
    out += 'startxref\n' + xref + '\n%%EOF';

    var blob = new Blob([out], { type: 'application/pdf' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  static _parseCssColor(cssColor) {
    var m = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) {
      return {
        r: parseInt(m[1], 10) / 255,
        g: parseInt(m[2], 10) / 255,
        b: parseInt(m[3], 10) / 255
      };
    }
    m = cssColor.match(/^#([0-9a-fA-F]{6})$/);
    if (m) {
      var hex = parseInt(m[1], 16);
      return {
        r: ((hex >> 16) & 0xFF) / 255,
        g: ((hex >> 8) & 0xFF) / 255,
        b: (hex & 0xFF) / 255
      };
    }
    // Default to black
    return { r: 0, g: 0, b: 0 };
  }

  // Draw a single line of styled text with proper wrapping, color, and font
  _drawStyledLine(text, styleState) {
    this._ensureSpace(1);
    const { fontKey, size, color } = styleState;
    const y = this.cursorY;
    let cmd = 'BT /' + fontKey + ' ' + size + ' Tf ';
    if (color) {
      cmd += color.r.toFixed(3) + ' ' + color.g.toFixed(3) + ' ' + color.b.toFixed(3) + ' rg ';
    }
    cmd += this.margin + ' ' + y + ' Td (' +
      text.replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/\\/g, '\\\\') +
      ') Tj ET\n';
    this._write(cmd);
    this.cursorY -= size * 1.2;
  }

  // Draw styled text with line wrapping
  _drawStyledText(text, styleState) {
    const { size } = styleState;
    const maxWidth = this.pageWidth - 2 * this.margin;
    const words = text.split(' ');
    let line = '';
    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i] + ' ';
      if (this._textWidth(testLine, size) > maxWidth && line) {
        this._drawStyledLine(line.trim(), styleState);
        line = words[i] + ' ';
      } else {
        line = testLine;
      }
    }
    if (line) this._drawStyledLine(line.trim(), styleState);
  }

  // Recursively process inline nodes to handle bold, italic, and color
  _processInline(node, styleState) {
    Array.from(node.childNodes).forEach(child => {
      if (child.nodeType === 3) { // TEXT_NODE
        const txt = child.textContent.trim();
        if (txt) this._drawStyledText(txt, styleState);
      } else if (child.nodeType === 1) { // ELEMENT_NODE
        const newStyle = Object.assign({}, styleState);
        const tag = child.tagName.toUpperCase();
        if (tag === 'STRONG' || tag === 'B') newStyle.fontKey = 'B';
        if (tag === 'EM' || tag === 'I') newStyle.fontKey = 'I';
        const inlineColor = child.style.color || window.getComputedStyle(child).color;
        if (inlineColor) newStyle.color = PDFExporter._parseCssColor(inlineColor);
        const inlineSize = child.style.fontSize || window.getComputedStyle(child).fontSize;
        if (inlineSize && inlineSize.endsWith('px')) newStyle.size = parseFloat(inlineSize);
        this._processInline(child, newStyle);
      }
    });
  }

  // Draw nested lists with indenting and markers
  _drawList(listEl, level, styleState, isOrdered) {
    const items = Array.from(listEl.children).filter(el => el.tagName === 'LI');
    items.forEach((li, idx) => {
      const marker = isOrdered ? (idx + 1) + '. ' : '• ';
      const state = Object.assign({}, styleState, { indent: this.bulletIndent * level });
      this._drawStyledText(marker + li.textContent.trim(), state);
      // handle nested lists
      Array.from(li.children).forEach(child => {
        const tag = child.tagName;
        if (tag === 'UL' || tag === 'OL') {
          this._drawList(child, level + 1, styleState, tag === 'OL');
        }
      });
    });
  }

  // Gather table cell texts into a structured object
  _prepareTable(tableEl) {
    const headers = [];
    const rows = [];
    const thead = tableEl.querySelector('thead');
    if (thead) {
      Array.from(thead.querySelectorAll('tr')).forEach(tr => {
        const cells = Array.from(tr.querySelectorAll('th')).map(th => th.textContent.trim());
        headers.push(cells);
      });
    }
    // All rows outside thead
    Array.from(tableEl.querySelectorAll('tr')).forEach(tr => {
      if (!thead || !thead.contains(tr)) {
        const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
        if (cells.length) rows.push(cells);
      }
    });
    const colCount = headers[0] ? headers[0].length : (rows[0] ? rows[0].length : 0);
    return { headers, rows, colCount, columnWidths: [] };
  }

  // Measure each column's max width based on cell content
  _measureTable(tableData, styleState) {
    const { headers, rows, colCount } = tableData;
    const colWidths = new Array(colCount).fill(0);
    // measure headers
    headers.forEach(row => {
      row.forEach((text, idx) => {
        const w = this._textWidth(text, styleState.size);
        if (w > colWidths[idx]) colWidths[idx] = w;
      });
    });
    // measure body rows
    rows.forEach(row => {
      row.forEach((text, idx) => {
        const w = this._textWidth(text, styleState.size);
        if (w > colWidths[idx]) colWidths[idx] = w;
      });
    });
    // add padding
    const pad = this.tableCellPadding || 5;
    for (let i = 0; i < colCount; i++) colWidths[i] += pad * 2;
    tableData.columnWidths = colWidths;
  }

  // Distribute column widths to fill the available page width
  _layoutTable(tableData) {
    const colWidths = tableData.columnWidths;
    const totalMin = colWidths.reduce((sum, w) => sum + w, 0);
    const avail = this.pageWidth - 2 * this.margin;
    if (totalMin === 0) return;
    if (totalMin < avail) {
      // add extra space equally
      const extra = (avail - totalMin) / colWidths.length;
      tableData.columnWidths = colWidths.map(w => w + extra);
    } else if (totalMin > avail) {
      // shrink proportionally
      const ratio = avail / totalMin;
      tableData.columnWidths = colWidths.map(w => w * ratio);
    }
  }

  static init(opts) {
    const pdf = new PDFExporter();
    // List configuration
    pdf.bulletIndent = opts.bulletIndent || 20;
    pdf.hangingIndent = opts.hangingIndent || pdf.bulletIndent;
    pdf._newPage();
    const els = document.querySelectorAll(opts.selector);
    els.forEach(function(el) {
      Array.from(el.children).forEach(function(child) {
        const tag = child.tagName;
        if (tag === 'H1') {
          pdf._processInline(child, {
            fontKey: 'H',
            size: pdf.fontSizes.h1,
            color: { r: 0, g: 0, b: 0 }
          });
        } else if (tag === 'H2') {
          pdf._processInline(child, {
            fontKey: 'B',
            size: pdf.fontSizes.h2,
            color: { r: 0, g: 0, b: 0 }
          });
        } else if (tag === 'P') {
          pdf._processInline(child, {
            fontKey: 'N',
            size: pdf.fontSizes.normal,
            color: { r: 0, g: 0, b: 0 }
          });
        }
        else if (tag === 'UL' || tag === 'OL') {
          pdf._drawList(child, 0, {
            fontKey: 'N',
            size: pdf.fontSizes.normal,
            color: { r: 0, g: 0, b: 0 }
          }, tag === 'OL');
        }
        else if (tag === 'TABLE') {
          // Pre-pass: collect, measure, and layout table data
          const styleState = { size: pdf.fontSizes.normal };
          const tableData = pdf._prepareTable(child);
          pdf.tables.push(tableData);
          pdf._measureTable(tableData, styleState);
          pdf._layoutTable(tableData);
          // TODO: render table using tableData.columnWidths
        }
        pdf.cursorY -= pdf.leading * 0.2;
      });
    });
    pdf.save(opts.filename);
  }
}

// Expose to global
window.PDFExporter = PDFExporter;