"""
SimDash UDP Telemetry Plugin for Assetto Corsa
Broadcasts telemetry data via UDP using ctypes (no _socket.pyd needed)
"""

import ac
import acsys
import sys
import os
import platform
import struct

if platform.architecture()[0] == "64bit":
    sysdir = os.path.dirname(__file__) + '/stdlib64'
else:
    sysdir = os.path.dirname(__file__) + '/stdlib'

sys.path.insert(0, sysdir)
os.environ['PATH'] = os.environ['PATH'] + ";."

import ctypes
from ctypes import wintypes

# ── Config file ──────────────────────────────────────────────────────────────

CONFIG_PATH = os.path.join(os.path.dirname(__file__), 'config.ini')

def load_config():
    cfg = {'ip': '127.0.0.1', 'port': 20778, 'update_rate_hz': 40}
    try:
        with open(CONFIG_PATH, 'r') as f:
            for line in f:
                line = line.strip()
                if '=' in line and not line.startswith('#') and not line.startswith('['):
                    key, _, val = line.partition('=')
                    key = key.strip().lower()
                    val = val.strip()
                    if key == 'ip':
                        cfg['ip'] = val
                    elif key == 'port':
                        cfg['port'] = int(val)
                    elif key == 'update_rate_hz':
                        cfg['update_rate_hz'] = int(val)
    except Exception as e:
        ac.log("SimDash UDP: Could not read config.ini: {}".format(e))
    return cfg

def save_config(ip, port, rate):
    try:
        with open(CONFIG_PATH, 'w') as f:
            f.write('[Network]\n')
            f.write('ip = {}\n'.format(ip))
            f.write('port = {}\n'.format(port))
            f.write('update_rate_hz = {}\n'.format(rate))
    except Exception as e:
        ac.log("SimDash UDP: Could not write config.ini: {}".format(e))

# ── Windows socket constants ──────────────────────────────────────────────────

AF_INET = 2
SOCK_DGRAM = 2
IPPROTO_UDP = 17
INVALID_SOCKET = ctypes.c_uint(-1).value

ws2 = ctypes.windll.ws2_32

class WSADATA(ctypes.Structure):
    _fields_ = [("wVersion", wintypes.WORD),
                ("wHighVersion", wintypes.WORD),
                ("szDescription", ctypes.c_char * 257),
                ("szSystemStatus", ctypes.c_char * 129),
                ("iMaxSockets", ctypes.c_ushort),
                ("iMaxUdpDg", ctypes.c_ushort),
                ("lpVendorInfo", ctypes.c_char_p)]

class SOCKADDR_IN(ctypes.Structure):
    _fields_ = [("sin_family", ctypes.c_short),
                ("sin_port", ctypes.c_ushort),
                ("sin_addr", ctypes.c_uint),
                ("sin_zero", ctypes.c_char * 8)]

SOCKET = ctypes.c_uint64 if platform.architecture()[0] == "64bit" else ctypes.c_uint32
ws2.socket.restype = SOCKET
ws2.socket.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_int]
ws2.sendto.restype = ctypes.c_int
ws2.sendto.argtypes = [SOCKET, ctypes.c_void_p, ctypes.c_int, ctypes.c_int,
                       ctypes.POINTER(SOCKADDR_IN), ctypes.c_int]
ws2.closesocket.argtypes = [SOCKET]

# ── Global state ──────────────────────────────────────────────────────────────

sock = INVALID_SOCKET
frame_counter = 0
frames_per_update = 0
destinations = []
peak_rpm = 1000.0  # grows to observed max over time

# Config values (loaded on start, reloaded on save)
UDP_IP = '127.0.0.1'
UDP_PORT = 20778
UPDATE_RATE_HZ = 40

# UI controls
app_id = None
lbl_status = None
input_ip = None
input_port = None

def inet_addr(ip):
    parts = [int(x) for x in ip.split('.')]
    return parts[0] | (parts[1] << 8) | (parts[2] << 16) | (parts[3] << 24)

def htons(port):
    return ((port & 0xFF) << 8) | ((port >> 8) & 0xFF)

