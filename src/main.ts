import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LocalPackage, Package, UpgradablePackage, TransactionLine, TransactionStatus } from "./types";

// Detect if running inside Tauri native shell to prevent standard browser runtime crashes
const hasTauri = typeof window !== "undefined" && (window as any).__TAURI__ !== undefined;

// Safe wrapper for backend invoke calls with high-fidelity mockup data for browser previewing
const invoke = hasTauri ? tauriInvoke : async <T>(cmd: string, args?: any): Promise<T> => {
  console.warn(`[Browser Preview] Tauri invoke skipped for command "${cmd}"`, args);
  
  if (cmd === "get_installed_packages") {
    return [
      { name: "cachyos-settings", version: "2026.04.12-1", repo_type: "Official" },
      { name: "bash", version: "5.2.026-2", repo_type: "Official" },
      { name: "paru-bin", version: "2.0.3-1", repo_type: "AUR" },
      { name: "visual-studio-code-bin", version: "1.90.0-1", repo_type: "AUR" },
      { name: "firefox", version: "128.0-1", repo_type: "Official" },
      { name: "neovim", version: "0.10.0-1", repo_type: "Official" },
    ] as any;
  }
  if (cmd === "get_upgradable_packages") {
    return [
      { name: "bash", current_version: "5.2.026-2", new_version: "5.3.0-1", repo_type: "Official" },
      { name: "firefox", current_version: "128.0-1", new_version: "129.0-1", repo_type: "Official" }
    ] as any;
  }
  if (cmd === "get_package_details") {
    const name = args?.pkgName || "unknown";
    return {
      "Name": name,
      "Version": "1.0.0-1",
      "Description": `This is a high-fidelity browser preview mockup for the package ${name}.`,
      "URL": "https://cachyos.org",
      "License": "GPL-3.0",
      "Groups": "None",
      "Provides": name,
      "Depends On": "glibc bash coreutils",
      "Required By": "None",
      "Conflicts With": "None",
      "Replaces": "None",
      "Installed Size": "2.4 MB",
      "Packager": "CachyOS Development Team",
      "Build Date": "2026-05-15",
      "Install Date": "2026-05-20"
    } as any;
  }
  if (cmd === "search_repositories") {
    const query = (args?.query || "").toLowerCase();
    return [
      { name: `${query}-helper`, version: "1.2.4-1", repo: "Official", description: `A premium utility library matching your query "${query}".`, is_installed: false, out_of_date: null },
      { name: `${query}-git`, version: "3.0.0.r45-1", repo: "AUR", description: `Development git snapshot package for "${query}".`, is_installed: false, out_of_date: "2026-05-28" },
      { name: `cachyos-${query}`, version: "2.0-1", repo: "Official", description: `Official CachyOS integration configurations for "${query}".`, is_installed: true, out_of_date: null }
    ] as any;
  }
  if (cmd === "get_cached_versions") {
    return ["1.2.3-1", "1.2.2-2", "1.2.0-1"] as any;
  }
  if (cmd === "get_online_archive_versions") {
    const pkg = args?.pkgName || "package";
    const firstChar = pkg.charAt(0).toLowerCase() || "a";
    return [
      { version: "1.2.3-1", url: `https://archive.archlinux.org/packages/${firstChar}/${pkg}/${pkg}-1.2.3-1-x86_64.pkg.tar.zst` },
      { version: "1.2.2-2", url: `https://archive.archlinux.org/packages/${firstChar}/${pkg}/${pkg}-1.2.2-2-x86_64.pkg.tar.zst` }
    ] as any;
  }
  if (cmd === "execute_package_update" || cmd === "execute_package_uninstall") {
    return `Transaction spawned successfully in preview mode!` as any;
  }
  
  return "" as any;
};

// State Management Variables
let activeView: "discover" | "installed" = "discover";
let installedPackages: LocalPackage[] = [];
let discoverPackages: Package[] = [];
let upgradesList: UpgradablePackage[] = [];
let currentTransactionId: string | null = null;
let currentSearchQuery: string = "";
let terminalCollapsed: boolean = false;
let activeInstalledFilter: "all" | "official" | "aur" | "updates" = "all";
let lastDraggedHeight = 220;
let isDraggingTerminal = false;
let activeLayout: "grid" | "list" = "grid";
let isFetchingInstalledPackages = false;

// DOM Element Selections
let navDiscover!: HTMLElement;
let navInstalled!: HTMLElement;
let searchInput!: HTMLInputElement;
let mainViewTitle!: HTMLElement;
let discoverView!: HTMLElement;
let installedView!: HTMLElement;
let discoverGrid!: HTMLElement;
let installedGrid!: HTMLElement;
let terminalConsole!: HTMLElement;
let terminalHeaderBar!: HTMLElement;
let terminalBody!: HTMLElement;
let terminalTitleText!: HTMLElement;
let terminalSpinner!: HTMLElement;
let terminalAbortBtn!: HTMLButtonElement;
let terminalClearBtn!: HTMLButtonElement;
let terminalToggleBtn!: HTMLButtonElement;
let terminalToggleIcon!: HTMLElement;
let terminalResizer!: HTMLElement;
let layoutToggleBtn!: HTMLButtonElement;
let layoutToggleIcon!: HTMLElement;
let statusIndicator!: HTMLElement;
let statusDescription!: HTMLElement;
let statusPopover!: HTMLElement;

// Installed Filters Elements
let filterAllBtn!: HTMLButtonElement;
let filterOfficialBtn!: HTMLButtonElement;
let filterAurBtn!: HTMLButtonElement;
let filterUpdatesBtn!: HTMLButtonElement;
let allCountBadge!: HTMLElement;
let officialCountBadge!: HTMLElement;
let aurCountBadge!: HTMLElement;
let updatesCountBadge!: HTMLElement;

