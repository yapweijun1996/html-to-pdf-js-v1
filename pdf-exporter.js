// pdf-exporter.js
// Zero-dependency PDF engine: headings (H1,H2), paragraphs, lists, tables, text wrapping

var PDFExporter = (function() {
  function PDF() {
    this.objects = [];
    this.offsets = [];
    this.pages = [];
    this.streams = {};
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
  }

  PDF.prototype._addObject = function(content) {
    this.objects.push(content);
    return this.objects.length;
  };

  PDF.prototype._newPage = function() {
    var cid = this._addObject('');
    var pid = this._addObject(
      '<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ' + this.pageWidth + ' ' + this.pageHeight + '] ' +
      '/Contents ' + cid + ' 0 R /Resources << /Font << ' +
      '/H ' + this.fH + ' 0 R /B ' + this.fB + ' 0 R /I ' + this.fI + ' 0 R /N ' + this.fN + ' 0 R >> >> >>'
    );
    this.pages.push({ pid: pid, cid: cid });
    this.streams[cid] = '';
    this.cursorY = this.pageHeight - this.margin;
  };

  PDF.prototype._write = function(txt) {
    var cid = this.pages[this.pages.length - 1].cid;
    this.streams[cid] += txt;
  };

  PDF.prototype._ensureSpace = function(lines) {
    if (this.cursorY < lines * this.leading + this.margin) {
      this._newPage();
    }
  };

  PDF.prototype._textWidth = function(text, size) {
    return text.length * size * 0.5;
  };

  PDF.prototype._drawText = function(text, style) {
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
  };

  PDF.prototype.text = function(txt, style) {
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
  };

  PDF.prototype.save = function(filename) {
    this.pages.forEach(function(p) {
      var content = this.streams[p.cid];
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
  };

  function init(opts) {
    var pdf = new PDF();
    pdf._newPage();
    var els = document.querySelectorAll(opts.selector);
    els.forEach(function(el) {
      Array.from(el.children).forEach(function(child) {
        var tag = child.tagName;
        if (tag === 'H1') pdf._drawText(child.textContent, 'h1');
        else if (tag === 'H2') pdf._drawText(child.textContent, 'h2');
        else if (tag === 'P') pdf._drawText(child.textContent);
        else if (tag === 'UL')
          Array.from(child.querySelectorAll('li')).forEach(function(li) {
            pdf._drawText('• ' + li.textContent);
          });
        else if (tag === 'TABLE')
          Array.from(child.querySelectorAll('tr')).forEach(function(tr) {
            var row = Array.from(tr.querySelectorAll('th,td'))
              .map(function(td) { return td.textContent; })
              .join(' | ');
            pdf._drawText(row);
          });
        pdf.cursorY -= pdf.leading * 0.2;
      });
    });
    pdf.save(opts.filename);
  }

  return { init: init };
})();