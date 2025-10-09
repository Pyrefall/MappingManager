# MH Mapping Manager 3.1.0

Mapping Manager is a Tkinter desktop assistant (with a companion Tampermonkey userscript) for coordinating MouseHunt map runs. It helps you manage region/subgroup/enemy hierarchies, generate market messages, and track progress locally on your computer. This tool does not upload user data; all processing is local.

## Features

- Desktop GUI for editing map trees, prices, and completion state
- Undo/redo history plus batch price adjustments
- Generated market message list with configurable right-click copy word count
- Import helper that parses in-game “Missing / Found” text
- Tampermonkey userscript (`WebExtension.js`) that mirrors the workflow in-browser
- Sample JSON setups in `CompletedUsableJsonMapFiles/` for quick starts

## Installation

```bash
git clone https://github.com/<your-org>/MappingManager.git
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
- Click **Important User Settings** to configure the LF intro, right-click search prefix, word count copied on right-click, and thank-you text.
- Use the **User Guide** button inside the app for detailed, built-in documentation.

### Working with Sample Maps

Ready-to-use `.json` files live in `CompletedUsableJsonMapFiles/`. Load one via **Load setup** to explore a preset configuration or duplicate it for a new run.

## Testing

Automated tests are not yet provided. For now, rely on manual smoke checks:

1. Load a sample configuration.
2. Exercise tree editing, undo/redo, and batch pricing.
3. Generate and copy a market message.
4. Verify persistence by reopening the saved file.

When contributing new pure-logic helpers, add `pytest` suites under `tests/` so future automation can run `pytest`.

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

The desktop application version is tracked in `mapping_manager/constants.py` (`__version__ = "3.1"`). Tagged GitHub releases should follow `v3.1.0`, `v3.1.1`, etc., matching the app’s semantic version.

## Project Health & Policies

- Refer to the [LICENSE](LICENSE) (MIT) before reusing or distributing the code.
- Report security concerns via the process described in [SECURITY.md](SECURITY.md).
- Contributors are expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

---

Need help in-app? Click **User Guide** on the toolbar for the complete reference.