// Package Details Modal Elements
let modalOverlay!: HTMLElement;
let modalPkgName!: HTMLElement;
let modalPkgVersion!: HTMLElement;
let modalPkgRepo!: HTMLElement;
let modalPkgUpgradeBadge!: HTMLElement;
let modalBodyContent!: HTMLElement;
let modalCloseBtn!: HTMLButtonElement;
let modalCloseFooterBtn!: HTMLButtonElement;
let modalActionBtn!: HTMLButtonElement;
let modalUninstallBtn!: HTMLButtonElement;

// Action Confirmation Modal Elements
let confirmationModal!: HTMLElement;
let confirmModalTitle!: HTMLElement;
let confirmModalDesc!: HTMLElement;
let confirmVersionPickerContainer!: HTMLElement;
let confirmVersionSelect!: HTMLSelectElement;
let confirmModalCloseBtn!: HTMLButtonElement;
let confirmModalActionBtn!: HTMLButtonElement;
let confirmModalCancelBtn!: HTMLButtonElement;

// Initialize Application UI and Event Binding
window.addEventListener("DOMContentLoaded", async () => {
  // Capture UI selectors
  navDiscover = document.getElementById("nav-discover")!;
  navInstalled = document.getElementById("nav-installed")!;
  searchInput = document.getElementById("search-input") as HTMLInputElement;
  mainViewTitle = document.getElementById("main-view-title")!;
  discoverView = document.getElementById("discover-view")!;
  installedView = document.getElementById("installed-view")!;
  discoverGrid = document.getElementById("discover-packages-grid")!;
  installedGrid = document.getElementById("installed-packages-grid")!;
  terminalConsole = document.getElementById("terminal-console")!;
  terminalHeaderBar = document.getElementById("terminal-header-bar")!;
  terminalBody = document.getElementById("terminal-body")!;
  terminalTitleText = document.getElementById("terminal-title-text")!;
  terminalSpinner = document.getElementById("terminal-spinner")!;
  terminalAbortBtn = document.getElementById("terminal-abort-btn") as HTMLButtonElement;
  terminalClearBtn = document.getElementById("terminal-clear-btn") as HTMLButtonElement;
  terminalToggleBtn = document.getElementById("terminal-toggle-btn") as HTMLButtonElement;
  terminalToggleIcon = document.getElementById("terminal-toggle-icon")!;
  terminalResizer = document.getElementById("terminal-resizer")!;
  layoutToggleBtn = document.getElementById("layout-toggle-btn") as HTMLButtonElement;
  layoutToggleIcon = document.getElementById("layout-toggle-icon")!;
  statusIndicator = document.getElementById("status-indicator")!;
  statusDescription = document.getElementById("status-description")!;
  statusPopover = document.getElementById("status-popover")!;

  // Installed Filters
  filterAllBtn = document.getElementById("filter-all-btn") as HTMLButtonElement;
  filterOfficialBtn = document.getElementById("filter-official-btn") as HTMLButtonElement;
  filterAurBtn = document.getElementById("filter-aur-btn") as HTMLButtonElement;
  filterUpdatesBtn = document.getElementById("filter-updates-btn") as HTMLButtonElement;
  allCountBadge = document.getElementById("all-count-badge")!;
  officialCountBadge = document.getElementById("official-count-badge")!;
  aurCountBadge = document.getElementById("aur-count-badge")!;
  updatesCountBadge = document.getElementById("updates-count-badge")!;

  // Details Modal
  modalOverlay = document.getElementById("package-detail-modal")!;
  modalPkgName = document.getElementById("modal-pkg-name")!;
  modalPkgVersion = document.getElementById("modal-pkg-version")!;
  modalPkgRepo = document.getElementById("modal-pkg-repo")!;
  modalPkgUpgradeBadge = document.getElementById("modal-pkg-upgrade-badge")!;
  modalBodyContent = document.getElementById("modal-body-content")!;
  modalCloseBtn = document.getElementById("modal-close-btn") as HTMLButtonElement;
  modalCloseFooterBtn = document.getElementById("modal-close-footer-btn") as HTMLButtonElement;
  modalActionBtn = document.getElementById("modal-action-btn") as HTMLButtonElement;
  modalUninstallBtn = document.getElementById("modal-uninstall-btn") as HTMLButtonElement;

  // Details Modal Assignments
  confirmationModal = document.getElementById("confirmation-modal")!;
  confirmModalTitle = document.getElementById("confirm-modal-title")!;
  confirmModalDesc = document.getElementById("confirm-modal-desc")!;
  confirmVersionPickerContainer = document.getElementById("confirm-version-picker-container")!;
  confirmVersionSelect = document.getElementById("confirm-version-select") as HTMLSelectElement;
  confirmModalCloseBtn = document.getElementById("confirm-modal-close-btn") as HTMLButtonElement;
  confirmModalActionBtn = document.getElementById("confirm-modal-action-btn") as HTMLButtonElement;
  confirmModalCancelBtn = document.getElementById("confirm-modal-cancel-btn") as HTMLButtonElement;

  // Load initially installed & pending packages
  await loadInstalledPackages(true);

  if (!hasTauri) {
    appendTerminalLine(`-- RUNNING IN BROWSER PREVIEW MODE --`, "system");
    appendTerminalLine(`Tauri host shell was not detected. Interacting with packages will use mock data.`, "system");
    appendTerminalLine(`Launch using 'npm run tauri dev' to test with actual system package managers.`, "system");
    
    // Set status indicator
    statusIndicator.className = "status-dot browser-preview";
    statusDescription.textContent = "Browser Preview (Offline)";
  }

  // Configure navigation listeners
  navDiscover.addEventListener("click", () => switchView("discover"));
  navInstalled.addEventListener("click", () => switchView("installed"));

  // Installed Filtering Event Handlers
  filterAllBtn.addEventListener("click", () => switchInstalledFilter("all"));
  filterOfficialBtn.addEventListener("click", () => switchInstalledFilter("official"));
  filterAurBtn.addEventListener("click", () => switchInstalledFilter("aur"));
  filterUpdatesBtn.addEventListener("click", () => switchInstalledFilter("updates"));

  // Modal Closure Bindings
  modalCloseBtn.addEventListener("click", closeDetailsModal);
  modalCloseFooterBtn.addEventListener("click", closeDetailsModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeDetailsModal();
  });

  // Action Confirmation Modal Close Bindings
  confirmModalCloseBtn.addEventListener("click", closeConfirmationModal);
  confirmModalCancelBtn.addEventListener("click", closeConfirmationModal);
  confirmationModal.addEventListener("click", (e) => {
    if (e.target === confirmationModal) closeConfirmationModal();
  });

  // Status Indicator Popover Click Toggle
  const systemStatusContainer = document.getElementById("system-status-container")!;
  systemStatusContainer.addEventListener("click", (e) => {
    e.stopPropagation();
    statusPopover.classList.toggle("active");
  });

  // Global document click closes the active status popover bubble
  document.addEventListener("click", () => {
    statusPopover.classList.remove("active");
  });

  // Debounced discover search handler (300ms)
  const debouncedDiscoverSearch = debounce((query: string) => {
    performDiscoverSearch(query);
  }, 300);

  searchInput.addEventListener("input", (e) => {
    const val = (e.target as HTMLInputElement).value;
    currentSearchQuery = val;
    if (activeView === "discover") {
      debouncedDiscoverSearch(val);
    } else {
      // Instant, client-side in-memory filter for Installed packages
      performInstalledFilter(val);
    }
  });

  // Terminal Controls
  terminalHeaderBar.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest(".terminal-btn")) return;
    toggleTerminal();
  });
  
  terminalToggleBtn.addEventListener("click", toggleTerminal);
  
  terminalClearBtn.addEventListener("click", () => {
    terminalBody.innerHTML = `
      <div class="terminal-line system">-- CachyOS Package Manager Terminal Screen Cleared --</div>
    `;
  });

  terminalAbortBtn.addEventListener("click", handleAbortTransaction);

  // Resizable Terminal via Dragging
  let startDragY = 0;
  let startTerminalHeight = 0;

  terminalResizer.addEventListener("mousedown", (e) => {
    isDraggingTerminal = true;
    startDragY = e.clientY;
    startTerminalHeight = terminalConsole.getBoundingClientRect().height;
    terminalResizer.classList.add("dragging");
    
    // Disable transition temporarily for responsive real-time resizing
    terminalConsole.style.transition = "none";
    
    document.addEventListener("mousemove", handleTerminalMouseMove);
    document.addEventListener("mouseup", handleTerminalMouseUp);
    
    e.preventDefault();
  });

  function handleTerminalMouseMove(e: MouseEvent) {
    if (!isDraggingTerminal) return;
    
    const deltaY = startDragY - e.clientY;
    let newHeight = startTerminalHeight + deltaY;
    
    // Constraints: Min height 42px (collapsed state), Max height 80% of window height
    const maxHeight = window.innerHeight * 0.8;
    if (newHeight < 42) {
      newHeight = 42;
      terminalConsole.classList.add("collapsed");
      terminalCollapsed = true;
    } else {
      terminalConsole.classList.remove("collapsed");
      terminalCollapsed = false;
      lastDraggedHeight = newHeight;
    }
    
    if (newHeight > maxHeight) {
      newHeight = maxHeight;
      lastDraggedHeight = maxHeight;
    }
    
    terminalConsole.style.height = `${newHeight}px`;
  }

  function handleTerminalMouseUp() {
    if (!isDraggingTerminal) return;
    isDraggingTerminal = false;
    terminalResizer.classList.remove("dragging");
    
    // Restore smooth transition for button toggles
    terminalConsole.style.transition = "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)";
    
    document.removeEventListener("mousemove", handleTerminalMouseMove);
    document.removeEventListener("mouseup", handleTerminalMouseUp);
  }

  // Layout Toggle Click listener
  layoutToggleBtn.addEventListener("click", () => {
    activeLayout = activeLayout === "grid" ? "list" : "grid";
    if (activeLayout === "list") {
      discoverGrid.classList.add("list-layout");
      installedGrid.classList.add("list-layout");
      // Show Grid Icon (which switches it back to grid)
      layoutToggleIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />`;
      layoutToggleBtn.title = "Switch to Grid Layout";
    } else {
      discoverGrid.classList.remove("list-layout");
      installedGrid.classList.remove("list-layout");
      // Show List Icon (which switches it back to list)
      layoutToggleIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />`;
      layoutToggleBtn.title = "Switch to List Layout";
    }
  });

  // Bind real-time Tauri IPC events
  setupTauriListeners();
});

