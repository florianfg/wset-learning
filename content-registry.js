// content-registry.js
// Zentrale Registry für alle Lernkarten und Quizfragen.
// Jedes Kapitel registriert sich selbst über registerChapterContent().

const _registry = {};

function registerChapterContent(chapterId, data) {
  _registry[chapterId] = {
    cards: (data.cards || []).map((card) => ({ ...card, chapterId })),
    questions: (data.questions || []).map((q) => ({ ...q, chapterId }))
  };
}

function getCardsForChapter(chapterId) {
  return _registry[chapterId]?.cards || [];
}

function getQuestionsForChapter(chapterId) {
  return _registry[chapterId]?.questions || [];
}
