// pdf-exporter.js
// Single-file, zero-dependency HTML → PDF with CSS box-model, styled inline, nested lists, and multi-page tables
// Enhanced with comprehensive error handling, validation, and robustness features

class PDFExporter {
  constructor(opts = {}) {
    try {
      // Validate constructor options
      this._validateOptions(opts);
      
      this.objects = [];
      this.offsets = [];
      this.pages = [];
      this.streams = {};
      this.imageDataCache = new WeakMap(); // For storing preprocessed image data
      this.errors = []; // Track non-fatal errors
      this.warnings = []; // Track warnings
      
      // Page size & orientation presets
      const _sizes = {
        A4: [595.28, 841.89],
        Letter: [612, 792],
        Legal: [612, 1008],
        A3: [841.89, 1190.55],
        A5: [419.53, 595.28],
        Tabloid: [792, 1224]
      };
      
      let [pw, ph] = opts.pageSize && _sizes[opts.pageSize]
        ? _sizes[opts.pageSize]
        : [this._validateNumber(opts.pageWidth, 595.28, 'pageWidth'), 
           this._validateNumber(opts.pageHeight, 841.89, 'pageHeight')];
      
      if (opts.landscape) [pw, ph] = [ph, pw];
      this.pageWidth = pw;
      this.pageHeight = ph;
      this.margin = this._validateNumber(opts.margin, 40, 'margin');
      
      this.fontSizes = {
        h1: this._validateNumber(opts.h1FontSize, 24, 'h1FontSize'),
        h2: this._validateNumber(opts.h2FontSize, 18, 'h2FontSize'),
        h3: this._validateNumber(opts.h3FontSize, 16, 'h3FontSize'),
        h4: this._validateNumber(opts.h4FontSize, 14, 'h4FontSize'),
        h5: this._validateNumber(opts.h5FontSize, 12, 'h5FontSize'),
        h6: this._validateNumber(opts.h6FontSize, 11, 'h6FontSize'),
        normal: this._validateNumber(opts.fontSize, 12, 'fontSize')
      };
      
      this.leading = this.fontSizes.normal * 1.2;
      this.bulletIndent = this._validateNumber(opts.bulletIndent, 20, 'bulletIndent');
      this.tableCellPadding = this._validateNumber(opts.tableCellPadding, 5, 'tableCellPadding');
      
      // Custom list bullet settings with validation
      this.ulBulletSymbols = Array.isArray(opts.ulBulletSymbols) && opts.ulBulletSymbols.length
        ? opts.ulBulletSymbols.map(s => String(s))
        : ['- '];
      this.olBulletFormat = typeof opts.olBulletFormat === 'function'
        ? opts.olBulletFormat
        : ((idx, level) => `${idx+1}. `);

      // Built-in fonts with error handling
      try {
        this.fH = this._addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
        this.fB = this._addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
        this.fI = this._addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>');
        this.fN = this._addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
        this.fM = this._addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>'); // Monospace font
      } catch (error) {
        this._handleError('Font initialization failed', error);
        throw new Error('Critical error: Cannot initialize PDF fonts');
      }
      
      // Canvas for text measurement with fallback
      this.ctx = null;
      this._lastFontSpec = null;
      try { 
        const c = document.createElement('canvas'); 
        this.ctx = c.getContext('2d');
        if (!this.ctx) {
          this._addWarning('Canvas context not available, using fallback text measurement');
        }
      } catch(e) { 
        this._addWarning('Canvas not available, using fallback text measurement');
      }
      
      this.fontFamily = this._validateString(opts.fontFamily, 'Helvetica', 'fontFamily');
      this.styleCache = new WeakMap();
      this.maxCacheSize = this._validateNumber(opts.maxCacheSize, 1000, 'maxCacheSize');
      this.cacheSize = 0;
      
      // Hook called after each new page is created: (pdfInstance, pageIndex)
      this.onPage = typeof opts.onPage === 'function' ? opts.onPage : null;
      this.onError = typeof opts.onError === 'function' ? opts.onError : null;
      this.onWarning = typeof opts.onWarning === 'function' ? opts.onWarning : null;
      this.onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
      
      // Custom element renderers: {TAGNAME: (node, styleState, pdf) => {}} 
      this.renderers = opts.renderers && typeof opts.renderers === 'object' ? opts.renderers : {};
      
      // Debug mode
      this.debug = Boolean(opts.debug);
      
      // Performance tracking
      this.startTime = Date.now();
      this.processedElements = 0;
      
    } catch (error) {
      this._handleError('PDFExporter constructor failed', error);
      throw error;
    }
  }

  // Validation helper methods
  _validateOptions(opts) {
    if (opts && typeof opts !== 'object') {
      throw new Error('Options must be an object');
    }
    
    // Validate page dimensions
    if (opts.pageWidth && (typeof opts.pageWidth !== 'number' || opts.pageWidth <= 0)) {
      throw new Error('pageWidth must be a positive number');
    }
    if (opts.pageHeight && (typeof opts.pageHeight !== 'number' || opts.pageHeight <= 0)) {
      throw new Error('pageHeight must be a positive number');
    }
    
    // Validate margins
    if (opts.margin && (typeof opts.margin !== 'number' || opts.margin < 0)) {
      throw new Error('margin must be a non-negative number');
    }
  }

  _validateNumber(value, defaultValue, fieldName) {
    if (value === undefined || value === null) return defaultValue;
    if (typeof value !== 'number' || isNaN(value) || value < 0) {
      this._addWarning(`Invalid ${fieldName}: ${value}, using default: ${defaultValue}`);
      return defaultValue;
    }
    return value;
  }

  _validateString(value, defaultValue, fieldName) {
    if (value === undefined || value === null) return defaultValue;
    if (typeof value !== 'string') {
      this._addWarning(`Invalid ${fieldName}: ${value}, using default: ${defaultValue}`);
      return defaultValue;
    }
    return value;
  }

  _handleError(message, error) {
    const errorInfo = {
      message,
      error: error?.message || error,
      timestamp: new Date().toISOString(),
      stack: error?.stack
    };
    
    this.errors.push(errorInfo);
    
    if (this.debug) {
      console.error('PDFExporter Error:', errorInfo);
    }
    
    if (this.onError) {
      try {
        this.onError(errorInfo);
      } catch (e) {
        console.error('Error in onError callback:', e);
      }
    }
  }

  _addWarning(message) {
    const warningInfo = {
      message,
      timestamp: new Date().toISOString()
    };
    
    this.warnings.push(warningInfo);
    
    if (this.debug) {
      console.warn('PDFExporter Warning:', warningInfo);
    }
    
    if (this.onWarning) {
      try {
        this.onWarning(warningInfo);
      } catch (e) {
        console.error('Error in onWarning callback:', e);
      }
    }
  }

  _reportProgress(phase, current, total) {
    if (this.onProgress) {
      try {
        this.onProgress({
          phase,
          current,
          total,
          percentage: total > 0 ? Math.round((current / total) * 100) : 0,
          elementsProcessed: this.processedElements,
          elapsedTime: Date.now() - this.startTime
        });
      } catch (e) {
        console.error('Error in onProgress callback:', e);
      }
    }
  }

  _addObject(content) {
    this.objects.push(content);
    return this.objects.length;
  }

  _newPage() {
    try {
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
      
      // Draw custom header/footer if defined
      this._drawCustomHeaderFooter();
      
      // Invoke onPage hook for custom header/footer drawing
      if (this.onPage) {
        try {
          this.onPage(this, this.pages.length);
        } catch (error) {
          this._handleError('onPage callback failed', error);
        }
      }
    } catch (error) {
      this._handleError('New page creation failed', error);
      throw error; // This is critical, so re-throw
    }
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
    try {
      if (this.ctx) {
        // Only reset canvas font if it changed
        const spec = `${size}px ${this.fontFamily}`;
        if (this._lastFontSpec !== spec) {
          this.ctx.font = spec;
          this._lastFontSpec = spec;
        }
        const metrics = this.ctx.measureText(text);
        return metrics.width;
      }
      // Fallback calculation with better accuracy
      return this._fallbackTextWidth(text, size);
    } catch (error) {
      this._handleError('Text width measurement failed', error);
      return this._fallbackTextWidth(text, size);
    }
  }

