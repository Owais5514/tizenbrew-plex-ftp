# 🎬 TizenFlix for TizenBrew (Samsung Tizen OS)

A sleek, cinematic video player designed to run directly inside **[TizenBrew](https://github.com/reisxd/TizenBrew)** on **Samsung Smart TVs**. It streams and indexes video files directly from any standard **FTP / FTPS server** (Android phone hotspot, seedbox, NAS, home server, or router USB storage) with built-in HTTP Byte-Range streaming, auto-subtitles, watch progress persistence, and full TV remote control support.

---

## ✨ Features

- **Cinematic TV Interface:**
  - Dark aesthetic with dynamic ambient background glow based on the highlighted title.
  - Sidebar navigation (**Home**, **Anime**, **Modules**, **Movies**, **TV Shows**, **Folder Browser**, **Settings**).
  - Horizontal carousels with smooth scrolling: **Continue Watching**, **Recently Added**, **AniList Watchlist**, **Trending Anime**, **Movies**, **TV Shows**.
  - Poster cards with video quality badges (`4K`, `1080p`, `720p`), release year, file size, and watch progress bars.
- **Fixed Home Folder:**
  - Set any specific FTP directory as your primary Home library (e.g. `/Download/Anime` or `/Movies`).
  - 1-click **📌 Set as Home Folder** directly from the Folder Browser or via Settings.
- **Smart Content Recognition & Metadata:**
  - Automatic filename cleaning and bracket/tag stripping (`[SubsPlease]`, episode markers `- 05`, season/year, codecs).
  - Multi-provider metadata recognizer: AniList GraphQL (free, instant anime match without API key), TMDB (movies/TV), and TVMaze.
  - Caches posters, backdrops, synopses, and ratings locally for zero lag on TV boot.
- **Two-Way AniList Tracking with Mobile QR Code Login:**
  - **Zero remote typing:** TV generates a vector QR code. Scan with your phone camera, click "Sign in with AniList", and your TV instantly connects!
  - Syncs your personal AniList lists: Currently Watching, Plan to Watch, Completed, and Trending Online.
  - Two-way auto-scrobbling: when you reach 80% or finish an episode, your AniList progress updates automatically in real-time.
- **Shirox-Compatible Module Engine & Streaming Scrapers:**
  - Sandboxed JS module engine supporting Shirox/Sora scraper extensions (`searchResults`, `extractEpisodes`, `extractStreamUrl`).
  - Comes with built-in high-speed anime provider out of the box.
  - Module Manager: Install community scraper manifests via URL, set active providers, or switch scrapers.
  - Built-in stream proxy forwarding `Referer` and `Origin` headers to bypass 403 Forbidden blocks on Smart TVs.
- **Pure Node.js FTP Streaming Proxy (`service.js`):**
  - Modern web engines in Smart TVs do not support `ftp://` in HTML5 `<video>` tags.
  - TizenFlix includes a background Node.js service that translates HTTP `Range: bytes=X-Y` requests into FTP `REST` and `RETR` commands.
  - Full support for **seeking, pausing, rewinding, and buffer caching** on the TV.
  - Automatic stream controller to handle single-port mobile FTP servers (e.g. Android phone hotspot servers) without socket collision on rapid seeking.
- **TV Remote Control & Spatial Navigation (`nav.js`):**
  - Native 2D spatial navigation for remote D-pads (Up, Down, Left, Right, Enter).
  - Tizen Return / Back button (`keyCode 10009`) smoothly exits modals, player, or returns to sidebar.
  - Dedicated hardware Media key support (`MediaPlayPause`, `MediaFastForward`, `MediaRewind`, `MediaStop`).
- **Custom TV Video Player & OSD (`player.js`):**
  - Fullscreen video playback (`.mp4`, `.mkv`, `.webm`, `.mov`, `.ts`, `.m4v`, and HLS `.m3u8` module streams).
  - Interactive OSD timeline, buffer indicator, elapsed/remaining duration.
  - Debounced 10-second skip forward/back with visual pulse indicators.
  - Auto-hides OSD after 3.8 seconds of inactivity.
- **Watch History & Resume:**
  - Remembers the exact playback second where you paused.
  - "Resume" button appears automatically in the Details view and Continue Watching carousel.
- **Automatic Subtitles:**
  - Automatically detects sidecar `.srt` files with the same name on your FTP server.
  - Converts SRT to WebVTT on-the-fly and loads it into the HTML5 video track.

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────┐
│                   Samsung Smart TV                     │
│                                                        │
│  ┌─────────────────────────┐  HTTP API & Stream (206)  │
│  │   TizenBrew Webview     │ ◄──────────────────────┐  │
│  │   (TizenFlix UI / Video)│                        │  │
│  └─────────────────────────┘                        │  │
│               │                                      │  │
│               ▼                                      │  │
│  ┌──────────────────────────────────────────────┐    │  │
│  │  TizenBrew Background Service (Node.js)      │────┘  │
│  │  - Translates HTTP Range -> FTP REST/RETR    │       │
│  │  - Recursively scans FTP directory           │       │
│  │  - Converts SRT -> WebVTT subtitles          │       │
│  │  - Stores settings & watch progress          │       │
│  └──────────────────────┬───────────────────────┘       │
└─────────────────────────┼───────────────────────────────┘
                          │ Raw FTP/FTPS (TCP)
                          ▼
            ┌───────────────────────────┐
            │ Remote / Local FTP Server │
            │ (Android Phone, NAS, PC)  │
            └───────────────────────────┘
```

---

## 🚀 Installation on Samsung TV (via TizenBrew)

### Prerequisites
1. A Samsung Smart TV running **Tizen 3.0+** (2017 or newer).
2. **TizenBrew** installed on your TV (follow the official [TizenBrew Guide](https://github.com/reisxd/TizenBrew)).

### Adding TizenFlix to TizenBrew

#### Option A: Directly from the TV (Recommended)
1. Launch **TizenBrew** on your TV.
2. Go to **Module Manager** → **Add from GitHub** (or **GitHub / GH**).
3. Type:
   ```text
   Owais5514/tizenflix
   ```
4. Confirm. TizenBrew will download the module and add the **TizenFlix** icon to your launcher.

#### Option B: Via TizenBrew Installer (Desktop PC / Mac)
1. Open **TizenBrew Installer** on your computer.
2. Click **Install from GitHub**.
3. Enter:
   ```text
   Owais5514/tizenflix
   ```
4. Click **Install**.

---

## ⚙️ Configuration

1. Launch **TizenFlix** on your TV.
2. In the left sidebar, click **Settings** (gear icon).
3. Fill in your FTP server details:
   - **FTP Server Host / IP:** e.g., `192.168.1.12` or `192.168.1.100`
   - **Port:** `5514` (for Android WiFi FTP Server) or `21` (default)
   - **Username:** your FTP username (or `anonymous`)
   - **Password:** your FTP password
   - **Media Root Path:** e.g. `/` or `/Movies` or `/Media`
   - **TMDB API Key (Optional):** get a free key at [themoviedb.org](https://www.themoviedb.org/) for movie posters and descriptions.
4. Click **⚡ Test Connection** to verify your credentials.
5. Click **💾 Save & Scan** to index your library and start streaming!

---

## 💻 Local Testing & Development

You can test and run this player on your PC/Mac or local browser without a TV:

```bash
git clone https://github.com/Owais5514/tizenflix.git
cd tizenflix

# Start the background service & web server
npm start
```

Open `http://localhost:8999` in your browser. Use the keyboard arrow keys, Enter, and Escape to navigate with the TV D-pad engine.

---

## 🎮 TV Remote Key Mappings

| Remote Key | Function |
|---|---|
| **D-Pad Arrows** | Move focus between cards, sidebar, and controls |
| **Enter / OK** | Select card, open details, play video |
| **Return / Back** | Close details modal, exit video player, or return to sidebar |
| **Play / Pause** | Toggle video playback |
| **Fast Forward / Rewind** | Seek forward / backward by 10 seconds |
| **Stop** | Exit video player |

---

## 📄 License

MIT License. Free to customize and extend for your personal home theater setup!
