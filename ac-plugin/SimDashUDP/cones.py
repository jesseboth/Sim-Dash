"""Cone detection for SimDash UDP.

Finds the cones in the track models by their shape (not their names), keeps a cone
list per track layout, and counts the cones that the car hits: a tyre at ground level
against the cone base, or the car body at its height against the cone width there.
No AC calls are made here, so the scan can run in a background thread.
"""

import math
import os
import struct
from array import array

APP_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(APP_DIR, 'cones')
CACHE_VERSION = 4

# Cone sizes in metres
BASE_MIN = 0.18
BASE_MAX = 0.60
HEIGHT_MIN = 0.28
HEIGHT_MAX = 1.05
PIECE_MAX = 1.2              # larger pieces are never part of a cone
MAX_MESH_VERTICES = 300000   # larger meshes are terrain or buildings
SAME_CONE = 0.2              # cones closer than this are copies (LODs, colliders)
MAX_OUTLINE_POINTS = 24
PROFILE_STEP = 0.025         # height step of the cone width profile
PROFILE_TOP = 0.6

# Hit test, in metres
HIT_DEPTH = 0.02             # the car must go this far into the cone to count a hit
TYRE_HEIGHT = 0.03           # tyre outline height: the top of a cone base
SWEEP_STEP = 0.02            # largest car movement between two hit tests
FINISH_STILL = 1.0           # seconds the lap timer stays still at the finish
FINISH_HOLD = 20.0           # seconds the count stays after the finish

# Car used when the car files cannot be read: 4.4 m x 1.8 m, body 15 cm above the ground
DEFAULT_OUTLINE = [(-0.9, -2.2), (0.9, -2.2), (0.9, 2.2), (-0.9, 2.2)]
DEFAULT_BODY_HEIGHT = 0.15
DEFAULT_TYRE_WIDTH = 0.245


# ── kn5 reader ────────────────────────────────────────────────────────────────

class Kn5Error(Exception):
    pass


class _Reader(object):
    def __init__(self, f):
        self.f = f

    def read(self, n):
        data = self.f.read(n)
        if len(data) != n:
            raise Kn5Error('unexpected end of file')
        return data

    def skip(self, n):
        self.f.seek(n, 1)

    def int32(self):
        return struct.unpack('<i', self.read(4))[0]

    def count(self, limit=50000000):
        n = self.int32()
        if n < 0 or n > limit:
            raise Kn5Error('bad count {}'.format(n))
        return n

    def string(self):
        return self.read(self.count(4096)).decode('utf-8', 'replace')

    def floats(self, n):
        return struct.unpack('<{}f'.format(n), self.read(4 * n))


def _mat_mul(a, b):
    """Row-major 4x4 product a x b (AC uses row vectors: world = local x parent)."""
    return tuple(sum(a[r * 4 + k] * b[k * 4 + c] for k in range(4))
                 for r in range(4) for c in range(4))


def _translation(x, y, z):
    return (1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1)


def read_kn5(path, on_mesh, offset=(0.0, 0.0, 0.0)):
    """Calls on_mesh(matrix, vertices, indices) for each static mesh in a kn5 file.

    vertices is an array of 11 floats per vertex (position, normal, uv, tangent),
    in the space of matrix. Very large meshes are skipped.
    """
    with open(path, 'rb') as f:
        r = _Reader(f)
        if r.read(6) != b'sc6969':
            raise Kn5Error('not a kn5 file (or encrypted)')
        version = r.int32()
        if version > 5:
            r.int32()
        for _ in range(r.count()):          # textures
            r.int32()
            r.string()
            r.skip(r.count(1 << 30))
        for _ in range(r.count()):          # materials
            r.string()
            r.string()
            r.skip(2)                       # blend mode, alpha tested
            if version > 4:
                r.skip(4)                   # depth mode
            for _ in range(r.count()):      # properties
                r.string()
                r.skip(40)
            for _ in range(r.count()):      # texture mappings
                r.string()
                r.skip(4)
                r.string()
        _read_node(r, _translation(*offset), on_mesh)