// Generic utility for debouncing function invocations
function debounce<T extends (...args: any[]) => void>(func: T, delay: number): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
    }, delay);
  };
}

// Switch dashboard view modes
function switchView(view: "discover" | "installed") {
  if (view === activeView) return;
  activeView = view;
  searchInput.value = "";
  currentSearchQuery = "";

  if (view === "discover") {
    navDiscover.classList.add("active");
    navInstalled.classList.remove("active");
    discoverView.classList.add("active");
    installedView.classList.remove("active");
    
    mainViewTitle.textContent = "Discover Packages";
    searchInput.placeholder = "Search official repositories and AUR...";
    
    renderDiscoverView();
  } else {
    navDiscover.classList.remove("active");
    navInstalled.classList.add("active");
    discoverView.classList.remove("active");
    installedView.classList.add("active");
    
    mainViewTitle.textContent = "Installed Packages";
    searchInput.placeholder = "Filter explicitly installed packages...";
    
    switchInstalledFilter("all"); // Reset updates filter to "All" when switching tabs
  }
}

// Switch between showing all installed packages, official, aur or updates only
async function switchInstalledFilter(filter: "all" | "official" | "aur" | "updates") {
  activeInstalledFilter = filter;
  
  // Reset all active classes
  filterAllBtn.classList.remove("active");
  filterOfficialBtn.classList.remove("active");
  filterAurBtn.classList.remove("active");
  filterUpdatesBtn.classList.remove("active");

  if (filter === "all") {
    filterAllBtn.classList.add("active");
  } else if (filter === "official") {
    filterOfficialBtn.classList.add("active");
  } else if (filter === "aur") {
    filterAurBtn.classList.add("active");
  } else if (filter === "updates") {
    filterUpdatesBtn.classList.add("active");
  }

  // 1. Instant Render: Use currently cached installed packages for absolute 0ms switching
  performInstalledFilter(searchInput.value);

  // 2. Background Revalidation: Fetch fresh list and update UI in background asynchronously
  loadInstalledPackages().then(() => {
    if (activeView === "installed") {
      performInstalledFilter(searchInput.value);
    }
  });
}

