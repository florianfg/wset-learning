const STORAGE_PREFIX = "wsetLevel2Progress_";
const UI_STATE_KEY = "wsetLevel2UiState";
const USER_NAME_KEY = "wsetLevel2UserName";
const INSTALL_DISMISSED_KEY = "wsetLevel2InstallDismissed";
const STATS_KEY = "wset-level-2-stats";

// S3.1 – Kapitel-Quiz Gate
const QUIZ_PASSED_PREFIX      = "wsetLevel2Passed_";
const QUIZ_GATE_MIN_QUESTIONS = 5;    // Kapitel mit <5 Fragen: kein Gate
const QUIZ_PASS_THRESHOLD     = 80;   // Prozent (80 %)

// S3.2 – Modul-Quiz (kein persistenter State nötig)

// S3.3 – WSET Exam Mode
const SM2_KEY          = "wset-level-2-sm2";
const EXAM_TIME_LIMIT  = 90;   // Sekunden pro Frage
const EXAM_SESSION_SIZE = 50;  // Fragen pro Exam-Session

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

// S3.2 – Modul-Quiz State
let mqSectionId = null;
let mqQuestions = [];   // [{question, chapterId, chapterName, wasCorrect}]
let mqIdx       = 0;
let mqCorrect   = 0;
let mqWrong     = 0;
let mqAnswered  = false;
let mqSelected  = null;

// S3.3 – Exam Mode State
let examQueue        = [];  // [{question, chapterId, chapterName, sectionName, sm2Key}]
let examIdx          = 0;
let examCorrect      = 0;
let examWrong        = 0;
let examAnswered     = false;
let examSelected     = null;
let examTimerInterval = null;
let examTimeLeft     = EXAM_TIME_LIMIT;

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

// ---------------------------------------------------------------------------
// Karten-Content-Rendering (Markdown → HTML)
// ---------------------------------------------------------------------------

function renderCardContent(card) {
  // Neue Karten: card.content (Markdown-String mit **bold** und - Listen)
  if (card.content) {
    const lines = card.content.trim().split("\n");
    const parts = [];
    let listItems = [];

    function flushList() {
      if (listItems.length > 0) {
        parts.push(`<ul class="card-list">${listItems.join("")}</ul>`);
        listItems = [];
      }
    }

    function inlineMd(text) {
      return text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    }

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "") { flushList(); continue; }
      if (trimmed.startsWith("- ")) {
        listItems.push(`<li>${inlineMd(trimmed.slice(2))}</li>`);
      } else {
        flushList();
        parts.push(`<p>${inlineMd(trimmed)}</p>`);
      }
    }
    flushList();

    const takeaway = card.takeaway
      ? `<div class="card-takeaway">${escapeHtml(card.takeaway)}</div>` : "";
    return parts.join("") + takeaway;
  }

  // Legacy-Karten: intro + points + examples
  const pointsHTML   = (card.points   || []).map((p) => `<li>${escapeHtml(p)}</li>`).join("");
  const examplesHTML = (card.examples || []).map((e) => `<li>${escapeHtml(e)}</li>`).join("");
  return `
    ${card.intro ? `<p>${escapeHtml(card.intro)}</p>` : ""}
    ${pointsHTML   ? `<ul class="card-list">${pointsHTML}</ul>` : ""}
    ${examplesHTML ? `<p class="section-title">${escapeHtml(card.exampleTitle || "Beispiele:")}</p><ul class="card-list">${examplesHTML}</ul>` : ""}
  `;
}

// ---------------------------------------------------------------------------
// View-Transition Hilfsfunktionen
// ---------------------------------------------------------------------------

