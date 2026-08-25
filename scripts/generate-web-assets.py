from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "android" / "owncash-icon-master.png"
OUTPUT = ROOT / "assets" / "icons"

ICON_SIZES = {
    "favicon-32.png": 32,
    "owncash-192.png": 192,
    "apple-touch-icon.png": 180,
    "owncash-512.png": 512,
}


def maskable_icon(source: Image.Image, size: int) -> Image.Image:
    canvas = Image.new("RGB", (size, size), (2, 10, 21))
    safe_size = round(size * 0.8)
    icon = source.resize((safe_size, safe_size), Image.Resampling.LANCZOS)
    offset = (size - safe_size) // 2
    canvas.paste(icon, (offset, offset))
    return canvas


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE).convert("RGB")
    for filename, size in ICON_SIZES.items():
        source.resize((size, size), Image.Resampling.LANCZOS).save(
            OUTPUT / filename,
            format="PNG",
            optimize=True,
        )
    maskable_icon(source, 512).save(
        OUTPUT / "owncash-maskable-512.png",
        format="PNG",
        optimize=True,
    )
    print("OwnCash Web-, PWA- und Apple-Touch-Icons wurden erzeugt.")


if __name__ == "__main__":
    main()
