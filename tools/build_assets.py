# Builds assets/world.glb in headless Blender: imports the two CC0 packs, models
# everything missing, then aligns the style (no textures, one shared palette as
# vertex colours, flat shading, real-world scale, origin at base centre).
#
#   blender -b --factory-startup --python tools/build_assets.py -- \
#     assets_raw/halloween/x assets_raw/farm/x/FBX assets/world.glb
#
# Every prop is one root node at the origin. Front of a model faces Blender -Y,
# which is +Z in three.js. Materials are only: Pal, Glow, Glass, Ghost.
import bpy, bmesh, sys, os, math, random
from mathutils import Vector, Matrix, Euler

HALLOWEEN, FARM, OUT = sys.argv[sys.argv.index('--') + 1:]
KIT_MESHES = os.path.join(HALLOWEEN, 'Meshes')
random.seed(7)

# ---------------------------------------------------------------- palette
PALETTE = {
    'ink': '#141127', 'night': '#231d45', 'dusk': '#3a2f66', 'violet': '#5a4690', 'lilac': '#8d78c4',
    'bone': '#e4d9c0', 'ash': '#9a93a8', 'stone': '#6d6a8a', 'slate': '#454462', 'coal': '#26243a',
    'woodD': '#3f2a2a', 'wood': '#6a4533', 'woodL': '#9a6b45', 'straw': '#d9a94f', 'wheat': '#c49a3f',
    'wheatD': '#8f6f30', 'barn': '#a32f3a', 'barnD': '#6e2235', 'rust': '#b5532f', 'pumpkin': '#f07a1c',
    'pumpkinD': '#b8500f', 'amber': '#f2a02a', 'moss': '#58703a', 'leaf': '#2f6450', 'leafD': '#1f4440',
    'teal': '#2f8f8f', 'blue': '#3b6db0', 'duck': '#ffd53d', 'bill': '#f7871e', 'white': '#f5f1e6',
    'pink': '#d98a9a', 'metal': '#9fb0c8', 'mint': '#7dffcf', 'glow': '#ffb35c', 'glowY': '#ffe08a',
    'glowR': '#ff3b3b', 'black': '#08070f',
}
NAMES = list(PALETTE)
# Glow colours are reserved for emissive parts, so recolouring never picks them.
MATCHABLE = [n for n in NAMES if n not in ('mint', 'glow', 'glowY', 'glowR', 'duck', 'bill')]
PAL, GLOW, GLASS, GHOST = 0, 1, 2, 3
MAT_NAMES = ['Pal', 'Glow', 'Glass', 'Ghost']


def hex_rgb(h):
    return tuple(int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))


def to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def to_srgb(c):
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


LINEAR = {n: tuple(to_linear(c) for c in hex_rgb(h)) for n, h in PALETTE.items()}
SRGB = {n: hex_rgb(h) for n, h in PALETTE.items()}
_nearest_cache = {}


def nearest(rgb):
    """Closest palette entry for an sRGB colour (weighted RGB distance)."""
    key = tuple(round(c, 2) for c in rgb)
    if key not in _nearest_cache:
        def dist(n):
            p = SRGB[n]
            return 2 * (p[0] - rgb[0]) ** 2 + 4 * (p[1] - rgb[1]) ** 2 + 3 * (p[2] - rgb[2]) ** 2
        _nearest_cache[key] = min(MATCHABLE, key=dist)
    return _nearest_cache[key]


materials = [bpy.data.materials.new(n) for n in MAT_NAMES]
for m in materials:
    m.use_nodes = True  # three.js replaces these by name; they only tag the primitives


def euler(rot):
    return Euler(tuple(math.radians(a) for a in rot)).to_matrix().to_4x4() if rot else Matrix()