def _read_node(r, parent, on_mesh):
    node_class = r.int32()
    r.string()
    children = r.count(100000)
    r.skip(1)                               # active
    matrix = parent
    if node_class == 1:
        matrix = _mat_mul(r.floats(16), parent)
    elif node_class == 2:
        r.skip(3)                           # cast shadows, visible, transparent
        nv = r.count()
        if nv > MAX_MESH_VERTICES:
            r.skip(nv * 44)
            r.skip(r.count() * 2)
        else:
            vertices = array('f')
            vertices.frombytes(r.read(nv * 44))
            indices = array('H')
            indices.frombytes(r.read(r.count() * 2))
            on_mesh(parent, vertices, indices)
        r.skip(33)                          # material, layer, LOD, bounding sphere, renderable
    elif node_class == 3:
        r.skip(3)
        for _ in range(r.count(10000)):     # bones
            r.string()
            r.skip(64)
        r.skip(r.count() * 76)
        r.skip(r.count() * 2)
        r.skip(16)
    else:
        raise Kn5Error('unknown node class {}'.format(node_class))
    for _ in range(children):
        _read_node(r, matrix, on_mesh)


# ── Cone shape test ───────────────────────────────────────────────────────────

def _components(n, indices):
    """Groups vertex numbers into pieces of connected triangles."""
    parent = list(range(n))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for t in range(0, len(indices) - 2, 3):
        a = find(indices[t])
        b = find(indices[t + 1])
        if a != b:
            parent[b] = a
        c = find(indices[t + 2])
        if a != c:
            parent[c] = a
    groups = {}
    for v in range(n):
        groups.setdefault(find(v), []).append(v)
    return list(groups.values())


def _extent(values):
    return max(values) - min(values)


def _band_radius(points, lo, hi):
    """Largest distance from the axis of the points whose height is in [lo, hi]."""
    radii = [r for h, r in points if lo <= h <= hi]
    return max(radii) if radii else None


def _tapers(points, length):
    """True when the object narrows from one end of its axis to the other.

    points are (position along the axis from 0, distance from the axis).
    Returns +1 when it narrows towards the high end, -1 towards the low end, 0 when not a cone.
    """
    low = _band_radius(points, 0.0, 0.3 * length)
    high = _band_radius(points, 0.75 * length, length)
    if low is None or high is None:
        return 0
    if high < 0.65 * low:
        side = 1
    elif low < 0.65 * high:
        side = -1
    else:
        return 0

    # Round across the axis: in the middle of the cone, distance from the axis follows a straight line
    mid = [(h, r) for h, r in points if 0.35 * length <= h <= 0.7 * length]
    if len(mid) >= 6:
        mh = sum(h for h, _ in mid) / len(mid)
        mr = sum(r for _, r in mid) / len(mid)
        shh = sum((h - mh) ** 2 for h, _ in mid)
        slope = sum((h - mh) * (r - mr) for h, r in mid) / shh if shh > 1e-9 else 0.0
        resid = math.sqrt(sum((r - mr - slope * (h - mh)) ** 2 for h, r in mid) / len(mid))
        if mr <= 0 or resid > 0.15 * mr:
            return 0
    return side


