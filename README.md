# Vietflex SLAM Lab — SLAM × OpenStreetMap

A **static, browser-based 2D SLAM/OSM teaching and prototyping simulator** written in vanilla JavaScript, with no framework or build step. Vietnamese UI. It shows a synthetic ground-truth path, drifting simulated odometry, a nearest-road map constraint and RMSE telemetry on an OSM raster basemap.

**Important:** This is **not a real visual/LiDAR SLAM implementation**. There is no FlowNet, camera image processing, ICP, GTSAM pose-graph optimization, ROS2 node, CARLA or Autoware process. The landmark rays, odometry, loop-anchor closure and ground-truth path are synthetic. The road priors can be real OSM highways after loading. The displayed RMSE values are **simulated**, not experimental SLAM benchmarks or localization accuracy guarantees.

## Quick start

Open `index.html` in a modern browser, or use a tiny static server:

```bash
python -m http.server 8000
# Open http://localhost:8000
```

Because `app.js` imports an ES module (`math.mjs`), **running a local HTTP server is recommended**; `file://` module imports are often disallowed by browsers. Publish the repository root to GitHub Pages (`main` / `/root`) to use the static site.

Once open:

1. Choose a city and a simulated modality (Visual, LiDAR, Visual+IMU).
2. Click **▶ Chạy mô phỏng** to watch the three trajectories, point-return rays and RMSE chart.
3. Optionally click **Nạp mạng đường OSM tại đây** (explicit, small Overpass request), or load a `.osm`/`.xml` or WGS84 road `GeoJSON` file exported elsewhere.
4. Compare the map-constraint toggle, tune the synthetic noise and export CSV / GeoJSON.

The default road network is **synthetic**, even though its visualization is georeferenced and placed on top of an OSM basemap. You must load actual OSM ways to use real road topology for the nearest-segment correction. The loaded OSM road choice is a *single chosen way*, not graph shortest-path routing; road matching is a simple nearest-segment projection without heading, lane, posterior uncertainty or loop-closure optimization.

## Architecture

```text
Public OSM raster tiles (viewport only, optional) -> canvas map display
Overpass / OSM XML / GeoJSON -> WGS84 lon/lat -> local XY metres
                                -> road segments + spatial grid index
                                -> simulated drivable trajectory
Synthetic ground truth -> odometry noise/drift -> raw trajectory
                                               -> nearest road projection
                                               -> constrained trajectory
All tracks -> per-frame ground-truth errors -> RMSE chart / CSV / GeoJSON
```

The tile layer and loaded roads are **separate**. OpenStreetMap raster tiles do *not* contain a machine-usable vector road graph. To map-match, load OSM vector ways using Overpass or upload a vector file. The map constraint is not full SLAM: it applies road geometry priors to simulated odometry. The local XY projection is an equirectangular approximation centered at the selected city, appropriate only for **small local areas**, not global/HD map production.

No map library dependency (no Leaflet). Modules:
- `index.html` — page and controls.
- `styles.css` — responsive dashboard.
- `math.mjs` — coordinate transforms, segment projections, spatial buckets and road sampling.
- `app.js` — OSM raster renderer, data import, simulator, visualization and exports.
- `tests/geometry.test.mjs` — regression tests.

## Tests

```bash
node --test tests/geometry.test.mjs
node --check app.js
```

## Upstream projects: actual algorithm integrations (not vendored here)

| Project | Integration path | Notes |
|---|---|---|
| [DeepVO-SLAM](https://github.com/aak204/deepvo-slam) | Run Python/Streamlit/Docker separately; import georeferenced trajectories into this UI later | Requires deep-learning weights, KITTI data and Python dependencies; Streamlit is not GitHub Pages |
| [AV-Map-Creation-Workflow](https://github.com/zubxxr/AV-Map-Creation-Workflow) | Create OSM-derived 3D mesh + point-cloud PCD + Lanelet2 for Autoware/AWSIM | External Docker and mapping tools, not a browser module |
| [Cam2Sim](https://github.com/ast-fortiss-tum/cam2sim) | Generate CARLA scenarios from driving recordings | Requires CARLA and GPU stack for GS workflow |
| [OpenTwinMap](https://github.com/jmscslgroup/OpenTwinMap) | Investigate OSM + geospatial assets for CARLA environment construction | Verified public repo, GPL-3.0; integration not implemented here |
| [FlexMap Fusion](https://github.com/TUMFTM/FlexMap_Fusion) | ROS2 map alignment/conflation and GNSS-assisted georeferencing | Requires ROS2 / RViz / map inputs |

The suggested `alexrichardson/opentwinmap` repository path returned 404 at review time (12 October 2026). A matching public project was identified as [jmscslgroup/OpenTwinMap](https://github.com/jmscslgroup/OpenTwinMap), licensed GPL-3.0; verify compatibility before incorporating or distributing its code. O-VIP was not verified as public executable source and is not bundled.

### Next engineering milestones

1. **Real sensor backend:** ROS2 bridge/WebSocket for timestamped pose, IMU, camera, LiDAR scans; synchronise CRS and timestamps.
2. **True localization/SLAM:** implement ORB-SLAM3 / RTAB-Map / LIO-SAM or verified DeepVO separately; stream estimated trajectories and covariance.
3. **OSM priors:** use Overpass/PBF/GeoPackage, turn restrictions, directed graphs, probabilistic map matching; distinguish OSM road graph from Lanelet2.
4. **Simulation:** CARLA/OpenDRIVE or AWSIM/Lanelet2 with GPS-to-local-frame transformation, evaluation against simulator ground truth.
5. **VietflexMap/VFM adapter:** optional tile adapter for authorized offline PMTiles plus GeoJSON/VFM export, respecting data licences.

## OSM legal and performance notes

Basemap raster requests use only `https://tile.openstreetmap.org/{z}/{x}/{y}.png` for the *visible* area. Tile attribution must remain visible. The app does not bulk-prefetch or provide offline downloads. OSMF does not guarantee uptime, and its public tile service is not intended as a high-volume production backend. For offline or heavy use, host tiles yourself or use a provider that explicitly permits it. Vector road data are © OpenStreetMap contributors (ODbL); exported map-derived content may have ODbL obligations. Read https://operations.osmfoundation.org/policies/tiles/ and https://www.openstreetmap.org/copyright.

## License

Original Vietflex SLAM Lab application source: MIT, © 2026 Long Ngo. External projects and OSM data retain their own licences. No upstream third-party source is copied into this repository.