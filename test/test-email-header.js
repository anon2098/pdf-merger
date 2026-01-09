import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Extract sender, receiver, and date information from email header text items
 * Based on actual email format found in PDFs: 
 * From: "Name" <email>
 * To: "Name" <email>
 * Date: Day Mon DD YYYY HH:MM:SS TZ (Australian Eastern Standard Time)
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
  
  // Join all text items with spaces to preserve separation
  const allText = textItems.map(item => item.str).join(' ');
  
  console.log('Full text for analysis:', allText);
  
  // Extract sender from "From:" field
  const fromIndex = allText.indexOf('From:');
  if (fromIndex !== -1) {
    // Extract the From: part until the next field or end of text
    let fromPart = allText.substring(fromIndex);
    const toIndex = allText.indexOf('To:', fromIndex);
    const dateIndex = allText.indexOf('Date:', fromIndex);
    const subjectIndex = allText.indexOf('Subject:', fromIndex);
    
    // Find the earliest occurrence of the next field
    let endIndex = fromPart.length; // Default to end of string
    const nextFields = [toIndex, dateIndex, subjectIndex].filter(idx => idx !== -1 && idx > fromIndex);
    if (nextFields.length > 0) {
      endIndex = Math.min(...nextFields) - fromIndex;
    }
    
    fromPart = fromPart.substring(0, endIndex);
    console.log('From part:', fromPart);
    
    // Handle quoted names (both single and double quotes)
    let senderName = 'Unknown';
    const doubleQuoteStart = fromPart.indexOf('"');
    if (doubleQuoteStart !== -1) {
      const doubleQuoteEnd = fromPart.indexOf('"', doubleQuoteStart + 1);
      if (doubleQuoteEnd !== -1) {
        senderName = fromPart.substring(doubleQuoteStart + 1, doubleQuoteEnd).trim();
      }
    } else {
      const singleQuoteStart = fromPart.indexOf("'");
      if (singleQuoteStart !== -1) {
        // Find the LAST single quote to handle names with apostrophes
        const singleQuoteEnd = fromPart.lastIndexOf("'");
        if (singleQuoteEnd > singleQuoteStart) {
          senderName = fromPart.substring(singleQuoteStart + 1, singleQuoteEnd).trim();
        }
      } else {
        // No quotes - extract name before <email> or end of part
        const emailStart = fromPart.indexOf('<');
        if (emailStart !== -1) {
          senderName = fromPart.substring(fromPart.indexOf('From:') + 5, emailStart).trim();
        } else {
          // Just extract everything after From: until end of part
          senderName = fromPart.substring(fromPart.indexOf('From:') + 5).trim();
        }
      }
    }
    result.sender = senderName || 'Unknown';
  }
  
  // Extract receiver from "To:" field
  const toIndex = allText.indexOf('To:');
  if (toIndex !== -1) {
    // Extract the To: part until the next field or end of text
    let toPart = allText.substring(toIndex);
    const fromIndex = allText.indexOf('From:', toIndex);
    const dateIndex = allText.indexOf('Date:', toIndex);
    const subjectIndex = allText.indexOf('Subject:', toIndex);
    
    // Find the earliest occurrence of the next field
    let endIndex = toPart.length; // Default to end of string
    const nextFields = [fromIndex, dateIndex, subjectIndex].filter(idx => idx !== -1 && idx > toIndex);
    if (nextFields.length > 0) {
      endIndex = Math.min(...nextFields) - toIndex;
    }
    
    toPart = toPart.substring(0, endIndex);
    console.log('To part:', toPart);
    
    // Handle quoted names (both single and double quotes)
    let receiverName = 'Unknown';
    const doubleQuoteStart = toPart.indexOf('"');
    if (doubleQuoteStart !== -1) {
      const doubleQuoteEnd = toPart.indexOf('"', doubleQuoteStart + 1);
      if (doubleQuoteEnd !== -1) {
        receiverName = toPart.substring(doubleQuoteStart + 1, doubleQuoteEnd).trim();
      }
    } else {
      const singleQuoteStart = toPart.indexOf("'");
      if (singleQuoteStart !== -1) {
        // Find the LAST single quote to handle names with apostrophes
        const singleQuoteEnd = toPart.lastIndexOf("'");
        if (singleQuoteEnd > singleQuoteStart) {
          receiverName = toPart.substring(singleQuoteStart + 1, singleQuoteEnd).trim();
        }
      } else {
        // No quotes - extract name before <email> or end of part
        const emailStart = toPart.indexOf('<');
        if (emailStart !== -1) {
          receiverName = toPart.substring(toPart.indexOf('To:') + 3, emailStart).trim();
        } else {
          // Just extract everything after To: until end of part
          receiverName = toPart.substring(toPart.indexOf('To:') + 3).trim();
        }
      }
    }
    result.receiver = receiverName || 'Unknown';
  }
  
  // Extract date from "Date:" field
  const dateIndex = allText.indexOf('Date:');
  if (dateIndex !== -1) {
    // Extract the date part until the next field or end of text
    let datePart = allText.substring(dateIndex);
    const fromIndex = allText.indexOf('From:', dateIndex);
    const toIndex = allText.indexOf('To:', dateIndex);
    const subjectIndex = allText.indexOf('Subject:', dateIndex);
    
    // Find the earliest occurrence of the next field
    let endIndex = datePart.length; // Default to end of string
    const nextFields = [fromIndex, toIndex, subjectIndex].filter(idx => idx !== -1 && idx > dateIndex);
    if (nextFields.length > 0) {
      endIndex = Math.min(...nextFields) - dateIndex;
    }
    
    datePart = datePart.substring(0, endIndex);
    console.log('Date part:', datePart);
    
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
        console.log(`Parsed date: day=${day}, month=${month}, year=${year}, formatted=${result.dateFormatted}`);
      }
    }
  }
  
  return result;
}