def classify(xs, ys, zs, tris):
    """Returns (x, z, radius, kind, outline, profile) for a cone, else None.

    kind is 'cone' or 'pointer'. outline is the convex outline of the cone seen from above
    (the edge of the base), as points relative to (x, z). radius is the largest distance of
    the outline from (x, z). profile is the cone radius every PROFILE_STEP up from the ground
    (None for a pointer cone, which uses its outline at all heights).
    """
    n = len(xs)
    if n < 8:
        return None
    ymin = min(ys)
    h = max(ys) - ymin

    # Main horizontal direction, so a pointer cone on its side is measured along its length
    mx = sum(xs) / n
    mz = sum(zs) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    szz = sum((z - mz) ** 2 for z in zs)
    sxz = sum((x - mx) * (z - mz) for x, z in zip(xs, zs))
    angle = 0.5 * math.atan2(2 * sxz, sxx - szz)
    ux, uz = math.cos(angle), math.sin(angle)
    along = [(x - mx) * ux + (z - mz) * uz for x, z in zip(xs, zs)]
    across = [(z - mz) * ux - (x - mx) * uz for x, z in zip(xs, zs)]
    amin, amax = min(along), max(along)
    bmin, bmax = min(across), max(across)
    la, lb = amax - amin, bmax - bmin

    # Middle of the footprint in world space
    ac, bc = (amin + amax) / 2, (bmin + bmax) / 2
    cx = mx + ac * ux - bc * uz
    cz = mz + ac * uz + bc * ux

    # Standing cone: narrows upwards
    if (BASE_MIN <= la <= BASE_MAX and lb >= 0.7 * la and
            HEIGHT_MIN <= h <= HEIGHT_MAX and h >= 0.9 * la):
        points = [(y - ymin, math.hypot(a - ac, b - bc)) for y, a, b in zip(ys, along, across)]
        if _tapers(points, h) == 1:
            outline, radius = _outline(cx, cz, xs, zs)
            return (cx, cz, radius, 'cone', outline, _profile(cx, cz, xs, ys, zs, tris, ymin))

    # Pointer cone: lies on its side, narrows along its length
    if (HEIGHT_MIN <= la <= HEIGHT_MAX and BASE_MIN <= lb <= BASE_MAX and
            BASE_MIN * 0.8 <= h <= BASE_MAX and la >= lb):
        yc = ymin + h / 2
        points = [(a - amin, math.hypot(b - bc, y - yc)) for y, a, b in zip(ys, along, across)]
        if _tapers(points, la) != 0:
            outline, radius = _outline(cx, cz, xs, zs)
            return (cx, cz, radius, 'pointer', outline, None)
    return None


def _outline(cx, cz, xs, zs):
    outline = _simplify(convex_hull([(x - cx, z - cz) for x, z in zip(xs, zs)]))
    return outline, max(math.hypot(x, z) for x, z in outline)


def _profile(cx, cz, xs, ys, zs, tris, ymin):
    """Cone radius every PROFILE_STEP up from the ground, from the triangle edges."""
    edges = set()
    for t in range(0, len(tris) - 2, 3):
        for a, b in ((tris[t], tris[t + 1]), (tris[t + 1], tris[t + 2]), (tris[t + 2], tris[t])):
            edges.add((a, b) if a < b else (b, a))
    profile = []
    for k in range(int(PROFILE_TOP / PROFILE_STEP) + 1):
        height = ymin + max(k * PROFILE_STEP, 0.002)
        radius = 0.0
        for a, b in edges:
            ya, yb = ys[a] - height, ys[b] - height
            if (ya < 0) == (yb < 0) or ya == yb:
                continue
            f = ya / (ya - yb)
            x = xs[a] + (xs[b] - xs[a]) * f
            z = zs[a] + (zs[b] - zs[a]) * f
            radius = max(radius, math.hypot(x - cx, z - cz))
        profile.append(radius)
    return profile


def convex_hull(points):
    """Convex hull of 2D points, counter-clockwise (monotone chain)."""
    pts = sorted(set(points))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def _simplify(hull):
    """Keeps at most MAX_OUTLINE_POINTS hull points, spread evenly."""
    if len(hull) <= MAX_OUTLINE_POINTS:
        return hull
    step = len(hull) / float(MAX_OUTLINE_POINTS)
    return [hull[int(i * step)] for i in range(MAX_OUTLINE_POINTS)]


