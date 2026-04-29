from pathlib import Path


HELP_TEXT = """User Guide: Mapping Manager V4.0 (Python Desktop Version)

1. Loading and creating configuration files
After launching the program, use the top bar:
- "Load setup": Open an existing .json configuration file.
- "New setup": Create a brand-new .json file and start editing from an empty tree.
- "Save as": Save another copy under a new name.

2. Importing in-game map data
Use "Import ingame status" after copying goals from the game. Open Active Maps -> Goals, copy the Missing / Found text from the MouseHunt client, paste it into the importer, and confirm the preview to sync Need and Completed flags.

3. Interface overview
The main interface is divided into four parts:

(1) Left panel - Node List
Displays Regions, Subgroups, and Enemies.
Each row shows: Name, Snipe, Need, Done, Price, and Type.
- Price displays as blank when its stored value is 0.
- Snipe and Need columns can be toggled quickly.
- Optional setting: hide Enemy rows with Need=false while keeping Region and Subgroup rows visible.

(2) Top panel - Controls
Contains the main control buttons:
- "Important User Settings": Open the settings window.
- "User Guide": Open this help window.
- "Load setup" / "New setup" / "Save as" / "Save current setup"
- "Reset this run"
- "Undo" / "Redo"
- "Generate market message and copy"

(3) Todo List
Shows all self-completion targets that are Need=true, Completed=false, Requires Snipe=false, and Price>0.
- Double-click an entry to mark it completed.
- Optional setting: append Subgroup / Region path after each entry name.

(4) Generated Market Message
Shows all active snipe targets.
- Single-click: show details tooltip and highlight the node in the tree.
- Double-click: mark as completed and auto-save.
- Right-click / Ctrl-click / Middle-click: copy search text using the configured prefix.
- Copy: copy the current generated message.
- Increase / Decrease: batch-adjust prices for active snipe targets.

4. Important User Settings
The settings window can now manage:
- LF message
- Right-click search prefix
- Right-click copied word count
- Thank-you messages
- Market message formats
- Sound effects and volume
- Auto-round copied prices
- Randomly copy if market message is too long
- Show SubGroup in TodoList
- Sort By Region instead
- Hide Need=false enemies in left tree

5. Sorting and display behavior
- Default sorting for generated market entries and Todo items is price descending, then name ascending.
- If "Sort By Region instead" is enabled, sorting becomes Region -> Subgroup -> deeper subgroup -> Name -> Price.
- Left tree visibility filtering only hides Enemy rows with Need=false; Region and Subgroup remain visible.

6. Batch price rules
Applies only to Need=true, Requires Snipe=true, Completed=false:
- Increase: Price>=100 -> +5; 50<Price<100 -> +3; 5<Price<50 -> +2
- Decrease: Price>=100 -> -5; 50<Price<100 -> -3; 5<Price<50 -> -2

7. Current release notes
- Python and web versions now share the same price-step logic and region-first sorting option.
- Price 0 is hidden visually in the left tree.
- The left tree can hide Need=false Enemy rows by setting.
- The latest release includes the updated FFGT map configuration file.

Version 4.0 - Interface Gu
Not for commercial use. Redistribution must credit the author.
"""

APP_TITLE = "MH Mapping Manager 4.0"
__version__ = "4.0"
__author__ = "InterfaceGu"

PRICE_STEP = 5
THANKYOU_TEXT = "Invited and paid, Thank you!"
DEFAULT_THANKYOU_MESSAGES = [THANKYOU_TEXT]
DEFAULT_MESSAGE_FORMATS = [
    "<name>: <price>",
    "<name> <price>",
    "<name> - <price>",
]
DEFAULT_SEARCH_PREFIX = "in:\n map-snipers"

CONFIG_HOME = Path.home() / ".mapping_manager"
LAST_FILE_RECENT = CONFIG_HOME / "last_file.json"

