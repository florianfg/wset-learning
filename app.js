const STORAGE_PREFIX = "wsetLevel2Progress_";
const UI_STATE_KEY = "wsetLevel2UiState";
const USER_NAME_KEY = "wsetLevel2UserName";
const INSTALL_DISMISSED_KEY = "wsetLevel2InstallDismissed";
const STATS_KEY = "wset-level-2-stats";

const activeSectionDefault = sections[0]?.id || null;
let activeSectionId = activeSectionDefault;
let activeChapterId = getChaptersForSection(activeSectionId)[0]?.id || chapters[0]?.id || null;

let navSheetOpen = false;
let currentView = "home"; // "home" | "content"

let currentCard = 0;
let currentQuestion = 0;
let currentMode = "study";
let questionAnswered = false;
let selectedAnswer = null;
let correctAnswers = 0;
let wrongAnswers = 0;

// Wiederholungs-Quiz
let questionIndices = [];   // Fragen-Indizes der aktuellen Runde
let currentRoundIdx = 0;    // Position in questionIndices
let wrongInRound = [];      // Indizes falsch beantworteter Fragen
let quizRound = 1;          // Aktuelle Runde (1 = erster Durchgang)

// Lernzeit-Timer
let _statsTimerStart = null;        // Date.now() wenn aktuelles Segment läuft; null = pausiert
let _statsCurrentMode = null;       // "study" | "quiz" | null
let _statsInactivityTimer = null;
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 Minuten Inaktivität → Timer pausieren

// ---------------------------------------------------------------------------
// Hilfsfunktionen – Struktur
// ---------------------------------------------------------------------------

function getChaptersForSection(sectionId) {
  return chapters.filter((c) => c.sectionId === sectionId);
}

function getSection(sectionId) {
  return sections.find((s) => s.id === sectionId);
}

function getChapter(chapterId) {
  return chapters.find((c) => c.id === chapterId);
}

// ---------------------------------------------------------------------------
// Persistenz – UI-Zustand
// ---------------------------------------------------------------------------

function loadUiState() {
  try {
    const saved = JSON.parse(localStorage.getItem(UI_STATE_KEY) || "{}");
    activeSectionId = saved.activeSectionId ?? activeSectionId;

    if (!getSection(activeSectionId)) activeSectionId = activeSectionDefault;

    const sectionChapters = getChaptersForSection(activeSectionId);
    activeChapterId = saved.activeChapterId ?? sectionChapters[0]?.id ?? activeChapterId;

    if (!getChapter(activeChapterId) || getChapter(activeChapterId)?.sectionId !== activeSectionId) {
      activeChapterId = sectionChapters[0]?.id || chapters[0]?.id || null;
    }
  } catch { /* Fallback auf Defaults */ }
}

function saveUiState() {
  localStorage.setItem(UI_STATE_KEY, JSON.stringify({ activeSectionId, activeChapterId }));
}

// ---------------------------------------------------------------------------
// Persistenz – Kapitel-Fortschritt
// ---------------------------------------------------------------------------

function getProgressKey(chapterId) {
  return `${STORAGE_PREFIX}${chapterId}`;
}

function loadChapterProgress(chapterId) {
  try { return JSON.parse(localStorage.getItem(getProgressKey(chapterId)) || "{}"); }
  catch { return {}; }
}

function saveChapterProgress() {
  if (!activeChapterId) return;
  localStorage.setItem(getProgressKey(activeChapterId), JSON.stringify({
    currentCard, currentQuestion, currentMode, questionAnswered, selectedAnswer,
    correctAnswers, wrongAnswers, questionIndices, currentRoundIdx, wrongInRound, quizRound
  }));
}

function loadChapterState(chapterId) {
  const p = loadChapterProgress(chapterId);
  const totalCards = getCardsForChapter(chapterId).length;
  const totalQuestions = getQuestionsForChapter(chapterId).length;

  currentCard      = Math.min(p.currentCard ?? 0, Math.max(totalCards - 1, 0));
  currentQuestion  = Math.min(p.currentQuestion ?? 0, Math.max(totalQuestions, 0));
  currentMode      = p.currentMode ?? "study";
  questionAnswered = p.questionAnswered ?? false;
  selectedAnswer   = p.selectedAnswer ?? null;
  correctAnswers   = p.correctAnswers ?? 0;
  wrongAnswers     = p.wrongAnswers ?? 0;
  questionIndices  = p.questionIndices ?? [];
  currentRoundIdx  = p.currentRoundIdx ?? 0;
  wrongInRound     = p.wrongInRound ?? [];
  quizRound        = p.quizRound ?? 1;

  // Kompatibilität mit alten Speicherständen ohne questionIndices
  if (currentMode === "quiz" && questionIndices.length === 0 && totalQuestions > 0) {
    questionIndices = Array.from({ length: totalQuestions }, (_, i) => i);
    currentRoundIdx = Math.min(currentQuestion, totalQuestions);
  }
}

