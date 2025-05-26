// pdf-exporter.js
// Single-file, zero-dependency HTML → PDF with CSS box-model, styled inline, nested lists, and multi-page tables

class PDFExporter {
  constructor(opts = {}) {
    this.objects = [];
    this.offsets = [];
    this.pages = [];
    this.streams = {};
    this.imageDataCache = new WeakMap(); // For storing preprocessed image data
    // Page size & orientation presets
    const _sizes = {
      A4: [595.28, 841.89],
      Letter: [612, 792]
    };
    let [pw, ph] = opts.pageSize && _sizes[opts.pageSize]
      ? _sizes[opts.pageSize]
      : [opts.pageWidth || 595.28, opts.pageHeight || 841.89];
    if (opts.landscape) [pw, ph] = [ph, pw];
    this.pageWidth = pw;
    this.pageHeight = ph;
    this.margin = opts.margin != null ? opts.margin : 40;
    this.fontSizes = {
      h1: opts.h1FontSize || 24,
      h2: opts.h2FontSize || 18,
      normal: opts.fontSize || 12
    };
    this.leading = this.fontSizes.normal * 1.2;
    this.bulletIndent = opts.bulletIndent || 20;
    this.tableCellPadding = opts.tableCellPadding || 5;
    // Custom list bullet settings
    this.ulBulletSymbols = Array.isArray(opts.ulBulletSymbols) && opts.ulBulletSymbols.length
      ? opts.ulBulletSymbols
      : ['- '];
    this.olBulletFormat = typeof opts.olBulletFormat === 'function'
      ? opts.olBulletFormat
      : ((idx, level) => `${idx+1}. `);

    // Built-in fonts
    this.fH = this._addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    this.fB = this._addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    this.fI = this._addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>');
    this.fN = this._addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    this.fM = this._addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>'); // Monospace font
    // Canvas for text measurement
    try { const c = document.createElement('canvas'); this.ctx = c.getContext('2d'); }
    catch(e) { this.ctx = null; }
    this.fontFamily = opts.fontFamily || 'Helvetica';
    this.styleCache = new WeakMap();
    // Hook called after each new page is created: (pdfInstance, pageIndex)
    this.onPage = typeof opts.onPage === 'function' ? opts.onPage : null;
    // Custom element renderers: {TAGNAME: (node, styleState, pdf) => {}} 
    this.renderers = opts.renderers && typeof opts.renderers === 'object' ? opts.renderers : {};
  }

  _addObject(content) {
    this.objects.push(content);
    return this.objects.length;
  }