def apply_config(ip, port, rate):
    global UDP_IP, UDP_PORT, UPDATE_RATE_HZ, destinations, frames_per_update
    UDP_IP = ip
    UDP_PORT = port
    UPDATE_RATE_HZ = rate

    addr = SOCKADDR_IN()
    addr.sin_family = AF_INET
    addr.sin_port = htons(port)
    addr.sin_addr = inet_addr(ip)
    destinations = [addr]

    frames_per_update = max(1, int(60.0 / rate))

def on_save_clicked(dummy_x, dummy_y):
    global lbl_status
    try:
        new_ip = ac.getText(input_ip).strip()
        new_port = int(ac.getText(input_port).strip())
        apply_config(new_ip, new_port, UPDATE_RATE_HZ)
        save_config(new_ip, new_port, UPDATE_RATE_HZ)
        ac.setText(lbl_status, "Saved! Sending to {}:{}".format(new_ip, new_port))
        ac.log("SimDash UDP: Config saved - {}:{}".format(new_ip, new_port))
    except Exception as e:
        ac.setText(lbl_status, "Error: {}".format(str(e)))

def acMain(ac_version):
    global sock, app_id, lbl_status, input_ip, input_port

    # Load config
    cfg = load_config()
    apply_config(cfg['ip'], cfg['port'], cfg['update_rate_hz'])

    # Init Winsock
    try:
        wsadata = WSADATA()
        ret = ws2.WSAStartup(0x0202, ctypes.byref(wsadata))
        if ret != 0:
            ac.log("SimDash UDP: WSAStartup failed: {}".format(ret))
            return "SimDash UDP"

        sock = ws2.socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
        if sock == INVALID_SOCKET:
            ac.log("SimDash UDP: socket() failed")
            return "SimDash UDP"

        ac.log("SimDash UDP Plugin Loaded - sending to {}:{} @ {}Hz".format(
            UDP_IP, UDP_PORT, UPDATE_RATE_HZ))

    except Exception as e:
        ac.log("SimDash UDP Error in acMain: {}".format(str(e)))
        return "SimDash UDP"

    # Build settings app window
    app_id = ac.newApp("SimDash UDP")
    ac.setTitle(app_id, "SimDash UDP")
    ac.setSize(app_id, 300, 160)

    lbl_ip = ac.addLabel(app_id, "IP Address:")
    ac.setPosition(lbl_ip, 10, 30)

    input_ip = ac.addTextInput(app_id, "ip")
    ac.setPosition(input_ip, 110, 26)
    ac.setSize(input_ip, 170, 24)
    ac.setText(input_ip, UDP_IP)

    lbl_port = ac.addLabel(app_id, "Port:")
    ac.setPosition(lbl_port, 10, 65)

    input_port = ac.addTextInput(app_id, "port")
    ac.setPosition(input_port, 110, 61)
    ac.setSize(input_port, 100, 24)
    ac.setText(input_port, str(UDP_PORT))

    btn_save = ac.addButton(app_id, "Save")
    ac.setPosition(btn_save, 10, 100)
    ac.setSize(btn_save, 80, 28)
    ac.addOnClickedListener(btn_save, on_save_clicked)

    lbl_status = ac.addLabel(app_id, "Sending to {}:{}".format(UDP_IP, UDP_PORT))
    ac.setPosition(lbl_status, 10, 135)

    return "SimDash UDP"

def acUpdate(deltaT):
    global frame_counter
    frame_counter += 1
    if frame_counter >= frames_per_update:
        frame_counter = 0
        send_telemetry()

def acShutdown():
    global sock
    if sock != INVALID_SOCKET:
        ws2.closesocket(sock)
        ws2.WSACleanup()

