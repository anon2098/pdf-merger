# PDF Merger & Stamper

Merges PDFs chronologically and stamps each with ACK numbers (ACK-001, ACK-002, etc.)

## Installation

```bash
cd /Users/admin/Scripts/pdf-merger
npm install
```

## Usage

```bash
node merge-stamp.js <input-directory> [output.pdf]
```

### Examples

Merge PDFs and save to default location:
```bash
node merge-stamp.js "/Users/admin/Desktop/EMails for affidavit"
```

Merge PDFs and specify output:
```bash
node merge-stamp.js "/Users/admin/Desktop/EMails for affidavit" "acknowledgments.pdf"
```

## Features

- Reads all PDFs from input directory
- Sorts chronologically by filename (yyyy_mm_dd format)
- Stamps first page of each PDF with ACK-001, ACK-002, etc.
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

Or specify custom output (index files will be named automatically):
```bash
node merge-stamp.js "/path/to/pdfs" "my-affidavit.pdf"
# Creates: my-affidavit.pdf, my-affidavit Index.pdf, and my-affidavit Index.odt
```

The ODT file can be opened in OpenOffice Writer, LibreOffice Writer, or Microsoft Word for further editing.

