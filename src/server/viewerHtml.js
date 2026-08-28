function stringifyInlineScriptValue(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026');
}

function buildViewerHtml(viewerConfig) {
  const serializedViewerConfig = stringifyInlineScriptValue(viewerConfig);
  return `<!doctype html>
<html lang="en" data-theme="light">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, viewport-fit=cover"
    />
    <script>
      try {
        const storedTheme = localStorage.getItem('3dtiles-inspector-theme');
        if (storedTheme === 'dark' || storedTheme === 'light') {
          document.documentElement.dataset.theme = storedTheme;
        }
      } catch {}
    </script>
    <title>3D Tiles Inspector</title>
    <style>
      :root {
        --theme-accent: #f1f1f1;
        --theme-accent-contrast: #242424;
        --theme-focus-ring: rgba(255, 255, 255, 0.72);
        --radius-sm: 10px;
        --radius-md: 16px;
        --radius-lg: 20px;
        --radius-pill: 999px;
        color-scheme: dark;
        font-family: "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif;
      }

      :root[data-theme='light'] {
        --theme-accent: #333333;
        --theme-accent-contrast: #ffffff;
        --theme-focus-ring: rgba(37, 37, 37, 0.5);
        accent-color: var(--theme-accent);
        color-scheme: light;
      }

      * {
        box-sizing: border-box;
      }

      [hidden] {
        display: none !important;
      }

      body {
        margin: 0;
        overflow: hidden;
        background:
          radial-gradient(circle at top, rgba(248, 248, 248, 0.96), rgba(235, 235, 235, 0.92)),
          linear-gradient(180deg, #eeeeee 0%, #dddddd 100%);
        color: #252525;
      }

      #app {
        position: fixed;
        inset: 0;
      }

      .runtime-stats {
        position: fixed;
        top: 16px;
        right: 16px;
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 10px;
        max-width: min(420px, calc(100vw - 32px));
        z-index: 12;
        pointer-events: none;
      }

      .tile-runtime-stats {
        position: fixed;
        right: 16px;
        bottom: 16px;
        display: flex;
        flex-wrap: nowrap;
        justify-content: flex-end;
        gap: 14px;
        box-sizing: border-box;
        max-width: calc(100vw - 32px);
        padding: 4px 8px;
        border-radius: var(--radius-sm);
        background: rgba(255, 255, 255, 0.18);
        backdrop-filter: blur(6px);
        z-index: 12;
        pointer-events: none;
      }

      .runtime-stat {
        display: grid;
        gap: 4px;
        min-width: 132px;
        padding: 8px 12px;
        border: 1px solid rgba(37, 37, 37, 0.1);
        border-radius: var(--radius-md);
        background: rgba(255, 255, 255, 0.88);
        box-shadow: 0 14px 32px rgba(0, 0, 0, 0.12);
        backdrop-filter: blur(14px);
      }

      .fps-runtime-stat {
        min-width: 72px;
      }

      .cache-bytes-runtime-stat {
        min-width: 108px;
      }

      .tile-runtime-stats .runtime-stat {
        display: inline-flex;
        align-items: center;
        gap: 0;
        min-width: 0;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
        backdrop-filter: none;
      }

      .runtime-stat-label {
        margin: 0;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #686868;
      }

      .tile-runtime-stats .runtime-stat-label,
      .tile-runtime-stats .runtime-stat-value {
        display: inline-flex;
        align-items: center;
        font-size: 12px;
        font-weight: 400;
        letter-spacing: 0;
        line-height: 14px;
        text-transform: none;
        color: #2b2b2b;
      }

      .runtime-stat-value {
        margin: 0;
        font-size: 15px;
        font-weight: 700;
        line-height: 1.1;
        color: #252525;
      }

      .tile-runtime-stats .runtime-stat-value {
        font-variant-numeric: tabular-nums;
      }

      canvas {
        display: block;
      }

      .screen-selection-overlay {
        position: fixed;
        inset: 0;
        z-index: 9;
        pointer-events: none;
      }

      .screen-selection-rect {
        position: absolute;
        border: 1px solid #ffcf33;
        background: rgba(255, 207, 51, 0.06);
        box-shadow:
          0 8px 24px rgba(120, 82, 0, 0.12);
      }

      .screen-selection-rect.editable {
        border: 0;
        background: transparent;
        box-shadow: none;
      }

      .screen-selection-edit-svg {
        position: absolute;
        inset: 0;
        display: none;
        overflow: visible;
      }

      .screen-selection-rect.editable .screen-selection-edit-svg {
        display: block;
      }

      .screen-selection-edit-polygon {
        fill: rgba(255, 207, 51, 0.06);
        stroke: #ffcf33;
        stroke-width: 2;
        vector-effect: non-scaling-stroke;
        filter: drop-shadow(0 8px 12px rgba(120, 82, 0, 0.12));
      }

      .screen-selection-rect.editable.drawing .screen-selection-edit-polygon {
        fill: rgba(255, 207, 51, 0.2);
      }

      .screen-selection-edit-grid line {
        stroke: rgba(255, 255, 255, 0.72);
        stroke-width: 0.6;
        vector-effect: non-scaling-stroke;
      }

      .screen-selection-edit-handle {
        position: absolute;
        display: none;
        pointer-events: none;
        transform: translate(-50%, -50%);
        transform-origin: center;
      }

      .screen-selection-edit-handle::before {
        content: "";
        position: absolute;
        inset: 0;
        display: block;
        box-sizing: border-box;
        transform-origin: center;
        scale: 1;
        transition: scale 80ms ease;
      }

      .screen-selection-rect.editable .screen-selection-edit-handle {
        display: block;
      }

      .screen-selection-edit-top-left,
      .screen-selection-edit-top-right,
      .screen-selection-edit-bottom-right,
      .screen-selection-edit-bottom-left {
        width: 10px;
        height: 10px;
      }

      .screen-selection-edit-top-left::before,
      .screen-selection-edit-top-right::before,
      .screen-selection-edit-bottom-right::before,
      .screen-selection-edit-bottom-left::before {
        border: 2px solid #ffffff;
        border-radius: 50%;
        background: #ffcf33;
        box-shadow: 0 2px 8px rgba(120, 82, 0, 0.28);
      }

      .screen-selection-edit-top-left.active::before,
      .screen-selection-edit-top-right.active::before,
      .screen-selection-edit-bottom-right.active::before,
      .screen-selection-edit-bottom-left.active::before {
        scale: 1.5;
      }

      .screen-selection-edit-top,
      .screen-selection-edit-right,
      .screen-selection-edit-bottom,
      .screen-selection-edit-left {
        width: 26px;
        height: 4px;
      }

      .screen-selection-edit-top::before,
      .screen-selection-edit-right::before,
      .screen-selection-edit-bottom::before,
      .screen-selection-edit-left::before {
        border-radius: 999px;
        background: #ffffff;
        box-shadow: 0 1px 6px rgba(120, 82, 0, 0.24);
      }

      .screen-selection-edit-top.active::before,
      .screen-selection-edit-right.active::before,
      .screen-selection-edit-bottom.active::before,
      .screen-selection-edit-left.active::before {
        scale:
          var(--screen-selection-edit-active-scale-x, 1.28)
          var(--screen-selection-edit-active-scale-y, 1.5);
      }

      .toolbar-dock {
        position: fixed;
        top: 14px;
        bottom: 14px;
        left: 14px;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        align-items: stretch;
        gap: 0;
        width: min(280px, calc(100vw - 28px));
        z-index: 10;
      }

      .toolbar {
        display: grid;
        grid-template-rows: minmax(0, 1fr) auto;
        gap: 0;
        padding: 10px 14px;
        border: 1px solid rgba(75, 75, 75, 0.16);
        border-top: 0;
        border-radius: 0 0 var(--radius-lg) var(--radius-lg);
        background: rgba(255, 255, 255, 0.9);
        box-shadow: 0 18px 44px rgba(0, 0, 0, 0.16);
        backdrop-filter: blur(14px);
        min-height: 0;
        overflow: hidden;
        transition:
          opacity 160ms ease,
          transform 160ms ease;
      }

      .toolbar.hidden {
        display: none;
      }

      .toolbar-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        min-height: 32px;
        padding: 8px 12px;
        border: 1px solid rgba(37, 37, 37, 0.08);
        border-radius: var(--radius-lg) var(--radius-lg) 0 0;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.02em;
        color: #252525;
        background: rgba(255, 255, 255, 0.9);
        box-shadow: 0 18px 44px rgba(0, 0, 0, 0.16);
        cursor: pointer;
        backdrop-filter: blur(14px);
        transition:
          background-color 120ms ease,
          color 120ms ease,
          box-shadow 120ms ease;
      }

      .toolbar-dock.collapsed .toolbar-toggle {
        justify-self: start;
        width: auto;
        min-height: 32px;
        padding: 4px 12px 5px;
        border-radius: var(--radius-pill);
        color: #5f5f5f;
        background: rgba(255, 255, 255, 0.94);
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
      }

      .toolbar-toggle:hover {
        color: #252525;
        background: rgba(225, 225, 225, 0.98);
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.18);
      }

      .toolbar-dock.collapsed .toolbar-toggle:hover {
        background: rgba(240, 240, 240, 0.98);
        box-shadow: 0 10px 22px rgba(0, 0, 0, 0.1);
      }

      .toolbar-toggle:focus-visible {
        outline: 2px solid var(--theme-focus-ring);
        outline-offset: 2px;
      }

      .toolbar-section {
        display: grid;
        gap: 10px;
        padding: 10px 12px;
        border: 1px solid rgba(37, 37, 37, 0.08);
        border-radius: var(--radius-md);
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.78), rgba(245, 245, 245, 0.9));
      }

      .toolbar-scroll {
        --toolbar-scrollbar-gutter: 0px;
        display: grid;
        align-content: start;
        gap: 8px;
        min-height: 0;
        margin-right: -7px;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding-right: 7px;
        padding-bottom: 8px;
        scrollbar-color: rgba(100, 100, 100, 0.45) transparent;
        scrollbar-gutter: stable;
        scrollbar-width: thin;
      }

      .toolbar-scroll > .toolbar-section {
        margin-right: calc(0px - var(--toolbar-scrollbar-gutter));
      }

      .toolbar-scroll::-webkit-scrollbar {
        width: 3px;
      }

      .toolbar-scroll::-webkit-scrollbar-track {
        background: transparent;
      }

      .toolbar-scroll::-webkit-scrollbar-thumb {
        border-radius: 999px;
        background: rgba(100, 100, 100, 0.32);
      }

      .toolbar-scroll::-webkit-scrollbar-thumb:hover {
        background: rgba(100, 100, 100, 0.48);
      }

      .toolbar-section-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }

      .toolbar-section-title {
        margin: 0;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #686868;
      }

      .toolbar-value {
        margin: 0;
        font-size: 12px;
        font-weight: 700;
        color: #686868;
      }

      .button-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .transform-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .transform-actions button {
        width: 100%;
      }

      .transform-actions .full-span {
        grid-column: 1 / -1;
      }

      .toolbar button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: var(--radius-pill);
        padding: 7px 14px;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #252525;
        background: #efefef;
        cursor: pointer;
        transition:
          transform 120ms ease,
          background-color 120ms ease,
          color 120ms ease;
      }

      .toolbar button:hover {
        transform: translateY(-1px);
        background: #e5e5e5;
      }

      .toolbar button.active {
        color: var(--theme-accent-contrast);
        background: var(--theme-accent);
      }

      .toolbar button.save {
        color: var(--theme-accent-contrast);
        background: var(--theme-accent);
      }

      .toolbar button:disabled {
        transform: none;
        opacity: 0.7;
        cursor: not-allowed;
      }

      .toolbar-dock.saving .screen-region {
        opacity: 0.7;
        cursor: not-allowed;
        pointer-events: none;
      }

      .range-field {
        display: grid;
        gap: 4px;
        min-width: 0;
      }

      .range-field-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-width: 0;
      }

      .range-field span {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #686868;
      }

      .range-field input[type='range'] {
        width: 100%;
        margin: 0;
      }

      .scale-value-input {
        width: 82px;
        min-width: 0;
        padding: 4px 7px;
        border: 1px solid rgba(37, 37, 37, 0.16);
        border-radius: var(--radius-sm);
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        text-align: right;
        color: #252525;
        background: rgba(255, 255, 255, 0.92);
      }

      .scale-track {
        --scale-track-offset: 0px;
        position: relative;
        width: 100%;
        height: 22px;
        overflow: hidden;
        border: 1px solid rgba(37, 37, 37, 0.12);
        border-radius: var(--radius-sm);
        padding: 0;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.84), rgba(234, 234, 234, 0.92)),
          #ededed;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.78),
          inset 0 -1px 0 rgba(75, 75, 75, 0.08);
        cursor: ew-resize;
        touch-action: none;
      }

      .scale-track::before {
        content: "";
        position: absolute;
        top: 50%;
        right: 8px;
        left: 8px;
        height: 4px;
        border-radius: 999px;
        background:
          linear-gradient(
            90deg,
            rgba(75, 75, 75, 0.08),
            rgba(75, 75, 75, 0.42) 50%,
            rgba(75, 75, 75, 0.08)
          );
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.56);
        transform: translateY(-50%);
      }

      .scale-track::after {
        content: "";
        position: absolute;
        inset: 5px 8px 5px;
        background-image:
          linear-gradient(
            90deg,
            rgba(75, 75, 75, 0.46) 0 1px,
            transparent 1px 100%
          ),
          linear-gradient(
            90deg,
            rgba(75, 75, 75, 0.26) 0 1px,
            transparent 1px 100%
          );
        background-repeat: repeat-x;
        background-size:
          20px 12px,
          20px 7px;
        background-position:
          calc(50% + var(--scale-track-offset) - 1px) -1px,
          calc(50% + var(--scale-track-offset) + 10px) 2px;
        opacity: 0.72;
        pointer-events: none;
      }

      .scale-track-center {
        position: absolute;
        top: 3px;
        bottom: 3px;
        left: 50%;
        width: 2px;
        border-radius: 999px;
        background: rgba(75, 75, 75, 0.72);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.72);
        transform: translateX(-50%);
        pointer-events: none;
      }

      .scale-track:hover::before,
      .scale-track:focus-visible::before,
      .scale-track.dragging::before {
        background:
          linear-gradient(
            90deg,
            rgba(75, 75, 75, 0.12),
            rgba(75, 75, 75, 0.58) 50%,
            rgba(75, 75, 75, 0.12)
          );
      }

      .scale-track.dragging {
        border-color: rgba(75, 75, 75, 0.32);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.82),
          inset 0 -1px 0 rgba(75, 75, 75, 0.08);
      }

      .scale-track.disabled {
        cursor: default;
        opacity: 0.48;
      }

      .scale-track:focus {
        outline: none;
      }

      .scale-track:focus-visible {
        outline: none;
      }

      .coordinate-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
      }

      .coordinate-grid label {
        display: grid;
        grid-template-columns: 78px minmax(0, 1fr);
        align-items: center;
        min-width: 0;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #686868;
      }

      .coordinate-grid label span {
        min-width: 0;
      }

      .coordinate-grid input {
        width: 100%;
        padding: 8px 10px;
        border: 1px solid rgba(37, 37, 37, 0.16);
        border-radius: var(--radius-sm);
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        color: #252525;
        background: rgba(255, 255, 255, 0.92);
      }

      .token-field {
        display: grid;
        gap: 5px;
        min-width: 0;
      }

      .token-field span {
        min-width: 0;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #686868;
      }

      .token-field input {
        width: 100%;
        min-width: 0;
        padding: 8px 10px;
        border: 1px solid rgba(37, 37, 37, 0.16);
        border-radius: var(--radius-sm);
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        color: #252525;
        background: rgba(255, 255, 255, 0.92);
      }

      .theme-switch {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-width: 0;
        margin-bottom: 4px;
        cursor: pointer;
      }

      .theme-switch::after {
        content: "";
        position: absolute;
        right: 0;
        bottom: -7px;
        left: 0;
        height: 1px;
        background: rgba(37, 37, 37, 0.12);
      }

      .theme-switch-label {
        min-width: 0;
        font-size: 11px;
        font-weight: 600;
        line-height: 18px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #686868;
      }

      .theme-switch input {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
      }

      .theme-switch-track {
        position: relative;
        align-self: center;
        flex: 0 0 auto;
        width: 34px;
        height: 18px;
        border: 1px solid rgba(37, 37, 37, 0.16);
        border-radius: 999px;
        background: #cfcfcf;
        transition:
          border-color 120ms ease,
          background-color 120ms ease;
      }

      .theme-switch-track::after {
        content: "";
        position: absolute;
        top: 2px;
        left: 2px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #ffffff;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.28);
        transition: transform 120ms ease;
      }

      .theme-switch input:checked + .theme-switch-track {
        border-color: var(--theme-accent);
        background: var(--theme-accent);
      }

      .theme-switch input:checked + .theme-switch-track::after {
        background: var(--theme-accent-contrast);
        transform: translateX(16px);
      }

      .theme-switch input:focus-visible + .theme-switch-track {
        outline: 2px solid var(--theme-focus-ring);
        outline-offset: 2px;
      }

      .coordinate-actions {
        display: grid;
        grid-template-columns: 1fr;
        gap: 8px;
      }

      .toolbar button.wide {
        width: 100%;
        justify-content: center;
      }

      .crop-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        min-height: 0;
      }

      .crop-subsection {
        display: grid;
        gap: 8px;
        min-width: 0;
      }

      .crop-subsection + .crop-subsection {
        margin-top: 6px;
        padding-top: 10px;
        border-top: 1px solid rgba(37, 37, 37, 0.1);
      }

      .crop-list:empty {
        display: none;
      }

      .crop-list .screen-region {
        flex: 1 1 100%;
        min-width: 0;
        display: grid;
        gap: 6px;
        padding: 7px 14px;
        border: 1px solid rgba(37, 37, 37, 0.1);
        border-radius: var(--radius-pill);
        cursor: pointer;
        font-size: 14px;
        background: #efefef;
        color: #252525;
      }

      .crop-list .screen-region-header {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        font-weight: 600;
      }

      .crop-list .screen-region-remove {
        min-width: 0;
        height: auto;
        padding: 2px 8px;
        border: 0;
        border-radius: var(--radius-pill);
        background: rgba(37, 37, 37, 0.08);
        color: #252525;
        justify-content: center;
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
      }

      .crop-list .screen-region-remove:hover,
      .crop-list .screen-region-remove:focus-visible {
        background: rgba(37, 37, 37, 0.16);
      }

      .crop-list .screen-region.selected {
        background: #efe3bd;
        border-color: rgba(92, 74, 24, 0.42);
        color: #5c4a18;
        box-shadow: 0 0 0 2px rgba(255, 210, 77, 0.32);
      }

      .crop-list .screen-region.selected .screen-region-remove {
        background: rgba(92, 74, 24, 0.08);
        color: #6b5417;
      }

      .crop-list .screen-region.selected .screen-region-remove:hover,
      .crop-list .screen-region.selected .screen-region-remove:focus-visible {
        background: rgba(92, 74, 24, 0.16);
      }

      .crop-list .screen-region:focus-visible {
        outline: 2px solid rgba(255, 210, 77, 0.7);
        outline-offset: 2px;
      }

      .status {
        min-width: 0;
        font-size: 13px;
        line-height: 1.4;
        color: #4d4d4d;
      }

      .status.error {
        color: #a33f2f;
      }

      .save-progress {
        width: 100%;
        height: 6px;
        overflow: hidden;
        border: 0;
        border-radius: 999px;
        background: rgba(37, 37, 37, 0.12);
      }

      .save-progress::-webkit-progress-bar {
        background: rgba(37, 37, 37, 0.12);
      }

      .save-progress::-webkit-progress-value {
        border-radius: 999px;
        background: var(--theme-accent);
      }

      .save-progress::-moz-progress-bar {
        border-radius: 999px;
        background: var(--theme-accent);
      }

      .status-panel {
        display: grid;
        gap: 10px;
        margin-top: 8px;
      }

      .status-panel .status-actions {
        grid-template-columns: 1fr;
      }

      .status-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .status-actions button {
        width: 100%;
      }

      :root[data-theme='dark'] {
        accent-color: var(--theme-accent);
      }

      :root[data-theme='dark'] body {
        background:
          radial-gradient(circle at top, rgba(54, 54, 54, 0.98), rgba(45, 45, 45, 0.96)),
          linear-gradient(180deg, #343434 0%, #2d2d2d 100%);
        color: #eeeeee;
      }

      :root[data-theme='dark'] .tile-runtime-stats {
        background: rgba(32, 32, 32, 0.58);
      }

      :root[data-theme='dark'] .runtime-stat {
        border-color: rgba(235, 235, 235, 0.1);
        background: rgba(41, 41, 41, 0.92);
        box-shadow: 0 14px 32px rgba(0, 0, 0, 0.22);
      }

      :root[data-theme='dark'] .tile-runtime-stats .runtime-stat {
        background: transparent;
        box-shadow: none;
      }

      :root[data-theme='dark'] .runtime-stat-label {
        color: #bdbdbd;
      }

      :root[data-theme='dark'] .runtime-stat-value {
        color: #f3f3f3;
      }

      :root[data-theme='dark'] .tile-runtime-stats .runtime-stat-label,
      :root[data-theme='dark'] .tile-runtime-stats .runtime-stat-value {
        color: #eeeeee;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.72);
      }

      :root[data-theme='dark'] .toolbar {
        border-color: rgba(235, 235, 235, 0.1);
        background: rgba(37, 37, 37, 0.94);
        box-shadow: 0 18px 44px rgba(0, 0, 0, 0.24);
      }

      :root[data-theme='dark'] .toolbar-toggle {
        border-color: rgba(235, 235, 235, 0.1);
        color: #eeeeee;
        background: rgba(37, 37, 37, 0.94);
        box-shadow: 0 18px 44px rgba(0, 0, 0, 0.24);
      }

      :root[data-theme='dark'] .toolbar-dock.collapsed .toolbar-toggle {
        color: #d0d0d0;
        background: rgba(40, 40, 40, 0.96);
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.22);
      }

      :root[data-theme='dark'] .toolbar-toggle:hover,
      :root[data-theme='dark'] .toolbar-dock.collapsed .toolbar-toggle:hover {
        color: #f5f5f5;
        background: rgba(64, 64, 64, 0.98);
        box-shadow: 0 16px 36px rgba(0, 0, 0, 0.28);
      }

      :root[data-theme='dark'] .toolbar-toggle:focus-visible,
      :root[data-theme='dark'] .theme-switch input:focus-visible + .theme-switch-track {
        outline-color: var(--theme-focus-ring);
      }

      :root[data-theme='dark'] .theme-switch::after {
        background: rgba(235, 235, 235, 0.12);
      }

      :root[data-theme='dark'] .toolbar-section {
        border-color: rgba(235, 235, 235, 0.08);
        background:
          linear-gradient(180deg, rgba(49, 49, 49, 0.94), rgba(42, 42, 42, 0.96));
      }

      :root[data-theme='dark'] .toolbar-scroll {
        scrollbar-color: rgba(190, 190, 190, 0.46) transparent;
      }

      :root[data-theme='dark'] .toolbar-scroll::-webkit-scrollbar-thumb {
        background: rgba(190, 190, 190, 0.34);
      }

      :root[data-theme='dark'] .toolbar-scroll::-webkit-scrollbar-thumb:hover {
        background: rgba(190, 190, 190, 0.52);
      }

      @supports selector(::-webkit-scrollbar) {
        .toolbar-scroll,
        :root[data-theme='dark'] .toolbar-scroll {
          scrollbar-color: auto;
          scrollbar-width: auto;
        }
      }

      :root[data-theme='dark'] .toolbar-section-title,
      :root[data-theme='dark'] .toolbar-value,
      :root[data-theme='dark'] .range-field span,
      :root[data-theme='dark'] .coordinate-grid label,
      :root[data-theme='dark'] .token-field span,
      :root[data-theme='dark'] .theme-switch-label {
        color: #c3c3c3;
      }

      :root[data-theme='dark'] .toolbar button {
        color: #ededed;
        background: #3a3a3a;
      }

      :root[data-theme='dark'] .toolbar button:hover {
        background: #494949;
      }

      :root[data-theme='dark'] .toolbar button.active {
        color: var(--theme-accent-contrast);
        background: var(--theme-accent);
        box-shadow: none;
      }

      :root[data-theme='dark'] .toolbar button.save {
        color: var(--theme-accent-contrast);
        background: var(--theme-accent);
      }

      :root[data-theme='dark'] .scale-value-input,
      :root[data-theme='dark'] .coordinate-grid input,
      :root[data-theme='dark'] .token-field input {
        border-color: rgba(235, 235, 235, 0.13);
        color: #f1f1f1;
        background: rgba(35, 35, 35, 0.92);
      }

      :root[data-theme='dark'] .theme-switch-track {
        border-color: rgba(235, 235, 235, 0.16);
        background: #555555;
      }

      :root[data-theme='dark'] .theme-switch-track::after {
        background: #f1f1f1;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
      }

      :root[data-theme='dark'] .theme-switch input:checked + .theme-switch-track {
        border-color: var(--theme-accent);
        background: var(--theme-accent);
      }

      :root[data-theme='dark'] .scale-track {
        border-color: rgba(235, 235, 235, 0.12);
        background:
          linear-gradient(180deg, rgba(53, 53, 53, 0.96), rgba(40, 40, 40, 0.98)),
          #292929;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.07),
          inset 0 -1px 0 rgba(0, 0, 0, 0.28);
      }

      :root[data-theme='dark'] .scale-track::before {
        background:
          linear-gradient(
            90deg,
            rgba(195, 195, 195, 0.08),
            rgba(195, 195, 195, 0.42) 50%,
            rgba(195, 195, 195, 0.08)
          );
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.42);
      }

      :root[data-theme='dark'] .scale-track::after {
        background-image:
          linear-gradient(
            90deg,
            rgba(195, 195, 195, 0.46) 0 1px,
            transparent 1px 100%
          ),
          linear-gradient(
            90deg,
            rgba(195, 195, 195, 0.26) 0 1px,
            transparent 1px 100%
          );
      }

      :root[data-theme='dark'] .scale-track-center {
        background: rgba(210, 210, 210, 0.72);
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.52);
      }

      :root[data-theme='dark'] .scale-track:hover::before,
      :root[data-theme='dark'] .scale-track:focus-visible::before,
      :root[data-theme='dark'] .scale-track.dragging::before {
        background:
          linear-gradient(
            90deg,
            rgba(195, 195, 195, 0.12),
            rgba(195, 195, 195, 0.6) 50%,
            rgba(195, 195, 195, 0.12)
          );
      }

      :root[data-theme='dark'] .scale-track.dragging {
        border-color: rgba(220, 220, 220, 0.34);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.09),
          inset 0 -1px 0 rgba(0, 0, 0, 0.3);
      }

      :root[data-theme='dark'] .crop-subsection + .crop-subsection {
        border-top-color: rgba(235, 235, 235, 0.09);
      }

      :root[data-theme='dark'] .crop-list .screen-region {
        border-color: rgba(235, 235, 235, 0.1);
        color: #ededed;
        background: #3a3a3a;
      }

      :root[data-theme='dark'] .crop-list .screen-region-remove {
        color: #ededed;
        background: rgba(225, 225, 225, 0.09);
      }

      :root[data-theme='dark'] .crop-list .screen-region-remove:hover,
      :root[data-theme='dark'] .crop-list .screen-region-remove:focus-visible {
        background: rgba(225, 225, 225, 0.17);
      }

      :root[data-theme='dark'] .crop-list .screen-region.selected {
        border-color: rgba(255, 215, 94, 0.5);
        color: #ffe39a;
        background: #493d20;
        box-shadow: 0 0 0 2px rgba(255, 210, 77, 0.26);
      }

      :root[data-theme='dark'] .crop-list .screen-region.selected .screen-region-remove {
        color: #ffe39a;
        background: rgba(255, 227, 154, 0.1);
      }

      :root[data-theme='dark'] .crop-list .screen-region.selected .screen-region-remove:hover,
      :root[data-theme='dark'] .crop-list .screen-region.selected .screen-region-remove:focus-visible {
        background: rgba(255, 227, 154, 0.19);
      }

      :root[data-theme='dark'] .status {
        color: #d0d0d0;
      }

      :root[data-theme='dark'] .status.error {
        color: #ff9488;
      }

      :root[data-theme='dark'] .save-progress,
      :root[data-theme='dark'] .save-progress::-webkit-progress-bar {
        background: rgba(235, 235, 235, 0.13);
      }

      :root[data-theme='dark'] .save-progress::-webkit-progress-value,
      :root[data-theme='dark'] .save-progress::-moz-progress-bar {
        background: var(--theme-accent);
      }

      @media (max-width: 720px) {
        .runtime-stats {
          top: 16px;
          right: 16px;
          left: 16px;
          flex-wrap: wrap;
          justify-content: flex-end;
          max-width: none;
        }

        .tile-runtime-stats {
          right: 50%;
          bottom: 5px;
          left: auto;
          flex-wrap: wrap;
          justify-content: center;
          width: max-content;
          max-width: calc(100vw - 32px);
          transform: translateX(50%);
        }

        .runtime-stats .runtime-stat {
          flex: 0 0 auto;
          min-width: 0;
        }

        .tile-runtime-stats .runtime-stat {
          flex: 0 0 auto;
          min-width: 0;
        }

        .toolbar-dock {
          top: auto;
          bottom: 32px;
          right: 16px;
          left: 16px;
          width: auto;
          max-height: min(calc(78vh - 26px), 614px);
        }

        .toolbar {
          max-height: min(calc(78vh - 70px), 570px);
        }

        .toolbar-dock.collapsed .toolbar-toggle {
          justify-self: center;
          min-height: 28px;
          padding: 3px 12px 4px;
        }

        .coordinate-actions button,
        .status-actions button {
          width: 100%;
        }
      }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <div id="screen-selection-overlay" class="screen-selection-overlay" hidden>
      <div id="screen-selection-rect" class="screen-selection-rect"></div>
    </div>
    <div class="runtime-stats" aria-live="polite">
      <div class="runtime-stat fps-runtime-stat">
        <p class="runtime-stat-label">FPS</p>
        <p id="fps-value" class="runtime-stat-value">—</p>
      </div>
      <div class="runtime-stat cache-bytes-runtime-stat">
        <p class="runtime-stat-label">CacheBytes</p>
        <p id="cache-bytes-value" class="runtime-stat-value">0 B</p>
      </div>
      <div id="splats-count-stat" class="runtime-stat" hidden>
        <p class="runtime-stat-label">splatsNumber</p>
        <p id="splats-count-value" class="runtime-stat-value">0</p>
      </div>
    </div>
    <div class="tile-runtime-stats" aria-live="polite">
      <div class="runtime-stat">
        <p class="runtime-stat-label">Downloading:&nbsp;</p>
        <p id="tiles-downloading-value" class="runtime-stat-value">0</p>
      </div>
      <div class="runtime-stat">
        <p class="runtime-stat-label">Parsing:&nbsp;</p>
        <p id="tiles-parsing-value" class="runtime-stat-value">0</p>
      </div>
      <div class="runtime-stat">
        <p class="runtime-stat-label">Loaded:&nbsp;</p>
        <p id="tiles-loaded-value" class="runtime-stat-value">0</p>
      </div>
      <div class="runtime-stat">
        <p class="runtime-stat-label">Visible:&nbsp;</p>
        <p id="tiles-visible-value" class="runtime-stat-value">0</p>
      </div>
    </div>
    <div class="toolbar-dock expanded">
      <button
        id="toolbar-toggle"
        class="toolbar-toggle"
        type="button"
        aria-controls="toolbar"
        aria-label="Hide Sidebar"
        aria-expanded="true"
      >
        Hide Sidebar
      </button>
      <div id="toolbar" class="toolbar">
        <div class="toolbar-scroll">
          <div class="toolbar-section" data-save-lock-exempt>
            <div class="toolbar-section-header">
              <p class="toolbar-section-title">Canvas</p>
            </div>
            <div class="coordinate-actions">
              <label class="theme-switch">
                <span class="theme-switch-label">Dark theme</span>
                <input
                  id="theme"
                  type="checkbox"
                  role="switch"
                  aria-label="Use dark theme"
                />
                <span class="theme-switch-track" aria-hidden="true"></span>
              </label>
              <label
                class="theme-switch"
                title="Redraw the canvas only when the scene changes"
              >
                <span class="theme-switch-label">Render on demand</span>
                <input
                  id="render-on-demand"
                  type="checkbox"
                  role="switch"
                  aria-label="Render on demand"
                  checked
                />
                <span class="theme-switch-track" aria-hidden="true"></span>
              </label>
              <label class="token-field">
                <span>Cesium ion token</span>
                <input
                  id="cesium-ion-token"
                  type="password"
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck="false"
                  placeholder="Required for terrain"
                />
              </label>
              <button id="terrain" class="wide" type="button">Terrain</button>
              <button id="bounding-volume" class="wide" type="button">Bounding Volume</button>
              <button id="move-to-tiles" type="button">Move To Tiles</button>
            </div>
          </div>
          <div class="toolbar-section">
            <div class="toolbar-section-header">
              <p class="toolbar-section-title">Coordinate</p>
            </div>
            <div class="coordinate-grid">
              <label><span>Latitude</span><input id="latitude" type="number" step="any" value="0" /></label>
              <label><span>Longitude</span><input id="longitude" type="number" step="any" value="0" /></label>
              <label><span>Height</span><input id="height" type="number" step="any" value="0" /></label>
            </div>
            <div class="coordinate-actions">
              <button id="move-camera-to-coordinate" class="wide" type="button">Move Camera</button>
              <button id="move-tiles-to-coordinate" class="wide" type="button">Move Tiles</button>
            </div>
          </div>
          <div class="toolbar-section">
            <div class="toolbar-section-header">
              <p class="toolbar-section-title">Transform</p>
            </div>
            <div class="transform-actions">
              <button id="translate" type="button">Translate</button>
              <button id="rotate" type="button">Rotate</button>
              <div class="range-field full-span">
                <div class="range-field-header">
                  <span>Scale</span>
                  <input
                    id="uniform-scale-value"
                    class="scale-value-input"
                    type="number"
                    step="any"
                    value="1"
                  />
                </div>
                <div
                  id="uniform-scale"
                  class="scale-track"
                  tabindex="0"
                  aria-label="Scale x1"
                >
                  <span class="scale-track-center" aria-hidden="true"></span>
                </div>
              </div>
              <button id="set-position" class="full-span" type="button">Set Position</button>
              <button id="reset" class="full-span" type="button">Reset</button>
            </div>
          </div>
          <div class="toolbar-section">
            <div class="toolbar-section-header">
              <p class="toolbar-section-title">LOD</p>
            </div>
            <label class="range-field">
              <div class="range-field-header">
                <span>Geometric Error</span>
                <p id="geometric-error-value" class="toolbar-value">x1.00</p>
              </div>
              <input
                id="geometric-error-scale"
                type="range"
                min="-4"
                max="4"
                step="0.1"
                value="0"
              />
            </label>
            <label class="range-field">
              <div class="range-field-header">
                <span>Layer Multiplier</span>
                <p id="geometric-error-layer-value" class="toolbar-value">x1.00</p>
              </div>
              <input
                id="geometric-error-layer-scale"
                type="range"
                min="-3"
                max="3"
                step="0.1"
                value="0"
              />
            </label>
          </div>
          <div id="crop-section" class="toolbar-section" hidden>
            <div class="crop-subsection">
              <div class="toolbar-section-header">
                <p class="toolbar-section-title">Crop Sphere</p>
              </div>
              <div class="coordinate-actions">
                <button id="keep-sphere-create" class="wide" type="button">Create Sphere</button>
              </div>
              <div class="range-field">
                <div class="range-field-header">
                  <span>Size</span>
                  <input
                    id="keep-sphere-size-value"
                    class="scale-value-input"
                    type="number"
                    step="any"
                    value="1"
                    disabled
                  />
                </div>
                <div
                  id="keep-sphere-radius"
                  class="scale-track disabled"
                  tabindex="0"
                  aria-label="Crop sphere size"
                  aria-disabled="true"
                >
                  <span class="scale-track-center" aria-hidden="true"></span>
                </div>
              </div>
              <div class="status-actions">
                <button id="keep-sphere-confirm" type="button">Confirm</button>
                <button id="keep-sphere-cancel" type="button">Cancel</button>
              </div>
              <div id="keep-sphere-list" class="crop-list"></div>
            </div>
            <div class="crop-subsection">
              <div class="toolbar-section-header">
                <p class="toolbar-section-title">Crop Regions</p>
                <p id="crop-count-value" class="toolbar-value">0</p>
              </div>
              <div class="coordinate-actions">
                <button id="crop-screen-select" class="wide" type="button">Draw Region</button>
              </div>
              <div class="status-actions">
                <button id="crop-screen-confirm" type="button">Confirm</button>
                <button id="crop-screen-cancel" type="button">Cancel</button>
              </div>
              <div id="crop-list" class="crop-list"></div>
            </div>
          </div>
        </div>
        <div class="toolbar-section status-panel">
          <div class="status-actions">
            <button id="save" class="save" type="button">Save</button>
          </div>
          <progress id="save-progress" class="save-progress" max="100" value="0" hidden></progress>
          <div id="status" class="status">Loading tileset...</div>
        </div>
      </div>
    </div>
    <script>
      globalThis.__TILES_INSPECTOR_CONFIG__ = ${serializedViewerConfig};
    </script>
    <script type="module" src="./viewer/app.js"></script>
  </body>
</html>
`;
}

module.exports = {
  buildViewerHtml,
};
