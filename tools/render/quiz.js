// No-JavaScript version of the "How water-wise are you?" quiz, built from
// data/quiz.json. With JavaScript on, scripts/pledge-quiz.js replaces it with the
// interactive, one-question-at-a-time quiz (and browsers ignore <noscript>).

export default function renderQuiz({ readJSON, escapeHtml }) {
  const quiz = readJSON('data/quiz.json');
  const questions = quiz.questions
    .map((q) => {
      const options = q.options.map((o) => `<li>${escapeHtml(o)}</li>`).join('');
      const cites = (q.cite || []).map((id) => `<a class="cite" href="#src-${escapeHtml(id)}"></a>`).join('');
      return (
        `<li class="quiz__static-q"><p class="quiz__static-prompt">${escapeHtml(q.prompt)}</p>` +
        `<ol class="quiz__static-options" type="A">${options}</ol>` +
        `<p class="quiz__static-answer"><strong>Answer:</strong> ${escapeHtml(q.options[q.answer])}. ` +
        `${escapeHtml(q.explain)}${cites ? `<sup>${cites}</sup>` : ''}</p></li>`
      );
    })
    .join('');
  return (
    `<noscript><p class="quiz__fallback">Turn on JavaScript to take the quiz one question at a time. ` +
    `Here are the questions and answers:</p><ol class="quiz__static">${questions}</ol></noscript>`
  );
}
