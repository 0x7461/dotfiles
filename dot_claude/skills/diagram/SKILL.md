---
name: diagram
description: Render ASCII diagrams from Mermaid syntax using mermaid-ascii. Use this when a visual diagram would help explain architecture, data flow, pipelines, or relationships.
disable-model-invocation: false
user-invocable: true
allowed-tools:
  - Bash
argument-hint: "[description of what to diagram]"
---

Render a diagram using `mermaid-ascii` to visualize architecture, flows, or relationships.

## How to use

Write valid Mermaid syntax and pipe it to `mermaid-ascii`:

```bash
echo 'graph LR
    A[Component] --> B[Component]' | mermaid-ascii
```

## Supported diagram types

- **Flowcharts**: `graph LR` (left-right) or `graph TD` (top-down)
- **Sequence diagrams**: `sequenceDiagram` with participants and messages

## Tips

- Keep diagrams simple — 5-10 nodes max for readability in terminal
- Use `graph LR` for pipelines/flows, `graph TD` for hierarchies
- Node syntax: `A[Label]` for boxes, `A((Label))` for circles, `A{Label}` for diamonds
- Edge syntax: `-->` arrow, `---` line, `-->|label|` labeled arrow
- If the user invokes `/diagram`, use $ARGUMENTS as the description of what to diagram
