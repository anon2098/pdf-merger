# PDF Merger & Stamper

Merges PDFs chronologically and stamps each with ACK numbers (ACK-001, ACK-002, etc.)

## Installation

```bash
cd /Users/admin/Scripts/pdf-merger
npm install
```

## Usage

### Merge PDFs
```bash
node merge-stamp.js merge <input-directory> [output.pdf]
```

### Add page numbers to existing PDF
```bash
node merge-stamp.js paginate <file>
```

### Regenerate index from existing PDF
```bash
node merge-stamp.js regenerate <file> [output-directory]
```

## Examples

### Merge PDFs and save to default location:
```bash
node merge-stamp.js merge "/Users/admin/Desktop/EMails for affidavit"
```

### Merge PDFs and specify output:
```bash
node merge-stamp.js merge "/Users/admin/Desktop/EMails for affidavit" "acknowledgments.pdf"
```

### Add page numbers to an existing PDF:
```bash
node merge-stamp.js paginate "/Users/admin/Desktop/merged-document.pdf"
```

### Regenerate index from a cleaned PDF (after removing pages):
```bash
node merge-stamp.js regenerate "/Users/admin/Desktop/cleaned-document.pdf"
```

## Features

- Reads all PDFs from input directory
- Sorts chronologically by filename (yyyy_mm_dd format)
- Stamps **every page** of each PDF with ACK-001, ACK-002, etc. (not just the first page)
- Stamp appears at top center, above the email header
- Merges all PDFs into one final document
- Preserves all pages from all PDFs
- **Generates index table** with columns:
  - Exhibit (ACK-001, ACK-002, etc.)
  - Document (Email from sender to receiver)
  - Date (dd.mm.yyyy format)
  - Page(s) (e.g., 1-4, 5, 6-10)

## Output

Three files are generated:

1. **Merged PDF**: `<input-directory>/ACK-001 - ACK-XXX.pdf`
2. **Index PDF**: `<input-directory>/ACK-001 - ACK-XXX Index.pdf`
3. **Index ODT**: `<input-directory>/ACK-001 - ACK-XXX Index.odt` (OpenOffice Writer format)
4. **Statements ODT**: `<input-directory>/ACK-001 - ACK-XXX Statements.odt` (Legal statements)

Or specify custom output (index files will be named automatically):
```bash
node merge-stamp.js merge "/path/to/pdfs" "my-affidavit.pdf"
# Creates: my-affidavit.pdf, my-affidavit Index.pdf, and my-affidavit Index.odt
```

The ODT files can be opened in OpenOffice Writer, LibreOffice Writer, or Microsoft Word for further editing.

## Advanced Usage

### Workflow for cleaning documents:
1. Merge documents: `node merge-stamp.js merge "/path/to/pdfs"`
2. Clean the merged PDF (remove unwanted pages in a PDF editor)
3. Add page numbers (if needed): `node merge-stamp.js paginate "/path/to/cleaned.pdf"`
4. Regenerate index: `node merge-stamp.js regenerate "/path/to/cleaned.pdf"`

This workflow allows you to remove pages and then automatically rebuild the index to match the cleaned document. Page numbering is now a separate step that can be applied after cleaning.

### Page Numbering Features:
- The `paginate` command adds page numbers at the bottom right corner of each page
- When run multiple times, it will automatically cover existing page numbers with a white background before drawing new ones
- This prevents overlapping or double page numbers when renumbering cleaned documents