// Test with the actual email format from your example
async function runTests() {
  console.log('Testing email header extraction with actual PDF format...\n');
  
  // Test case 1: Your actual example
  const test1 = [
    { str: 'ACK-004' },
    { str: 'From:' },
    { str: ' ' },
    { str: '"Decision Enquiry"' },
    { str: ' ' },
    { str: '<decisionenquiry@proton.me>' },
    { str: 'To:' },
    { str: ' ' },
    { str: '"Jaime McIver"' },
    { str: ' ' },
    { str: '<Jaime.McIver@crownlaw.qld.gov.au>' },
    { str: 'Subject:' },
    { str: ' ' },
    { str: 'RE:' },
    { str: ' ' },
    { str: 'King' },
    { str: '-' },
    { str: 'v-' },
    { str: ' ' },
    { str: 'State' },
    { str: ' ' },
    { str: 'of' },
    { str: ' ' },
    { str: 'Queensland' },
    { str: 'Date:' },
    { str: ' ' },
    { str: 'Thu' },
    { str: ' ' },
    { str: 'Apr' },
    { str: ' ' },
    { str: '25' },
    { str: ' ' },
    { str: '2024' },
    { str: ' ' },
    { str: '09:01:38' },
    { str: ' ' },
    { str: 'GMT+1000' },
    { str: ' ' },
    { str: '(Australian' },
    { str: ' ' },
    { str: 'Eastern' },
    { str: ' ' },
    { str: 'Standard' },
    { str: ' ' },
    { str: 'Time)' }
  ];
  
  console.log('=== TEST 1 - Actual PDF format from your example ===');
  const result1 = extractEmailHeaderInfo(test1);
  console.log('Result:', result1);
  console.log('Expected sender: Decision Enquiry');
  console.log('Expected receiver: Jaime McIver');
  console.log('Expected dateFull: Thu Apr 25 2024 09:01:38 GMT+1000');
  console.log('Expected dateFormatted: 25.04.2024\n');
  
  // Test case 2: Simplified version
  const test2 = [
    { str: 'From: "Decision Enquiry" <decisionenquiry@proton.me>' },
    { str: 'To: "Jaime McIver" <Jaime.McIver@crownlaw.qld.gov.au>' },
    { str: 'Date: Thu Apr 25 2024 09:01:38 GMT+1000 (Australian Eastern Standard Time)' }
  ];
  
  console.log('=== TEST 2 - Simplified version ===');
  const result2 = extractEmailHeaderInfo(test2);
  console.log('Result:', result2);
  console.log('Expected sender: Decision Enquiry');
  console.log('Expected receiver: Jaime McIver');
  console.log('Expected dateFull: Thu Apr 25 2024 09:01:38 GMT+1000');
  console.log('Expected dateFormatted: 25.04.2024\n');
  
  console.log('=== ALL TESTS COMPLETED ===');
}

// Run the tests
runTests().catch(console.error);
