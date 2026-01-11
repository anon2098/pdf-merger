#!/usr/bin/env python3

# Script to fix the date parsing issue in merge-stamp.js
# The issue is that month names with spacing aren't properly handled

import sys

def fix_date_parsing(file_path):
    try:
        # Read the file
        with open(file_path, 'r') as f:
            content = f.read()
        
        # Find the specific lines we want to modify
        lines = content.split('\n')
        
        # Find the line with the month parsing
        for i, line in enumerate(lines):
            if 'const monthNum = months[month.toLowerCase()] || \'01\';' in line:
                # Insert the fix before this line
                lines.insert(i, '      // Clean up potential spacing in month names')
                lines.insert(i + 1, '      month = month.replace(/\\s+/g, \'\').toLowerCase();')
                # Replace the original line
                lines[i + 2] = '      const monthNum = months[month] || \'01\';'
                break
        
        # Write the file back
        with open(file_path, 'w') as f:
            f.write('\n'.join(lines))
            
        print("Successfully updated the date parsing logic in merge-stamp.js")
        return True
        
    except Exception as e:
        print(f"Error updating file: {e}")
        return False

if __name__ == "__main__":
    file_path = "/Users/admin/Scripts/pdf-merger/merge-stamp.js"
    success = fix_date_parsing(file_path)
    sys.exit(0 if success else 1)