// ---------------------------------------------------------------------------
// Persistenz – Lernstatistiken
// ---------------------------------------------------------------------------

function loadStats() {
  try { return JSON.parse(localStorage.getItem(STATS_KEY) || "{}"); }
  catch { return {}; }
}

function saveStats(stats) {
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

function getStats() {
  const s = loadStats();
  return {
    studySeconds:  s.studySeconds  || 0,
    quizSeconds:   s.quizSeconds   || 0,
    questionStats: s.questionStats || {}
  };
}

// ---------------------------------------------------------------------------
// Timer – Lernzeit-Tracking
// ---------------------------------------------------------------------------

function _clearInactivityTimer() {
  if (_statsInactivityTimer) { clearTimeout(_statsInactivityTimer); _statsInactivityTimer = null; }
}

function _resetInactivityTimer() {
  _clearInactivityTimer();
  _statsInactivityTimer = setTimeout(() => {
    // Inaktivität: akkumulieren, Timer pausieren (Mode bleibt für Wiederaufnahme)
    if (_statsTimerStart !== null) {
      _flushTimer();
      _statsTimerStart = null;
    }
  }, INACTIVITY_TIMEOUT_MS);
}

function _flushTimer() {
  if (_statsTimerStart === null || _statsCurrentMode === null) return;
  const elapsed = Math.floor((Date.now() - _statsTimerStart) / 1000);
  if (elapsed > 0) {
    const stats = getStats();
    if (_statsCurrentMode === "study") stats.studySeconds += elapsed;
    else if (_statsCurrentMode === "quiz") stats.quizSeconds += elapsed;
    saveStats(stats);
  }
  _statsTimerStart = null;
}

function startTimer(mode) {
  // Bereits laufenden Segment akkumulieren (Modus-Wechsel)
  if (_statsCurrentMode !== mode) _flushTimer();
  _statsCurrentMode = mode;
  if (_statsTimerStart === null) _statsTimerStart = Date.now();
  _resetInactivityTimer();
}

function stopTimer() {
  _flushTimer();
  _statsCurrentMode = null;
  _clearInactivityTimer();
}

// Aktivitätserkennung: Bei Nutzerinteraktion Inaktivitätszähler zurücksetzen
function _handleUserActivity() {
  if (_statsCurrentMode !== null) {
    if (_statsTimerStart === null) {
      // War durch Inaktivität pausiert → wieder starten
      _statsTimerStart = Date.now();
    }
    _resetInactivityTimer();
  }
}
["click", "keydown", "touchstart"].forEach((evt) =>
  document.addEventListener(evt, _handleUserActivity, { passive: true })
);

// Tab-Wechsel / Bildschirmsperre
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    _flushTimer();
    _clearInactivityTimer();
  } else {
    if (_statsCurrentMode !== null) {
      _statsTimerStart = Date.now();
      _resetInactivityTimer();
    }
  }
});

// ---------------------------------------------------------------------------
// Fortschritts-Berechnung
// ---------------------------------------------------------------------------

function getChapterProgressData(chapterId) {
  const p = loadChapterProgress(chapterId);
  const totalCards = getCardsForChapter(chapterId).length;
  const totalQuestions = getQuestionsForChapter(chapterId).length;
  const cardsSeen = totalCards === 0 ? 0
    : Math.min((p.currentCard ?? 0) + ((p.currentMode ?? "study") === "study" ? 1 : totalCards), totalCards);
  const answered = Math.min(p.currentQuestion ?? 0, totalQuestions);
  const completed = totalQuestions > 0 && answered >= totalQuestions;
  const started = cardsSeen > 0 || answered > 0;

  return { totalCards, totalQuestions, cardsSeen, answered,
    state: completed ? "completed" : started ? "started" : "not-started" };
}

function getSectionProgressData(sectionId) {
  const sc = getChaptersForSection(sectionId);
  const startedCount   = sc.filter((c) => getChapterProgressData(c.id).state !== "not-started").length;
  const completedCount = sc.filter((c) => getChapterProgressData(c.id).state === "completed").length;
  return {
    chapterCount: sc.length, startedCount, completedCount,
    state: completedCount === sc.length && sc.length > 0 ? "completed"
         : startedCount > 0 ? "started" : "not-started"
  };
}

function getOverallStats() {
  const stats = chapters.map((c) => getChapterProgressData(c.id));
  const totalQuestions    = stats.reduce((s, x) => s + x.totalQuestions, 0);
  const answeredQuestions = stats.reduce((s, x) => s + x.answered, 0);
  const completedChapters = stats.filter((x) => x.state === "completed").length;
  const progressPercentage = totalQuestions === 0 ? 0 : Math.round((answeredQuestions / totalQuestions) * 100);
  return { totalQuestions, answeredQuestions, completedChapters, progressPercentage };
}

