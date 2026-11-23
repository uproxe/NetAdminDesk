#!/usr/bin/env python3
"""Иконки NetAdmin Desk из build/logo.svg.

Запуск из корня репозитория:  python3 scripts/make-icons.py
Нужны rsvg-convert (librsvg) и Pillow. Результат кладётся в build/ и коммитится,
поэтому при обычной сборке скрипт запускать не нужно — только после изменения логотипа.

  build/icon.png          1024×1024 — Windows, Linux, окно приложения
  build/icon-mac.png      1024×1024 с полями по сетке macOS (знак 824 px)
  build/icon.ico          16…256 px; мелкие размеры — с утолщёнными линиями
  build/tray.png, @2x     значок в области уведомлений Windows и Linux
  build/trayTemplate.png, @2x   значок в строке меню macOS (чёрный силуэт, цвет подставит система)
"""
import io
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / 'build'
SRC = (BUILD / 'logo.svg').read_text(encoding='utf-8')

BG = '#0B1220'
FG = '#38BDF8'


def parts(stroke: float = 14, radius: float = 15, color: str = FG) -> str:
    """Знак без подложки: шеврон (связи узлов), курсор и три узла — как в logo.svg."""
    return (
        f'<g stroke="{color}" stroke-width="{stroke}" fill="none" stroke-linecap="round" stroke-linejoin="round">'
        '<path d="M 80 84 L 144 128 L 80 172"/><path d="M 162 172 H 192"/></g>'
        f'<g fill="{color}"><circle cx="80" cy="84" r="{radius}"/><circle cx="144" cy="128" r="{radius}"/>'
        f'<circle cx="80" cy="172" r="{radius}"/></g>'
    )


def tile(stroke: float = 14, radius: float = 15) -> str:
    return f'<rect width="256" height="256" rx="56" fill="{BG}"/>' + parts(stroke, radius)


def svg(body: str, view: str = '0 0 256 256') -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}">{body}</svg>'


def render(svg_text: str, size: int) -> Image.Image:
    png = subprocess.run(
        ['rsvg-convert', '-w', str(size), '-h', str(size), '-f', 'png'],
        input=svg_text.encode('utf-8'), capture_output=True, check=True
    ).stdout
    return Image.open(io.BytesIO(png)).convert('RGBA')


def main() -> int:
    # Проверка: build/logo.svg должен совпадать с тем, что рисует этот скрипт,
    # иначе иконки разойдутся с логотипом в интерфейсе и README.
    for token in ('M 80 84 L 144 128 L 80 172', 'M 162 172 H 192', BG, FG):
        if token not in SRC:
            print(f'build/logo.svg изменён ({token!r} не найден) — обновите parts() в этом скрипте', file=sys.stderr)
            return 1

    full = svg(tile())
    # На 16–32 px линия 14/256 тоньше пикселя — для мелких размеров линии толще.
    bold = svg(tile(stroke=22, radius=20))

    render(full, 1024).save(BUILD / 'icon.png', optimize=True)

    # macOS: знак 824×824 по центру прозрачного холста 1024×1024 (сетка значков Big Sur и новее).
    scale = 824 / 256
    render(svg(f'<g transform="translate(100 100) scale({scale})">{tile()}</g>', '0 0 1024 1024'), 1024).save(
        BUILD / 'icon-mac.png', optimize=True
    )

    sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    frames = [render(bold if s <= 32 else full, s) for s in sizes]
    frames[-1].save(BUILD / 'icon.ico', format='ICO', sizes=[(s, s) for s in sizes], append_images=frames[:-1])

    render(bold, 16).save(BUILD / 'tray.png', optimize=True)
    render(bold, 32).save(BUILD / 'tray@2x.png', optimize=True)

    # Строка меню macOS: только силуэт знака, чёрный с прозрачностью; квадрат вокруг знака.
    glyph = svg(parts(stroke=18, radius=19, color='#000'), '54 51 156 156')
    render(glyph, 18).save(BUILD / 'trayTemplate.png', optimize=True)
    render(glyph, 36).save(BUILD / 'trayTemplate@2x.png', optimize=True)

    for f in ('icon.png', 'icon-mac.png', 'icon.ico', 'tray.png', 'tray@2x.png', 'trayTemplate.png', 'trayTemplate@2x.png'):
        print(f'build/{f}  {(BUILD / f).stat().st_size} байт')
    return 0


if __name__ == '__main__':
    sys.exit(main())
