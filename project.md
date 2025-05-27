# PDF Exporter - Frontend HTML to PDF Library

## Project Overview

**PDF Exporter** is a comprehensive, zero-dependency JavaScript library that converts HTML content to PDF documents entirely in the browser. This is a **frontend-only solution** that requires no server-side processing, making it ideal for client-side applications that need PDF generation capabilities.

## Key Features

### Core Functionality
- **Zero Dependencies**: Pure JavaScript implementation with no external libraries
- **Client-Side Only**: Runs entirely in the browser, no server required
- **Comprehensive HTML Support**: Handles most HTML elements and CSS properties
- **Multi-Page Documents**: Automatic page breaks and content flow
- **Image Processing**: Supports images, canvas elements, and basic SVG
- **Advanced Typography**: Multiple font styles, sizes, and formatting options

### HTML Element Support
- **Text Elements**: H1-H6, P, SPAN, DIV, STRONG, EM, B, I, U, S, DEL, SUB, SUP, SMALL, MARK
- **Lists**: UL, OL, LI with nested list support and custom bullet styles
- **Tables**: TABLE, THEAD, TBODY, TR, TH, TD with colspan/rowspan support
- **Media**: IMG, CANVAS, SVG (basic placeholder support)
- **Semantic Elements**: ARTICLE, SECTION, ASIDE, NAV, HEADER, FOOTER, MAIN
- **Interactive Elements**: DETAILS, SUMMARY (rendered as static content)
- **Form Elements**: INPUT, TEXTAREA, SELECT, BUTTON (rendered as text representations)
- **Code Elements**: PRE, CODE, KBD, SAMP, VAR with monospace formatting
- **Other Elements**: BLOCKQUOTE, HR, FIGURE, FIGCAPTION, DL, DT, DD, ADDRESS, BR

### CSS Property Support
- **Colors**: All CSS color formats (hex, rgb, rgba, hsl, hsla, named colors)
- **Units**: px, pt, em, rem, ex, ch, vw, vh, vmin, vmax, %, in, cm, mm, pc
- **Text Properties**: color, font-size, font-family, text-align, text-decoration, text-transform
- **Box Model**: margin, padding, border, background-color, width, height
- **Layout**: display, position, float, clear
- **Effects**: opacity, visibility, overflow, text-overflow, white-space
- **Advanced**: calc() expressions, box-shadow, text-shadow (basic support)

## Architecture

### Class Structure
```javascript
class PDFExporter {
  // Core PDF generation engine
  constructor(opts = {})
  
  // Static factory method for easy usage
  static async init(opts = {})
  
  // PDF object management
  _addObject(content)
  _newPage()
  _write(txt)
  
  // Text and layout processing
  _textWidth(text, size)
  _drawStyledText(text, styleState)
  _processBlock(el, styleState)
  _processInline(node, styleState, depth)
  
  // Element-specific processors
  _drawList(listEl, level, styleState, isOrdered)
  _renderTable(tableData, styleState)
  _drawImage(imgElement, styleState)
  
  // CSS parsing and styling
  static _parseCssColor(cssColor)
  static _parseCssLength(cssValue, baseFontSize, containerSize)
  _getStyle(el)
  
  // Image processing
  async _loadAndPreprocessImages(elements)
  async _processImageElement(img, processedUrls)
  
  // PDF output
  async save(filename)
}
```

### Core Components

#### 1. PDF Generation Engine
- **Object Management**: Tracks PDF objects, pages, and cross-references
- **Stream Management**: Handles PDF content streams for each page
- **Font Management**: Built-in support for Helvetica family fonts
- **Page Management**: Automatic page breaks and multi-page content flow

#### 2. HTML/CSS Parser
- **DOM Traversal**: Recursive processing of HTML elements
- **Style Computation**: Uses `getComputedStyle()` for accurate CSS parsing
- **Layout Engine**: Implements basic CSS box model
- **Text Measurement**: Canvas-based text width calculation with fallbacks

#### 3. Image Processing Pipeline
- **Security Validation**: URL validation and sanitization
- **Format Conversion**: PNG to JPEG conversion for PDF compatibility
- **Caching System**: Memory-efficient image caching with size limits
- **Async Loading**: Non-blocking image processing with timeouts

#### 4. Rendering System
- **Text Rendering**: Multi-line text with wrapping and alignment
- **List Rendering**: Nested lists with custom bullet styles
- **Table Rendering**: Complex tables with cell spanning and page breaks
- **Border/Background**: CSS border and background rendering

## Usage Examples

### Basic Usage
```javascript
// Simple conversion
await PDFExporter.init({
  selector: '.content',
  filename: 'document.pdf'
});
```

### Advanced Configuration
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
  
  // Layout settings
  bulletIndent: 20,
  tableCellPadding: 5,
  
  // Callbacks
  onProgress: (info) => console.log(`${info.phase}: ${info.percentage}%`),
  onError: (error) => console.error(error),
  onWarning: (warning) => console.warn(warning),
  
  // Debug mode
  debug: true,
  
  // Custom element renderers
  renderers: {
    'CUSTOM-ELEMENT': (element, styleState, pdf) => {
      // Custom processing logic
    }
  }
});
```

### Instance-Based Usage
```javascript
const pdf = new PDFExporter({
  pageSize: 'Letter',
  debug: true
});

// Analyze layout before generation
const analysis = pdf.analyzeLayoutDifferences('.content');
console.log('Recommendations:', analysis.recommendations);

