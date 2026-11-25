// Навигация по вкладкам
const tabBtns = document.querySelectorAll('.tab-btn');
const panels = {
  translate: document.getElementById('panel-translate'),
  cards: document.getElementById('panel-cards'),
  dialog: document.getElementById('panel-dialog')
};

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const name = btn.getAttribute('data-tab');
    Object.keys(panels).forEach(k => {
      panels[k].classList.toggle('hidden', k !== name);
    });
    if (name === 'cards') renderNextFlashcard();
  });
});

// Элементы вкладки Перевод
const topicInput = document.getElementById('topic-input');
const generateBtn = document.getElementById('generate-btn');
const targetSentence = document.getElementById('target-sentence');
const micBtn = document.getElementById('mic-btn');
const statusText = document.getElementById('status-text');
const manualInputBtn = document.getElementById('manual-input-btn');
const retryBtn = document.getElementById('retry-btn');

const speechEditCard = document.getElementById('speech-edit-card');
const speechInput = document.getElementById('speech-input');
const editSpeechBtn = document.getElementById('edit-speech-btn');
const submitSpeechBtn = document.getElementById('submit-speech-btn');

const feedbackBox = document.getElementById('feedback-box');
const feedbackContent = document.getElementById('feedback-content');
const speakBtn = document.getElementById('speak-btn');
const nextCardBtn = document.getElementById('next-card-btn');

const levelPills = document.querySelectorAll('#level-pills .pill');
const lengthPills = document.querySelectorAll('#length-pills .pill');

let selectedLevel = 'A2';
let selectedLength = 'среднее';

levelPills.forEach(pill => {
  pill.addEventListener('click', () => {
    levelPills.forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    selectedLevel = pill.getAttribute('data-level');
  });
});

lengthPills.forEach(pill => {
  pill.addEventListener('click', () => {
    lengthPills.forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    selectedLength = pill.getAttribute('data-length');
  });
});

// Статистика, ошибки и карточки
const streakCountElem = document.getElementById('streak-count');
const totalCountElem = document.getElementById('total-count');
const cardsCountElem = document.getElementById('cards-count');
const mistakesContainer = document.getElementById('mistakes-container');
const mistakesList = document.getElementById('mistakes-list');
const clearMistakesBtn = document.getElementById('clear-mistakes');

let streak = parseInt(localStorage.getItem('streak') || '0', 10);
let total = parseInt(localStorage.getItem('total') || '0', 10);
let mistakes = JSON.parse(localStorage.getItem('mistakes') || '[]');
let recentHistory = JSON.parse(localStorage.getItem('recentHistory') || '[]');
let flashcards = JSON.parse(localStorage.getItem('flashcards') || '[]');

let isRecording = false;
let recognition = null;
let currentRussianSentence = '';
let currentEnglishTranslation = '';
let lastAction = null;
let lastUserSpeech = '';
let alreadyCountedForCurrent = false;
let currentCard = null;
let dialogHistory = [];

updateStatsUI();
renderMistakes();

// Распознавание речи
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;

  recognition.onstart = () => {
    isRecording = true;
    micBtn.classList.add('recording');
    statusText.innerText = 'Слушаю... Говорите по-английски';
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    stopMic();
    openSpeechEditor(transcript);
    statusText.innerText = 'Проверьте текст ниже. При необходимости измените и нажмите «Готово».';
  };

  recognition.onerror = () => {
    statusText.innerText = 'Ошибка микрофона. Попробуйте снова или отредактируйте текст вручную.';
    stopMic();
    if (currentRussianSentence) {
      openSpeechEditor(speechInput.value || '');
    }
  };

  recognition.onend = () => stopMic();
} else {
  statusText.innerText = 'Голосовой ввод не поддерживается — используйте ручной ввод.';
}

function stopMic() {
  isRecording = false;
  micBtn.classList.remove('recording');
  if (recognition) {
    try {
      recognition.stop();
      recognition.abort();
    } catch (e) {}
  }
}

function openSpeechEditor(text) {
  speechInput.value = text;
  speechEditCard.classList.remove('hidden');
}

editSpeechBtn.addEventListener('click', () => {
  speechInput.focus();
  speechInput.setSelectionRange(speechInput.value.length, speechInput.value.length);
  statusText.innerText = 'Подправьте предложение и нажмите «Готово»';
});

manualInputBtn.addEventListener('click', () => {
  openSpeechEditor(speechInput.value || '');
  speechInput.focus();
});

submitSpeechBtn.addEventListener('click', () => {
  const editedText = speechInput.value.trim();
  if (!editedText) {
    statusText.innerText = 'Введите перевод перед отправкой.';
    speechInput.focus();
    return;
  }
  lastUserSpeech = editedText;
  checkTranslation(editedText);
});

