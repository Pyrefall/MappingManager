
> **Author’s Note**
>
> This tool started as a personal utility to speed up my own Mapping. Out of a bit of show-and-tell and an open-source spirit, I’m sharing it with fellow players.
>
> When used correctly, it can import dozens of targets in one click, set their states, auto-generate LF messages, help you search the latest prices, and run simple stats. For simpler maps (e.g., **ROOD**), it typically saves about **30–60 minutes** per run. For very complex maps (e.g., **M1K**), it saves your brain cells so you can enjoy the planning.
>
> I haven’t written JavaScript in years and had zero experience with Chrome userscripts/extensions. The browser userscript was auto-generated with **Codex** and then iteratively refined with small tweaks.
>
> Below are the installation and usage instructions. If you’d rather not set things up and are okay trusting my build, download the **prebuilt package** from the **Releases** sidebar.
>
> I hope this helps. The project hasn’t been stress-tested; bugs are likely. If you find one, please open an issue—thanks!

---

# MH Mapping Manager 3.3.0

Mapping Manager is a Tkinter desktop assistant (with a companion Tampermonkey userscript) for coordinating MouseHunt map runs. It helps you manage region/subgroup/enemy hierarchies, generate market messages, and track progress locally on your computer. This tool does not upload user data; all processing is local.

## Features

- Desktop GUI for editing map trees, prices, and completion state
- Generated market message list with configurable right-click copy word count
- Sample JSON setups(4 Largest map: M1k, RECS, Lightning, ROOD) in `CompletedUsableJsonMapFiles/` for quick starts 
- Tampermonkey userscript (`WebExtension.js`) that mirrors the workflow in-browser
- Centralized “Important User Settings” dialog covering LF message, search prefix, thank-you list, message formats, rounding, and sounds
- Optional sound cues with adjustable volume for key actions
- Auto-rounding for copied prices so market messages stay in 5 SB increments
- Import helper that parses in-game “Missing / Found” text
- Undo/redo history plus batch price adjustments

## Installation

```bash
git clone https://github.com/Pyrefall/MappingManager.git
cd MappingManager
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Usage

```bash
python MappingManager.py
```

- The app attempts to load your most recent setup (stored under `~/.mapping_manager/last_file.json`).
- Click **Important User Settings** to configure the LF intro, right-click search prefix, word count copied on right-click, thank-you text, market message formats, whether prices auto-round when copied, and interface sound/volume preferences.
- Use the **User Guide** button inside the app for detailed, built-in documentation.

### Working with Sample Maps

Ready-to-use `.json` files live in `CompletedUsableJsonMapFiles/`. Load one via **Load setup** to explore a preset configuration or duplicate it for a new run.

## Packaging a Windows `.exe`

1. (Optional) activate your virtual environment.
2. Install PyInstaller:
   ```bash
   pip install pyinstaller
   ```
3. Build using the provided spec:
   ```bash
   pyinstaller MappingManager.spec
   ```
4. The executable and assets will appear in `dist/MappingManager/`.

## Chrome/Tampermonkey Userscript

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Chrome.
2. In Tampermonkey, create a new script (or import an existing one).
3. Paste the contents of `WebExtension.js`.
4. Save and enable the script. The overlay activates on `https://www.mousehuntgame.com/`.

## Versioning

The desktop application version is tracked in `mapping_manager/constants.py` (`__version__ = "3.3"`). Tagged GitHub releases should follow `v3.3.0`, `v3.3.1`, etc., matching the app’s semantic version.

## Project Health & Policies

- Refer to the [LICENSE](LICENSE) (MIT) before reusing or distributing the code.
- Report security concerns via the process described in [SECURITY.md](SECURITY.md).
- Contributors are expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

---

Need help in-app? Click **User Guide** on the toolbar for the complete reference.
