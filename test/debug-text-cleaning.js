import fs from 'fs/promises';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Set up worker for pdfjs
const workerPath = resolve(__dirname, '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');

// Copy the reconstruction and cleaning functions
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
  
  console.log('Raw reconstructed text (first 500 chars):');
  console.log(reconstructed.substring(0, 500) + '...');
  console.log('\n---\n');
  
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
    .replace(/\sJ\saim\se\sM\sc\sI\sver/g, ' Jaime McIver ') // Fix Jaime McIver spacing
    .replace(/\sA\ss\sh\sley\sK\sing/g, ' Ashley King ') // Fix Ashley King spacing
    .replace(/\sC\sar\soline\sH\sel\sm\san/g, ' Caroline Helman ') // Fix Caroline Helman spacing
    .trim();
  
  // Also remove spaces in email addresses and common words
  cleanedText = cleanedText.replace(/([\w])\s+@/g, '$1@');
  cleanedText = cleanedText.replace(/@\s+([\w])/g, '@$1');
  cleanedText = cleanedText.replace(/(\.)\s+([a-z])/g, '$1$2');
  cleanedText = cleanedText.replace(/p\s+r\s+o\s+t\s+o\s+n/g, 'proton');
  cleanedText = cleanedText.replace(/m\s+e\s*>/g, 'me>');
  cleanedText = cleanedText.replace(/G\s+M\s+T/g, 'GMT');
  cleanedText = cleanedText.replace(/T\s+i\s+m\s+e/g, 'Time');
  cleanedText = cleanedText.replace(/S\s+t\s+a\s+n\s+d\s+a\s+r\s+d/g, 'Standard');
  cleanedText = cleanedText.replace(/E\s+a\s+s\s+t\s+e\s+r\s+n/g, 'Eastern');
  cleanedText = cleanedText.replace(/A\s+u\s+s\s+t\s+r\s+a\s+l\s+i\s+a\s+n/g, 'Australian');
  
  // Fix common word spacing issues using a more robust approach
  const commonWords = [
    'crown', 'law', 'qld', 'gov', 'au', 
    'decision', 'enquiry', 'jaime', 'mciver', 'ashley', 'king',
    'subject', 'date', 'from', 'to', 'jan', 'feb', 'mar', 'apr', 
    'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
    'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'caroline', 
    'helman', 'proton', 'me', 'gmt', 'time', 'standard', 'eastern', 
    'australian', 'attachments'
  ];
  
  commonWords.forEach(word => {
    // Create regex pattern to match spaced versions of the word
    if (word.length > 1) {
      const spacedWord = word.split('').join('\\s+');
      const regex = new RegExp(`\\s${spacedWord}(?=\\W|$)`, 'gi');
      cleanedText = cleanedText.replace(regex, ` ${word}`);
    }
  });
  
  // Clean up multiple spaces
  cleanedText = cleanedText.replace(/\s+/g, ' ');
  
  console.log('Cleaned text (first 500 chars):');
  console.log(cleanedText.substring(0, 500) + '...');
  console.log('\n---\n');
  
  return cleanedText;
}

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
    console.log('Found sender:', result.sender);
  } else {
    // Try without quotes
    const fromMatchNoQuotes = reconstructedText.match(/From:\s*([^<\n\r]+)/i);
    if (fromMatchNoQuotes) {
      result.sender = fromMatchNoQuotes[1].trim() || 'Unknown';
      console.log('Found sender (no quotes):', result.sender);
    }
  }
  
  // Extract receiver from "To:" field (stop before Subject, Date, or end)
  const toSection = reconstructedText.match(/To:.*?(?=\n(?:Subject:|Date:|From:|$))/i);
  if (toSection) {
    const toText = toSection[0];
    console.log('To section (first 100 chars):', toText.substring(0, 100));
    const toMatch = toText.match(/To:\s*["']([^"']*)["']/i);
    if (toMatch) {
      result.receiver = toMatch[1].trim() || 'Unknown';
      console.log('Found receiver (quoted):', result.receiver);
    } else {
      // Try without quotes (stop before < or end of line)
      const toMatchNoQuotes = toText.match(/To:\s*([^<\n\r]+)/i);
      if (toMatchNoQuotes) {
        result.receiver = toMatchNoQuotes[1].trim() || 'Unknown';
        console.log('Found receiver (no quotes):', result.receiver);
      }
    }
  }
  
  // Extract date from "Date:" field (stop before next field or end of line)
  const dateSection = reconstructedText.match(/Date:.*?(?=\n(?:From:|To:|Subject:|$))/i);
  if (dateSection) {
    const dateText = dateSection[0];
    console.log('Date section (first 100 chars):', dateText.substring(0, 100));
    const dateMatch = dateText.match(/Date:\s*(.+)$/i);
    if (dateMatch) {
      const dateString = dateMatch[1].trim();
      // Remove the timezone description in parentheses if present, but only if it ends a sentence
      const cleanDateString = dateString.replace(/\s*\(.*?\)(?=\s*$)/, '').trim();
      result.dateFull = cleanDateString;
      console.log('Found date full:', result.dateFull);
      
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
        console.log('Formatted date:', result.dateFormatted);
      }
    }
  }
  
  console.log('Final extracted data:', result);
  return result;
}

async function debugPDFTextExtraction(pdfPath, pageNumber = 1) {
  console.log(`Debugging text extraction from page ${pageNumber} of: ${pdfPath}\n`);
  
  try {
    // Load PDF with pdfjs for text extraction
    const pdfBytes = await fs.readFile(pdfPath);
    const pdfData = new Uint8Array(pdfBytes);
    
    // Set up the worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;
    
    const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
    
    if (pageNumber > pdfDoc.numPages) {
      console.error(`Page ${pageNumber} doesn't exist. PDF has ${pdfDoc.numPages} pages.`);
      return;
    }
    
    const page = await pdfDoc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    
    // Extract text items with position information
    const textItems = textContent.items.map(item => ({
      str: item.str,
      transform: item.transform,
      // transform[4] and transform[5] contain x,y coordinates
      x: item.transform ? item.transform[4] : 0,
      y: item.transform ? item.transform[5] : 0
    }));
    
    console.log(`Found ${textContent.items.length} text items on page ${pageNumber}:`);
    
    // Show first 20 text items to get a sense of the structure
    const itemsToShow = Math.min(30, textContent.items.length);
    for (let j = 0; j < itemsToShow; j++) {
      const item = textContent.items[j];
      console.log(`  ${j}: "${item.str}" (x: ${item.transform ? Math.round(item.transform[4]) : 'N/A'}, y: ${item.transform ? Math.round(item.transform[5]) : 'N/A'})`);
    }
    
    if (textContent.items.length > itemsToShow) {
      console.log(`  ... (${textContent.items.length - itemsToShow} more items)`);
    }
    
    console.log('\n=== TEXT EXTRACTION DEBUG ===');
    const extractedData = extractEmailHeaderInfo(textItems);
    
    console.log('\n=== FINAL RESULT ===');
    console.log(extractedData);
    
  } catch (error) {
    console.error('Error debugging PDF text extraction:', error);
  }
}

// Get PDF file path and page number from command line arguments
const args = process.argv.slice(2);
const pdfPath = args[0] || '/Users/admin/Desktop/Finish affidavit/ACK-001 - ACK-114 Exhibits.pdf';
const pageNumber = parseInt(args[1]) || 1;

debugPDFTextExtraction(pdfPath, pageNumber);
