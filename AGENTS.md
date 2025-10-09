# Repository Guidelines

## Project Structure & Module Organization
The GUI application lives in `MappingManager.py`, which bundles Tkinter windows, state helpers, and JSON persistence utilities. Use `main.py` only for quick sanity runs; production logic should remain inside `MappingManagerApp`. Runtime data such as `last_file.json` is persisted under `~/.mapping_manager`. Keep virtual environments (`venv/`) untracked and create new modules under the root or a future `mapping_manager/` package to maintain clarity.

## Build, Test, and Development Commands
- `python MappingManager.py`: Launch the desktop client with live reload of the JSON workspace.
- `python -m venv .venv && source .venv/bin/activate`: Create and activate an isolated interpreter before installing optional extras.
- `python main.py`: Run the stub script used by PyCharm scaffolding; keep it compiling even if unused in production.

## Coding Style & Naming Conventions
Follow standard Python style: 4-space indents, snake_case for functions and variables, PascalCase for classes. Preserve type hints already present and add them to new public helpers. Use multi-line docstrings for user-facing utilities, and prefer `Path` over plain strings for filesystem paths. Tkinter widgets should be prefixed with `var_`, `btn_`, or `list_` to match existing control naming.

## Testing Guidelines
Automated tests are not yet present; add `pytest` suites under `tests/` when contributing non-trivial logic (e.g., JSON helpers or pricing utilities). Name files `test_<feature>.py` and structure tests around pure functions to keep them independent from the GUI loop. When touching UI behaviours, encapsulate logic in helper functions so they can be unit tested without spinning up Tk. Confirm manual smoke tests by loading a sample configuration and exercising undo/redo, generation, and persistence flows.

## Commit & Pull Request Guidelines
Write commits in the imperative mood (e.g., “Add batch price adjustment validation”), bundling logically related changes only. Reference issue IDs in the subject when applicable. Pull requests should include: a brief summary of the feature or fix, screenshots or GIFs for UI-affecting work (showing before/after when possible), manual test notes, and any configuration files required to reproduce the scenario. Flag breaking changes in the description and call out follow-up tasks explicitly so reviewers can plan next steps.

## Configuration Tips
Configuration files use UTF-8 encoded JSON. The helper directory `~/.mapping_manager` is created at startup; avoid committing anything from it. When sharing presets, place them under `resources/` (create if absent) and document their purpose plainly so new agents understand the expected map hierarchy.
