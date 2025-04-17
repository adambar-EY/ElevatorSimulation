// --- Configuration Variables (Defaults) ---
let LOWEST_FLOOR = 0;     // Default Min Floor
let HIGHEST_FLOOR = 5;    // Default Max Floor
let CAPACITY = 8;         // Default Capacity
let START_FLOOR = 0;      // Default Start Floor (will match Min Floor after config read)
let CYCLE_TIME = 2.0;     // Default Speed
const FLOOR_HEIGHT_PX = 80; // Visual height of a floor

// Store current decision details (for boarding prompt)
let currentDecision = null;
// Store last received state from backend
let lastReceivedState = null;

// --- DOM Elements ---
document.addEventListener('DOMContentLoaded', () => {

    // Config Input Elements (Sliders)
    const configMinFloorEl = document.getElementById('config-min-floor');
    const configMaxFloorEl = document.getElementById('config-max-floor');
    const configCapacityEl = document.getElementById('config-capacity');
    const configSpeedEl = document.getElementById('config-speed');
    // NOTE: config-start-floor element is removed from HTML and JS

    // Config Value Display Elements (Spans next to sliders)
    const minFloorValueEl = document.getElementById('min-floor-value');
    const maxFloorValueEl = document.getElementById('max-floor-value');
    const capacityValueEl = document.getElementById('capacity-value');
    const speedValueEl = document.getElementById('speed-value');

    // Other Config Section Elements
    const applyConfigButton = document.getElementById('apply-config-button');
    const configSectionEl = document.getElementById('config-section');

    // Running Config Display Elements (shown when connected)
    const runningConfigDisplayEl = document.getElementById('running-config-display');
    const runningMinFloorEl = document.getElementById('running-min-floor');
    const runningMaxFloorEl = document.getElementById('running-max-floor');
    const runningCapacityEl = document.getElementById('running-capacity');
    const runningSpeedEl = document.getElementById('running-speed');

    // Decision Prompt Modal Elements
    const decisionPromptEl = document.getElementById('decision-prompt');
    const decisionTextEl = document.getElementById('decision-text');
    const decisionMaxEl = document.getElementById('decision-max');
    const decisionInputEl = document.getElementById('decision-input');
    const decisionConfirmButton = document.getElementById('decision-confirm');
    const decisionCancelButton = document.getElementById('decision-cancel');

    // Main UI Elements
    const elevatorShaft = document.getElementById('elevator-shaft');
    const floorControlsContainer = document.getElementById('floor-controls');
    const connectionStatusEl = document.getElementById('connection-status');
    const statusFloorEl = document.getElementById('status-floor');
    const statusDirectionEl = document.getElementById('status-direction');
    const statusLoadEl = document.getElementById('status-load');
    const statusCapacityEl = document.getElementById('status-capacity');
    const statusDestinationsEl = document.getElementById('status-destinations');
    const statusStopsEl = document.getElementById('status-stops');
    const wsUrlInput = document.getElementById('ws-url');
    const connectButton = document.getElementById('connect-button');
    const darkModeToggle = document.getElementById('dark-mode-toggle');

    // State Variables
    let elevatorCar = null; // Reference to the elevator car div
    let websocket = null;   // WebSocket connection object

    // --- Dark Mode Logic ---
    function applyTheme(theme) {
        // Apply 'dark' class to the root <html> element
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
            if (darkModeToggle) darkModeToggle.checked = true;
        } else {
            document.documentElement.classList.remove('dark');
            if (darkModeToggle) darkModeToggle.checked = false;
        }
    }

    // Check local storage for saved theme preference on load
    const savedTheme = localStorage.getItem('theme');
    applyTheme(savedTheme === 'dark' ? 'dark' : 'light'); // Default to light

    // Add listener for the dark mode toggle checkbox
    if (darkModeToggle) {
        darkModeToggle.addEventListener('change', () => {
            const theme = darkModeToggle.checked ? 'dark' : 'light';
            localStorage.setItem('theme', theme); // Save preference
            applyTheme(theme); // Apply the theme
        });
    } else {
        console.warn("Dark mode toggle element not found.");
    }
    // --- End Dark Mode Logic ---


    // --- Helper Functions ---
    /**
     * Converts an internal floor number to its display string (e.g., 0 becomes 'G').
     * @param {number|string} floorNum - The floor number.
     * @returns {string} The display string for the floor.
     */
    function displayFloor(floorNum) {
        if (floorNum === '?') return '?'; // Handle placeholder
        if (floorNum === 0) return "G";    // Ground floor
        if (typeof floorNum === 'string' && floorNum.toUpperCase() === 'G') return "G"; // Allow 'G' input
        const num = parseInt(floorNum);
        if (isNaN(num)) return "?"; // Handle invalid input
        return String(num);
    }

    // --- Configuration Handling ---
    /**
     * Reads configuration values from the UI slider elements.
     * Sets START_FLOOR to match the selected MIN_FLOOR.
     * Optionally updates global JS variables.
     * @param {boolean} [updateGlobals=true] - Whether to update the global JS config variables.
     * @returns {object} An object containing the configuration values and a validity flag.
     */
    function readConfigInputs(updateGlobals = true) {
        console.log("Reading config inputs...");
        // Read values from sliders, using JS defaults if elements aren't found
        let minFloor = parseInt(configMinFloorEl?.value ?? LOWEST_FLOOR);
        let maxFloor = parseInt(configMaxFloorEl?.value ?? HIGHEST_FLOOR);
        let capacity = parseInt(configCapacityEl?.value ?? CAPACITY);
        let speed = parseFloat(configSpeedEl?.value ?? CYCLE_TIME);
        let startFloor = minFloor; // *** START FLOOR IS NOW DERIVED FROM MIN FLOOR ***
        let isValid = true;

        // Basic NaN checks and defaults (should be less necessary with sliders)
        if (isNaN(minFloor)) { minFloor = 0; isValid = false; if(configMinFloorEl) configMinFloorEl.value = minFloor; }
        if (isNaN(maxFloor)) { maxFloor = 5; isValid = false; if(configMaxFloorEl) configMaxFloorEl.value = maxFloor; }
        if (isNaN(capacity) || capacity < 1) { capacity = 8; isValid = false; if(configCapacityEl) configCapacityEl.value = capacity; }
        if (isNaN(speed) || speed < 1.0 || speed > 3.0) { speed = 2.0; isValid = false; if(configSpeedEl) configSpeedEl.value = speed.toFixed(1); }

        // *** REMOVED Cross-validation: Min floor <= Max floor check (sliders have fixed ranges) ***

        // Update display values (redundant if setupSliderListeners ran, but safe)
        if (minFloorValueEl) minFloorValueEl.textContent = minFloor;
        if (maxFloorValueEl) maxFloorValueEl.textContent = maxFloor;
        if (capacityValueEl) capacityValueEl.textContent = capacity;
        if (speedValueEl) speedValueEl.textContent = speed.toFixed(1);

        // Update global JS variables if requested and valid
        if(updateGlobals && isValid) {
            LOWEST_FLOOR = minFloor;
            HIGHEST_FLOOR = maxFloor;
            START_FLOOR = startFloor; // Update global START_FLOOR
            CAPACITY = capacity;
            CYCLE_TIME = speed;
            console.log(`Config applied to JS: Min=${LOWEST_FLOOR}, Max=${HIGHEST_FLOOR}, Start=${START_FLOOR}, Cap=${CAPACITY}, Speed=${CYCLE_TIME}`);
        } else if (!isValid) {
            console.log("Config deemed invalid during read. JS Globals not updated.");
        }

        // Return the read/derived configuration
        return {
            min_floor: minFloor,
            max_floor: maxFloor,
            start_floor: startFloor, // Include derived start floor
            capacity: capacity,
            cycle_time: speed,
            valid: isValid
        };
    }

    /**
     * Enables or disables configuration input elements.
     * @param {boolean} disabled - True to disable, false to enable.
     */
    function setConfigInputsDisabled(disabled) {
        // Disable/enable sliders
        if (configMinFloorEl) configMinFloorEl.disabled = disabled;
        if (configMaxFloorEl) configMaxFloorEl.disabled = disabled;
        if (configCapacityEl) configCapacityEl.disabled = disabled;
        if (configSpeedEl) configSpeedEl.disabled = disabled;

        // Disable/enable Apply Config button
        if (applyConfigButton) {
             applyConfigButton.disabled = disabled;
             applyConfigButton.classList.toggle('opacity-50', disabled);
             applyConfigButton.classList.toggle('cursor-not-allowed', disabled);
        }

        // Disable/enable WebSocket URL input
        if (wsUrlInput) wsUrlInput.disabled = disabled;

        // Show/hide the "Running Config" display section
         if (runningConfigDisplayEl) {
            runningConfigDisplayEl.classList.toggle('hidden', !disabled);
         }
    }

    // --- UI Creation / Update ---
    /**
     * Creates the building visualization (floors, shaft, controls) based on current config.
     */
    function createBuildingUI() {
        console.log("Creating UI with floor button destination controls...");
        if (!elevatorShaft || !floorControlsContainer) {
            console.error("Elevator shaft or floor controls container not found!");
            return;
        }
        // Clear existing UI elements
        elevatorShaft.innerHTML = '';
        floorControlsContainer.innerHTML = '';

        // Read current UI values (don't update globals here)
        const currentConfig = readConfigInputs(false);
        const uiLowestFloor = currentConfig.min_floor;
        const uiHighestFloor = currentConfig.max_floor;

        // Validate floor range before creating UI
        const totalFloors = uiHighestFloor - uiLowestFloor + 1;
        // Basic validation: Ensure max is not less than min (shouldn't happen with fixed ranges now)
        // and total floors is reasonable.
        if (uiLowestFloor > uiHighestFloor || totalFloors <= 0 || totalFloors > 100 || isNaN(totalFloors)) {
             console.error("Invalid floor range for UI creation.", {uiLowestFloor, uiHighestFloor});
             elevatorShaft.innerHTML = '<p class="text-red-500 dark:text-red-400 p-4">Invalid floor range in config.</p>';
             return;
        }

        // Set the height of the elevator shaft based on the number of floors
        elevatorShaft.style.height = `${totalFloors * FLOOR_HEIGHT_PX}px`;

        // Create floor divs (visual) and control rows (interactive) from top to bottom
        for (let i = uiHighestFloor; i >= uiLowestFloor; i--) {
            // Create visual floor div in the shaft
            const floorDiv = document.createElement('div');
            const floorClass = i === 0 ? 'floor-ground' : i < 0 ? 'floor-basement' : 'floor-above-ground';
            floorDiv.className = `floor ${floorClass}`; // Apply styling based on floor level
            floorDiv.dataset.floor = i; // Store floor number
            const floorLabel = document.createElement('span');
            floorLabel.className = 'floor-label-inside'; // Style for label inside shaft
            floorLabel.textContent = displayFloor(i); // Display 'G' or number
            floorDiv.appendChild(floorLabel);
            elevatorShaft.appendChild(floorDiv);

            // Create corresponding control row in the controls container
            const controlRow = document.createElement('div');
            controlRow.id = `controls-${i}`;
            controlRow.dataset.selectedDest = ""; // Store selected destination for this floor
            controlRow.className = `floor-control-row flex items-center justify-between px-2 gap-x-2 border-b border-gray-200 dark:border-gray-700 last:border-b-0`; // Style the row

            // Generate Destination Floor Buttons for this row
            let destButtonsHTML = '<div class="flex items-center flex-wrap gap-1">';
            destButtonsHTML += '<span class="text-xs mr-1 text-gray-700 dark:text-gray-300">Dest:</span>';
            for (let destFloor = uiLowestFloor; destFloor <= uiHighestFloor; destFloor++) {
                if (destFloor !== i) { // Don't create a button for the current floor
                    destButtonsHTML += `
                        <button class="dest-button" data-floor="${i}" data-dest="${destFloor}" title="Set destination to Floor ${displayFloor(destFloor)}">
                            ${displayFloor(destFloor)}
                        </button>
                    `;
                }
            }
            destButtonsHTML += '</div>';

            // Generate Number of Passengers Controls for this row
            const numControlHTML = `
                 <div class="flex items-center">
                     <span class="text-xs mr-1 text-gray-700 dark:text-gray-300">Num:</span>
                    <div class="adjust-control flex flex-col items-center">
                        <button class="adjust-button-vertical adjust-up" data-target="num-${i}" data-delta="1" data-floor="${i}" title="Increase passengers">▲</button>
                        <span id="num-${i}" class="call-value-display num-value w-8 text-center" data-value="1">1</span>
                        <button class="adjust-button-vertical adjust-down" data-target="num-${i}" data-delta="-1" data-floor="${i}" title="Decrease passengers">▼</button>
                    </div>
                </div>
            `;

            // Assemble the full control row HTML
            controlRow.innerHTML = `
                 <span class="font-medium w-6 text-right text-gray-800 dark:text-gray-100">${displayFloor(i)}:</span>
                <div class="flex items-center flex-grow justify-between ml-2">
                    <div class="flex items-center flex-wrap gap-x-3">
                        ${destButtonsHTML}
                        ${numControlHTML}
                    </div>
                     <button id="call-${i}" class="call-button bg-blue-300 hover:bg-blue-400 dark:bg-blue-600 dark:hover:bg-blue-700 text-blue-800 dark:text-blue-100" title="Call elevator to this floor">Call Elevator</button>
                </div>
                <div id="waiting-${i}" class="waiting-list w-1/4 text-right pl-2"></div> `;
            floorControlsContainer.appendChild(controlRow);

             // Add Event Listeners for the newly created controls in this row
             const callButton = controlRow.querySelector(`#call-${i}`);
             if(callButton) callButton.addEventListener('click', () => callElevator(i));

             controlRow.querySelectorAll('.adjust-button-vertical').forEach(btn => {
                 btn.addEventListener('click', () => adjustValue(btn.dataset.target, parseInt(btn.dataset.delta), i));
             });

             controlRow.querySelectorAll('.dest-button').forEach(btn => {
                 btn.addEventListener('click', handleDestButtonClick);
             });
        }

        // Create or find the elevator car element within the shaft
        elevatorCar = document.getElementById('elevator-car');
        if (!elevatorCar) {
             elevatorCar = document.createElement('div');
             elevatorCar.id = 'elevator-car';
             elevatorCar.className = 'elevator-car'; // Apply styling
             elevatorShaft.appendChild(elevatorCar);
        }

        // Set initial elevator position based on START_FLOOR (derived from min_floor)
        const initialFloorIndex = currentConfig.start_floor - uiLowestFloor; // Index relative to lowest floor
        const initialBottomPosition = initialFloorIndex * FLOOR_HEIGHT_PX;
        elevatorCar.style.transition = 'none'; // Disable transition for initial placement
        elevatorCar.style.bottom = `${initialBottomPosition}px`;
        void elevatorCar.offsetWidth; // Force reflow to apply initial position immediately
        elevatorCar.style.transition = 'bottom 0.8s ease-in-out'; // Re-enable transition for movement

        // Set initial details inside the elevator car display
        elevatorCar.innerHTML = `<div id="elevator-details" class="elevator-details">Idle<br>0/${currentConfig.capacity}</div>`;
        console.log("UI Created/Updated.");
    } // End createBuildingUI

    /**
     * Handles clicks on destination selection buttons within a floor control row.
     * @param {Event} event - The click event object.
     */
    function handleDestButtonClick(event) {
        const clickedButton = event.target;
        const floor = clickedButton.dataset.floor; // The floor where the button was clicked
        const selectedDest = clickedButton.dataset.dest; // The destination floor selected

        const controlRow = document.getElementById(`controls-${floor}`);
        if (!controlRow) return;

        // Store the selected destination on the control row's dataset
        controlRow.dataset.selectedDest = selectedDest;
        console.log(`Floor ${floor} destination set to: ${selectedDest}`);

        // Update visual selection state (highlight clicked, unhighlight others in the same row)
        const buttonsInRow = controlRow.querySelectorAll('.dest-button');
        buttonsInRow.forEach(btn => {
            btn.classList.toggle('selected', btn === clickedButton);
        });
    }

    /**
     * Updates the UI based on the state received from the WebSocket backend.
     * This includes elevator position, load, status, and waiting passengers.
     * It also checks if the backend config differs and rebuilds the UI if necessary.
     * @param {object} state - The state object received from the backend.
     */
    function updateElevatorUI(state) {
        lastReceivedState = state; // Store the latest state
        let configChanged = false;
        let receivedLowest = LOWEST_FLOOR; let receivedHighest = HIGHEST_FLOOR;
        let receivedCapacity = CAPACITY; let receivedSpeed = CYCLE_TIME;
        // Start floor isn't received directly, it's part of initial config

        // Check if backend config (received in state) differs from current JS globals
        if (typeof state.lowest_floor === 'number' && state.lowest_floor !== LOWEST_FLOOR) { LOWEST_FLOOR = state.lowest_floor; receivedLowest = state.lowest_floor; configChanged = true; console.log(`>>> Global LOWEST_FLOOR updated to: ${LOWEST_FLOOR}`); }
        if (typeof state.highest_floor === 'number' && state.highest_floor !== HIGHEST_FLOOR) { HIGHEST_FLOOR = state.highest_floor; receivedHighest = state.highest_floor; configChanged = true; console.log(`>>> Global HIGHEST_FLOOR updated to: ${HIGHEST_FLOOR}`); }
        if (typeof state.capacity === 'number' && state.capacity !== CAPACITY) { CAPACITY = state.capacity; receivedCapacity = state.capacity; configChanged = true; console.log(`>>> Global CAPACITY updated to: ${CAPACITY}`); }
        if (typeof state.cycle_time === 'number' && state.cycle_time !== CYCLE_TIME) { CYCLE_TIME = state.cycle_time; receivedSpeed = state.cycle_time; configChanged = true; console.log(`>>> Global CYCLE_TIME updated to: ${CYCLE_TIME}`); }
        // We also need to update START_FLOOR if LOWEST_FLOOR changed
        if (configChanged && START_FLOOR !== LOWEST_FLOOR) {
            START_FLOOR = LOWEST_FLOOR;
            console.log(`>>> Global START_FLOOR updated to match LOWEST_FLOOR: ${START_FLOOR}`);
        }


        // Update the "Running Config" display section
        if (runningMinFloorEl) runningMinFloorEl.textContent = displayFloor(receivedLowest);
        if (runningMaxFloorEl) runningMaxFloorEl.textContent = displayFloor(receivedHighest);
        if (runningCapacityEl) runningCapacityEl.textContent = receivedCapacity;
        if (runningSpeedEl) runningSpeedEl.textContent = receivedSpeed.toFixed(1);

        // If backend config changed, update UI input elements and recreate the building UI
        if (configChanged) {
             console.log("Backend config differs, recreating UI to match.");
             // Update slider positions and value displays
             if(configMinFloorEl) configMinFloorEl.value = LOWEST_FLOOR;
             if(configMaxFloorEl) configMaxFloorEl.value = HIGHEST_FLOOR;
             if(configCapacityEl) configCapacityEl.value = CAPACITY;
             if(configSpeedEl) configSpeedEl.value = CYCLE_TIME.toFixed(1);
             if(minFloorValueEl) minFloorValueEl.textContent = LOWEST_FLOOR;
             if(maxFloorValueEl) maxFloorValueEl.textContent = HIGHEST_FLOOR;
             if(capacityValueEl) capacityValueEl.textContent = CAPACITY;
             if(speedValueEl) speedValueEl.textContent = CYCLE_TIME.toFixed(1);

             // *** REMOVED call to linkFloorInputs() ***
             // Recreate the main building UI (shaft, floors, controls)
             createBuildingUI();
             // Re-acquire the elevator car element after UI rebuild
             elevatorCar = document.getElementById('elevator-car');
             if (!elevatorCar) { console.error("Failed to find elevator car after UI rebuild!"); return; }
        }
        // Ensure elevator car element exists before proceeding
        if (!elevatorCar) { console.warn("Elevator car element not found during update."); return; }

        // --- Update Elevator Car Position ---
        const floorIndex = state.current_floor - LOWEST_FLOOR; // Position relative to lowest floor
        const bottomPosition = floorIndex * FLOOR_HEIGHT_PX;
        elevatorCar.style.bottom = `${bottomPosition}px`; // Update CSS 'bottom' property

        // --- Update Elevator Car Details Display ---
        const directionSymbol = { 1: "▲", "-1": "▼", 0: "■" }[state.direction] || "?";
        const destinationsText = state.passenger_destinations_display || "Empty";
        const elevatorDetailsEl = document.getElementById('elevator-details');
        if (elevatorDetailsEl) {
            const load = state.current_load;
            const capacity = state.capacity;
            const maxEmojisInside = 8; // Limit visible passenger emojis
            const insideEmojis = '🧍'.repeat(Math.min(load, maxEmojisInside)) + (load > maxEmojisInside ? '...' : '');

            // Update inner HTML of the details display
            elevatorDetailsEl.innerHTML = `
                <div class="text-xs font-semibold leading-none">${directionSymbol}</div>
                <div class="text-xs">${load}/${capacity}</div>
                <div class="text-xs leading-tight break-all emoji-container">${insideEmojis}</div>
                <div class="text-xs mt-1">Dest: ${destinationsText}</div>
            `;
        }

        // --- Update Status Panel ---
        const dirMapStatus = { 1: "▲ Up", "-1": "▼ Down", 0: "■ Idle" };
        if(statusFloorEl) statusFloorEl.textContent = displayFloor(state.current_floor);
        if(statusDirectionEl) statusDirectionEl.textContent = dirMapStatus[state.direction] || "-";
        if(statusLoadEl) statusLoadEl.textContent = state.current_load;
        if(statusCapacityEl) statusCapacityEl.textContent = state.capacity; // Update capacity display too
        if(statusDestinationsEl) statusDestinationsEl.textContent = destinationsText;
        if(statusStopsEl) statusStopsEl.textContent = Array.isArray(state.stops_requested_display) ? state.stops_requested_display.join(', ') : 'None';

        // --- Update Waiting Passengers Display ---
        document.querySelectorAll('.waiting-list').forEach(el => el.innerHTML = ''); // Clear previous waiting lists
        if (state.waiting_passengers && typeof state.waiting_passengers === 'object') {
            for (const floorNumStr in state.waiting_passengers) {
                 const floorNum = parseInt(floorNumStr);
                 if (isNaN(floorNum)) { continue; } // Skip invalid floor numbers

                 const waitingEl = document.getElementById(`waiting-${floorNum}`);
                 if (waitingEl) { // Check if the waiting list element exists for this floor
                    let waitingContent = [];
                    const floorData = state.waiting_passengers[floorNumStr];

                    // Helper function to format waiting list for a specific direction (up/down)
                    const formatWaiting = (list, dirSymbol) => {
                        if (!list || list.length === 0) return ''; // Return empty if no passengers waiting in this direction
                        let textParts = [];
                        let totalWaiting = 0;
                        // Create text summary (e.g., "2▲5, 1▲3")
                        list.forEach(([dest, num]) => {
                            textParts.push(`${num}${dirSymbol}${displayFloor(dest)}`);
                            totalWaiting += num;
                        });
                        const maxEmojisWaiting = 10; // Limit visible waiting emojis
                        const waitingEmojis = '🧍'.repeat(Math.min(totalWaiting, maxEmojisWaiting)) + (totalWaiting > maxEmojisWaiting ? '...' : '');
                        // Return HTML with emojis and text summary
                        return `<div class="flex flex-wrap items-center justify-end gap-x-1 emoji-container">${waitingEmojis}</div><div class="text-xxs text-gray-600 dark:text-gray-400">(${textParts.join(', ')})</div>`;
                    };

                    // Add formatted waiting groups for 'up' and 'down' if passengers exist
                    if (floorData.up?.length > 0) {
                        waitingContent.push(`<div class="waiting-group text-green-700 dark:text-green-400">${formatWaiting(floorData.up, '▲')}</div>`);
                    }
                    if (floorData.down?.length > 0) {
                        waitingContent.push(`<div class="waiting-group text-red-700 dark:text-red-400">${formatWaiting(floorData.down, '▼')}</div>`);
                    }
                    // Update the inner HTML of the waiting list element for this floor
                    waitingEl.innerHTML = waitingContent.join('');
                }
            }
        }
    } // End of updateElevatorUI


     /**
      * Adjusts the number of passengers displayed for a floor's call controls.
      * @param {string} targetId - The ID of the span element displaying the number (e.g., 'num-5').
      * @param {number} delta - The change in number (+1 or -1).
      * @param {number} floorContext - The floor number associated with this control.
      */
     function adjustValue(targetId, delta, floorContext) {
        const targetSpan = document.getElementById(targetId);
        if (!targetSpan) { console.error("Target span not found:", targetId); return; }
        // Only process if it's a number target (ignore potential future adjustments)
        if (!targetId.startsWith('num-')) { console.warn(`adjustValue called for non-num target: ${targetId}`); return; }

        const floor = floorContext; // Floor context passed from the button click
        if (isNaN(floor)) { console.error("AdjustValue Error: Invalid floor context!", {targetId, floorContext}); return; }

        // Read current value from data attribute, default to 1 if missing/invalid
        let currentValueStr = targetSpan.dataset.value || "1";
        let currentValue = parseInt(currentValueStr);
        let newValue;

        if (isNaN(currentValue)) { newValue = 1; } // Default to 1 if current is NaN
        else { newValue = currentValue + delta; } // Calculate new value

        // Clamp the value (minimum 1 passenger)
        let clampedValue = Math.max(1, newValue);

        // Final check for NaN before updating UI
        if (isNaN(clampedValue)) {
            console.error(`adjustValue resulted in NaN for ${targetId}`);
            targetSpan.dataset.value = "1"; // Reset to default
            targetSpan.textContent = "1";
            return;
        }

        // Update both the data attribute (for reading later) and the displayed text
        targetSpan.dataset.value = clampedValue;
        targetSpan.textContent = clampedValue;
     }
     // Expose globally if needed by inline event handlers (though direct listeners are preferred)
     // window.adjustValue = adjustValue;


    // --- WebSocket Functions ---
    /**
     * Establishes a WebSocket connection to the backend server.
     * Sends the initial configuration upon successful connection.
     * Sets up event handlers for messages, errors, and closure.
     */
    function connectWebSocket() {
        const url = wsUrlInput.value; // Get URL from input field
        // Prevent multiple connections
        if (websocket && websocket.readyState === WebSocket.OPEN) {
            console.log("WebSocket already open.");
            return;
        }
        // Close any previous connection attempt before creating a new one
        if (websocket) {
            console.log("Closing previous WebSocket connection attempt.");
            websocket.onclose = null; // Prevent old onclose handler from firing
            websocket.onerror = null; // Prevent old onerror handler from firing
            websocket.close();
        }

        console.log(`Attempting to connect to ${url}...`);
        try {
            websocket = new WebSocket(url); // Create the WebSocket object
        } catch (e) {
            console.error("WS Creation Error:", e);
            alert("Failed to create WebSocket. Check the URL and browser console.");
            if(connectionStatusEl) connectionStatusEl.textContent = "Failed";
            if(connectionStatusEl) connectionStatusEl.className = "font-semibold text-red-500";
            return;
        }

        // Update connection status display
        if(connectionStatusEl) connectionStatusEl.textContent = "Connecting...";
        if(connectionStatusEl) connectionStatusEl.className = "font-semibold text-yellow-500";

        // --- WebSocket Event Handlers ---
        websocket.onopen = (event) => {
            console.log("WebSocket opened.");
            if(connectionStatusEl) connectionStatusEl.textContent = "Connected";
            if(connectionStatusEl) connectionStatusEl.className = "font-semibold text-green-500";
            if(connectButton) connectButton.textContent = "Disconnect";
            // Update button styling for disconnect state
            if(connectButton) {
                connectButton.classList.remove('bg-blue-500', 'hover:bg-blue-600', 'dark:bg-blue-600', 'dark:hover:bg-blue-700');
                connectButton.classList.add('bg-red-500', 'hover:bg-red-600', 'dark:bg-red-600', 'dark:hover:bg-red-700');
            }

            setConfigInputsDisabled(true); // Disable config inputs while connected

            // Send initial configuration based on current UI slider values
            const configToSend = readConfigInputs(true); // Read and update JS globals
            if(configToSend.valid) {
                // *** Send derived start_floor (which is min_floor) ***
                const configMsg = {
                    type: "configure",
                    min_floor: configToSend.min_floor,
                    max_floor: configToSend.max_floor,
                    start_floor: configToSend.start_floor, // Send derived start floor
                    capacity: configToSend.capacity,
                    cycle_time: configToSend.cycle_time
                };
                console.log("Sending initial configuration:", configMsg);
                websocket.send(JSON.stringify(configMsg));
                createBuildingUI(); // Create UI based on the sent config
            } else {
                console.error("Invalid UI config on connect.");
                alert("Configuration values invalid. Please correct them before connecting.");
                disconnectWebSocket(); // Disconnect if config is bad
            }
        };

        websocket.onmessage = (event) => {
             try {
                const message = JSON.parse(event.data);
                // Handle different message types from backend
                switch (message.type) {
                    case 'decision_needed':
                        promptForBoardingDecision(message.data);
                        break;
                    case 'error':
                        console.error("Backend Error:", message.message);
                        alert(`Backend Error: ${message.message}`);
                        break;
                    case 'info':
                        console.info("Backend Info:", message.message);
                        break;
                    default:
                        // Assume it's a state update if type is not recognized
                        updateElevatorUI(message);
                        break;
                }
            } catch (e) {
                console.error("Parse/Update Error:", e, "Raw Data:", event.data);
                // Avoid alerting on every parse error, could be noisy
            }
        };

        websocket.onerror = (event) => {
            console.error("WebSocket error:", event);
            if(connectionStatusEl) connectionStatusEl.textContent = "Error";
            if(connectionStatusEl) connectionStatusEl.className = "font-semibold text-red-500";
             // Ensure closure and cleanup
             if (websocket && websocket.readyState !== WebSocket.CLOSED) {
                 websocket.close();
             }
             websocket = null;
             // Reset UI elements to disconnected state
             resetUIForDisconnect();
        };

        websocket.onclose = (event) => {
            console.log("WebSocket closed:", event.code, event.reason);
            if(connectionStatusEl) connectionStatusEl.textContent = "Disconnected";
            if(connectionStatusEl) connectionStatusEl.className = "font-semibold text-red-500";
            websocket = null; // Clear reference
            // Reset UI elements to disconnected state
            resetUIForDisconnect();
        };
    } // End of connectWebSocket

    /**
     * Closes the WebSocket connection if it's open.
     */
    function disconnectWebSocket() {
        if (websocket && websocket.readyState === WebSocket.OPEN) {
            console.log("Disconnecting WebSocket...");
            websocket.close();
            // onclose handler will manage UI updates and state reset
        } else {
            console.log("WebSocket not open, cannot disconnect.");
        }
    }

    /**
     * Resets UI elements to their state when disconnected from the WebSocket.
     */
    function resetUIForDisconnect() {
        // Reset Connect/Disconnect button
        if(connectButton) {
            connectButton.textContent = "Connect";
            connectButton.classList.remove('bg-red-500', 'hover:bg-red-600', 'dark:bg-red-600', 'dark:hover:bg-red-700');
            connectButton.classList.add('bg-blue-500', 'hover:bg-blue-600', 'dark:bg-blue-600', 'dark:hover:bg-blue-700');
        }
        // Re-enable configuration inputs
        setConfigInputsDisabled(false);
        // Hide decision prompt if it was open
        if (decisionPromptEl) {
            decisionPromptEl.classList.add('hidden');
            decisionPromptEl.classList.remove('flex');
        }
        // Clear any pending decision state
        currentDecision = null;
        // Hide running config display
        if (runningConfigDisplayEl) {
            runningConfigDisplayEl.classList.add('hidden');
        }
    }


    /**
     * Handles the "Call Elevator" button click for a specific floor.
     * Reads the selected destination and number of passengers from the UI,
     * validates the input, and sends a "call" message via WebSocket.
     * @param {number} floor - The floor number where the call button was clicked.
     */
    function callElevator(floor) {
        // Check WebSocket connection
        if (!websocket || websocket.readyState !== WebSocket.OPEN) {
            alert("Not connected to the simulation server."); return;
        }

        const floorNum = parseInt(floor); // Ensure floor is a number
        if (isNaN(floorNum)) {
            console.error(`Invalid floor number passed to callElevator: ${floor}`);
            alert("Internal error: Invalid floor number.");
            return;
        }

        // Use current JS global config for validation bounds
        const currentLowest = LOWEST_FLOOR;
        const currentHighest = HIGHEST_FLOOR;

        // Get controls for the specific floor
        const controlRow = document.getElementById(`controls-${floorNum}`);
        const numSpan = document.getElementById(`num-${floorNum}`);
        if (!controlRow || !numSpan) {
            console.error(`Controls not found for floor ${floorNum}`);
            alert("Internal error: UI elements missing.");
            return;
        }

        // Read selected destination and number of passengers from UI elements
        const destinationStr = controlRow.dataset.selectedDest; // Read from data attribute
        const numPassengersStr = numSpan.dataset.value; // Read from data attribute
        let destination;
        const numPassengers = parseInt(numPassengersStr);

        // --- Input Validation ---
        let errorMessage = null;
        if (destinationStr === "" || destinationStr === null || destinationStr === undefined) {
            errorMessage = `Please select a destination floor using the buttons next to floor ${displayFloor(floorNum)}.`;
        } else {
            destination = parseInt(destinationStr); // Parse destination string

            if (isNaN(destination)) { errorMessage = `Invalid destination stored: ${destinationStr}`; }
            else if (isNaN(numPassengers) || numPassengers < 1) { errorMessage = `Invalid number of passengers (must be >= 1). Value read: ${numPassengersStr}`; }
            // Check destination against current building limits
            else if (!Number.isInteger(destination) || destination < currentLowest || destination > currentHighest) { errorMessage = `Destination floor ${displayFloor(destination)} is outside building limits (${displayFloor(currentLowest)} to ${displayFloor(currentHighest)}).`; }
            // Check if destination is the same as the calling floor
            else if (destination === floorNum) { errorMessage = `Destination cannot be the same as the calling floor (${displayFloor(floorNum)}).`; }
        }

        // If any validation error occurred, show message and stop
        if (errorMessage) {
            alert(errorMessage);
            return;
        }

        // --- Send Call Message via WebSocket ---
        const message = {
            type: "call",
            floor: floorNum,
            destination: destination,
            num_passengers: numPassengers
        };
        console.log("Sending call:", message);
        websocket.send(JSON.stringify(message));

        // --- Reset UI Controls for this Floor After Successful Call ---
        controlRow.dataset.selectedDest = ""; // Clear stored destination
        const buttonsInRow = controlRow.querySelectorAll('.dest-button');
        buttonsInRow.forEach(btn => btn.classList.remove('selected')); // Remove selection highlight
        numSpan.dataset.value = '1'; // Reset number data attribute
        numSpan.textContent = '1';   // Reset displayed number

    } // End of callElevator


    // --- Interactive Boarding Decision Logic ---
    /**
     * Displays a modal prompt asking the user how many passengers should board
     * when a group doesn't fully fit.
     * @param {object} data - Data from the backend ('decision_needed' message).
     * Includes floor, direction, destination, num_waiting, can_board.
     */
    function promptForBoardingDecision(data) {
         // Ensure modal elements exist
         if (!decisionPromptEl || !decisionTextEl || !decisionMaxEl || !decisionInputEl) {
             console.error("Decision prompt elements not found! Auto-cancelling decision.");
             // Send a decision of 0 if UI elements are missing to unblock backend
             sendBoardingDecision(data.floor, data.direction, data.destination, 0);
             return;
         }
         currentDecision = data; // Store the details of the decision needed

         // Populate the modal with information
         decisionTextEl.textContent = `Group of ${data.num_waiting} for floor ${displayFloor(data.destination)} doesn't fit. Space for ${data.can_board}. How many should board?`;
         decisionMaxEl.textContent = data.can_board; // Show max possible in label
         decisionInputEl.value = data.can_board; // Default input to max possible
         decisionInputEl.max = data.can_board;   // Set input max attribute
         decisionInputEl.min = 0;                // Set input min attribute

         // Show the modal
         decisionPromptEl.classList.remove('hidden');
         decisionPromptEl.classList.add('flex');
         decisionInputEl.focus(); // Focus the input field for convenience

         // Temporarily disable connect/disconnect button while prompt is active
         if(connectButton) connectButton.disabled = true;
    }

    /**
     * Sends the user's boarding decision (or cancellation) to the backend.
     * Hides the decision prompt modal.
     * @param {number} floor - The floor where the decision is being made.
     * @param {string} direction - The direction key ('up' or 'down').
     * @param {number} destination - The destination floor of the group.
     * @param {number} numToBoard - The number of passengers the user decided to board (0 for cancel).
     */
    function sendBoardingDecision(floor, direction, destination, numToBoard) {
         // Check WebSocket connection before sending
         if (!websocket || websocket.readyState !== WebSocket.OPEN) {
             console.error("Cannot send decision, WebSocket not open.");
             // Hide prompt and clear state even if WS is closed
             if (decisionPromptEl) {
                 decisionPromptEl.classList.add('hidden');
                 decisionPromptEl.classList.remove('flex');
             }
             currentDecision = null;
             // Re-enable connect/disconnect button if it exists
             if(connectButton) connectButton.disabled = false;
             return;
         }

         // Ensure the decision being sent matches the one we prompted for (basic check)
         if (currentDecision && currentDecision.floor === floor && currentDecision.direction === direction && currentDecision.destination === destination) {
             const message = {
                 type: "boarding_decision",
                 floor: floor,
                 direction: direction,
                 destination: destination,
                 num_to_board: numToBoard // Send the number decided by the user
             };
             console.log("Sending boarding decision:", message);
             websocket.send(JSON.stringify(message));
         } else {
             console.error("Mismatch in current decision data or no decision pending. Decision not sent.");
             // Still hide the prompt even if there's a mismatch, to avoid getting stuck
         }

         // Hide the prompt and clear state after sending (or attempting to send)
         if (decisionPromptEl) {
             decisionPromptEl.classList.add('hidden');
             decisionPromptEl.classList.remove('flex');
         }
         currentDecision = null; // Clear the pending decision details
         // Re-enable connect/disconnect button
         if(connectButton) connectButton.disabled = false;
    }

    // Add event listeners for the decision prompt Confirm/Cancel buttons
    if (decisionConfirmButton) {
        decisionConfirmButton.addEventListener('click', () => {
            if (currentDecision) {
                let num = parseInt(decisionInputEl.value);
                // Validate the input number against allowed range
                if (isNaN(num) || num < 0 || num > currentDecision.can_board) {
                    alert(`Invalid input. Please enter a number between 0 and ${currentDecision.can_board}.`);
                    return; // Keep prompt open if input is invalid
                }
                // Send the confirmed decision
                sendBoardingDecision(currentDecision.floor, currentDecision.direction, currentDecision.destination, num);
            } else {
                console.warn("Confirm clicked but no current decision pending.");
            }
        });
    }

     if (decisionCancelButton) {
         decisionCancelButton.addEventListener('click', () => {
             if (currentDecision) {
                 // Send a decision of 0 (cancel/board none)
                 sendBoardingDecision(currentDecision.floor, currentDecision.direction, currentDecision.destination, 0);
             } else {
                 console.warn("Cancel clicked but no current decision pending.");
                 // Ensure prompt is hidden and button re-enabled just in case state is weird
                 resetUIForDisconnect(); // Use reset function to hide prompt and enable button
             }
         });
     }


    // --- Initialization ---

    // *** REMOVED linkFloorInputs function definition ***

    /**
     * Sets up event listeners for all configuration sliders (Min Floor, Max Floor, Capacity, Speed)
     * to dynamically update their corresponding value display spans.
     */
    function setupSliderListeners() {
        // Array defining sliders and their display elements
        const sliders = [
            { slider: configMinFloorEl, display: minFloorValueEl, isFloat: false },
            { slider: configMaxFloorEl, display: maxFloorValueEl, isFloat: false },
            { slider: configCapacityEl, display: capacityValueEl, isFloat: false },
            { slider: configSpeedEl, display: speedValueEl, isFloat: true } // Speed is float
        ];

        sliders.forEach(({ slider, display, isFloat }) => {
            // Check if both slider and display elements exist
            if (slider && display) {
                // Set initial display value based on slider's default value
                display.textContent = isFloat ? parseFloat(slider.value).toFixed(1) : slider.value;

                // Add 'input' event listener (fires continuously during drag)
                slider.addEventListener('input', () => {
                    // Update display text content
                    display.textContent = isFloat ? parseFloat(slider.value).toFixed(1) : slider.value;
                    // *** REMOVED call to linkFloorInputs() ***
                });
            } else {
                // Log warning if elements are missing
                console.warn("Missing slider or display element for setup:", { sliderId: slider?.id, displayId: display?.id });
            }
        });
    }


    // --- Initial Page Load Setup Sequence ---

    // 1. Read initial config from HTML (sliders) and set JS global defaults
    readConfigInputs(true);

    // 2. *** REMOVED call to linkFloorInputs() ***

    // 3. Set up listeners to update slider value displays dynamically
    setupSliderListeners();

    // 4. Ensure config inputs are enabled initially
    setConfigInputsDisabled(false);

    // 5. Add listener for the "Apply Config" button
    if(applyConfigButton) {
        applyConfigButton.addEventListener('click', () => {
            console.log("Apply Config button clicked.");
            // Read current values from UI sliders
            const config = readConfigInputs(false); // Read UI values, don't update globals yet

            if (config.valid) {
                 console.log("Config read from UI is valid.");
                 // If not connected, update the UI immediately based on the new config
                 if (!websocket || websocket.readyState !== WebSocket.OPEN) {
                     console.log("Not connected. Updating JS globals and recreating UI.");
                     // Update JS globals *before* creating UI
                     LOWEST_FLOOR = config.min_floor;
                     HIGHEST_FLOOR = config.max_floor;
                     START_FLOOR = config.start_floor; // Use derived start floor
                     CAPACITY = config.capacity;
                     CYCLE_TIME = config.cycle_time;
                     // Recreate the building visualization
                     createBuildingUI();
                 } else {
                     // If connected, inform user they need to reconnect for changes to take full effect
                     // (because initial config is sent only on connection)
                     alert("Configuration changes require reconnecting to the simulation server to take full effect.");
                     // Optionally, you could implement a "reconfigure" message type
                     // if the backend supports live reconfiguration.
                     // const reconfigMsg = { type: "reconfigure", ...config };
                     // websocket.send(JSON.stringify(reconfigMsg));
                 }
            } else {
                 // This case should be less likely with sliders and fixed ranges
                 alert("Configuration invalid. Please check slider values.");
            }
        });
    } else { console.error("Apply Config button not found!"); }

    // 6. Add listener for the Connect/Disconnect button
    if(connectButton) {
        connectButton.addEventListener('click', () => {
            // If not connected or closing, attempt to connect
            if (!websocket || websocket.readyState === WebSocket.CLOSED || websocket.readyState === WebSocket.CLOSING) {
                connectWebSocket();
            } else { // Otherwise, disconnect
                disconnectWebSocket();
            }
        });
    } else { console.error("Connect button not found!"); }

    // 7. Initial UI state (e.g., ensure running config is hidden)
    resetUIForDisconnect(); // Use reset function for initial state too

}); // End DOMContentLoaded
