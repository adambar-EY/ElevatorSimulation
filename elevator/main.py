# main.py (FastAPI Backend - Serves Static Files)

import asyncio
import json
import logging
from collections import defaultdict
from typing import List, Set, Dict, Any, Optional, Tuple
import os # Import os module

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState
# *** NEW: Imports for static files and HTML response ***
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
# *** End New Imports ***

# Assuming elevator.py is in the same directory
from elevator import Elevator # Use the latest elevator.py

# --- Logging Setup ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Configuration ---
DEFAULT_LOWEST_FLOOR = -1
DEFAULT_HIGHEST_FLOOR = 5
DEFAULT_CAPACITY = 8
DEFAULT_START_FLOOR = 0
DEFAULT_CYCLE_TIME = 3.0

# --- Global State ---
elevator: Optional[Elevator] = None
waiting_passengers: Dict[int, Dict[str, List[tuple[int, int]]]] = defaultdict(lambda: defaultdict(list))
active_connections: Set[WebSocket] = set()
current_simulation_task: Optional[asyncio.Task] = None
current_cycle_time = DEFAULT_CYCLE_TIME

reconfig_lock = asyncio.Lock()
sim_state_lock = asyncio.Lock()

# --- State for Interactive Boarding ---
pending_decision_details: Optional[Tuple[int, str, int, int, int]] = None
decision_received_event = asyncio.Event()
user_decision_num_to_board: int = 0


# --- Boarding Logic ---
# (No changes needed in boarding logic itself)
async def _attempt_board_direction(current_floor: int, direction_key: str) -> bool:
    """ Attempts boarding for a direction. Auto-boards max possible on partial fit. Modifies global state. Returns True if any passenger boarded. """
    global elevator, waiting_passengers, pending_decision_details, decision_received_event, user_decision_num_to_board
    if elevator is None: return False
    boarded_in_this_direction = False
    if current_floor in waiting_passengers and direction_key in waiting_passengers[current_floor]:
        current_waiting_list = list(waiting_passengers[current_floor][direction_key])
        new_waiting_list_for_dir = []
        if current_waiting_list:
            logger.info(f"BOARDING: Checking '{direction_key}' at floor {elevator._display_floor(current_floor)}: {[(elevator._display_floor(d), n) for d, n in current_waiting_list]}")
            processed_indices = set()
            original_indices = list(range(len(current_waiting_list)))
            for i in original_indices:
                if i >= len(current_waiting_list): break
                if i in processed_indices: continue
                dest, num_waiting = current_waiting_list[i]
                remaining_capacity = elevator.capacity - elevator.current_load
                logger.info(f"BOARDING: Checking group {i+1}: {num_waiting}p for {elevator._display_floor(dest)}. Elevator State: Cap={elevator.capacity}, Load={elevator.current_load}, Space={remaining_capacity}")
                if remaining_capacity == 0:
                    logger.info("BOARDING: Elevator full. Group waits.")
                    new_waiting_list_for_dir.append((dest, num_waiting)); processed_indices.add(i); continue
                if remaining_capacity >= num_waiting:
                    logger.info(f"BOARDING: Group fits. Boarding all {num_waiting}...")
                    boarded_count_for_group = 0; all_boarded_successfully = True
                    for _ in range(num_waiting):
                        if elevator.board_passenger(dest): boarded_count_for_group += 1
                        else: all_boarded_successfully = False; break
                    if all_boarded_successfully:
                        logger.info(f"BOARDING: Group of {num_waiting} for {elevator._display_floor(dest)} BOARDED. Load: {elevator.current_load}/{elevator.capacity}")
                        boarded_in_this_direction = True; processed_indices.add(i)
                    else:
                         logger.error(f"BOARDING: Failed to board full group to {elevator._display_floor(dest)} despite capacity! Group waits.")
                         new_waiting_list_for_dir.append((dest, num_waiting)); processed_indices.add(i)
                else:
                    logger.info(f"BOARDING: Partial fit for group to {elevator._display_floor(dest)}. Auto-boarding {remaining_capacity}.")
                    pending_decision_details = (current_floor, direction_key, dest, num_waiting, remaining_capacity)
                    user_decision_num_to_board = remaining_capacity
                    decision_received_event.set()
                    new_waiting_list_for_dir.append((dest, num_waiting)); processed_indices.add(i)
                    logger.info(f"BOARDING: Triggering auto-decision processing for partial fit.")
            if pending_decision_details is None:
                 waiting_passengers[current_floor][direction_key] = new_waiting_list_for_dir
                 if not new_waiting_list_for_dir and direction_key in waiting_passengers.get(current_floor, {}):
                     try: del waiting_passengers[current_floor][direction_key]
                     except KeyError: pass
                     if not waiting_passengers.get(current_floor):
                         try: del waiting_passengers[current_floor]
                         except KeyError: pass
    return boarded_in_this_direction

