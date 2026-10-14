# 🎬 Plex FTP Player for TizenBrew (Samsung Tizen OS)

A sleek, Plex-inspired media player designed to run directly inside **[TizenBrew](https://github.com/reisxd/TizenBrew)** on **Samsung Smart TVs**. It streams and indexes video files directly from any standard **FTP / FTPS server** (seedbox, NAS, home server, or router USB drive) with custom HTTP Byte-Range streaming, auto-subtitles, watch progress persistence, and full TV remote control support.

---

## ✨ Features

- **Plex-Style TV Interface:**
  - Dark cinematic aesthetic with dynamic ambient background glow based on the highlighted title.
  - Sidebar navigation (**Home**, **Movies**, **TV Shows**, **Folder Browser**, **Settings**).
  - Horizontal carousels with smooth scrolling: **Continue Watching**, **Recently Added**, **Movies**, **TV Shows**.
  - Poster cards with video quality badges (`4K`, `1080p`, `720p`), release year, file size, and watch progress bars.
- **Pure Node.js FTP Streaming Proxy (`service.js`):**
  - Modern web engines in Smart TVs do not support `ftp://` in HTML5 `<video>` tags.
  - PlexFTP includes a background Node.js service that translates HTTP `Range: bytes=X-Y` requests into FTP `REST` and `RETR` commands.
  - Full support for **seeking, pausing, rewinding, and buffer caching** on the TV.
- **TV Remote Control & Spatial Navigation (`nav.js`):**
  - Native 2D spatial navigation for remote D-pads (Up, Down, Left, Right, Enter).
  - Tizen Return / Back button (`keyCode 10009`) smoothly exits modals, player, or returns to sidebar.
  - Dedicated hardware Media key support (`MediaPlayPause`, `MediaFastForward`, `MediaRewind`, `MediaStop`).
- **Custom TV Video Player & OSD (`player.js`):**
  - Fullscreen video playback (`.mp4`, `.mkv`, `.webm`, `.mov`, `.ts`, `.m4v`).
  - Interactive OSD timeline, buffer indicator, elapsed/remaining duration.
  - Quick 10-second skip forward/back with visual pulse indicators.
  - Auto-hides OSD after 3.5 seconds of inactivity.
- **Watch History & Resume:**
  - Remembers the exact playback second where you paused.
  - "Resume" button appears automatically in the Details view and Continue Watching carousel.
- **Automatic Subtitles:**
  - Automatically detects sidecar `.srt` files with the same name on your FTP server.
  - Converts SRT to WebVTT on-the-fly and loads it into the HTML5 video track.
- **Optional TMDB Metadata Enrichment:**
  - Enter an optional free TheMovieDB (TMDB) API key in Settings to automatically fetch high-res movie posters, fanart backdrops, and synopses.
  - Generates beautiful procedural SVG gradient posters if no API key or internet access is available.

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────┐
│                   Samsung Smart TV                     │
│                                                        │
│  ┌─────────────────────────┐  HTTP API & Stream (206)  │
│  │   TizenBrew Webview     │ ◄──────────────────────┐  │
│  │   (Plex UI / HTML5 Video)│                        │  │
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
            │ (NAS, Seedbox, Linux Box) │
            └───────────────────────────┘
```

---

## 🚀 Installation on Samsung TV (via TizenBrew)

### Prerequisites
1. A Samsung Smart TV running **Tizen 3.0+** (2017 or newer).
2. **TizenBrew** installed on your TV (follow the official [TizenBrew Guide](https://github.com/reisxd/TizenBrew)).

### Adding the App to TizenBrew
1. Launch **TizenBrew** on your TV.
2. Go to the **Module Manager / Add Module** option (or use the desktop **TizenBrewInstaller**).
3. Enter this GitHub repository identifier:
   ```text
   Owais5514/tizenbrew-plex-ftp
   ```
4. Confirm installation. TizenBrew will download the module and add the **Plex FTP Player** icon to your launcher.

---

## ⚙️ Configuration

1. Launch **Plex FTP Player** from TizenBrew.
2. In the left sidebar, click **Settings** (gear icon).
3. Fill in your FTP server details:
   - **FTP Server Host / IP:** e.g., `192.168.1.100` or `ftp.myserver.com`
   - **Port:** `21` (default)
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
git clone https://github.com/Owais5514/tizenbrew-plex-ftp.git
cd tizenbrew-plex-ftp

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
| **Fast Forward / Rewind** | Seek forward / backward by 10-15 seconds |
| **Stop** | Exit video player |

---

## 📄 License

MIT License. Feel free to fork, customize, and extend for your personal home theater setup!
