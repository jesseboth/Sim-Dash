"""
SimDash UDP Telemetry Plugin for Assetto Corsa
Broadcasts telemetry data via UDP in custom format for SimDash integration
"""

import ac
import acsys
import sys
import platform
import os

# Add AC's Python stdlib zip to path so we can import socket etc.
sys.path.insert(0, os.path.dirname(__file__) + '/Python33.zip')

import socket
import struct

# Configuration
UDP_IP = "127.0.0.1"         # Change to your telemetry server IP
UDP_PORTS = [9999, 20778]    # Ports to broadcast to (can add more)
UPDATE_RATE_HZ = 40          # Update rate in Hz

# Global state
sock = None
car_id = 0
track_id = 0
frame_counter = 0
frames_per_update = 0

def acMain(ac_version):
    """Called when the plugin is loaded"""
    global sock, car_id, track_id, frames_per_update

    try:
        # Create UDP socket
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

        # Calculate how many frames to skip based on update rate
        # AC runs at ~60 FPS, so for 40Hz we send every 1-2 frames
        frames_per_update = max(1, int(60.0 / UPDATE_RATE_HZ))

        # Get car and track info
        car_name = ac.getCarName(0)
        track_name = ac.getTrackName(0)
        track_config = ac.getTrackConfiguration(0)

        # Create composite track identifier
        if track_config:
            track_full = track_name + "_" + track_config
        else:
            track_full = track_name

        # Hash to signed 32-bit integers
        car_id = hash_to_s32(car_name)
        track_id = hash_to_s32(track_full)

        ac.log("SimDash UDP Plugin Loaded")
        ac.console("SimDash UDP Plugin Loaded")
        ac.console("Car: {} (ID: {})".format(car_name, car_id))
        ac.console("Track: {} (ID: {})".format(track_full, track_id))
        ac.console("Sending to {}:{} @ {}Hz".format(UDP_IP, UDP_PORTS, UPDATE_RATE_HZ))

    except Exception as e:
        ac.console("SimDash UDP Error in acMain: {}".format(str(e)))

    return "SimDash UDP"

def acUpdate(deltaT):
    """Called every physics update (~60Hz)"""
    global frame_counter

    try:
        frame_counter += 1

        # Only send data at configured rate
        if frame_counter >= frames_per_update:
            frame_counter = 0
            send_telemetry()

    except Exception as e:
        ac.console("SimDash UDP Error in acUpdate: {}".format(str(e)))

def acShutdown():
    """Called when the plugin is unloaded"""
    global sock

    try:
        if sock:
            sock.close()
        ac.console("SimDash UDP Plugin Shutdown")
    except:
        pass

def hash_to_s32(text):
    """Hash a string to a signed 32-bit integer"""
    # Python's hash() is not consistent across runs, so use a simple hash
    h = 0
    for char in text:
        h = (h * 31 + ord(char)) & 0xFFFFFFFF

    # Convert to signed 32-bit
    if h >= 0x80000000:
        h = h - 0x100000000

    return h