async def broadcast_decision_request(message: str):
    await asyncio.gather( *[conn.send_text(message) for conn in active_connections if conn.client_state == WebSocketState.CONNECTED], return_exceptions=True )

def process_boarding_decision():
    """ Processes the stored (potentially auto-set) user decision and updates state. Assumes lock is held by caller. """
    global elevator, waiting_passengers, pending_decision_details, user_decision_num_to_board
    if pending_decision_details is None: return False
    floor, direction, dest, num_waiting, can_board = pending_decision_details
    num_to_board = max(0, min(user_decision_num_to_board, can_board))
    logger.info(f"PROCESS_DECISION: Processing decision for F{floor} {direction} to {dest}. Boarding: {num_to_board} (out of {num_waiting} waiting, {can_board} capacity)")
    boarded_count = 0
    if num_to_board > 0:
        logger.info(f"PROCESS_DECISION: Attempting to board {num_to_board}...")
        for i in range(num_to_board):
            if elevator.board_passenger(dest): boarded_count += 1
            else: logger.error(f"PROCESS_DECISION: Failed boarding passenger {i+1}/{num_to_board}!"); break
    if boarded_count > 0: logger.info(f"PROCESS_DECISION: Boarded {boarded_count}. Load: {elevator.current_load}/{elevator.capacity}")
    else: logger.info(f"PROCESS_DECISION: Boarded 0.")
    new_waiting_list_for_dir = []; original_found_and_processed = False
    if floor in waiting_passengers and direction in waiting_passengers[floor]:
         current_waiting_list = waiting_passengers[floor][direction]
         for d, n in current_waiting_list:
              if d == dest and n == num_waiting and not original_found_and_processed:
                   original_found_and_processed = True
                   remaining_in_group = num_waiting - boarded_count
                   if remaining_in_group > 0:
                       logger.info(f"PROCESS_DECISION: {remaining_in_group} remain waiting for {dest}.")
                       new_waiting_list_for_dir.append((dest, remaining_in_group))
                   else:
                       logger.info(f"PROCESS_DECISION: Group for {dest} fully processed.")
              else:
                  new_waiting_list_for_dir.append((d, n))
         waiting_passengers[floor][direction] = new_waiting_list_for_dir
         if not new_waiting_list_for_dir:
              del waiting_passengers[floor][direction]
              if not waiting_passengers[floor]: del waiting_passengers[floor]
    else: logger.error("PROCESS_DECISION: Waiting list inconsistency for the processed group.")
    pending_decision_details = None
    user_decision_num_to_board = 0
    return boarded_count > 0

