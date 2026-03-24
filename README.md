# Meal Attendance Automator

## Overview

This project was fully "vibe coded" to solve a specific use case for a small business.

The **Meal Attendance Automator** is a Chrome extension designed to streamline the meal attendance entry process on the CenterPilot platform. By extracting and processing student attendance data from Procare, it automatically matches student records and populates meal attendance data, saving the user time and reducing manual data entry errors.

### How It Works

1. **Popup UI**: The extension features a modern UI built with Google Material Design 3, accessed via the extension popup. From the popup, the user can start, pause, stop, and clear the automation process and view live logs.
2. **Data Extraction**: Extracts student attendance data from Procare (requires user to navigate to/export data from Procare).
3. **Automation**: A content script (`centerpilot_automator.js`) runs on the CenterPilot website, automatically navigating through student records, matching them with the extracted Procare data, and submitting attendance automatically.

## Requirements

- Node.js and npm (for managing dependencies and building the extension)
- Chromium-based web browser (e.g., Chrome, Edge)

## Project Structure

- `manifest.json`: The Chrome extension manifest file.
- `popup.html` & `popup.js`: The Material Design 3 UI and its logic for controlling the automation tool.
- `centerpilot_automator.js`: The content script deployed on CenterPilot pages to execute the core automation logic.
- `procare_extractor.js`: Script for extracting data from Procare.

## Setup and Local Development

Since the extension relies on Material Design Web Components (`@material/web`), the popup script needs to be bundled before the extension can be loaded correctly.

### 1. Install Dependencies

In the project root, run:

```bash
npm install
```

### 2. Build the Extension

The extension expects the compiled UI script to be located in the `dist` directory (`dist/popup.js`). Build this using `esbuild` (or any preferred bundler):

```bash
npx esbuild popup.js --bundle --outfile=dist/popup.js
```

*Note: Whenever changes are made to `popup.js`, the build command needs to be run again.*

### 3. Load the Extension in Chrome

1. Open a Chromium-based browser and navigate to `chrome://extensions`.
2. Enable **Developer mode** using the toggle switch in the top right corner.
3. Click the **Load unpacked** button in the top left corner.
4. Select the root directory of this project.