// Collapses or expands the transaction output terminal
function toggleTerminal() {
  terminalCollapsed = !terminalCollapsed;
  if (terminalCollapsed) {
    terminalConsole.classList.add("collapsed");
    terminalConsole.style.height = "42px";
    terminalToggleIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />`;
  } else {
    terminalConsole.classList.remove("collapsed");
    terminalConsole.style.height = `${lastDraggedHeight}px`;
    terminalToggleIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />`;
    scrollToBottom();
  }
}

// Scroll terminal logs to bottom automatically
function scrollToBottom() {
  terminalBody.scrollTop = terminalBody.scrollHeight;
}

// Fetch explicitly installed and pending packages from Tauri
async function loadInstalledPackages(force: boolean = false) {
  if (isFetchingInstalledPackages && !force) return;
  isFetchingInstalledPackages = true;
  try {
    const pkgs = await invoke<LocalPackage[]>("get_installed_packages");
    installedPackages = pkgs;
    
    const upgrades = await invoke<UpgradablePackage[]>("get_upgradable_packages");
    upgradesList = upgrades;

    // Count packages for each filter source type
    const totalCount = pkgs.length;
    const officialCount = pkgs.filter(p => p.repo_type === "Official").length;
    const aurCount = pkgs.filter(p => p.repo_type === "AUR").length;
    const installedUpdatesCount = pkgs.filter(pkg => 
      upgrades.some(upg => upg.name === pkg.name)
    ).length;

    // Update count badges dynamically
    if (allCountBadge) allCountBadge.textContent = totalCount.toString();
    if (officialCountBadge) officialCountBadge.textContent = officialCount.toString();
    if (aurCountBadge) aurCountBadge.textContent = aurCount.toString();
    if (updatesCountBadge) updatesCountBadge.textContent = installedUpdatesCount.toString();
  } catch (err) {
    appendTerminalLine(`Error loading package states: ${err}`, "error-log");
  } finally {
    isFetchingInstalledPackages = false;
  }
}