  _newPage() {
    const cid = this._addObject('');

    // Create a separate object for page resources (fonts, XObjects)
    // This object will be referenced by the Page object.
    // Initially, it only contains fonts. XObjects will be added later.
    const fontResources = `<< /H ${this.fH} 0 R /B ${this.fB} 0 R /I ${this.fI} 0 R /N ${this.fN} 0 R /M ${this.fM} 0 R >>`;
    const pageResourcesContent = `<< /Font ${fontResources} /XObject << >> >>`;
    const resId = this._addObject(pageResourcesContent);

    const pid = this._addObject(
      `<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] ` +
      `/Contents ${cid} 0 R /Resources ${resId} 0 R >>`
    );
    this.pages.push({ pid, cid, resId, imageResourceMap: {}, annotations: [] }); // Store resId, map for image resources, and annotations array
    this.streams[cid] = [];
    this.cursorY = this.pageHeight - this.margin;
    this.currentPageImageCounter = 0; // For naming image resources on this page (e.g., Im1, Im2)
    // Invoke onPage hook for custom header/footer drawing
    if (this.onPage) this.onPage(this, this.pages.length);
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
      // Only reset canvas font if it changed
      const spec = `${size}px ${this.fontFamily}`;
      if (this._lastFontSpec !== spec) {
        this.ctx.font = spec;
        this._lastFontSpec = spec;
      }
      return this.ctx.measureText(text).width;
    }
    return text.length * size * 0.5;
  }

  // Parse CSS color strings (rgb/rgba, #rrggbb, hsl/hsla) with optional alpha
  // Returns {r:0,g:0,b:0,a:0} (transparent black) on parse failure.
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
  // Returns 0 on parse failure or for 'auto'.
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
    const { fontKey, size, color, indent = 0, linkURI, isLink, isUnderlined, isStrikethrough, isSubscript, isSuperscript, isMarked, markBackgroundColor, availableWidth, textAlign } = styleState;
    this._ensureSpace(1);
    // Max width for text is the availableWidth from parent block, or page width if not specified.
    const effectiveMaxWidth = availableWidth ? availableWidth : (this.pageWidth - 2 * this.margin - indent);

    let line = '';
    const originalColor = color; // Keep original color for non-link parts if a link has specific color

    text.split(' ').forEach(word => {
      const test = line + word + ' ';
      if (this._textWidth(test.trim(), size) > effectiveMaxWidth && line) {
        const lineContent = line.trim();
        let yBaseline = this.cursorY;
        let xDraw = this.margin + indent;
        const textWidthVal = this._textWidth(lineContent, size);

        if (textAlign === 'center') {
            xDraw = this.margin + indent + (effectiveMaxWidth - textWidthVal) / 2;
        } else if (textAlign === 'right') {
            xDraw = this.margin + indent + (effectiveMaxWidth - textWidthVal);
        }

        let currentFontSize = size;
        if (isSubscript) {
          yBaseline -= currentFontSize * 0.2; // Lower baseline
        } else if (isSuperscript) {
          yBaseline += currentFontSize * 0.35; // Raise baseline
        }

        // Draw background for <mark>
        if (isMarked && markBackgroundColor && markBackgroundColor.a > 0) {
            const xBg = xDraw - 1; // Small padding
            const yBg = yBaseline - (currentFontSize * 0.75) - 1; // From approx ascent
            const bgWidth = textWidthVal + 2; // Small padding
            const bgHeight = currentFontSize + 2; // Full line height plus padding
            this._write(`${markBackgroundColor.r.toFixed(3)} ${markBackgroundColor.g.toFixed(3)} ${markBackgroundColor.b.toFixed(3)} rg\n`);
            this._write(`${xBg.toFixed(3)} ${yBg.toFixed(3)} ${bgWidth.toFixed(3)} ${bgHeight.toFixed(3)} re f\n`);
            this._write(`${originalColor.r.toFixed(3)} ${originalColor.g.toFixed(3)} ${originalColor.b.toFixed(3)} rg\n`); // Reset to text color
        }

        this._drawCell(lineContent, fontKey, currentFontSize, xDraw, yBaseline, originalColor);
        if (linkURI) {
          // Define the clickable rectangle for this line segment
          const rect = [xDraw, yBaseline - (currentFontSize * 0.25), xDraw + textWidthVal, yBaseline + (currentFontSize * 0.75)];
          this._addLinkAnnotation(rect, linkURI);
        }
        if (isLink || isUnderlined) { // Draw underline for links or <u> tags
            const yUnderline = yBaseline - (currentFontSize * 0.15); // Position underline slightly below baseline
            this._write(`${xDraw.toFixed(3)} ${yUnderline.toFixed(3)} m ${(xDraw + textWidthVal).toFixed(3)} ${yUnderline.toFixed(3)} l S\n`);
        }
        if (isStrikethrough) { // Draw strikethrough for <s> or <del> tags
            const yStrikethrough = yBaseline + (currentFontSize * 0.25); // Position strikethrough in the middle of the text
            this._write(`${xDraw.toFixed(3)} ${yStrikethrough.toFixed(3)} m ${(xDraw + textWidthVal).toFixed(3)} ${yStrikethrough.toFixed(3)} l S\n`);
        }

        this.cursorY -= size * 1.2; // Original size for line height advancement
        line = word + ' ';
      } else line = test;
    });
    if (line) {
      const lineContent = line.trim();
      let yBaseline = this.cursorY;
      let xDraw = this.margin + indent;
      const textWidthVal = this._textWidth(lineContent, size);
      let currentFontSize = size;

      if (textAlign === 'center') {
        xDraw = this.margin + indent + (effectiveMaxWidth - textWidthVal) / 2;
      } else if (textAlign === 'right') {
        xDraw = this.margin + indent + (effectiveMaxWidth - textWidthVal);
      }

      if (isSubscript) {
        yBaseline -= currentFontSize * 0.2;
      } else if (isSuperscript) {
        yBaseline += currentFontSize * 0.35;
      }

      // Draw background for <mark>
      if (isMarked && markBackgroundColor && markBackgroundColor.a > 0) {
        const xBg = xDraw -1; // Small padding
        const yBg = yBaseline - (currentFontSize * 0.75) -1; // From approx ascent
        const bgWidth = textWidthVal + 2; // Small padding
        const bgHeight = currentFontSize + 2; // Full line height plus padding
        this._write(`${markBackgroundColor.r.toFixed(3)} ${markBackgroundColor.g.toFixed(3)} ${markBackgroundColor.b.toFixed(3)} rg\n`);
        this._write(`${xBg.toFixed(3)} ${yBg.toFixed(3)} ${bgWidth.toFixed(3)} ${bgHeight.toFixed(3)} re f\n`);
        this._write(`${originalColor.r.toFixed(3)} ${originalColor.g.toFixed(3)} ${originalColor.b.toFixed(3)} rg\n`); // Reset to text color for the text itself
      }

      this._drawCell(lineContent, fontKey, currentFontSize, xDraw, yBaseline, originalColor);
      if (linkURI) {
        const rect = [xDraw, yBaseline - (currentFontSize * 0.25), xDraw + textWidthVal, yBaseline + (currentFontSize * 0.75)];
        this._addLinkAnnotation(rect, linkURI);
      }
      if (isLink || isUnderlined) { // Draw underline for links or <u> tags
        const yUnderline = yBaseline - (currentFontSize * 0.15);
        this._write(`${xDraw.toFixed(3)} ${yUnderline.toFixed(3)} m ${(xDraw + textWidthVal).toFixed(3)} ${yUnderline.toFixed(3)} l S\n`);
      }
      if (isStrikethrough) { // Draw strikethrough for <s> or <del> tags
          const yStrikethrough = yBaseline + (currentFontSize * 0.25);
          this._write(`${xDraw.toFixed(3)} ${yStrikethrough.toFixed(3)} m ${(xDraw + textWidthVal).toFixed(3)} ${yStrikethrough.toFixed(3)} l S\n`);
      }
      this.cursorY -= size * 1.2; // Original size for line height advancement
    }
  }

  // Recursively process inline <strong>,<em>,<span style> etc.
  _processInline(node, styleState) {
    if (node.nodeType === Node.TEXT_NODE) {
      const txt = node.textContent.trim(); // Trim to avoid drawing empty spaces that might still add annotations
      if (txt) this._drawStyledText(txt, styleState);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const cs = this._getStyle(node);
      if (cs.display === 'none') {
        return; // Skip rendering this element and its children
      }

      const newStyle = { ...styleState };
      const tag = node.tagName.toUpperCase();
      if (tag === 'STRONG' || tag === 'B') newStyle.fontKey = 'B';
      if (tag === 'EM' || tag === 'I') newStyle.fontKey = 'I';
      
      newStyle.color = cs.color ? PDFExporter._parseCssColor(cs.color) : styleState.color;
      newStyle.size = PDFExporter._parseCssLength(cs.fontSize, styleState.size) || styleState.size;

      if (tag === 'A') {
        newStyle.linkURI = node.getAttribute('href');
        // Default link color to blue if not specified by CSS
        if (!cs.color) {
          newStyle.color = { r: 0, g: 0, b: 1, a: 1 }; // Blue
        }
        newStyle.isLink = true; // Flag to indicate this text segment is part of a link for underlining
      }
      if (tag === 'U') {
        newStyle.isUnderlined = true;
      }
      if (tag === 'S' || tag === 'DEL') {
        newStyle.isStrikethrough = true;
      }
      if (tag === 'SUB') {
        newStyle.isSubscript = true;
        newStyle.size = (newStyle.size || this.fontSizes.normal) * 0.7; // Reduce font size
      }
      if (tag === 'SUP') {
        newStyle.isSuperscript = true;
        newStyle.size = (newStyle.size || this.fontSizes.normal) * 0.7; // Reduce font size
      }
      if (tag === 'MARK') {
        newStyle.isMarked = true;
        // Default mark background to yellow if not specified by CSS
        // Note: _getStyle(node).backgroundColor will usually be transparent unless explicitly set on <mark>
        // So we apply a default yellow here if no specific background is found on the mark itself.
        const markBgColor = PDFExporter._parseCssColor(cs.backgroundColor);
        if (markBgColor.a === 0) { // If transparent (or default black transparent)
            newStyle.markBackgroundColor = { r: 1, g: 1, b: 0, a: 1 }; // Yellow
        } else {
            newStyle.markBackgroundColor = markBgColor;
        }
      }
      if (tag === 'SMALL') {
        newStyle.size = (newStyle.size || this.fontSizes.normal) * 0.85; // Reduce font size slightly
      }
      if (['CODE', 'KBD', 'SAMP', 'VAR'].includes(tag)) {
        newStyle.fontKey = 'M'; // Use Monospace font
        // Optionally, slightly different background for code blocks if not styled by CSS.
        // For now, just changing fontKey. CSS background-color on these elements would be respected by _processBlock if they were block.
        // For inline, if a specific background is desired for code, it can be added similarly to <mark>
      }

      // Recursively process all child nodes with inherited styles
      // except for <br> which is handled directly to force a line break.
      if (tag === 'BR') {
        this.cursorY -= newStyle.size * 1.2; // Advance cursor by one line height based on current style's size
        this._ensureSpace(1); // Ensure we have space on a new page if needed
        // No further processing for BR itself, it just moves the cursor.
      } else {
        Array.from(node.childNodes).forEach(child => this._processInline(child, newStyle));
      }
    }
  }

  // Nested lists with indent and ASCII bullet (now customizable)
  _drawList(listEl, level, styleState, isOrdered) {
    const items = Array.from(listEl.children).filter(el => el.tagName === 'LI');
    const cs = this._getStyle(listEl);
    const listStyleType = cs.listStyleType || (isOrdered ? 'decimal' : 'disc');

    items.forEach((li, idx) => {
      this._ensureSpace(1);

      let bulletText = '';
      if (listStyleType !== 'none') {
        if (isOrdered) {
            // Use custom formatter if available and listStyleType is not one we directly handle as ordinal
            const handledOrdinalTypes = ['decimal', 'lower-alpha', 'lower-latin', 'upper-alpha', 'upper-latin', 'lower-roman', 'upper-roman'];
            if (typeof this.olBulletFormat === 'function' && !handledOrdinalTypes.includes(listStyleType)) {
                bulletText = this.olBulletFormat(idx, level);
            } else {
                bulletText = this._getOrdinal(idx, listStyleType);
            }
        } else { // Unordered list
            switch (listStyleType) {
                case 'circle':
                    bulletText = '◦ '; // ◦
                    break;
                case 'square':
                    bulletText = '▪ '; // ▪ (or use ■ ■ for filled square)
                    break;
                case 'disc': // Explicitly handle disc
                default: // For any other listStyleType not explicitly circle or square, default to disc
                    bulletText = '• '; // •
                    break;
            }
        }
      }

      const liBaseIndent = this.bulletIndent * level;
      const yPosBeforeItem = this.cursorY;

      // Draw bullet text using _drawCell directly for precise control.
      this._drawCell(bulletText, styleState.fontKey, styleState.size, this.margin + liBaseIndent, yPosBeforeItem, styleState.color);

      // Calculate indent for the actual list item content, flowing next to the bullet.
      const bulletWidth = this._textWidth(bulletText, styleState.size);
      // Add a small gap (e.g., 20% of font size) after the bullet before the content starts.
      const contentIndent = liBaseIndent + bulletWidth + (styleState.size * 0.2);

      // Create style state for the LI's content.
      // _processInline will be called for childNodes, and it (via _drawStyledText)
      // will use this new 'indent' and the current 'this.cursorY'.
      const itemContentStyle = { ...styleState, indent: contentIndent };
      
      // Reset cursor Y for the content processing to align vertically with the bullet.
      // _processInline will then draw text starting from this Y position.
      this.cursorY = yPosBeforeItem;

      let contentWasProcessed = false;
      Array.from(li.childNodes).forEach(childNode => {
        // Skip child nodes that are themselves lists (they are handled separately below)
        // and skip purely whitespace text nodes for the purpose of the contentWasProcessed flag.
        if (childNode.nodeType === Node.ELEMENT_NODE && (childNode.tagName === 'UL' || childNode.tagName === 'OL')) {
          return;
        }
        if (childNode.nodeType === Node.TEXT_NODE && childNode.textContent.trim() === '') {
          return;
        }
        
        this._processInline(childNode, itemContentStyle);
        // Check if _processInline actually drew something and moved the cursor.
        // It's possible it processed an empty text node or an element that rendered nothing.
        if (this.cursorY < yPosBeforeItem) {
            contentWasProcessed = true;
        }
      });

      // If no actual inline content was processed (e.g., <li></li> or <li><p></p></li> where <p> is empty,
      // or if _processInline didn't move the cursor), we still need to account for the line height of the bullet.
      if (!contentWasProcessed) {
        this.cursorY = yPosBeforeItem - (styleState.size * 1.2); // Move cursor down for the bullet's line.
      }
      // If content was processed, cursorY is already updated by _drawStyledText calls within _processInline.

      // Process nested lists that are direct children of this LI.
      Array.from(li.children).forEach(childLiElement => {
        if (['UL','OL'].includes(childLiElement.tagName)) {
          // Nested lists start at 'level+1'. Their indent is relative to page margin.
          // The styleState for nested lists should be the original styleState, not itemContentStyle.
          this._drawList(childLiElement, level + 1, styleState, childLiElement.tagName === 'OL');
        }
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
  _layoutTable(tableData, styleState) {
    const total = tableData.columnWidths.reduce((a,b)=>a+b,0);
    // Available width for table is constrained by parent block's availableWidth or page width.
    const avail = styleState.availableWidth || (this.pageWidth - 2*this.margin);

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
    const x0 = this.margin + (styleState.indent || 0); // Tables should be indented based on parent block's indent
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
    if (cs.display === 'none') {
        return; // Skip rendering this element and its children
    }

    const baseFontSize = styleState.size; // Use current styleState size as base for em units
    const parentIndent = styleState.indent || 0;
    const parentAvailableWidth = styleState.availableWidth || (this.pageWidth - 2 * this.margin - parentIndent);

    // Margins
    const mt = PDFExporter._parseCssLength(cs.marginTop, baseFontSize);
    this.cursorY -= mt;
    this._ensureSpace(0); // Check for new page after margin top

    // Padding
    const pt = PDFExporter._parseCssLength(cs.paddingTop, baseFontSize);
    const pr = PDFExporter._parseCssLength(cs.paddingRight, baseFontSize);
    const pb = PDFExporter._parseCssLength(cs.paddingBottom, baseFontSize);
    const pl = PDFExporter._parseCssLength(cs.paddingLeft, baseFontSize);

    // Determine content width for this block
    const parsedCssWidth = PDFExporter._parseCssLength(cs.width, baseFontSize);
    let currentBlockContentWidth;
    if (parsedCssWidth > 0) {
        currentBlockContentWidth = Math.min(parsedCssWidth, parentAvailableWidth - pl - pr); // Cannot exceed parent's available content width minus own padding
    } else {
        currentBlockContentWidth = parentAvailableWidth - pl - pr;
    }

    // Background and Border calculations need to consider padding and the block's actual content width.
    let explicitHeight = PDFExporter._parseCssLength(cs.height, baseFontSize);
    const yBeforeContent = this.cursorY;

    // Border properties (individual sides)
    const btw = PDFExporter._parseCssLength(cs.borderTopWidth, baseFontSize);
    const brw = PDFExporter._parseCssLength(cs.borderRightWidth, baseFontSize);
    const bbw = PDFExporter._parseCssLength(cs.borderBottomWidth, baseFontSize);
    const blw = PDFExporter._parseCssLength(cs.borderLeftWidth, baseFontSize);

    const btc = PDFExporter._parseCssColor(cs.borderTopColor);
    const brc = PDFExporter._parseCssColor(cs.borderRightColor);
    const bbc = PDFExporter._parseCssColor(cs.borderBottomColor);
    const blc = PDFExporter._parseCssColor(cs.borderLeftColor);

    const bts = cs.borderTopStyle;
    const brs = cs.borderRightStyle;
    const bbs = cs.borderBottomStyle;
    const bls = cs.borderLeftStyle;

    // Background fill (now respects padding)
    const bg = cs.backgroundColor;
    const c = PDFExporter._parseCssColor(bg);
    if (c.a > 0) {
      const x = this.margin + parentIndent;
      const y = explicitHeight > 0 ? (this.cursorY - pt - explicitHeight - pb) : (this.cursorY - pt);
      const width = currentBlockContentWidth + pl + pr; // Background width is content + padding
      
      let bgHeight = explicitHeight > 0 ? explicitHeight + pt + pb : 0;
      
      if (bgHeight > 0) { // Only draw if an explicit height allows it, or defer if auto (not implemented yet)
        this._write(`${c.r.toFixed(3)} ${c.g.toFixed(3)} ${c.b.toFixed(3)} rg\n`);
        this._write(`${x.toFixed(3)} ${y.toFixed(3)} ${width.toFixed(3)} ${bgHeight.toFixed(3)} re f\n`);
        this._write('0 0 0 rg\n'); // Reset to black
      }
    }

    // Border (now respects padding and individual side widths/colors)
    // This logic draws borders if an explicit height is set. Auto-height border drawing is handled later.
    if (explicitHeight > 0 && (btw > 0 || brw > 0 || bbw > 0 || blw > 0)) {
        const x = this.margin + parentIndent;
        const y = this.cursorY - pt - explicitHeight - pb;
        const w = currentBlockContentWidth + pl + pr;
        const h = explicitHeight + pt + pb;

        this._drawBorders(x, y, w, h, {btw, brw, bbw, blw}, {btc, brc, bbc, blc}, {bts, brs, bbs, bls});
    }

    this.cursorY -= pt; // Apply padding top

    // Create new style state for children, including new indent based on this block's padding-left.
    const childStyleState = {
         ...styleState,
         indent: parentIndent + pl,
         availableWidth: currentBlockContentWidth, // Children operate within this block's content width
         textAlign: cs.textAlign || styleState.textAlign // Inherit or override textAlign
    };

    Array.from(el.childNodes).forEach(child => {
      if (child.nodeType === 3) {
        this._processInline(child, childStyleState);
      } else if (child.nodeType === 1) {
        const tag = child.tagName.toUpperCase(); // Ensure tag is uppercase
        // Plugin renderer override
        if (this.renderers[tag]) {
          this.renderers[tag](child, styleState, this);
          return;
        }
        if (tag==='H1') {
          console.log('PDFExporter H1 content:', child.textContent.trim()); // Diagnostic log
          this._drawStyledText(child.textContent.trim(), { fontKey:'H', size:this.fontSizes.h1, color:styleState.color, indent:styleState.indent });
        } else if (tag==='H2') {
          console.log('PDFExporter H2 content:', child.textContent.trim()); // Diagnostic log
          this._drawStyledText(child.textContent.trim(), { fontKey:'B', size:this.fontSizes.h2, color:styleState.color, indent:styleState.indent });
        } else if (tag==='P') {
          this._drawStyledText(child.textContent.trim(), styleState);
        } else if (tag==='UL'||tag==='OL') {
          this._drawList(child, 0, styleState, tag==='OL');
        } else if (tag==='TABLE') {
          const td = this._prepareTable(child);
          this._measureTable(td, childStyleState); // Pass childStyleState for font size
          this._layoutTable(td, childStyleState); // Pass childStyleState for availableWidth
          this._renderTable(td, childStyleState); // Pass childStyleState for indent and font size
        } else if (tag === 'HR') {
          this._ensureSpace(1); 
          const hrY = this.cursorY - (styleState.size * 0.6); // Position rule in approx middle of current line space
          const x1 = this.margin;
          const x2 = this.pageWidth - this.margin;
          this._write(`${x1.toFixed(3)} ${hrY.toFixed(3)} m ${x2.toFixed(3)} ${hrY.toFixed(3)} l S\n`); // Stroke a line
          this.cursorY -= styleState.size * 1.2; // Advance cursor by one line height
        } else if (tag === 'BLOCKQUOTE') {
          const quoteStyle = { ...styleState, indent: (styleState.indent || 0) + (this.bulletIndent || 20) };
          this.cursorY -= (this.fontSizes.normal * 0.5); // Simulate a small top margin for the blockquote
          this._ensureSpace(1); // Ensure space before processing blockquote's content
          this._processBlock(child, quoteStyle); // 'child' is the BLOCKQUOTE element, process its children with new style
          this.cursorY -= (this.fontSizes.normal * 0.5); // Simulate a small bottom margin
        } else if (tag === 'IMG' || tag === 'CANVAS') {
          this._drawImage(child, styleState);
        } else {
          this._processBlock(child, styleState);
        }
      }
    });
    const yAfterContent = this.cursorY;

    // If height was auto and we drew background/border, we might need to redraw or adjust them here.
    // This is a complex part of a full box model. For now, background/border with auto height are limited.
    if (explicitHeight === 0 && (c.a > 0 || btw > 0 || brw > 0 || bbw > 0 || blw > 0)) {
        const calculatedHeight = yBeforeContent - yAfterContent; // Height of the content drawn
        if (calculatedHeight > 0) {
            // Redraw background if it was auto-height and content was drawn
            if (c.a > 0) {
                const x = this.margin + parentIndent;
                const y = yAfterContent - pb;
                const width = currentBlockContentWidth + pl + pr; // Use current block's content width + padding
                const bgHeight = calculatedHeight + pt + pb; 

                this._write(`${c.r.toFixed(3)} ${c.g.toFixed(3)} ${c.b.toFixed(3)} rg\n`);
                this._write(`${x.toFixed(3)} ${y.toFixed(3)} ${width.toFixed(3)} ${bgHeight.toFixed(3)} re f\n`);
                this._write('0 0 0 rg\n');
            }
            // Redraw border (simplified)
            if (btw > 0 || brw > 0 || bbw > 0 || blw > 0) {
                const borderProps = {btw, brw, bbw, blw};
                const borderColors = {btc, brc, bbc, blc};
                const borderStyles = {bts, brs, bbs, bls};
                const hasAnyBorder = Object.values(borderProps).some(width => width > 0);

                if (hasAnyBorder) {
                    const x = this.margin + parentIndent;
                    const y = yAfterContent - pb;
                    const w = currentBlockContentWidth + pl + pr;
                    const h = calculatedHeight + pt + pb;
                    this._drawBorders(x, y, w, h, borderProps, borderColors, borderStyles);
                }
            }
        }
    }

    this.cursorY -= pb; // Apply padding bottom
    const mb = PDFExporter._parseCssLength(cs.marginBottom, baseFontSize);
    this.cursorY -= mb;
    this._ensureSpace(0); // Check for new page after margin bottom
  }

  _drawBorders(x, y, w, h, widths, colors, styles) {
    // Helper to draw a single border line
    const drawLine = (x1, y1, x2, y2, lineWidth, color, style) => {
        if (lineWidth > 0 && color.a > 0) {
            this._write(`${color.r.toFixed(3)} ${color.g.toFixed(3)} ${color.b.toFixed(3)} RG\n`);
            this._write(`${lineWidth.toFixed(3)} w\n`);

            // Apply line dash pattern for styles like dashed or dotted
            if (style === 'dashed') {
                this._write(`[${(lineWidth * 3).toFixed(3)} ${(lineWidth * 2).toFixed(3)}] 0 d\n`); // Dash pattern: 3*width dash, 2*width gap
            } else if (style === 'dotted') {
                this._write(`[${lineWidth.toFixed(3)} ${lineWidth.toFixed(3)}] 0 d\n`);       // Dash pattern: 1*width dot, 1*width gap (results in square dots)
            } else {
                this._write('[] 0 d\n'); // Solid line (empty dash array)
            }

            this._write(`${x1.toFixed(3)} ${y1.toFixed(3)} m ${x2.toFixed(3)} ${y2.toFixed(3)} l S\n`);
            this._write('[] 0 d\n'); // Reset dash pattern to solid for subsequent drawings
        }
    };

    // PDF coordinate system: y increases upwards. h is height. x,y is bottom-left typically for rects.
    // Top border
    drawLine(x + widths.blw / 2, y + h - widths.btw / 2, x + w - widths.brw / 2, y + h - widths.btw / 2, widths.btw, colors.btc, styles.bts);

    // Right border
    drawLine(x + w - widths.brw / 2, y + widths.bbw / 2, x + w - widths.brw / 2, y + h - widths.btw / 2, widths.brw, colors.brc, styles.brs);

    // Bottom border
    drawLine(x + widths.blw / 2, y + widths.bbw / 2, x + w - widths.brw / 2, y + widths.bbw / 2, widths.bbw, colors.bbc, styles.bbs);

    // Left border
    drawLine(x + widths.blw / 2, y + widths.bbw / 2, x + widths.blw / 2, y + h - widths.btw / 2, widths.blw, colors.blc, styles.bls);

    // Reset to default stroke color and line width (dash pattern is reset in drawLine)
    this._write('0 0 0 RG\n1 w\n');
  }

  // Placeholder for image preprocessing - will be implemented in a subsequent step
  async _loadAndPreprocessImages(elements) {
    // This method will find all <img> tags, load their data (handling async operations),
    // standardize them (e.g., via canvas), and store results in this.imageDataCache.
    const imagePromises = [];
    elements.forEach(element => {
      element.querySelectorAll('img').forEach(img => {
        const promise = (async () => {
          let src = img.getAttribute('src'); // Define src here to be available in catch
          try {
            if (!src) return;

            let response;
            let imageBitmap;
            let type = 'image/jpeg'; // Default type

            if (src.startsWith('data:')) {
              response = await fetch(src);
              const MimeTypeMatch = src.match(/^data:(image\/[a-z]+);base64,/);
              if (MimeTypeMatch) type = MimeTypeMatch[1];
              imageBitmap = await createImageBitmap(await response.blob());
            } else {
              response = await fetch(src);
              if (!response.ok) {
                console.error(`Failed to fetch image: ${src}`, response.statusText);
                return;
              }
              const blob = await response.blob();
              type = blob.type;
              imageBitmap = await createImageBitmap(blob);
            }

            if (!imageBitmap) return;

            // Use a canvas to convert to a data URL (PNG for transparency, JPEG otherwise)
            // This standardizes the format and makes embedding easier.
            const canvas = document.createElement('canvas');
            canvas.width = imageBitmap.width;
            canvas.height = imageBitmap.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imageBitmap, 0, 0);
            
            // Prefer PNG if original type suggests transparency, or if it's not JPEG. Otherwise, JPEG.
            const outputType = (type === 'image/png' || type === 'image/gif' || type === 'image/svg+xml') ? 'image/png' : 'image/jpeg';
            const dataUrl = canvas.toDataURL(outputType, outputType === 'image/jpeg' ? 0.85 : undefined);

            this.imageDataCache.set(img, {
              dataUrl,
              type: outputType, // Store the type of the dataUrl (image/jpeg or image/png)
              width: imageBitmap.width,
              height: imageBitmap.height
            });
          } catch (error) {
            console.error('Error processing image:', src, error);
            this.imageDataCache.set(img, { error: true }); // Mark as errored
          }
        })();
        imagePromises.push(promise);
      });

      // Handle <canvas> elements
      element.querySelectorAll('canvas').forEach(canvasEl => {
        const promise = (async () => {
          try {
            if (canvasEl.width === 0 || canvasEl.height === 0) {
                console.warn("Canvas element has zero width or height, skipping.", canvasEl);
                return;
            }
            const dataUrl = canvasEl.toDataURL('image/png'); // Default to PNG for transparency
            this.imageDataCache.set(canvasEl, {
              dataUrl,
              type: 'image/png',
              width: canvasEl.width,
              height: canvasEl.height
            });
          } catch (error) {
            console.error('Error processing canvas:', canvasEl, error);
            this.imageDataCache.set(canvasEl, { error: true }); // Mark as errored
          }
        })();
        imagePromises.push(promise);
      });
    });

    await Promise.all(imagePromises);
  }

  _drawImage(imgElement, styleState) {
    const imageData = this.imageDataCache.get(imgElement);
    if (!imageData || imageData.error) {
      // Optionally render alt text or a placeholder if image failed to load
      const altText = imgElement.getAttribute('alt');
      if (altText) {
        this._drawStyledText(`[Image: ${altText}]`, styleState);
      }
      return;
    }

    const cs = this._getStyle(imgElement);
    let imgWidth = PDFExporter._parseCssLength(cs.width, styleState.size) || imageData.width;
    let imgHeight = PDFExporter._parseCssLength(cs.height, styleState.size) || imageData.height;
    const aspectRatio = imageData.width / imageData.height;

    if (cs.width && !cs.height) {
      imgHeight = imgWidth / aspectRatio;
    } else if (!cs.width && cs.height) {
      imgWidth = imgHeight * aspectRatio;
    } else if (!cs.width && !cs.height) {
      // No CSS dimensions, use natural image dimensions but cap at page width
      const maxWidth = this.pageWidth - 2 * this.margin - (styleState.indent || 0);
      if (imgWidth > maxWidth) {
        imgWidth = maxWidth;
        imgHeight = imgWidth / aspectRatio;
      }
    } // If both cs.width and cs.height are set, they are used as is.

    this._ensureSpace(imgHeight / this.leading); // Approximate lines needed
    if (this.cursorY < imgHeight + this.margin) {
        this._newPage();
    }

    // For PDF, image data is typically base64 decoded if it was a data URL.
    // The `dataUrl` from canvas is already base64 encoded (e.g. "data:image/jpeg;base64,ABCD...").
    const base64Data = imageData.dataUrl.substring(imageData.dataUrl.indexOf(',') + 1);

    let imageObjId;
    // For JPEG, we can embed directly. For PNG, we need to handle it differently (alpha channel etc.)
    // Simplified: For this step, we assume DCTDecode for JPEG like data.
    // A robust solution would properly handle PNG (e.g. with FlateDecode and SMask for transparency).
    if (imageData.type === 'image/jpeg') {
        imageObjId = this._addObject(
        `<< /Type /XObject /Subtype /Image /Width ${imageData.width} /Height ${imageData.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${base64Data.length} >> stream\n` +
        base64Data + '\nendstream'
        );
    } else if (imageData.type === 'image/png') {
        // Basic PNG embedding - this is simplified and won't handle all PNG features (like true alpha masks correctly in all viewers)
        // For full PNG support, FlateDecode, predictor, and potentially an SMask for alpha are needed.
        // This example will embed it like a JPEG for now, which might lose transparency.
        // A proper PNG implementation is a large task.
        console.warn("Simplified PNG embedding. Transparency might be lost or rendered incorrectly.");
        imageObjId = this._addObject(
            `<< /Type /XObject /Subtype /Image /Width ${imageData.width} /Height ${imageData.height} ` +
            `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${base64Data.length} >> stream\n` +
            base64Data + '\nendstream'
        );
        // TODO: Implement proper PNG embedding with FlateDecode and SMask for alpha channel.
    } else {
        console.error("Unsupported image type for PDF embedding:", imageData.type);
        return;
    }

    const currentPage = this.pages[this.pages.length - 1];
    currentPage.currentPageImageCounter = (currentPage.currentPageImageCounter || 0) + 1;
    const imgResourceName = `Im${currentPage.currentPageImageCounter}`;
    currentPage.imageResourceMap[imgResourceName] = imageObjId;

    // Drawing the image
    const x = this.margin + (styleState.indent || 0);
    const y = this.cursorY - imgHeight;
    this._write('q\n'); // Save graphics state
    this._write(`${imgWidth.toFixed(3)} 0 0 ${imgHeight.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm\n`); // Concat matrix: scale and translate
    this._write(`/${imgResourceName} Do\n`); // Draw the image XObject
    this._write('Q\n'); // Restore graphics state

    this.cursorY -= imgHeight;
    // Add a small margin after the image
    this.cursorY -= this.leading * 0.2;
  }

  save(filename) {
    // Finalize streams for each page
    // Each page in a PDF has one or more content streams. These streams contain
    // the actual drawing commands (text, lines, colors, etc.) for that page.
    // Here, we're taking all the commands accumulated for each page and formatting
    // them into the PDF stream syntax, including calculating their length.
    this.pages.forEach(function(p) {
      const content = this.streams[p.cid].join('');
      const stream = '<< /Length ' + content.length + ' >> stream\n' + content + '\nendstream\n';
      this.objects[p.cid - 1] = stream;

      // If there are image resources for this page, update the resource object
      if (Object.keys(p.imageResourceMap).length > 0) {
        let xobjectEntries = '';
        for (const imgName in p.imageResourceMap) {
          xobjectEntries += `/${imgName} ${p.imageResourceMap[imgName]} 0 R `;
        }
        const currentResourceObjContent = this.objects[p.resId - 1];
        const fontMatch = currentResourceObjContent.match(/\/Font\s*(<<.*?>>)/);
        const fontResourcesString = fontMatch ? fontMatch[1] : '<< >>';
        
        this.objects[p.resId - 1] = `<< /Font ${fontResourcesString} /XObject << ${xobjectEntries.trim()} >> >>`;
      }

      // Add annotations to the page object if any
      if (p.annotations && p.annotations.length > 0) {
        const annotsRefs = p.annotations.map(id => `${id} 0 R`).join(' ');
        let pageObjStr = this.objects[p.pid - 1];
        // Insert /Annots before the final >> of the page dictionary.
        // Regex matches optional whitespace then >> at the end of the string.
        pageObjStr = pageObjStr.replace(/(\s*>>)$/, ` /Annots [${annotsRefs}] $1`);
        this.objects[p.pid - 1] = pageObjStr;
      }
    }, this);

    // Pages tree (/Type /Pages)
    // This is a dictionary object that acts as the root of the page tree.
    // It contains a count of all pages and an array (/Kids) of indirect references
    // to each individual Page object.
    const kids = this.pages.map(p => p.pid + ' 0 R').join(' ');
    const pagesObj = this._addObject('<< /Type /Pages /Count ' + this.pages.length + ' /Kids [' + kids + '] >>');

    // Update parent references in each Page object (/Type /Page)
    // Each Page object needs to point back to the Pages tree object as its /Parent.
    // We initially put '0 0 R' as a placeholder; now we replace it.
    this.objects = this.objects.map(obj => obj.replace('/Parent 0 0 R', '/Parent ' + pagesObj + ' 0 R'));

    // Catalog object (/Type /Catalog)
    // This is the root object of the PDF file. It primarily points to the Pages tree object,
    // telling the PDF reader where to find the pages.
    const catalog = this._addObject('<< /Type /Catalog /Pages ' + pagesObj + ' 0 R >>');

    // Build PDF
    // Start with the PDF header, indicating the version.
    let out = '%PDF-1.3\n';
    // Append each PDF object (streams, fonts, pages, catalog, etc.) sequentially.
    // Each object is numbered (e.g., "1 0 obj ... endobj").
    // We also record the byte offset of each object's start, for the XRef table.
    this.objects.forEach((obj, i) => {
      this.offsets[i] = out.length;
      out += (i+1) + ' 0 obj\n' + obj + 'endobj\n';
    });

    // Cross-reference table (XRef)
    // This table lists the byte offset of each indirect object in the file.
    // It allows random access to objects, which is essential for PDF readers.
    // It starts with "xref", then the range of object numbers (0 to N),
    // and then entries for each object: offset (10 digits), generation number (5 digits), and 'n' (in-use) or 'f' (free).
    // Object 0 is special and always has offset 0, generation 65535, and 'f'.
    const xref = out.length;
    out += 'xref\n0 ' + (this.objects.length+1) + '\n';
    out += '0000000000 65535 f \n';
    this.offsets.forEach(o => {
      out += ('0000000000' + o).slice(-10) + ' 00000 n \n';
    });

    // Trailer
    // This is found at the end of the PDF. It tells the reader:
    // - /Size: Total number of objects in the XRef table.
    // - /Root: An indirect reference to the Catalog object (the document's root).
    // It also gives the byte offset of the 'xref' keyword (startxref).
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

  static async init(opts = {}) { // init is now async
    const pdf = new PDFExporter(opts);
    const rootElements = Array.from(document.querySelectorAll(opts.selector));
    
    // Preprocess images before starting PDF generation
    await pdf._loadAndPreprocessImages(rootElements);

    pdf._newPage();
    const defaultStyle = { fontKey:'N', size:pdf.fontSizes.normal, color:{r:0,g:0,b:0}, indent:0 };
    rootElements.forEach(root => {
      pdf._processBlock(root, defaultStyle);
    });
    pdf.save(opts.filename);
  }

  _escapePDFString(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  _addLinkAnnotation(rect, uri) {
    if (!uri) return;
    const annotObj = (
      `<< /Type /Annot /Subtype /Link ` +
      `/Rect [${rect[0].toFixed(3)} ${rect[1].toFixed(3)} ${rect[2].toFixed(3)} ${rect[3].toFixed(3)}] ` +
      `/Border [0 0 0] ` +
      `/A << /S /URI /URI (${this._escapePDFString(uri)}) >> >>`
    );
    const annotObjId = this._addObject(annotObj);
    const currentPage = this.pages[this.pages.length - 1];
    if (currentPage) {
      currentPage.annotations.push(annotObjId);
    }
  }

  _getOrdinal(index, listStyleType = 'decimal') {
    const num = index + 1;
    switch (listStyleType) {
        case 'lower-alpha':
        case 'lower-latin':
            let alpha = '';
            let tempNum = num;
            while (tempNum > 0) {
                tempNum--; // 1-indexed to 0-indexed for char code
                alpha = String.fromCharCode(97 + (tempNum % 26)) + alpha;
                tempNum = Math.floor(tempNum / 26);
            }
            return alpha + '. ';
        case 'upper-alpha':
        case 'upper-latin':
            let upperAlpha = '';
            let tempUpperNum = num;
            while (tempUpperNum > 0) {
                tempUpperNum--;
                upperAlpha = String.fromCharCode(65 + (tempUpperNum % 26)) + upperAlpha;
                tempUpperNum = Math.floor(tempUpperNum / 26);
            }
            return upperAlpha + '. ';
        case 'lower-roman':
            return this._toRoman(num).toLowerCase() + '. ';
        case 'upper-roman':
            return this._toRoman(num) + '. ';
        case 'decimal':
        default:
            return num + '. ';
    }
  }

  _toRoman(num) {
    if (isNaN(num) || num < 1 || num > 3999) return String(num); // Fallback for out of typical Roman range
    const roman = {
        M: 1000, CM: 900, D: 500, CD: 400, C: 100, XC: 90, L: 50, XL: 40, X: 10, IX: 9, V: 5, IV: 4, I: 1
    };
    let str = '';
    for (let i of Object.keys(roman)) {
        let q = Math.floor(num / roman[i]);
        num -= q * roman[i];
        str += i.repeat(q);
    }
    return str;
  }
}

// Expose globally
window.PDFExporter = PDFExporter;