// ---------------------------------------------------------------------------
// Navigation – Zustandswechsel
// ---------------------------------------------------------------------------

function setActiveSection(sectionId) {
  if (!getSection(sectionId)) return;
  activeSectionId = sectionId;
  const sc = getChaptersForSection(sectionId);
  if (!sc.some((c) => c.id === activeChapterId)) activeChapterId = sc[0]?.id || null;
  loadChapterState(activeChapterId);
  saveUiState();
  navSheetOpen = false;
  currentView = "content";
  render();
}

function setActiveChapter(chapterId) {
  const chapter = getChapter(chapterId);
  if (!chapter) return;
  activeSectionId = chapter.sectionId;
  activeChapterId = chapterId;
  loadChapterState(chapterId);
  saveUiState();
  navSheetOpen = false;
  currentView = "content";
  render();
}

function openNavSheet() {
  navSheetOpen = true;
  renderNav();
}

function closeNavSheet() {
  navSheetOpen = false;
  renderNav();
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen – Allgemein
// ---------------------------------------------------------------------------

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen – Rendering
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function statusSymbol(state) {
  if (state === "completed") return "✓";
  if (state === "started") return "●";
  return "○";
}

// ---------------------------------------------------------------------------
// Navigation rendern (Sidebar + Nav-Strip + Bottom-Sheet)
// ---------------------------------------------------------------------------

function renderNav() {
  const sidebarEl       = document.getElementById("sidebar");
  const navStripEl      = document.getElementById("nav-strip");
  const sheetContentEl  = document.getElementById("bottom-sheet-content");
  const backdropEl      = document.getElementById("sheet-backdrop");
  const sheetEl         = document.getElementById("bottom-sheet");

  if (sidebarEl)      sidebarEl.innerHTML      = buildSidebar();
  if (navStripEl)     navStripEl.innerHTML      = buildNavStrip();
  if (sheetContentEl) sheetContentEl.innerHTML  = buildSheetContent();

  if (backdropEl) backdropEl.classList.toggle("open", navSheetOpen);
  if (sheetEl)    sheetEl.classList.toggle("open", navSheetOpen);
}

function buildSidebar() {
  const stats = getOverallStats();
  const isHome = currentView === "home";

  const sectionsHtml = sections.map((section) => {
    const progress = getSectionProgressData(section.id);
    const isActive = section.id === activeSectionId;

    const chaptersHtml = isActive
      ? `<div class="sidebar-chapters">
          ${getChaptersForSection(section.id).map((chapter) => {
            const cp = getChapterProgressData(chapter.id);
            const isActiveChapter = chapter.id === activeChapterId;
            return `
              <button class="sidebar-chapter-btn ${isActiveChapter ? "active" : ""}"
                      onclick="setActiveChapter('${chapter.id}')">
                <span class="sidebar-chapter-status">${statusSymbol(cp.state)}</span>
                <span>${escapeHtml(chapter.name)}</span>
              </button>`;
          }).join("")}
        </div>`
      : "";

    return `
      <div class="sidebar-section">
        <button class="sidebar-section-btn ${isActive ? "active" : ""}"
                onclick="setActiveSection('${section.id}')">
          <span class="sidebar-section-num">${section.number}</span>
          <span class="sidebar-section-name">${escapeHtml(section.name)}</span>
          <span class="sidebar-section-progress">${progress.completedCount}/${progress.chapterCount}</span>
        </button>
        ${chaptersHtml}
      </div>`;
  }).join("");

  return `
    <div class="sidebar-brand">🍷 WSET Level 2</div>
    <div class="sidebar-progress">
      <div class="sidebar-progress-label">Gesamtfortschritt</div>
      <div class="sidebar-progress-bar">
        <div class="sidebar-progress-fill" style="width:${stats.progressPercentage}%"></div>
      </div>
      <div class="sidebar-progress-stats">
        <span>${stats.progressPercentage}%</span>
        <span>${stats.completedChapters}/${chapters.length} Kapitel</span>
      </div>
    </div>
    <nav class="sidebar-nav">
      <button class="sidebar-home-btn ${isHome ? "active" : ""}" onclick="goHome()">
        <span class="sidebar-home-icon">⌂</span>
        <span>Übersicht</span>
      </button>
      <div class="sidebar-nav-divider"></div>
      ${sectionsHtml}
    </nav>
  `;
}

function buildNavStrip() {
  if (currentView === "home") {
    return `<span class="nav-strip-home">⌂ Übersicht</span><span class="nav-strip-chevron">▾</span>`;
  }
  const section = getSection(activeSectionId);
  const chapter = getChapter(activeChapterId);
  return `
    <span class="nav-strip-section">${escapeHtml(section?.number || "")} ${escapeHtml(section?.name || "")}</span>
    <span class="nav-strip-divider">›</span>
    <span class="nav-strip-chapter">${escapeHtml(chapter?.name || "")}</span>
    <span class="nav-strip-chevron">▾</span>
  `;
}

function buildSheetContent() {
  const sectionsHtml = sections.map((section) => {
    const progress = getSectionProgressData(section.id);
    const isActive = section.id === activeSectionId;

    const chaptersHtml = isActive
      ? `<div class="sheet-chapters">
          ${getChaptersForSection(section.id).map((chapter) => {
            const cp = getChapterProgressData(chapter.id);
            const isActiveChapter = chapter.id === activeChapterId;
            return `
              <button class="sheet-chapter-btn ${isActiveChapter ? "active" : ""}"
                      onclick="setActiveChapter('${chapter.id}')">
                <span class="sheet-chapter-status">${statusSymbol(cp.state)}</span>
                <span>${escapeHtml(chapter.name)}</span>
              </button>`;
          }).join("")}
        </div>`
      : "";

    return `
      <div class="sheet-section">
        <button class="sheet-section-btn ${isActive ? "active" : ""}"
                onclick="setActiveSection('${section.id}')">
          <span class="sheet-section-num">${section.number}</span>
          <span class="sheet-section-name">${escapeHtml(section.name)}</span>
          <span class="sheet-section-progress">${progress.completedCount}/${progress.chapterCount}</span>
        </button>
        ${chaptersHtml}
      </div>`;
  }).join("");

  const isHome = currentView === "home";
  return `
    <div class="sheet-title">Navigation</div>
    <button class="sheet-section-btn ${isHome ? "active" : ""}" onclick="goHome()">
      <span class="sheet-section-num">⌂</span>
      <span class="sheet-section-name">Übersicht</span>
    </button>
    <div style="height:1px;background:var(--line);margin:4px 0 4px"></div>
    ${sectionsHtml}`;
}

// ---------------------------------------------------------------------------
// Topbar & Zwischenstand
// ---------------------------------------------------------------------------

function renderTopbar(mode, current, total) {
  const percentage = total === 0 ? 0 : Math.round((current / total) * 100);
  return `
    <div class="topbar">
      <div class="badge">${mode}</div>
      <div class="progress-text">${current} von ${total}</div>
    </div>
    <div class="progress-track"><div class="progress-fill" style="width:${percentage}%"></div></div>
  `;
}

function renderQuizStats() {
  return `
    <section class="card">
      <div class="info-card-label">Zwischenstand</div>
      <div class="info-list">
        <div>${correctAnswers} richtig · ${wrongAnswers} falsch</div>
      </div>
    </section>
  `;
}

// ---------------------------------------------------------------------------
// Lernkarten
// ---------------------------------------------------------------------------

function showEmptyChapterState() {
  const chapter = getChapter(activeChapterId);
  const section  = getSection(activeSectionId);

  document.getElementById("app").innerHTML = `
    ${renderTopbar("Lernen", 0, 0)}
    <section class="card">
      <div class="eyebrow">${escapeHtml(section?.name || "")}</div>
      <h2>${escapeHtml(chapter?.name || "")}</h2>
      <p>Für dieses Kapitel wurden noch keine Lernkarten angelegt.</p>
      <p class="helper-text">Sobald der Content ergänzt wird, erscheinen hier die Karten automatisch.</p>
    </section>
  `;
}

function showCard() {
  currentMode = "study";
  questionAnswered = false;
  selectedAnswer = null;
  if (_statsCurrentMode !== "study") { startTimer("study"); } else { _resetInactivityTimer(); }
  saveChapterProgress();

  const activeCards = getCardsForChapter(activeChapterId);

  if (activeCards.length === 0) {
    showEmptyChapterState();
    return;
  }

  if (currentCard < 0) currentCard = 0;
  if (currentCard >= activeCards.length) currentCard = activeCards.length - 1;

  const card    = activeCards[currentCard];
  const chapter = getChapter(activeChapterId);
  const section = getSection(activeSectionId);
  const sectionChapters = getChaptersForSection(activeSectionId);
  const chapterIndex = Math.max(sectionChapters.findIndex((c) => c.id === activeChapterId), 0) + 1;

  const pointsHTML   = (card.points || []).map((p) => `<li>${escapeHtml(p)}</li>`).join("");
  const examplesHTML = (card.examples || []).map((e) => `<li>${escapeHtml(e)}</li>`).join("");

  document.getElementById("app").innerHTML = `
    ${renderTopbar("Lernen", currentCard + 1, activeCards.length)}
    <section class="card">
      <div class="eyebrow">${escapeHtml(section?.name || "")}</div>
      <div class="subeyebrow">Kapitel ${chapterIndex} von ${sectionChapters.length} · ${escapeHtml(chapter?.name || "")}</div>
      <h2>${escapeHtml(card.title)}</h2>
      <p>${escapeHtml(card.intro || "")}</p>
      ${pointsHTML ? `<ul>${pointsHTML}</ul>` : ""}
      ${examplesHTML ? `<p class="section-title">${escapeHtml(card.exampleTitle || "Beispiele:")}</p><ul>${examplesHTML}</ul>` : ""}
    </section>
    <div class="button-row three-buttons">
      <button class="secondary" onclick="previousCard()" ${currentCard === 0 ? "disabled" : ""}>Zurück</button>
      <button onclick="nextCard()">Weiter</button>
      <button class="secondary" onclick="startQuiz()">Quiz starten</button>
    </div>
  `;
}

function previousCard() {
  if (currentCard === 0) return;
  currentCard -= 1;
  saveChapterProgress();
  showCard();
}

function nextCard() {
  const activeCards = getCardsForChapter(activeChapterId);
  if (currentCard < activeCards.length - 1) {
    currentCard += 1;
    saveChapterProgress();
    showCard();
    return;
  }
  startQuiz();
}

// ---------------------------------------------------------------------------
// Quiz
// ---------------------------------------------------------------------------

function startQuiz() {
  const n = getQuestionsForChapter(activeChapterId).length;
  currentMode = "quiz";
  currentQuestion = 0;
  correctAnswers = 0;
  wrongAnswers = 0;
  questionAnswered = false;
  selectedAnswer = null;
  quizRound = 1;
  wrongInRound = [];
  questionIndices = Array.from({ length: n }, (_, i) => i);
  currentRoundIdx = 0;
  saveChapterProgress();
  showQuestion();
}

function showQuestion() {
  const activeQuestions = getQuestionsForChapter(activeChapterId);

  if (activeQuestions.length === 0) { showEmptyChapterState(); return; }
  if (_statsCurrentMode !== "quiz") { startTimer("quiz"); } else { _resetInactivityTimer(); }

  // Sicherheitsnetz: questionIndices leer → initialisieren
  if (questionIndices.length === 0) {
    questionIndices = Array.from({ length: activeQuestions.length }, (_, i) => i);
    currentRoundIdx = 0;
  }

  if (currentRoundIdx >= questionIndices.length) { showResults(); return; }

  const qIdx    = questionIndices[currentRoundIdx];
  const question = activeQuestions[qIdx];
  const chapter  = getChapter(activeChapterId);
  const section  = getSection(activeSectionId);

  const roundLabel = quizRound > 1 ? ` · Runde ${quizRound}` : "";

  const optionsHtml = question.options.map((option, index) => {
    let cls = "option";
    if (questionAnswered) {
      if (index === question.correct) cls += " correct";
      else if (index === selectedAnswer) cls += " wrong";
    }
    return `<button class="${cls}" onclick="selectAnswer(${index})" ${questionAnswered ? "disabled" : ""}>${escapeHtml(option)}</button>`;
  }).join("");

  document.getElementById("app").innerHTML = `
    ${renderTopbar("Quiz" + roundLabel, currentRoundIdx + 1, questionIndices.length)}
    ${renderQuizStats()}
    <section class="card">
      <div class="eyebrow">${escapeHtml(section?.name || "")} · ${escapeHtml(chapter?.name || "")}</div>
      <h2>${escapeHtml(question.question)}</h2>
      <div class="options-list">${optionsHtml}</div>
      ${questionAnswered ? `<div class="explanation">${escapeHtml(question.explanation)}</div>` : ""}
    </section>
    <div class="button-row two-buttons">
      <button class="secondary" onclick="showCard()">Zurück zu den Karten</button>
      ${questionAnswered ? '<button onclick="nextQuestion()">Weiter</button>' : ""}
    </div>
  `;

  saveChapterProgress();
}

function selectAnswer(index) {
  if (questionAnswered) return;
  const activeQuestions = getQuestionsForChapter(activeChapterId);
  const qIdx = questionIndices[currentRoundIdx];
  const q = activeQuestions[qIdx];
  selectedAnswer = index;
  questionAnswered = true;
  const isCorrect = (index === q.correct);
  if (isCorrect) {
    correctAnswers += 1;
  } else {
    wrongAnswers += 1;
    wrongInRound.push(qIdx);
  }
  // Fragenstatistik: abgefragt + Ergebnis speichern
  const qStatsKey = `${activeChapterId}_${qIdx}`;
  const liveStats = getStats();
  if (!liveStats.questionStats[qStatsKey]) liveStats.questionStats[qStatsKey] = { asked: 0, correct: 0 };
  liveStats.questionStats[qStatsKey].asked += 1;
  if (isCorrect) liveStats.questionStats[qStatsKey].correct += 1;
  saveStats(liveStats);
  // currentQuestion für Fortschrittsberechnung aktualisieren
  currentQuestion = Math.max(currentQuestion, currentRoundIdx + 1);
  saveChapterProgress();
  showQuestion();
}

function nextQuestion() {
  currentRoundIdx += 1;
  questionAnswered = false;
  selectedAnswer = null;
  saveChapterProgress();
  showQuestion();
}

function showResults() {
  const total = questionIndices.length || getQuestionsForChapter(activeChapterId).length;
  const percentage = total === 0 ? 0 : Math.round((correctAnswers / total) * 100);

  let icon, label, scoreColor;
  if (percentage >= 90) {
    icon = "🏆"; label = "Ausgezeichnet!"; scoreColor = "#2d7a3a";
  } else if (percentage >= 75) {
    icon = "🌟"; label = "Sehr gut!"; scoreColor = "#4a7c3f";
  } else if (percentage >= 60) {
    icon = "👍"; label = "Gut gemacht!"; scoreColor = "#8a6a1d";
  } else if (percentage >= 40) {
    icon = "📚"; label = "Weiter üben"; scoreColor = "#b07020";
  } else {
    icon = "🔄"; label = "Nochmal versuchen"; scoreColor = "#8b2020";
  }

  const roundLabel = quizRound > 1 ? `Runde ${quizRound} · ` : "";
  const hasWrong = wrongInRound.length > 0;

  const retryBtn = hasWrong
    ? `<button onclick="retryWrongQuestions()">🔁 ${wrongInRound.length} Fehler wiederholen</button>`
    : `<button onclick="showCard()">Zurück zu den Karten</button>`;

  const secondBtn = hasWrong
    ? `<button class="secondary" onclick="showCard()">Zurück zu den Karten</button>`
    : `<button class="secondary" onclick="restartChapter()">Nochmal von vorne</button>`;

  document.getElementById("app").innerHTML = `
    <section class="card result-hero">
      <span class="result-icon">${icon}</span>
      <div class="result-score" style="color:${scoreColor}">${correctAnswers}/${total}</div>
      <div class="result-label">${label}</div>
      <div class="result-pct">${roundLabel}${percentage}% korrekt</div>
      ${hasWrong ? `<div class="result-retry-hint">${wrongInRound.length} Frage${wrongInRound.length > 1 ? "n" : ""} noch nicht sicher</div>` : `<div class="result-retry-hint" style="color:#2d7a3a">Alle Fragen richtig beantwortet!</div>`}
    </section>
    <div class="button-row two-buttons">
      ${secondBtn}
      ${retryBtn}
    </div>
  `;

  saveChapterProgress();
}

function retryWrongQuestions() {
  questionIndices = shuffleArray([...wrongInRound]);
  currentRoundIdx = 0;
  wrongInRound = [];
  quizRound += 1;
  correctAnswers = 0;
  wrongAnswers = 0;
  questionAnswered = false;
  selectedAnswer = null;
  saveChapterProgress();
  showQuestion();
}

function restartChapter() {
  currentCard = 0; currentQuestion = 0; currentMode = "study";
  questionAnswered = false; selectedAnswer = null; correctAnswers = 0; wrongAnswers = 0;
  questionIndices = []; currentRoundIdx = 0; wrongInRound = []; quizRound = 1;
  saveChapterProgress();
  showCard();
}

// ---------------------------------------------------------------------------
// Dashboard Home-Screen
// ---------------------------------------------------------------------------

function goHome() {
  stopTimer();
  currentView = "home";
  navSheetOpen = false;
  renderNav();
  renderDashboardScreen();
}

function continueLearning() {
  currentView = "content";
  render();
}

function renderDashboardScreen() {
  const stats = getOverallStats();
  const userName = getUserName();

  // Lernzeitstatistiken
  const timeStats = getStats();
  const studyMin = Math.round(timeStats.studySeconds / 60);
  const quizMin  = Math.round(timeStats.quizSeconds  / 60);
  const qsVals   = Object.values(timeStats.questionStats);
  const totalAsked   = qsVals.reduce((s, x) => s + x.asked, 0);
  const totalCorrect = qsVals.reduce((s, x) => s + x.correct, 0);
  const timeStatsHtml = (studyMin + quizMin + totalAsked) > 0
    ? `<div class="dashboard-time-stats">
        <span>📚 ${studyMin} Min. Lernen</span>
        <span class="dts-dot">·</span>
        <span>🎯 ${quizMin} Min. Quiz</span>
        <span class="dts-dot">·</span>
        <span>✓ ${totalCorrect}/${totalAsked} richtig</span>
       </div>`
    : "";

  // "Weiter lernen" – letztes aktives Kapitel oder erstes Kapitel
  const lastChapter = getChapter(activeChapterId);
  const lastSection = lastChapter ? getSection(lastChapter.sectionId) : null;
  const hasProgress = stats.answeredQuestions > 0 || stats.progressPercentage > 0;

  const ctaLabel = hasProgress ? "Weiter lernen" : "Lernen starten";
  const ctaHint = hasProgress && lastChapter
    ? `${escapeHtml(lastSection?.name || "")} · ${escapeHtml(lastChapter.name)}`
    : "Fang beim ersten Modul an";

  const greetingHtml = userName
    ? `<div class="dashboard-greeting">Willkommen zurück, <strong>${escapeHtml(userName)}</strong>! 🍷<button class="name-edit-btn" onclick="editUserName()" title="Namen ändern">✎</button></div>`
    : "";

  const sectionCardsHtml = sections.map((section) => {
    const sp = getSectionProgressData(section.id);
    const pct = sp.chapterCount === 0 ? 0 : Math.round((sp.completedCount / sp.chapterCount) * 100);
    const stateClass = sp.state === "completed" ? "completed" : sp.state === "started" ? "started" : "";
    const badge = sp.state === "completed" ? "✓" : sp.state === "started" ? "●" : "○";

    return `
      <button class="section-card ${stateClass}" onclick="setActiveSection('${section.id}')">
        <div class="section-card-top">
          <span class="section-card-num">${section.number}</span>
          <span class="section-card-name">${escapeHtml(section.name)}</span>
          <span class="section-card-badge ${stateClass}">${badge}</span>
        </div>
        <div class="section-card-meta">${sp.completedCount}/${sp.chapterCount} Kapitel</div>
        <div class="section-card-bar">
          <div class="section-card-fill" style="width:${pct}%"></div>
        </div>
      </button>`;
  }).join("");

  document.getElementById("app").innerHTML = `
    ${greetingHtml}
    <section class="card dashboard-hero">
      <div class="eyebrow">Lernfortschritt</div>
      <div class="dashboard-hero-pct">${stats.progressPercentage}%</div>
      <div class="progress-track" style="margin-bottom:12px">
        <div class="progress-fill" style="width:${stats.progressPercentage}%"></div>
      </div>
      <div class="dashboard-hero-meta">
        ${stats.completedChapters}/${chapters.length} Kapitel abgeschlossen
        · ${stats.answeredQuestions}/${stats.totalQuestions} Quizfragen
      </div>
      ${timeStatsHtml}
      <div class="dashboard-cta-hint">${ctaHint}</div>
      <button onclick="continueLearning()">${ctaLabel} →</button>
    </section>
    <div class="section-cards">${sectionCardsHtml}</div>
  `;
}

// ---------------------------------------------------------------------------
// Haupt-Render
// ---------------------------------------------------------------------------

function render() {
  saveUiState();
  renderNav();
  if (currentView === "home") {
    renderDashboardScreen();
  } else if (currentMode === "quiz") {
    showQuestion();
  } else {
    showCard();
  }
}

// ---------------------------------------------------------------------------
// Service Worker + Update-Erkennung
// ---------------------------------------------------------------------------

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      // Erkennt, wenn ein neuer SW bereit ist
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            showUpdateToast();
          }
        });
      });
    }).catch(() => {});

    // Wenn ein neuer SW die Kontrolle übernimmt → Seite neu laden
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });
  });
}