def send_telemetry():
    """Collect telemetry data and send UDP packet"""
    global sock, car_id, track_id

    if not sock:
        return

    try:
        # Get car state data
        speed_kmh = ac.getCarState(0, acsys.CS.SpeedKMH)
        speed_mph = speed_kmh * 0.621371  # Convert to mph
        speed_ms = speed_kmh / 3.6        # Convert to m/s

        # Get input states
        gas = ac.getCarState(0, acsys.CS.Gas)
        brake = ac.getCarState(0, acsys.CS.Brake)
        clutch = ac.getCarState(0, acsys.CS.Clutch)
        steer = ac.getCarState(0, acsys.CS.Steer)

        # Get engine/gear data
        rpm = ac.getCarState(0, acsys.CS.RPM)
        gear = ac.getCarState(0, acsys.CS.Gear)

        # Get lap timing (in milliseconds)
        current_lap_ms = ac.getCarState(0, acsys.CS.LapTime)
        last_lap_ms = ac.getCarState(0, acsys.CS.LastLap)
        best_lap_ms = ac.getCarState(0, acsys.CS.BestLap)
        lap_count = ac.getCarState(0, acsys.CS.LapCount)

        # Get assists and pit status
        is_abs_enabled = 1 if ac.getCarState(0, acsys.CS.AbsEnabled) else 0
        is_abs_in_action = 1 if ac.getCarState(0, acsys.CS.AbsInAction) else 0
        is_tc_enabled = 1 if ac.getCarState(0, acsys.CS.TractionControlEnabled) else 0
        is_tc_in_action = 1 if ac.getCarState(0, acsys.CS.TractionControlInAction) else 0
        is_in_pit = 1 if ac.isCarInPitline(0) else 0
        is_limiter_on = 0  # Not directly available via API

        # Get acceleration data (G-forces)
        accel_x = ac.getCarState(0, acsys.CS.AccG)[0]  # Lateral
        accel_y = ac.getCarState(0, acsys.CS.AccG)[1]  # Vertical
        accel_z = ac.getCarState(0, acsys.CS.AccG)[2]  # Longitudinal

        # Get normalized track position (0.0 to 1.0)
        norm_pos = ac.getCarState(0, acsys.CS.NormalizedSplinePosition)

        # Get world position
        pos = ac.getCarState(0, acsys.CS.WorldPosition)
        pos_x = pos[0]
        pos_y = pos[1]
        pos_z = pos[2]

        # Get per-wheel data (4 wheels: FL, FR, RL, RR)
        wheel_speeds = [0.0] * 4
        slip_angles = [0.0] * 4
        slip_ratios = [0.0] * 4
        combined_slip = [0.0] * 4
        wheel_loads = [0.0] * 4
        cambers = [0.0] * 4
        tire_radii = [0.0] * 4
        suspension_travel = [0.0] * 4

        for i in range(4):
            wheel_speeds[i] = ac.getCarState(0, acsys.CS.TyreAngularSpeedKMH, i)
            slip_angles[i] = ac.getCarState(0, acsys.CS.TyreSlipAngle, i)
            slip_ratios[i] = ac.getCarState(0, acsys.CS.TyreSlip, i)
            combined_slip[i] = ac.getCarState(0, acsys.CS.TyreCombinedSlip, i)
            wheel_loads[i] = ac.getCarState(0, acsys.CS.Load, i)
            cambers[i] = ac.getCarState(0, acsys.CS.CamberRAD, i)
            tire_radii[i] = ac.getCarState(0, acsys.CS.TyreRadius, i)
            suspension_travel[i] = ac.getCarState(0, acsys.CS.SuspensionTravel, i)

        # Car slope (not directly available, set to 0)
        car_slope = 0.0

        # Build packet according to AC_packetformat.dat
        # Format: u8, s32, f32s, u8s, s32s
        packet = struct.pack(
            '<B i 3f 6B 3f 4i 4f i f 28f 2f 3f 2i',
            # u8 Identifier (ASCII 'a' = 97)
            97,

            # s32 Size (will be packet length)
            0,  # Placeholder, will calculate after packing

            # Speed data (3x f32)
            speed_kmh,
            speed_mph,
            speed_ms,

            # Status flags (6x u8)
            is_abs_enabled,
            is_abs_in_action,
            is_tc_enabled,
            is_tc_in_action,
            is_in_pit,
            is_limiter_on,

            # Acceleration (3x f32)
            accel_y,  # Vertical
            accel_x,  # Horizontal (lateral)
            accel_z,  # Frontal (longitudinal)

            # Lap timing (4x s32)
            int(current_lap_ms),
            int(last_lap_ms),
            int(best_lap_ms),
            int(lap_count),

            # Inputs (4x f32)
            gas,
            brake,
            clutch,
            rpm,

            # Gear (s32)
            gear - 1,  # AC returns 0=R, 1=N, 2=1st, so subtract 1

            # Steering (f32)
            steer,

            # Per-wheel data (28x f32 = 7 arrays * 4 wheels)
            wheel_speeds[0], wheel_speeds[1], wheel_speeds[2], wheel_speeds[3],
            slip_angles[0], slip_angles[1], slip_angles[2], slip_angles[3],
            slip_ratios[0], slip_ratios[1], slip_ratios[2], slip_ratios[3],
            combined_slip[0], combined_slip[1], combined_slip[2], combined_slip[3],
            wheel_loads[0], wheel_loads[1], wheel_loads[2], wheel_loads[3],
            cambers[0], cambers[1], cambers[2], cambers[3],
            tire_radii[0], tire_radii[1], tire_radii[2], tire_radii[3],
            suspension_travel[0], suspension_travel[1], suspension_travel[2], suspension_travel[3],

            # Track position and slope (2x f32)
            norm_pos,
            car_slope,

            # World position (3x f32)
            pos_x,
            pos_y,
            pos_z,

            # Car and Track IDs (2x s32)
            car_id,
            track_id
        )

        # Update size field
        packet_size = len(packet)
        packet = struct.pack('<B', 97) + struct.pack('<i', packet_size) + packet[5:]

        # Send UDP packet to all configured ports
        for port in UDP_PORTS:
            sock.sendto(packet, (UDP_IP, port))
        ac.log("SimDash UDP sent {} bytes to ports {}".format(len(packet), UDP_PORTS))

    except Exception as e:
        ac.console("SimDash UDP Error in send_telemetry: {}".format(str(e)))
