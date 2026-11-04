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
import math

if platform.architecture()[0] == "64bit":
    sysdir = os.path.dirname(__file__) + '/stdlib64'
else:
    sysdir = os.path.dirname(__file__) + '/stdlib'

sys.path.insert(0, sysdir)
os.environ['PATH'] = os.environ['PATH'] + ";."

import ctypes
from ctypes import wintypes
import threading

sys.path.insert(0, os.path.dirname(__file__))
import cones

# ── Config file ──────────────────────────────────────────────────────────────

CONFIG_PATH = os.path.join(os.path.dirname(__file__), 'config.ini')

def load_config():
    cfg = {'ip': '127.0.0.1', 'port': 20778, 'update_rate_hz': 40, 'show_cones': 0, 'heading_sign': 0}
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
                    elif key in ('update_rate_hz', 'show_cones', 'heading_sign'):
                        cfg[key] = int(val)
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
            f.write('\n[Cones]\n')
            f.write('show_cones = {}\n'.format(1 if show_cones else 0))
            f.write('heading_sign = {}\n'.format(heading.sign))
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
send_timer = 0.0  # seconds since the last packet
destinations = []
peak_rpm = 1000.0  # grows to observed max over time
id_cache = {}  # name -> stable id

# Config values (loaded on start, reloaded on save)
UDP_IP = '127.0.0.1'
UDP_PORT = 20778
UPDATE_RATE_HZ = 40

# UI controls
app_id = None
lbl_status = None
input_ip = None
input_port = None
lbl_cone_status = None

# Cone counter
counter = cones.ConeCounter()
heading = cones.HeadingEstimator()
show_cones = False
cone_app = None
lbl_cone_count = None
lbl_cone_last = None
cone_scan = {'message': 'Cones: waiting for track', 'result': None}
cone_flash = 0.0      # seconds the count stays red after a hit
run_clock = cones.RunClock()
tick_count = 0        # count when the lap timer last moved
tyre_data_logged = False

def inet_addr(ip):
    parts = [int(x) for x in ip.split('.')]
    return parts[0] | (parts[1] << 8) | (parts[2] << 16) | (parts[3] << 24)

def htons(port):
    return ((port & 0xFF) << 8) | ((port >> 8) & 0xFF)

def apply_config(ip, port, rate):
    global UDP_IP, UDP_PORT, UPDATE_RATE_HZ, destinations
    UDP_IP = ip
    UDP_PORT = port
    UPDATE_RATE_HZ = max(1, rate)

    addr = SOCKADDR_IN()
    addr.sin_family = AF_INET
    addr.sin_port = htons(port)
    addr.sin_addr = inet_addr(ip)
    destinations = [addr]


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


def on_show_cones(name, state):
    global show_cones
    show_cones = bool(state)
    if cone_app is not None:
        ac.setVisible(cone_app, 1 if show_cones else 0)
    save_config(UDP_IP, UDP_PORT, UPDATE_RATE_HZ)


def scan_cones(track, layout, car):
    """Background thread: loads the cone list and the car size. No AC calls here."""
    def progress(text):
        cone_scan['message'] = 'Cones: ' + text

    # Short GIL turns while scanning, so the game thread does not wait for the scan
    switch = sys.getswitchinterval()
    sys.setswitchinterval(0.001)
    try:
        found, message, errors = cones.load_track_cones(track, layout, progress)
        car_shape = cones.load_car(car)
        cone_scan['result'] = (found, car_shape, errors)
        cone_scan['message'] = 'Cones: ' + message
    except Exception as e:
        cone_scan['result'] = ([], cones.CarShape(), [str(e)])
        cone_scan['message'] = 'Cones: scan failed'
    finally:
        sys.setswitchinterval(switch)


