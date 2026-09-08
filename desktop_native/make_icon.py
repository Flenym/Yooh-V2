from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE_PNG = ROOT / "src" / "client" / "icons" / "icon-192.png"
ASSETS_DIR = ROOT / "desktop_native" / "assets"
OUTPUT_ICO = ASSETS_DIR / "yooh.ico"


def make_fallback() -> Image.Image:
    image = Image.new("RGBA", (256, 256), (24, 110, 210, 255))
    draw = ImageDraw.Draw(image)
    draw.ellipse((16, 16, 240, 240), fill=(67, 156, 246, 255))
    draw.text((102, 74), "Y", fill=(255, 255, 255, 255))
    return image


def main() -> None:
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    if SOURCE_PNG.exists():
        image = Image.open(SOURCE_PNG).convert("RGBA")
    else:
        image = make_fallback()
    image.save(OUTPUT_ICO, format="ICO", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    print(f"Icon generated: {OUTPUT_ICO}")


if __name__ == "__main__":
    main()
