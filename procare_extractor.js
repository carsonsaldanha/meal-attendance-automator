// procare_extractor.js
function extractProcareData() {
  const records = {};
  const rows = document.querySelectorAll('table tr');
  
  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length >= 7) {
      const nameText = cells[0].textContent.trim();
      const signInText = cells[3].textContent.trim();
      const signOutText = cells[6].textContent.trim();
      
      if (nameText && signInText && signInText.toUpperCase() !== "SIGN-IN TIME") {
        // Just store the raw uppercase name string, removing commas and extra spaces
        const rawName = nameText.toUpperCase().replace(/,/g, '').replace(/\s+/g, ' ');
        
        if (!records[rawName]) {
          records[rawName] = [];
        }
        records[rawName].push({
          signIn: signInText,
          signOut: signOutText || null
        });
      }
    }
  });
  
  return records;
}

extractProcareData();
