# NASA SVS Moon Integration

Integrates the [NASA Scientific Visualization Studio (SVS)](https://svs.gsfc.nasa.gov/) API
(`https://svs.gsfc.nasa.gov/api/14959`) into EventFlow, providing an interactive 3D Moon
viewer powered by NASA Lunar Reconnaissance Orbiter (LRO) data.

---

## What This Integration Does

- **NASA SVS API service** (`services/nasa-svs.service.js`) — fetches and caches Moon 3D model
  metadata (title, description, credits, GLB file URLs, preview images) from the public NASA SVS API.
- **API routes** (`routes/nasa-svs.js`) — two public endpoints under `/api/nasa-svs/`:
  - `GET /api/nasa-svs/moon` — full metadata + local GLB availability
  - `GET /api/nasa-svs/moon/status` — quick status check
- **Moon Viewer page** (`public/moon-viewer.html`) — an interactive 3D viewer using the
  [`<model-viewer>`](https://modelviewer.dev/) web component. Automatically loads the `.glb`
  file from `public/assets/nasa-svs/` if present.
- **Drop folder** (`public/assets/nasa-svs/`) — just drop the downloaded `.glb` file here; no
  code changes needed.

---

## Quick Setup Guide

1. **Merge this PR** (or pull the latest changes)
2. Go to <https://svs.gsfc.nasa.gov/14959>
3. Download the Moon GLB model file.  
   Direct URL:  
   `https://svs.gsfc.nasa.gov/vis/a010000/a014900/a014959/Moon_NASA_LRO_8k_Flat.glb`
4. Place the `.glb` file in `public/assets/nasa-svs/`
5. Start the server: `npm run dev`
6. Open your browser and navigate to `/moon-viewer.html`
7. **Done** — you'll see the interactive 3D Moon! 🌕

---

## API Endpoint Reference

All endpoints are public — no authentication required.

### `GET /api/nasa-svs/moon`

Returns Moon model metadata from the NASA SVS API plus local GLB availability.

**Response:**

```json
{
  "ok": true,
  "metadata": {
    "title": "Moon 3D Models for Web, AR, and Animation",
    "description": "...",
    "credits": "NASA Scientific Visualization Studio / NASA LRO",
    "releaseDate": "2023-01-01",
    "sourceUrl": "https://svs.gsfc.nasa.gov/14959",
    "apiUrl": "https://svs.gsfc.nasa.gov/api/14959",
    "glbFiles": [
      {
        "url": "https://svs.gsfc.nasa.gov/vis/a010000/a014900/a014959/Moon_NASA_LRO_8k_Flat.glb",
        "label": "Moon_NASA_LRO_8k_Flat.glb",
        "size": null
      }
    ],
    "previewImages": []
  },
  "localGlb": {
    "present": true,
    "files": ["Moon_NASA_LRO_8k_Flat.glb"]
  }
}
```

### `GET /api/nasa-svs/moon/status`

Returns a quick status check.

**Response:**

```json
{
  "ok": true,
  "apiReachable": true,
  "localGlb": {
    "present": false,
    "files": []
  },
  "cache": {
    "cached": true,
    "cacheAgeMs": 12345,
    "cacheTtlMs": 3600000
  }
}
```

---

## Configuration

| Environment Variable    | Default   | Description                               |
| ----------------------- | --------- | ----------------------------------------- |
| `NASA_SVS_CACHE_TTL_MS` | `3600000` | Cache TTL for NASA SVS API responses (ms) |

---

## Files Created / Modified

| File                                | Description                       |
| ----------------------------------- | --------------------------------- |
| `services/nasa-svs.service.js`      | NASA SVS API service with caching |
| `routes/nasa-svs.js`                | Express route handler             |
| `public/moon-viewer.html`           | 3D Moon viewer page               |
| `public/assets/nasa-svs/.gitkeep`   | Keeps the drop folder in git      |
| `public/assets/nasa-svs/.gitignore` | Ignores `.glb` files from git     |
| `public/assets/nasa-svs/README.md`  | Drop folder user instructions     |
| `docs/NASA-SVS-MOON-INTEGRATION.md` | This documentation file           |
| `server.js`                         | Mounts `/api/nasa-svs` route      |

---

## Credits

3D Moon model data provided by **NASA's Scientific Visualization Studio (SVS)** and derived
from imagery captured by the **NASA Lunar Reconnaissance Orbiter (LRO)**.

- Visualization page: <https://svs.gsfc.nasa.gov/14959>
- NASA SVS website: <https://svs.gsfc.nasa.gov/>
- model-viewer web component: <https://modelviewer.dev/>

> This integration uses the public, unauthenticated NASA SVS API and is subject to NASA's
> [media usage guidelines](https://www.nasa.gov/multimedia/guidelines/index.html).
