from pathlib import Path


HELP_TEXT = """User Guide: Mapping Manager V3.1 (Python Desktop Version)

1. Loading / Creating Configuration Files
After launching the program, use the top bar:
- “Load setup”: Open an existing .json configuration file (ROOD, RECS, Lightning, or your own).
- “New setup”: Create a brand-new .json file and start editing from an empty tree.
Tip: After opening or creating a file, you can use “Save as” to save another copy under a new name.

2. Interface Overview
The main interface is divided into four parts:

(1) Left Panel — Node List
Displays the hierarchy of Regions, Subgroups, and Enemies for the selected map type.
Each row shows: Name, Snipe?, Need?, Done?, and Price.
The “Snipe?” and “Need?” columns are clickable — clicking toggles whether the node is included and whether it requires Snipe for this run.

(2) Top Panel — Controls
Contains the main control buttons:
- “User Guide”: Open this help window.
- “Load setup”: Load an existing configuration file.
- “New setup”: Create a new .json and begin editing.
- “Save as”: Save the current setup under a new file name.
- “Reset this run”: Set all “Completed” flags to unchecked.
- “Undo” / “Redo”: Step through your edit history.
- “Generate market message and copy”: Regenerate the Snipe list and copy it (up to the first 10 lines) to the clipboard.
- “Save current setup”: Save the current edits to the current file.
You can also open “Important Message Settings” to edit: the LF message, the right-click search prefix, the number of words copied on right-click, and the thank-you text.

(3) Left of Right Pane — Todo List
Shows all self-completion (non-Snipe) targets that are required and not completed.
- Double-click an entry to mark it completed. The app auto-saves and updates totals.

(4) Right of Right Pane — Generated Market Message
Displays all uncompleted targets that require Snipe.
- Single-click: show details tooltip and highlight the node in the tree.
- Double-click: mark as completed and auto-save.
- Right-click (or Ctrl-Click/Middle-Click) on an item: copy “Search prefix + first N words of display name/override message” to clipboard, where N is set in Important User Settings.
Buttons under the list:
- “Copy”: Copy the generated message (up to the first 10 lines) to the clipboard.
- “Increase” / “Decrease”: Adjust prices of all uncompleted Snipe targets in batch (step depends on current price range). Changes auto-save.

All changes, completions, and price adjustments trigger automatic saving where applicable.

3. Generating Market Messages
Click “Generate market message and copy” on the top bar, or use the “Copy” button under the message list.
The list is based on current node states (required, not completed, requires Snipe) and sorted by price (desc) then name (asc).

4. Editing Node Properties
Select any node on the left; its details appear in the “Edit selected” area on the right.
- Name: Node name
- Override message: Optional, custom display name used in the market message
- Need / Completed / Requires Snipe: Three checkboxes controlling inclusion, completion, and Snipe status
- Price: Numeric value, adjustable manually or via “+ / −”
- Side notes: Optional remarks

Click “Apply changes to selected” to save edits to the node.
The program auto-saves after each modification, completion, or price adjustment.

5. Editing the Tree Structure
Use the toolbar above the left tree:
- “+ Region”: Add a new Region
- “+ Subgroup”: Add a Subgroup under the selected Region or Subgroup
- “+ Enemy”: Add a new Enemy under the selected node (or as a sibling to the selected Enemy)
- “Delete selected”: Delete the selected node and all its children
- “Open all tabs” / “Close all tabs”: Expand/Collapse the entire tree

6. Summary
Mapping Manager V3.1 is a tool for managing, editing, and generating Sniper market lists.
It supports batch price adjustments, quick completion marking, auto-saving, and flexible node-tree editing.
By loading built-in ROOD/RECS/Lightning configurations — or creating a new setup — you can immediately start organizing and generating market messages without manual data work.

7. Importing in-game map data
Use the “Import ingame map” button after copying goals from the game. In the MouseHunt browser client, open Active Maps → Goals, drag-select starting from the first letter of “Missing …” and scroll until the last mouse name. Copy that selection, paste it into the importer, and follow the confirmation steps.

Version 3.1 — Interface Gu
Not for commercial use. Redistribution must credit the author.
"""

APP_TITLE = "MH Mapping Manager 3.1"
__version__ = "3.1"
__author__ = "InterfaceGu"

PRICE_STEP = 5
THANKYOU_TEXT = "Invited and paid, Thank you!"
DEFAULT_SEARCH_PREFIX = "in:\n map-snipers"

CONFIG_HOME = Path.home() / ".mapping_manager"
LAST_FILE_RECENT = CONFIG_HOME / "last_file.json"
