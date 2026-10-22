"""Regenerate golden.json from the original Python engine (Atmanity/apps trajectory-coach).

    python3 make_golden.py <path to apps/trajectory-coach/agent-py/src> > golden.json

Only the pure modules are imported (flight, challenges, launcher): no SDK.
"""
import json
import sys

sys.path.insert(0, sys.argv[1])
from trajectory_coach.challenges import CHALLENGES, grade  # noqa: E402
from trajectory_coach.flight import solve, thin  # noqa: E402
from trajectory_coach.launcher import Launcher, LauncherRefusal  # noqa: E402

grades = []
for c in CHALLENGES:
    for angle in (5, 25, 40, 45, 52.5, 65, 85):
        for speed in (5, 12, 17.5, 18, 22, 30, 40):
            if speed > c.speed_max:
                continue
            f = solve(angle, speed, c.gravity, c.wind_ms)
            v = grade(c, f)
            grades.append([c.id, angle, speed, f.range_m, f.apex_m, f.flight_s, v["cleared"], v["miss_m"], v["note"]])

paths = []
for c in CHALLENGES:
    f = solve(*c.start_aim, c.gravity, c.wind_ms)
    paths.append({"id": c.id, "aim": list(c.start_aim), "path": f.path, "trail": thin(f.path)})


def step(launcher, name, *args):
    try:
        getattr(launcher, name)(*args)
        return None
    except LauncherRefusal as exc:
        return str(exc)


session = []
launcher = Launcher("wall40")
script = [
    ("snapshot",), ("fire",), ("snapshot",), ("set_aim", 40, 20), ("land",), ("snapshot",),
    ("set_aim", 95, 20), ("set_aim", 45, 60), ("set_aim", "steeper", None), ("set_aim", 45, 24), ("snapshot",),
    ("fire",), ("land",), ("snapshot",), ("fire",), ("land",), ("next_challenge",), ("snapshot",),
    ("set_aim", 45, 30), ("start_challenge", "the dragon one"), ("start_challenge", "On the Moon"),
    ("set_aim", 45, 40), ("fire",), ("snapshot",), ("land",), ("snapshot",), ("land",), ("reset",), ("snapshot",),
]
for entry in script:
    name, args = entry[0], list(entry[1:])
    if name == "snapshot":
        session.append({"snapshot": launcher.snapshot()})
    else:
        session.append({"do": name, "args": args, "refused": step(launcher, name, *args)})

json.dump({"grades": grades, "paths": paths, "session": session}, sys.stdout, ensure_ascii=False, separators=(",", ":"))
