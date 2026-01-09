import fs from 'fs/promises';
import path from 'path';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fileURLToPath } from 'url';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set up worker for pdfjs
const workerPath = path.resolve(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');

async function mergeAndStampPDFs(inputDir, outputPath, options = {}) {
  const { addPageNumbers = false, createIndex = true } = options; // Changed default to false
  
  console.log(`Reading PDFs from: ${inputDir}`);
  
  // Get all PDF files and sort chronologically
  const files = await fs.readdir(inputDir);
  const pdfFiles = files
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .sort(); // Sorts by filename (our yyyy_mm_dd format)
  
  console.log(`Found ${pdfFiles.length} PDFs`);
  
  if (pdfFiles.length === 0) {
    console.error('No PDF files found!');
    process.exit(1);
  }
  
  // Create merged document
  const mergedPdf = await PDFDocument.create();
  const font = await mergedPdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await mergedPdf.embedFont(StandardFonts.HelveticaBold);
  
  // Track index data
  const indexData = [];
  let currentPage = 1;
  
  // Process each PDF
  for (let i = 0; i < pdfFiles.length; i++) {
    const pdfFile = pdfFiles[i];
    const ackNumber = `ACK-${String(i + 1).padStart(3, '0')}`; // ACK-001, ACK-002, etc.
    
    console.log(`Processing ${pdfFile} -> ${ackNumber}`);
    
    // Parse filename for metadata (format: yyyy_mm_dd_hh_mm_sender_to_receiver.pdf)
    const metadata = parseFilename(pdfFile);
    
    // Load source PDF
    const pdfPath = path.join(inputDir, pdfFile);
    const pdfBytes = await fs.readFile(pdfPath);
    const srcPdf = await PDFDocument.load(pdfBytes);
    
    const pageCount = srcPdf.getPageCount();
    const startPage = currentPage;
    const endPage = currentPage + pageCount - 1;
    
    // Store index entry
    indexData.push({
      exhibit: ackNumber,
      document: `Email from ${metadata.sender} to ${metadata.receiver}`,
      date: metadata.dateFormatted,
      dateFull: metadata.dateFull,
      sender: metadata.sender,
      receiver: metadata.receiver,
      pages: pageCount === 1 ? `${startPage}` : `${startPage}-${endPage}`
    });
    
    // Copy all pages
    const pages = await mergedPdf.copyPages(srcPdf, srcPdf.getPageIndices());
    
    // Add pages and stamp every page
    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
      const page = pages[pageIdx];
      mergedPdf.addPage(page);
      
      // Stamp every page with the ACK number
      const { width, height } = page.getSize();
      
      // Draw ACK number at top center, above the header (bold)
      page.drawText(ackNumber, {
        x: width / 2 - 30, // Centered (adjust based on text width)
        y: height - 30,    // 30pt from top
        size: 14,
        font: fontBold,
        color: rgb(0, 0, 0)
      });
    }
    
    currentPage += pageCount;
  }
  
  // Generate output filenames with ACK range
  const firstAck = indexData[0].exhibit;
  const lastAck = indexData[indexData.length - 1].exhibit;
  const baseDir = path.dirname(outputPath);
  const mergedFilename = `${firstAck} - ${lastAck}.pdf`;
  const indexFilename = `${firstAck} - ${lastAck} Index.pdf`;
  const indexOdtFilename = `${firstAck} - ${lastAck} Index.odt`;
  const statementsOdtFilename = `${firstAck} - ${lastAck} Statements.odt`;
  const finalMergedPath = path.join(baseDir, mergedFilename);
  const finalIndexPath = path.join(baseDir, indexFilename);
  const finalIndexOdtPath = path.join(baseDir, indexOdtFilename);
  const finalStatementsOdtPath = path.join(baseDir, statementsOdtFilename);
  
  // Save merged PDF
  console.log(`\nSaving merged PDF to: ${finalMergedPath}`);
  const mergedBytes = await mergedPdf.save();
  await fs.writeFile(finalMergedPath, mergedBytes);
  
  console.log(`✓ Successfully merged ${pdfFiles.length} PDFs`);
  console.log(`  Total pages: ${mergedPdf.getPageCount()}`);
  
  // Generate index (PDF and ODT) if requested
  if (createIndex) {
    await generateIndex(indexData, finalIndexPath);
    console.log(`✓ Index PDF saved to: ${finalIndexPath}`);
    
    await generateIndexODT(indexData, finalIndexOdtPath);
    console.log(`✓ Index ODT saved to: ${finalIndexOdtPath}`);
    
    await generateStatementsODT(indexData, finalStatementsOdtPath);
    console.log(`✓ Statements ODT saved to: ${finalStatementsOdtPath}`);
  }
  
  // Add page numbers if requested
  if (addPageNumbers) {
    await addPageNumbersToDocument(finalMergedPath, finalMergedPath);
  }
  
  return { 
    mergedPath: finalMergedPath, 
    indexPath: finalIndexPath, 
    indexOdtPath: finalIndexOdtPath, 
    statementsOdtPath: finalStatementsOdtPath,
    indexData 
  };
}