function showUpdateToast() {
  const existing = document.getElementById("update-toast");
  if (existing) return;

  const toast = document.createElement("div");
  toast.id = "update-toast";
  toast.className = "update-toast";
  toast.innerHTML = `
    <span>🔄 Update verfügbar</span>
    <button onclick="applyUpdate()">Jetzt aktualisieren</button>
  `;
  document.body.appendChild(toast);

  // Toast nach 10 Sekunden sanft einblenden
  requestAnimationFrame(() => toast.classList.add("visible"));
}

function applyUpdate() {
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "SKIP_WAITING" });
  }
  window.location.reload();
}

// ---------------------------------------------------------------------------
// Nutzername – Personalisierung
// ---------------------------------------------------------------------------

function getUserName() {
  return localStorage.getItem(USER_NAME_KEY) || "";
}

function saveUserName(name) {
  localStorage.setItem(USER_NAME_KEY, name.trim());
}

function showNamePrompt() {
  const modal = document.createElement("div");
  modal.id = "name-modal-overlay";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-icon">🍷</div>
      <h2>Herzlich willkommen!</h2>
      <p>Wie darf ich dich nennen?</p>
      <input id="name-input" class="name-input" type="text"
             placeholder="Dein Name" maxlength="30"
             autocomplete="off" autocapitalize="words" />
      <button id="name-submit-btn" onclick="submitName()">Loslegen →</button>
    </div>
  `;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add("visible"));

  // Enter-Taste bestätigt
  document.getElementById("name-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitName();
  });
  setTimeout(() => document.getElementById("name-input")?.focus(), 300);
}

function submitName() {
  const input = document.getElementById("name-input");
  const name = (input?.value || "").trim();
  if (!name) {
    input?.classList.add("shake");
    setTimeout(() => input?.classList.remove("shake"), 500);
    return;
  }
  saveUserName(name);
  const overlay = document.getElementById("name-modal-overlay");
  if (overlay) {
    overlay.classList.remove("visible");
    setTimeout(() => overlay.remove(), 300);
  }
  renderDashboardScreen();
}

function editUserName() {
  const input = prompt("Deinen Namen ändern:", getUserName());
  if (input !== null && input.trim()) {
    saveUserName(input.trim());
    renderDashboardScreen();
  }
}

// ---------------------------------------------------------------------------
// PWA-Install-Guidance
// ---------------------------------------------------------------------------

let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  // Banner anzeigen, wenn noch nicht dismissed
  if (!localStorage.getItem(INSTALL_DISMISSED_KEY)) {
    showInstallBanner("android");
  }
});

function isRunningAsPwa() {
  return window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function maybeShowInstallBanner() {
  if (isRunningAsPwa()) return;
  if (localStorage.getItem(INSTALL_DISMISSED_KEY)) return;
  if (isIos()) showInstallBanner("ios");
  // Android-Banner wird über beforeinstallprompt gesteuert (s.o.)
}

function showInstallBanner(platform) {
  const existing = document.getElementById("install-banner");
  if (existing) return;

  const banner = document.createElement("div");
  banner.id = "install-banner";
  banner.className = "install-banner";

  if (platform === "ios") {
    banner.innerHTML = `
      <div class="install-banner-text">
        <strong>📲 App installieren</strong>
        <span>Tippe auf <strong>Teilen</strong> <span class="share-icon">⎋</span> und dann „Zum Home-Bildschirm"</span>
      </div>
      <button class="install-banner-close" onclick="dismissInstallBanner()">✕</button>
    `;
  } else {
    banner.innerHTML = `
      <div class="install-banner-text">
        <strong>📲 Als App installieren</strong>
        <span>Für den besten Lernerfolg direkt auf dem Startbildschirm</span>
      </div>
      <div class="install-banner-actions">
        <button class="install-btn-primary" onclick="triggerInstallPrompt()">Installieren</button>
        <button class="install-banner-close" onclick="dismissInstallBanner()">Nicht jetzt</button>
      </div>
    `;
  }

  document.body.appendChild(banner);
  requestAnimationFrame(() => banner.classList.add("visible"));
}

function triggerInstallPrompt() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then((choice) => {
    if (choice.outcome === "accepted") dismissInstallBanner();
    deferredInstallPrompt = null;
  });
}

function dismissInstallBanner() {
  localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
  const banner = document.getElementById("install-banner");
  if (banner) {
    banner.classList.remove("visible");
    setTimeout(() => banner.remove(), 300);
  }
}

// ---------------------------------------------------------------------------
// Globale onclick-Handler
// ---------------------------------------------------------------------------

window.retryWrongQuestions  = retryWrongQuestions;
window.setActiveSection     = setActiveSection;
window.setActiveChapter     = setActiveChapter;
window.openNavSheet         = openNavSheet;
window.closeNavSheet        = closeNavSheet;
window.goHome               = goHome;
window.continueLearning     = continueLearning;
window.previousCard         = previousCard;
window.nextCard             = nextCard;
window.startQuiz            = startQuiz;
window.showCard             = showCard;
window.selectAnswer         = selectAnswer;
window.nextQuestion         = nextQuestion;
window.restartChapter       = restartChapter;
window.submitName           = submitName;
window.editUserName         = editUserName;
window.triggerInstallPrompt = triggerInstallPrompt;
window.dismissInstallBanner = dismissInstallBanner;
window.applyUpdate          = applyUpdate;

// ---------------------------------------------------------------------------
// Initialisierung
// ---------------------------------------------------------------------------

loadUiState();
loadChapterState(activeChapterId);
registerServiceWorker();
currentView = "home"; // immer auf Home-Screen starten
render();

// Nutzername prüfen – ggf. Willkommens-Modal anzeigen
if (!getUserName()) {
  showNamePrompt();
} else {
  maybeShowInstallBanner();
}