def send_telemetry():
    global sock, destinations, peak_rpm

    if sock == INVALID_SOCKET or not destinations:
        return

    try:
        speed_kmh = ac.getCarState(0, acsys.CS.SpeedKMH)
        speed_mph = speed_kmh * 0.621371
        speed_ms  = speed_kmh / 3.6

        gas    = ac.getCarState(0, acsys.CS.Gas)
        brake  = ac.getCarState(0, acsys.CS.Brake)
        clutch = ac.getCarState(0, acsys.CS.Clutch)
        steer  = ac.getCarState(0, acsys.CS.Steer)
        rpm    = ac.getCarState(0, acsys.CS.RPM)
        gear   = ac.getCarState(0, acsys.CS.Gear)

        current_lap_ms = ac.getCarState(0, acsys.CS.LapTime)
        last_lap_ms    = ac.getCarState(0, acsys.CS.LastLap)
        best_lap_ms    = ac.getCarState(0, acsys.CS.BestLap)
        lap_count      = ac.getCarState(0, acsys.CS.LapCount)

        is_in_pit  = 1 if ac.isCarInPitline(0) else 0
        car_id     = hash(ac.getCarName(0)) & 0x7FFFFFFF
        track_id   = hash(ac.getTrackName(0)) & 0x7FFFFFFF

        accg    = ac.getCarState(0, acsys.CS.AccG)
        accel_x = accg[0]
        accel_y = accg[1]
        accel_z = accg[2]

        norm_pos = ac.getCarState(0, acsys.CS.NormalizedSplinePosition)
        pos      = ac.getCarState(0, acsys.CS.WorldPosition)

        wheel_speeds      = [0.0] * 4
        slip_angles       = [0.0] * 4
        slip_ratios       = [0.0] * 4
        wheel_loads       = [0.0] * 4
        cambers           = [0.0] * 4
        tire_radii        = [0.0] * 4
        suspension_travel = [0.0] * 4

        raw_ws  = ac.getCarState(0, acsys.CS.WheelAngularSpeed)
        raw_sa  = ac.getCarState(0, acsys.CS.SlipAngle)
        raw_sr  = ac.getCarState(0, acsys.CS.SlipRatio)
        raw_ld  = ac.getCarState(0, acsys.CS.Load)
        raw_cam = ac.getCarState(0, acsys.CS.CamberRad)
        raw_rad = ac.getCarState(0, acsys.CS.TyreRadius)
        raw_sus = ac.getCarState(0, acsys.CS.SuspensionTravel)
        for i in range(4):
            wheel_speeds[i]      = float(raw_ws[i])
            slip_angles[i]       = float(raw_sa[i])
            slip_ratios[i]       = float(raw_sr[i])
            wheel_loads[i]       = float(raw_ld[i])
            cambers[i]           = float(raw_cam[i])
            tire_radii[i]        = float(raw_rad[i])
            suspension_travel[i] = float(raw_sus[i])

        if rpm > peak_rpm:
            peak_rpm = float(rpm)

        packet = struct.pack(
            '<B i 3f B 3f 4i 5f i f 28f 2f 3f 2i i',
            97, 0,
            float(speed_kmh), float(speed_mph), float(speed_ms),
            is_in_pit,
            float(accel_y), float(accel_x), float(accel_z),
            int(current_lap_ms), int(last_lap_ms), int(best_lap_ms), int(lap_count),
            float(gas), float(brake), float(clutch), float(rpm), peak_rpm,
            int(gear) - 1,
            float(steer),
            wheel_speeds[0], wheel_speeds[1], wheel_speeds[2], wheel_speeds[3],
            slip_angles[0], slip_angles[1], slip_angles[2], slip_angles[3],
            slip_ratios[0], slip_ratios[1], slip_ratios[2], slip_ratios[3],
            wheel_loads[0], wheel_loads[1], wheel_loads[2], wheel_loads[3],
            cambers[0], cambers[1], cambers[2], cambers[3],
            tire_radii[0], tire_radii[1], tire_radii[2], tire_radii[3],
            suspension_travel[0], suspension_travel[1], suspension_travel[2], suspension_travel[3],
            float(norm_pos), 0.0,
            float(pos[0]), float(pos[1]), float(pos[2]),
            car_id, track_id,
            1  # IsRaceOn: always 1 while plugin is sending
        )

        # Fix size field
        packet = struct.pack('<B', 97) + struct.pack('<i', len(packet)) + packet[5:]

        buf = ctypes.create_string_buffer(packet)
        for addr in destinations:
            ws2.sendto(sock, buf, len(packet), 0, ctypes.byref(addr), ctypes.sizeof(addr))

    except Exception as e:
        ac.log("SimDash UDP Error in send_telemetry: {}".format(str(e)))