def read_tyres(x, z):
    """Tyre ground contact points from the game: ([(x, y, z, heading, radius)] for FL, FR, RL, RR,
    car heading), or (None, None) when the game does not give them."""
    global tyre_data_logged
    try:
        radius = ac.getCarState(0, acsys.CS.TyreRadius)
        points = [ac.getCarState(0, acsys.CS.TyreContactPoint, w) for w in range(4)]
        points = [(float(p[0]), float(p[1]), float(p[2])) for p in points]
    except Exception:
        points = None
    if points is None or any(math.hypot(p[0] - x, p[2] - z) > 4.0 for p in points):
        if not tyre_data_logged:
            tyre_data_logged = True
            ac.log("SimDash UDP: no tyre contact points, cone hits use the car body only")
        return None, None

    # Car forward direction: from the middle of the rear axle to the middle of the front axle
    fx = (points[0][0] + points[1][0] - points[2][0] - points[3][0]) / 2
    fz = (points[0][2] + points[1][2] - points[2][2] - points[3][2]) / 2
    if math.hypot(fx, fz) < 1.0:
        return None, None
    car_heading = math.atan2(fx, fz)

    tyres = []
    for w in range(4):
        tyre_heading = car_heading
        try:
            v = ac.getCarState(0, acsys.CS.TyreHeadingVector, w)
            h = math.atan2(float(v[0]), float(v[2]))
            if abs(cones._wrap(h - car_heading)) < 1.2:   # steered wheel, not a reversed vector
                tyre_heading = h
        except Exception:
            pass
        tyres.append(points[w] + (tyre_heading, float(radius[w])))
    return tyres, car_heading


def build_cone_window():
    global cone_app, lbl_cone_count, lbl_cone_last
    cone_app = ac.newApp("SimDash Cones")
    ac.setTitle(cone_app, "")
    ac.setSize(cone_app, 150, 100)
    ac.drawBorder(cone_app, 0)
    ac.setIconPosition(cone_app, 0, -10000)
    ac.setBackgroundOpacity(cone_app, 0.4)

    lbl_title = ac.addLabel(cone_app, "CONES")
    ac.setPosition(lbl_title, 0, 4)
    ac.setSize(lbl_title, 150, 18)
    ac.setFontAlignment(lbl_title, "center")
    ac.setFontSize(lbl_title, 14)

    lbl_cone_count = ac.addLabel(cone_app, "0")
    ac.setPosition(lbl_cone_count, 0, 20)
    ac.setSize(lbl_cone_count, 150, 50)
    ac.setFontAlignment(lbl_cone_count, "center")
    ac.setFontSize(lbl_cone_count, 44)

    lbl_cone_last = ac.addLabel(cone_app, "")
    ac.setPosition(lbl_cone_last, 0, 76)
    ac.setSize(lbl_cone_last, 150, 18)
    ac.setFontAlignment(lbl_cone_last, "center")
    ac.setFontSize(lbl_cone_last, 13)

    ac.setVisible(cone_app, 1 if show_cones else 0)


def update_cones(deltaT):
    """Counts cone hits each frame and shows the count."""
    global cone_flash, tick_count

    result = cone_scan['result']
    if result is not None:
        cone_scan['result'] = None
        counter.set_cones(result[0])
        counter.set_car(result[1])
        for error in result[2]:
            ac.log("SimDash UDP: cone scan: {}".format(error))
        ac.log("SimDash UDP: {}".format(cone_scan['message']))
    if lbl_cone_status is not None:
        ac.setText(lbl_cone_status, cone_scan['message'])

    # The count stops at the finish and stays until FINISH_HOLD or the next start
    in_run = run_clock.running or run_clock.finished
    event = run_clock.update(ac.getCarState(0, acsys.CS.LapTime),
                             ac.getCarState(0, acsys.CS.LapCount), deltaT)
    if event == 'finish' and run_clock.still_finish:
        # The timer stopped when it last moved: remove the hits after that
        counter.trim(tick_count)
    if event == 'clear' or (event == 'start' and in_run):
        counter.last_count = counter.count
    if event in ('start', 'clear'):
        counter.reset()
    if not run_clock.counting():
        counter.prev = None

    pos = ac.getCarState(0, acsys.CS.WorldPosition)
    x, y, z = float(pos[0]), float(pos[1]), float(pos[2])
    tyres, car_heading = read_tyres(x, z)
    if car_heading is None:
        # No tyre data from the game: heading from the direction of travel and the slip angle
        loc_vel = ac.getCarState(0, acsys.CS.LocalVelocity)
        ang_vel = ac.getCarState(0, acsys.CS.LocalAngularVelocity)
        slip = 0.0
        if math.hypot(loc_vel[0], loc_vel[2]) > 1.0:
            slip = math.atan2(float(loc_vel[0]), float(loc_vel[2]))
        sign = heading.sign
        car_heading = heading.update(x, z, slip, float(ang_vel[1]), deltaT)
        if heading.sign != sign:
            save_config(UDP_IP, UDP_PORT, UPDATE_RATE_HZ)
    if run_clock.counting() and counter.update(x, y, z, car_heading, tyres):
        cone_flash = 1.0
    if run_clock.moved:
        tick_count = counter.count

    if cone_app is not None and show_cones:
        cone_flash = max(0.0, cone_flash - deltaT)
        ac.setBackgroundOpacity(cone_app, 0.4)
        ac.setText(lbl_cone_count, str(counter.count))
        if cone_flash > 0:
            ac.setFontColor(lbl_cone_count, 1.0, 0.25, 0.2, 1.0)
        else:
            ac.setFontColor(lbl_cone_count, 1.0, 1.0, 1.0, 1.0)
        last = counter.last_count
        ac.setText(lbl_cone_last, "" if last is None else "last run {}".format(last))