/**
 * Add page numbers to an existing PDF document
 * This function now properly covers existing page numbers with white background first
 * then adds new page numbers to ensure clean numbering
 */
async function addPageNumbersToDocument(inputPath, outputPath) {
  console.log(`\nAdding page numbers to: ${inputPath}`);
  
  const pdfBytes = await fs.readFile(inputPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  
  const pages = pdfDoc.getPages();
  const fontSize = 14;
  
  // First pass: Cover all potential page number locations with white rectangles
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const { width, height } = page.getSize();
    
    // Calculate the position where page numbers would be placed
    const rightMargin = 30; // 30pt from right edge
    const yPosition = 30; // 30pt from bottom
    
    // Estimate text width for a 2-3 digit number (e.g., "24" or "124")
    // Using a conservative estimate to cover a wide range
    const maxTextWidth = 4 * fontSize * 0.6; // Enough for 4 digits
    
    // Draw a white rectangle to cover any existing page numbers
    // Making it extra large to ensure complete coverage
    page.drawRectangle({
      x: width - rightMargin - maxTextWidth - 10,
      y: yPosition - 10,
      width: maxTextWidth + 20,
      height: fontSize + 20,
      color: rgb(1, 1, 1), // White background
      borderOpacity: 0 // No border
    });
  }
  
  // Second pass: Add new page numbers
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const { width, height } = page.getSize();
    const pageNumber = String(i + 1);
    
    // Calculate text width and position
    const textWidth = pageNumber.length * fontSize * 0.6;
    const rightMargin = 30; // 30pt from right edge
    const xPosition = width - rightMargin - textWidth; // Right-aligned
    const yPosition = 30; // 30pt from bottom
    
    // Draw page number at bottom right corner
    page.drawText(pageNumber, {
      x: xPosition,
      y: yPosition,
      size: fontSize,
      font: font,
      color: rgb(0, 0, 0)
    });
  }
  
  const updatedBytes = await pdfDoc.save();
  await fs.writeFile(outputPath, updatedBytes);
  
  console.log(`✓ Page numbers added to ${pages.length} pages`);
}

/**
 * Regenerate index from an existing merged PDF by extracting ACK numbers
 */
async function regenerateIndexFromPDF(pdfPath, outputPath) {
  console.log(`\nRegenerating index from: ${pdfPath}`);
  
  // Load PDF with pdfjs for text extraction
  const pdfBytes = await fs.readFile(pdfPath);
  const pdfData = new Uint8Array(pdfBytes);
  
  // Set up the worker
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;
  
  const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
  
  const numPages = pdfDoc.numPages;
  console.log(`Processing ${numPages} pages`);
  
  // Extract ACK numbers and header information from each page
  const pageData = [];
  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const textContent = await page.getTextContent();
    
    // Extract text items with position information
    const textItems = textContent.items.map(item => ({
      str: item.str,
      transform: item.transform,
      // transform[4] and transform[5] contain x,y coordinates
      x: item.transform ? item.transform[4] : 0,
      y: item.transform ? item.transform[5] : 0
    }));
    
    // Look for ACK number pattern (ACK-XXX)
    const ackMatch = textItems.map(item => item.str).join(' ').match(/ACK-\d{3}/);
    const ackNumber = ackMatch ? ackMatch[0] : 'Unknown';
    
    pageData.push({
      pageNumber: i,
      ackNumber: ackNumber,
      textItems: textItems
    });
  }
  
  // Group pages by ACK number to build index
  const indexMap = new Map();
  
  for (const data of pageData) {
    if (!indexMap.has(data.ackNumber)) {
      indexMap.set(data.ackNumber, {
        exhibit: data.ackNumber,
        document: `Email from Unknown to Unknown`,
        date: 'Unknown',
        dateFull: 'Unknown',
        sender: 'Unknown',
        receiver: 'Unknown',
        pages: [],
        firstPageTextItems: data.textItems // Store text items from first page for parsing
      });
    }
    indexMap.get(data.ackNumber).pages.push(data.pageNumber);
  }
  
  // Parse sender, receiver, and date from the first page of each exhibit
  for (const [ackNumber, entry] of indexMap.entries()) {
    // Get text items from the first page of this exhibit
    const firstPageTextItems = entry.firstPageTextItems;
    
    // Try to extract sender, receiver, and date from email header
    const extractedData = extractEmailHeaderInfo(firstPageTextItems);
    
    // Update entry with extracted information
    entry.sender = extractedData.sender;
    entry.receiver = extractedData.receiver;
    entry.date = extractedData.dateFormatted;
    entry.dateFull = extractedData.dateFull;
    entry.document = `Email from ${extractedData.sender} to ${extractedData.receiver}`;
    
    // Clean up temporary data
    delete entry.firstPageTextItems;
  }
  
  // Format page ranges
  const indexData = [];
  for (const entry of indexMap.values()) {
    // Sort pages and format ranges
    entry.pages.sort((a, b) => a - b);
    
    // Format page ranges (simplified)
    let pagesStr = '';
    if (entry.pages.length === 1) {
      pagesStr = String(entry.pages[0]);
    } else {
      // Group consecutive pages into ranges
      const ranges = [];
      let start = entry.pages[0];
      let end = entry.pages[0];
      
      for (let i = 1; i < entry.pages.length; i++) {
        if (entry.pages[i] === end + 1) {
          end = entry.pages[i];
        } else {
          ranges.push(start === end ? `${start}` : `${start}-${end}`);
          start = entry.pages[i];
          end = entry.pages[i];
        }
      }
      ranges.push(start === end ? `${start}` : `${start}-${end}`);
      pagesStr = ranges.join(', ');
    }
    
    indexData.push({
      exhibit: entry.exhibit,
      document: entry.document,
      date: entry.date,
      dateFull: entry.dateFull,
      sender: entry.sender,
      receiver: entry.receiver,
      pages: pagesStr
    });
  }
  
  // Sort by exhibit number
  indexData.sort((a, b) => {
    const numA = parseInt(a.exhibit.split('-')[1]);
    const numB = parseInt(b.exhibit.split('-')[1]);
    return numA - numB;
  });
  
  // Generate output filenames
  const firstAck = indexData[0].exhibit;
  const lastAck = indexData[indexData.length - 1].exhibit;
  const baseDir = path.dirname(outputPath);
  const indexFilename = `${firstAck} - ${lastAck} Regenerated Index.pdf`;
  const indexOdtFilename = `${firstAck} - ${lastAck} Regenerated Index.odt`;
  const statementsOdtFilename = `${firstAck} - ${lastAck} Regenerated Statements.odt`;
  const finalIndexPath = path.join(baseDir, indexFilename);
  const finalIndexOdtPath = path.join(baseDir, indexOdtFilename);
  const finalStatementsOdtPath = path.join(baseDir, statementsOdtFilename);
  
  // Generate index files
  await generateIndex(indexData, finalIndexPath);
  console.log(`✓ Regenerated Index PDF saved to: ${finalIndexPath}`);
  
  await generateIndexODT(indexData, finalIndexOdtPath);
  console.log(`✓ Regenerated Index ODT saved to: ${finalIndexOdtPath}`);
  
  await generateStatementsODT(indexData, finalStatementsOdtPath);
  console.log(`✓ Regenerated Statements ODT saved to: ${finalStatementsOdtPath}`);
  
  return { 
    indexPath: finalIndexPath, 
    indexOdtPath: finalIndexOdtPath, 
    statementsOdtPath: finalStatementsOdtPath,
    indexData 
  };
}