micBtn.addEventListener('click', () => {
  if (!recognition) return;
  if (isRecording) {
    stopMic();
  } else {
    feedbackBox.classList.add('hidden');
    retryBtn.classList.add('hidden');
    recognition.start();
  }
});

function speakEnglish(text) {
  if (!text || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.92;
  window.speechSynthesis.speak(utterance);
}

speakBtn.addEventListener('click', () => speakEnglish(currentEnglishTranslation));

// Запрос через серверную функцию Netlify (ключ скрыт на сервере)
async function callGemini(promptText, maxTokens = 160, temperature = 0.85) {
  const response = await fetch('/.netlify/functions/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || data.error || 'Сервер перегружен или недоступен');
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Пустой ответ от ИИ');
  }
  return text.trim();
}

// --- 1. ПЕРЕВОД ---
async function generateSentence() {
  lastAction = 'generate';
  alreadyCountedForCurrent = false;
  const userTopic = topicInput.value.trim() || 'Путешествия';

  statusText.innerText = 'Генерирую предложение...';
  targetSentence.innerText = 'Загрузка...';
  feedbackBox.classList.add('hidden');
  speechEditCard.classList.add('hidden');
  speechInput.value = '';
  speakBtn.classList.add('hidden');
  manualInputBtn.classList.add('hidden');
  retryBtn.classList.add('hidden');

  // Шанс 20%: повторить ошибку из списка
  if (mistakes.length > 0 && Math.random() < 0.2) {
    const randomMistake = mistakes[Math.floor(Math.random() * mistakes.length)];
    currentRussianSentence = randomMistake.rus;
    currentEnglishTranslation = randomMistake.eng;
    targetSentence.innerText = `[Повторение] ${currentRussianSentence}`;
    statusText.innerText = 'Закрепляем известную ошибку! Нажмите на микрофон или введите текст';
    micBtn.disabled = false;
    manualInputBtn.classList.remove('hidden');
    speakBtn.classList.remove('hidden');
    return;
  }

  try {
    const historyListStr = recentHistory.length > 0 ? recentHistory.slice(0, 20).join('; ') : 'нет';
    const prompt = `Ситуация: "${userTopic}".
Уровень сложности английской грамматики: ${selectedLevel}.
Длина предложения: ${selectedLength} (короткое = 3-5 слов, среднее = 6-9 слов, длинное = 10+ слов).
Придумай УНИКАЛЬНОЕ предложение на русском для перевода и его идеальный английский перевод.
НЕ ИСПОЛЬЗУЙ ничего из этого списка ранее использованных фраз: [${historyListStr}].
Формат строго такой:
РУС: [текст]
АНГЛ: [текст]`;

    const result = await callGemini(prompt, 85, 0.95);
    const rusMatch = result.match(/РУС:\s*(.+)/i);
    const engMatch = result.match(/АНГЛ:\s*(.+)/i);

    if (rusMatch && engMatch) {
      currentRussianSentence = rusMatch[1].trim();
      currentEnglishTranslation = engMatch[1].trim();
      addToHistory(currentRussianSentence);
      targetSentence.innerText = currentRussianSentence;
      statusText.innerText = 'Нажмите на микрофон и произнесите перевод';
      micBtn.disabled = false;
      manualInputBtn.classList.remove('hidden');
      speakBtn.classList.remove('hidden');
    } else {
      currentRussianSentence = result;
      currentEnglishTranslation = '';
      targetSentence.innerText = result;
      statusText.innerText = 'Нажмите на микрофон';
      micBtn.disabled = false;
      manualInputBtn.classList.remove('hidden');
    }
  } catch (err) {
    targetSentence.innerText = 'Ошибка подключения к ИИ';
    statusText.innerText = 'Сервер перегружен. Нажмите «Повторить запрос».';
    retryBtn.classList.remove('hidden');
  }
}

generateBtn.addEventListener('click', generateSentence);
nextCardBtn.addEventListener('click', generateSentence);

async function checkTranslation(userSpeech) {
  lastAction = 'check';
  statusText.innerText = 'ИИ проверяет ваш ответ...';
  retryBtn.classList.add('hidden');
  submitSpeechBtn.disabled = true;

  try {
    const prompt = `Уровень: ${selectedLevel}
Фраза (рус): "${currentRussianSentence}"
Перевод (анг): "${currentEnglishTranslation}"
Ответ пользователя (анг): "${userSpeech}"

Оцени кратко на русском с поправкой на уровень ${selectedLevel}:
1. Статус: Верно / Ошибка.
2. Краткий комментарий (если ошибка).`;

    const resultText = await callGemini(prompt, 130, 0.7);
    feedbackContent.innerHTML = resultText.replace(/\n/g, '<br>');
    feedbackBox.classList.remove('hidden');

    if (!alreadyCountedForCurrent) {
      total++;
      localStorage.setItem('total', total);
      alreadyCountedForCurrent = true;
    }

    const isError = resultText.toLowerCase().includes('ошибка') || resultText.toLowerCase().includes('неверно');

    if (!isError) {
      streak++;
      statusText.innerText = 'Отлично! Верно! 🎉 Нажмите «Следующий пример»';
      removeMistake(currentRussianSentence);
    } else {
      streak = 0;
      statusText.innerText = 'Есть ошибки. Можно исправить текст выше и нажать «Готово».';
      addMistake(currentRussianSentence, currentEnglishTranslation);
      addFlashcard(currentRussianSentence, currentEnglishTranslation);
    }

    localStorage.setItem('streak', streak);
    updateStatsUI();
  } catch (err) {
    statusText.innerText = 'Сервер перегружен. Нажмите «Повторить запрос».';
    retryBtn.classList.remove('hidden');
  } finally {
    submitSpeechBtn.disabled = false;
  }
}

retryBtn.addEventListener('click', () => {
  if (lastAction === 'generate') generateSentence();
  else if (lastAction === 'check' && lastUserSpeech) checkTranslation(lastUserSpeech);
});

function addToHistory(sentence) {
  recentHistory.unshift(sentence);
  if (recentHistory.length > 30) recentHistory.pop();
  localStorage.setItem('recentHistory', JSON.stringify(recentHistory));
}

function addMistake(rus, eng) {
  if (!eng) return;
  if (!mistakes.some(m => m.rus === rus)) {
    mistakes.unshift({ rus, eng });
    if (mistakes.length > 20) mistakes.pop();
    localStorage.setItem('mistakes', JSON.stringify(mistakes));
    renderMistakes();
  }
}

function removeMistake(rus) {
  mistakes = mistakes.filter(m => m.rus !== rus);
  localStorage.setItem('mistakes', JSON.stringify(mistakes));
  renderMistakes();
}

function renderMistakes() {
  if (mistakes.length > 0) {
    mistakesContainer.classList.remove('hidden');
    mistakesList.innerHTML = mistakes.map(m => `
      <div class="mistake-item"><b>${m.rus}</b> → <i>${m.eng}</i></div>
    `).join('');
  } else {
    mistakesContainer.classList.add('hidden');
  }
}

clearMistakesBtn.addEventListener('click', () => {
  mistakes = [];
  localStorage.removeItem('mistakes');
  renderMistakes();
});

// --- 2. КАРТОЧКИ (ИНТЕРВАЛЬНОЕ ПОВТОРЕНИЕ + PDF) ---
const pdfUpload = document.getElementById('pdf-upload');
const pdfStatus = document.getElementById('pdf-status');
const fcFront = document.getElementById('fc-front');
const fcBack = document.getElementById('fc-back');
const fcToggleBtn = document.getElementById('fc-toggle-btn');
const fcSpeakBtn = document.getElementById('fc-speak-btn');

function saveFlashcards() {
  localStorage.setItem('flashcards', JSON.stringify(flashcards));
  updateStatsUI();
}

function addFlashcard(front, back) {
  if (!front || !back) return;
  if (flashcards.some(c => c.front.toLowerCase() === front.toLowerCase())) return;
  flashcards.push({
    id: Date.now() + Math.random(),
    front: front.trim(),
    back: back.trim(),
    due: Date.now()
  });
  saveFlashcards();
}

function renderNextFlashcard() {
  updateStatsUI();
  const now = Date.now();
  const dueCards = flashcards.filter(c => c.due <= now);
  const pool = dueCards.length ? dueCards : flashcards;

  if (!pool.length) {
    currentCard = null;
    fcFront.innerText = 'Карточек пока нет';
    fcBack.innerText = '';
    fcBack.classList.add('hidden');
    return;
  }

  currentCard = pool[0];
  fcFront.innerText = currentCard.front;
  fcBack.innerText = currentCard.back;
  fcBack.classList.add('hidden');
}

fcToggleBtn.addEventListener('click', () => {
  if (!currentCard) return;
  fcBack.classList.toggle('hidden');
});

fcSpeakBtn.addEventListener('click', () => {
  if (!currentCard) return;
  speakEnglish(currentCard.front);
});

document.querySelectorAll('.rate-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!currentCard) return;
    const rate = btn.getAttribute('data-rate');
    const minutes = rate === 'again' ? 1 : rate === 'hard' ? 30 : 1440;
    currentCard.due = Date.now() + minutes * 60 * 1000;
    saveFlashcards();
    renderNextFlashcard();
  });
});

