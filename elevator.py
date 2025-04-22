# elevator.py
# Contains the Elevator class definition and its operational logic.
# Displays floor 0 as "G".
# Uses shorter destination summary format with direction arrows.
# Implements directional pickup logic, including stopping for turnarounds.
# Fixes NameError in status method.

import time
from collections import Counter, defaultdict
from typing import List, Set, Dict, Any, Optional, Tuple

class Elevator:
    """
    Represents an elevator with passenger capacity in a building simulation.
    - Displays floor 0 as "G".
    - Handles calls made at its current idle location.
    - Uses shorter destination summary format with direction arrows (e.g., '2▲G', '5▼-1').
    - Only stops for pickups matching its current direction of travel,
      OR if it reaches the end of its current path and a call exists for the opposite direction.
    """

    def __init__(self, lowest_floor, highest_floor, capacity, start_floor):
        if not isinstance(lowest_floor, int) or not isinstance(highest_floor, int):
             raise ValueError("Lowest and highest floor must be integers.")
        if lowest_floor > highest_floor:
            raise ValueError(f"Lowest floor ({lowest_floor}) cannot be higher than highest floor ({highest_floor}).")
        if not isinstance(capacity, int) or capacity < 1:
            raise ValueError("Capacity must be a positive integer.")
        if not isinstance(start_floor, int) or not lowest_floor <= start_floor <= highest_floor:
            raise ValueError(f"Start floor ({start_floor}) must be between {lowest_floor} and {highest_floor}.")

        self.lowest_floor = lowest_floor
        self.highest_floor = highest_floor
        self.capacity = capacity
        self.current_floor = start_floor
        self.direction = 0  # 1: up, -1: down, 0: idle
        self.passenger_destinations = [] # List of destination floors for passengers inside
        self.stops_requested: Dict[int, Set[int]] = defaultdict(set)
        self.stopped_this_step = False
        self.moved_this_step = False
        print(f"Elevator initialized at floor {self._display_floor(self.current_floor)} "
              f"in building {self._display_floor(lowest_floor)}..{self._display_floor(highest_floor)} "
              f"(Cap: {self.capacity}).")


    def _display_floor(self, floor_num):
        """Converts internal floor number to display string (0 as G)."""
        if floor_num == 0:
            return "G"
        else:
            return str(floor_num)

    @property
    def current_load(self):
        """Returns the number of passengers currently in the elevator."""
        return len(self.passenger_destinations)

    def _is_valid_floor(self, floor):
        """Checks if a floor number is within the building's range."""
        return isinstance(floor, int) and self.lowest_floor <= floor <= self.highest_floor

    def add_external_request(self, pickup_floor: int, call_direction: int):
        """
        Adds an external request (a call) for the elevator to stop at a floor
        for a specific direction. Sets elevator direction if idle.
        """
        if not self._is_valid_floor(pickup_floor):
            print(f"  LOG: Warning - Invalid floor {pickup_floor} for external request.")
            return
        if call_direction not in [1, -1]:
            print(f"  LOG: Warning - Invalid call_direction ({call_direction}) for external request.")
            return

        dir_str = 'up' if call_direction == 1 else 'down'
        print(f"  LOG: External request added for floor {self._display_floor(pickup_floor)} (Direction: {dir_str}).")
        self.stops_requested[pickup_floor].add(call_direction)

        if self.direction == 0:
             self.direction = call_direction
             print(f"  LOG: Elevator idle at {self._display_floor(self.current_floor)}. Direction set to {dir_str} based on call direction parameter ({call_direction}).")


    def board_passenger(self, destination_floor):
        """
        Attempts to board a single passenger going to a specific destination.
        Adds the destination to internal lists. Ensures destination is registered
        as a target floor for pathfinding/stopping purposes.
        """
        if not self._is_valid_floor(destination_floor):
            print(f"  LOG: Boarding failed - Invalid destination floor {destination_floor}.")
            return False
        if destination_floor == self.current_floor:
            print(f"  LOG: Boarding failed - Destination is current floor {self._display_floor(self.current_floor)}.")
            return False

        if self.current_load < self.capacity:
            self.passenger_destinations.append(destination_floor)
            # Ensure the destination floor exists as a key in stops_requested for pathfinding logic
            if destination_floor not in self.stops_requested:
                 self.stops_requested[destination_floor] = set()
            print(f"  LOG: Passenger boarded for floor {self._display_floor(destination_floor)}. Load: {self.current_load}/{self.capacity}.")
            return True
        else:
            print(f"  LOG: Boarding failed - Elevator full ({self.current_load}/{self.capacity}).")
            return False


    def _alight_passengers(self):
        """ Handles passengers getting off. """
        passengers_alighting = self.passenger_destinations.count(self.current_floor)
        if passengers_alighting > 0:
            self.passenger_destinations = [dest for dest in self.passenger_destinations if dest != self.current_floor]
        return passengers_alighting

    def _sorted_stops_display(self):
        """Helper for display, sorting requested stops numerically for readability."""
        if not self.stops_requested: return "None"
        floors_with_requests = list(self.stops_requested.keys())
        if not floors_with_requests: return "None"
        return sorted([self._display_floor(f) for f in floors_with_requests],
                      key=lambda x: 0 if x == 'G' else int(x))

    def _passenger_dest_summary(self):
        """ Summarizes passenger destinations concisely. """
        if not self.passenger_destinations: return "Empty"
        counts = Counter(self.passenger_destinations)
        sorted_floors = sorted(counts.keys())
        summary_parts = []
        for floor in sorted_floors:
            count = counts[floor]; floor_display = self._display_floor(floor)
            if floor > self.current_floor: arrow = "▲"
            elif floor < self.current_floor: arrow = "▼"
            else: arrow = "●" if self.direction == 0 else ("▲" if self.direction == 1 else "▼")
            summary_parts.append(f"{count}{arrow}{floor_display}")
        return ", ".join(summary_parts) if summary_parts else "Empty"


    # *** FIXED: Define internal_dests_str ***
    def status(self):
        """Returns a string describing the current state of the elevator."""
        dir_str_map = {1: "up", -1: "down", 0: "idle"}
        dir_symbol = {1: "▲", -1: "▼", 0: "■"}[self.direction]
        floor_range_str = f"{self._display_floor(self.lowest_floor)}..{self._display_floor(self.highest_floor)}"
        dest_summary = self._passenger_dest_summary()
        # Define the internal destinations string for logging/display
        internal_dests_str = ",".join([self._display_floor(f) for f in sorted(list(set(self.passenger_destinations)))])

        return (f"Floor: {self._display_floor(self.current_floor)} [{floor_range_str}] {dir_symbol} "
                f"Dir: {dir_str_map[self.direction]} | "
                f"Load: {self.current_load}/{self.capacity} | "
                f"PassDests: [{internal_dests_str}] | " # Show internal list
                f"Summary: [{dest_summary}] | "
                f"Stops: {self._sorted_stops_display()}")
    # *** End Fix ***


    def step(self):
        """ Simulates one time step with improved directional pickup logic. """
        print(f"--- Elevator Logic Step ---")
        self.stopped_this_step = False
        self.moved_this_step = False
        action_taken = False
        passengers_alighted_count = 0

        # --- 1. Decide if stopping at the current floor ---
        stop_decision = False
        is_internal_destination = self.current_floor in self.passenger_destinations
        directions_requested_here = self.stops_requested.get(self.current_floor, set())
        all_target_floors = set(self.passenger_destinations) | set(self.stops_requested.keys())

        print(f"  LOG: At floor {self._display_floor(self.current_floor)} (Dir: {self.direction}, Load: {self.current_load}/{self.capacity}). InternalDest? {is_internal_destination}. ReqsHere: {directions_requested_here}. AllTargets: {all_target_floors}")

        # Reason 1: Stop for internal destination
        if is_internal_destination:
            stop_decision = True
            print(f"  LOG: Stop reason: Internal destination.")

        # Reason 2: Stop for pickup if idle and requests exist here
        elif self.direction == 0 and directions_requested_here:
             if self.current_load < self.capacity:
                 stop_decision = True
                 print(f"  LOG: Stop reason: Idle pickup.")
             else:
                 print(f"  LOG: Skipping idle pickup (Elevator full).")

        # Reason 3: Stop for pickup matching current direction (if not full)
        elif self.direction in directions_requested_here:
             if self.current_load < self.capacity:
                 stop_decision = True
                 print(f"  LOG: Stop reason: Pickup matching direction.")
             else:
                 print(f"  LOG: Skipping pickup matching direction (Elevator full).")

        # Reason 4: Stop for pickup in opposite direction if this is the end of the current path
        elif self.direction != 0 and -self.direction in directions_requested_here:
             further_targets_in_current_dir = False
             if self.direction == 1:
                 further_targets_in_current_dir = any(f > self.current_floor for f in all_target_floors)
             elif self.direction == -1:
                 further_targets_in_current_dir = any(f < self.current_floor for f in all_target_floors)

             if not further_targets_in_current_dir: # This is the end of the line
                  if self.current_load < self.capacity:
                      stop_decision = True
                      print(f"  LOG: Stop reason: Turnaround pickup.")
                  else:
                      print(f"  LOG: Skipping turnaround pickup (Elevator full).")


        # Final log if not stopping despite requests
        if not stop_decision and directions_requested_here:
             print(f"  LOG: Decided not to stop at {self._display_floor(self.current_floor)} despite requests {directions_requested_here} (Dir: {self.direction}, Load: {self.current_load}/{self.capacity}).")

        # --- Execute Stop if Decided ---
        if stop_decision:
            print(f"  LOG: Stopping actions at floor {self._display_floor(self.current_floor)}.")
            self.stopped_this_step = True
            action_taken = True

            passengers_alighted_count = self._alight_passengers()
            if passengers_alighted_count > 0:
                 print(f"  LOG: {passengers_alighted_count} passenger(s) alighted. Load: {self.current_load}/{self.capacity}")

            # Remove the floor entry from stops_requested dictionary after stopping.
            if self.current_floor in self.stops_requested:
                 del self.stops_requested[self.current_floor]
                 print(f"  LOG: Stop request entry for {self._display_floor(self.current_floor)} removed by elevator logic. Remaining stops: {self._sorted_stops_display()}")

        # --- 2. Determine movement logic (only if not stopped this step) ---
        if not self.stopped_this_step:
            print(f"  LOG: Did not stop. Evaluating movement from floor {self._display_floor(self.current_floor)}.")
            moved_now = False
            current_direction = self.direction

            # Recalculate targets for movement decision
            all_target_floors = set(self.passenger_destinations) | set(self.stops_requested.keys())

            # --- Logic if Moving Up ---
            if current_direction == 1:
                has_targets_above = any(f > self.current_floor for f in all_target_floors)
                print(f"  LOG: Moving UP. Targets above? {has_targets_above}. Current floor < highest? {self.current_floor < self.highest_floor}.")

                if has_targets_above and self.current_floor < self.highest_floor:
                    self.current_floor += 1
                    print(f"  LOG: Moving up to floor {self._display_floor(self.current_floor)}.")
                    moved_now = True
                else: # Reached end of upward path
                    print(f"  LOG: Reached top or highest UP target.")
                    has_targets_below = any(f < self.current_floor for f in all_target_floors)
                    if has_targets_below:
                        self.direction = -1
                        print(f"  LOG: Targets exist below. Changing direction to DOWN.")
                    elif not all_target_floors and self.current_load == 0:
                         self.direction = 0
                         print(f"  LOG: No targets or passengers. Becoming IDLE.")
                    elif not has_targets_below and self.current_load > 0:
                         print(f"  LOG: WARNING - No targets below, but still have passengers? Destinations: {self._passenger_dest_summary()}. Becoming IDLE.")
                         self.direction = 0
                    elif not all_target_floors:
                         self.direction = 0
                         print(f"  LOG: No targets remaining. Becoming IDLE.")


            # --- Logic if Moving Down ---
            elif current_direction == -1:
                has_targets_below = any(f < self.current_floor for f in all_target_floors)
                print(f"  LOG: Moving DOWN. Targets below? {has_targets_below}. Current floor > lowest? {self.current_floor > self.lowest_floor}.")

                if has_targets_below and self.current_floor > self.lowest_floor:
                    self.current_floor -= 1
                    print(f"  LOG: Moving down to floor {self._display_floor(self.current_floor)}.")
                    moved_now = True
                else: # Reached end of downward path
                    print(f"  LOG: Reached bottom or lowest DOWN target.")
                    has_targets_above = any(f > self.current_floor for f in all_target_floors)
                    if has_targets_above:
                        self.direction = 1
                        print(f"  LOG: Targets exist above. Changing direction to UP.")
                    elif not all_target_floors and self.current_load == 0:
                         self.direction = 0
                         print(f"  LOG: No targets or passengers. Becoming IDLE.")
                    elif not has_targets_above and self.current_load > 0:
                         print(f"  LOG: WARNING - No targets above, but still have passengers? Destinations: {self._passenger_dest_summary()}. Becoming IDLE.")
                         self.direction = 0
                    elif not all_target_floors:
                         self.direction = 0
                         print(f"  LOG: No targets remaining. Becoming IDLE.")


            # --- Logic if Idle ---
            elif current_direction == 0:
                print(f"  LOG: Currently IDLE at {self._display_floor(self.current_floor)}.")
                # Check if state requires recovery (should have direction set by add_external_request if called)
                if self.stops_requested or self.passenger_destinations:
                     internal_dests_str_idle = ",".join([self._display_floor(f) for f in sorted(list(set(self.passenger_destinations)))]) # Define here for log
                     print(f"  LOG: Idle check: Stops={self._sorted_stops_display()}, PassDests=[{internal_dests_str_idle}]. Attempting recovery.")
                     all_targets = set(self.passenger_destinations) | set(self.stops_requested.keys())
                     go_up = any(f > self.current_floor for f in all_targets)
                     go_down = any(f < self.current_floor for f in all_targets)
                     if go_up: self.direction = 1; print("  LOG: Setting direction UP based on pending targets.")
                     elif go_down: self.direction = -1; print("  LOG: Setting direction DOWN based on pending targets.")
                else:
                     print("  LOG: Idle. No stops requested. Doing nothing.")

            # --- Post-Movement Update ---
            if moved_now:
                self.moved_this_step = True
                action_taken = True
                # Check if the new floor requires a stop for the *next* step
                new_floor_dirs = self.stops_requested.get(self.current_floor, set())
                new_floor_pickup_matches_dir = self.direction in new_floor_dirs
                new_floor_pickup_matches_idle = (self.direction == 0 and new_floor_dirs)
                new_floor_turnaround = (-self.direction in new_floor_dirs) # Check if opposite dir is requested

                is_next_internal_dest = self.current_floor in self.passenger_destinations

                # Determine if a stop is likely needed next step (for logging)
                needs_stop_next = is_next_internal_dest or new_floor_pickup_matches_dir or new_floor_pickup_matches_idle
                if not needs_stop_next and new_floor_turnaround: # Check turnaround only if not stopping otherwise
                    # Check if end of line
                    further_targets_in_current_dir = False
                    if self.direction == 1: further_targets_in_current_dir = any(f > self.current_floor for f in all_target_floors)
                    elif self.direction == -1: further_targets_in_current_dir = any(f < self.current_floor for f in all_target_floors)
                    if not further_targets_in_current_dir: needs_stop_next = True # Will stop for turnaround

                if needs_stop_next:
                    print(f"  LOG: Moved to a floor ({self._display_floor(self.current_floor)}) that may require stopping next step.")

        else: # stopped_this_step was True
             print(f"  LOG: Stopped this step. No movement evaluation.")

        print(f"--- End Elevator Logic Step ---")
        return action_taken

