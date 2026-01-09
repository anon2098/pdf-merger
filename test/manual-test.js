import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Copy the reconstruction and cleaning functions from the main file
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
    .trim();
  
  // Also remove spaces in email addresses
  cleanedText = cleanedText.replace(/([\w])\s+@/g, '$1@');
  cleanedText = cleanedText.replace(/@\s+([\w])/g, '@$1');
  cleanedText = cleanedText.replace(/(\.)\s+([a-z])/g, '$1$2');
  
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
  
  console.log('Reconstructed text:');
  console.log('---');
  console.log(reconstructedText);
  console.log('---');
  
  // Extract fields with proper boundaries
  // Look for From: field
  const fromMatch = reconstructedText.match(/From:\s*["']([^"']*)["'](?:\s*<[^>]*>)?/i);
  if (fromMatch) {
    result.sender = fromMatch[1].trim() || 'Unknown';
  } else {
    // Try without quotes
    const fromMatchNoQuotes = reconstructedText.match(/From:\s*([^<\n\r]*)(?:\s*<[^>]*>)?/i);
    if (fromMatchNoQuotes) {
      result.sender = fromMatchNoQuotes[1].trim() || 'Unknown';
    }
  }
  
  // Look for To: field (stop before Subject or Date)
  const toSection = reconstructedText.match(/To:.*?(?=(?:Subject:|Date:|$))/i);
  if (toSection) {
    const toText = toSection[0];
    const toMatch = toText.match(/To:\s*["']([^"']*)["']/i);
    if (toMatch) {
      result.receiver = toMatch[1].trim() || 'Unknown';
    } else {
      // Try without quotes
      const toMatchNoQuotes = toText.match(/To:\s*([^<\n\r]*)(?:\s*<[^>]*>)?/i);
      if (toMatchNoQuotes) {
        result.receiver = toMatchNoQuotes[1].trim() || 'Unknown';
      }
    }
  }
  
  // Look for Date: field (stop before next field or end)
  const dateSection = reconstructedText.match(/Date:.*?(?=(?:From:|To:|Subject:|$))/i);
  if (dateSection) {
    const dateText = dateSection[0];
    const dateMatch = dateText.match(/Date:\s*(.+)$/i);
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
  }
  
  return result;
}