pdfUpload.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !window.pdfjsLib) return;

  pdfStatus.innerText = 'Читаю PDF-файл...';
  try {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    let extracted = '';
    const pagesToRead = Math.min(pdf.numPages, 6);
    for (let i = 1; i <= pagesToRead; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      extracted += content.items.map(item => item.str).join(' ') + '\n';
    }

    const clipped = extracted.slice(0, 3500);
    pdfStatus.innerText = 'ИИ формирует карточки слов...';

    const raw = await callGemini(
      `Извлеки пары английское слово/фраза и перевод на русский (до 20 пар). Верни ТОЛЬКО JSON-массив [{"en":"...","ru":"..."}] без пояснений:\n${clipped}`,
      450,
      0.3
    );

    const jsonText = raw.replace(/```json|```/g, '').trim();
    const list = JSON.parse(jsonText);
    let added = 0;
    list.forEach(item => {
      if (item.en && item.ru) {
        addFlashcard(item.en, item.ru);
        added++;
      }
    });

    pdfStatus.innerText = `Добавлено карточек: ${added}`;
    renderNextFlashcard();
  } catch (err) {
    pdfStatus.innerText = `Ошибка разбора PDF: ${err.message}`;
  }
});

// --- 3. ДИАЛОГ (МИНИМАЛЬНЫЙ КОНТЕКСТ И КОРОТКИЕ ОТВЕТЫ) ---
const scenarioSelect = document.getElementById('scenario-select');
const startDialogBtn = document.getElementById('start-dialog-btn');
const chatBox = document.getElementById('chat-box');
const dialogInput = document.getElementById('dialog-input');
const sendDialogBtn = document.getElementById('send-dialog-btn');