/**
 * Extract sender, receiver, and date information from email header text items
 * This handles PDF text extraction where individual characters may be separate text items
 * @param {Array} textItems - Array of text items with position information
 * @returns {Object} Extracted information
 */
function extractEmailHeaderInfo(textItems) {
  // Default values
  const result = {
    sender: 'Unknown',
    receiver: 'Unknown',
    dateFormatted: 'Unknown',
    dateFull: 'Unknown'
  };
  
  // Reconstruct text by combining characters and grouping related items
  const reconstructedText = reconstructAndCleanText(textItems);
  
  // Extract sender from "From:" field
  const fromMatch = reconstructedText.match(/From:\s*["']([^"']*)["']/i);
  if (fromMatch) {
    result.sender = fromMatch[1].trim() || 'Unknown';
  } else {
    // Try without quotes
    const fromMatchNoQuotes = reconstructedText.match(/From:\s*([^<\n\r]+)/i);
    if (fromMatchNoQuotes) {
      result.sender = fromMatchNoQuotes[1].trim() || 'Unknown';
    }
  }
  
  // Extract receiver from "To:" field
  const toMatch = reconstructedText.match(/To:\s*["']([^"']*)["']/i);
  if (toMatch) {
    result.receiver = toMatch[1].trim() || 'Unknown';
  } else {
    // Try without quotes
    const toMatchNoQuotes = reconstructedText.match(/To:\s*([^<\n\r]+)/i);
    if (toMatchNoQuotes) {
      result.receiver = toMatchNoQuotes[1].trim() || 'Unknown';
    }
  }
  
  // Extract date from "Date:" field
  const dateMatch = reconstructedText.match(/Date:\s*([^\n\r]+)/i);
  if (dateMatch) {
    const dateString = dateMatch[1].trim();
    // Remove the timezone description in parentheses if present
    const cleanDateString = dateString.replace(/\s*\(.*?\)\s*$/, '').trim();
    result.dateFull = cleanDateString;
    
    // Parse date in format: Day Mon DD YYYY HH:MM:SS TZ
    // Example: Thu Apr 25 2024 09:01:38 GMT+1000
    const dateParsed = cleanDateString.match(/\w+\s+(\w+)\s+(\d{1,2})\s+(\d{4})/i);
    if (dateParsed) {
      const [, month, day, year] = dateParsed;
      
      // Convert month name to number
      const months = {
        'jan': '01', 'january': '01',
        'feb': '02', 'february': '02',
        'mar': '03', 'march': '03',
        'apr': '04', 'april': '04',
        'may': '05',
        'jun': '06', 'june': '06',
        'jul': '07', 'july': '07',
        'aug': '08', 'august': '08',
        'sep': '09', 'september': '09',
        'oct': '10', 'october': '10',
        'nov': '11', 'november': '11',
        'dec': '12', 'december': '12'
      };
      
      const monthNum = months[month.toLowerCase()] || '01';
      const dayPadded = day.padStart(2, '0');
      
      result.dateFormatted = `${dayPadded}.${monthNum}.${year}`;
    }
  }
  
  return result;
}

