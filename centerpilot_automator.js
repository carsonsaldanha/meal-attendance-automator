// centerpilot_automator.js
(async function() {
  if(window.automationRunning) return;
  window.automationRunning = true;

  const wait = ms => new Promise(r => setTimeout(r, ms));

  async function addLog(message) {
      let data = await chrome.storage.local.get(['extensionLog']);
      let log = data.extensionLog || [];
      if (log.length > 200) log = log.slice(-100); 
      log.push(`[${new Date().toLocaleTimeString()}] ` + message); 
      await chrome.storage.local.set({ extensionLog: log });
  }

  function parseTime(timeStr) {
    if(!timeStr) return null;
    const parts = timeStr.match(/(\d+):(\d+)\s*([APap])/i);
    if(!parts) return null;
    let h = parseInt(parts[1], 10);
    let m = parseInt(parts[2], 10);
    let ampm = parts[3].toUpperCase();
    if (h === 12 && ampm === 'A') h = 0;
    if (h < 12 && ampm === 'P') h += 12;
    return h * 60 + m; 
  }

  function isPresentForMeal(records, mealName) {
    if(!records || records.length === 0) return false;
    for(let record of records) {
      let inTime = parseTime(record.signIn);
      let outTime = parseTime(record.signOut);
      
      if(mealName === 'BREAKFAST') {
        if(inTime !== null && inTime < 570) return true;
      } else if(mealName === 'LUNCH') {
        if(inTime !== null && inTime <= 810 && (outTime === null || outTime >= 705)) return true;
      } else if(mealName === 'PM SNACK') {
        if(outTime === null || outTime > 810) return true;
      }
    }
    return false;
  }

  function getEditDistance(a, b) {
    if(a.length === 0) return b.length; 
    if(b.length === 0) return a.length; 

    var matrix = [];
    var i, j;
    for(i = 0; i <= b.length; i++){ matrix[i] = [i]; }
    for(j = 0; j <= a.length; j++){ matrix[0][j] = j; }

    for(i = 1; i <= b.length; i++){
      for(j = 1; j <= a.length; j++){
        if(b.charAt(i-1) == a.charAt(j-1)){
          matrix[i][j] = matrix[i-1][j-1];
        } else {
          matrix[i][j] = Math.min(matrix[i-1][j-1] + 1, Math.min(matrix[i][j-1] + 1, matrix[i-1][j] + 1)); 
        }
      }
    }
    return matrix[b.length][a.length];
  }

  function isWordMatch(cpWord, procareWords) {
      for(let pWord of procareWords) {
          if (pWord === cpWord) return true;
          let maxTypos = cpWord.length > 4 ? 2 : 1;
          if (getEditDistance(cpWord, pWord) <= maxTypos) return true;
          if (pWord.includes(cpWord) || cpWord.includes(pWord)) return true;
      }
      return false;
  }

  async function simulateComboClickAndWaitForTable(comboId, textsToSelect) {
     if (!Array.isArray(textsToSelect)) textsToSelect = [textsToSelect];
     let container = document.getElementById(comboId);
     if (!container) return false;
     
     let fakeInput = container.querySelector('.rddlFakeInput');
     if (!fakeInput) return false;
     
     for (let textToSelect of textsToSelect) {
         if (fakeInput.textContent.trim().toLowerCase() === textToSelect.toLowerCase()) return true;
     }
     
     // Store the exact DOM node of the current attendance table before clicking
     let oldTable = document.getElementById('ctl00_ContentPlaceHolder_RadGridMealAttendance_ctl00');
     let initialTableValid = !!oldTable;
     
     let inner = container.querySelector('.rddlInner');
     if (inner) inner.click();
     else container.click();
     
     await wait(600); 
     
     let allItems = document.querySelectorAll('li.rddlItem');
     let clicked = false;
     for(let li of allItems) {
         if(li.getBoundingClientRect().height > 0) { 
             let liText = li.textContent.trim().toLowerCase();
             for (let textToSelect of textsToSelect) {
                 if(liText === textToSelect.toLowerCase()) {
                     li.click();
                     clicked = true;
                     break;
                 }
             }
             if (clicked) break;
         }
     }
     
     if (!clicked) {
         if (inner) inner.click(); 
         else container.click();
         return false;
     }

     await addLog("Waiting for CenterPilot server to refresh attendance table...");
     
     let loops = 0;
     while(loops < 60) {
         if (initialTableValid) {
             // Telerik RadAjax overwrites the innerHTML, physically detaching the old table node from the document.
             if (!document.contains(oldTable)) {
                 await addLog("<span style='color:green'>Table DOM refreshed!</span>");
                 await wait(1800); // Small buffer for Telerik Javascript to re-initialize bounds
                 return true;
             }
         } else {
             // If there was no table to begin with (empty room beforehand), wait for one to appear
             let newTable = document.getElementById('ctl00_ContentPlaceHolder_RadGridMealAttendance_ctl00');
             if (newTable) {
                 await addLog("<span style='color:green'>Table DOM generated!</span>");
                 await wait(1800);
                 return true;
             }
             // If the next room is ALSO empty, the table will never appear. Timeout after 5s.
             if (loops > 5) {
                 await wait(1500);
                 return true;
             }
         }
         
         await wait(1000);
         loops++;
     }
     
     await addLog("<span style='color:red;font-weight:bold;'>Table refresh timeout (60s). Refreshing page to retry...</span>");
     window.automationRunning = false;
     window.location.reload();
     return false;
  }

  async function runStep() {
    const state = await chrome.storage.local.get(['automationActive', 'automationPaused', 'automationRunId', 'attendanceData', 'currentMealIndex', 'currentRoom']);
    
    if (!state.automationActive || state.automationPaused) {
      window.automationRunning = false;
      return;
    }

    const MEALS = ["BREAKFAST", "LUNCH", "PM SNACK"];
    const MAX_ROOM = 10;
    
    if (state.currentRoom > MAX_ROOM) {
      await addLog(`<span style="color:blue;font-weight:bold;">--- AUTOMATION COMPLETE! ---</span>`);
      await chrome.storage.local.set({ automationActive: false, automationPaused: false });
      window.automationRunning = false;
      return;
    }

    const currentMeal = MEALS[state.currentMealIndex];
    const currentRoom = state.currentRoom;

    await addLog(`<b>Processing Room ${currentRoom} / ${currentMeal}...</b>`);

    let fullRoomString = "ROOM " + currentRoom.toString();
    let shortRoomString = "RM " + currentRoom.toString();
    
    let roomInput = document.querySelector('#ctl00_ContentPlaceHolder_RadDropDownListSortingGroups .rddlFakeInput');
    let currentInputText = roomInput ? roomInput.textContent.trim().toUpperCase() : "";

    if (currentInputText !== fullRoomString && currentInputText !== shortRoomString) {
      await addLog(`Switching Room Dropdown to Room ${currentRoom}...`);
      let success = await simulateComboClickAndWaitForTable("ctl00_ContentPlaceHolder_RadDropDownListSortingGroups", [fullRoomString, shortRoomString]);
      if(!success) {
         if (currentRoom === 1) {
             await addLog(`<span style="color:orange">Notice: Room '1' not found. Advancing to Room '2'.</span>`);
             await chrome.storage.local.set({ currentRoom: 2 });
             setTimeout(runStep, 1500);
             return;
         }
         await addLog(`<span style="color:red">Error: Could not find room '${currentRoom}' in dropdown.</span>`);
         return;
      }
    }

    let mealInput = document.querySelector('#ctl00_ContentPlaceHolder_RadDropDownListMealType .rddlFakeInput');
    if (mealInput && mealInput.textContent.trim().toUpperCase() !== currentMeal.toUpperCase()) {
      await addLog(`Switching Meal Dropdown to ${currentMeal}...`);
      let success = await simulateComboClickAndWaitForTable("ctl00_ContentPlaceHolder_RadDropDownListMealType", currentMeal);
      if (!success) {
         await addLog(`<span style="color:red">Error: Could not find meal '${currentMeal}' in dropdown.</span>`);
         return;
      }
    }

    let rows = document.querySelectorAll('tr.rgRow, tr.rgAltRow');
    let madeChanges = false;
    let kidsCheckedLog = [];
    
    if(rows.length === 0) {
        await addLog("<span style='color:orange;'>No children found in this room table. Skipping table parsing.</span>");
    }
    
    for(let row of rows) {
      let lastNameEl = row.querySelector('#RadLabelLastName');
      let firstNameEl = row.querySelector('#RadLabelFirstName');
      if(!lastNameEl || !firstNameEl) continue;
      
      let cpFirst = firstNameEl.textContent.trim().toUpperCase();
      let cpLast = lastNameEl.textContent.trim().toUpperCase();
      
      let cpFirstWord = cpFirst.split(' ')[0].split('-')[0];
      let cpLastWord = cpLast.split(' ')[0].split('-')[0];
      
      let dailyBtn = row.querySelector('[id$="_RadCheckBoxAttendanceOnly"]');
      let mealBtn = row.querySelector('[id$="_RadCheckBoxMealTaken"]');
      if(!dailyBtn || !mealBtn) continue;
      
      let dailyStateInput = dailyBtn.querySelector('input[type="hidden"]');
      let mealStateInput = mealBtn.querySelector('input[type="hidden"]');
      
      let isDailyChecked = false;
      let isMealChecked = false;
      try {
         if (dailyStateInput) isDailyChecked = JSON.parse(dailyStateInput.value).checked === true;
         if (mealStateInput) isMealChecked = JSON.parse(mealStateInput.value).checked === true;
      } catch(e) {}
      
      let records = null;
      let matchedProcareName = "";
      for (let procareName in state.attendanceData) {
         let pWords = procareName.split(' ');
         if (isWordMatch(cpFirstWord, pWords) && isWordMatch(cpLastWord, pWords)) {
             records = state.attendanceData[procareName];
             matchedProcareName = procareName;
             break;
         }
      }
      
      let childLogStr = `${cpFirst} ${cpLast}: `;
      
      if(isPresentForMeal(records, currentMeal)) {
          if (!isDailyChecked || !isMealChecked) {
              if(!isDailyChecked) dailyBtn.click();
              if(!isMealChecked) mealBtn.click();
              madeChanges = true;
              childLogStr += `<span style="color:green;">MARKED PRESENT</span> (matched '${matchedProcareName}')`;
          } else {
              childLogStr += `<span style="color:blue;">ALREADY MARKED</span> (matched '${matchedProcareName}')`;
          }
      } else {
          if (!records) {
              childLogStr += `<span style="color:red;">NOT FOUND in Procare Data</span>`;
          } else {
              let reasonStr = records.map(r => `${r.signIn} to ${r.signOut || 'Now'}`).join(', ');
              childLogStr += `<span style="color:orange;">Not present in time range (${reasonStr})</span>`;
          }
      }
      kidsCheckedLog.push(childLogStr);
    }
    
    for(let str of kidsCheckedLog) {
       await addLog(str);
    }

    if(madeChanges) {
      await addLog("Saving changes for room...");
      const saveBtn = document.querySelector('#ctl00_ContentPlaceHolder_RadButtonSave');
      if(saveBtn) saveBtn.click();
      
      let saved = false;
      await addLog("Waiting for Save notification popup...");
      for(let i=0; i<60; i++) {
          let notif = document.getElementById('ctl00_ContentPlaceHolder_RadNotifications_popup');
          if (notif && notif.style.display !== 'none' && notif.innerText && notif.innerText.toUpperCase().includes('SAVED')) {
              saved = true;
              await addLog("<span style='color:green;font-weight:bold;'>Save successfully confirmed!</span>");
              notif.style.display = 'none'; 
              await wait(1000);
              break;
          }
          await wait(1000);
      }
      
      if(!saved) {
          await addLog("<span style='color:red;font-weight:bold;'>Save popup timeout (60s). Refreshing page to retry...</span>");
          window.automationRunning = false;
          window.location.reload();
          return;
      }
    } else {
      await addLog("No changes needed for this room.");
    }

    let nextMealIndex = state.currentMealIndex + 1;
    let nextRoom = state.currentRoom;
    if(nextMealIndex >= MEALS.length) {
       nextMealIndex = 0;
       nextRoom++;
    }

    const freshState = await chrome.storage.local.get(['automationActive', 'automationPaused', 'automationRunId']);
    if (!freshState.automationActive || freshState.automationPaused || freshState.automationRunId !== state.automationRunId) {
        window.automationRunning = false;
        return;
    }

    await chrome.storage.local.set({ currentMealIndex: nextMealIndex, currentRoom: nextRoom });
    setTimeout(runStep, 1500); 
  }

  runStep();
})();