# ---------------------------------------------------------------- mesh builder
class Model:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.col = self.bm.faces.layers.int.new('pal')

    def take(self, tmp, color, mat=PAL, M=None):
        """Copies a temp bmesh in. color is a palette name or fn(face)->(name, mat)."""
        if M is not None:
            tmp.transform(M)
        vmap = {v: self.bm.verts.new(v.co) for v in tmp.verts}
        for f in tmp.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue  # duplicate face in the source mesh
            c, ma = color(f) if callable(color) else (color, mat)
            nf[self.col] = NAMES.index(c)
            nf.material_index = ma
        tmp.free()
        return self

    def ball(self, color, loc, r, sub=2, rot=None, jit=0.025, mat=PAL):
        tmp = bmesh.new()
        bmesh.ops.create_icosphere(tmp, subdivisions=sub, radius=1)
        r = (r, r, r) if isinstance(r, (int, float)) else r
        for v in tmp.verts:
            v.co += Vector((random.uniform(-jit, jit) * 2 for _ in range(3)))
        return self.take(tmp, color, mat, Matrix.Translation(loc) @ euler(rot) @ Matrix.Diagonal((*r, 1)))

    def cyl(self, color, loc, r1, r2, h, segs=8, rot=None, mat=PAL):
        """Tapered cylinder from its base at loc, along local +Z."""
        tmp = bmesh.new()
        bmesh.ops.create_cone(tmp, cap_ends=True, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=h)
        return self.take(tmp, color, mat, Matrix.Translation(loc) @ euler(rot) @ Matrix.Translation((0, 0, h / 2)))

    def box(self, color, loc, size, bev=0.06, rot=None, mat=PAL, taper=1.0, segs=1):
        """Chamfered box centred at loc; taper shrinks the top so nothing reads as a cube."""
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1)
        for v in tmp.verts:
            k = taper if v.co.z > 0 else 1
            v.co.x *= size[0] * k
            v.co.y *= size[1] * k
            v.co.z *= size[2]
        if bev:
            bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=bev, segments=segs, profile=0.5, affect='EDGES')
        return self.take(tmp, color, mat, Matrix.Translation(loc) @ euler(rot))

    def lathe(self, colors, prof, segs=16, mat=PAL, loc=(0, 0, 0)):
        """Revolves (radius, z) points. colors is one name or one per profile band."""
        tmp = bmesh.new()
        rings = []
        for r, z in prof:
            rings.append([tmp.verts.new((r * math.cos(2 * math.pi * i / segs), r * math.sin(2 * math.pi * i / segs), z))
                          for i in range(segs)])
        bands = {}
        for b in range(len(rings) - 1):
            for i in range(segs):
                j = (i + 1) % segs
                f = tmp.faces.new([rings[b][i], rings[b][j], rings[b + 1][j], rings[b + 1][i]])
                bands[f] = b
        bmesh.ops.recalc_face_normals(tmp, faces=list(tmp.faces))
        col = colors if isinstance(colors, str) else None
        tmp_faces = {f.index: bands[f] for f in tmp.faces}
        return self.take(tmp, lambda f: (col or colors[tmp_faces[f.index]], mat), M=Matrix.Translation(loc))

    def hull(self, color, verts, faces, mat=PAL):
        tmp = bmesh.new()
        vs = [tmp.verts.new(v) for v in verts]
        for f in faces:
            tmp.faces.new([vs[i] for i in f])
        return self.take(tmp, color, mat)

    def warp(self, fn):
        for v in self.bm.verts:
            v.co = Vector(fn(*v.co))
        return self

    def fit(self, h=None, longest=None, center=True):
        """Uniform scale to a real-world height (or longest side), base at z=0."""
        vs = [v.co for v in self.bm.verts]
        lo = [min(c[i] for c in vs) for i in range(3)]
        hi = [max(c[i] for c in vs) for i in range(3)]
        s = h / (hi[2] - lo[2]) if h else longest / max(hi[i] - lo[i] for i in range(3))
        off = Vector(((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2])) if center else Vector((0, 0, lo[2]))
        for v in self.bm.verts:
            v.co = (v.co - off) * s
        return self

    def finish(self):
        me = bpy.data.meshes.new(self.name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in materials:
            me.materials.append(m)
        pal = me.attributes['pal'].data
        attr = me.color_attributes.new('Color', 'FLOAT_COLOR', 'CORNER')
        for p in me.polygons:
            c = LINEAR[NAMES[pal[p.index].value]]
            for li in p.loop_indices:
                attr.data[li].color = (*c, 1)
        me.attributes.remove(me.attributes['pal'])
        me.shade_flat()
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        built.append(ob)


built = []

# ---------------------------------------------------------------- pack import
_img = bpy.data.images.load(os.path.join(HALLOWEEN, 'Textures', 'BaseColor.png'))
_w, _h = _img.size
_px = _img.pixels[:]


def tex(u, v):
    x = min(int((u % 1) * _w), _w - 1)
    y = min(int((v % 1) * _h), _h - 1)
    i = (y * _w + x) * 4
    return (_px[i], _px[i + 1], _px[i + 2])


def fbx_objects(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def discard(objs):
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)


def add_kit(model, name, M=Matrix(), glow_cells=(), remap={}):
    """Adds a Halloween-kit mesh, recolouring each face from its BaseColor UV."""
    objs = fbx_objects(os.path.join(KIT_MESHES, name + '.fbx'))
    for o in objs:
        if o.type != 'MESH':
            continue
        tmp = bmesh.new()
        tmp.from_mesh(o.data)
        tmp.transform(M @ o.matrix_world)
        uv = tmp.loops.layers.uv.active
        emissive = 'glass' in o.name.lower() or 'flame' in o.name.lower()

        def color(f):
            a = [l[uv].uv for l in f.loops]
            u, v = sum(p.x for p in a) / len(a), sum(p.y for p in a) / len(a)
            cell = (int((1 - v % 1) * 10), int((u % 1) * 5))
            if emissive or cell in glow_cells:
                return 'glow', GLOW
            c = nearest(tex(u, v))
            return remap.get(c, c), PAL
        model.take(tmp, color)
    discard(objs)
    return model


def kit(node, name, h=None, longest=None, glow_cells=(), remap={}):
    add_kit(Model(node), name, glow_cells=glow_cells, remap=remap).fit(h, longest).finish()


FARM_COLORS = {'DarkRed': 'barnD', 'LightRed': 'barn', 'White': 'bone', 'RoofBlack': 'slate', 'Brown': 'wood',
               'Grey': 'stone', 'DarkGrey': 'slate', 'LightBrown': 'woodL', 'DarkBrown': 'woodD', 'Black': 'coal'}


def window_glow(tmp, is_white, model, height):
    """The farm pack has no lit windows: small flat white frames get a glowing pane."""
    seen, n = set(), 0
    for start in tmp.faces:
        if start in seen or not is_white(start):
            continue
        island, stack = [], [start]
        seen.add(start)
        while stack:
            f = stack.pop()
            island.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g not in seen and is_white(g):
                        seen.add(g)
                        stack.append(g)
        vs = {v.co.copy().freeze() for f in island for v in f.verts}
        lo = [min(c[i] for c in vs) for i in range(3)]
        hi = [max(c[i] for c in vs) for i in range(3)]
        d = [hi[i] - lo[i] for i in range(3)]
        flat, wide = min(d[0], d[1]), max(d[0], d[1])
        if flat < 0.62 and 0.35 < wide < 1.6 and 0.35 < d[2] < 1.5 and lo[2] > height * 0.12:
            # The frames surround real holes in the wall, so the pane sits inside the opening.
            c = Vector(((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2))
            ax = 0 if d[0] < d[1] else 1  # the wall's normal axis
            sz = [0.04, 0.04, d[2] * 0.8]
            sz[1 - ax] = wide * 0.8
            model.box('glow', c, sz, bev=0, mat=GLOW)
            n += 1
    return n


def farm(node, name, h, windows=True):
    objs = fbx_objects(os.path.join(FARM, name + '.fbx'))
    model = Model(node)
    panes = 0
    for o in objs:
        if o.type != 'MESH':
            continue
        tmp = bmesh.new()
        tmp.from_mesh(o.data)
        tmp.transform(o.matrix_world)
        names = [s.material.name.split('.')[0] if s.material else 'Grey' for s in o.material_slots]
        if windows and 'Door' not in o.name and 'Window' not in o.name:
            panes += window_glow(tmp, lambda f: names[f.material_index] == 'White', model, h)

        def color(f, names=names):
            return FARM_COLORS.get(names[f.material_index], 'stone'), PAL
        model.take(tmp, color)
    discard(objs)
    print(f'ASSET {node}: {panes} lit windows')
    model.fit(h).finish()


# ---------------------------------------------------------------- custom props
def chicken():
    m = Model('chicken')
    m.ball('white', (0, 0.03, 0.34), (0.24, 0.3, 0.24))
    m.ball('white', (0, -0.21, 0.56), 0.14)
    m.cyl('bill', (0, -0.33, 0.55), 0.05, 0.0, 0.11, segs=5, rot=(90, 0, 0))
    m.ball('barn', (0, -0.21, 0.71), (0.04, 0.09, 0.06), sub=1)
    m.ball('barn', (0, -0.31, 0.47), (0.03, 0.03, 0.05), sub=1)
    m.ball('black', (0.11, -0.28, 0.6), 0.025, sub=1)
    m.ball('black', (-0.11, -0.28, 0.6), 0.025, sub=1)
    m.cyl('white', (0, 0.28, 0.4), 0.14, 0.03, 0.3, segs=5, rot=(-50, 0, 0))
    m.ball('ash', (0.22, 0.05, 0.36), (0.05, 0.17, 0.11), sub=1)
    m.ball('ash', (-0.22, 0.05, 0.36), (0.05, 0.17, 0.11), sub=1)
    for x in (-0.1, 0.1):
        m.cyl('bill', (x, 0, 0), 0.05, 0.03, 0.14, segs=5)
    m.fit(0.62).finish()


def cow():
    m = Model('cow')
    m.ball('white', (0, 0.1, 0.92), (0.58, 0.98, 0.56))
    for loc, r in (((0.38, 0.45, 1.05), (0.26, 0.36, 0.3)), ((-0.42, -0.1, 1.0), (0.22, 0.34, 0.32)),
                   ((0.1, -0.2, 1.4), (0.3, 0.3, 0.1)), ((-0.15, 0.7, 1.3), (0.26, 0.24, 0.13))):
        m.ball('coal', loc, r, jit=0.05)
    m.ball('white', (0, -0.95, 1.24), (0.3, 0.38, 0.32))
    m.ball('pink', (0, -1.27, 1.14), (0.24, 0.16, 0.17))
    for x in (-0.1, 0.1):
        m.ball('black', (x, -1.42, 1.15), 0.035, sub=1)
        m.ball('black', (x * 2, -1.17, 1.32), 0.045, sub=1)
    for s in (-1, 1):
        m.cyl('bone', (s * 0.2, -0.87, 1.5), 0.06, 0.015, 0.25, segs=5, rot=(0, s * 30, 0))
        m.ball('coal', (s * 0.37, -0.82, 1.32), (0.15, 0.07, 0.07), sub=1)
    for x, y in ((-0.3, -0.45), (0.3, -0.45), (-0.3, 0.65), (0.3, 0.65)):
        m.cyl('white', (x, y, 0.1), 0.15, 0.17, 0.55, segs=6)
        m.cyl('coal', (x, y, 0), 0.16, 0.15, 0.13, segs=6)
    m.ball('pink', (0, 0.55, 0.42), (0.17, 0.17, 0.12), sub=1)
    m.cyl('coal', (0, 1.07, 1.12), 0.04, 0.025, 0.65, segs=4, rot=(-160, 0, 0))
    m.fit(1.5).finish()


def pig():
    m = Model('pig')
    m.ball('pink', (0, 0.05, 0.56), (0.47, 0.68, 0.45))
    m.ball('pink', (0, -0.6, 0.68), (0.32, 0.3, 0.3))
    m.cyl('rust', (0, -0.84, 0.63), 0.15, 0.13, 0.13, segs=7, rot=(90, 0, 0))
    for s in (-1, 1):
        m.ball('black', (s * 0.05, -0.97, 0.64), 0.025, sub=1)
        m.ball('black', (s * 0.15, -0.81, 0.79), 0.035, sub=1)
        m.cyl('rust', (s * 0.2, -0.55, 0.9), 0.1, 0.02, 0.2, segs=4, rot=(-15, s * 25, 0))
        for y in (-0.3, 0.42):
            m.cyl('rust', (s * 0.24, y, 0), 0.11, 0.1, 0.25, segs=6)
    m.ball('rust', (0, 0.71, 0.72), 0.06, sub=1)
    m.fit(0.95).finish()


def sheep():
    m = Model('sheep')
    random.seed(3)
    for _ in range(11):
        a, b = random.uniform(0, 6.28), random.uniform(-0.65, 0.65)
        m.ball('white', (0.3 * math.cos(a), b, 0.7 + 0.28 * math.sin(a)), random.uniform(0.27, 0.36), sub=1, jit=0.04)
    m.ball('coal', (0, -0.75, 0.82), (0.21, 0.27, 0.23), sub=1)
    m.ball('white', (0, -0.68, 1.03), 0.17, sub=1)
    for s in (-1, 1):
        m.ball('coal', (s * 0.27, -0.7, 0.9), (0.11, 0.05, 0.05), sub=1)
        m.ball('bone', (s * 0.11, -0.95, 0.88), 0.03, sub=1)
        for y in (-0.38, 0.42):
            m.cyl('coal', (s * 0.22, y, 0), 0.08, 0.07, 0.42, segs=5)
    m.fit(1.15).finish()


def crow():
    m = Model('crow')
    m.ball('coal', (0, 0.03, 0.23), (0.15, 0.25, 0.16))
    m.ball('coal', (0, -0.18, 0.38), 0.11, sub=1)
    m.cyl('amber', (0, -0.27, 0.38), 0.04, 0.0, 0.13, segs=4, rot=(90, 0, 0))
    m.ball('glowY', (0.06, -0.25, 0.42), 0.02, sub=1, mat=GLOW)
    m.ball('glowY', (-0.06, -0.25, 0.42), 0.02, sub=1, mat=GLOW)
    m.cyl('dusk', (0, 0.22, 0.2), 0.1, 0.02, 0.28, segs=4, rot=(-105, 0, 0))
    for s in (-1, 1):
        m.ball('dusk', (s * 0.17, 0.06, 0.26), (0.05, 0.19, 0.09), sub=1)
        m.cyl('amber', (s * 0.05, 0, 0), 0.02, 0.02, 0.11, segs=3)
    m.fit(0.55).finish()


def scarecrow():
    m = Model('scarecrow')
    m.cyl('wood', (0, 0, 0), 0.08, 0.07, 2.2, segs=5)
    m.cyl('wood', (-1.05, 0, 1.75), 0.05, 0.05, 2.1, segs=5, rot=(0, 90, 0))
    m.box('barnD', (0, 0, 1.55), (0.68, 0.36, 0.95), bev=0.08, taper=1.2)
    m.box('slate', (0, 0, 0.92), (0.58, 0.3, 0.42), bev=0.05)
    for s in (-1, 1):
        m.cyl('barnD', (s * 0.3, 0, 1.75), 0.14, 0.12, 0.62, segs=5, rot=(0, s * 90, 0))
        m.cyl('straw', (s * 0.92, 0, 1.75), 0.1, 0.17, 0.2, segs=5, rot=(0, s * 90, 0))
        m.cyl('straw', (s * 0.15, 0, 0.72), 0.13, 0.04, 0.34, segs=5, rot=(180, 0, 0))
    m.ball('pumpkin', (0, 0, 2.3), (0.36, 0.34, 0.3))
    for s in (-1, 1):
        m.ball('glow', (s * 0.15, -0.31, 2.36), (0.07, 0.03, 0.07), sub=1, mat=GLOW)
    m.ball('glow', (0, -0.33, 2.2), (0.14, 0.02, 0.04), sub=1, mat=GLOW)
    m.cyl('coal', (0, 0, 2.5), 0.56, 0.5, 0.06, segs=9)
    m.cyl('coal', (0, 0, 2.55), 0.27, 0.05, 0.62, segs=7, rot=(10, 8, 0))
    m.fit(3.1).finish()


def hay():
    m = Model('hay')
    m.cyl('straw', (-0.75, 0, 0.6), 0.6, 0.6, 1.5, segs=10, rot=(0, 90, 0))
    for x in (-0.3, 0.3):
        m.cyl('wheatD', (x - 0.02, 0, 0.6), 0.615, 0.615, 0.05, segs=10, rot=(0, 90, 0))
    m.warp(lambda x, y, z: (x, y, max(z, 0.02)))
    m.fit(1.15).finish()


def wheat():
    m = Model('wheat')
    for dx, dy, h, lean in ((0.14, 0.05, 1.1, 8), (-0.13, 0.1, 1.0, -9), (0.03, -0.14, 1.2, 4), (-0.05, 0.02, 1.25, -2)):
        m.cyl('wheat', (dx, dy, 0), 0.06, 0.02, h, segs=3, rot=(lean, lean, 0))
        top = Vector((dx, dy, 0)) + (euler((lean, lean, 0)) @ Vector((0, 0, h)))
        m.cyl('straw', top, 0.11, 0.0, 0.38, segs=4, rot=(lean, lean, 0))
        m.cyl('straw', top, 0.11, 0.0, 0.14, segs=4, rot=(180 + lean, lean, 0))
    m.fit(1.45).finish()


def tree_round():
    m = Model('tree_round')
    m.cyl('woodD', (0, 0, 0), 0.42, 0.24, 3.2, segs=6)
    for loc, r, c in (((0, 0, 4.2), 2.1, 'rust'), ((1.15, 0.4, 3.4), 1.25, 'pumpkinD'), ((-1.05, -0.4, 3.5), 1.35, 'amber'),
                      ((0.2, -0.9, 5.2), 1.05, 'pumpkinD')):
        m.ball(c, loc, r, sub=1, jit=0.05)
    m.fit(7).finish()


def pine():
    m = Model('pine')
    m.cyl('woodD', (0, 0, 0), 0.32, 0.22, 1.5, segs=6)
    for z, r, h, c in ((1.1, 2.0, 2.6, 'leafD'), (2.8, 1.55, 2.4, 'leaf'), (4.4, 1.1, 2.3, 'leafD')):
        m.cyl(c, (0, 0, z), r, 0.0, h, segs=7)
    m.warp(lambda x, y, z: (x + 0.03 * z, y, z))
    m.fit(8).finish()


def lamp():
    m = Model('lamp')
    add_kit(m, 'Lantern_Pole')
    vs = [v.co.copy() for v in m.bm.verts]
    top = max(c.z for c in vs)
    # The lantern hangs from the far end of the pole's arm.
    tip = max((c for c in vs if c.z > top * 0.7), key=lambda c: c.x * c.x + c.y * c.y)
    add_kit(m, 'Lantern_1', Matrix.Translation((tip.x, tip.y, tip.z - 0.235)) @ Matrix.Scale(1.15, 4))
    m.ball('glow', (tip.x, tip.y, tip.z - 0.14), (0.042, 0.042, 0.07), sub=1, mat=GLOW)
    m.fit(5.4, center=False).finish()


def farmhouse(name, wall, trim, roof, door, w=7.2, d=5.6, h=4.3, rh=2.7, chimney_x=-2.2, dormer=True):
    m = Model(name)
    m.box(wall, (0, 0, h / 2), (w, d, h), bev=0.1, taper=0.95)
    m.box('slate', (0, 0, 0.2), (w + 0.35, d + 0.35, 0.42), bev=0.08)
    # Gable walls under two thick, overhanging roof slabs.
    tw, td = w * 0.95 / 2, d * 0.95 / 2
    m.hull(wall, [(-tw, -td, h), (tw, -td, h), (tw, td, h), (-tw, td, h), (-tw, 0, h + rh), (tw, 0, h + rh)],
           [(0, 1, 2, 3), (0, 4, 1), (2, 5, 3), (0, 3, 5, 4), (1, 4, 5, 2)])
    slope = math.atan2(rh, td)
    length = math.hypot(rh, td) + 0.65
    for s in (-1, 1):
        cy = s * td * 0.5 + s * 0.2
        m.box(roof, (0, cy, h + rh / 2 - 0.02 + 0.08), (w + 0.9, length, 0.24), bev=0.05, rot=(-s * math.degrees(slope), 0, 0))
    m.box(trim, (0, 0, h + rh + 0.06), (w + 1.0, 0.34, 0.2), bev=0.05)
    m.box('stone', (chimney_x, 1.25, h + 1.6), (0.72, 0.72, 2.7), bev=0.06, taper=0.86)
    m.box('coal', (chimney_x, 1.25, h + 3.0), (0.78, 0.78, 0.18), bev=0.03)

    def window(x, z, y=-d * 0.475, sx=0.95, sz=1.25, side=False):
        if side:
            m.box(trim, (y, x, z), (0.1, sx + 0.24, sz + 0.24), bev=0.03)
            m.box('glow', (y + (0.07 if y > 0 else -0.07), x, z), (0.03, sx, sz), bev=0, mat=GLOW)
        else:
            m.box(trim, (x, y, z), (sx + 0.24, 0.1, sz + 0.24), bev=0.03)
            m.box('glow', (x, y - 0.07, z), (sx, 0.03, sz), bev=0, mat=GLOW)
            m.box(trim, (x, y - 0.1, z), (0.07, 0.04, sz), bev=0)
    for x in (-2.3, 2.3):
        window(x, 1.65)
        window(x * 0.8, 3.45, sz=1.05)
    window(0, h + 0.75, y=-d * 0.14, sx=0.8, sz=0.8) if dormer else None
    for y in (-1.2, 1.2):
        window(y, 2.0, y=w * 0.475, side=True)
        window(y, 2.0, y=-w * 0.475, side=True)
    m.box(door, (0, -d * 0.49, 1.25), (1.2, 0.12, 2.05), bev=0.04)
    m.ball('glowY', (0.42, -d * 0.53, 1.25), 0.06, sub=1, mat=GLOW)
    # Porch: little roof on crooked posts, plus steps.
    m.box(roof, (0, -d * 0.5 - 1.05, 3.05), (3.6, 2.5, 0.2), bev=0.05, rot=(14, 0, 0))
    for x in (-1.6, 1.6):
        m.cyl(trim, (x, -d * 0.5 - 1.9, 0.25), 0.1, 0.08, 2.5, segs=5)
    m.box('wood', (0, -d * 0.5 - 1.0, 0.25), (3.7, 2.2, 0.32), bev=0.04)
    m.box('stone', (0, -d * 0.5 - 2.35, 0.1), (1.6, 0.7, 0.2), bev=0.03)
    # The crooked bit: a lean, a saggy ridge and hand-made wobble.
    random.seed(len(name))
    cache = {}

    def crooked(x, y, z):
        k = (round(x, 2), round(y, 2), round(z, 2))
        if k not in cache:
            cache[k] = tuple(random.uniform(-0.035, 0.035) for _ in range(3))
        j = cache[k]
        ridge = max(0, z - h) / rh
        return (x + 0.055 * z + j[0], y - 0.03 * z + j[1], z - 0.28 * ridge * (1 - (x / (w * 0.55)) ** 2) + 0.05 * x + j[2])
    m.warp(crooked)
    m.fit(8.0).finish()


def car(name, body, top, pickup=False):
    m = Model(name)
    m.box(body, (0, 0, 0.72), (2.0, 4.3, 0.74), bev=0.17, segs=2, taper=0.97)
    if pickup:
        m.box(body, (0, -0.4, 1.4), (1.78, 1.5, 0.7), bev=0.13, taper=0.82)
        m.box('dusk', (0, -1.13, 1.42), (1.4, 0.03, 0.42), bev=0, rot=(14, 0, 0))
        m.box('dusk', (0, 0.34, 1.42), (1.3, 0.03, 0.36), bev=0)
        for s in (-1, 1):
            m.box('dusk', (s * 0.87, -0.42, 1.42), (0.03, 1.05, 0.4), bev=0)
            m.box(top, (s * 0.92, 1.3, 1.2), (0.16, 1.45, 0.34), bev=0.03)
        m.box(top, (0, 2.0, 1.2), (1.98, 0.14, 0.34), bev=0.03)
        m.box('straw', (0, 1.25, 1.13), (1.4, 1.1, 0.18), bev=0.05)
    else:
        m.box(top, (0, 0.15, 1.42), (1.7, 2.35, 0.72), bev=0.17, segs=2, taper=0.76)
        m.box('dusk', (0, -0.87, 1.42), (1.32, 0.03, 0.42), bev=0, rot=(32, 0, 0))
        m.box('dusk', (0, 1.17, 1.42), (1.25, 0.03, 0.4), bev=0, rot=(-32, 0, 0))
        for s in (-1, 1):
            m.box('dusk', (s * 0.78, 0.15, 1.42), (0.03, 1.55, 0.38), bev=0)
    for x in (-1, 1):
        for y in (-1.33, 1.33):
            m.cyl('coal', (x * 0.86, y, 0.46), 0.46, 0.46, 0.42, segs=9, rot=(0, 90, 0))
            m.cyl('ash', (x * 0.86 + (0.42 if x > 0 else -0.05), y, 0.46), 0.2, 0.2, 0.05, segs=7, rot=(0, 90, 0))
        m.ball('glowY', (x * 0.67, -2.13, 0.84), (0.24, 0.08, 0.17), sub=1, mat=GLOW, jit=0)
        m.ball('glowR', (x * 0.7, 2.14, 0.86), (0.2, 0.05, 0.12), sub=1, mat=GLOW, jit=0)
    m.box('metal', (0, -2.2, 0.48), (1.95, 0.2, 0.2), bev=0.05)
    m.box('metal', (0, 2.2, 0.48), (1.95, 0.2, 0.2), bev=0.05)
    m.warp(lambda x, y, z: (x, y, z + 0.02 * max(0, -y)))
    m.fit(2.0).finish()


def ghost(name, arm):
    m = Model(name)
    prof = [(0.92, 0.0), (0.86, 0.2), (0.78, 0.8), (0.72, 1.3), (0.56, 1.76), (0.3, 2.04), (0.02, 2.14)]
    m.lathe('white', prof, segs=12, mat=GHOST)

    def hem(x, y, z):
        a = math.atan2(y, x)
        return (x, y, z + (0.13 * math.sin(a * 6) if z < 0.1 else 0))
    m.warp(hem)
    for s in (-1, 1):
        m.ball('black', (s * 0.27, -0.56, 1.55), (0.14, 0.05, 0.2), sub=1, jit=0, mat=PAL)
        m.ball('white', (s * 0.74, -0.2, 1.0 + (arm if s > 0 else 0)), (0.24, 0.2, 0.2), sub=1, mat=GHOST)
    m.ball('black', (0, -0.67, 1.15), (0.12, 0.04, 0.15), sub=1, jit=0, mat=PAL)
    m.fit(2.2).finish()


# ---------------------------------------------------------------- the saucer
def ufo():
    b = Model('ufo_body')
    b.lathe(['coal', 'slate', 'metal', 'metal', 'ash', 'lilac', 'metal', 'stone', 'slate'],
            [(0.0, -0.92), (1.05, -0.92), (1.35, -0.72), (2.3, -0.42), (3.15, -0.1), (3.3, 0.06), (3.1, 0.22),
             (2.25, 0.5), (1.98, 0.66), (1.9, 0.72)], segs=18)
    b.cyl('coal', (0, 0, 0.6), 1.92, 1.92, 0.08, segs=18)
    for i in range(6):
        a = i / 6 * math.tau
        b.ball('slate', (2.05 * math.cos(a), 2.05 * math.sin(a), -0.62), (0.34, 0.34, 0.28), sub=1)
    b.lathe('mint', [(0.72, -0.95), (1.08, -0.95), (1.08, -0.86), (0.72, -0.86)], segs=18, mat=GLOW)
    b.finish()

    lights = Model('ufo_lights')
    for i in range(14):
        a = i / 14 * math.tau
        c = 'mint' if i % 2 else 'glow'
        lights.ball(c, (3.22 * math.cos(a), 3.22 * math.sin(a), 0.03), 0.17, sub=1, jit=0, mat=GLOW)
    lights.finish()

    d = Model('ufo_dome')
    d.lathe('white', [(1.9, 0.68), (1.86, 1.1), (1.68, 1.72), (1.3, 2.24), (0.74, 2.6), (0.02, 2.74)], segs=14, mat=GLASS)
    d.finish()

    c = Model('ufo_cockpit')  # rotates to keep the pilot facing the camera; front is -Y
    c.cyl('dusk', (0, 0, 0.66), 1.86, 1.86, 0.06, segs=14)
    c.cyl('slate', (0, 0.24, 0.7), 0.6, 0.42, 0.48, segs=9)  # pilot seat pedestal
    screens = ('mint', 'glow', 'glowY', 'mint', 'glowR', 'glow', 'mint', 'glowY', 'glow')
    for i, col in enumerate(screens):
        a = (i + 0.5) / 9 * math.tau
        x, y, deg = 1.47 * math.cos(a), 1.47 * math.sin(a), math.degrees(a)
        c.box('slate', (x, y, 0.92), (0.34, 0.76, 0.55), bev=0.05, rot=(0, -24, deg), taper=0.9)
        c.box(col, (x * 0.87, y * 0.87, 1.08), (0.03, 0.54, 0.25), bev=0, rot=(0, -38, deg), mat=GLOW)
        for k in (-0.2, 0, 0.2):
            ox, oy = -math.sin(a) * k, math.cos(a) * k
            c.ball(screens[(i + 2) % 9], (x * 0.74 + ox, y * 0.74 + oy, 0.92), 0.035, sub=1, jit=0, mat=GLOW)
    c.cyl('coal', (0, -0.82, 0.7), 0.24, 0.16, 0.14, segs=8)  # joystick socket
    c.finish()

    s = Model('ufo_stick')  # origin is the pivot; placed and tilted in-game
    s.cyl('metal', (0, 0, 0), 0.055, 0.045, 0.62, segs=6)
    s.ball('glowR', (0, 0, 0.7), 0.12, sub=1, jit=0, mat=GLOW)
    s.finish()

    q = Model('ufo_duck')  # small yellow pilot, facing -Y
    q.ball('duck', (0, 0.22, 1.42), (0.5, 0.56, 0.46))
    q.ball('duck', (0, -0.05, 2.0), 0.36)
    q.ball('bill', (0, -0.38, 1.94), (0.2, 0.17, 0.065), sub=1)
    q.ball('bill', (0, -0.33, 1.87), (0.15, 0.13, 0.04), sub=1)
    for sx in (-1, 1):
        q.ball('white', (sx * 0.15, -0.3, 2.1), 0.095, sub=1, jit=0)
        q.ball('black', (sx * 0.16, -0.38, 2.11), 0.048, sub=1, jit=0)
    q.cyl('amber', (0.42, 0.28, 1.5), 0.2, 0.05, 0.3, segs=5, rot=(30, 110, 20))
    q.cyl('amber', (-0.42, 0.28, 1.5), 0.2, 0.05, 0.3, segs=5, rot=(30, -110, -20))
    q.cyl('duck', (0, 0.72, 1.45), 0.18, 0.02, 0.36, segs=5, rot=(-60, 0, 0))
    # Tiny flight goggles and scarf, because of course.
    q.lathe('barn', [(0.26, 1.73), (0.31, 1.7), (0.3, 1.82), (0.25, 1.86)], segs=9, loc=(0, -0.02, 0))
    q.lathe('coal', [(0.36, 2.09), (0.385, 2.15), (0.34, 2.24)], segs=10, loc=(0, -0.05, 0))
    for sx in (-1, 1):
        q.cyl('glowY', (sx * 0.16, -0.33, 2.23), 0.11, 0.11, 0.05, segs=7, rot=(90, 0, 0), mat=GLOW)
    q.finish()


# ---------------------------------------------------------------- build all
for cell_name, h in (('Gravestone_1', 1.5), ('Gravestone_2', 1.75), ('Gravestone_3', 1.45)):
    kit(cell_name.lower(), cell_name, h)
kit('fence_iron_1', 'Fence_1', 1.6)
kit('fence_iron_2', 'Fence_2', 1.6)
kit('fence_iron_3', 'Fence_3', 1.6)
kit('tree_dead_1', 'Tree_1', 6.5)
kit('tree_dead_2', 'Tree_2', 8.0)
kit('tree_dead_3', 'Tree_3', 9.0)
ORANGE = {'amber': 'pumpkin', 'straw': 'pumpkin', 'wheat': 'pumpkinD', 'wheatD': 'pumpkinD', 'bone': 'pumpkin'}
kit('pumpkin_1', 'Pumpkin_1', 0.85, remap=ORANGE)
kit('pumpkin_2', 'Pumpkin_2', 1.0, remap=ORANGE)
kit('pumpkin_3', 'Pumpkin_3', 1.05, remap=ORANGE)
for n, h in (('Pumpkin_Lantern_1', 0.9), ('Pumpkin_Lantern_2', 1.05)):
    kit(n.lower(), n, h, glow_cells=((8, 3),), remap=ORANGE)
kit('coffin', 'Coffin_1', longest=2.3)
kit('cauldron', 'Cauldron_1', 1.2)
kit('urn', 'Urn', 1.0)
kit('pillar', 'Pillar_2', 2.6)
kit('stone', 'Stone_1', 0.7)
kit('wolf_skull', 'Wolf_Skull', 0.75)

farm('barn', 'Barn', 7.2)
farm('barn_big', 'BigBarn', 8.8)
farm('barn_small', 'SmallBarn', 5.4)
farm('barn_open', 'OpenBarn', 5.4)
farm('silo', 'Silo', 9.2, windows=False)
farm('silo_house', 'Silo_House', 9.2)
farm('coop', 'ChickenCoop', 2.2, windows=False)
farm('fence', 'Fence', 1.15, windows=False)
farm('fence_picket', 'Fence2', 1.2, windows=False)
farm('well', 'Well', 2.6, windows=False)
farm('windmill', 'Windmill', 10.2, windows=False)
farm('windmill_tower', 'TowerWindmill', 10.2, windows=False)
farm('water_tower', 'WaterTower', 8.4, windows=False)

chicken(); cow(); pig(); sheep(); crow(); scarecrow(); hay(); wheat(); tree_round(); pine(); lamp()
farmhouse('farmhouse_a', 'bone', 'ash', 'slate', 'barnD')
farmhouse('farmhouse_b', 'lilac', 'bone', 'coal', 'teal', w=6.6, d=5.2, h=4.0, rh=3.0, chimney_x=2.0)
car('car_a', 'blue', 'blue')
car('car_b', 'teal', 'bone')
car('car_c', 'rust', 'rust')
car('pickup_a', 'barnD', 'barnD', pickup=True)
car('pickup_b', 'amber', 'bone', pickup=True)
ghost('ghost_a', 0.0)
ghost('ghost_b', 0.45)
ufo()

for ob in list(bpy.context.scene.objects):
    if ob not in built:
        bpy.data.objects.remove(ob, do_unlink=True)

tris = 0
for ob in built:
    ob.data.calc_loop_triangles()
    n = len(ob.data.loop_triangles)
    tris += n
    d = ob.dimensions
    print(f'ASSET {ob.name:18s} tris={n:5d} size=({d.x:.2f}, {d.y:.2f}, {d.z:.2f})')
print(f'ASSET total nodes={len(built)} tris={tris}')

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=False, export_apply=True, export_yup=True,
                          export_vertex_color='ACTIVE', export_texcoords=False, export_normals=True,
                          export_animations=False, export_cameras=False, export_lights=False)
print('ASSET wrote', OUT)