/**
 * Reconstruct and clean text from PDF text items, handling character-by-character extraction
 * @param {Array} textItems - Array of text items
 * @returns {string} Clean reconstructed text
 */
function reconstructAndCleanText(textItems) {
  if (textItems.length === 0) return '';
  
  // Sort items by Y coordinate (descending) then X coordinate (ascending)
  const sortedItems = [...textItems].sort((a, b) => {
    // If on different lines (Y difference is significant), sort by line (top to bottom)
    if (Math.abs(b.y - a.y) > 5) {
      return b.y - a.y; // Higher Y comes first (PDF Y=0 is bottom)
    }
    // If on same line, sort by X position (left to right)
    return a.x - b.x;
  });
  
  let reconstructed = '';
  let lastX = -1;
  let lastY = -1;
  
  for (let i = 0; i < sortedItems.length; i++) {
    const item = sortedItems[i];
    const currentX = item.x;
    const currentY = item.y;
    
    // If this is the first item
    if (lastX === -1) {
      reconstructed += item.str;
    }
    // If we're on a new line (significant Y difference)
    else if (Math.abs(currentY - lastY) > 5) {
      reconstructed += '\n' + item.str; // Add newline between lines
    }
    // If we're on the same line
    else {
      // Calculate expected next position (based on previous character width)
      const prevItem = sortedItems[i-1];
      const expectedX = lastX + (prevItem?.str?.length || 0) * 3; // Rough width estimate
      const gap = currentX - expectedX;
      
      if (gap > 15) {
        reconstructed += '  ' + item.str; // Large gap = word boundary
      } else if (gap > 5) {
        reconstructed += ' ' + item.str; // Medium gap = space
      } else {
        reconstructed += item.str; // No gap = part of same word
      }
    }
    
    lastX = currentX;
    lastY = currentY;
  }
  
  // Clean up the reconstructed text by removing extra spaces within words
  let cleanedText = reconstructed
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .replace(/\s+([:.,)!?])/g, '$1') // Remove space before punctuation
    .replace(/([(\s])\s+/g, '$1') // Remove extra spaces after punctuation or space
    .replace(/\sG\sM\sT/g, ' GMT') // Fix GMT spacing
    .replace(/\sQ\sld/g, ' Qld') // Fix Qld spacing
    .replace(/\scrown\s/g, ' crown') // Fix crown spacing
    .replace(/\sdecision\s/g, ' decision') // Fix decision spacing
    .replace(/\senquiry\s/g, ' enquiry') // Fix enquiry spacing
    .replace(/\sF\sro\sm:/g, 'From:') // Fix From spacing
    .replace(/\sT\so:/g, 'To:') // Fix To spacing
    .replace(/\sD\sate:/g, 'Date:') // Fix Date spacing
    .replace(/\sS\subject:/g, 'Subject:') // Fix Subject spacing
    .replace(/\sJ\saim\se\sM\sc\sI\sver/g, ' Jaime McIver') // Fix Jaime McIver spacing
    .replace(/\sA\ss\sh\sley\sK\sing/g, ' Ashley King') // Fix Ashley King spacing
    .trim();
  
  // Also remove spaces in email addresses
  cleanedText = cleanedText.replace(/([\w])\s+@/g, '$1@');
  cleanedText = cleanedText.replace(/@\s+([\w])/g, '@$1');
  cleanedText = cleanedText.replace(/(\.)\s+([a-z])/g, '$1$2');
  
  // Fix common word spacing issues
  const commonWords = [
    'crown', 'law', 'qld', 'gov', 'au', 
    'decision', 'enquiry', 'jaime', 'mciver',
    'ashley', 'king', 'subject', 'date', 'from', 'to',
    'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
    'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'
  ];
  
  commonWords.forEach(word => {
    const spacedWord = word.split('').join('\\s+');
    const regex = new RegExp(`\\s${spacedWord}\\s`, 'gi');
    cleanedText = cleanedText.replace(regex, ` ${word} `);
  });
  
  return cleanedText;
}

/**
 * Parse filename to extract metadata
 * Format: yyyy_mm_dd_hh_mm_sender_to_receiver.pdf
 */
