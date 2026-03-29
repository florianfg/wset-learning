const STORAGE_PREFIX = "wsetLevel2Progress_";
const UI_STATE_KEY = "wsetLevel2UiState";

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
    currentCard, currentQuestion, currentMode, questionAnswered, selectedAnswer, correctAnswers, wrongAnswers
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
}

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
  currentMode = "quiz";
  currentQuestion = 0;
  correctAnswers = 0;
  wrongAnswers = 0;
  questionAnswered = false;
  selectedAnswer = null;
  saveChapterProgress();
  showQuestion();
}

function showQuestion() {
  const activeQuestions = getQuestionsForChapter(activeChapterId);

  if (activeQuestions.length === 0) { showEmptyChapterState(); return; }
  if (currentQuestion >= activeQuestions.length) { showResults(); return; }

  const question = activeQuestions[currentQuestion];
  const chapter  = getChapter(activeChapterId);
  const section  = getSection(activeSectionId);

  const optionsHtml = question.options.map((option, index) => {
    let cls = "option";
    if (questionAnswered) {
      if (index === question.correct) cls += " correct";
      else if (index === selectedAnswer) cls += " wrong";
    }
    return `<button class="${cls}" onclick="selectAnswer(${index})" ${questionAnswered ? "disabled" : ""}>${escapeHtml(option)}</button>`;
  }).join("");

  document.getElementById("app").innerHTML = `
    ${renderTopbar("Quiz", currentQuestion + 1, activeQuestions.length)}
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
  const q = getQuestionsForChapter(activeChapterId)[currentQuestion];
  selectedAnswer = index;
  questionAnswered = true;
  if (index === q.correct) correctAnswers += 1;
  else wrongAnswers += 1;
  saveChapterProgress();
  showQuestion();
}

function nextQuestion() {
  currentQuestion += 1;
  questionAnswered = false;
  selectedAnswer = null;
  saveChapterProgress();
  showQuestion();
}

function showResults() {
  const total = getQuestionsForChapter(activeChapterId).length;
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

  document.getElementById("app").innerHTML = `
    <section class="card result-hero">
      <span class="result-icon">${icon}</span>
      <div class="result-score" style="color:${scoreColor}">${correctAnswers}/${total}</div>
      <div class="result-label">${label}</div>
      <div class="result-pct">${percentage}% korrekt · Quiz abgeschlossen</div>
    </section>
    <div class="button-row two-buttons">
      <button class="secondary" onclick="restartChapter()">Nochmal</button>
      <button onclick="showCard()">Zurück zu den Karten</button>
    </div>
  `;

  saveChapterProgress();
}

function restartChapter() {
  currentCard = 0; currentQuestion = 0; currentMode = "study";
  questionAnswered = false; selectedAnswer = null; correctAnswers = 0; wrongAnswers = 0;
  saveChapterProgress();
  showCard();
}

// ---------------------------------------------------------------------------
// Dashboard Home-Screen
// ---------------------------------------------------------------------------

function goHome() {
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

  // "Weiter lernen" – letztes aktives Kapitel oder erstes Kapitel
  const lastChapter = getChapter(activeChapterId);
  const lastSection = lastChapter ? getSection(lastChapter.sectionId) : null;
  const hasProgress = stats.answeredQuestions > 0 || stats.progressPercentage > 0;

  const ctaLabel = hasProgress ? "Weiter lernen" : "Lernen starten";
  const ctaHint = hasProgress && lastChapter
    ? `${escapeHtml(lastSection?.name || "")} · ${escapeHtml(lastChapter.name)}`
    : "Fang beim ersten Modul an";

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
// Service Worker
// ---------------------------------------------------------------------------

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
}

// ---------------------------------------------------------------------------
// Globale onclick-Handler
// ---------------------------------------------------------------------------

window.setActiveSection  = setActiveSection;
window.setActiveChapter  = setActiveChapter;
window.openNavSheet      = openNavSheet;
window.closeNavSheet     = closeNavSheet;
window.goHome            = goHome;
window.continueLearning  = continueLearning;
window.previousCard      = previousCard;
window.nextCard          = nextCard;
window.startQuiz         = startQuiz;
window.showCard          = showCard;
window.selectAnswer      = selectAnswer;
window.nextQuestion      = nextQuestion;
window.restartChapter    = restartChapter;

// ---------------------------------------------------------------------------
// Initialisierung
// ---------------------------------------------------------------------------

loadUiState();
loadChapterState(activeChapterId);
registerServiceWorker();
currentView = "home"; // immer auf Home-Screen starten
render();
