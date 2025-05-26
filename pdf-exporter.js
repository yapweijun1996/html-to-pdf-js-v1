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
      const cs = window.getComputedStyle(node);
      if (cs.color) newStyle.color = PDFExporter._parseCssColor(cs.color);
      if (cs.fontSize.endsWith('px')) newStyle.size = parseFloat(cs.fontSize);
      this._processInline(node.firstChild, newStyle);
      Array.from(node.childNodes).slice(1).forEach(child => this._processInline(child, newStyle));
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

  // Render table rows across pages
  _renderTable(tableData, styleState) {
    const pad = this.tableCellPadding;
    const fontSize = styleState.size;
    const cellH = fontSize*1.2 + pad*2;
    const x0 = this.margin;
    const widths = tableData.columnWidths;
    const totalW = widths.reduce((a,b)=>a+b,0);
    let rowCursor = 0;
    const allRows = [...tableData.headers.map(r=>({cells:r, header:true})), ...tableData.rows.map(r=>({cells:r, header:false}))];
    const drawGrid = yTop => {
      // horizontal lines
      for (let i=0;i<=allRows.length && i<=rowCursor+1;i++) {
        const y = yTop - i*cellH;
        this._write(`${x0} ${y} m ${x0+totalW} ${y} l S\n`);
      }
      // vertical lines
      let acc = x0;
      widths.forEach(w=>{
        this._write(`${acc} ${yTop} m ${acc} ${yTop - cellH*(rowCursor+1)} l S\n`);
        acc+=w;
      });
      this._write(`${x0+totalW} ${yTop} m ${x0+totalW} ${yTop - cellH*(rowCursor+1)} l S\n`);
    };

    let pageStart = true;
    while (rowCursor < allRows.length) {
      if (pageStart) {
        const yTop = this.cursorY;
        drawGrid(yTop);
        pageStart = false;
      }
      const {cells, header} = allRows[rowCursor];
      const yText = this.cursorY - pad - fontSize;
      let accX = x0;
      cells.forEach((cellEl,i)=>{
        const text = cellEl.textContent.trim();
        const cs = window.getComputedStyle(cellEl);
        let align = cs.textAlign;
        const w = this._textWidth(text, fontSize);
        let x = accX + pad;
        if (align==='center') x = accX + (widths[i]-w)/2;
        else if (align==='right') x = accX + widths[i]-pad-w;
        this._drawCell(text, header? 'B':'N', fontSize, x, yText, null);
        accX += widths[i];
      });
      this.cursorY -= cellH;
      rowCursor++;
      if (rowCursor < allRows.length && this.cursorY - cellH < this.margin) {
        this._newPage();
        pageStart = true;
      }
    }
    this.cursorY -= this.leading*0.2;
  }

  // Process any block-level element: margins, padding, background, border, then children
  _processBlock(el, styleState) {
    const cs = window.getComputedStyle(el);
    const mt = parseFloat(cs.marginTop) || 0;
    this.cursorY -= mt;
    // background
    const bg = cs.backgroundColor;
    if (bg && bg!=='transparent') {
      const c = PDFExporter._parseCssColor(bg);
      const x = this.margin;
      const width = this.pageWidth - 2*this.margin;
      const height = parseFloat(cs.height) || 0; // estimate
      const y = this.cursorY - height;
      this._write(`${c.r.toFixed(3)} ${c.g.toFixed(3)} ${c.b.toFixed(3)} rg\n`);
      this._write(`${x} ${y} ${width} ${height} re f\n`);
      this._write('0 0 0 rg\n');
    }
    // border
    const bw = parseFloat(cs.borderWidth) || 0;
    if (bw>0) {
      const bc = PDFExporter._parseCssColor(cs.borderColor);
      this._write(`${bc.r.toFixed(3)} ${bc.g.toFixed(3)} ${bc.b.toFixed(3)} RG\n`);
      const x = this.margin;
      const y = this.cursorY - (parseFloat(cs.height)||0);
      const w = this.pageWidth - 2*this.margin;
      const h = parseFloat(cs.height) || 0;
      // draw rectangle border
      this._write(`${x} ${y} ${w} ${h} re S\n`);
      this._write('0 0 0 RG\n');
    }
    const pt = parseFloat(cs.paddingTop) || 0;
    this.cursorY -= pt;
    // dispatch children
    Array.from(el.childNodes).forEach(child => {
      if (child.nodeType === 3) this._processInline(child, styleState);
      else if (child.nodeType===1) {
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
    const pb = parseFloat(cs.paddingBottom) || 0;
    this.cursorY -= pb;
    const mb = parseFloat(cs.marginBottom) || 0;
    this.cursorY -= mb;
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