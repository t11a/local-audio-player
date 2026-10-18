/**
 * 英語のハノン Player — Hanon Audio Trainer
 * Standalone Audio Player for Hanon Drills
 */

(function () {
  'use strict';

  // --- State ---
  const state = {
    allTracks: [],          // [{ id, trackNum, unit, subUnit, title, fileName, file, blobUrl }]
    unitGroups: {},         // { "Unit 1": [tracks...], ... }
    selectedTrackIds: new Set(),
    queue: [],              // Array of track objects currently in play queue
    currentQueueIndex: -1,  // Currently playing track index in queue
    isPlaying: false,
    repeatMode: 'none',     // 'none' | 'all' | 'one'
    playbackRate: 1.0,
    volume: 1.0,
    isMuted: false,
    filterText: '',
  };

  // --- DOM Elements ---
  const el = {
    // Header & Files
    folderInput: document.getElementById('folderInput'),
    openFolderBtn: document.getElementById('openFolderBtn'),
    browseBtn: document.getElementById('browseBtn'),
    folderBtnText: document.getElementById('folderBtnText'),
    loadedBadge: document.getElementById('loadedBadge'),
    loadedCount: document.getElementById('loadedCount'),
    dropZone: document.getElementById('dropZone'),
    contentArea: document.getElementById('contentArea'),
    helpBtn: document.getElementById('helpBtn'),
    helpModal: document.getElementById('helpModal'),
    closeHelpBtn: document.getElementById('closeHelpBtn'),

    // Track List Panel
    totalTracksLabel: document.getElementById('totalTracksLabel'),
    trackSearch: document.getElementById('trackSearch'),
    selectAllBtn: document.getElementById('selectAllBtn'),
    deselectAllBtn: document.getElementById('deselectAllBtn'),
    toggleExpandAllBtn: document.getElementById('toggleExpandAllBtn'),
    queueSelectedBtn: document.getElementById('queueSelectedBtn'),
    selectedCountBadge: document.getElementById('selectedCountBadge'),
    unitGroupsContainer: document.getElementById('unitGroupsContainer'),

    // Queue Panel
    queueCounter: document.getElementById('queueCounter'),
    clearQueueBtn: document.getElementById('clearQueueBtn'),
    queueStatusText: document.getElementById('queueStatusText'),
    queueListContainer: document.getElementById('queueListContainer'),

    // Bottom Player
    audioElement: document.getElementById('audioElement'),
    artWaves: document.getElementById('artWaves'),
    trackArtwork: document.querySelector('.track-artwork'),
    nowPlayingTitle: document.getElementById('nowPlayingTitle'),
    nowPlayingSubtitle: document.getElementById('nowPlayingSubtitle'),
    repeatBtn: document.getElementById('repeatBtn'),
    repeatIndicator: document.getElementById('repeatIndicator'),
    prevBtn: document.getElementById('prevBtn'),
    skipBackBtn: document.getElementById('skipBackBtn'),
    playPauseBtn: document.getElementById('playPauseBtn'),
    playIcon: document.getElementById('playIcon'),
    pauseIcon: document.getElementById('pauseIcon'),
    skipFwdBtn: document.getElementById('skipFwdBtn'),
    nextBtn: document.getElementById('nextBtn'),
    currentTimeLabel: document.getElementById('currentTimeLabel'),
    totalTimeLabel: document.getElementById('totalTimeLabel'),
    progressBarContainer: document.getElementById('progressBarContainer'),
    progressBar: document.getElementById('progressBar'),
    progressBuffered: document.getElementById('progressBuffered'),
    seekSlider: document.getElementById('seekSlider'),
    speedBtn: document.getElementById('speedBtn'),
    speedMenu: document.getElementById('speedMenu'),
    volumeBtn: document.getElementById('volumeBtn'),
    volHighIcon: document.getElementById('volHighIcon'),
    volMuteIcon: document.getElementById('volMuteIcon'),
    volumeSlider: document.getElementById('volumeSlider'),
  };

  // --- Track Parsing & Natural Sorting ---
  const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  /**
   * Parse audio metadata flexibly for any textbook, drill, or music folder:
   * Handles Unit, Chapter, Lesson, Part, Section, Day, CD, subfolder names, or natural grouping.
   */
  function parseTrackMetadata(file, id) {
    const fileName = file.name;
    const relPath = file.webkitRelativePath || '';
    const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');

    let groupKey = '';
    let title = nameWithoutExt;

    // 1. Try to detect common textbook grouping patterns in filename
    const groupRegex = /(Unit|Chapter|Lesson|Part|Section|Day|CD|Disc|Vol|Volume)\s*(\d+)/i;
    const groupMatch = fileName.match(groupRegex);

    if (groupMatch) {
      const label = groupMatch[1].charAt(0).toUpperCase() + groupMatch[1].slice(1).toLowerCase();
      groupKey = `${label} ${parseInt(groupMatch[2], 10)}`;

      // Special handling for Hanon/textbooks with decimals like "Unit 1.2"
      const subMatch = fileName.match(/(?:Unit|Chapter|Lesson|Part)\s*(\d+(?:\.\d+)?)/i);
      if (subMatch) {
        title = `${label} ${subMatch[1]}`;
      }
    } else if (relPath && relPath.includes('/')) {
      // 2. If inside a subfolder, use the direct parent folder name as group
      const parts = relPath.split('/');
      if (parts.length >= 2) {
        groupKey = parts[parts.length - 2];
      }
    }

    if (!groupKey) {
      groupKey = 'すべてのトラック';
    }

    // Clean up title if it starts with "01_", "01 -", etc.
    const cleanTitle = title.replace(/^(\d+)[\s_-]+/, '').trim();
    if (cleanTitle && cleanTitle.length > 2) {
      // Keep title friendly
      title = cleanTitle;
    }

    // Extract track number from start of filename or fallback to index
    const numMatch = fileName.match(/^(\d+)/);
    const trackNum = numMatch ? parseInt(numMatch[1], 10) : id + 1;

    return {
      id: `track-${id}`,
      trackNum,
      groupKey,
      unitKey: groupKey, // alias for consistency
      title: title || nameWithoutExt,
      fileName,
      file,
      blobUrl: null,
    };
  }

  function sortTracks(tracks) {
    return tracks.sort((a, b) => {
      // Natural filename sort ensures "01_...", "02_...", "10_..." order correctly
      return naturalCollator.compare(a.fileName, b.fileName);
    });
  }

  // --- Load Audio Files ---
  async function handleFiles(fileList) {
    const audioFiles = Array.from(fileList).filter((f) => {
      const name = f.name.toLowerCase();
      return name.endsWith('.mp3') || name.endsWith('.m4a') || name.endsWith('.wav') || name.endsWith('.aac') || name.endsWith('.ogg') || f.type.startsWith('audio/');
    });

    if (audioFiles.length === 0) {
      alert('音声ファイル（.mp3 など）が見つかりませんでした。音声ファイルが入ったフォルダを選択してください。');
      return;
    }

    // Revoke previous blob URLs to free memory
    state.allTracks.forEach((t) => {
      if (t.blobUrl) URL.revokeObjectURL(t.blobUrl);
    });

    // Parse all tracks
    const parsed = audioFiles.map((f, idx) => parseTrackMetadata(f, idx));
    state.allTracks = sortTracks(parsed);

    // Group tracks
    state.unitGroups = {};
    state.allTracks.forEach((track) => {
      if (!state.unitGroups[track.groupKey]) {
        state.unitGroups[track.groupKey] = [];
      }
      state.unitGroups[track.groupKey].push(track);
    });

    // Update UI states
    el.dropZone.classList.add('hidden');
    el.contentArea.classList.remove('hidden');
    el.loadedBadge.classList.remove('hidden');
    el.loadedCount.textContent = `${state.allTracks.length} 曲 読み込み完了`;
    el.folderBtnText.textContent = 'フォルダ変更';
    el.totalTracksLabel.textContent = `${state.allTracks.length} 曲`;

    // Render group list
    renderTrackList();

    // Select first group's tracks by default for quick start
    const firstGroupKey = Object.keys(state.unitGroups)[0];
    if (firstGroupKey && state.unitGroups[firstGroupKey].length > 0) {
      state.unitGroups[firstGroupKey].forEach((t) => state.selectedTrackIds.add(t.id));
      updateSelectionUI();
    }
  }

  // Recursive Directory Scanner for File System Access API
  async function scanDirectoryEntries(dirHandle, fileList) {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file') {
        const file = await entry.getFile();
        fileList.push(file);
      } else if (entry.kind === 'directory') {
        await scanDirectoryEntries(entry, fileList);
      }
    }
  }

  // File picker handler
  async function openDirectoryPicker() {
    // If showDirectoryPicker is supported in modern browsers
    if ('showDirectoryPicker' in window) {
      try {
        const dirHandle = await window.showDirectoryPicker();
        const files = [];
        await scanDirectoryEntries(dirHandle, files);
        await handleFiles(files);
        return;
      } catch (err) {
        // User cancelled or fallback needed
        if (err.name === 'AbortError') return;
        console.warn('showDirectoryPicker failed, falling back to input:', err);
      }
    }
    // Fallback: Trigger standard webkitdirectory input
    el.folderInput.click();
  }

  // --- Rendering UI ---
  function renderTrackList() {
    el.unitGroupsContainer.innerHTML = '';
    const filter = state.filterText.toLowerCase().trim();

    const unitKeys = Object.keys(state.unitGroups);

    unitKeys.forEach((unitKey, index) => {
      const tracks = state.unitGroups[unitKey];
      const filteredTracks = filter
        ? tracks.filter((t) => t.title.toLowerCase().includes(filter) || t.fileName.toLowerCase().includes(filter))
        : tracks;

      if (filteredTracks.length === 0) return;

      const card = document.createElement('div');
      card.className = `unit-group-card ${index === 0 || filter ? 'expanded' : ''}`;
      card.dataset.unit = unitKey;

      // Group Header
      const header = document.createElement('div');
      header.className = 'unit-group-header';
      header.innerHTML = `
        <div class="unit-header-title">
          <span class="unit-title-text">${unitKey}</span>
          <span class="unit-count-text">(${filteredTracks.length} 曲)</span>
        </div>
        <div class="unit-header-actions">
          <button class="btn btn-sm btn-ghost select-unit-btn" data-unit="${unitKey}">一括選択</button>
          <svg class="unit-toggle-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
      `;

      // Accordion toggle on header click (except when clicking the action button)
      header.addEventListener('click', (e) => {
        if (e.target.closest('.select-unit-btn')) return;
        card.classList.toggle('expanded');
      });

      // Unit batch select button
      const selectUnitBtn = header.querySelector('.select-unit-btn');
      selectUnitBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const allSelected = filteredTracks.every((t) => state.selectedTrackIds.has(t.id));
        filteredTracks.forEach((t) => {
          if (allSelected) {
            state.selectedTrackIds.delete(t.id);
          } else {
            state.selectedTrackIds.add(t.id);
          }
        });
        updateSelectionUI();
      });

      // Track Rows
      const list = document.createElement('div');
      list.className = 'track-items-list';

      filteredTracks.forEach((track) => {
        const isCurrent = state.queue[state.currentQueueIndex]?.id === track.id;
        const isSelected = state.selectedTrackIds.has(track.id);

        const row = document.createElement('div');
        row.className = `track-row ${isSelected ? 'selected' : ''} ${isCurrent ? 'is-current' : ''}`;
        row.dataset.id = track.id;

        row.innerHTML = `
          <div class="track-row-left">
            <input type="checkbox" class="track-checkbox" ${isSelected ? 'checked' : ''}>
            <span class="track-num-badge">${String(track.trackNum).padStart(2, '0')}</span>
            <span class="track-name-text" title="${track.fileName}">${track.title}</span>
          </div>
          <div class="track-row-actions">
            <button class="row-play-btn" title="この曲をすぐ再生">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
            </button>
          </div>
        `;

        // Checkbox change
        const checkbox = row.querySelector('.track-checkbox');
        checkbox.addEventListener('change', (e) => {
          e.stopPropagation();
          if (checkbox.checked) {
            state.selectedTrackIds.add(track.id);
          } else {
            state.selectedTrackIds.delete(track.id);
          }
          updateSelectionUI();
        });

        // Clicking row toggles checkbox
        row.addEventListener('click', (e) => {
          if (e.target.closest('.row-play-btn') || e.target.closest('.track-checkbox')) return;
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event('change'));
        });

        // Direct play button: Play this single track immediately
        const playBtn = row.querySelector('.row-play-btn');
        playBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          playSingleTrackImmediately(track);
        });

        list.appendChild(row);
      });

      card.appendChild(header);
      card.appendChild(list);
      el.unitGroupsContainer.appendChild(card);
    });
  }

  function updateSelectionUI() {
    el.selectedCountBadge.textContent = state.selectedTrackIds.size;

    // Update checkbox DOM elements without re-rendering entire list
    document.querySelectorAll('.track-row').forEach((row) => {
      const id = row.dataset.id;
      const isSelected = state.selectedTrackIds.has(id);
      row.classList.toggle('selected', isSelected);
      const cb = row.querySelector('.track-checkbox');
      if (cb) cb.checked = isSelected;
    });
  }

  function renderQueueList() {
    el.queueListContainer.innerHTML = '';
    el.queueCounter.textContent = `${state.queue.length} 曲`;

    if (state.queue.length === 0) {
      el.queueListContainer.innerHTML = `
        <div class="empty-queue-message">
          <p>左側のトラック一覧で曲にチェックを入れて、<br>「選択曲を再生キューに追加」を押してください。</p>
        </div>
      `;
      el.queueStatusText.textContent = 'キューが空です。';
      return;
    }

    el.queueStatusText.textContent = `全 ${state.queue.length} 曲中 ${state.currentQueueIndex + 1} 曲目を再生中`;

    state.queue.forEach((track, index) => {
      const isActive = index === state.currentQueueIndex;
      const item = document.createElement('div');
      item.className = `queue-item ${isActive ? 'active' : ''}`;
      item.dataset.index = index;

      item.innerHTML = `
        <div class="queue-item-left">
          <span class="queue-order-badge">${index + 1}</span>
          <span class="queue-item-title">${track.title}</span>
        </div>
        <div class="queue-item-right">
          <button class="queue-action-btn remove-queue-btn" title="キューから削除">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      `;

      // Jump to track on click
      item.addEventListener('click', (e) => {
        if (e.target.closest('.remove-queue-btn')) return;
        playTrackAtIndex(index);
      });

      // Remove from queue
      const removeBtn = item.querySelector('.remove-queue-btn');
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFromQueue(index);
      });

      el.queueListContainer.appendChild(item);
    });

    // Auto scroll current playing item into view in queue list
    const activeItem = el.queueListContainer.querySelector('.queue-item.active');
    if (activeItem) {
      activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // --- Queue Actions ---
  function addSelectedToQueue() {
    if (state.selectedTrackIds.size === 0) {
      alert('追加するトラックが選択されていません。左の一覧からチェックを入れてください。');
      return;
    }

    // Filter selected tracks in trackNum order
    const selected = state.allTracks.filter((t) => state.selectedTrackIds.has(t.id));
    state.queue = [...state.queue, ...selected];

    renderQueueList();

    // If audio is currently stopped/idle, start playing first newly added track
    if (state.currentQueueIndex === -1 || el.audioElement.paused) {
      const startIndex = state.currentQueueIndex === -1 ? 0 : state.currentQueueIndex;
      playTrackAtIndex(startIndex);
    }
  }

  function playSingleTrackImmediately(track) {
    // Add track to queue and play immediately
    const existingIndex = state.queue.findIndex((t) => t.id === track.id);
    if (existingIndex !== -1) {
      playTrackAtIndex(existingIndex);
    } else {
      state.queue.push(track);
      playTrackAtIndex(state.queue.length - 1);
    }
  }

  function removeFromQueue(index) {
    const isRemovingCurrent = index === state.currentQueueIndex;
    state.queue.splice(index, 1);

    if (state.queue.length === 0) {
      state.currentQueueIndex = -1;
      stopAudio();
    } else if (isRemovingCurrent) {
      if (index >= state.queue.length) {
        state.currentQueueIndex = 0;
      }
      playTrackAtIndex(state.currentQueueIndex);
    } else if (index < state.currentQueueIndex) {
      state.currentQueueIndex--;
    }

    renderQueueList();
  }

  function clearQueue() {
    state.queue = [];
    state.currentQueueIndex = -1;
    stopAudio();
    renderQueueList();
  }

  // --- Audio Player Controller ---
  function getBlobUrl(track) {
    if (!track.blobUrl) {
      track.blobUrl = URL.createObjectURL(track.file);
    }
    return track.blobUrl;
  }

  function playTrackAtIndex(index) {
    if (index < 0 || index >= state.queue.length) return;

    state.currentQueueIndex = index;
    const track = state.queue[index];

    const src = getBlobUrl(track);
    el.audioElement.src = src;
    el.audioElement.playbackRate = state.playbackRate;
    el.audioElement.volume = state.volume;
    el.audioElement.muted = state.isMuted;

    el.audioElement.play().then(() => {
      state.isPlaying = true;
      updatePlayPauseButton();
    }).catch((err) => {
      console.warn('Playback error / auto-play blocked:', err);
    });

    // Update Bottom Dock Track Info
    el.nowPlayingTitle.textContent = track.title;
    el.nowPlayingSubtitle.textContent = `${track.fileName} (キュー: ${index + 1} / ${state.queue.length})`;
    el.trackArtwork.classList.add('playing');

    renderQueueList();

    // Highlight current in track list as well
    document.querySelectorAll('.track-row').forEach((row) => {
      row.classList.toggle('is-current', row.dataset.id === track.id);
    });
  }

  function togglePlayPause() {
    if (state.queue.length === 0) {
      if (state.selectedTrackIds.size > 0) {
        addSelectedToQueue();
      } else {
        alert('再生する曲がありません。トラックを選択してキューに追加してください。');
      }
      return;
    }

    if (state.currentQueueIndex === -1) {
      playTrackAtIndex(0);
      return;
    }

    if (el.audioElement.paused) {
      el.audioElement.play();
      state.isPlaying = true;
    } else {
      el.audioElement.pause();
      state.isPlaying = false;
    }
    updatePlayPauseButton();
  }

  function stopAudio() {
    el.audioElement.pause();
    el.audioElement.removeAttribute('src');
    state.isPlaying = false;
    updatePlayPauseButton();
    el.nowPlayingTitle.textContent = '再生待機中';
    el.nowPlayingSubtitle.textContent = '曲を選択するかキューを再生してください';
    el.trackArtwork.classList.remove('playing');
    el.currentTimeLabel.textContent = '0:00';
    el.totalTimeLabel.textContent = '0:00';
    el.progressBar.style.width = '0%';
    el.seekSlider.value = 0;
  }

  function updatePlayPauseButton() {
    if (el.audioElement.paused) {
      el.playIcon.classList.remove('hidden');
      el.pauseIcon.classList.add('hidden');
      el.trackArtwork.classList.remove('playing');
    } else {
      el.playIcon.classList.add('hidden');
      el.pauseIcon.classList.remove('hidden');
      el.trackArtwork.classList.add('playing');
    }
  }

  function playNextTrack() {
    if (state.queue.length === 0) return;

    if (state.repeatMode === 'one') {
      // Repeat current track
      el.audioElement.currentTime = 0;
      el.audioElement.play();
      return;
    }

    const nextIndex = state.currentQueueIndex + 1;
    if (nextIndex < state.queue.length) {
      playTrackAtIndex(nextIndex);
    } else {
      // End of queue reached
      if (state.repeatMode === 'all') {
        playTrackAtIndex(0); // loop queue
      } else {
        // Stop playback
        el.trackArtwork.classList.remove('playing');
        updatePlayPauseButton();
      }
    }
  }

  function playPrevTrack() {
    if (state.queue.length === 0) return;

    // If elapsed time > 3s, replay current track from start first
    if (el.audioElement.currentTime > 3) {
      el.audioElement.currentTime = 0;
      return;
    }

    const prevIndex = state.currentQueueIndex - 1;
    if (prevIndex >= 0) {
      playTrackAtIndex(prevIndex);
    } else if (state.repeatMode === 'all') {
      playTrackAtIndex(state.queue.length - 1);
    } else {
      el.audioElement.currentTime = 0;
    }
  }

  function skipTime(seconds) {
    if (!el.audioElement.duration) return;
    el.audioElement.currentTime = Math.max(0, Math.min(el.audioElement.duration, el.audioElement.currentTime + seconds));
  }

  function toggleRepeatMode() {
    const modes = ['none', 'all', 'one'];
    const currentIdx = modes.indexOf(state.repeatMode);
    const nextMode = modes[(currentIdx + 1) % modes.length];
    state.repeatMode = nextMode;

    el.repeatIndicator.textContent = nextMode === 'none' ? 'OFF' : nextMode === 'all' ? 'ALL' : '1';
    el.repeatBtn.classList.toggle('repeat-active', nextMode !== 'none');
  }

  function setPlaybackRate(rate) {
    state.playbackRate = rate;
    el.audioElement.playbackRate = rate;
    el.speedBtn.textContent = `${rate}x`;

    el.speedMenu.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', parseFloat(b.dataset.speed) === rate);
    });
    el.speedMenu.classList.add('hidden');
  }

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // --- Event Listeners ---
  function initEventListeners() {
    // 1. Folder Selection & Drag and Drop
    el.openFolderBtn.addEventListener('click', openDirectoryPicker);
    el.browseBtn.addEventListener('click', openDirectoryPicker);

    el.folderInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFiles(e.target.files);
      }
    });

    // Drag and Drop
    ['dragenter', 'dragover'].forEach((type) => {
      window.addEventListener(type, (e) => {
        e.preventDefault();
        el.dropZone.classList.add('drag-active');
      });
    });

    ['dragleave', 'drop'].forEach((type) => {
      window.addEventListener(type, (e) => {
        e.preventDefault();
        el.dropZone.classList.remove('drag-active');
      });
    });

    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = [];
      if (e.dataTransfer.items) {
        for (let i = 0; i < e.dataTransfer.items.length; i++) {
          const item = e.dataTransfer.items[i];
          if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
            if (entry && entry.isDirectory) {
              await traverseDirectory(entry, files);
            } else {
              const file = item.getAsFile();
              if (file) files.push(file);
            }
          }
        }
      } else if (e.dataTransfer.files) {
        files.push(...Array.from(e.dataTransfer.files));
      }

      if (files.length > 0) {
        handleFiles(files);
      }
    });

    // 2. Track List Filtering & Batch Selection
    el.trackSearch.addEventListener('input', (e) => {
      state.filterText = e.target.value;
      renderTrackList();
    });

    el.selectAllBtn.addEventListener('click', () => {
      state.allTracks.forEach((t) => state.selectedTrackIds.add(t.id));
      updateSelectionUI();
    });

    el.deselectAllBtn.addEventListener('click', () => {
      state.selectedTrackIds.clear();
      updateSelectionUI();
    });

    let isAllExpanded = false;
    el.toggleExpandAllBtn.addEventListener('click', () => {
      isAllExpanded = !isAllExpanded;
      document.querySelectorAll('.unit-group-card').forEach((card) => {
        card.classList.toggle('expanded', isAllExpanded);
      });
      el.toggleExpandAllBtn.textContent = isAllExpanded ? 'すべて折りたたむ' : 'すべて展開';
    });

    el.queueSelectedBtn.addEventListener('click', () => {
      addSelectedToQueue();
    });

    // 3. Queue Controls
    el.clearQueueBtn.addEventListener('click', () => {
      if (confirm('キューをクリアしますか？')) {
        clearQueue();
      }
    });

    // 4. Audio Playback Core Events
    el.playPauseBtn.addEventListener('click', togglePlayPause);
    el.prevBtn.addEventListener('click', playPrevTrack);
    el.nextBtn.addEventListener('click', playNextTrack);
    el.skipBackBtn.addEventListener('click', () => skipTime(-5));
    el.skipFwdBtn.addEventListener('click', () => skipTime(5));
    el.repeatBtn.addEventListener('click', toggleRepeatMode);

    el.audioElement.addEventListener('ended', playNextTrack);

    el.audioElement.addEventListener('timeupdate', () => {
      const cur = el.audioElement.currentTime;
      const dur = el.audioElement.duration || 0;
      el.currentTimeLabel.textContent = formatTime(cur);

      if (dur > 0) {
        const percent = (cur / dur) * 100;
        el.progressBar.style.width = `${percent}%`;
        el.seekSlider.value = percent;
      }
    });

    el.audioElement.addEventListener('loadedmetadata', () => {
      el.totalTimeLabel.textContent = formatTime(el.audioElement.duration);
    });

    el.audioElement.addEventListener('progress', () => {
      if (el.audioElement.buffered.length > 0 && el.audioElement.duration) {
        const bufferedEnd = el.audioElement.buffered.end(el.audioElement.buffered.length - 1);
        const percent = (bufferedEnd / el.audioElement.duration) * 100;
        el.progressBuffered.style.width = `${percent}%`;
      }
    });

    // Seekbar Interaction (Drag & Seek)
    el.seekSlider.addEventListener('input', (e) => {
      const percent = parseFloat(e.target.value);
      el.progressBar.style.width = `${percent}%`;
      if (el.audioElement.duration) {
        const targetTime = (percent / 100) * el.audioElement.duration;
        el.currentTimeLabel.textContent = formatTime(targetTime);
      }
    });

    el.seekSlider.addEventListener('change', (e) => {
      const percent = parseFloat(e.target.value);
      if (el.audioElement.duration) {
        el.audioElement.currentTime = (percent / 100) * el.audioElement.duration;
      }
    });

    // Speed Controls
    el.speedBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      el.speedMenu.classList.toggle('hidden');
    });

    el.speedMenu.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const speed = parseFloat(btn.dataset.speed);
        setPlaybackRate(speed);
      });
    });

    document.addEventListener('click', () => {
      el.speedMenu.classList.add('hidden');
    });

    // Volume Controls
    el.volumeSlider.addEventListener('input', (e) => {
      state.volume = parseFloat(e.target.value);
      el.audioElement.volume = state.volume;
      if (state.volume === 0) {
        state.isMuted = true;
      } else {
        state.isMuted = false;
      }
      updateVolumeIcons();
    });

    el.volumeBtn.addEventListener('click', () => {
      state.isMuted = !state.isMuted;
      el.audioElement.muted = state.isMuted;
      updateVolumeIcons();
    });

    function updateVolumeIcons() {
      if (state.isMuted || state.volume === 0) {
        el.volHighIcon.classList.add('hidden');
        el.volMuteIcon.classList.remove('hidden');
      } else {
        el.volHighIcon.classList.remove('hidden');
        el.volMuteIcon.classList.add('hidden');
      }
    }

    // Help Modal
    el.helpBtn.addEventListener('click', () => el.helpModal.classList.remove('hidden'));
    el.closeHelpBtn.addEventListener('click', () => el.helpModal.classList.add('hidden'));
    el.helpModal.addEventListener('click', (e) => {
      if (e.target === el.helpModal) el.helpModal.classList.add('hidden');
    });

    // 5. Global Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
      // Ignore if user is typing into search input
      if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlayPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          skipTime(-5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          skipTime(5);
          break;
        case 'ArrowUp':
          e.preventDefault();
          state.volume = Math.min(1, Math.round((state.volume + 0.05) * 100) / 100);
          el.audioElement.volume = state.volume;
          el.volumeSlider.value = state.volume;
          state.isMuted = false;
          updateVolumeIcons();
          break;
        case 'ArrowDown':
          e.preventDefault();
          state.volume = Math.max(0, Math.round((state.volume - 0.05) * 100) / 100);
          el.audioElement.volume = state.volume;
          el.volumeSlider.value = state.volume;
          updateVolumeIcons();
          break;
        case 'KeyN':
          e.preventDefault();
          playNextTrack();
          break;
        case 'KeyP':
          e.preventDefault();
          playPrevTrack();
          break;
        case 'KeyR':
          e.preventDefault();
          toggleRepeatMode();
          break;
        case 'Escape':
          el.helpModal.classList.add('hidden');
          el.speedMenu.classList.add('hidden');
          break;
      }
    });
  }

  // Helper for recursive folder drag-and-drop
  async function traverseDirectory(entry, fileList) {
    const reader = entry.createReader();
    const entries = await new Promise((resolve) => {
      reader.readEntries((results) => resolve(results));
    });
    for (const child of entries) {
      if (child.isFile) {
        const f = await new Promise((resolve) => child.file(resolve));
        fileList.push(f);
      } else if (child.isDirectory) {
        await traverseDirectory(child, fileList);
      }
    }
  }

  // Initialize
  initEventListeners();
})();