function scrollToTop() {
  // Scrollt beim View-Wechsel nach oben (smooth)
  const mainContent = document.getElementById("main-content");
  if (mainContent) {
    mainContent.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function triggerViewTransition() {
  // Löst die Fade-In Animation auf dem #app Container aus.
  // Durch Entfernen + void reflow + Hinzufügen der Klasse wird
  // die CSS-Animation neu gestartet, auch wenn sie schon aktiv war.
  const app = document.getElementById("app");
  if (!app) return;
  app.classList.remove("view-enter");
  void app.offsetWidth; // erzwingt Browser-Reflow → Animation startet neu
  app.classList.add("view-enter");
}

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
  scrollToTop();

  document.getElementById("app").innerHTML = `
    ${renderTopbar("Lernen", 0, 0)}
    <section class="card">
      <div class="eyebrow">${escapeHtml(section?.name || "")}</div>
      <h2>${escapeHtml(chapter?.name || "")}</h2>
      <p>Für dieses Kapitel wurden noch keine Lernkarten angelegt.</p>
      <p class="helper-text">Sobald der Content ergänzt wird, erscheinen hier die Karten automatisch.</p>
    </section>
  `;
  triggerViewTransition();
}

function showCard() {
  currentMode = "study";
  questionAnswered = false;
  selectedAnswer = null;
  if (_statsCurrentMode !== "study") { startTimer("study"); } else { _resetInactivityTimer(); }
  saveChapterProgress();
  scrollToTop();

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

  document.getElementById("app").innerHTML = `
    ${renderTopbar("Lernen", currentCard + 1, activeCards.length)}
    <section class="card">
      <div class="eyebrow">${escapeHtml(section?.name || "")}</div>
      <div class="subeyebrow">Kapitel ${chapterIndex} von ${sectionChapters.length} · ${escapeHtml(chapter?.name || "")}</div>
      <h2>${escapeHtml(card.title)}</h2>
      ${renderCardContent(card)}
    </section>
    <div class="button-row three-buttons">
      <button class="secondary" onclick="previousCard()" ${currentCard === 0 ? "disabled" : ""}>Zurück</button>
      <button onclick="nextCard()">Weiter</button>
      <button class="secondary" onclick="startQuiz()">Quiz starten</button>
    </div>
  `;
  triggerViewTransition();
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
  scrollToTop();

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
  triggerViewTransition();

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
  scrollToTop();
  const total = questionIndices.length || getQuestionsForChapter(activeChapterId).length;
  const percentage = total === 0 ? 0 : Math.round((correctAnswers / total) * 100);

  // S3.1: Pass-Gate (nur aktiv wenn >= QUIZ_GATE_MIN_QUESTIONS Fragen)
  const gateActive = total >= QUIZ_GATE_MIN_QUESTIONS;
  const passed     = !gateActive || percentage >= QUIZ_PASS_THRESHOLD;
  if (passed) markChapterQuizPassed(activeChapterId);

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

  const roundLabel = quizRound > 1 ? "Runde " + quizRound + " · " : "";
  const hasWrong = wrongInRound.length > 0;

  // Nächstes Kapitel ermitteln für Button-Label
  const sectionChapters = getChaptersForSection(activeSectionId);
  const currentChapterIdx = sectionChapters.findIndex((c) => c.id === activeChapterId);
  const nextChapter = currentChapterIdx !== -1 && currentChapterIdx < sectionChapters.length - 1
    ? sectionChapters[currentChapterIdx + 1]
    : null;
  const nextChapterLabel = nextChapter
    ? "Weiter: " + escapeHtml(nextChapter.name)
    : "Zur Übersicht";

  // Gate-Banner
  const gateBanner = gateActive
    ? '<div class="quiz-gate-banner ' + (passed ? "gate-passed" : "gate-failed") + '">' +
      (passed
        ? '<span class="gate-icon">&#x2705;</span> Bestanden – du kannst weitermachen!'
        : '<span class="gate-icon">&#x274C;</span> Noch nicht bestanden (mind. 80 % erforderlich)') +
      "</div>"
    : "";

  // "Fehler wiederholen"-Button
  const retryWrongHtml = hasWrong
    ? '<button class="result-retry-btn" onclick="retryWrongQuestions()">&#x1F501; ' + wrongInRound.length + " Fehler wiederholen</button>"
    : "";

  // Weiter-Button: gesperrt wenn nicht bestanden
  const nextBtn = passed
    ? '<button class="result-primary-btn" onclick="goToNextChapter()">&#x2705; ' + nextChapterLabel + "</button>"
    : '<button class="result-primary-btn result-primary-btn--locked" disabled>&#x1F512; ' + nextChapterLabel + "</button>";

  document.getElementById("app").innerHTML =
    '<section class="card result-hero">' +
    '  <span class="result-icon">' + icon + "</span>" +
    '  <div class="result-score" style="color:' + scoreColor + '">' + correctAnswers + "/" + total + "</div>" +
    '  <div class="result-label">' + label + "</div>" +
    '  <div class="result-pct">' + roundLabel + percentage + "% korrekt</div>" +
    (hasWrong
      ? '  <div class="result-retry-hint">' + wrongInRound.length + " Frage" + (wrongInRound.length > 1 ? "n" : "") + " noch nicht sicher</div>"
      : '  <div class="result-retry-hint" style="color:#2d7a3a">Alle Fragen richtig beantwortet! &#x1F389;</div>') +
    gateBanner +
    "</section>" +
    retryWrongHtml +
    '<div class="button-row result-actions">' +
    nextBtn +
    '  <button class="secondary" onclick="startQuiz()">&#x1F501; Quiz wiederholen</button>' +
    '  <button class="secondary" onclick="restartChapter()">&#x1F4D6; Kapitel neu starten</button>' +
    "</div>";

  triggerViewTransition();
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

function goToNextChapter() {
  // Nächstes Kapitel innerhalb der aktuellen Sektion suchen
  const sectionChapters = getChaptersForSection(activeSectionId);
  const currentIdx = sectionChapters.findIndex((c) => c.id === activeChapterId);

  if (currentIdx !== -1 && currentIdx < sectionChapters.length - 1) {
    // Nächstes Kapitel in derselben Sektion
    setActiveChapter(sectionChapters[currentIdx + 1].id);
    return;
  }

  // Letztes Kapitel der Sektion → nächste Sektion suchen
  const sectionIdx = sections.findIndex((s) => s.id === activeSectionId);
  if (sectionIdx !== -1 && sectionIdx < sections.length - 1) {
    const nextSection = sections[sectionIdx + 1];
    const nextChapters = getChaptersForSection(nextSection.id);
    if (nextChapters.length > 0) {
      setActiveChapter(nextChapters[0].id);
      return;
    }
  }

  // Kein weiteres Kapitel → zurück zur Übersicht
  goHome();
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
  const hasAnyStats = (timeStats.studySeconds + timeStats.quizSeconds + totalAsked) > 0;
  const timeStatsHtml = hasAnyStats
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

    return (
      '<div class="section-card ' + stateClass + '" role="button" tabindex="0"' +
      ' onclick="setActiveSection(\'' + section.id + '\')"' +
      ' onkeydown="if(event.key===\'Enter\')setActiveSection(\'' + section.id + '\')">' +
      '  <div class="section-card-top">' +
      '    <span class="section-card-num">' + section.number + "</span>" +
      '    <span class="section-card-name">' + escapeHtml(section.name) + "</span>" +
      '    <span class="section-card-badge ' + stateClass + '">' + badge + "</span>" +
      "  </div>" +
      '  <div class="section-card-meta">' + sp.completedCount + "/" + sp.chapterCount + " Kapitel</div>" +
      '  <div class="section-card-bar"><div class="section-card-fill" style="width:' + pct + '%"></div></div>' +
      '  <div class="section-card-actions" onclick="event.stopPropagation()">' +
      '    <button class="mq-start-btn" onclick="startModuleQuiz(\'' + section.id + '\')">&#x1F4DD; Modul-Quiz</button>' +
      "  </div>" +
      "</div>"
    );
  }).join("");

  document.getElementById("app").innerHTML =
    greetingHtml +
    '<section class="card dashboard-hero">' +
    '  <div class="eyebrow">Lernfortschritt</div>' +
    '  <div class="dashboard-hero-pct">' + stats.progressPercentage + "%</div>" +
    '  <div class="progress-track" style="margin-bottom:12px">' +
    '    <div class="progress-fill" style="width:' + stats.progressPercentage + '%"></div>' +
    "  </div>" +
    '  <div class="dashboard-hero-meta">' +
    stats.completedChapters + "/" + chapters.length + " Kapitel abgeschlossen" +
    " &middot; " + stats.answeredQuestions + "/" + stats.totalQuestions + " Quizfragen" +
    "  </div>" +
    timeStatsHtml +
    '  <div class="dashboard-cta-hint">' + ctaHint + "</div>" +
    '  <button onclick="continueLearning()">' + ctaLabel + " &#x2192;</button>" +
    "</section>" +
    '<div class="section-cards">' + sectionCardsHtml + "</div>" +
    '<div class="exam-mode-card" onclick="startExamMode()">' +
    '  <div class="exam-mode-icon">&#x1F393;</div>' +
    '  <div class="exam-mode-body">' +
    '    <div class="exam-mode-title">Pr&#xFC;fungssimulation</div>' +
    '    <div class="exam-mode-sub">SM-2 Spaced Repetition &middot; ' + EXAM_SESSION_SIZE + ' Fragen &middot; 90 Sek./Frage</div>' +
    "  </div>" +
    '  <div class="exam-mode-arrow">&#x276F;</div>' +
    "</div>";
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

// ---------------------------------------------------------------------------
// S3.1 – Kapitel-Quiz Gate Helpers
// ---------------------------------------------------------------------------

function markChapterQuizPassed(chapterId) {
  localStorage.setItem(QUIZ_PASSED_PREFIX + chapterId, "1");
}

function hasChapterQuizPassed(chapterId) {
  return localStorage.getItem(QUIZ_PASSED_PREFIX + chapterId) === "1";
}

// ---------------------------------------------------------------------------
// S3.2 – Modul-Quiz
// ---------------------------------------------------------------------------

function startModuleQuiz(sectionId) {
  mqSectionId = sectionId;
  const sectionChapters = getChaptersForSection(sectionId);
  const all = [];
  sectionChapters.forEach(function(ch) {
    getQuestionsForChapter(ch.id).forEach(function(q) {
      all.push({ question: q, chapterId: ch.id, chapterName: ch.name, wasCorrect: null });
    });
  });
  mqQuestions = shuffleArray(all);
  mqIdx      = 0;
  mqCorrect  = 0;
  mqWrong    = 0;
  mqAnswered = false;
  mqSelected = null;
  currentView  = "content";
  navSheetOpen = false;
  renderNav();
  showModuleQuestion();
}

function showModuleQuestion() {
  if (mqQuestions.length === 0) { goHome(); return; }
  if (mqIdx >= mqQuestions.length) { showModuleResults(); return; }
  scrollToTop();

  var entry   = mqQuestions[mqIdx];
  var q       = entry.question;
  var section = getSection(getChapter(entry.chapterId) ? getChapter(entry.chapterId).sectionId : null);

  var optionsHtml = q.options.map(function(opt, i) {
    var cls = "option";
    if (mqAnswered) {
      if (i === q.correct)   cls += " correct";
      else if (i === mqSelected) cls += " wrong";
    }
    return '<button class="' + cls + '" onclick="selectModuleAnswer(' + i + ')" ' +
           (mqAnswered ? "disabled" : "") + ">" + escapeHtml(opt) + "</button>";
  }).join("");

  document.getElementById("app").innerHTML =
    renderTopbar("Modul-Quiz", mqIdx + 1, mqQuestions.length) +
    '<section class="card">' +
    '  <div class="eyebrow">' + escapeHtml(section ? section.name : "") + " &rsaquo; " + escapeHtml(entry.chapterName) + "</div>" +
    '  <div class="mq-stats">&#x2713; ' + mqCorrect + " &nbsp; &#x2717; " + mqWrong + "</div>" +
    "  <h2>" + escapeHtml(q.question) + "</h2>" +
    '  <div class="options-list">' + optionsHtml + "</div>" +
    (mqAnswered ? '<div class="explanation">' + escapeHtml(q.explanation) + "</div>" : "") +
    "</section>" +
    '<div class="button-row two-buttons">' +
    '  <button class="secondary" onclick="goHome()">&#x2B05; Abbrechen</button>' +
    (mqAnswered ? '  <button onclick="nextModuleQuestion()">Weiter</button>' : "") +
    "</div>";

  triggerViewTransition();
}

function selectModuleAnswer(index) {
  if (mqAnswered) return;
  var q = mqQuestions[mqIdx].question;
  mqSelected = index;
  mqAnswered = true;
  var isCorrect = (index === q.correct);
  mqQuestions[mqIdx].wasCorrect = isCorrect;
  if (isCorrect) mqCorrect++;
  else mqWrong++;
  showModuleQuestion();
}

function nextModuleQuestion() {
  mqIdx++;
  mqAnswered = false;
  mqSelected = null;
  showModuleQuestion();
}

function showModuleResults() {
  scrollToTop();
  var total = mqQuestions.length;
  var pct   = total === 0 ? 0 : Math.round((mqCorrect / total) * 100);

  var icon, label;
  if (pct >= 90)      { icon = "&#x1F3C6;"; label = "Ausgezeichnet!"; }
  else if (pct >= 75) { icon = "&#x1F31F;"; label = "Sehr gut!"; }
  else if (pct >= 60) { icon = "&#x1F44D;"; label = "Gut gemacht!"; }
  else                { icon = "&#x1F4DA;"; label = "Weiter &#xFC;ben"; }

  // Kapitel-Aufschlüsselung
  var chapterMap = {};
  mqQuestions.forEach(function(entry) {
    var cid = entry.chapterId;
    if (!chapterMap[cid]) chapterMap[cid] = { name: entry.chapterName, correct: 0, total: 0 };
    chapterMap[cid].total++;
    if (entry.wasCorrect) chapterMap[cid].correct++;
  });
  var breakdownHtml = Object.values(chapterMap).map(function(c) {
    var cpct = Math.round((c.correct / c.total) * 100);
    var color = cpct >= 80 ? "#2d7a3a" : cpct >= 60 ? "#8a6a1d" : "#8b2020";
    return '<div class="mq-chapter-row">' +
           '  <span class="mq-chapter-name">' + escapeHtml(c.name) + "</span>" +
           '  <span class="mq-chapter-score" style="color:' + color + '">' + c.correct + "/" + c.total + "</span>" +
           "</div>";
  }).join("");

  var section = getSection(mqSectionId);

  document.getElementById("app").innerHTML =
    '<section class="card result-hero">' +
    '  <span class="result-icon">' + icon + "</span>" +
    '  <div class="result-score">' + mqCorrect + "/" + total + "</div>" +
    '  <div class="result-label">' + label + "</div>" +
    '  <div class="result-pct">' + pct + "% korrekt &ndash; " + escapeHtml(section ? section.name : "") + "</div>" +
    "</section>" +
    (breakdownHtml ? '<section class="card mq-breakdown"><div class="mq-breakdown-title">Kapitel-&#xDC;bersicht</div>' + breakdownHtml + "</section>" : "") +
    '<div class="button-row result-actions">' +
    '  <button onclick="startModuleQuiz(\'' + mqSectionId + '\')">&#x1F501; Nochmal</button>' +
    '  <button class="secondary" onclick="goHome()">Zur &#xDC;bersicht</button>' +
    "</div>";

  triggerViewTransition();
}

// ---------------------------------------------------------------------------
// S3.3 – SM-2 Spaced Repetition Helpers
// ---------------------------------------------------------------------------

function loadSm2State() {
  try { return JSON.parse(localStorage.getItem(SM2_KEY) || "{}"); }
  catch (e) { return {}; }
}

function saveSm2State(state) {
  localStorage.setItem(SM2_KEY, JSON.stringify(state));
}

function getSm2Data(state, key) {
  return state[key] || { n: 0, ef: 2.5, interval: 1, nextDue: null };
}

function updateSm2(state, key, correct) {
  var d = getSm2Data(state, key);
  var q = correct ? 5 : 2;  // quality: 5=correct, 2=incorrect

  if (q < 3) {
    d.n        = 0;
    d.interval = 1;
  } else {
    if (d.n === 0)      d.interval = 1;
    else if (d.n === 1) d.interval = 6;
    else                d.interval = Math.round(d.interval * d.ef);
    d.ef = d.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    d.ef = Math.max(1.3, d.ef);
    d.n  += 1;
  }
  var due = new Date();
  due.setDate(due.getDate() + d.interval);
  d.nextDue  = due.toISOString().split("T")[0];
  state[key] = d;
  return state;
}

function buildExamQueue() {
  var sm2State = loadSm2State();
  var all = [];
  chapters.forEach(function(ch) {
    getQuestionsForChapter(ch.id).forEach(function(q, idx) {
      var sm2Key = ch.id + "_" + idx;
      var sm2    = getSm2Data(sm2State, sm2Key);
      all.push({
        question:    q,
        chapterId:   ch.id,
        chapterName: ch.name,
        sectionName: (getSection(ch.sectionId) || {}).name || "",
        sm2Key:      sm2Key,
        nextDue:     sm2.nextDue || "2000-01-01",
        n:           sm2.n
      });
    });
  });

  // Sortierung: nie gelernt → älteste Fälligkeit → zufällig bei Gleichstand
  all.sort(function(a, b) {
    if (a.n === 0 && b.n > 0) return -1;
    if (a.n > 0 && b.n === 0) return  1;
    if (a.nextDue < b.nextDue) return -1;
    if (a.nextDue > b.nextDue) return  1;
    return Math.random() - 0.5;
  });

  return all.slice(0, EXAM_SESSION_SIZE);
}

// ---------------------------------------------------------------------------
// S3.3 – Exam Mode Screens
// ---------------------------------------------------------------------------

function startExamMode() {
  examQueue    = buildExamQueue();
  examIdx      = 0;
  examCorrect  = 0;
  examWrong    = 0;
  examAnswered = false;
  examSelected = null;
  clearExamTimer();
  currentView  = "content";
  navSheetOpen = false;
  renderNav();
  showExamQuestion();
}

function showExamQuestion() {
  clearExamTimer();
  if (examQueue.length === 0) { goHome(); return; }
  if (examIdx >= examQueue.length) { showExamResults(); return; }
  scrollToTop();

  examAnswered = false;
  examSelected = null;
  examTimeLeft = EXAM_TIME_LIMIT;

  var entry = examQueue[examIdx];
  var q     = entry.question;

  var optionsHtml = q.options.map(function(opt, i) {
    return '<button class="option exam-option" id="exam-opt-' + i + '" onclick="selectExamAnswer(' + i + ')">' +
           escapeHtml(opt) + "</button>";
  }).join("");

  var timerPct = 100;

  document.getElementById("app").innerHTML =
    renderTopbar("Pr&#xFC;fungssimulation", examIdx + 1, examQueue.length) +
    '<div class="exam-timer-wrap">' +
    '  <div class="exam-timer-bar" id="exam-timer-bar" style="width:' + timerPct + '%"></div>' +
    '  <span class="exam-timer-label" id="exam-timer-label">' + examTimeLeft + "s</span>" +
    "</div>" +
    '<section class="card">' +
    '  <div class="eyebrow">' + escapeHtml(entry.sectionName) + " &rsaquo; " + escapeHtml(entry.chapterName) + "</div>" +
    '  <div class="exam-progress-stats">&#x2713; ' + examCorrect + " &nbsp; &#x2717; " + examWrong + "</div>" +
    "  <h2>" + escapeHtml(q.question) + "</h2>" +
    '  <div class="options-list" id="exam-options">' + optionsHtml + "</div>" +
    '  <div class="explanation" id="exam-explanation" style="display:none"></div>' +
    "</section>" +
    '<div class="button-row two-buttons" id="exam-nav">' +
    '  <button class="secondary" onclick="confirmAbortExam()">Abbrechen</button>' +
    "</div>";

  triggerViewTransition();
  startExamTimer();
}

function startExamTimer() {
  clearExamTimer();
  examTimerInterval = setInterval(function() {
    examTimeLeft--;
    if (examTimeLeft <= 0) {
      clearExamTimer();
      selectExamAnswer(-1); // Timeout = falsch gewertet
    } else {
      var bar   = document.getElementById("exam-timer-bar");
      var label = document.getElementById("exam-timer-label");
      if (bar) {
        var pct = (examTimeLeft / EXAM_TIME_LIMIT) * 100;
        bar.style.width = pct + "%";
        bar.style.background = pct > 40 ? "#4a7c3f" : pct > 20 ? "#c4870a" : "#c0392b";
      }
      if (label) label.textContent = examTimeLeft + "s";
    }
  }, 1000);
}

function clearExamTimer() {
  if (examTimerInterval) {
    clearInterval(examTimerInterval);
    examTimerInterval = null;
  }
}

function selectExamAnswer(index) {
  if (examAnswered) return;
  clearExamTimer();
  examAnswered = true;
  examSelected = index;

  var entry    = examQueue[examIdx];
  var q        = entry.question;
  var isCorrect = (index === q.correct);
  if (isCorrect) examCorrect++;
  else           examWrong++;

  // SM-2 aktualisieren
  var sm2State = loadSm2State();
  updateSm2(sm2State, entry.sm2Key, isCorrect);
  saveSm2State(sm2State);

  // UI: Optionen einfärben
  var optList = document.getElementById("exam-options");
  if (optList) {
    q.options.forEach(function(_opt, i) {
      var btn = document.getElementById("exam-opt-" + i);
      if (!btn) return;
      btn.disabled = true;
      if (i === q.correct) btn.classList.add("correct");
      else if (i === index) btn.classList.add("wrong");
    });
  }
  // Timeout-Hinweis
  if (index === -1) {
    var optListEl = document.getElementById("exam-options");
    if (optListEl) {
      var timeoutMsg = document.createElement("div");
      timeoutMsg.className = "exam-timeout-msg";
      timeoutMsg.textContent = "Zeit abgelaufen!";
      optListEl.appendChild(timeoutMsg);
    }
  }
  // Erklärung einblenden
  var expEl = document.getElementById("exam-explanation");
  if (expEl) {
    expEl.textContent = q.explanation;
    expEl.style.display = "block";
  }
  // Weiter-Button
  var navEl = document.getElementById("exam-nav");
  if (navEl) {
    navEl.innerHTML =
      '<button class="secondary" onclick="confirmAbortExam()">Abbrechen</button>' +
      '<button onclick="nextExamQuestion()">Weiter</button>';
  }
  // Timer-Bar auf Rot setzen bei Fehler / Grün bei Richtig
  var bar = document.getElementById("exam-timer-bar");
  if (bar) {
    bar.style.width = "100%";
    bar.style.background = isCorrect ? "#2d7a3a" : "#c0392b";
  }
}

function nextExamQuestion() {
  examIdx++;
  showExamQuestion();
}

function confirmAbortExam() {
  clearExamTimer();
  goHome();
}

function showExamResults() {
  clearExamTimer();
  scrollToTop();
  var total = examQueue.length;
  var pct   = total === 0 ? 0 : Math.round((examCorrect / total) * 100);

  var icon, label;
  if (pct >= 90)      { icon = "&#x1F3C6;"; label = "Ausgezeichnet!"; }
  else if (pct >= 75) { icon = "&#x1F31F;"; label = "Sehr gut!"; }
  else if (pct >= 60) { icon = "&#x1F44D;"; label = "Gut gemacht!"; }
  else if (pct >= 40) { icon = "&#x1F4DA;"; label = "Weiter &#xFC;ben"; }
  else                { icon = "&#x1F504;"; label = "Nochmal versuchen"; }

  var scoreColor = pct >= 80 ? "#2d7a3a" : pct >= 60 ? "#8a6a1d" : "#8b2020";

  // Schwächste Themen (Kapitel mit den meisten Fehlern)
  var chapterMap = {};
  examQueue.forEach(function(entry, i) {
    var cid = entry.chapterId;
    if (!chapterMap[cid]) chapterMap[cid] = { name: entry.chapterName, correct: 0, total: 0 };
    chapterMap[cid].total++;
    // We track per-question correctness via SM-2 state changes; use the score delta
  });
  // Rebuild from SM-2 state changes this session
  var sm2Now = loadSm2State();
  // Actually, let's just show overall session stats without per-chapter for simplicity
  // The SM-2 state already encodes the data for future sessions

  document.getElementById("app").innerHTML =
    '<section class="card result-hero">' +
    '  <span class="result-icon">' + icon + "</span>" +
    '  <div class="result-score" style="color:' + scoreColor + '">' + examCorrect + "/" + total + "</div>" +
    '  <div class="result-label">' + label + "</div>" +
    '  <div class="result-pct">' + pct + "% korrekt</div>" +
    '  <div class="result-retry-hint">' +
    "Alle Fragen wurden ins Wiederholungs-System eingetragen." +
    "  </div>" +
    "</section>" +
    '<div class="button-row result-actions">' +
    '  <button onclick="startExamMode()">&#x1F501; Neue Session</button>' +
    '  <button class="secondary" onclick="goHome()">Zur &#xDC;bersicht</button>' +
    "</div>";

  triggerViewTransition();
}

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

// S3.2 – Modul-Quiz
window.startModuleQuiz      = startModuleQuiz;
window.selectModuleAnswer   = selectModuleAnswer;
window.nextModuleQuestion   = nextModuleQuestion;

// S3.3 – Exam Mode
window.startExamMode        = startExamMode;
window.selectExamAnswer     = selectExamAnswer;
window.nextExamQuestion     = nextExamQuestion;
window.confirmAbortExam     = confirmAbortExam;

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
