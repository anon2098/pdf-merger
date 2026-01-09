import fs from 'fs/promises';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Set up worker for pdfjs
const workerPath = resolve(__dirname, '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');

async function debugPDFTextExtraction(pdfPath) {
  console.log(`Debugging text extraction from: ${pdfPath}\n`);
  
  try {
    // Load PDF with pdfjs for text extraction
    const pdfBytes = await fs.readFile(pdfPath);
    const pdfData = new Uint8Array(pdfBytes);
    
    // Set up the worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;
    
    const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
    
    const numPages = pdfDoc.numPages;
    console.log(`Processing ${numPages} pages\n`);
    
    // Extract text from each page (check first few pages)
    for (let i = 1; i <= Math.min(5, numPages); i++) {
      console.log(`=== PAGE ${i} ===`);
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      
      console.log(`Found ${textContent.items.length} text items:`);
      
      // Show first 20 text items to get a sense of the structure
      const itemsToShow = Math.min(30, textContent.items.length);
      for (let j = 0; j < itemsToShow; j++) {
        const item = textContent.items[j];
        console.log(`  ${j}: "${item.str}" (x: ${item.transform ? Math.round(item.transform[4]) : 'N/A'}, y: ${item.transform ? Math.round(item.transform[5]) : 'N/A'})`);
      }
      
      if (textContent.items.length > itemsToShow) {
        console.log(`  ... (${textContent.items.length - itemsToShow} more items)`);
      }
      
      // Join all text to see the full content
      const allText = textContent.items.map(item => item.str).join(' ');
      console.log(`\nFull joined text (first 500 chars): "${allText.substring(0, 500)}..."`);
      
      // Try to extract sender, receiver, and date
      const fromIndex = allText.indexOf('From:');
      const toIndex = allText.indexOf('To:');
      const dateIndex = allText.indexOf('Date:');
      
      console.log(`\nField indices:`);
      console.log(`  From found at index: ${fromIndex}`);
      console.log(`  To found at index: ${toIndex}`);
      console.log(`  Date found at index: ${dateIndex}`);
      
      if (fromIndex !== -1) {
        const fromPart = extractPart(allText, fromIndex, ['To:', 'Date:', 'Subject:']);
        console.log(`\nFrom part: "${fromPart}"`);
        const sender = extractFieldValue(fromPart, 'From:');
        console.log(`  Extracted sender: "${sender}"`);
      }
      
      if (toIndex !== -1) {
        const toPart = extractPart(allText, toIndex, ['From:', 'Date:', 'Subject:']);
        console.log(`\nTo part: "${toPart}"`);
        const receiver = extractFieldValue(toPart, 'To:');
        console.log(`  Extracted receiver: "${receiver}"`);
      }
      
      if (dateIndex !== -1) {
        const datePart = extractPart(allText, dateIndex, ['From:', 'To:', 'Subject:']);
        console.log(`\nDate part: "${datePart}"`);
        const dateInfo = extractDateInfo(datePart);
        console.log(`  Extracted dateFull: "${dateInfo.dateFull}"`);
        console.log(`  Extracted dateFormatted: "${dateInfo.dateFormatted}"`);
      }
      
      console.log('\n' + '='.repeat(50) + '\n');
    }
  } catch (error) {
    console.error('Error debugging PDF text extraction:', error);
  }
}

function extractPart(text, startIndex, stopMarkers) {
  let part = text.substring(startIndex);
  const nextFieldIndexes = stopMarkers
    .map(marker => text.indexOf(marker, startIndex + 1))
    .filter(idx => idx !== -1 && idx > startIndex);
  
  if (nextFieldIndexes.length > 0) {
    const endIndex = Math.min(...nextFieldIndexes);
    part = part.substring(0, endIndex - startIndex);
  }
  
  return part;
}

function extractFieldValue(fieldPart, fieldName) {
  // Handle quoted names (both single and double quotes)
  let value = 'Unknown';
  const doubleQuoteStart = fieldPart.indexOf('"');
  if (doubleQuoteStart !== -1) {
    const doubleQuoteEnd = fieldPart.indexOf('"', doubleQuoteStart + 1);
    if (doubleQuoteEnd !== -1) {
      value = fieldPart.substring(doubleQuoteStart + 1, doubleQuoteEnd).trim();
    }
  } else {
    const singleQuoteStart = fieldPart.indexOf("'");
    if (singleQuoteStart !== -1) {
      // Find the LAST single quote to handle names with apostrophes
      const singleQuoteEnd = fieldPart.lastIndexOf("'");
      if (singleQuoteEnd > singleQuoteStart) {
        value = fieldPart.substring(singleQuoteStart + 1, singleQuoteEnd).trim();
      }
    } else {
      // No quotes - extract value before <email> or end of part
      const emailStart = fieldPart.indexOf('<');
      if (emailStart !== -1) {
        value = fieldPart.substring(fieldPart.indexOf(fieldName) + fieldName.length, emailStart).trim();
      } else {
        // Just extract everything after field name until end of part
        value = fieldPart.substring(fieldPart.indexOf(fieldName) + fieldName.length).trim();
      }
    }
  }
  
  return value || 'Unknown';
}

function extractDateInfo(datePart) {
  const result = {
    dateFull: 'Unknown',
    dateFormatted: 'Unknown'
  };
  
  const dateMatch = datePart.match(/Date:\s*(.+)/i);
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

// Get PDF file path from command line argument
const args = process.argv.slice(2);
const pdfPath = args[0] || '/Users/admin/Desktop/Finish affidavit/ACK-001 - ACK-114.pdf';

debugPDFTextExtraction(pdfPath);