  _fallbackTextWidth(text, size) {
    // More accurate fallback based on character analysis
    let width = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const code = char.charCodeAt(0);
      
      // Different character widths based on type
      if (code >= 32 && code <= 126) { // ASCII printable
        if ('iIl1'.includes(char)) width += size * 0.3; // Narrow chars
        else if ('mMwW'.includes(char)) width += size * 0.8; // Wide chars
        else if ('fijrt'.includes(char)) width += size * 0.4; // Medium-narrow
        else width += size * 0.6; // Average width
      } else if (code >= 0x4E00 && code <= 0x9FFF) { // CJK
        width += size * 1.0; // Full-width
      } else if (code >= 0x0600 && code <= 0x06FF) { // Arabic
        width += size * 0.5; // Variable width
      } else {
        width += size * 0.6; // Default
      }
    }
    return width;
  }

  // Enhanced CSS color parsing with more formats and better error handling
  static _parseCssColor(cssColor) {
    if (!cssColor || cssColor === 'transparent') {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    
    try {
      // Normalize the color string
      cssColor = cssColor.trim().toLowerCase();
      
      // Named colors support
      const namedColors = {
        'black': '#000000', 'white': '#ffffff', 'red': '#ff0000', 'green': '#008000',
        'blue': '#0000ff', 'yellow': '#ffff00', 'cyan': '#00ffff', 'magenta': '#ff00ff',
        'silver': '#c0c0c0', 'gray': '#808080', 'maroon': '#800000', 'olive': '#808000',
        'lime': '#00ff00', 'aqua': '#00ffff', 'teal': '#008080', 'navy': '#000080',
        'fuchsia': '#ff00ff', 'purple': '#800080', 'orange': '#ffa500', 'pink': '#ffc0cb'
      };
      
      if (namedColors[cssColor]) {
        cssColor = namedColors[cssColor];
      }
      
      // Parse rgb/rgba with optional alpha
      let m = cssColor.match(/rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*([01]?\.?\d*))?\s*\)/);
      if (m) {
        return {
          r: Math.min(255, Math.max(0, parseFloat(m[1]))) / 255,
          g: Math.min(255, Math.max(0, parseFloat(m[2]))) / 255,
          b: Math.min(255, Math.max(0, parseFloat(m[3]))) / 255,
          a: m[4] !== undefined ? Math.min(1, Math.max(0, parseFloat(m[4]))) : 1
        };
      }
      
      // Parse rgb/rgba with percentages
      m = cssColor.match(/rgba?\(\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%\s*(?:,\s*([01]?\.?\d*))?\s*\)/);
      if (m) {
        return {
          r: Math.min(100, Math.max(0, parseFloat(m[1]))) / 100,
          g: Math.min(100, Math.max(0, parseFloat(m[2]))) / 100,
          b: Math.min(100, Math.max(0, parseFloat(m[3]))) / 100,
          a: m[4] !== undefined ? Math.min(1, Math.max(0, parseFloat(m[4]))) : 1
        };
      }
      
      // Parse #rrggbb
      m = cssColor.match(/^#([0-9a-f]{6})$/);
      if (m) {
        const hex = parseInt(m[1], 16);
        return {
          r: ((hex >> 16) & 0xFF) / 255,
          g: ((hex >> 8) & 0xFF) / 255,
          b: (hex & 0xFF) / 255,
          a: 1
        };
      }
      
      // Parse #rgb (3-digit hex)
      m = cssColor.match(/^#([0-9a-f]{3})$/);
      if (m) {
        const h = m[1];
        return {
          r: parseInt(h[0] + h[0], 16) / 255,
          g: parseInt(h[1] + h[1], 16) / 255,
          b: parseInt(h[2] + h[2], 16) / 255,
          a: 1
        };
      }
      
      // Parse hsl and hsla
      m = cssColor.match(/^hsla?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%\s*(?:,\s*([01]?\.\d+)\s*)?\)$/);
      if (m) {
        const h = parseFloat(m[1]) % 360;
        const s = Math.min(100, Math.max(0, parseFloat(m[2]))) / 100;
        const l = Math.min(100, Math.max(0, parseFloat(m[3]))) / 100;
        const a = m[4] !== undefined ? Math.min(1, Math.max(0, parseFloat(m[4]))) : 1;
        
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
      
      // If no match found, return transparent
      return { r: 0, g: 0, b: 0, a: 0 };
      
    } catch (error) {
      console.warn('Failed to parse CSS color:', cssColor, error);
      return { r: 0, g: 0, b: 0, a: 0 };
    }
  }

  // Enhanced CSS length parsing with more units and calc() support
  static _parseCssLength(cssValue, baseFontSize = 12, containerSize = 0) {
    if (!cssValue || cssValue === 'auto' || cssValue === 'inherit') return 0;
    
    try {
      // Handle calc() expressions (basic support)
      if (cssValue.includes('calc(')) {
        return PDFExporter._parseCalcExpression(cssValue, baseFontSize, containerSize);
      }
      
      const m = cssValue.match(/^([-+]?[\d.]+)(px|pt|em|rem|ex|ch|vw|vh|vmin|vmax|%|in|cm|mm|pc)?$/);
      if (m) {
        const value = parseFloat(m[1]);
        const unit = m[2] || 'px';
        
        switch (unit) {
          case 'px': return value;
          case 'pt': return value * (96/72); // convert pt to px
          case 'em': return value * baseFontSize;
          case 'rem': return value * 16; // Assume 16px root font size
          case 'ex': return value * baseFontSize * 0.5; // Approximate x-height
          case 'ch': return value * baseFontSize * 0.6; // Approximate character width
          case 'vw': return value * (containerSize || 595.28) / 100; // Viewport width
          case 'vh': return value * (containerSize || 841.89) / 100; // Viewport height
          case 'vmin': return value * Math.min(595.28, 841.89) / 100;
          case 'vmax': return value * Math.max(595.28, 841.89) / 100;
          case '%': return value * (containerSize || 0) / 100;
          case 'in': return value * 96; // 96 DPI
          case 'cm': return value * 96 / 2.54;
          case 'mm': return value * 96 / 25.4;
          case 'pc': return value * 96 / 6; // 1 pica = 1/6 inch
          default: return value;
        }
      }
      
      return parseFloat(cssValue) || 0;
    } catch (error) {
      console.warn('Failed to parse CSS length:', cssValue, error);
      return 0;
    }
  }

  // Basic calc() expression parser
  static _parseCalcExpression(calcStr, baseFontSize, containerSize) {
    try {
      // Remove calc() wrapper and normalize
      let expr = calcStr.replace(/calc\s*\(\s*/, '').replace(/\s*\)$/, '');
      
      // Simple expression evaluation (supports +, -, *, /)
      // This is a basic implementation - a full calc() parser would be much more complex
      const tokens = expr.split(/(\+|\-|\*|\/)/).map(t => t.trim());
      
      let result = 0;
      let operator = '+';
      
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        
        if (['+', '-', '*', '/'].includes(token)) {
          operator = token;
        } else {
          const value = PDFExporter._parseCssLength(token, baseFontSize, containerSize);
          
          switch (operator) {
            case '+': result += value; break;
            case '-': result -= value; break;
            case '*': result *= value; break;
            case '/': result = value !== 0 ? result / value : result; break;
            default: result = value;
          }
        }
      }
      
      return result;
    } catch (error) {
      console.warn('Failed to parse calc() expression:', calcStr, error);
      return 0;
    }
  }

  // Enhanced CSS property parsing with more properties
  _parseAdvancedCssProperties(cs, baseFontSize) {
    const props = {};
    
    try {
      // Box model properties
      props.boxSizing = cs.boxSizing || 'content-box';
      
      // Display and positioning
      props.display = cs.display || 'block';
      props.position = cs.position || 'static';
      props.float = cs.float || 'none';
      props.clear = cs.clear || 'none';
      
      // Flexbox properties
      props.flexDirection = cs.flexDirection || 'row';
      props.justifyContent = cs.justifyContent || 'flex-start';
      props.alignItems = cs.alignItems || 'stretch';
      props.flexWrap = cs.flexWrap || 'nowrap';
      
      // Text properties
      props.textDecoration = cs.textDecoration || 'none';
      props.textTransform = cs.textTransform || 'none';
      props.letterSpacing = PDFExporter._parseCssLength(cs.letterSpacing, baseFontSize);
      props.wordSpacing = PDFExporter._parseCssLength(cs.wordSpacing, baseFontSize);
      props.lineHeight = cs.lineHeight === 'normal' ? baseFontSize * 1.2 : 
                        PDFExporter._parseCssLength(cs.lineHeight, baseFontSize);
      
      // Visual effects
      props.opacity = parseFloat(cs.opacity) || 1;
      props.visibility = cs.visibility || 'visible';
      props.overflow = cs.overflow || 'visible';
      props.textOverflow = cs.textOverflow || 'clip';
      props.whiteSpace = cs.whiteSpace || 'normal';
      props.wordBreak = cs.wordBreak || 'normal';
      
      // Shadow properties (basic parsing)
      props.boxShadow = this._parseBoxShadow(cs.boxShadow);
      props.textShadow = this._parseTextShadow(cs.textShadow);
      
      return props;
    } catch (error) {
      this._handleError('Advanced CSS property parsing failed', error);
      return {};
    }
  }

  _parseBoxShadow(shadowStr) {
    if (!shadowStr || shadowStr === 'none') return null;
    
    try {
      // Basic box-shadow parsing: offset-x offset-y blur-radius spread-radius color
      const parts = shadowStr.split(/\s+/);
      if (parts.length >= 2) {
        return {
          offsetX: parseFloat(parts[0]) || 0,
          offsetY: parseFloat(parts[1]) || 0,
          blurRadius: parseFloat(parts[2]) || 0,
          spreadRadius: parseFloat(parts[3]) || 0,
          color: parts.length > 4 ? parts.slice(4).join(' ') : 'rgba(0,0,0,0.5)'
        };
      }
    } catch (error) {
      this._handleError('Box shadow parsing failed', error);
    }
    
    return null;
  }

  _parseTextShadow(shadowStr) {
    if (!shadowStr || shadowStr === 'none') return null;
    
    try {
      // Basic text-shadow parsing: offset-x offset-y blur-radius color
      const parts = shadowStr.split(/\s+/);
      if (parts.length >= 2) {
        return {
          offsetX: parseFloat(parts[0]) || 0,
          offsetY: parseFloat(parts[1]) || 0,
          blurRadius: parseFloat(parts[2]) || 0,
          color: parts.length > 3 ? parts.slice(3).join(' ') : 'rgba(0,0,0,0.5)'
        };
      }
    } catch (error) {
      this._handleError('Text shadow parsing failed', error);
    }
    
    return null;
  }

  // Get and cache computed style for an element
  _getStyle(el) {
    try {
      // Check cache size and clean if necessary
      if (this.cacheSize > this.maxCacheSize) {
        this._cleanStyleCache();
      }
      
      let cs = this.styleCache.get(el);
      if (!cs) {
        cs = window.getComputedStyle(el);
        this.styleCache.set(el, cs);
        this.cacheSize++;
      }
      return cs;
    } catch (error) {
      this._handleError('Style computation failed', error);
      // Return a minimal style object as fallback
      return {
        display: 'block',
        color: 'black',
        fontSize: '12px',
        fontFamily: 'serif',
        textAlign: 'left',
        backgroundColor: 'transparent',
        marginTop: '0px',
        marginBottom: '0px',
        paddingTop: '0px',
        paddingBottom: '0px',
        paddingLeft: '0px',
        paddingRight: '0px'
      };
    }
  }

  _cleanStyleCache() {
    // Simple cache cleanup - in a real implementation, you might use LRU
    this.styleCache = new WeakMap();
    this.cacheSize = 0;
    this._addWarning('Style cache cleaned due to size limit');
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
      const txt = this._normalizeWhiteSpace(node.textContent);
      if (txt.length) this._drawStyledText(txt, styleState);
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
    try {
      const items = Array.from(listEl.children).filter(el => el.tagName === 'LI');
      const cs = this._getStyle(listEl);
      const listStyleType = cs.listStyleType || (isOrdered ? 'decimal' : 'disc');
      
      // Get precise measurements from HTML computed styles
      const listPaddingLeft = PDFExporter._parseCssLength(cs.paddingLeft, styleState.size);
      const listMarginLeft = PDFExporter._parseCssLength(cs.marginLeft, styleState.size);
      
      // Calculate precise indentation based on HTML styles
      // Default browser list indentation is typically 40px (padding-left)
      const baseIndent = listPaddingLeft || 40;
      const levelIndent = baseIndent * (level + 1);
      
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
              // Use custom bullet symbols per list level
              bulletText = this.ulBulletSymbols[level % this.ulBulletSymbols.length];
          }
        }

        const yPosBeforeItem = this.cursorY;
        
        // Get LI computed styles for precise positioning
        const liCs = this._getStyle(li);
        const liPaddingLeft = PDFExporter._parseCssLength(liCs.paddingLeft, styleState.size);
        const liMarginLeft = PDFExporter._parseCssLength(liCs.marginLeft, styleState.size);
        
        // Calculate bullet position - typically 16px from the left edge of the list
        const bulletIndentFromList = 16; // Standard browser bullet position
        const bulletX = this.margin + (styleState.indent || 0) + levelIndent - bulletIndentFromList;

        // Draw bullet text using _drawCell directly for precise control.
        if (bulletText) {
          this._drawCell(bulletText, styleState.fontKey, styleState.size, bulletX, yPosBeforeItem, styleState.color);
        }

        // Calculate indent for the actual list item content
        // Content starts at the list's padding-left position
        const contentIndent = (styleState.indent || 0) + levelIndent + liPaddingLeft;

        // Create style state for the LI's content.
        const itemContentStyle = { 
          ...styleState, 
          indent: contentIndent,
          availableWidth: (styleState.availableWidth || (this.pageWidth - 2 * this.margin)) - contentIndent
        };
        
        // Reset cursor Y for the content processing to align vertically with the bullet.
        this.cursorY = yPosBeforeItem;

        let contentWasProcessed = false;
        Array.from(li.childNodes).forEach(childNode => {
          // Skip child nodes that are themselves lists (they are handled separately below)
          // and skip purely whitespace text nodes for the purpose of the contentWasProcessed flag.
          if (childNode.nodeType === Node.ELEMENT_NODE && (childNode.tagName === 'UL' || childNode.tagName === 'OL')) {
            return;
          }
          if (childNode.nodeType === Node.TEXT_NODE && this._normalizeWhiteSpace(childNode.textContent).length === 0) {
            return;
          }
          
          this._processInline(childNode, itemContentStyle);
          // Check if _processInline actually drew something and moved the cursor.
          if (this.cursorY < yPosBeforeItem) {
              contentWasProcessed = true;
          }
        });

        // If no actual inline content was processed, we still need to account for the line height of the bullet.
        if (!contentWasProcessed) {
          this.cursorY = yPosBeforeItem - (styleState.size * 1.2); // Move cursor down for the bullet's line.
        }

        // Process nested lists that are direct children of this LI.
        Array.from(li.children).forEach(childLiElement => {
          if (['UL','OL'].includes(childLiElement.tagName)) {
            // Nested lists start at 'level+1'. Their indent is relative to page margin.
            this._drawList(childLiElement, level + 1, styleState, childLiElement.tagName === 'OL');
          }
        });
      });
    } catch (error) {
      this._handleError('List rendering failed', error);
    }
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
    try {
      const widths = Array(tableData.colCount).fill(0);
      
      // Measure headers with precise padding
      tableData.headers.forEach(row => row.forEach((cell, i) => {
        const cs = this._getStyle(cell);
        const paddingLeft = PDFExporter._parseCssLength(cs.paddingLeft, styleState.size) || 8;
        const paddingRight = PDFExporter._parseCssLength(cs.paddingRight, styleState.size) || 8;
        const totalPadding = paddingLeft + paddingRight;
        
        const textWidth = this._textWidth(cell.textContent.trim(), styleState.size);
        const cellWidth = textWidth + totalPadding;
        widths[i] = Math.max(widths[i], cellWidth);
      }));
      
      // Measure body cells with precise padding
      tableData.rows.forEach(row => row.forEach((cell, i) => {
        const cs = this._getStyle(cell);
        const paddingLeft = PDFExporter._parseCssLength(cs.paddingLeft, styleState.size) || 8;
        const paddingRight = PDFExporter._parseCssLength(cs.paddingRight, styleState.size) || 8;
        const totalPadding = paddingLeft + paddingRight;
        
        const textWidth = this._textWidth(cell.textContent.trim(), styleState.size);
        const cellWidth = textWidth + totalPadding;
        widths[i] = Math.max(widths[i], cellWidth);
      }));
      
      tableData.columnWidths = widths;
    } catch (error) {
      this._handleError('Table measurement failed', error);
      // Fallback to original method
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

    // Helper to wrap text within a cell with precise padding
    const wrapText = (text, maxW, cellEl) => {
      const cs = this._getStyle(cellEl);
      const paddingLeft = PDFExporter._parseCssLength(cs.paddingLeft, fontSize) || 8;
      const paddingRight = PDFExporter._parseCssLength(cs.paddingRight, fontSize) || 8;
      const availableWidth = maxW - paddingLeft - paddingRight;
      
      const words = text.split(' ');
      const lines = [];
      let current = '';
      words.forEach(word => {
        const test = current ? current + ' ' + word : word;
        if (this._textWidth(test, fontSize) > availableWidth && current) {
          lines.push(current);
          current = word;
        } else {
          current = test;
        }
      });
      if (current) lines.push(current);
      return lines;
    };

    // Precompute wrapped lines and row heights with precise padding
    const cellLines = allRows.map(({ cells }) =>
      cells.map((cell, ci) => wrapText(cell.textContent.trim(), widths[ci], cell))
    );
    
    const rowHeights = cellLines.map((linesArr, rowIndex) => {
      const { cells } = allRows[rowIndex];
      const maxLines = Math.max(...linesArr.map(lines => lines.length));
      
      // Get precise padding for height calculation
      let maxPaddingTop = 0;
      let maxPaddingBottom = 0;
      
      cells.forEach(cell => {
        const cs = this._getStyle(cell);
        const paddingTop = PDFExporter._parseCssLength(cs.paddingTop, fontSize) || 4;
        const paddingBottom = PDFExporter._parseCssLength(cs.paddingBottom, fontSize) || 4;
        maxPaddingTop = Math.max(maxPaddingTop, paddingTop);
        maxPaddingBottom = Math.max(maxPaddingBottom, paddingBottom);
      });
      
      return maxLines * lineHeight + maxPaddingTop + maxPaddingBottom;
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

      // Render each row with precise padding
      for (; rowCursor < end; rowCursor++) {
        const { cells, header } = allRows[rowCursor];
        const linesArr = cellLines[rowCursor];
        const height = rowHeights[rowCursor];
        
        accX = x0;

        cells.forEach((cellEl, ci) => {
          const cs = this._getStyle(cellEl);
          const align = cs.textAlign;
          const lines = linesArr[ci];
          const colW = widths[ci];
          
          // Get precise padding for this cell
          const paddingLeft = PDFExporter._parseCssLength(cs.paddingLeft, fontSize) || 8;
          const paddingTop = PDFExporter._parseCssLength(cs.paddingTop, fontSize) || 4;
          
          const yTextStart = this.cursorY - paddingTop - fontSize;
          
          lines.forEach((ln, li) => {
            const tw = this._textWidth(ln, fontSize);
            let x = accX + paddingLeft;
            
            if (align === 'center') {
              const availableWidth = colW - paddingLeft - (PDFExporter._parseCssLength(cs.paddingRight, fontSize) || 8);
              x = accX + paddingLeft + (availableWidth - tw) / 2;
            } else if (align === 'right') {
              const paddingRight = PDFExporter._parseCssLength(cs.paddingRight, fontSize) || 8;
              x = accX + colW - paddingRight - tw;
            }
            
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

    // Enhanced border detection - check for shorthand border properties
    let hasBorder = btw > 0 || brw > 0 || bbw > 0 || blw > 0;
    let finalBorderProps = {btw, brw, bbw, blw, btc, brc, bbc, blc, bts, brs, bbs, bls};
    
    // Check for shorthand border property if individual borders are not set
    if (!hasBorder && cs.border && cs.border !== 'none' && cs.border !== '0') {
      const borderParts = cs.border.split(/\s+/);
      if (borderParts.length >= 1) {
        const borderWidth = PDFExporter._parseCssLength(borderParts[0], baseFontSize);
        if (borderWidth > 0) {
          // Apply border to all sides
          const borderColor = borderParts.length > 2 ? PDFExporter._parseCssColor(borderParts[2]) : { r: 0, g: 0, b: 0, a: 1 };
          const borderStyle = borderParts.length > 1 ? borderParts[1] : 'solid';
          
          // Override individual border properties with shorthand values
          finalBorderProps = {
            btw: borderWidth, brw: borderWidth, bbw: borderWidth, blw: borderWidth,
            btc: borderColor, brc: borderColor, bbc: borderColor, blc: borderColor,
            bts: borderStyle, brs: borderStyle, bbs: borderStyle, bls: borderStyle
          };
          
          hasBorder = true;
        }
      }
    }

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
    if (explicitHeight > 0 && hasBorder) {
        const x = this.margin + parentIndent;
        const y = this.cursorY - pt - explicitHeight - pb;
        const w = currentBlockContentWidth + pl + pr;
        const h = explicitHeight + pt + pb;

        this._drawBorders(x, y, w, h, 
          {btw: finalBorderProps.btw, brw: finalBorderProps.brw, bbw: finalBorderProps.bbw, blw: finalBorderProps.blw}, 
          {btc: finalBorderProps.btc, brc: finalBorderProps.brc, bbc: finalBorderProps.bbc, blc: finalBorderProps.blc}, 
          {bts: finalBorderProps.bts, brs: finalBorderProps.brs, bbs: finalBorderProps.bbs, bls: finalBorderProps.bls});
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
        // Enhanced element processing with comprehensive support
        this.processedElements++;
        
        // Headings (H1-H6)
        if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tag)) {
          this._processHeading(child, tag, styleState);
        } else if (tag === 'P') {
          this._processParagraph(child, childStyleState);
        } else if (tag === 'UL' || tag === 'OL') {
          this._drawList(child, 0, childStyleState, tag === 'OL');
        } else if (tag === 'TABLE') {
          this._processTable(child, childStyleState);
        } else if (tag === 'HR') {
          this._processHorizontalRule(child, styleState);
        } else if (tag === 'BLOCKQUOTE') {
          this._processBlockquote(child, styleState);
        } else if (tag === 'IMG' || tag === 'CANVAS') {
          this._drawImage(child, styleState);
        } else if (tag === 'SVG') {
          this._processSVG(child, styleState);
        } else if (['ARTICLE', 'SECTION', 'ASIDE', 'NAV', 'HEADER', 'FOOTER', 'MAIN'].includes(tag)) {
          this._processSemanticElement(child, childStyleState);
        } else if (['FIGURE', 'FIGCAPTION'].includes(tag)) {
          this._processFigure(child, childStyleState);
        } else if (['DETAILS', 'SUMMARY'].includes(tag)) {
          this._processDetails(child, childStyleState);
        } else if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag)) {
          this._processFormElement(child, styleState);
        } else if (['PRE', 'CODE'].includes(tag)) {
          this._processCodeBlock(child, childStyleState);
        } else if (tag === 'DL') {
          this._processDefinitionList(child, childStyleState);
        } else if (tag === 'ADDRESS') {
          this._processAddress(child, childStyleState);
        } else {
          this._processBlock(child, childStyleState);
        }
      }
    });
    const yAfterContent = this.cursorY;

    // If height was auto and we drew background/border, we might need to redraw or adjust them here.
    // This is a complex part of a full box model. For now, background/border with auto height are limited.
    if (explicitHeight === 0 && (c.a > 0 || hasBorder)) {
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
            // Redraw border with enhanced detection
            if (hasBorder) {
                const x = this.margin + parentIndent;
                const y = yAfterContent - pb;
                const w = currentBlockContentWidth + pl + pr;
                const h = calculatedHeight + pt + pb;
                this._drawBorders(x, y, w, h, 
                  {btw: finalBorderProps.btw, brw: finalBorderProps.brw, bbw: finalBorderProps.bbw, blw: finalBorderProps.blw}, 
                  {btc: finalBorderProps.btc, brc: finalBorderProps.brc, bbc: finalBorderProps.bbc, blc: finalBorderProps.blc}, 
                  {bts: finalBorderProps.bts, brs: finalBorderProps.brs, bbs: finalBorderProps.bbs, bls: finalBorderProps.bls});
            }
        }
    }

    this.cursorY -= pb; // Apply padding bottom
    const mb = PDFExporter._parseCssLength(cs.marginBottom, baseFontSize);
    this.cursorY -= mb;
    this._ensureSpace(0); // Check for new page after margin bottom
  }

  _drawBorders(x, y, w, h, widths, colors, styles) {
    try {
      // Helper to draw a single border line with enhanced styling
      const drawLine = (x1, y1, x2, y2, lineWidth, color, style) => {
          if (lineWidth > 0 && color.a > 0) {
              this._write(`${color.r.toFixed(3)} ${color.g.toFixed(3)} ${color.b.toFixed(3)} RG\n`);
              this._write(`${lineWidth.toFixed(3)} w\n`);

              // Apply line dash pattern for styles like dashed or dotted
              if (style === 'dashed') {
                  this._write(`[${(lineWidth * 3).toFixed(3)} ${(lineWidth * 2).toFixed(3)}] 0 d\n`); // Dash pattern: 3*width dash, 2*width gap
              } else if (style === 'dotted') {
                  this._write(`[${lineWidth.toFixed(3)} ${lineWidth.toFixed(3)}] 0 d\n`);       // Dash pattern: 1*width dot, 1*width gap (results in square dots)
              } else if (style === 'double') {
                  // Draw double border by drawing two lines
                  const offset = lineWidth / 3;
                  this._write('[] 0 d\n'); // Solid line
                  this._write(`${x1.toFixed(3)} ${(y1 + offset).toFixed(3)} m ${x2.toFixed(3)} ${(y2 + offset).toFixed(3)} l S\n`);
                  this._write(`${x1.toFixed(3)} ${(y1 - offset).toFixed(3)} m ${x2.toFixed(3)} ${(y2 - offset).toFixed(3)} l S\n`);
                  return; // Skip the normal line drawing
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
    } catch (error) {
      this._handleError('Border drawing failed', error);
    }
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

  static async init(opts = {}) {
    try {
      const pdf = new PDFExporter(opts);
      const selector = opts.selector || 'body';
      const filename = opts.filename || 'document.pdf';
      
      // Find elements to process
      const rootElements = Array.from(document.querySelectorAll(selector));
      if (rootElements.length === 0) {
        throw new Error(`No elements found with selector: ${selector}`);
      }
      
      pdf._reportProgress('initialization', 1, 4);
      
      // Preprocess images before starting PDF generation
      pdf._reportProgress('preprocessing', 2, 4);
      await pdf._loadAndPreprocessImages(rootElements);
      
      // Start PDF generation
      pdf._reportProgress('generation', 3, 4);
      pdf._newPage();
      
      const defaultStyle = { 
        fontKey: 'N', 
        size: pdf.fontSizes.normal, 
        color: { r: 0, g: 0, b: 0, a: 1 }, 
        indent: 0,
        availableWidth: pdf.pageWidth - 2 * pdf.margin,
        textAlign: 'left'
      };
      
      // Process each root element
      rootElements.forEach((root, index) => {
        try {
          pdf._processBlock(root, defaultStyle);
          pdf._reportProgress('processing', index + 1, rootElements.length);
        } catch (error) {
          pdf._handleError(`Processing element ${index} failed`, error);
        }
      });
      
      // Finalize and save
      pdf._reportProgress('finalization', 4, 4);
      pdf.save(filename);
      
      // Return summary
      return {
        success: true,
        pages: pdf.pages.length,
        elementsProcessed: pdf.processedElements,
        errors: pdf.errors,
        warnings: pdf.warnings,
        processingTime: Date.now() - pdf.startTime
      };
      
    } catch (error) {
      console.error('PDFExporter initialization failed:', error);
      throw error;
    }
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

  // Enhanced Unicode normalization with comprehensive character support
  _normalizeText(text) {
    if (!text) return text;
    
    try {
      return text
        // Full-width punctuation to ASCII
        .replace(/：/g, ':')    // Full-width colon
        .replace(/；/g, ';')    // Full-width semicolon
        .replace(/，/g, ',')    // Full-width comma
        .replace(/。/g, '.')    // Full-width period
        .replace(/？/g, '?')    // Full-width question mark
        .replace(/！/g, '!')    // Full-width exclamation mark
        .replace(/（/g, '(')    // Full-width left parenthesis
        .replace(/）/g, ')')    // Full-width right parenthesis
        .replace(/【/g, '[')    // Full-width left bracket
        .replace(/】/g, ']')    // Full-width right bracket
        .replace(/「/g, '"')    // Japanese left quote
        .replace(/」/g, '"')    // Japanese right quote
        .replace(/『/g, '"')    // Japanese left double quote
        .replace(/』/g, '"')    // Japanese right double quote
        
        // Mathematical and currency symbols
        .replace(/＋/g, '+')    // Full-width plus
        .replace(/－/g, '-')    // Full-width minus
        .replace(/×/g, 'x')     // Multiplication sign
        .replace(/÷/g, '/')     // Division sign
        .replace(/＝/g, '=')    // Full-width equals
        .replace(/￥/g, '¥')    // Full-width yen
        .replace(/＄/g, '$')    // Full-width dollar
        
        // Quotation marks normalization
        .replace(/[""]/g, '"')  // Smart quotes to straight
        .replace(/['']/g, "'")  // Smart apostrophes to straight
        .replace(/…/g, '...')   // Ellipsis to three dots
        .replace(/–/g, '-')     // En dash to hyphen
        .replace(/—/g, '--')    // Em dash to double hyphen
        
        // Normalize whitespace
        .replace(/\u00A0/g, ' ') // Non-breaking space to regular space
        .replace(/\u2000-\u200B/g, ' ') // Various Unicode spaces
        .replace(/\u2028/g, '\n') // Line separator
        .replace(/\u2029/g, '\n\n') // Paragraph separator
        
        // Remove zero-width characters that can cause issues
        .replace(/[\u200B-\u200D\uFEFF]/g, '');
        
    } catch (error) {
      this._handleError('Text normalization failed', error);
      return text; // Return original text if normalization fails
    }
  }

  // Normalize and collapse whitespace sequences into single spaces
  _normalizeWhiteSpace(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ');
  }

  // Enhanced text overflow handling
  _handleTextOverflow(text, maxWidth, size, overflowMode = 'wrap') {
    try {
      const textWidth = this._textWidth(text, size);
      
      if (textWidth <= maxWidth) {
        return { text, overflow: false };
      }
      
      switch (overflowMode) {
        case 'ellipsis':
          return this._truncateWithEllipsis(text, maxWidth, size);
        case 'break-word':
          return this._breakWord(text, maxWidth, size);
        case 'clip':
          return { text: this._clipText(text, maxWidth, size), overflow: true };
        case 'wrap':
        default:
          return { text, overflow: true }; // Let normal wrapping handle it
      }
    } catch (error) {
      this._handleError('Text overflow handling failed', error);
      return { text, overflow: false };
    }
  }

  _truncateWithEllipsis(text, maxWidth, size) {
    const ellipsis = '...';
    const ellipsisWidth = this._textWidth(ellipsis, size);
    const availableWidth = maxWidth - ellipsisWidth;
    
    if (availableWidth <= 0) {
      return { text: ellipsis, overflow: true };
    }
    
    let truncated = '';
    for (let i = 0; i < text.length; i++) {
      const testText = truncated + text[i];
      if (this._textWidth(testText, size) > availableWidth) {
        break;
      }
      truncated = testText;
    }
    
    return { text: truncated + ellipsis, overflow: true };
  }

  _breakWord(text, maxWidth, size) {
    let result = '';
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const testText = result + char;
      if (this._textWidth(testText, size) > maxWidth && result.length > 0) {
        result += '\n' + char;
      } else {
        result += char;
      }
    }
    return { text: result, overflow: result.includes('\n') };
  }

  _clipText(text, maxWidth, size) {
    let clipped = '';
    for (let i = 0; i < text.length; i++) {
      const testText = clipped + text[i];
      if (this._textWidth(testText, size) > maxWidth) {
        break;
      }
      clipped = testText;
    }
    return clipped;
  }

  // Enhanced element processing methods
  _processHeading(headingEl, tag, styleState) {
    try {
      const level = parseInt(tag.charAt(1));
      const fontSize = this.fontSizes[tag.toLowerCase()] || this.fontSizes.normal;
      const normalizedText = this._normalizeText(headingEl.textContent.trim());
      
      if (this.debug) {
        console.log(`PDFExporter ${tag} content:`, normalizedText);
      }
      
      // Add spacing before heading
      this.cursorY -= fontSize * 0.5;
      this._ensureSpace(2);
      
      this._drawStyledText(normalizedText, { 
        fontKey: level <= 2 ? 'H' : 'B', 
        size: fontSize, 
        color: styleState.color, 
        indent: styleState.indent,
        availableWidth: styleState.availableWidth,
        textAlign: styleState.textAlign
      });
      
      // Add spacing after heading
      this.cursorY -= fontSize * 0.3;
    } catch (error) {
      this._handleError(`Processing ${tag} failed`, error);
    }
  }

  _processParagraph(pEl, styleState) {
    try {
      // Process paragraph with inline elements
      Array.from(pEl.childNodes).forEach(child => {
        this._processInline(child, styleState);
      });
      
      // Add paragraph spacing
      this.cursorY -= styleState.size * 0.5;
    } catch (error) {
      this._handleError('Processing paragraph failed', error);
    }
  }

  _processTable(tableEl, styleState) {
    try {
      const td = this._prepareTable(tableEl);
      this._measureTable(td, styleState);
      this._layoutTable(td, styleState);
      this._renderTable(td, styleState);
    } catch (error) {
      this._handleError('Processing table failed', error);
    }
  }

  _processHorizontalRule(hrEl, styleState) {
    try {
      const cs = this._getStyle(hrEl);
      this._ensureSpace(1);
      
      const hrY = this.cursorY - (styleState.size * 0.6);
      const x1 = this.margin + (styleState.indent || 0);
      const x2 = this.pageWidth - this.margin;
      
      // Parse HR styling
      const borderColor = PDFExporter._parseCssColor(cs.borderTopColor || cs.borderColor || '#000000');
      const borderWidth = PDFExporter._parseCssLength(cs.borderTopWidth || cs.borderWidth || '1px');
      
      if (borderColor.a > 0) {
        this._write(`${borderColor.r.toFixed(3)} ${borderColor.g.toFixed(3)} ${borderColor.b.toFixed(3)} RG\n`);
        this._write(`${borderWidth.toFixed(3)} w\n`);
        this._write(`${x1.toFixed(3)} ${hrY.toFixed(3)} m ${x2.toFixed(3)} ${hrY.toFixed(3)} l S\n`);
        this._write('0 0 0 RG\n1 w\n'); // Reset
      }
      
      this.cursorY -= styleState.size * 1.2;
    } catch (error) {
      this._handleError('Processing horizontal rule failed', error);
    }
  }

  _processBlockquote(blockquoteEl, styleState) {
    try {
      const quoteStyle = { 
        ...styleState, 
        indent: (styleState.indent || 0) + (this.bulletIndent || 20) 
      };
      
      this.cursorY -= (this.fontSizes.normal * 0.5);
      this._ensureSpace(1);
      this._processBlock(blockquoteEl, quoteStyle);
      this.cursorY -= (this.fontSizes.normal * 0.5);
    } catch (error) {
      this._handleError('Processing blockquote failed', error);
    }
  }

  _processSVG(svgEl, styleState) {
    try {
      // Basic SVG support - render as placeholder for now
      const cs = this._getStyle(svgEl);
      const width = PDFExporter._parseCssLength(cs.width, styleState.size) || 100;
      const height = PDFExporter._parseCssLength(cs.height, styleState.size) || 100;
      
      this._ensureSpace(height / this.leading);
      
      // Draw SVG placeholder rectangle
      const x = this.margin + (styleState.indent || 0);
      const y = this.cursorY - height;
      
      this._write('0.8 0.8 0.8 rg\n'); // Light gray fill
      this._write(`${x.toFixed(3)} ${y.toFixed(3)} ${width.toFixed(3)} ${height.toFixed(3)} re f\n`);
      this._write('0 0 0 rg\n'); // Reset to black
      
      // Add SVG label
      this._drawCell('[SVG]', 'N', styleState.size, x + 5, y + height/2, { r: 0, g: 0, b: 0, a: 1 });
      
      this.cursorY -= height + this.leading * 0.2;
    } catch (error) {
      this._handleError('Processing SVG failed', error);
    }
  }

  _processSemanticElement(semanticEl, styleState) {
    try {
      // Semantic elements are processed like regular blocks but with potential styling
      this._processBlock(semanticEl, styleState);
    } catch (error) {
      this._handleError('Processing semantic element failed', error);
    }
  }

  _processFigure(figureEl, styleState) {
    try {
      const tag = figureEl.tagName.toUpperCase();
      
      if (tag === 'FIGURE') {
        // Add some spacing around figure
        this.cursorY -= this.fontSizes.normal * 0.3;
        this._processBlock(figureEl, styleState);
        this.cursorY -= this.fontSizes.normal * 0.3;
      } else if (tag === 'FIGCAPTION') {
        // Style figcaption differently
        const captionStyle = { 
          ...styleState, 
          size: styleState.size * 0.9,
          fontKey: 'I' // Italic for captions
        };
        Array.from(figureEl.childNodes).forEach(child => {
          this._processInline(child, captionStyle);
        });
      }
    } catch (error) {
      this._handleError('Processing figure failed', error);
    }
  }

  _processDetails(detailsEl, styleState) {
    try {
      const tag = detailsEl.tagName.toUpperCase();
      
      if (tag === 'DETAILS') {
        // Process details as expanded (since PDF is static)
        this._processBlock(detailsEl, styleState);
      } else if (tag === 'SUMMARY') {
        // Style summary as bold
        const summaryStyle = { ...styleState, fontKey: 'B' };
        Array.from(detailsEl.childNodes).forEach(child => {
          this._processInline(child, summaryStyle);
        });
      }
    } catch (error) {
      this._handleError('Processing details failed', error);
    }
  }

  _processFormElement(formEl, styleState) {
    try {
      const tag = formEl.tagName.toUpperCase();
      const cs = this._getStyle(formEl);
      
      // Get form element properties
      const value = formEl.value || formEl.textContent || '';
      const placeholder = formEl.getAttribute('placeholder') || '';
      const type = formEl.getAttribute('type') || 'text';
      
      let displayText = '';
      let elementStyle = { ...styleState };
      
      switch (tag) {
        case 'INPUT':
          switch (type) {
            case 'checkbox':
              displayText = formEl.checked ? '☑ ' : '☐ ';
              break;
            case 'radio':
              displayText = formEl.checked ? '● ' : '○ ';
              break;
            case 'submit':
            case 'button':
              displayText = `[${value || 'Button'}]`;
              elementStyle.fontKey = 'B';
              break;
            default:
              displayText = value || placeholder || `[${type} field]`;
              elementStyle.fontKey = 'M'; // Monospace for input fields
              break;
          }
          break;
        case 'TEXTAREA':
          displayText = value || placeholder || '[Text area]';
          elementStyle.fontKey = 'M';
          break;
        case 'SELECT':
          const selectedOption = formEl.querySelector('option[selected]');
          displayText = selectedOption ? selectedOption.textContent : '[Select]';
          break;
        case 'BUTTON':
          displayText = `[${value || formEl.textContent || 'Button'}]`;
          elementStyle.fontKey = 'B';
          break;
      }
      
      if (displayText) {
        this._drawStyledText(displayText, elementStyle);
      }
    } catch (error) {
      this._handleError('Processing form element failed', error);
    }
  }

  _processCodeBlock(codeEl, styleState) {
    try {
      const tag = codeEl.tagName.toUpperCase();
      const codeStyle = { 
        ...styleState, 
        fontKey: 'M', // Monospace
        size: styleState.size * 0.9
      };
      
      if (tag === 'PRE') {
        // Preserve whitespace and line breaks
        const text = codeEl.textContent;
        const lines = text.split('\n');
        
        lines.forEach(line => {
          if (line.trim()) {
            this._drawStyledText(line, codeStyle);
          } else {
            this.cursorY -= codeStyle.size * 1.2; // Empty line
          }
        });
      } else {
        // Inline code
        Array.from(codeEl.childNodes).forEach(child => {
          this._processInline(child, codeStyle);
        });
      }
    } catch (error) {
      this._handleError('Processing code block failed', error);
    }
  }

  _processDefinitionList(dlEl, styleState) {
    try {
      Array.from(dlEl.children).forEach(child => {
        const tag = child.tagName.toUpperCase();
        
        if (tag === 'DT') {
          // Definition term - bold
          const dtStyle = { ...styleState, fontKey: 'B' };
          Array.from(child.childNodes).forEach(node => {
            this._processInline(node, dtStyle);
          });
        } else if (tag === 'DD') {
          // Definition description - indented
          const ddStyle = { 
            ...styleState, 
            indent: (styleState.indent || 0) + this.bulletIndent 
          };
          Array.from(child.childNodes).forEach(node => {
            this._processInline(node, ddStyle);
          });
        }
      });
    } catch (error) {
      this._handleError('Processing definition list failed', error);
    }
  }

  _processAddress(addressEl, styleState) {
    try {
      // Style address as italic
      const addressStyle = { ...styleState, fontKey: 'I' };
      Array.from(addressEl.childNodes).forEach(child => {
        this._processInline(child, addressStyle);
      });
    } catch (error) {
      this._handleError('Processing address failed', error);
    }
  }

  // Utility and debugging methods
  getStats() {
    return {
      pages: this.pages.length,
      objects: this.objects.length,
      elementsProcessed: this.processedElements,
      errors: this.errors.length,
      warnings: this.warnings.length,
      cacheSize: this.cacheSize,
      processingTime: Date.now() - this.startTime,
      memoryUsage: this._estimateMemoryUsage()
    };
  }

  _estimateMemoryUsage() {
    try {
      // Rough estimation of memory usage
      let totalSize = 0;
      
      // Objects size
      this.objects.forEach(obj => {
        totalSize += (typeof obj === 'string' ? obj.length : 100) * 2; // UTF-16
      });
      
      // Streams size
      Object.values(this.streams).forEach(stream => {
        totalSize += stream.reduce((acc, str) => acc + str.length * 2, 0);
      });
      
      // Image cache size (rough estimate)
      totalSize += this.processedElements * 50; // Rough estimate per element
      
      return {
        estimated: totalSize,
        unit: 'bytes',
        mb: (totalSize / (1024 * 1024)).toFixed(2)
      };
    } catch (error) {
      return { error: 'Could not estimate memory usage' };
    }
  }

  // Clear caches and reset for memory management
  clearCaches() {
    this.styleCache = new WeakMap();
    this.cacheSize = 0;
    this._addWarning('Caches cleared manually');
  }

  // Get detailed error and warning reports
  getErrorReport() {
    return {
      errors: this.errors,
      warnings: this.warnings,
      summary: {
        totalErrors: this.errors.length,
        totalWarnings: this.warnings.length,
        criticalErrors: this.errors.filter(e => e.message.includes('Critical')).length
      }
    };
  }

  // Export configuration for debugging
  exportConfig() {
    return {
      pageWidth: this.pageWidth,
      pageHeight: this.pageHeight,
      margin: this.margin,
      fontSizes: this.fontSizes,
      leading: this.leading,
      bulletIndent: this.bulletIndent,
      tableCellPadding: this.tableCellPadding,
      fontFamily: this.fontFamily,
      debug: this.debug,
      hasCanvas: !!this.ctx,
      renderers: Object.keys(this.renderers)
    };
  }

  // Add custom CSS property support
  addCustomCSSProperty(property, parser) {
    if (typeof parser !== 'function') {
      throw new Error('Parser must be a function');
    }
    
    if (!this.customCSSParsers) {
      this.customCSSParsers = {};
    }
    
    this.customCSSParsers[property] = parser;
  }

  // Add custom element renderer
  addElementRenderer(tagName, renderer) {
    if (typeof renderer !== 'function') {
      throw new Error('Renderer must be a function');
    }
    
    this.renderers[tagName.toUpperCase()] = renderer;
  }

  // Performance monitoring
  _startTimer(label) {
    if (!this.timers) this.timers = {};
    this.timers[label] = Date.now();
  }

  _endTimer(label) {
    if (!this.timers || !this.timers[label]) return 0;
    const elapsed = Date.now() - this.timers[label];
    delete this.timers[label];
    return elapsed;
  }

  // Enhanced page management
  getCurrentPageInfo() {
    const currentPage = this.pages[this.pages.length - 1];
    return {
      pageNumber: this.pages.length,
      cursorY: this.cursorY,
      remainingSpace: this.cursorY - this.margin,
      imageCount: currentPage ? Object.keys(currentPage.imageResourceMap).length : 0,
      annotationCount: currentPage ? currentPage.annotations.length : 0
    };
  }

  // Utility method to inspect HTML computed styles for debugging and measurements
  inspectElementStyles(element, properties = []) {
    try {
      const cs = this._getStyle(element);
      const defaultProps = [
        'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
        'marginLeft', 'marginRight', 'marginTop', 'marginBottom',
        'borderLeftWidth', 'borderRightWidth', 'borderTopWidth', 'borderBottomWidth',
        'borderLeftColor', 'borderRightColor', 'borderTopColor', 'borderBottomColor',
        'borderLeftStyle', 'borderRightStyle', 'borderTopStyle', 'borderBottomStyle',
        'border', 'backgroundColor', 'color', 'fontSize', 'fontFamily',
        'textAlign', 'lineHeight', 'display', 'width', 'height'
      ];
      
      const propsToInspect = properties.length > 0 ? properties : defaultProps;
      const styleInfo = {
        tagName: element.tagName,
        className: element.className,
        id: element.id,
        computedStyles: {},
        parsedValues: {}
      };
      
      propsToInspect.forEach(prop => {
        const value = cs[prop];
        styleInfo.computedStyles[prop] = value;
        
        // Parse common CSS values for debugging
        if (prop.includes('padding') || prop.includes('margin') || prop.includes('Width') || prop.includes('Height')) {
          styleInfo.parsedValues[prop] = PDFExporter._parseCssLength(value, 12);
        } else if (prop.includes('Color') || prop === 'backgroundColor' || prop === 'color') {
          styleInfo.parsedValues[prop] = PDFExporter._parseCssColor(value);
        }
      });
      
      return styleInfo;
    } catch (error) {
      this._handleError('Style inspection failed', error);
      return { error: error.message };
    }
  }

  // Batch inspect multiple elements
  inspectMultipleElements(selector, properties = []) {
    try {
      const elements = document.querySelectorAll(selector);
      return Array.from(elements).map(el => this.inspectElementStyles(el, properties));
    } catch (error) {
      this._handleError('Multiple element inspection failed', error);
      return [];
    }
  }

  // Analyze HTML vs PDF differences and provide recommendations
  analyzeLayoutDifferences(selector = 'body') {
    try {
      const analysis = {
        lists: [],
        tables: [],
        sections: [],
        recommendations: []
      };
      
      // Analyze lists
      const lists = document.querySelectorAll(`${selector} ul, ${selector} ol`);
      lists.forEach(list => {
        const listInfo = this.inspectElementStyles(list, ['paddingLeft', 'marginLeft', 'listStyleType']);
        const firstLi = list.querySelector('li');
        if (firstLi) {
          const liInfo = this.inspectElementStyles(firstLi, ['paddingLeft', 'marginLeft']);
          analysis.lists.push({
            type: list.tagName.toLowerCase(),
            listPadding: listInfo.parsedValues.paddingLeft || 0,
            listMargin: listInfo.parsedValues.marginLeft || 0,
            liPadding: liInfo.parsedValues.paddingLeft || 0,
            liMargin: liInfo.parsedValues.marginLeft || 0,
            listStyleType: listInfo.computedStyles.listStyleType,
            element: list
          });
        }
      });
      
      // Analyze tables
      const tables = document.querySelectorAll(`${selector} table`);
      tables.forEach(table => {
        const firstCell = table.querySelector('td, th');
        if (firstCell) {
          const cellInfo = this.inspectElementStyles(firstCell, ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom']);
          analysis.tables.push({
            cellPaddingLeft: cellInfo.parsedValues.paddingLeft || 0,
            cellPaddingRight: cellInfo.parsedValues.paddingRight || 0,
            cellPaddingTop: cellInfo.parsedValues.paddingTop || 0,
            cellPaddingBottom: cellInfo.parsedValues.paddingBottom || 0,
            element: table
          });
        }
      });
      
      // Analyze sections with borders
      const sections = document.querySelectorAll(`${selector} section, ${selector} div, ${selector} article`);
      sections.forEach(section => {
        const sectionInfo = this.inspectElementStyles(section, ['border', 'borderWidth', 'borderColor', 'borderStyle', 'backgroundColor']);
        if (sectionInfo.computedStyles.border !== 'none' && sectionInfo.computedStyles.border !== '0px none rgb(0, 0, 0)') {
          analysis.sections.push({
            border: sectionInfo.computedStyles.border,
            backgroundColor: sectionInfo.computedStyles.backgroundColor,
            element: section
          });
        }
      });
      
      // Generate recommendations
      if (analysis.lists.length > 0) {
        const avgListPadding = analysis.lists.reduce((sum, list) => sum + list.listPadding, 0) / analysis.lists.length;
        analysis.recommendations.push({
          type: 'list-indentation',
          current: this.bulletIndent,
          recommended: Math.round(avgListPadding),
          reason: `HTML lists average ${avgListPadding.toFixed(1)}px padding-left`
        });
      }
      
      if (analysis.tables.length > 0) {
        const avgCellPadding = analysis.tables.reduce((sum, table) => 
          sum + (table.cellPaddingLeft + table.cellPaddingRight) / 2, 0) / analysis.tables.length;
        analysis.recommendations.push({
          type: 'table-cell-padding',
          current: this.tableCellPadding,
          recommended: Math.round(avgCellPadding),
          reason: `HTML table cells average ${avgCellPadding.toFixed(1)}px horizontal padding`
        });
      }
      
      if (analysis.sections.length > 0) {
        analysis.recommendations.push({
          type: 'section-borders',
          count: analysis.sections.length,
          reason: `Found ${analysis.sections.length} sections with borders that may need enhanced rendering`
        });
      }
      
      return analysis;
    } catch (error) {
      this._handleError('Layout analysis failed', error);
      return { error: error.message };
    }
  }

  // Force page break
  forcePageBreak() {
    this._newPage();
  }

  // Add custom header/footer support
  setHeaderFooter(headerFn, footerFn) {
    this.customHeader = typeof headerFn === 'function' ? headerFn : null;
    this.customFooter = typeof footerFn === 'function' ? footerFn : null;
  }

  _drawCustomHeaderFooter() {
    try {
      const pageInfo = this.getCurrentPageInfo();
      
      if (this.customHeader) {
        const savedY = this.cursorY;
        this.cursorY = this.pageHeight - this.margin / 2;
        this.customHeader(this, pageInfo);
        this.cursorY = savedY;
      }
      
      if (this.customFooter) {
        const savedY = this.cursorY;
        this.cursorY = this.margin / 2;
        this.customFooter(this, pageInfo);
        this.cursorY = savedY;
      }
    } catch (error) {
      this._handleError('Custom header/footer rendering failed', error);
    }
  }
}

// Expose globally
window.PDFExporter = PDFExporter;

// Enhanced Usage Examples and API Documentation
/*
=== ENHANCED PDF EXPORTER USAGE GUIDE ===

1. BASIC USAGE:
```javascript
// Simple usage
await PDFExporter.init({
  selector: '.content',
  filename: 'my-document.pdf'
});

// With progress tracking
await PDFExporter.init({
  selector: 'article',
  filename: 'article.pdf',
  onProgress: (info) => {
    console.log(`${info.phase}: ${info.percentage}%`);
  }
});
```

2. ADVANCED CONFIGURATION:
```javascript
await PDFExporter.init({
  // Page settings
  pageSize: 'A4',           // A4, Letter, Legal, A3, A5, Tabloid
  landscape: false,
  margin: 40,
  
  // Font settings
  fontSize: 12,
  fontFamily: 'Helvetica',
  h1FontSize: 24,
  h2FontSize: 18,
  h3FontSize: 16,
  h4FontSize: 14,
  h5FontSize: 12,
  h6FontSize: 11,
  
  // Layout settings
  bulletIndent: 20,
  tableCellPadding: 5,
  
  // Callbacks
  onProgress: (info) => console.log(info),
  onError: (error) => console.error(error),
  onWarning: (warning) => console.warn(warning),
  onPage: (pdf, pageNum) => {
    // Custom page processing
  },
  
  // Debug mode
  debug: true,
  
  // Custom renderers
  renderers: {
    'CUSTOM-ELEMENT': (element, styleState, pdf) => {
      // Custom element processing
    }
  }
});
```

3. SUPPORTED HTML ELEMENTS:
- Headings: H1, H2, H3, H4, H5, H6
- Text: P, SPAN, DIV, STRONG, EM, B, I, U, S, DEL, SUB, SUP, SMALL, MARK
- Lists: UL, OL, LI (with nested support)
- Tables: TABLE, THEAD, TBODY, TR, TH, TD
- Media: IMG, CANVAS, SVG (basic support)
- Semantic: ARTICLE, SECTION, ASIDE, NAV, HEADER, FOOTER, MAIN
- Interactive: DETAILS, SUMMARY
- Forms: INPUT, TEXTAREA, SELECT, BUTTON (rendered as text representations)
- Code: PRE, CODE, KBD, SAMP, VAR
- Other: BLOCKQUOTE, HR, FIGURE, FIGCAPTION, DL, DT, DD, ADDRESS, BR

4. SUPPORTED CSS PROPERTIES:
- Colors: All CSS color formats (hex, rgb, rgba, hsl, hsla, named colors)
- Lengths: px, pt, em, rem, ex, ch, vw, vh, vmin, vmax, %, in, cm, mm, pc
- Text: color, font-size, font-family, text-align, text-decoration, text-transform
- Box Model: margin, padding, border, background-color, width, height
- Layout: display, position, float, clear
- Effects: opacity, visibility, overflow, text-overflow, white-space
- Advanced: calc() expressions, box-shadow, text-shadow (basic support)

5. ERROR HANDLING AND DEBUGGING:
```javascript
try {
  const result = await PDFExporter.init({
    selector: '.content',
    debug: true
  });
  
  console.log('PDF Generation Result:', result);
  // {
  //   success: true,
  //   pages: 5,
  //   elementsProcessed: 127,
  //   errors: [],
  //   warnings: ['Canvas not available'],
  //   processingTime: 1250
  // }
  
} catch (error) {
  console.error('Critical error:', error);
}
```

6. MEASUREMENT-BASED FINE-TUNING:
```javascript
// Create PDF instance for analysis
const pdf = new PDFExporter({ debug: true });

// Analyze layout differences and get recommendations
const analysis = pdf.analyzeLayoutDifferences('.content');
console.log('Layout Analysis:', analysis);
// {
//   lists: [{ type: 'ul', listPadding: 40, liPadding: 0, ... }],
//   tables: [{ cellPaddingLeft: 8, cellPaddingRight: 8, ... }],
//   sections: [{ border: '1px solid #ccc', ... }],
//   recommendations: [
//     { type: 'list-indentation', current: 20, recommended: 40, reason: '...' },
//     { type: 'table-cell-padding', current: 5, recommended: 8, reason: '...' }
//   ]
// }

// Inspect specific elements
const listStyles = pdf.inspectElementStyles(document.querySelector('ul'));
console.log('List Styles:', listStyles);

// Apply recommendations and regenerate
await PDFExporter.init({
  selector: '.content',
  bulletIndent: analysis.recommendations.find(r => r.type === 'list-indentation')?.recommended || 20,
  tableCellPadding: analysis.recommendations.find(r => r.type === 'table-cell-padding')?.recommended || 5
});
```

=== API REFERENCE ===

Constructor Options:
- pageSize: 'A4' | 'Letter' | 'Legal' | 'A3' | 'A5' | 'Tabloid'
- pageWidth/pageHeight: number (in points)
- landscape: boolean
- margin: number
- fontSize: number
- fontFamily: string
- h1FontSize through h6FontSize: number
- bulletIndent: number
- tableCellPadding: number
- debug: boolean
- onProgress: function
- onError: function
- onWarning: function
- onPage: function
- renderers: object

Instance Methods:
- getStats(): object - Get processing statistics
- getErrorReport(): object - Get detailed error information
- exportConfig(): object - Export current configuration
- clearCaches(): void - Clear internal caches
- addElementRenderer(tagName, renderer): void
- addCustomCSSProperty(property, parser): void
- setHeaderFooter(headerFn, footerFn): void
- forcePageBreak(): void
- getCurrentPageInfo(): object
- inspectElementStyles(element, properties): object - Inspect computed styles for debugging
- inspectMultipleElements(selector, properties): array - Batch inspect elements
- analyzeLayoutDifferences(selector): object - Analyze HTML vs PDF differences and get recommendations

Static Methods:
- PDFExporter.init(options): Promise<result>
- PDFExporter._parseCssColor(color): object
- PDFExporter._parseCssLength(length, baseFontSize, containerSize): number

*/