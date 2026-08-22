from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "design" / "logo-text -cut.png"
OUTPUT_DIR = ROOT / "public" / "brand"


def perpendicular_distance(point, start, end) -> float:
    px, py = point
    ax, ay = start
    bx, by = end
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return float(((px - ax) ** 2 + (py - ay) ** 2) ** 0.5)
    return abs(dy * px - dx * py + bx * ay - by * ax) / float((dx * dx + dy * dy) ** 0.5)


def simplify_open(points: list[tuple[int, int]], tolerance: float) -> list[tuple[int, int]]:
    if len(points) <= 2:
        return points
    start, end = points[0], points[-1]
    index = -1
    distance = 0.0
    for candidate_index, point in enumerate(points[1:-1], start=1):
        candidate_distance = perpendicular_distance(point, start, end)
        if candidate_distance > distance:
            distance = candidate_distance
            index = candidate_index
    if distance <= tolerance:
        return [start, end]
    left = simplify_open(points[: index + 1], tolerance)
    right = simplify_open(points[index:], tolerance)
    return left[:-1] + right


def simplify_closed(points: list[tuple[int, int]], tolerance: float) -> list[tuple[int, int]]:
    if points[0] == points[-1]:
        points = points[:-1]
    if len(points) <= 4:
        return points
    origin = points[0]
    split = max(
        range(1, len(points)),
        key=lambda index: (points[index][0] - origin[0]) ** 2 + (points[index][1] - origin[1]) ** 2,
    )
    first = simplify_open(points[: split + 1], tolerance)
    second = simplify_open(points[split:] + [origin], tolerance)
    return first[:-1] + second[:-1]


def boundary_edges(mask: np.ndarray):
    height, width = mask.shape
    padded = np.pad(mask, 1, constant_values=False)
    top = mask & ~padded[0:height, 1 : width + 1]
    right = mask & ~padded[1 : height + 1, 2 : width + 2]
    bottom = mask & ~padded[2 : height + 2, 1 : width + 1]
    left = mask & ~padded[1 : height + 1, 0:width]

    for y, x in zip(*np.nonzero(top)):
        yield (int(x), int(y)), (int(x + 1), int(y))
    for y, x in zip(*np.nonzero(right)):
        yield (int(x + 1), int(y)), (int(x + 1), int(y + 1))
    for y, x in zip(*np.nonzero(bottom)):
        yield (int(x + 1), int(y + 1)), (int(x), int(y + 1))
    for y, x in zip(*np.nonzero(left)):
        yield (int(x), int(y + 1)), (int(x), int(y))


def turn_priority(previous, current, candidate) -> int:
    directions = {(1, 0): 0, (0, 1): 1, (-1, 0): 2, (0, -1): 3}
    incoming = directions[(current[0] - previous[0], current[1] - previous[1])]
    outgoing = directions[(candidate[0] - current[0], candidate[1] - current[1])]
    turn = (outgoing - incoming) % 4
    return {1: 0, 0: 1, 3: 2, 2: 3}[turn]


def trace_contours(mask: np.ndarray) -> list[list[tuple[int, int]]]:
    outgoing: dict[tuple[int, int], set[tuple[int, int]]] = defaultdict(set)
    remaining: set[tuple[tuple[int, int], tuple[int, int]]] = set()
    for start, end in boundary_edges(mask):
        outgoing[start].add(end)
        remaining.add((start, end))

    contours: list[list[tuple[int, int]]] = []
    while remaining:
        start, current = next(iter(remaining))
        remaining.remove((start, current))
        points = [start, current]
        previous = start
        while current != start:
            candidates = [end for end in outgoing[current] if (current, end) in remaining]
            if not candidates:
                break
            next_point = min(candidates, key=lambda candidate: turn_priority(previous, current, candidate))
            remaining.remove((current, next_point))
            previous, current = current, next_point
            points.append(current)
        if current == start and len(points) > 5:
            contours.append(points)
    return contours


def fmt(value: int | float) -> str:
    if isinstance(value, int) or float(value).is_integer():
        return str(int(value))
    return f"{value:.2f}".rstrip("0").rstrip(".")


def path_data(contours: Iterable[list[tuple[int, int]]], tolerance: float) -> str:
    sections: list[str] = []
    for contour in contours:
        simplified = simplify_closed(contour, tolerance)
        if len(simplified) < 3:
            continue
        commands = [f"M{fmt(simplified[0][0])} {fmt(simplified[0][1])}"]
        commands.extend(f"L{fmt(x)} {fmt(y)}" for x, y in simplified[1:])
        commands.append("Z")
        sections.append("".join(commands))
    return "".join(sections)


def vectorize(
    name: str,
    crop: tuple[int, int, int, int],
    target_width: int,
    tolerance: float,
    padding_x: int,
    padding_y: int,
) -> None:
    image = Image.open(SOURCE).convert("L").crop(crop)
    target_height = round(image.height * target_width / image.width)
    image = image.resize((target_width, target_height), Image.Resampling.LANCZOS)
    mask = np.asarray(image) < 170
    contours = trace_contours(mask)
    data = path_data(contours, tolerance)
    view_width = target_width + padding_x * 2
    view_height = target_height + padding_y * 2
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{-padding_x} {-padding_y} {view_width} {view_height}" '
        f'role="img" aria-label="MemoscapeLab"><path fill="#000" fill-rule="evenodd" d="{data}"/></svg>\n'
    )
    (OUTPUT_DIR / name).write_text(svg, encoding="utf-8", newline="\n")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    vectorize("mark.svg", (498, 235, 1145, 1539), 324, 0.9, 6, 6)
    vectorize("lockup.svg", (498, 235, 6065, 1539), 1600, 0.85, 10, 6)


if __name__ == "__main__":
    main()
