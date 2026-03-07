---
name: hypr-debug
description: Dump Hyprland state for debugging — windows, workspaces, monitors, keybinds, and active window. Use when diagnosing Hyprland window rules, keybinds, or layout issues.
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

Collect and display Hyprland state for debugging. Useful when diagnosing:
- Window rules not applying
- Keybind conflicts or missing binds
- Window class/title matching issues
- Multi-monitor layout problems
- Floating vs tiling behavior

Usage:
- `/hypr-debug` — full state dump
- `/hypr-debug windows` — active windows only
- `/hypr-debug binds` — keybindings only
- `/hypr-debug active` — active window only (for window rule debugging)

## State to collect

### Active window (always show)
```sh
hyprctl activewindow
```

Key fields: `class`, `title`, `floating`, `workspace`, `tags`

### Windows (all)
```sh
hyprctl clients -j | jq '.[] | {class, title, workspace: .workspace.name, floating, tags, pid}'
```

### Workspaces
```sh
hyprctl workspaces -j | jq '.[] | {id, name, monitor, windows}'
```

### Monitors
```sh
hyprctl monitors -j | jq '.[] | {name, width, height, scale, focused}'
```

### Keybindings
```sh
hyprctl binds -j | jq '.[] | {mod: .modmask, key, dispatcher, arg}'
```

### Hyprland version + config errors
```sh
hyprctl version
hyprctl getoption general:gaps_in  # quick sanity check config is loaded
```

## Analysis

After collecting state, help the user understand what they're seeing:

- **Window rule matching:** Look at `class` and `title` of the window, compare to window rules in `~/.config/hypr/hyprland.conf` (use Read tool)
- **Keybind conflicts:** Check if two binds share the same mod+key
- **Tags:** Window tags affect rule matching — show which tags are active
- **Floating dialogs:** Extension popups (class `firefox`, title matching `Extension:`) do NOT appear as separate Hyprland windows — they're child popups within the browser process

## Notes

- Config location: `~/.config/hypr/hyprland.conf`
- Window rules use `class:^(regex)$` and `title:^(regex)$` syntax
- `hyprctl reload` applies config changes without restart
- Tags are set via window rules: `windowrule = tag +tagname, class:^...`