def _find_cones(matrix, vertices, indices, found):
    xs = vertices[0::11]
    ys = vertices[1::11]
    zs = vertices[2::11]
    n = len(xs)
    if n < 8 or (len(indices) and max(indices) >= n):
        return
    scale = max(math.sqrt(matrix[r * 4] ** 2 + matrix[r * 4 + 1] ** 2 + matrix[r * 4 + 2] ** 2)
                for r in range(3))
    limit = PIECE_MAX / max(scale, 1e-6)

    if max(_extent(xs), _extent(ys), _extent(zs)) <= limit:
        groups = [list(range(n))]
    else:
        groups = []
        for group in _components(n, indices):
            if len(group) < 3:
                continue
            gx = [xs[v] for v in group]
            gy = [ys[v] for v in group]
            gz = [zs[v] for v in group]
            if max(_extent(gx), _extent(gy), _extent(gz)) <= limit:
                groups.append(group)
    if not groups:
        return

    # Vertex number in its piece, and the triangles of each piece
    where = {}
    for g, group in enumerate(groups):
        for i, v in enumerate(group):
            where[v] = (g, i)
    piece_tris = [[] for _ in groups]
    for t in range(0, len(indices) - 2, 3):
        a = where.get(indices[t])
        b = where.get(indices[t + 1])
        c = where.get(indices[t + 2])
        if a is not None and b is not None and c is not None:
            piece_tris[a[0]].extend((a[1], b[1], c[1]))

    m = matrix
    pieces = []
    for group, tris in zip(groups, piece_tris):
        wx = [xs[v] * m[0] + ys[v] * m[4] + zs[v] * m[8] + m[12] for v in group]
        wy = [xs[v] * m[1] + ys[v] * m[5] + zs[v] * m[9] + m[13] for v in group]
        wz = [xs[v] * m[2] + ys[v] * m[6] + zs[v] * m[10] + m[14] for v in group]
        pieces.append((wx, wy, wz, tris))

    # One cone can be several pieces (body, base, stripes): join pieces that overlap
    for wx, wy, wz, tris in _join_overlapping(pieces):
        cone = classify(wx, wy, wz, tris)
        if cone:
            found.append(cone)


