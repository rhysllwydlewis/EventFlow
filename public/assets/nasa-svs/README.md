# NASA SVS Moon Model — Drop Folder

Place your downloaded NASA SVS `.glb` file here and the Moon Viewer page
(`/moon-viewer.html`) will automatically detect and display it.

## Steps

1. Go to <https://svs.gsfc.nasa.gov/14959>
2. Download the GLB model file — the direct URL is:  
   `https://svs.gsfc.nasa.gov/vis/a010000/a014900/a014959/Moon_NASA_LRO_8k_Flat.glb`
3. Drop `Moon_NASA_LRO_8k_Flat.glb` into **this folder** (`public/assets/nasa-svs/`)
4. Start (or restart) the server: `npm run dev`
5. Visit `/moon-viewer.html` in your browser — the 3D Moon will appear automatically

## Notes

- The `.glb` file is large (~50–100 MB) and is excluded from git (see `.gitignore` in this folder)
- You can use any `.glb` filename — the viewer picks up the first `.glb` it finds in this folder
- The `/api/nasa-svs/moon` endpoint reports whether a local file is present