// Trigger package search query to back-end
async function performDiscoverSearch(query: string) {
  const trimmed = query.trim();
  if (trimmed === "") {
    renderEmptyDiscoverState();
    return;
  }

  // Set Search Loading State
  discoverGrid.innerHTML = `
    <div class="empty-state">
      <span class="spinner" style="width: 32px; height: 32px; margin-bottom: 12px; color: var(--primary);"></span>
      <h3>Searching repositories...</h3>
      <p>Fetching packages matching "${query}" from pacman and AUR</p>
    </div>
  `;

  try {
    const results = await invoke<Package[]>("search_repositories", { query: trimmed });
    discoverPackages = results;
    renderDiscoverView();
  } catch (err) {
    appendTerminalLine(`Search error: ${err}`, "error-log");
    discoverGrid.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="color: #ef4444;">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <h3 style="color: #ef4444;">Search Failed</h3>
        <p>${err}</p>
      </div>
    `;
  }
}

// Client-side instant filter for installed packages
function performInstalledFilter(query: string) {
  const trimmed = query.trim().toLowerCase();
  
  let packagesToRender = installedPackages;

  // Filter by active repo/update source type
  if (activeInstalledFilter === "updates") {
    packagesToRender = installedPackages.filter(pkg => 
      upgradesList.some(upg => upg.name === pkg.name)
    );
  } else if (activeInstalledFilter === "official") {
    packagesToRender = installedPackages.filter(pkg => 
      pkg.repo_type === "Official"
    );
  } else if (activeInstalledFilter === "aur") {
    packagesToRender = installedPackages.filter(pkg => 
      pkg.repo_type === "AUR"
    );
  }

  // Filter based on search bar sub-string match
  if (trimmed !== "") {
    packagesToRender = packagesToRender.filter(pkg => 
      pkg.name.toLowerCase().includes(trimmed) || 
      pkg.version.toLowerCase().includes(trimmed)
    );
  }

  mainViewTitle.textContent = `Installed Packages (${packagesToRender.length})`;
  renderInstalledView(packagesToRender);
}

// Renders the search results cards
function renderDiscoverView() {
  if (discoverPackages.length === 0) {
    if (currentSearchQuery.trim() !== "") {
      mainViewTitle.textContent = "Discover Packages (0)";
      discoverGrid.innerHTML = `
        <div class="empty-state">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.182 16.318A4.486 4.486 0 0012.016 15a4.486 4.486 0 00-3.198 1.318M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z" />
          </svg>
          <h3>No Packages Found</h3>
          <p>We couldn't find any official or AUR packages matching "${currentSearchQuery}"</p>
        </div>
      `;
    } else {
      renderEmptyDiscoverState();
    }
    return;
  }

  mainViewTitle.textContent = `Discover Packages (${discoverPackages.length})`;
  discoverGrid.innerHTML = "";
  discoverPackages.forEach(pkg => {
    const card = document.createElement("div");
    
    // Check if upgradable
    const upgrade = upgradesList.find(upg => upg.name === pkg.name);
    const isUpgradable = !!upgrade;
    
    card.className = `package-card${isUpgradable ? " upgradable" : ""}`;
    card.id = `pkg-discover-${pkg.name}`;

    // Click handler to open detailed metadata modal (ignoring buttons)
    card.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(".btn") || target.closest(".installed-badge")) return;
      openPackageDetails(pkg.name, pkg.repo, pkg.is_installed);
    });

    const isAur = pkg.repo.toLowerCase() === "aur";
    const badgeClass = isAur ? "repo-badge aur" : "repo-badge official";
    
    // Header section
    let headerHtml = `
      <div class="package-header">
        <div class="package-meta">
          <span class="package-name">${escapeHtml(pkg.name)}</span>
          <span class="package-version">${escapeHtml(pkg.version)}</span>
        </div>
        <span class="${badgeClass}">${escapeHtml(pkg.repo)}</span>
      </div>
    `;

    // Out-of-date and upgradable alert badges
    let alertBadges = "";
    if (isUpgradable) {
      alertBadges = `<span class="upgrade-badge">Update: ${upgrade!.current_version} ➜ ${upgrade!.new_version}</span>`;
    } else if (pkg.out_of_date) {
      alertBadges = `<span class="out-of-date-badge">AUR Out-of-date: ${escapeHtml(pkg.out_of_date)}</span>`;
    }

    // Description section
    let descHtml = `<p class="package-desc">${escapeHtml(pkg.description || "No description provided.")}</p>`;

    // Action button section
    let buttonHtml = "";
    if (pkg.is_installed) {
      if (isUpgradable) {
        buttonHtml = `
          <div class="package-footer">
            <div style="display: flex; gap: 8px; align-items: center; justify-content: space-between; width: 100%;">
              ${alertBadges}
              <div style="display: flex; gap: 8px;">
                <button class="btn btn-upgrade" onclick="window.triggerPackageAction('${pkg.name}', '${upgrade!.repo_type}', true)">Update</button>
                <button class="btn btn-accent" onclick="window.triggerUninstallAction('${pkg.name}', '${upgrade!.repo_type}')">Uninstall</button>
              </div>
            </div>
          </div>
        `;
      } else {
        buttonHtml = `
          <div class="package-footer">
            <div style="display: flex; gap: 8px; align-items: center; justify-content: space-between; width: 100%;">
              ${alertBadges}
              <div style="display: flex; gap: 8px; align-items: center;">
                <span class="installed-badge">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" style="width: 14px; height: 14px;">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  Installed
                </span>
                <div style="display: flex; gap: 8px; margin-left: 8px;">
                  <button class="btn btn-secondary" onclick="window.triggerPackageAction('${pkg.name}', '${pkg.repo}', true)">Reinstall</button>
                  <button class="btn btn-accent" onclick="window.triggerUninstallAction('${pkg.name}', '${pkg.repo}')">Uninstall</button>
                </div>
              </div>
            </div>
          </div>
        `;
      }
    } else {
      buttonHtml = `
        <div class="package-footer">
          <div style="display: flex; gap: 8px; align-items: center; justify-content: space-between; width: 100%;">
            ${alertBadges}
            <button class="btn btn-primary" onclick="window.triggerPackageAction('${pkg.name}', '${pkg.repo}', false)">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 16px; height: 16px;">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Install
            </button>
          </div>
        </div>
      `;
    }

    card.innerHTML = headerHtml + descHtml + buttonHtml;
    discoverGrid.appendChild(card);
  });
}

// Renders empty discover state
function renderEmptyDiscoverState() {
  mainViewTitle.textContent = "Discover Packages";
  discoverGrid.innerHTML = `
    <div class="empty-state">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
      </svg>
      <h3>Start Searching</h3>
      <p>Type in the search bar above to look up unified official repository and AUR packages.</p>
    </div>
  `;
}

// Renders the local explicitly installed packages cards
function renderInstalledView(packagesList: LocalPackage[]) {
  if (packagesList.length === 0) {
    const textContext = activeInstalledFilter === "updates" ? "pending upgradable updates" : `installed packages matching "${currentSearchQuery}"`;
    installedGrid.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9.75 9.75c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z" />
        </svg>
        <h3>No Matching Installed Packages</h3>
        <p>No local explicitly ${textContext}</p>
      </div>
    `;
    return;
  }

  installedGrid.innerHTML = "";
  packagesList.forEach(pkg => {
    const card = document.createElement("div");
    
    // Check if upgradable
    const upgrade = upgradesList.find(upg => upg.name === pkg.name);
    const isUpgradable = !!upgrade;
    
    card.className = `package-card${isUpgradable ? " upgradable" : ""}`;
    card.id = `pkg-installed-${pkg.name}`;

    // Click handler to open detailed metadata modal (ignoring buttons)
    card.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(".btn") || target.closest(".installed-badge")) return;
      openPackageDetails(pkg.name, pkg.repo_type, true);
    });

    // Standard header
    const isAur = pkg.repo_type.toLowerCase() === "aur";
    const badgeClass = isAur ? "repo-badge aur" : "repo-badge official";
    
    let headerHtml = `
      <div class="package-header">
        <div class="package-meta">
          <span class="package-name">${escapeHtml(pkg.name)}</span>
          <span class="package-version">${escapeHtml(pkg.version)}</span>
        </div>
        <span class="${badgeClass}">${escapeHtml(pkg.repo_type)}</span>
      </div>
    `;

    // Out-of-date and upgradable alert badges
    let alertBadges = "";
    if (isUpgradable) {
      alertBadges = `<span class="upgrade-badge">Update: ${upgrade!.current_version} ➜ ${upgrade!.new_version}</span>`;
    }

    let descHtml = `<p class="package-desc">Explicitly installed system package.</p>`;

    let buttonHtml = "";
    if (isUpgradable) {
      buttonHtml = `
        <div class="package-footer">
          <div style="display: flex; gap: 8px; align-items: center; justify-content: space-between; width: 100%;">
            ${alertBadges}
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-upgrade" onclick="window.triggerPackageAction('${pkg.name}', '${upgrade!.repo_type}', true)">Update</button>
              <button class="btn btn-accent" onclick="window.triggerUninstallAction('${pkg.name}', '${upgrade!.repo_type}')">Uninstall</button>
            </div>
          </div>
        </div>
      `;
    } else {
      buttonHtml = `
        <div class="package-footer">
          <div style="display: flex; gap: 8px; align-items: center; justify-content: space-between; width: 100%;">
            ${alertBadges}
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary" onclick="window.triggerPackageAction('${pkg.name}', 'official', true)">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 16px; height: 16px;">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
                Reinstall
              </button>
              <button class="btn btn-accent" onclick="window.triggerUninstallAction('${pkg.name}', 'official')">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 16px; height: 16px;">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
                Uninstall
              </button>
            </div>
          </div>
        </div>
      `;
    }

    card.innerHTML = headerHtml + descHtml + buttonHtml;
    installedGrid.appendChild(card);
  });
}

