from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "android" / "owncash-icon-master.png"
RES = ROOT / "android" / "app" / "src" / "main" / "res"
BACKGROUND = (2, 10, 21, 255)

ICON_SIZES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}

FOREGROUND_SIZES = {
    "mdpi": 108,
    "hdpi": 162,
    "xhdpi": 216,
    "xxhdpi": 324,
    "xxxhdpi": 432,
}


def resized(source: Image.Image, size: int) -> Image.Image:
    return source.resize((size, size), Image.Resampling.LANCZOS)


def round_icon(source: Image.Image, size: int) -> Image.Image:
    icon = resized(source, size)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    icon.putalpha(mask)
    return icon


def splash(source: Image.Image, width: int, height: int) -> Image.Image:
    canvas = Image.new("RGBA", (width, height), BACKGROUND)
    icon_size = int(min(width * 0.36, height * 0.58))
    icon = resized(source, icon_size)
    position = ((width - icon_size) // 2, (height - icon_size) // 2)
    canvas.alpha_composite(icon, position)
    return canvas


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")

    for density, size in ICON_SIZES.items():
        directory = RES / f"mipmap-{density}"
        resized(source, size).save(directory / "ic_launcher.png", optimize=True)
        round_icon(source, size).save(directory / "ic_launcher_round.png", optimize=True)

    for density, size in FOREGROUND_SIZES.items():
        directory = RES / f"mipmap-{density}"
        resized(source, size).save(directory / "ic_launcher_foreground.png", optimize=True)

    for path in RES.glob("drawable-*/splash.png"):
        with Image.open(path) as existing:
            width, height = existing.size
        splash(source, width, height).save(path, optimize=True)

    base_splash = RES / "drawable" / "splash.png"
    with Image.open(base_splash) as existing:
        width, height = existing.size
    splash(source, width, height).save(base_splash, optimize=True)

    print("OwnCash Android-Icons und Splashscreens wurden erzeugt.")


if __name__ == "__main__":
    main()