async def handle_boarding(current_floor: int) -> bool:
    """ Handles boarding logic. May trigger decision processing. Re-requests stop if passengers remain. Assumes lock is held by caller."""
    global elevator, waiting_passengers, pending_decision_details, decision_received_event
    if elevator is None: return False
    logger.info(f"BOARDING: Phase start at floor {elevator._display_floor(current_floor)}")
    arrival_direction = elevator.direction
    boarded_this_turn_overall = False
    async def try_boarding(direction_key):
        nonlocal boarded_this_turn_overall
        if pending_decision_details:
            logger.info(f"BOARDING: Processing pending decision before trying '{direction_key}'...")
            processed = process_boarding_decision()
            if processed: boarded_this_turn_overall = True
            decision_received_event.clear()
        boarded = await _attempt_board_direction(current_floor, direction_key)
        if boarded: boarded_this_turn_overall = True
        if pending_decision_details:
             logger.info(f"BOARDING: Processing decision triggered by '{direction_key}'...")
             processed_after = process_boarding_decision()
             if processed_after: boarded_this_turn_overall = True
             decision_received_event.clear()
        return boarded
    if arrival_direction == 0:
        await try_boarding('up')
        if elevator.current_load < elevator.capacity: await try_boarding('down')
    elif arrival_direction == 1:
        await try_boarding('up')
        has_stops_strictly_above = any(f > current_floor for f in (set(elevator.passenger_destinations) | set(elevator.stops_requested.keys())))
        if not has_stops_strictly_above and elevator.current_load < elevator.capacity:
             logger.info("BOARDING: Turnaround check (UP -> DOWN).")
             await try_boarding('down')
    elif arrival_direction == -1:
        await try_boarding('down')
        has_stops_strictly_below = any(f < current_floor for f in (set(elevator.passenger_destinations) | set(elevator.stops_requested.keys())))
        if not has_stops_strictly_below and elevator.current_load < elevator.capacity:
             logger.info("BOARDING: Turnaround check (DOWN -> UP).")
             await try_boarding('up')
    waiting_up = waiting_passengers.get(current_floor, {}).get('up', [])
    waiting_down = waiting_passengers.get(current_floor, {}).get('down', [])
    if waiting_up or waiting_down:
        logger.info(f"BOARDING: Passengers remain waiting after attempts at F{current_floor}. Re-requesting stop.")
        call_dir = 1 if waiting_up else -1
        elevator.add_external_request(current_floor, call_dir)
    elif current_floor in waiting_passengers:
         if not waiting_passengers[current_floor]:
              try: del waiting_passengers[current_floor]
              except KeyError: pass
    if boarded_this_turn_overall and arrival_direction == 0:
         if any(p > current_floor for p in elevator.passenger_destinations):
             elevator.direction = 1
             logger.info(f"BOARDING: Direction set to UP based on passenger destinations.")
         elif any(p < current_floor for p in elevator.passenger_destinations):
             elevator.direction = -1
             logger.info(f"BOARDING: Direction set to DOWN based on passenger destinations.")
    logger.info(f"BOARDING: Phase end at floor {elevator._display_floor(current_floor)}")
    return boarded_this_turn_overall


# --- State Preparation & Broadcasting ---
def get_current_state() -> Dict[str, Any]:
    global elevator, waiting_passengers, current_cycle_time
    if elevator is None: return { "lowest_floor": DEFAULT_LOWEST_FLOOR, "highest_floor": DEFAULT_HIGHEST_FLOOR, "capacity": DEFAULT_CAPACITY, "current_floor": DEFAULT_START_FLOOR, "direction": 0, "current_load": 0, "passenger_destinations_display": "N/A (Not Initialized)", "stops_requested_display": [], "waiting_passengers": {}, "cycle_time": current_cycle_time }
    waiting_copy = defaultdict(lambda: defaultdict(list));
    for floor, directions in waiting_passengers.items():
        if directions.get('up'): waiting_copy[floor]['up'] = list(directions['up'])
        if directions.get('down'): waiting_copy[floor]['down'] = list(directions['down'])
    return { "lowest_floor": elevator.lowest_floor, "highest_floor": elevator.highest_floor, "capacity": elevator.capacity, "current_floor": elevator.current_floor, "direction": elevator.direction, "current_load": elevator.current_load, "passenger_destinations_display": elevator._passenger_dest_summary(), "stops_requested_display": elevator._sorted_stops_display(), "waiting_passengers": dict(waiting_copy), "cycle_time": current_cycle_time }

async def broadcast_state():
    current_state_data = None
    async with sim_state_lock:
         if elevator is not None:
              current_state_data = get_current_state()
    if active_connections and current_state_data is not None:
        state_json = json.dumps(current_state_data)
        results = await asyncio.gather( *[conn.send_text(state_json) for conn in active_connections if conn.client_state == WebSocketState.CONNECTED], return_exceptions=True )
        for result in results:
            if isinstance(result, Exception): logger.warning(f"BROADCAST: Error sending state: {result}")