// Trigger installation or upgrade pipeline
// Confirmation Modal Display
function openConfirmationModal(
  title: string,
  description: string,
  actionText: string,
  actionClass: string,
  showVersionPicker: boolean,
  pkgName: string,
  repoType: string,
  onConfirm: (selectedVersion?: string) => void
) {
  confirmModalTitle.textContent = title;
  confirmModalDesc.textContent = description;
  confirmModalActionBtn.textContent = actionText;
  confirmModalActionBtn.className = `btn ${actionClass}`;
  
  if (showVersionPicker) {
    confirmVersionPickerContainer.style.display = "flex";
    confirmVersionSelect.innerHTML = `<option value="">Latest version (from repositories)</option>`;
    confirmVersionSelect.disabled = true;
    
    // Set to prevent duplicate version list options
    const addedVersions = new Set<string>();
    
    // 1. Fetch cached versions first in background (instantaneous)
    invoke<string[]>("get_cached_versions", { pkgName })
      .then(versions => {
        confirmVersionSelect.disabled = false;
        if (versions && versions.length > 0) {
          versions.forEach(ver => {
            if (!addedVersions.has(ver)) {
              addedVersions.add(ver);
              const opt = document.createElement("option");
              opt.value = ver;
              opt.textContent = `${ver} (cached local rollback)`;
              confirmVersionSelect.appendChild(opt);
            }
          });
        }
      })
      .catch(err => {
        confirmVersionSelect.disabled = false;
        console.error("Error fetching cached versions:", err);
        appendTerminalLine(`Failed to fetch cached versions for ${pkgName}: ${err}`, "error-log");
      });

    // 2. Parallel Online Fetch: Query Arch Linux Archive (ALA) dynamically for Official packages
    const isAur = repoType.toLowerCase() === "aur";
    if (!isAur) {
      interface OnlineVersion {
        version: string;
        url: string;
      }
      
      invoke<OnlineVersion[]>("get_online_archive_versions", { pkgName })
        .then(onlineVersions => {
          confirmVersionSelect.disabled = false;
          if (onlineVersions && onlineVersions.length > 0) {
            onlineVersions.forEach(online => {
              if (!addedVersions.has(online.version)) {
                addedVersions.add(online.version);
                const opt = document.createElement("option");
                opt.value = online.url; // Use direct archive download URL
                opt.textContent = `${online.version} (online Archive download)`;
                confirmVersionSelect.appendChild(opt);
              }
            });
          }
        })
        .catch(err => {
          console.error("Error fetching online archive versions:", err);
          appendTerminalLine(`Could not fetch online archive rollback listings: ${err}`, "system");
        });
    }
  } else {
    confirmVersionPickerContainer.style.display = "none";
  }
  
  // Set up confirm action click handler
  confirmModalActionBtn.onclick = () => {
    const selectedVersion = confirmVersionSelect.value;
    closeConfirmationModal();
    onConfirm(selectedVersion || undefined);
  };
  
  confirmationModal.classList.add("active");
}

// Trigger installation or upgrade pipeline
async function handlePackageAction(pkgName: string, repoType: string, isReinstall: boolean) {
  if (isReinstall) {
    openConfirmationModal(
      `Confirm Reinstall: ${pkgName}`,
      `Are you sure you want to reinstall ${pkgName}? Reinstalling will download and apply the package again.`,
      `Reinstall`,
      `btn-upgrade`, // Orange confirmation button
      true, // Show version picker
      pkgName,
      repoType,
      (selectedVersion) => {
        executePackageUpdateTransaction(pkgName, repoType, true, selectedVersion);
      }
    );
  } else {
    executePackageUpdateTransaction(pkgName, repoType, false);
  }
}

// Trigger uninstallation pipeline
async function handleUninstallAction(pkgName: string, repoType: string) {
  openConfirmationModal(
    `Confirm Uninstall: ${pkgName}`,
    `Are you sure you want to uninstall ${pkgName}? This will run 'pacman -Rns' which removes the package, its configuration, and any unneeded dependencies. This action cannot be undone.`,
    `Uninstall`,
    `btn-accent`, // Red confirmation button
    false, // Hide version picker
    pkgName,
    repoType,
    () => {
      executePackageUninstallTransaction(pkgName);
    }
  );
}