function renderDialog() {
  if (!dialogHistory.length) {
    chatBox.innerHTML = '<div class="small-note">Нажмите «Начать новый диалог», чтобы ИИ задал первый вопрос.</div>';
    return;
  }
  chatBox.innerHTML = dialogHistory.map(m => {
    const tipHtml = m.tip ? `<div class="chat-tip">💡 ${m.tip}</div>` : '';
    return `<div class="chat-msg ${m.role}">${m.text}${tipHtml}</div>`;
  }).join('');
  chatBox.scrollTop = chatBox.scrollHeight;
}

startDialogBtn.addEventListener('click', async () => {
  const scenario = scenarioSelect.value;
  dialogHistory = [];
  startDialogBtn.disabled = true;
  chatBox.innerHTML = '<div class="small-note">Собеседник подключается...</div>';

  try {
    const opener = await callGemini(
      `Ролевая игра: "${scenario}", уровень ${selectedLevel}. Начни диалог 1 короткой фразой на английском.`,
      65,
      0.85
    );
    dialogHistory.push({ role: 'ai', text: opener });
    renderDialog();
    speakEnglish(opener);
  } catch (err) {
    chatBox.innerHTML = `<div class="small-note">${err.message}</div>`;
  } finally {
    startDialogBtn.disabled = false;
  }
});

async function sendDialogReply() {
  const text = dialogInput.value.trim();
  if (!text) return;
  dialogInput.value = '';
  dialogHistory.push({ role: 'user', text });
  renderDialog();

  const shortContext = dialogHistory
    .slice(-4)
    .map(m => `${m.role === 'ai' ? 'AI' : 'User'}: ${m.text}`)
    .join('\n');

  sendDialogBtn.disabled = true;
  try {
    const raw = await callGemini(
      `Сценарий: "${scenarioSelect.value}", уровень ${selectedLevel}. Контекст:\n${shortContext}\nОтветь в 2 строках:\nAI: [1-2 коротких предложения на английском]\nTIP: [короткая подсказка на русском или "ок"]`,
      140,
      0.8
    );
    const aiMatch = raw.match(/AI:\s*(.+)/i);
    const tipMatch = raw.match(/TIP:\s*(.+)/i);
    const aiReply = aiMatch ? aiMatch[1].trim() : raw;
    const tipText = tipMatch && !/^ок$/i.test(tipMatch[1].trim()) ? tipMatch[1].trim() : '';

    dialogHistory.push({ role: 'ai', text: aiReply, tip: tipText });
    dialogHistory = dialogHistory.slice(-4);
    renderDialog();
    speakEnglish(aiReply);
  } catch (err) {
    dialogHistory.push({ role: 'ai', text: err.message });
    renderDialog();
  } finally {
    sendDialogBtn.disabled = false;
  }
}

sendDialogBtn.addEventListener('click', sendDialogReply);
dialogInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendDialogReply();
});

function updateStatsUI() {
  streakCountElem.innerText = streak;
  totalCountElem.innerText = total;
  cardsCountElem.innerText = flashcards.length;
}