# --- Simulation Loop Task ---
async def simulation_loop():
    """Runs the elevator simulation logic periodically, handling boarding."""
    global elevator, current_cycle_time, pending_decision_details, decision_received_event, waiting_passengers, sim_state_lock
    logger.info("Simulation loop task started and waiting for configuration...")
    while elevator is None: await asyncio.sleep(0.5)
    logger.info("Elevator configured. Simulation loop running.")
    while True:
        start_time = asyncio.get_event_loop().time()
        action_taken_this_cycle = False
        try:
            async with sim_state_lock:
                if elevator is not None:
                    action_taken = elevator.step()
                    stopped = elevator.stopped_this_step
                    current_floor = elevator.current_floor
                    action_taken_this_cycle = action_taken
                    if stopped:
                        boarded_anyone = await handle_boarding(current_floor)
                        action_taken_this_cycle = action_taken_this_cycle or boarded_anyone
            await broadcast_state()
            elapsed_time = asyncio.get_event_loop().time() - start_time
            sleep_duration = max(0.05, current_cycle_time - elapsed_time)
            await asyncio.sleep(sleep_duration)
        except asyncio.CancelledError: logger.info("Simulation loop cancelled."); break
        except Exception as e: logger.error(f"SIM LOOP: Unhandled exception: {e}", exc_info=True); await asyncio.sleep(current_cycle_time if current_cycle_time > 0 else 1.0)


# --- FastAPI Application ---
app = FastAPI(title="Elevator Simulation Backend")

# *** NEW: Define static files directory (relative to main.py) ***
# Ensure this directory exists and contains style.css, script.js
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
INDEX_HTML_PATH = os.path.join(os.path.dirname(__file__), "index.html")

# *** NEW: Mount the static directory ***
# This will serve files from ./static/ at the /static URL path
# Make sure this is defined *before* the root path route if using root for index.html
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
else:
    logger.warning(f"Static directory not found at {STATIC_DIR}. Static files will not be served.")

