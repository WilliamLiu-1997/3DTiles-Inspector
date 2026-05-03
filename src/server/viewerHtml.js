function stringifyInlineScriptValue(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026');
}

function buildViewerHtml(viewerConfig) {
  const serializedViewerConfig = stringifyInlineScriptValue(viewerConfig);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, viewport-fit=cover"
    />
    <title>3D Tiles Inspector</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif;
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
          radial-gradient(circle at top, rgba(255, 255, 255, 0.95), rgba(236, 240, 245, 0.9)),
          linear-gradient(180deg, #eef3f8 0%, #dfe7ef 100%);
        color: #16324f;
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
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.15);
        backdrop-filter: blur(6px);
        z-index: 12;
        pointer-events: none;
      }

      .runtime-stat {
        display: grid;
        gap: 4px;
        min-width: 132px;
        padding: 8px 12px;
        border: 1px solid rgba(22, 50, 79, 0.1);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.88);
        box-shadow: 0 14px 32px rgba(33, 52, 73, 0.12);
        backdrop-filter: blur(14px);
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
        color: #5d738b;
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
        color: #24292f;
      }

      .runtime-stat-value {
        margin: 0;
        font-size: 15px;
        font-weight: 700;
        line-height: 1.1;
        color: #16324f;
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
        border: 1px solid rgba(22, 50, 79, 0.12);
        border-top: 0;
        border-radius: 0 0 20px 20px;
        background: rgba(255, 255, 255, 0.9);
        box-shadow: 0 18px 44px rgba(33, 52, 73, 0.16);
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
        border: 1px solid rgba(22, 50, 79, 0.08);
        border-radius: 20px 20px 0 0;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.02em;
        color: #16324f;
        background: rgba(255, 255, 255, 0.9);
        box-shadow: 0 18px 44px rgba(33, 52, 73, 0.16);
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
        border-radius: 999px;
        color: #506377;
        background: rgba(255, 255, 255, 0.94);
        box-shadow: 0 12px 28px rgba(33, 52, 73, 0.12);
      }

      .toolbar-toggle:hover {
        color: #16324f;
        background: rgba(225, 226, 229, 0.98);
        box-shadow: 0 18px 40px rgba(33, 52, 73, 0.18);
      }

      .toolbar-dock.collapsed .toolbar-toggle:hover {
        background: rgba(239, 241, 243, 0.98);
        box-shadow: 0 10px 22px rgba(33, 52, 73, 0.1);
      }

      .toolbar-toggle:focus-visible {
        outline: 2px solid rgba(13, 111, 131, 0.35);
        outline-offset: 2px;
      }

      .toolbar-section {
        display: grid;
        gap: 10px;
        padding: 10px 12px;
        border: 1px solid rgba(22, 50, 79, 0.08);
        border-radius: 14px;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.78), rgba(243, 247, 251, 0.9));
      }

      .toolbar-scroll {
        display: grid;
        align-content: start;
        gap: 8px;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding-bottom: 8px;
        scrollbar-color: rgba(93, 115, 139, 0.45) transparent;
        scrollbar-width: thin;
      }

      .toolbar-scroll::-webkit-scrollbar {
        width: 6px;
      }

      .toolbar-scroll::-webkit-scrollbar-track {
        background: transparent;
      }

      .toolbar-scroll::-webkit-scrollbar-thumb {
        border-radius: 999px;
        background: rgba(93, 115, 139, 0.32);
      }

      .toolbar-scroll::-webkit-scrollbar-thumb:hover {
        background: rgba(93, 115, 139, 0.48);
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
        color: #5d738b;
      }

      .toolbar-value {
        margin: 0;
        font-size: 12px;
        font-weight: 700;
        color: #5d738b;
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
        border-radius: 999px;
        padding: 7px 14px;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #16324f;
        background: #dde7f2;
        cursor: pointer;
        transition:
          transform 120ms ease,
          background-color 120ms ease,
          color 120ms ease;
      }

      .toolbar button:hover {
        transform: translateY(-1px);
        background: #d0deeb;
      }

      .toolbar button.active {
        color: #fff;
        background: #0d6f83;
      }

      .toolbar button.save {
        color: #fff;
        background: #19765b;
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
        color: #5d738b;
      }

      .range-field input[type='range'] {
        width: 100%;
        margin: 0;
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
        color: #5d738b;
      }

      .coordinate-grid label span {
        min-width: 0;
      }

      .coordinate-grid input {
        width: 100%;
        padding: 8px 10px;
        border: 1px solid rgba(22, 50, 79, 0.16);
        border-radius: 10px;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        color: #16324f;
        background: rgba(255, 255, 255, 0.92);
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

      .crop-list:empty {
        display: none;
      }

      .crop-list .screen-region {
        flex: 1 1 100%;
        min-width: 0;
        display: grid;
        gap: 6px;
        padding: 7px 14px;
        border: 1px solid rgba(22, 50, 79, 0.1);
        border-radius: 999px;
        cursor: pointer;
        font-size: 14px;
        background: #dde7f2;
        color: #16324f;
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
        border-radius: 999px;
        background: rgba(22, 50, 79, 0.08);
        color: #16324f;
        justify-content: center;
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
      }

      .crop-list .screen-region-remove:hover,
      .crop-list .screen-region-remove:focus-visible {
        background: rgba(22, 50, 79, 0.16);
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
        color: #38516c;
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
        background: rgba(22, 50, 79, 0.12);
      }

      .save-progress::-webkit-progress-bar {
        background: rgba(22, 50, 79, 0.12);
      }

      .save-progress::-webkit-progress-value {
        border-radius: 999px;
        background: #19765b;
      }

      .save-progress::-moz-progress-bar {
        border-radius: 999px;
        background: #19765b;
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

      @media (max-width: 720px) {
        .runtime-stats {
          top: 16px;
          right: 16px;
          left: 16px;
          flex-wrap: wrap;
          justify-content: stretch;
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

        .runtime-stat {
          flex: 1 1 140px;
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
      <div class="runtime-stat">
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
              <button id="terrain" class="wide" type="button">Terrain</button>
              <button id="bounding-volume" class="wide" type="button">Bounding Volume</button>
              <button id="move-to-tiles" type="button">Move To Tiles</button>
            </div>
          </div>
          <div class="toolbar-section">
            <div class="toolbar-section-header">
              <p class="toolbar-section-title">Transform</p>
            </div>
            <div class="transform-actions">
              <button id="translate" type="button">Translate</button>
              <button id="rotate" type="button">Rotate</button>
              <button id="set-position" type="button">Set Position</button>
              <button id="reset" type="button">Reset</button>
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
            <div class="toolbar-section-header">
              <p class="toolbar-section-title">Crop Regions</p>
              <p id="crop-count-value" class="toolbar-value">0</p>
            </div>
            <div class="coordinate-actions">
              <button id="crop-screen-select" class="wide" type="button">Draw Region</button>
            </div>
            <div id="crop-list" class="crop-list"></div>
            <div class="status-actions">
              <button id="crop-screen-confirm" type="button">Confirm</button>
              <button id="crop-screen-cancel" type="button">Cancel</button>
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