// Execute update/installation transaction
async function executePackageUpdateTransaction(pkgName: string, repoType: string, isReinstall: boolean, version?: string) {
  if (currentTransactionId) {
    appendTerminalLine(`Cannot start transaction for "${pkgName}": Another transaction is active.`, "error-log");
    return;
  }

  // Create unique transaction identifier
  const transactionId = `tx_${Date.now()}`;
  currentTransactionId = transactionId;

  // Close details modal if open
  closeDetailsModal();

  // Collapse/Expand logic to display console if collapsed
  if (terminalCollapsed) {
    toggleTerminal();
  }

  // Visual status indicators
  const actionText = isReinstall ? "Reinstalling" : "Installing";
  setSystemBusy(true, `${actionText} ${pkgName}`);
  
  // Disable button actions by updating card styles
  const card = document.getElementById(`pkg-discover-${pkgName}`) || document.getElementById(`pkg-installed-${pkgName}`);
  if (card) {
    card.classList.add("installing");
  }

  const logVer = version ? ` [Version: ${version}]` : "";
  appendTerminalLine(`-- Spawning ${actionText.toLowerCase()} transaction ${transactionId} for "${pkgName}" [${repoType}]${logVer} --`, "system");
  
  if (version) {
    const isUrl = version.startsWith("http://") || version.startsWith("https://");
    const sourceDesc = isUrl ? "online package from Arch Linux Archive" : "offline cached version";
    appendTerminalLine(`[System] Downgrading/installing ${sourceDesc} via pacman -U. Polkit escalation (pkexec) will request system auth...`, "system");
  } else if (repoType.toLowerCase() === "aur") {
    appendTerminalLine(`[System] Initiating Aur Helper (paru). Sudo privilege authentication may be requested...`, "system");
  } else {
    appendTerminalLine(`[System] Initiating Pacman write action. Polkit escalation (pkexec) will request system auth...`, "system");
  }

  try {
    const startMsg = await invoke<string>("execute_package_update", {
      pkgName,
      repoType,
      transactionId,
      version: version || null
    });
    appendTerminalLine(`[System] ${startMsg}`, "system");
  } catch (err) {
    appendTerminalLine(`[System Error] Spawning package manager failed: ${err}`, "error-log");
    // Rollback state immediately
    setSystemBusy(false);
    if (card) {
      card.classList.remove("installing");
    }
    currentTransactionId = null;
  }
}

// Execute uninstallation transaction
async function executePackageUninstallTransaction(pkgName: string) {
  if (currentTransactionId) {
    appendTerminalLine(`Cannot start transaction for "${pkgName}": Another transaction is active.`, "error-log");
    return;
  }

  const transactionId = `tx_${Date.now()}`;
  currentTransactionId = transactionId;

  // Close details modal if open
  closeDetailsModal();

  // Collapse/Expand logic to display console if collapsed
  if (terminalCollapsed) {
    toggleTerminal();
  }

  // Visual status indicators
  setSystemBusy(true, `Uninstalling ${pkgName}`);
  
  // Disable button actions by updating card styles
  const card = document.getElementById(`pkg-discover-${pkgName}`) || document.getElementById(`pkg-installed-${pkgName}`);
  if (card) {
    card.classList.add("installing");
  }

  appendTerminalLine(`-- Spawning uninstall transaction ${transactionId} for "${pkgName}" --`, "system");
  appendTerminalLine(`[System] Initiating Pacman removal action. Polkit escalation (pkexec) will request system auth...`, "system");

  try {
    const startMsg = await invoke<string>("execute_package_uninstall", {
      pkgName,
      transactionId
    });
    appendTerminalLine(`[System] ${startMsg}`, "system");
  } catch (err) {
    appendTerminalLine(`[System Error] Spawning package uninstallation failed: ${err}`, "error-log");
    // Rollback state immediately
    setSystemBusy(false);
    if (card) {
      card.classList.remove("installing");
    }
    currentTransactionId = null;
  }
}

// Request backend to terminate current transaction process
async function handleAbortTransaction() {
  if (!currentTransactionId) return;

  appendTerminalLine(`[System] Dispatching SIGKILL to transaction process...`, "error-log");
  try {
    const res = await invoke<string>("cancel_transaction", { transactionId: currentTransactionId });
    appendTerminalLine(`[System] ${res}`, "error-log");
  } catch (err) {
    appendTerminalLine(`[System Error] Failed to abort transaction: ${err}`, "error-log");
  }
}

