# CachyOS Package Manager

A sleek, lightweight, and modern desktop GUI for package management on **CachyOS** and **Arch Linux**, built with **Tauri 2.0 (Rust)** and **TypeScript (Vite)**. 

> [!IMPORTANT]
> **Fully Created by AI:** This entire application, including the Rust backend architecture, TypeScript frontend, responsive CSS glassmorphic style system, and custom compiled assets, was designed, architected, and coded by **Antigravity** (an agentic AI coding assistant designed by the Google DeepMind team), rather than a human developer.

---

## Key Features

- **AUR & Official Repositories Support:** Unified query search and installation wrapper for standard system repositories via `pacman` and the Arch User Repository (AUR) via `paru`.
- **Offline & Online Historical Version Rollbacks:** 
  - Scan the local pacman cache (`/var/cache/pacman/pkg/`) for previous package versions to support quick downgrades.
  - Dynamically query and download historical packages directly from the official **Arch Linux Archive (ALA)** index using native thread parsing.
- **Secure Transaction Streams:** Custom non-root backend orchestration that executes system modifications via standard GUI Polkit escalation (`pkexec pacman`) and streams live `stdout`/`stderr` terminal lines straight to the frontend.
- **Drag-Resizable Log Terminal:** Real-time log monitor console with an ergonomic 8px hover handle and a thinned 2px glowing neon-green border. Caches user height preferences and transitions smoothly between collapsed and expanded states.
- **Dynamic Layout Switcher:** Instant, zero-render-overhead transition between high-density compact List/Table rows and modern Grid cards.
- **SWR (Stale-While-Revalidate) Cache:** Custom client-side caching guarantees `0ms` tab transitions between categories while fetching fresh states in a lock-guarded background thread.
- **Sleek Dark Glassmorphism Aesthetics:** Vibrant neon-green (`#00ff66`) CachyOS branding, glowing pulsing status indicators, premium custom-styled chevrons, and vertical menu ribbon bars.
- **High-Fidelity Browser Preview Fallback:** Detects standard web runtimes and switches into an offline interactive diagnostic preview with rich mock data, making it easy to test UI designs inside any browser window.

---

## Prerequisites

To run or build the application, your system requires the following:

- **Operating System:** CachyOS or any Arch Linux-based distribution.
- **System Utilities:**
  - `pacman` (standard system package manager)
  - `paru` (Arch User Repository helper)
  - `checkupdates` (for official repository upgrade checks)
  - `curl` (for fetching remote archive version rollbacks)
- **Developer Tools (only needed for compilation):**
  - Node.js (v18+)
  - Rust toolchain (`cargo`, `rustc`)

---

## Getting Started

### 1. Clone the Repository
```bash
git clone https://github.com/your-username/package-search.git
cd package-search
```

### 2. Install Node Dependencies
```bash
npm install
```

### 3. Run in Development Mode
Launch the application with real-time hot-reloading (both Rust backend edits and frontend changes refresh automatically):
```bash
npm run tauri dev
```

### 4. Build Production Packages
Compile optimized, production-ready system installers. This will build native `.deb` and `.rpm` packages, alongside a raw binary:
```bash
npm run tauri build
```
The output installers will be compiled under:
- `src-tauri/target/release/bundle/deb/`
- `src-tauri/target/release/bundle/rpm/`

---

## System Integration & Icon Mapping

During compilation, Tauri automatically resizes and configures the minimalist 3D neon-green package box icon inside your window environment. To map execution to the system-wide application grid, a `.desktop` file can be registered under `~/.local/share/applications/cachyos-pkgmgr.desktop`:

```ini
[Desktop Entry]
Type=Application
Name=CachyOS Package Manager
Comment=A premium, lightweight package manager GUI for CachyOS / Arch Linux
Exec=/absolute/path/to/package-search/src-tauri/target/release/tauri-app
Icon=/absolute/path/to/package-search/src-tauri/icons/icon.png
Terminal=false
Categories=System;Utility;
StartupWMClass=tauri-app
```

---

## License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.