function parseFilename(filename) {
  const nameWithoutExt = filename.replace('.pdf', '');
  const parts = nameWithoutExt.split('_');
  
  if (parts.length < 8) {
    // Fallback if filename doesn't match expected format
    return {
      sender: 'Unknown',
      receiver: 'Unknown',
      dateFormatted: 'Unknown',
      dateFull: 'Unknown'
    };
  }
  
  // Extract date parts
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  
  // Find "to" separator to split sender/receiver
  const toIndex = parts.indexOf('to');
  
  if (toIndex === -1) {
    const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const monthName = monthNames[parseInt(month)] || month;
    const dateFull = `${parseInt(day)} ${monthName} ${year}`;
    
    return {
      sender: 'Unknown',
      receiver: 'Unknown',
      dateFormatted: `${day}.${month}.${year}`,
      dateFull: dateFull
    };
  }
  
  // Sender is everything between time and "to"
  const sender = parts.slice(5, toIndex).join(' ').replace(/_/g, ' ');
  // Receiver is everything after "to"
  const receiver = parts.slice(toIndex + 1).join(' ').replace(/_/g, ' ');
  
  // Format date with month name (e.g., "3 September 2024")
  const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = monthNames[parseInt(month)] || month;
  const dateFull = `${parseInt(day)} ${monthName} ${year}`;
  
  return {
    sender: sender || 'Unknown',
    receiver: receiver || 'Unknown',
    dateFormatted: `${day}.${month}.${year}`, // For index table
    dateFull: dateFull, // For statements (e.g., "3 September 2024")
    day: parseInt(day),
    month: monthName,
    year: year
  };
}

/**
 * Generate index table as PDF
 */
async function generateIndex(indexData, outputPath) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  
  const page = doc.addPage([595, 842]); // A4 size
  const { width, height } = page.getSize();
  
  const margin = 50;
  let y = height - margin;
  
  // Title
  page.drawText('INDEX OF EXHIBITS', {
    x: margin,
    y: y,
    size: 16,
    font: fontBold,
    color: rgb(0, 0, 0)
  });
  
  y -= 30;
  
  // Table headers - calculate column positions
  const colWidths = { exhibit: 55, date: 60, pages: 40 };
  const rightMargin = 50;
  const columnSpacing = 0
  ; // Space between columns (matches Exhibit-Document spacing)
  
  // Calculate positions from right to left
  const pagesX = width - rightMargin - colWidths.pages;
  const dateX = pagesX - colWidths.date - columnSpacing; // Add spacing before Date
  const documentX = margin + colWidths.exhibit + columnSpacing; // Spacing after Exhibit
  const documentWidth = dateX - documentX; // Maximum space for Document
  
  const rowHeight = 20;
  const fontSize = 10;
  
  // Header row
  page.drawText('Exhibit', { x: margin, y, size: fontSize, font: fontBold });
  page.drawText('Document', { x: documentX, y, size: fontSize, font: fontBold });
  page.drawText('Date', { x: dateX, y, size: fontSize, font: fontBold });
  page.drawText('Page(s)', { x: pagesX, y, size: fontSize, font: fontBold });
  
  y -= 5;
  
  // Header underline
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 1,
    color: rgb(0, 0, 0)
  });
  
  y -= 15;
  
  // Data rows
  let currentPage = page;
  for (const entry of indexData) {
    // Check if we need a new page
    if (y < margin + 30) {
      currentPage = doc.addPage([595, 842]);
      y = height - margin;
    }
    
    currentPage.drawText(entry.exhibit, { x: margin, y, size: fontSize, font: fontBold });
    
    // Document text - truncate if too long to fit
    const maxDocChars = Math.floor(documentWidth / (fontSize * 0.6)); // Rough char estimate
    const docText = entry.document.length > maxDocChars
      ? entry.document.substring(0, maxDocChars - 3) + '...'
      : entry.document;
    
    currentPage.drawText(docText, { 
      x: documentX, 
      y, 
      size: fontSize, 
      font
    });
    
    // Date and Pages right-aligned
    currentPage.drawText(entry.date, { x: dateX, y, size: fontSize, font });
    currentPage.drawText(entry.pages, { x: pagesX, y, size: fontSize, font });
    
    y -= rowHeight;
  }
  
  const indexBytes = await doc.save();
  await fs.writeFile(outputPath, indexBytes);
}

/**
 * Generate statements document as PDF
 */