// ==========================================================================
// Interactive Package Details Modal Controller
// ==========================================================================
async function openPackageDetails(pkgName: string, repo: string, isInstalled: boolean) {
  // Activate modal overlay
  modalOverlay.classList.add("active");
  
  // Display default/loading state in modal header
  modalPkgName.textContent = pkgName;
  modalPkgVersion.textContent = "...";
  modalPkgRepo.textContent = repo;
  modalPkgRepo.className = repo.toLowerCase() === "aur" ? "repo-badge aur" : "repo-badge official";
  
  // Determine if update is available
  const upgrade = upgradesList.find(upg => upg.name === pkgName);
  const isUpgradable = !!upgrade;
  
  if (isUpgradable) {
    modalPkgUpgradeBadge.style.display = "inline-block";
    modalPkgUpgradeBadge.textContent = `Update: ${upgrade!.current_version} ➜ ${upgrade!.new_version}`;
  } else {
    modalPkgUpgradeBadge.style.display = "none";
  }

  // Set action button text inside footer
  modalActionBtn.className = isUpgradable ? "btn btn-upgrade" : "btn btn-primary";
  if (isUpgradable) {
    modalActionBtn.innerHTML = `Update`;
    modalActionBtn.onclick = () => handlePackageAction(pkgName, upgrade!.repo_type, true);
  } else if (isInstalled) {
    modalActionBtn.innerHTML = `Reinstall`;
    modalActionBtn.onclick = () => handlePackageAction(pkgName, repo, true);
  } else {
    modalActionBtn.innerHTML = `Install`;
    modalActionBtn.onclick = () => handlePackageAction(pkgName, repo, false);
  }

  // Manage Uninstall button inside the details modal
  if (isInstalled) {
    modalUninstallBtn.style.display = "inline-flex";
    modalUninstallBtn.onclick = () => {
      closeDetailsModal();
      handleUninstallAction(pkgName, repo);
    };
  } else {
    modalUninstallBtn.style.display = "none";
  }

  // Display Spinner
  modalBodyContent.innerHTML = `
    <div class="modal-spinner-container">
      <span class="spinner" style="width: 32px; height: 32px; color: var(--primary);"></span>
      <div style="margin-top: 12px; font-size: 0.9rem; color: var(--text-muted);">Fetching rich metadata...</div>
    </div>
  `;

  try {
    const details = await invoke<Record<string, string>>("get_package_details", { pkgName });
    
    // Set actual loaded version
    if (details["Version"]) {
      modalPkgVersion.textContent = details["Version"];
    }

    // Build modern description table layout
    let tableHtml = `<div class="modal-details-table">`;
    for (const [key, value] of Object.entries(details)) {
      // Ignore redundant or very long keys to keep presentation crisp, or style them specially
      let valHtml = "";
      
      if (key.toLowerCase() === "url") {
        valHtml = `<a href="${escapeHtml(value)}" target="_blank">${escapeHtml(value)}</a>`;
      } else if (
        key.toLowerCase() === "depends on" || 
        key.toLowerCase() === "required by" || 
        key.toLowerCase() === "optional deps" || 
        key.toLowerCase() === "conflicts with" ||
        key.toLowerCase() === "provides"
      ) {
        valHtml = `<div class="details-val code-font">${escapeHtml(value)}</div>`;
      } else {
        valHtml = escapeHtml(value);
      }

      tableHtml += `
        <div class="details-row">
          <div class="details-key">${escapeHtml(key)}</div>
          <div class="details-val">${valHtml}</div>
        </div>
      `;
    }
    tableHtml += `</div>`;
    modalBodyContent.innerHTML = tableHtml;
  } catch (err) {
    modalBodyContent.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="color: #ef4444; width: 36px; height: 36px;">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <h3 style="color: #ef4444;">Failed to Load Metadata</h3>
        <p>${err}</p>
      </div>
    `;
  }
}

function closeDetailsModal() {
  modalOverlay.classList.remove("active");
}

function closeConfirmationModal() {
  confirmationModal.classList.remove("active");
}

// Configures Tauri socket event listeners
function setupTauriListeners() {
  // Listen for live transaction log lines
  listen<TransactionLine>("tx-log", (event) => {
    const payload = event.payload;
    if (payload.transaction_id !== currentTransactionId) return;
    
    appendTerminalLine(payload.content, payload.stream);
  });

  // Listen for transaction completions
  listen<TransactionStatus>("tx-complete", async (event) => {
    const payload = event.payload;
    if (payload.transaction_id !== currentTransactionId) return;

    if (payload.success) {
      appendTerminalLine(`-- Transaction ${payload.transaction_id} completed successfully! (Exit Code: ${payload.exit_code}) --`, "system");
    } else {
      appendTerminalLine(`-- Transaction ${payload.transaction_id} terminated or failed! (Exit Code: ${payload.exit_code}) --`, "error-log");
    }

    // Reset status indicators
    setSystemBusy(false);
    
    // Clear card active visual overlays
    const cards = document.querySelectorAll(".package-card.installing");
    cards.forEach(c => c.classList.remove("installing"));

    currentTransactionId = null;

    // Refresh states and re-draw lists
    await loadInstalledPackages(true);
    
    if (activeView === "discover") {
      if (currentSearchQuery.trim() !== "") {
        await performDiscoverSearch(currentSearchQuery);
      }
    } else {
      performInstalledFilter(searchInput.value);
    }
  });
}


// Visual indicator toggles
function setSystemBusy(busy: boolean, taskName: string = "") {
  if (busy) {
    statusIndicator.className = "status-dot active-work";
    statusDescription.textContent = taskName;
    statusDescription.classList.add("pulse-text");
    
    statusPopover.textContent = taskName;
    statusPopover.classList.add("busy");
    
    terminalTitleText.textContent = `Transaction Terminal - ${taskName}`;
    terminalSpinner.style.display = "inline-block";
    terminalAbortBtn.classList.add("active");
  } else {
    statusIndicator.className = "status-dot";
    statusDescription.textContent = "Pacman & Paru connected";
    statusDescription.classList.remove("pulse-text");
    
    statusPopover.textContent = "Pacman & Paru connected";
    statusPopover.classList.remove("busy");
    
    terminalTitleText.textContent = "Terminal Log";
    terminalSpinner.style.display = "none";
    terminalAbortBtn.classList.remove("active");
  }
}

// Safely appends an output log line to the terminal screen
function appendTerminalLine(text: string, type: string) {
  const lineEl = document.createElement("div");
  lineEl.className = `terminal-line ${type}`;
  lineEl.textContent = text;
  terminalBody.appendChild(lineEl);
  scrollToBottom();
}

// Utility to escape raw HTML text and prevent injection
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Expose the card action trigger globally to bind with HTML inline click handlers
(window as any).triggerPackageAction = handlePackageAction;
(window as any).triggerUninstallAction = handleUninstallAction;