def _join_overlapping(pieces, margin=0.03):
    boxes = [(min(x) - margin, max(x) + margin, min(y) - margin, max(y) + margin,
              min(z) - margin, max(z) + margin) for x, y, z, _ in pieces]
    parent = list(range(len(pieces)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    cells = {}
    for i, b in enumerate(boxes):
        for gx in range(int(math.floor(b[0])), int(math.floor(b[1])) + 1):
            for gz in range(int(math.floor(b[4])), int(math.floor(b[5])) + 1):
                cell = cells.setdefault((gx, gz), [])
                for j in cell:
                    o = boxes[j]
                    if (b[0] <= o[1] and o[0] <= b[1] and b[2] <= o[3] and o[2] <= b[3] and
                            b[4] <= o[5] and o[4] <= b[5]):
                        a, c = find(i), find(j)
                        if a != c:
                            parent[c] = a
                cell.append(i)

    joined = {}
    for i, (x, y, z, tris) in enumerate(pieces):
        tx, ty, tz, tt = joined.setdefault(find(i), ([], [], [], []))
        base = len(tx)
        tx.extend(x)
        ty.extend(y)
        tz.extend(z)
        tt.extend(v + base for v in tris)
    return list(joined.values())


def _dedupe(cones):
    kept = []
    for c in cones:
        if all(math.hypot(c[0] - k[0], c[1] - k[1]) > SAME_CONE for k in kept):
            kept.append(c)
    return kept


# ── Track and car files ───────────────────────────────────────────────────────

def track_folder(track_name):
    """AC folder name of a track. CSP can give a path such as 'csp/3749/../ks_track'."""
    return track_name.replace('\\', '/').rstrip('/').split('/')[-1]


def model_files(track_dir, layout):
    """kn5 files and position offsets that make up a track layout."""
    ini = os.path.join(track_dir, 'models_{}.ini'.format(layout)) if layout else ''
    if not os.path.isfile(ini):
        ini = os.path.join(track_dir, 'models.ini')
    if not os.path.isfile(ini):
        return [(os.path.join(track_dir, os.path.basename(track_dir) + '.kn5'), (0.0, 0.0, 0.0))]

    files = []
    current = None
    with open(ini, 'r', errors='replace') as f:
        for line in f:
            line = line.split(';')[0].strip()
            if line.startswith('['):
                current = None
                if line.upper().startswith('[MODEL'):
                    current = [None, (0.0, 0.0, 0.0)]
                    files.append(current)
            elif current is not None and '=' in line:
                key, _, val = line.partition('=')
                key = key.strip().upper()
                if key == 'FILE':
                    current[0] = os.path.join(track_dir, val.strip())
                elif key == 'POSITION':
                    try:
                        current[1] = tuple(float(v) for v in val.split(','))[:3]
                    except ValueError:
                        pass
    return [(p, pos) for p, pos in files if p]


def _cache_path(track, layout):
    name = '{}__{}'.format(track, layout or 'default')
    name = ''.join(ch if ch.isalnum() or ch in '-_.' else '_' for ch in name)
    return os.path.join(CACHE_DIR, name + '.txt')


def _signature(files):
    parts = []
    for path, _ in files:
        try:
            st = os.stat(path)
            parts.append('{}:{}:{}'.format(os.path.basename(path), st.st_size, int(st.st_mtime)))
        except OSError:
            parts.append(os.path.basename(path) + ':missing')
    return '|'.join(parts)


def load_track_cones(track_name, layout, progress=None):
    """Cone list for a track layout: from the cache, or from a scan of the track models.

    Returns (cones, message, errors). Each cone is (x, z, radius, kind, outline, profile) in
    AC world coordinates (see classify).
    """
    track = track_folder(track_name)
    track_dir = os.path.join('content', 'tracks', track)
    files = model_files(track_dir, layout)
    signature = _signature(files)
    cache = _cache_path(track, layout)

    cones = _read_cache(cache, signature)
    if cones is not None:
        return cones, '{} cones (saved list)'.format(len(cones)), []

    found = []
    errors = []
    for i, (path, offset) in enumerate(files):
        if progress:
            progress('Scanning track {}/{}'.format(i + 1, len(files)))
        try:
            read_kn5(path, lambda m, v, ix: _find_cones(m, v, ix, found), offset)
        except (IOError, OSError, Kn5Error, struct.error, MemoryError) as e:
            errors.append('{}: {}'.format(os.path.basename(path), e))
    cones = _dedupe(found)
    if not errors or cones:
        _write_cache(cache, signature, cones)
    message = '{} cones found'.format(len(cones))
    if errors:
        message += ' ({} files not read)'.format(len(errors))
    return cones, message, errors


def _read_cache(path, signature):
    try:
        with open(path, 'r') as f:
            header = f.readline().rstrip('\n').split(' ', 3)
            if len(header) < 4 or header[2] != str(CACHE_VERSION) or header[3] != signature:
                return None
            cones = []
            for line in f:
                shape, _, profile = line.partition('|')
                p = shape.split()
                if len(p) < 7:
                    continue
                outline = [tuple(float(v) for v in q.split(',')) for q in p[4:]]
                radii = [float(v) for v in profile.split()] if profile.strip() != '-' else None
                cones.append((float(p[0]), float(p[1]), float(p[2]), p[3], outline, radii))
            return cones
    except (IOError, OSError, ValueError):
        return None


def _write_cache(path, signature, cones):
    try:
        if not os.path.isdir(CACHE_DIR):
            os.makedirs(CACHE_DIR)
        with open(path, 'w') as f:
            f.write('# simdash-cones {} {}\n'.format(CACHE_VERSION, signature))
            for x, z, r, kind, outline, profile in cones:
                points = ' '.join('{:.4f},{:.4f}'.format(px, pz) for px, pz in outline)
                radii = ' '.join('{:.4f}'.format(v) for v in profile) if profile else '-'
                f.write('{:.4f} {:.4f} {:.4f} {} {} | {}\n'.format(x, z, r, kind, points, radii))
    except (IOError, OSError):
        pass


class CarShape(object):
    """Car body outline seen from above, body height and tyre widths."""

    def __init__(self, outline=None, bottom=None, tyre_width=None):
        self.outline = outline or DEFAULT_OUTLINE   # (lateral, forward) from the car position
        self.bottom = bottom                        # lowest body point, from the car position (m)
        self.tyre_width = tyre_width or (DEFAULT_TYRE_WIDTH, DEFAULT_TYRE_WIDTH)  # front, rear


def load_car(car_name):
    """Car shape from the collider model and the tyre data of the car, where they can be read."""
    car_dir = os.path.join('content', 'cars', car_name)
    points = []
    low = [float('inf')]

    def on_mesh(m, vertices, indices):
        xs = vertices[0::11]
        ys = vertices[1::11]
        zs = vertices[2::11]
        for x, y, z in zip(xs, ys, zs):
            points.append((round(x * m[0] + y * m[4] + z * m[8] + m[12], 4),
                           round(x * m[2] + y * m[6] + z * m[10] + m[14], 4)))
            low[0] = min(low[0], x * m[1] + y * m[5] + z * m[9] + m[13])

    shape = CarShape(tyre_width=_tyre_widths(os.path.join(car_dir, 'data', 'tyres.ini')))
    try:
        read_kn5(os.path.join(car_dir, 'collider.kn5'), on_mesh)
    except (IOError, OSError, Kn5Error, struct.error):
        return shape
    hull = convex_hull(points)
    if len(hull) >= 3:
        width = _extent([p[0] for p in hull])
        length = _extent([p[1] for p in hull])
        if 1.0 < width < 3.0 and 2.0 < length < 7.0:
            shape.outline = _simplify(hull)
            shape.bottom = low[0]
    return shape


def _tyre_widths(path):
    """(front, rear) tyre width of the first compound in tyres.ini, if the file is there."""
    widths = {}
    section = None
    try:
        with open(path, 'r', errors='replace') as f:
            for line in f:
                line = line.split(';')[0].strip()
                if line.startswith('['):
                    section = line.strip('[]').upper()
                elif section in ('FRONT', 'REAR') and section not in widths and '=' in line:
                    key, _, val = line.partition('=')
                    if key.strip().upper() == 'WIDTH':
                        widths[section] = float(val)
    except (IOError, OSError, ValueError):
        return None
    if 'FRONT' in widths and 'REAR' in widths:
        return (widths['FRONT'], widths['REAR'])
    return None


# ── Hit counter ───────────────────────────────────────────────────────────────

class RunClock(object):
    """Finds the start and the finish of a run from the game lap timer.

    update() gives 'start', 'finish', 'resume', 'clear' or None:
    - 'start': the timer starts from 0 or starts again from a lower time.
    - 'finish': the timer goes back to 0, a lap ends, or the timer stays still for
      FINISH_STILL seconds (then `still_finish` is True).
    - 'resume': a timer that stayed still runs again from the same time (game pause).
    - 'clear': FINISH_HOLD seconds after the finish.
    """

    def __init__(self):
        self.started = False
        self.running = False
        self.finished = False
        self.still_finish = False
        self.moved = False
        self.prev_ms = 0
        self.prev_laps = None
        self.still = 0.0
        self.held = 0.0

    def counting(self):
        """True in a run, and always when the timer did not start yet."""
        return self.running or not self.started

    def update(self, lap_ms, laps, dt):
        prev_ms, prev_laps = self.prev_ms, self.prev_laps
        self.prev_ms, self.prev_laps = lap_ms, laps
        self.moved = lap_ms != prev_ms

        if lap_ms > 0 and (prev_ms == 0 or lap_ms < prev_ms):
            self.started, self.running, self.finished, self.still = True, True, False, 0.0
            return 'start'
        if self.finished and self.still_finish and lap_ms > prev_ms:
            self.running, self.finished, self.still = True, False, 0.0
            return 'resume'
        if self.running:
            new_lap = prev_laps is not None and laps != prev_laps
            if new_lap or (lap_ms == 0 and prev_ms > 0):
                return self._finish(False)
            self.still = self.still + dt if not self.moved else 0.0
            if self.still >= FINISH_STILL:
                return self._finish(True)
        elif self.finished:
            self.held += dt
            if self.held >= FINISH_HOLD:
                self.finished = False
                return 'clear'
        return None

    def _finish(self, still):
        self.running, self.finished, self.still_finish = False, True, still
        self.held = 0.0
        return 'finish'


class HeadingEstimator(object):
    """Car heading from the direction of travel and the body slip angle.

    The sign of the slip angle in AC world coordinates is learned while driving: the
    correct heading turns at the same rate as the measured yaw rate.
    """

    LEARN_SAMPLES = 300

    def __init__(self, sign=0):
        self.sign = sign            # +1 or -1 when known, 0 while learning
        self.heading = None
        self.err = [0.0, 0.0]
        self.samples = 0
        self.prev = None            # (x, z, slip, heading candidates)
        self.elapsed = 0.0          # time since prev

    def update(self, x, z, slip, yaw_rate, dt):
        """slip: atan2 of local lateral and forward speed (rad). yaw_rate in rad/s."""
        self.elapsed += dt
        if self.prev is None:
            self.prev = (x, z, slip, None)
            self.elapsed = 0.0
            return self.heading
        px, pz, pslip, pcand = self.prev
        dist = math.hypot(x - px, z - pz)
        if dist > 20.0:                    # teleport (restart, return to pits)
            self.prev = (x, z, slip, None)
            self.elapsed = 0.0
            self.heading = None
            return None
        if dist < 0.15:                    # wait for enough travel to see the direction
            return self.heading

        travel = math.atan2(x - px, z - pz)
        turn = _wrap(slip - pslip)        # slip is near +-pi when reversing
        mid = pslip + turn / 2
        cand = (travel - mid, travel + mid)
        if self.sign == 0 and pcand is not None and self.elapsed > 0:
            slip_rate = turn / self.elapsed
            if abs(slip_rate) > 0.1:       # only a changing slip angle tells the candidates apart
                for i in range(2):
                    rate = _wrap(cand[i] - pcand[i]) / self.elapsed
                    self.err[i] += (abs(rate) - abs(yaw_rate)) ** 2
                self.samples += 1
                if self.samples >= self.LEARN_SAMPLES:
                    if self.err[0] < 0.5 * self.err[1]:
                        self.sign = 1
                    elif self.err[1] < 0.5 * self.err[0]:
                        self.sign = -1
                    self.err = [0.0, 0.0]
                    self.samples = 0

        if self.sign == 1:
            self.heading = cand[0]
        elif self.sign == -1:
            self.heading = cand[1]
        else:
            self.heading = travel
        self.prev = (x, z, slip, cand)
        self.elapsed = 0.0
        return self.heading


def _wrap(a):
    return (a + math.pi) % (2 * math.pi) - math.pi


class ConeCounter(object):
    """Counts each cone one time in each run when the car hits it.

    A hit is a tyre (at the height of a cone base) or the car body (at its height above the
    ground) that goes HIT_DEPTH or more into the cone.
    """

    def __init__(self):
        self.cones = []
        self.hit = set()
        self.order = []
        self.count = 0
        self.last_count = None
        self.prev = None
        self.set_car(CarShape())

    def set_car(self, car):
        self.car = car
        self.reach = max(math.hypot(x, z) for x, z in car.outline) + 0.5

    def set_cones(self, cones):
        self.cones = list(cones)
        self.reset()

    def reset(self):
        """Starts a new run."""
        self.hit = set()
        self.order = []
        self.count = 0

    def trim(self, count):
        """Removes the hits after the first `count` hits."""
        for i in self.order[count:]:
            self.hit.discard(i)
        self.order = self.order[:count]
        self.count = len(self.order)

    def update(self, x, y, z, heading, tyres=None):
        """Tests the car movement since the last update. Returns the number of new hits.

        heading: angle of the car forward direction (forward is (sin, cos) in x, z).
        tyres: four (x, y, z, heading, radius) for FL, FR, RL, RR at the ground contact
        points, or None when the game does not give them (then only the body is tested).
        """
        if heading is None or not self.cones:
            self.prev = None
            return 0
        pose = (x, y, z, heading, tyres)
        prev = self.prev
        self.prev = pose
        if prev is None or math.hypot(x - prev[0], z - prev[2]) > 10.0 or \
                (prev[4] is None) != (tyres is None):
            prev = pose

        # Body height above the ground
        body_height = DEFAULT_BODY_HEIGHT
        if tyres is not None and self.car.bottom is not None:
            ground = sum(t[1] for t in tyres) / 4.0
            body_height = min(max(y + self.car.bottom - ground, 0.0), PROFILE_TOP)

        near = [i for i, c in enumerate(self.cones) if i not in self.hit and
                abs(c[0] - x) < self.reach + c[2] + 10.0 and abs(c[1] - z) < self.reach + c[2] + 10.0]
        if not near:
            return 0

        steps = max(1, min(200, int(math.ceil(math.hypot(x - prev[0], z - prev[2]) / SWEEP_STEP))))
        turn = _wrap(heading - prev[3])
        new_hits = 0
        for s in range(1, steps + 1):
            f = s / float(steps)
            px = prev[0] + (x - prev[0]) * f
            pz = prev[2] + (z - prev[2]) * f
            h = prev[3] + turn * f
            step_tyres = None
            if tyres is not None:
                step_tyres = [(a[0] + (b[0] - a[0]) * f, a[2] + (b[2] - a[2]) * f,
                               a[3] + _wrap(b[3] - a[3]) * f, b[4])
                              for a, b in zip(prev[4], tyres)]
            for i in near:
                if i in self.hit:
                    continue
                cone = self.cones[i]
                if math.hypot(cone[0] - px, cone[1] - pz) > self.reach + cone[2]:
                    continue
                if self._body_hits(cone, px, pz, h, body_height) or \
                        (step_tyres is not None and self._tyre_hits(cone, step_tyres)):
                    self.hit.add(i)
                    self.order.append(i)
                    new_hits += 1
        self.count += new_hits
        return new_hits

    def _body_hits(self, cone, px, pz, h, body_height):
        cx, cz, r, kind, outline, profile = cone
        sh, ch = math.sin(h), math.cos(h)
        if profile is None:
            points = [_to_frame(cx + ox - px, cz + oz - pz, sh, ch) for ox, oz in outline]
            return _penetration(self.car.outline, points) >= HIT_DEPTH
        radius = _profile_radius(profile, body_height)
        if radius <= 0:
            return False
        lat, fwd = _to_frame(cx - px, cz - pz, sh, ch)
        return _circle_depth(self.car.outline, lat, fwd, radius) >= HIT_DEPTH

    def _tyre_hits(self, cone, tyres):
        cx, cz, r, kind, outline, profile = cone
        for wheel, (tx, tz, th, radius) in enumerate(tyres):
            half_len = math.sqrt(max(2 * radius * TYRE_HEIGHT - TYRE_HEIGHT ** 2, 0.0))
            half_wid = self.car.tyre_width[0 if wheel < 2 else 1] / 2
            if math.hypot(cx - tx, cz - tz) > r + half_len + half_wid:
                continue
            sh, ch = math.sin(th), math.cos(th)
            points = [_to_frame(cx + ox - tx, cz + oz - tz, sh, ch) for ox, oz in outline]
            tyre = [(-half_wid, -half_len), (half_wid, -half_len), (half_wid, half_len), (-half_wid, half_len)]
            if _penetration(tyre, points) >= HIT_DEPTH:
                return True
        return False


def _to_frame(dx, dz, sh, ch):
    """World offset to (lateral, forward) for a heading with sin sh and cos ch."""
    return (dx * ch - dz * sh, dx * sh + dz * ch)


def _profile_radius(profile, height):
    k = height / PROFILE_STEP
    i = int(k)
    if i >= len(profile) - 1:
        return profile[-1]
    return profile[i] + (profile[i + 1] - profile[i]) * (k - i)


def _penetration(a, b):
    """How far convex polygons a and b overlap (negative when apart), by separating axes."""
    depth = float('inf')
    for poly in (a, b):
        n = len(poly)
        for i in range(n):
            x1, y1 = poly[i]
            x2, y2 = poly[(i + 1) % n]
            nx, ny = y2 - y1, x1 - x2
            length = math.hypot(nx, ny)
            if length < 1e-9:
                continue
            nx /= length
            ny /= length
            pa = [nx * x + ny * y for x, y in a]
            pb = [nx * x + ny * y for x, y in b]
            depth = min(depth, max(pa) - min(pb), max(pb) - min(pa))
    return depth


def _circle_depth(poly, px, py, radius):
    """How far a circle goes into a convex polygon (negative when apart)."""
    nearest = float('inf')
    side = 0
    inside = True
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        ex, ey = x2 - x1, y2 - y1
        cross = ex * (py - y1) - ey * (px - x1)
        if cross != 0:
            if side == 0:
                side = 1 if cross > 0 else -1
            elif (cross > 0) != (side > 0):
                inside = False
        length2 = ex * ex + ey * ey
        t = 0.0 if length2 == 0 else max(0.0, min(1.0, ((px - x1) * ex + (py - y1) * ey) / length2))
        nearest = min(nearest, math.hypot(px - x1 - ex * t, py - y1 - ey * t))
    return radius + nearest if inside else radius - nearest