async function generateStatements(indexData, outputPath) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  
  const page = doc.addPage([595, 842]); // A4 size
  const { width, height } = page.getSize();
  
  const margin = 72; // 1 inch margins
  let y = height - margin;
  const lineHeight = 20;
  const fontSize = 12;
  const paragraphSpacing = 30;
  
  // Title
  page.drawText('STATEMENTS OF EXHIBITS', {
    x: margin,
    y: y,
    size: 16,
    font: font,
    color: rgb(0, 0, 0)
  });
  
  y -= 40;
  
  // Generate statements for each exhibit
  let currentPage = page;
  
  for (const entry of indexData) {
    // Check if we need a new page
    if (y < margin + 60) {
      currentPage = doc.addPage([595, 842]);
      y = height - margin;
    }
    
    // Format the statement with bold text
    // "On 3 September 2024, an email was sent from @email to @email "about/including a letter". Exhibit ACK-001 is a copy of the email to @email from @email dated 3 September 2024."
    const beforeBold = `On ${entry.dateFull}, an email was sent from ${entry.sender} to ${entry.receiver} `;
    const boldText = `about/including a letter`;
    const afterBold1 = `. Exhibit `;
    const ackNumber = entry.exhibit;
    const afterBold2 = ` is a copy of the email to ${entry.receiver} from ${entry.sender} dated ${entry.dateFull}.`;
    
    // Draw statement with mixed formatting
    let currentX = margin;
    const maxWidth = width - 2 * margin;
    
    // Split and draw text, handling line breaks and bold formatting
    const allParts = [
      { text: beforeBold, isBold: false },
      { text: boldText, isBold: true },
      { text: afterBold1, isBold: false },
      { text: ackNumber, isBold: true },
      { text: afterBold2, isBold: false }
    ];
    
    for (const part of allParts) {
      const partFont = part.isBold ? fontBold : font;
      const words = part.text.split(' ');
      
      for (const word of words) {
        const testText = (currentX === margin ? '' : ' ') + word;
        const textWidth = partFont.widthOfTextAtSize(testText, fontSize);
        
        // Check if we need a new line
        if (currentX + textWidth > width - margin && currentX > margin) {
          currentX = margin;
          y -= lineHeight;
          
          // Check if we need a new page
          if (y < margin + 30) {
            currentPage = doc.addPage([595, 842]);
            y = height - margin;
          }
        }
        
        // Draw the word
        if (currentX > margin) {
          currentX += partFont.widthOfTextAtSize(' ', fontSize);
        }
        
        currentPage.drawText(word, {
          x: currentX,
          y: y,
          size: fontSize,
          font: partFont,
          color: rgb(0, 0, 0)
        });
        
        currentX += partFont.widthOfTextAtSize(word, fontSize);
      }
    }
    
    // Move to next line after statement
    y -= lineHeight;
    
    // Add spacing between statements
    y -= paragraphSpacing;
  }
  
  const statementsBytes = await doc.save();
  await fs.writeFile(outputPath, statementsBytes);
}

/**
 * Generate statements document as ODT (OpenOffice Writer) file
 */
async function generateStatementsODT(indexData, outputPath) {
  const zip = new JSZip();
  
  // mimetype file (must be first and uncompressed)
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', {
    compression: 'STORE',
    compressionOptions: { level: 0 }
  });
  
  // Build statements paragraphs
  let statementsContent = '';
  for (const entry of indexData) {
    const beforeBold = `On ${escapeXml(entry.dateFull)}, an email was sent from ${escapeXml(entry.sender)} to ${escapeXml(entry.receiver)} `;
    const boldText = `about/including a letter`;
    const afterBold1 = `. Exhibit `;
    const ackNumber = escapeXml(entry.exhibit);
    const afterBold2 = ` is a copy of the email to ${escapeXml(entry.receiver)} from ${escapeXml(entry.sender)} dated ${escapeXml(entry.dateFull)}.`;
    
    statementsContent += `
      <text:p text:style-name="Text_20_body">${beforeBold}<text:span text:style-name="T1">${boldText}</text:span>${afterBold1}<text:span text:style-name="T1">${ackNumber}</text:span>${afterBold2}</text:p>
      <text:p text:style-name="Text_20_body"/>`;
  }
  
  // content.xml - main document with statements
  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  office:version="1.2">
  <office:styles>
    <style:style style:name="Standard" style:family="paragraph" style:class="text">
      <style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.2cm"/>
    </style:style>
    <style:style style:name="Heading_20_1" style:family="paragraph" style:parent-style-name="Standard">
      <style:text-properties fo:font-size="16pt" fo:font-weight="bold"/>
      <style:paragraph-properties fo:margin-top="0.423cm" fo:margin-bottom="0.423cm"/>
    </style:style>
    <style:style style:name="Text_20_body" style:family="paragraph" style:parent-style-name="Standard">
      <style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.35cm" fo:text-indent="0cm"/>
    </style:style>
  </office:styles>
  <office:automatic-styles>
    <style:style style:name="T1" style:family="text">
      <style:text-properties fo:font-weight="bold"/>
    </style:style>
  </office:automatic-styles>
  <office:body>
    <office:text>
      <text:h text:style-name="Heading_20_1" text:outline-level="1">STATEMENTS OF EXHIBITS</text:h>
      ${statementsContent}
    </office:text>
  </office:body>