// Generate PDF with optimized settings
await PDFExporter.init({
  selector: '.content',
  bulletIndent: analysis.recommendations.find(r => r.type === 'list-indentation')?.recommended || 20
});
```

## Technical Implementation

### PDF Structure
The library generates PDF 1.7 compliant documents with:
- **Cross-Reference Table**: Efficient object lookup
- **Page Tree**: Hierarchical page organization
- **Resource Management**: Fonts and images as XObjects
- **Content Streams**: Compressed page content
- **Annotations**: Clickable links and interactive elements

### Text Measurement
```javascript
// Canvas-based measurement (primary)
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
ctx.font = `${size}px ${fontFamily}`;
const width = ctx.measureText(text).width;

// Fallback calculation (when canvas unavailable)
// Character-specific width estimation for different scripts
```

### Memory Management
- **WeakMap Caching**: Automatic garbage collection for DOM elements
- **Size Limits**: Configurable cache sizes and image limits
- **Resource Cleanup**: Explicit cleanup methods for large documents
- **Streaming Generation**: Chunked processing for memory efficiency

### Security Features
- **URL Validation**: Strict HTTPS-only image loading
- **Input Sanitization**: PDF string escaping and validation
- **Size Limits**: Protection against memory exhaustion
- **Timeout Handling**: Prevents hanging on slow resources

## Current Issues and Limitations

### Critical Issues
1. **Syntax Errors**: Missing semicolons in method declarations
2. **Async Method Issues**: Linter errors with async method syntax
3. **Browser Compatibility**: Uses modern APIs without fallbacks
4. **Memory Leaks**: Incomplete resource cleanup

### Functional Limitations
1. **Font Support**: Limited to built-in PDF fonts only
2. **CSS Support**: Incomplete implementation of CSS specifications
3. **Layout Engine**: No support for CSS Grid or Flexbox
4. **Vector Graphics**: SVG rendered as placeholders only
5. **Form Elements**: Static representation only

### Performance Concerns
1. **Large Documents**: No pagination optimization for huge content
2. **Image Processing**: Synchronous processing can block UI
3. **Text Measurement**: Canvas operations can be expensive
4. **DOM Traversal**: Deep recursion without proper limits

### Security Vulnerabilities
1. **URL Validation**: Overly restrictive (blocks localhost)
2. **PDF Injection**: Complex string escaping logic
3. **Memory Exhaustion**: Insufficient protection against large inputs

## Development Setup

### Prerequisites
- Modern web browser with ES6+ support
- No build tools required (pure JavaScript)
- No server-side dependencies

### File Structure
```
pdf-exporter.js          # Main library file (3,796 lines)
├── Class Definition     # PDFExporter class
├── Core Methods        # PDF generation logic
├── HTML Processors     # Element-specific handlers
├── CSS Parsers        # Style computation
├── Image Pipeline     # Async image processing
├── Utility Methods    # Helper functions
└── Documentation      # Usage examples and API reference
```

### Integration
```html
<!-- Include the library -->
<script src="pdf-exporter.js"></script>

<!-- Use in your application -->
<script>
document.getElementById('export-btn').addEventListener('click', async () => {
  try {
    const result = await PDFExporter.init({
      selector: '#content',
      filename: 'my-document.pdf'
    });
    console.log('PDF generated successfully:', result);
  } catch (error) {
    console.error('PDF generation failed:', error);
  }
});
</script>
```

## API Reference

### Constructor Options
```typescript
interface PDFExporterOptions {
  // Page configuration
  pageSize?: 'A4' | 'Letter' | 'Legal' | 'A3' | 'A5' | 'Tabloid';
  pageWidth?: number;
  pageHeight?: number;
  landscape?: boolean;
  margin?: number;
  
  // Typography
  fontSize?: number;
  fontFamily?: string;
  h1FontSize?: number;
  h2FontSize?: number;
  h3FontSize?: number;
  h4FontSize?: number;
  h5FontSize?: number;
  h6FontSize?: number;
  
  // Layout
  bulletIndent?: number;
  tableCellPadding?: number;
  
  // Callbacks
  onProgress?: (info: ProgressInfo) => void;
  onError?: (error: ErrorInfo) => void;
  onWarning?: (warning: WarningInfo) => void;
  onPage?: (pdf: PDFExporter, pageNumber: number) => void;
  
  // Customization
  renderers?: Record<string, ElementRenderer>;
  debug?: boolean;
  
  // Performance
  maxImageCacheSize?: number;
  maxIndividualImageSize?: number;
  imageLoadTimeout?: number;
}
```

### Static Methods
- `PDFExporter.init(options)`: Main entry point for PDF generation
- `PDFExporter._parseCssColor(color)`: Parse CSS color values
- `PDFExporter._parseCssLength(length, baseFontSize, containerSize)`: Parse CSS length values

### Instance Methods
- `getStats()`: Get processing statistics
- `getErrorReport()`: Get detailed error information
- `exportConfig()`: Export current configuration
- `clearCaches()`: Clear internal caches
- `addElementRenderer(tagName, renderer)`: Add custom element processor
- `setHeaderFooter(headerFn, footerFn)`: Add custom headers/footers
- `forcePageBreak()`: Insert manual page break
- `analyzeLayoutDifferences(selector)`: Analyze HTML vs PDF layout differences

## Future Improvements

### High Priority
1. Fix syntax errors and linter issues
2. Add comprehensive error handling
3. Implement proper resource cleanup
4. Add browser compatibility fallbacks

### Medium Priority
1. Add custom font support
2. Improve CSS layout engine
3. Optimize performance for large documents
4. Add TypeScript definitions

### Low Priority
1. Add SVG rendering support
2. Implement CSS Grid/Flexbox
3. Add form field support
4. Create plugin architecture

## Contributing

This project would benefit from:
- Code review and refactoring
- Test suite implementation
- Performance optimization
- Documentation improvements
- Browser compatibility testing

The codebase is well-structured but needs modernization and bug fixes to be production-ready. 