def stable_id(name):
    """Same id for the same name in every session (FNV-1a, 31 bits)."""
    if name not in id_cache:
        h = 0x811C9DC5
        for b in name.encode('utf-8'):
            h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
        id_cache[name] = h & 0x7FFFFFFF
    return id_cache[name]


def acMain(ac_version):
    global sock, app_id, lbl_status, input_ip, input_port, lbl_cone_status, show_cones

    # Load config
    cfg = load_config()
    apply_config(cfg['ip'], cfg['port'], cfg['update_rate_hz'])
    show_cones = bool(cfg['show_cones'])
    heading.sign = cfg['heading_sign'] if cfg['heading_sign'] in (1, -1) else 0

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
    ac.setSize(app_id, 300, 220)

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

    chk_cones = ac.addCheckBox(app_id, "Show cone count")
    ac.setPosition(chk_cones, 10, 165)
    ac.setSize(chk_cones, 14, 14)
    ac.setValue(chk_cones, 1 if show_cones else 0)
    ac.addOnCheckBoxChanged(chk_cones, on_show_cones)

    lbl_cone_status = ac.addLabel(app_id, cone_scan['message'])
    ac.setPosition(lbl_cone_status, 10, 190)

    build_cone_window()

    # Find the cones of this track layout without stalling the game
    thread = threading.Thread(target=scan_cones,
                              args=(ac.getTrackName(0), ac.getTrackConfiguration(0), ac.getCarName(0)))
    thread.daemon = True
    thread.start()

    return "SimDash UDP"

def acUpdate(deltaT):
    # Send at UPDATE_RATE_HZ by elapsed time, whatever the frame rate is
    global send_timer
    try:
        update_cones(deltaT)
    except Exception as e:
        ac.log("SimDash UDP Error in update_cones: {}".format(str(e)))

    interval = 1.0 / UPDATE_RATE_HZ
    send_timer += deltaT
    if send_timer >= interval:
        # Keep the remainder for an even rate, but do not catch up after a long frame
        send_timer = min(send_timer - interval, interval)
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
        car_id     = stable_id(ac.getCarName(0))
        track_id   = stable_id(ac.getTrackName(0) + '/' + ac.getTrackConfiguration(0))

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

        # Yaw rate (deg/s) and body slip angle (deg): rotation of the car, and the angle between
        # where it points and where it travels. Body slip is 0 below walking pace and in reverse.
        yaw_rate = 0.0
        body_slip = 0.0
        try:
            ang_vel = ac.getCarState(0, acsys.CS.LocalAngularVelocity)
            yaw_rate = math.degrees(float(ang_vel[1]))
            loc_vel = ac.getCarState(0, acsys.CS.LocalVelocity)
            if loc_vel[2] > 0 and math.hypot(loc_vel[0], loc_vel[2]) > 2.0:
                body_slip = math.degrees(math.atan2(float(loc_vel[0]), float(loc_vel[2])))
        except Exception:
            pass

        if rpm > peak_rpm:
            peak_rpm = float(rpm)

        packet = struct.pack(
            '<B i 3f B 3f 4i 5f i f 28f 2f 3f 2i i 2f i',
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
            1,  # IsRaceOn: always 1 while plugin is sending
            yaw_rate, body_slip,
            counter.count
        )

        # Fix size field
        packet = struct.pack('<B', 97) + struct.pack('<i', len(packet)) + packet[5:]

        buf = ctypes.create_string_buffer(packet)
        for addr in destinations:
            ws2.sendto(sock, buf, len(packet), 0, ctypes.byref(addr), ctypes.sizeof(addr))

    except Exception as e:
        ac.log("SimDash UDP Error in send_telemetry: {}".format(str(e)))