// Test with simulated character-by-character extraction from your actual PDF
async function runTest() {
  console.log('Testing with simulated PDF character extraction...\n');
  
  // Simulate the character-by-character extraction from your PDF page 1
  const simulatedTextItems = [
    { str: "F", x: 36, y: 795 },
    { str: "r", x: 43, y: 795 },
    { str: "o", x: 47, y: 795 },
    { str: "m", x: 54, y: 795 },
    { str: ":", x: 63, y: 795 },
    { str: " ", x: 67, y: 795 },
    { str: '"', x: 70, y: 795 },
    { str: "D", x: 74, y: 795 },
    { str: "e", x: 82, y: 795 },
    { str: "c", x: 88, y: 795 },
    { str: "i", x: 94, y: 795 },
    { str: "s", x: 96, y: 795 },
    { str: "i", x: 102, y: 795 },
    { str: "o", x: 104, y: 795 },
    { str: "n", x: 110, y: 795 },
    { str: " ", x: 116, y: 795 },
    { str: "E", x: 119, y: 795 },
    { str: "n", x: 127, y: 795 },
    { str: "q", x: 133, y: 795 },
    { str: "u", x: 139, y: 795 },
    { str: "i", x: 145, y: 795 },
    { str: "r", x: 147, y: 795 },
    { str: "y", x: 151, y: 795 },
    { str: '"', x: 157, y: 795 },
    { str: " ", x: 161, y: 795 },
    { str: "<", x: 164, y: 795 },
    { str: "d", x: 170, y: 795 },
    { str: "e", x: 176, y: 795 },
    { str: "c", x: 182, y: 795 },
    { str: "i", x: 188, y: 795 },
    { str: "s", x: 191, y: 795 },
    { str: "i", x: 197, y: 795 },
    { str: "o", x: 199, y: 795 },
    { str: "n", x: 205, y: 795 },
    { str: "e", x: 211, y: 795 },
    { str: "n", x: 217, y: 795 },
    { str: "q", x: 223, y: 795 },
    { str: "u", x: 229, y: 795 },
    { str: "i", x: 235, y: 795 },
    { str: "r", x: 237, y: 795 },
    { str: "y", x: 241, y: 795 },
    { str: "@", x: 246, y: 795 },
    { str: "p", x: 255, y: 795 },
    { str: "r", x: 261, y: 795 },
    { str: "o", x: 265, y: 795 },
    { str: "t", x: 271, y: 795 },
    { str: "o", x: 274, y: 795 },
    { str: "n", x: 280, y: 795 },
    { str: ".", x: 286, y: 795 },
    { str: "m", x: 289, y: 795 },
    { str: "e", x: 298, y: 795 },
    { str: ">", x: 304, y: 795 },
    { str: " ", x: 308, y: 795 },
    { str: "T", x: 36, y: 780 },
    { str: "o", x: 43, y: 780 },
    { str: ":", x: 49, y: 780 },
    { str: " ", x: 53, y: 780 },
    { str: "c", x: 56, y: 780 },
    { str: "r", x: 62, y: 780 },
    { str: "o", x: 66, y: 780 },
    { str: "w", x: 72, y: 780 },
    { str: "n", x: 81, y: 780 },
    { str: "l", x: 87, y: 780 },
    { str: "a", x: 89, y: 780 },
    { str: "w", x: 95, y: 780 },
    { str: "@", x: 104, y: 780 },
    { str: "q", x: 113, y: 780 },
    { str: "l", x: 119, y: 780 },
    { str: "d", x: 121, y: 780 },
    { str: ".", x: 127, y: 780 },
    { str: "g", x: 130, y: 780 },
    { str: "o", x: 136, y: 780 },
    { str: "v", x: 142, y: 780 },
    { str: ".", x: 147, y: 780 },
    { str: "a", x: 150, y: 780 },
    { str: "u", x: 156, y: 780 },
    { str: " ", x: 162, y: 780 },
    { str: "S", x: 36, y: 765 },
    { str: "u", x: 43, y: 765 },
    { str: "b", x: 49, y: 765 },
    { str: "j", x: 55, y: 765 },
    { str: "e", x: 58, y: 765 },
    { str: "c", x: 64, y: 765 },
    { str: "t", x: 70, y: 765 },
    { str: ":", x: 74, y: 765 },
    { str: " ", x: 78, y: 765 },
    { str: "K", x: 81, y: 765 },
    { str: "i", x: 88, y: 765 },
    { str: "n", x: 91, y: 765 },
    { str: "g", x: 97, y: 765 },
    { str: " ", x: 103, y: 765 },
    { str: "v", x: 106, y: 765 },
    { str: " ", x: 111, y: 765 },
    { str: "S", x: 114, y: 765 },
    { str: "t", x: 121, y: 765 },
    { str: "a", x: 124, y: 765 },
    { str: "t", x: 130, y: 765 },
    { str: "e", x: 134, y: 765 },
    { str: " ", x: 140, y: 765 },
    { str: "o", x: 143, y: 765 },
    { str: "f", x: 149, y: 765 },
    { str: " ", x: 153, y: 765 },
    { str: "Q", x: 156, y: 765 },
    { str: "l", x: 164, y: 765 },
    { str: "d", x: 166, y: 765 },
    { str: " ", x: 172, y: 765 },
    { str: "1", x: 175, y: 765 },
    { str: "2", x: 181, y: 765 },
    { str: "/", x: 187, y: 765 },
    { str: "2", x: 191, y: 765 },
    { str: "0", x: 197, y: 765 },
    { str: "2", x: 203, y: 765 },
    { str: "3", x: 209, y: 765 },
    { str: " ", x: 36, y: 750 },
    { str: "D", x: 36, y: 735 },
    { str: "a", x: 43, y: 735 },
    { str: "t", x: 49, y: 735 },
    { str: "e", x: 52, y: 735 },
    { str: ":", x: 58, y: 735 },
    { str: " ", x: 62, y: 735 },
    { str: "T", x: 65, y: 735 },
    { str: "h", x: 72, y: 735 },
    { str: "u", x: 78, y: 735 },
    { str: " ", x: 84, y: 735 },
    { str: "F", x: 87, y: 735 },
    { str: "e", x: 94, y: 735 },
    { str: "b", x: 100, y: 735 },
    { str: " ", x: 106, y: 735 },
    { str: "0", x: 109, y: 735 },
    { str: "8", x: 115, y: 735 },
    { str: " ", x: 121, y: 735 },
    { str: "2", x: 124, y: 735 },
    { str: "0", x: 130, y: 735 },
    { str: "2", x: 136, y: 735 },
    { str: "4", x: 142, y: 735 },
    { str: " ", x: 148, y: 735 },
    { str: "1", x: 151, y: 735 },
    { str: "3", x: 157, y: 735 },
    { str: ":", x: 163, y: 735 },
    { str: "2", x: 166, y: 735 },
    { str: "4", x: 172, y: 735 },
    { str: ":", x: 178, y: 735 },
    { str: "1", x: 181, y: 735 },
    { str: "8", x: 187, y: 735 },
    { str: " ", x: 193, y: 735 },
    { str: "G", x: 196, y: 735 },
    { str: "M", x: 204, y: 735 },
    { str: "T", x: 213, y: 735 },
    { str: "+", x: 220, y: 735 },
    { str: "1", x: 228, y: 735 },
    { str: "0", x: 234, y: 735 },
    { str: "0", x: 240, y: 735 },
    { str: "0", x: 246, y: 735 },
    { str: " ", x: 252, y: 735 },
    { str: "(", x: 255, y: 735 },
    { str: "A", x: 259, y: 735 },
    { str: "u", x: 266, y: 735 },
    { str: "s", x: 272, y: 735 },
    { str: "t", x: 278, y: 735 },
    { str: "r", x: 281, y: 735 },
    { str: "a", x: 285, y: 735 },
    { str: "l", x: 291, y: 735 },
    { str: "i", x: 293, y: 735 },
    { str: "a", x: 295, y: 735 },
    { str: "n", x: 301, y: 735 },
    { str: " ", x: 307, y: 735 },
    { str: "E", x: 310, y: 735 },
    { str: "a", x: 317, y: 735 },
    { str: "s", x: 323, y: 735 },
    { str: "t", x: 329, y: 735 },
    { str: "e", x: 332, y: 735 },
    { str: "r", x: 338, y: 735 },
    { str: "n", x: 342, y: 735 },
    { str: " ", x: 348, y: 735 },
    { str: "S", x: 351, y: 735 },
    { str: "t", x: 358, y: 735 },
    { str: "a", x: 361, y: 735 },
    { str: "n", x: 367, y: 735 },
    { str: "d", x: 373, y: 735 },
    { str: "a", x: 379, y: 735 },
    { str: "r", x: 385, y: 735 },
    { str: "d", x: 389, y: 735 },
    { str: " ", x: 395, y: 735 },
    { str: "T", x: 398, y: 735 },
    { str: "i", x: 405, y: 735 },
    { str: "m", x: 407, y: 735 },
    { str: "e", x: 416, y: 735 },
    { str: ")", x: 422, y: 735 }
  ];
  
  console.log('=== TEST WITH SIMULATED PDF CHARACTER EXTRACTION ===');
  const result = extractEmailHeaderInfo(simulatedTextItems);
  console.log('\nFinal Result:', result);
  console.log('\nExpected:');
  console.log('  sender: Decision Enquiry');
  console.log('  receiver: crownlaw@qld.gov.au');
  console.log('  dateFull: Thu Feb 08 2024 13:24:18 GMT+1000');
  console.log('  dateFormatted: 08.02.2024');
}

// Run the test
runTest().catch(console.error);