# Startup/Shutdown events remain the same
@app.on_event("startup")
async def startup_event(): logger.info("Backend started.")
@app.on_event("shutdown")
async def shutdown_event():
     global current_simulation_task, sim_state_lock
     logger.info("Backend shutting down...")
     if sim_state_lock.locked(): logger.warning("Shutdown: Simulation lock was held, releasing."); sim_state_lock.release() # Force release if needed
     if current_simulation_task and not current_simulation_task.done():
          logger.info("Cancelling simulation task..."); current_simulation_task.cancel()
          try: await asyncio.wait_for(current_simulation_task, timeout=2.0)
          except asyncio.CancelledError: logger.info("Simulation task cancelled successfully.")
          except asyncio.TimeoutError: logger.warning("Timeout waiting for simulation task cancellation.")
          except Exception as e: logger.error(f"Error stopping simulation task: {e}")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Handles WebSocket connections, configuration, and incoming messages."""
    global elevator, waiting_passengers, current_simulation_task, current_cycle_time
    global pending_decision_details, decision_received_event, user_decision_num_to_board
    global sim_state_lock, reconfig_lock

    await websocket.accept()
    active_connections.add(websocket)
    logger.info(f"Client connected: {websocket.client}. Total clients: {len(active_connections)}")

    client_configured_sim = False

    try:
        # --- Configuration Phase ---
        try:
            config_data = await asyncio.wait_for(websocket.receive_text(), timeout=45.0)
            message = json.loads(config_data)
            msg_type = message.get("type")

            if msg_type == "configure":
                async with reconfig_lock:
                    logger.info(f"Received configuration message: {message}")
                    min_f=message.get("min_floor", DEFAULT_LOWEST_FLOOR); max_f=message.get("max_floor", DEFAULT_HIGHEST_FLOOR)
                    cap = message.get("capacity", DEFAULT_CAPACITY); start_f = message.get("start_floor", DEFAULT_START_FLOOR)
                    cycle_t = message.get("cycle_time", DEFAULT_CYCLE_TIME)
                    is_valid_config = True
                    if not (isinstance(min_f, int) and isinstance(max_f, int) and isinstance(cap, int) and cap >= 1 and isinstance(start_f, int) and isinstance(cycle_t, (int, float)) and 1.0 <= cycle_t <= 10.0): is_valid_config = False; logger.error("Invalid config types/range.")
                    elif not (min_f <= start_f <= max_f): is_valid_config = False; logger.error("Invalid start floor.")
                    elif min_f > max_f: is_valid_config = False; logger.error("Invalid min/max floor.")

                    if is_valid_config:
                        logger.info("Applying new configuration...");
                        if current_simulation_task and not current_simulation_task.done():
                            logger.info("Cancelling existing simulation task for reconfig...")
                            current_simulation_task.cancel()
                            try: await asyncio.wait_for(current_simulation_task, timeout=1.0)
                            except asyncio.CancelledError: logger.info("Existing task cancelled.")
                            except asyncio.TimeoutError: logger.warning("Timeout waiting for task cancellation.")
                            except Exception as e: logger.error(f"Error awaiting cancelled task: {e}")
                            current_simulation_task = None
                        async with sim_state_lock:
                            waiting_passengers = defaultdict(lambda: defaultdict(list))
                            current_cycle_time = cycle_t
                            elevator = Elevator(lowest_floor=min_f, highest_floor=max_f, capacity=cap, start_floor=start_f)
                            logger.info(f"Elevator re-initialized by {websocket.client}")
                            pending_decision_details = None; decision_received_event.clear(); user_decision_num_to_board = 0
                        logger.info("Starting new simulation loop task...");
                        current_simulation_task = asyncio.create_task(simulation_loop())
                        client_configured_sim = True
                        await broadcast_state()
                    else:
                         logger.error("Invalid config data received. Closing connection.")
                         await websocket.send_text(json.dumps({"type":"error", "message":"Invalid config data received."}))
                         await websocket.close(code=1008) # Close immediately

            else:
                logger.warning("First message was not 'configure'. Closing connection.")
                await websocket.close(code=1008)

        except asyncio.TimeoutError: logger.warning("Timeout waiting for config."); await websocket.close(code=1008)
        except json.JSONDecodeError: logger.warning("Invalid JSON for config."); await websocket.close(code=1008)
        except WebSocketDisconnect: logger.warning("Client disconnected during config.")
        except Exception as e: logger.error(f"Config Error: {e}", exc_info=True); await websocket.close(code=1011)

        if websocket.client_state != WebSocketState.CONNECTED:
             active_connections.discard(websocket)
             logger.info(f"Client connection closed during/after config phase.")
             return

        # --- Main Message Handling Loop ---
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                msg_type = message.get("type")
                should_reconfig = False

                if msg_type in ["call", "ping", "boarding_decision"]:
                    async with sim_state_lock:
                        if msg_type == "call":
                            # (No changes from previous version)
                            if elevator is None: continue
                            floor = message.get("floor"); dest = message.get("destination"); num = message.get("num_passengers", 1)
                            is_valid_call = True; direction_str = None; call_direction_numeric = 0
                            if not isinstance(floor, int) or not elevator._is_valid_floor(floor): is_valid_call = False; logger.warning(f"Invalid call: Bad floor {floor}")
                            elif not isinstance(dest, int) or not elevator._is_valid_floor(dest): is_valid_call = False; logger.warning(f"Invalid call: Bad destination {dest}")
                            elif not isinstance(num, int) or num < 1: is_valid_call = False; logger.warning(f"Invalid call: Bad num_passengers {num}")
                            elif floor == dest: is_valid_call = False; logger.warning(f"Invalid call: floor == dest ({floor})")
                            else: direction_str = 'up' if dest > floor else 'down'; call_direction_numeric = 1 if direction_str == 'up' else -1
                            if is_valid_call and direction_str:
                                logger.info(f"Processing call: F{floor} to {dest} ({num}p). Inferred direction: {direction_str}")
                                waiting_passengers[floor][direction_str].append((dest, num)); elevator.add_external_request(floor, call_direction_numeric); logger.info("Call registered by backend.")
                            else: logger.warning(f"Invalid call message received or could not infer direction: {message}"); await websocket.send_text(json.dumps({"type": "error", "message": "Invalid call data received."}))
                        elif msg_type == "boarding_decision": logger.warning(f"Received deprecated boarding_decision message: {message}") # Deprecated
                        elif msg_type == "ping":
                             # (No changes from previous version)
                             if elevator is None: continue
                             floor = message.get("floor"); direction = message.get("direction"); logger.info(f"Received ping for floor {floor} direction {direction}")
                             if isinstance(floor, int) and elevator._is_valid_floor(floor) and direction in ['up', 'down']: ping_direction_numeric = 1 if direction == 'up' else -1; elevator.add_external_request(floor, ping_direction_numeric)
                             else: logger.warning(f"Invalid ping data: {message}")
                elif msg_type == "configure": should_reconfig = True; logger.info("Received re-configure request.")
                else: logger.warning(f"Unknown message type received: {msg_type}")

                if should_reconfig:
                    async with reconfig_lock:
                         logger.info(f"Handling RE-configuration message from {websocket.client}: {message}")
                         min_f=message.get("min_floor", elevator.lowest_floor if elevator else DEFAULT_LOWEST_FLOOR); max_f=message.get("max_floor", elevator.highest_floor if elevator else DEFAULT_HIGHEST_FLOOR); cap = message.get("capacity", elevator.capacity if elevator else DEFAULT_CAPACITY); start_f = message.get("start_floor", DEFAULT_START_FLOOR); cycle_t = message.get("cycle_time", current_cycle_time)
                         is_valid_reconfig = True
                         if not (isinstance(min_f, int) and isinstance(max_f, int) and isinstance(cap, int) and cap >= 1 and isinstance(start_f, int) and isinstance(cycle_t, (int, float)) and 1.0 <= cycle_t <= 10.0): is_valid_reconfig = False; logger.error("Invalid re-config types/range.")
                         elif not (min_f <= start_f <= max_f): is_valid_reconfig = False; logger.error("Invalid re-config start floor.")
                         elif min_f > max_f: is_valid_reconfig = False; logger.error("Invalid re-config min/max floor.")
                         if is_valid_reconfig:
                            logger.info("Applying re-configuration...");
                            if current_simulation_task and not current_simulation_task.done():
                                current_simulation_task.cancel(); await asyncio.sleep(0.1)
                                try: await current_simulation_task
                                except asyncio.CancelledError: logger.info("Existing task cancelled for reconfig.")
                                except Exception as e: logger.error(f"Error awaiting cancelled task: {e}")
                                current_simulation_task = None
                            async with sim_state_lock:
                                waiting_passengers = defaultdict(lambda: defaultdict(list)); current_cycle_time = cycle_t
                                elevator = Elevator(lowest_floor=min_f, highest_floor=max_f, capacity=cap, start_floor=start_f)
                                logger.info(f"Elevator re-initialized by {websocket.client}"); pending_decision_details = None; decision_received_event.clear(); user_decision_num_to_board = 0
                            logger.info("Starting new simulation loop task..."); current_simulation_task = asyncio.create_task(simulation_loop())
                            await broadcast_state()
                         else: logger.error("Invalid re-configuration data received."); await websocket.send_text(json.dumps({"type":"error", "message":"Invalid re-config data received."}))

            except json.JSONDecodeError: logger.warning("Received invalid JSON.")
            except WebSocketDisconnect: logger.info(f"Client disconnected during message loop: {websocket.client}"); break
            except Exception as e: logger.error(f"Msg Processing Error: {e}", exc_info=True)

    except WebSocketDisconnect: logger.info(f"Client disconnected: {websocket.client}")
    except Exception as e: logger.error(f"WS Handler Error for {websocket.client}: {e}", exc_info=True); await websocket.close(code=1011)
    finally: active_connections.discard(websocket); logger.info(f"Client connection closed/removed. Total clients: {len(active_connections)}")


# *** NEW: Route to serve index.html ***
@app.get("/", response_class=HTMLResponse)
async def read_index():
    if not os.path.exists(INDEX_HTML_PATH):
        logger.error(f"index.html not found at {INDEX_HTML_PATH}")
        return HTMLResponse(content="<html><body><h1>Index file not found</h1></body></html>", status_code=500)
    with open(INDEX_HTML_PATH) as f:
        return HTMLResponse(content=f.read(), status_code=200)

# --- Run Instructions ---
# uvicorn main:app --reload --port 5050 # For local dev
# gunicorn -w 4 -k uvicorn.workers.UvicornWorker main:app -b 0.0.0.0:8000 # For production
