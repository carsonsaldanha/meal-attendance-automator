document.addEventListener('DOMContentLoaded', () => {
  const startPauseBtn = document.getElementById('startPauseBtn');
  const stopBtn = document.getElementById('stopBtn');
  const clearBtn = document.getElementById('clearBtn');
  const statusDiv = document.getElementById('status');
  const logWindow = document.getElementById('logWindow');

  async function addLog(message) {
      const storageResult = await chrome.storage.local.get(['extensionLog']);
      let log = storageResult.extensionLog || [];
      if (log.length > 200) log = log.slice(-100);
      log.push(`[${new Date().toLocaleTimeString()}] ${message}`);
      await chrome.storage.local.set({ extensionLog: log });
  }

  function updateStatus(res) {
      if (res.automationActive && !res.automationPaused) {
          startPauseBtn.textContent = "Pause Automation";
          startPauseBtn.style.backgroundColor = "#ff9800";
          statusDiv.textContent = 'Automation is running!';
      } else if (res.automationActive && res.automationPaused) {
          startPauseBtn.textContent = "Resume Automation";
          startPauseBtn.style.backgroundColor = "#4CAF50";
          statusDiv.textContent = 'Automation paused.';
      } else {
          startPauseBtn.textContent = "Start Automation";
          startPauseBtn.style.backgroundColor = "#4CAF50";
          statusDiv.textContent = 'Automation stopped or completed.';
      }
  }

  chrome.storage.local.get(['extensionLog', 'automationActive', 'automationPaused'], (result) => {
     if(result.extensionLog) {
         logWindow.innerHTML = result.extensionLog.join('<br>');
         logWindow.scrollTop = logWindow.scrollHeight;
     }
     updateStatus(result);
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (changes.extensionLog) {
       logWindow.innerHTML = changes.extensionLog.newValue.join('<br>');
       logWindow.scrollTop = logWindow.scrollHeight;
    }
    if (changes.automationActive || changes.automationPaused) {
       chrome.storage.local.get(['automationActive', 'automationPaused'], updateStatus);
    }
  });

  clearBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({ extensionLog: [] });
  });

  async function startAutomation() {
    try {
      statusDiv.textContent = 'Finding Procare Report tab...';
      const tabs = await chrome.tabs.query({});
      let procareTab = tabs.find(t => t.title && t.title.includes('Siso Report'));
      let centerPilotTab = tabs.find(t => t.url && t.url.includes('hangar1.centerpilot.net/Centerpilot/Attendance/MealAttendance.aspx'));

      if (!procareTab) {
        statusDiv.textContent = 'Error: Cannot find "Siso Report" tab from Procare.';
        return;
      }
      if (!centerPilotTab) {
        statusDiv.textContent = 'Error: Cannot find the CenterPilot Meal Attendance tab.';
        return;
      }

      statusDiv.textContent = 'Extracting data from Procare...';
      const results = await chrome.scripting.executeScript({
        target: { tabId: procareTab.id },
        files: ['procare_extractor.js']
      });

      const attendanceData = results[0]?.result;
      if (!attendanceData || Object.keys(attendanceData).length === 0) {
        statusDiv.textContent = 'Error: No attendance data found on the Procare tab.';
        return;
      }

      let roomQuery = await chrome.scripting.executeScript({
          target: { tabId: centerPilotTab.id },
          func: () => {
              let rb = document.querySelector('#ctl00_ContentPlaceHolder_RadDropDownListSortingGroups .rddlFakeInput');
              return rb ? rb.textContent.trim() : "ROOM 1";
          }
      });
      
      let currentRoomText = roomQuery[0]?.result || "ROOM 1";
      let roomMatch = currentRoomText.match(/\d+/);
      let startingRoom = roomMatch ? parseInt(roomMatch[0], 10) : 1;

      await addLog(`Starting run from Room ${startingRoom}... Extracted ${Object.keys(attendanceData).length} kids.`);
      
      await chrome.storage.local.set({ 
        attendanceData: attendanceData,
        automationActive: true,
        automationPaused: false,
        currentMealIndex: 0,
        currentRoom: startingRoom,
        automationRunId: Date.now().toString()
      });

      await chrome.scripting.executeScript({
        target: { tabId: centerPilotTab.id },
        files: ['centerpilot_automator.js']
      });

    } catch (e) {
      statusDiv.textContent = 'Error: ' + e.message;
    }
  }

  startPauseBtn.addEventListener('click', async () => {
      const res = await chrome.storage.local.get(['automationActive', 'automationPaused']);
      if (res.automationActive && !res.automationPaused) {
          await chrome.storage.local.set({ automationPaused: true });
          await addLog("<b>User clicked Pause.</b>");
      } else if (res.automationActive && res.automationPaused) {
          await chrome.storage.local.set({ automationPaused: false });
          await addLog("<b>User clicked Resume.</b>");
          const tabs = await chrome.tabs.query({});
          let centerPilotTab = tabs.find(t => t.url && t.url.includes('hangar1.centerpilot.net/Centerpilot/Attendance/MealAttendance.aspx'));
          if (centerPilotTab) {
              await chrome.scripting.executeScript({
                  target: { tabId: centerPilotTab.id },
                  files: ['centerpilot_automator.js']
              });
          }
      } else {
          startAutomation();
      }
  });

  stopBtn.addEventListener('click', async () => {
      await addLog("<b>User clicked Stop. Run terminated.</b>");
      await chrome.storage.local.set({ automationActive: false, automationPaused: false });
  });
});