</office:document-content>`;
  
  zip.file('content.xml', contentXml);
  
  // styles.xml
  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  office:version="1.2">
  <office:font-face-decls/>
  <office:styles>
    <style:default-style style:family="paragraph">
      <style:paragraph-properties fo:hyphenation-ladder-count="no-limit" style:text-autospace="ideograph-alpha" style:punctuation-wrap="hanging" style:line-break="strict" style:tab-stop-distance="1.25cm" style:writing-mode="lr-tb"/>
      <style:text-properties style:use-window-font-color="true" fo:font-size="12pt" fo:language="en" fo:country="US" style:letter-kerning="true" style:font-name-asian="Times New Roman" style:font-size-asian="12pt" style:language-asian="none" style:country-asian="none" style:font-name-complex="Tahoma1" style:font-size-complex="12pt" style:language-complex="none" style:country-complex="none"/>
    </style:default-style>
  </office:styles>
</office:document-styles>`;
  
  zip.file('styles.xml', stylesXml);
  
  // meta.xml
  const metaXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xlink="http://www.w3.org/1999/xlink" office:version="1.2">
  <office:meta>
    <meta:generator>PDF Merger &amp; Stamper</meta:generator>
    <dc:title>Statements of Exhibits</dc:title>
    <dc:description>Statements describing each exhibit</dc:description>
    <meta:creation-date>${new Date().toISOString()}</meta:creation-date>
  </office:meta>
</office:document-meta>`;
  
  zip.file('meta.xml', metaXml);
  
  // META-INF/manifest.xml
  const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="mimetype" manifest:media-type="text/plain"/>
</manifest:manifest>`;
  
  zip.folder('META-INF').file('manifest.xml', manifestXml);
  
  // Generate ODT file
  const odtBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
  
  await fs.writeFile(outputPath, odtBuffer);
}

/**
 * Escape XML special characters
 */
function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate index table as ODT (OpenOffice Writer) file
 */
async function generateIndexODT(indexData, outputPath) {
  const zip = new JSZip();
  
  // mimetype file (must be first and uncompressed)
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', {
    compression: 'STORE',
    compressionOptions: { level: 0 }
  });
  
  // content.xml - main document with table
  let tableRows = '';
  for (const entry of indexData) {
    tableRows += `
      <table:table-row>
        <table:table-cell table:style-name="Table_20_A1" office:value-type="string">
          <text:p text:style-name="Table_20_Contents"><text:span text:style-name="T1">${escapeXml(entry.exhibit)}</text:span></text:p>
        </table:table-cell>
        <table:table-cell table:style-name="Table_20_A1" office:value-type="string">
          <text:p text:style-name="Table_20_Contents">${escapeXml(entry.document)}</text:p>
        </table:table-cell>
        <table:table-cell table:style-name="Table_20_A1" office:value-type="string">
          <text:p text:style-name="Table_20_Contents">${escapeXml(entry.date)}</text:p>
        </table:table-cell>
        <table:table-cell table:style-name="Table_20_A1" office:value-type="string">
          <text:p text:style-name="Table_20_Contents">${escapeXml(entry.pages)}</text:p>
        </table:table-cell>
      </table:table-row>`;
  }
  
  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  office:version="1.2">
  <office:styles>
    <style:style style:name="Standard" style:family="paragraph" style:class="text"/>
    <style:style style:name="Heading_20_1" style:family="paragraph" style:parent-style-name="Standard">
      <style:text-properties fo:font-size="16pt" fo:font-weight="bold"/>
    </style:style>
    <style:style style:name="Table" style:family="table">
      <style:table-properties style:width="17.59cm" table:align="left"/>
    </style:style>
    <style:style style:name="Table_20_Heading" style:family="paragraph" style:parent-style-name="Table_20_Contents">
      <style:text-properties fo:font-weight="bold"/>
    </style:style>
    <style:style style:name="Table_20_Contents" style:family="paragraph" style:parent-style-name="Standard">
      <style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.2cm"/>
    </style:style>
    <style:style style:name="Table_20_A1" style:family="table-cell">
      <style:table-cell-properties fo:padding="0.1cm" fo:border="0.05pt solid #000000"/>
    </style:style>
  </office:styles>
  <office:automatic-styles>
    <style:style style:name="co1" style:family="table-column">
      <style:table-column-properties style:column-width="2.0cm"/>
    </style:style>
    <style:style style:name="co2" style:family="table-column">
      <style:table-column-properties style:column-width="10.0cm"/>
    </style:style>
    <style:style style:name="co3" style:family="table-column">
      <style:table-column-properties style:column-width="3.0cm"/>
    </style:style>
    <style:style style:name="co4" style:family="table-column">
      <style:table-column-properties style:column-width="2.59cm"/>
    </style:style>
    <style:style style:name="T1" style:family="text">
      <style:text-properties fo:font-weight="bold"/>
    </style:style>
  </office:automatic-styles>
  <office:body>
    <office:text>
      <text:h text:style-name="Heading_20_1" text:outline-level="1">INDEX OF EXHIBITS</text:h>
      <table:table table:name="IndexTable" table:style-name="Table">
        <table:table-column table:style-name="co1"/>
        <table:table-column table:style-name="co2"/>
        <table:table-column table:style-name="co3"/>
        <table:table-column table:style-name="co4"/>
        <table:table-header-rows>
          <table:table-row>
            <table:table-cell table:style-name="Table_20_A1" office:value-type="string">
              <text:p text:style-name="Table_20_Heading">Exhibit</text:p>
            </table:table-cell>
            <table:table-cell table:style-name="Table_20_A1" office:value-type="string">
              <text:p text:style-name="Table_20_Heading">Document</text:p>
            </table:table-cell>
            <table:table-cell table:style-name="Table_20_A1" office:value-type="string">
              <text:p text:style-name="Table_20_Heading">Date</text:p>
            </table:table-cell>
            <table:table-cell table:style-name="Table_20_A1" office:value-type="string">
              <text:p text:style-name="Table_20_Heading">Page(s)</text:p>
            </table:table-cell>
          </table:table-row>
        </table:table-header-rows>
        ${tableRows}
      </table:table>
    </office:text>
  </office:body>
</office:document-content>`;
  
  zip.file('content.xml', contentXml);
  
  // styles.xml
  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  office:version="1.2">
  <office:font-face-decls/>
  <office:styles>
    <style:default-style style:family="paragraph">
      <style:paragraph-properties fo:hyphenation-ladder-count="no-limit" style:text-autospace="ideograph-alpha" style:punctuation-wrap="hanging" style:line-break="strict" style:tab-stop-distance="1.25cm" style:writing-mode="lr-tb"/>
      <style:text-properties style:use-window-font-color="true" fo:font-size="12pt" fo:language="en" fo:country="US" style:letter-kerning="true" style:font-name-asian="Times New Roman" style:font-size-asian="12pt" style:language-asian="none" style:country-asian="none" style:font-name-complex="Tahoma1" style:font-size-complex="12pt" style:language-complex="none" style:country-complex="none"/>
    </style:default-style>
  </office:styles>
</office:document-styles>`;
  
  zip.file('styles.xml', stylesXml);
  
  // meta.xml
  const metaXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xlink="http://www.w3.org/1999/xlink" office:version="1.2">
  <office:meta>
    <meta:generator>PDF Merger &amp; Stamper</meta:generator>
    <dc:title>Index of Exhibits</dc:title>
    <dc:description>Index of exhibits with ACK numbers</dc:description>
    <meta:creation-date>${new Date().toISOString()}</meta:creation-date>
  </office:meta>
</office:document-meta>`;
  
  zip.file('meta.xml', metaXml);
  
  // META-INF/manifest.xml
  const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="mimetype" manifest:media-type="text/plain"/>
</manifest:manifest>`;
  
  zip.folder('META-INF').file('manifest.xml', manifestXml);
  
  // Generate ODT file
  // For ODT compliance: mimetype must be first and uncompressed
  const odtBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
  
  await fs.writeFile(outputPath, odtBuffer);
}

// CLI usage
const args = process.argv.slice(2);
const command = args[0];

if (!command) {
  console.error('Usage: node merge-stamp.js <command> [options]');
  console.error('Commands:');
  console.error('  merge <input-directory> [output.pdf]    - Merge and stamp PDFs');
  console.error('  paginate <file>                         - Add page numbers to existing PDF');
  console.error('  regenerate <file> [output-directory]    - Regenerate index from existing PDF');
  console.error('');
  console.error('Examples:');
  console.error('  node merge-stamp.js merge "/path/to/pdfs" output.pdf');
  console.error('  node merge-stamp.js paginate "/path/to/merged.pdf"');
  console.error('  node merge-stamp.js regenerate "/path/to/merged.pdf" "/path/to/output"');
  process.exit(1);
}

// Handle different commands
if (command === 'paginate') {
  const filePath = args[1];
  if (!filePath) {
    console.error('Error: File path is required for paginate command');
    process.exit(1);
  }
  
  // Add page numbers to existing PDF
  addPageNumbersToDocument(filePath, filePath)
    .then(() => console.log('Page numbers added successfully'))
    .catch(err => {
      console.error('Error adding page numbers:', err);
      process.exit(1);
    });
} else if (command === 'regenerate') {
  const filePath = args[1];
  const outputDir = args[2] || path.dirname(filePath);
  
  if (!filePath) {
    console.error('Error: File path is required for regenerate command');
    process.exit(1);
  }
  
  // Regenerate index from existing PDF
  const outputPath = path.join(outputDir, 'regenerated-index.pdf');
  regenerateIndexFromPDF(filePath, outputPath)
    .then(() => console.log('Index regeneration completed'))
    .catch(err => {
      console.error('Error regenerating index:', err);
      process.exit(1);
    });
} else if (command === 'merge') {
  const inputDir = args[1];
  const outputPath = args[2] || path.join(inputDir || '.', 'merged-acknowledgments.pdf');
  
  if (!inputDir) {
    console.error('Error: Input directory is required for merge command');
    process.exit(1);
  }
  
  mergeAndStampPDFs(inputDir, outputPath)
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
} else {
  console.error(`Error: Unknown command '${command}'`);
  console.error('Valid commands are: merge, paginate, regenerate');
  process.exit(1);
}
