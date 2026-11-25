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
      if (panels[k]) panels[k].classList.toggle('hidden', k !== name);
    });
    if (name === 'cards') {
      renderDecksList();
      renderNextFlashcard();
    }
  });
});

// Элементы вкладки Перевод
const topicInput = document.getElementById('topic-input');
const generateBtn = document.getElementById('generate-btn');
const targetSentence = document.getElementById('target-sentence');
const fastMicBtn = document.getElementById('fast-mic-btn');
const recordMicBtn = document.getElementById('record-mic-btn');
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
let decks = JSON.parse(localStorage.getItem('decks') || '[]');

// Состояние двух режимов голоса: 'fast' (браузер) и 'record' (аудио в Gemini)
let activeVoiceMode = null; // null | 'fast' | 'record'
let manualStopRequested = false;
let hasGeneratedSentence = false;

let recognition = null;
let browserTranscript = '';

let mediaRecorder = null;
let audioStream = null;
let audioChunks = [];
let recordedMimeType = 'audio/webm';

let currentRussianSentence = '';
let currentEnglishTranslation = '';
let lastAction = null;
let lastUserSpeech = '';
let alreadyCountedForCurrent = false;
let currentCard = null;
let dialogHistory = [];

// Состояние режимов карточек
let cardMode = 'all'; // 'all' | 'decks'
let hardStreakCount = 0;
let allModeSeenIds = new Set();
let activeSessionDeckIds = [];
let activeSessionQueue = [];
let activeSessionTotal = 0;
let activeSessionReport = { easy: 0, hard: 0, again: 0 };

updateStatsUI();
renderMistakes();

// --- ПОДБОР МЯГКОГО ЖЕНСКОГО ГОЛОСА ОЗВУЧКИ ---
let availableVoices = [];

function refreshVoices() {
  if (!('speechSynthesis' in window)) return;
  availableVoices = window.speechSynthesis.getVoices() || [];
}

if ('speechSynthesis' in window) {
  refreshVoices();
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}

function selectSmoothFemaleVoice() {
  if (!availableVoices.length) refreshVoices();
  if (!availableVoices.length) return null;

  const enVoices = availableVoices.filter(v => /^en[-_]/i.test(v.lang));
  const pool = enVoices.length ? enVoices : availableVoices;

  const preferredPatterns = [
    /samantha/i,
    /victoria/i,
    /karen/i,
    /moira/i,
    /tessa/i,
    /fiona/i,
    /google uk english female/i,
    /google us english/i,
    /aria/i,
    /jenny/i,
    /sonia/i,
    /zira/i,
    /female/i,
    /woman/i
  ];

  for (const pattern of preferredPatterns) {
    const match = pool.find(v => pattern.test(v.name));
    if (match) return match;
  }

  return pool.find(v => /en-US|en-GB/i.test(v.lang)) || pool[0];
}

function speakEnglish(text) {
  const cleanText = (text || '').trim();
  if (!cleanText || !('speechSynthesis' in window)) return;

  try {
    window.speechSynthesis.cancel();
  } catch (e) {}

  const utterance = new SpeechSynthesisUtterance(cleanText);
  const voice = selectSmoothFemaleVoice();
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang || 'en-US';
  } else {
    utterance.lang = 'en-US';
  }

  utterance.rate = 0.9;
  utterance.pitch = 1.06;
  utterance.volume = 1.0;

  window.speechSynthesis.speak(utterance);
}

// --- ДВЕ КНОПКИ ГОЛОСА: «⚡ БЫСТРО» И «🎙️ ЗАПИСЬ» ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const hasAudioRecorder = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

function syncVoiceButtonsUI(processing = false) {
  if (fastMicBtn) {
    fastMicBtn.disabled = processing || !hasGeneratedSentence || !SpeechRecognition || (activeVoiceMode === 'record');
    fastMicBtn.classList.toggle('recording', activeVoiceMode === 'fast');
    fastMicBtn.innerText = activeVoiceMode === 'fast' ? '⏹ Стоп' : '⚡ Быстро';
  }
  if (recordMicBtn) {
    recordMicBtn.disabled = processing || !hasGeneratedSentence || !hasAudioRecorder || (activeVoiceMode === 'fast');
    recordMicBtn.classList.toggle('recording', activeVoiceMode === 'record');
    recordMicBtn.innerText = activeVoiceMode === 'record' ? '⏹ Стоп' : '🎙️ Запись';
  }
}

syncVoiceButtonsUI(false);

function pickSupportedMimeType() {
  if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/aac',
    'audio/ogg;codecs=opus'
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      if (!base64) reject(new Error('Не удалось прочитать аудиозапись'));
      else resolve(base64);
    };
    reader.onerror = () => reject(new Error('Ошибка чтения аудиофайла'));
    reader.readAsDataURL(blob);
  });
}

async function transcribeAudioWithGemini(audioBlob, mimeType) {
  const base64Data = await blobToBase64(audioBlob);
  const cleanMime = (mimeType || audioBlob.type || 'audio/webm').split(';')[0];

  const response = await fetch('/.netlify/functions/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          {
            inlineData: {
              mimeType: cleanMime,
              data: base64Data
            }
          },
          {
            text: 'Распознай английскую речь из аудио. Человек мог говорить в обычном беглом темпе. Верни ТОЛЬКО текст на английском без кавычек, перевода и пояснений. Если речи нет — пустую строку.'
          }
        ]
      }],
      generationConfig: {
        maxOutputTokens: 80,
        temperature: 0.2
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || data.error || 'Ошибка распознавания аудио');
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return text.trim().replace(/^["']|["']$/g, '');
}

function cleanupAudioStream() {
  if (audioStream) {
    try {
      audioStream.getTracks().forEach(t => t.stop());
    } catch (_) {}
    audioStream = null;
  }
}

function setupFastRecognition() {
  if (!SpeechRecognition) return null;
  const rec = new SpeechRecognition();
  rec.lang = 'en-US';
  rec.continuous = false;
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    activeVoiceMode = 'fast';
    manualStopRequested = false;
    browserTranscript = '';
    syncVoiceButtonsUI(false);
    if (statusText) statusText.innerText = '⚡ Быстрый режим: говорите, затем нажмите «Стоп»';
  };

  rec.onresult = (event) => {
    const transcript = event?.results?.[0]?.[0]?.transcript?.trim() || '';
    if (transcript) {
      browserTranscript = transcript;
    }
  };

  rec.onerror = (event) => {
    const errCode = event?.error || '';
    activeVoiceMode = null;
    syncVoiceButtonsUI(false);

    if (manualStopRequested && browserTranscript) {
      openSpeechEditor(browserTranscript);
      if (statusText) statusText.innerText = 'Готово! Проверьте текст и нажмите «Готово».';
      return;
    }

    if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
      if (statusText) statusText.innerText = 'Нет доступа к микрофону. Разрешите его в браузере или введите вручную.';
    } else if (statusText) {
      statusText.innerText = 'Быстрый микрофон не уловил фразу. Попробуйте «🎙️ Запись» или введите вручную.';
    }
    if (currentRussianSentence) openSpeechEditor(browserTranscript);
  };

  rec.onend = () => {
    const captured = browserTranscript || (speechInput ? speechInput.value.trim() : '');
    activeVoiceMode = null;
    manualStopRequested = false;
    syncVoiceButtonsUI(false);

    if (captured) {
      openSpeechEditor(captured);
      if (statusText) statusText.innerText = 'Готово! Проверьте текст и нажмите «Готово».';
    } else if (currentRussianSentence) {
      openSpeechEditor('');
      if (statusText) statusText.innerText = 'Ничего не услышал. Попробуйте «⚡ Быстро», «🎙️ Запись» или ручной ввод.';
    }
  };

  return rec;
}

recognition = setupFastRecognition();

async function startFastVoice() {
  if (!recognition || !hasGeneratedSentence) return;
  if (feedbackBox) feedbackBox.classList.add('hidden');
  if (retryBtn) retryBtn.classList.add('hidden');
  if (speechInput) speechInput.value = '';
  browserTranscript = '';

  try {
    recognition.start();
  } catch (_) {
    resetVoiceState();
    recognition = setupFastRecognition();
    if (recognition) {
      try {
        recognition.start();
      } catch (__) {
        if (statusText) statusText.innerText = 'Не удалось запустить быстрый микрофон. Попробуйте «🎙️ Запись».';
      }
    }
  }
}

async function startRecordVoice() {
  if (!hasAudioRecorder || !hasGeneratedSentence) return;

  try {
    if (feedbackBox) feedbackBox.classList.add('hidden');
    if (retryBtn) retryBtn.classList.add('hidden');
    if (speechInput) speechInput.value = '';

    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chosenMime = pickSupportedMimeType();
    mediaRecorder = chosenMime
      ? new MediaRecorder(audioStream, { mimeType: chosenMime })
      : new MediaRecorder(audioStream);

    recordedMimeType = mediaRecorder.mimeType || chosenMime || 'audio/webm';
    audioChunks = [];
    activeVoiceMode = 'record';
    manualStopRequested = false;
    syncVoiceButtonsUI(false);

    if (statusText) statusText.innerText = '🎙️ Идёт запись... Говорите в обычном темпе и нажмите «Стоп»';

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      activeVoiceMode = null;
      syncVoiceButtonsUI(true);

      const finalMime = mediaRecorder?.mimeType || recordedMimeType;
      const blob = new Blob(audioChunks, { type: finalMime });
      audioChunks = [];
      mediaRecorder = null;
      cleanupAudioStream();

      if (!blob.size || blob.size < 400) {
        syncVoiceButtonsUI(false);
        if (statusText) statusText.innerText = 'Запись пустая или слишком короткая. Попробуйте ещё раз.';
        if (currentRussianSentence) openSpeechEditor('');
        return;
      }

      if (statusText) statusText.innerText = 'Распознаю запись голоса через ИИ...';

      try {
        const transcript = await transcribeAudioWithGemini(blob, finalMime);
        if (transcript) {
          openSpeechEditor(transcript);
          if (statusText) statusText.innerText = 'Распознано! Проверьте текст и нажмите «Готово».';
        } else {
          if (statusText) statusText.innerText = 'Речь не распознана. Попробуйте ещё раз или введите вручную.';
          if (currentRussianSentence) openSpeechEditor('');
        }
      } catch (err) {
        if (statusText) statusText.innerText = `Ошибка распознавания (${err.message}). Введите вручную.`;
        if (currentRussianSentence) openSpeechEditor('');
      } finally {
        syncVoiceButtonsUI(false);
      }
    };

    mediaRecorder.start();
  } catch (err) {
    activeVoiceMode = null;
    syncVoiceButtonsUI(false);
    cleanupAudioStream();
    if (statusText) {
      statusText.innerText = 'Нет доступа к микрофону. Разрешите его в браузере или введите вручную.';
    }
    if (currentRussianSentence) openSpeechEditor('');
  }
}

function stopCurrentVoice() {
  manualStopRequested = true;

  if (activeVoiceMode === 'record' && mediaRecorder && mediaRecorder.state !== 'inactive') {
    try {
      mediaRecorder.stop();
    } catch (_) {
      activeVoiceMode = null;
      syncVoiceButtonsUI(false);
      cleanupAudioStream();
    }
    return;
  }

  activeVoiceMode = null;
  syncVoiceButtonsUI(false);
  if (recognition) {
    try {
      recognition.stop();
    } catch (_) {}
  }
}

function resetVoiceState() {
  manualStopRequested = false;
  activeVoiceMode = null;
  browserTranscript = '';

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.onstop = null;
    try {
      mediaRecorder.stop();
    } catch (_) {}
  }
  mediaRecorder = null;
  audioChunks = [];
  cleanupAudioStream();

  if (recognition) {
    try {
      recognition.abort();
    } catch (_) {}
  }
  syncVoiceButtonsUI(false);
}

function openSpeechEditor(text) {
  if (speechInput) speechInput.value = text;
  if (speechEditCard) speechEditCard.classList.remove('hidden');
}

if (editSpeechBtn) {
  editSpeechBtn.addEventListener('click', () => {
    if (!speechInput) return;
    speechInput.focus();
    speechInput.setSelectionRange(speechInput.value.length, speechInput.value.length);
    if (statusText) statusText.innerText = 'Подправьте предложение и нажмите «Готово»';
  });
}

if (manualInputBtn) {
  manualInputBtn.addEventListener('click', () => {
    openSpeechEditor(speechInput ? speechInput.value || '' : '');
    if (speechInput) speechInput.focus();
  });
}

if (submitSpeechBtn) {
  submitSpeechBtn.addEventListener('click', () => {
    const editedText = speechInput ? speechInput.value.trim() : '';
    if (!editedText) {
      if (statusText) statusText.innerText = 'Введите перевод перед отправкой.';
      if (speechInput) speechInput.focus();
      return;
    }
    lastUserSpeech = editedText;
    checkTranslation(editedText);
  });
}

if (fastMicBtn) {
  fastMicBtn.addEventListener('click', () => {
    if (activeVoiceMode === 'fast') {
      stopCurrentVoice();
    } else if (!activeVoiceMode) {
      startFastVoice();
    }
  });
}

if (recordMicBtn) {
  recordMicBtn.addEventListener('click', async () => {
    if (activeVoiceMode === 'record') {
      stopCurrentVoice();
    } else if (!activeVoiceMode) {
      await startRecordVoice();
    }
  });
}

if (speakBtn) {
  speakBtn.addEventListener('click', () => speakEnglish(currentEnglishTranslation));
}

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
  hasGeneratedSentence = false;
  resetVoiceState();
  const userTopic = (topicInput && topicInput.value.trim()) || 'Путешествия';

  if (statusText) statusText.innerText = 'Генерирую предложение...';
  if (targetSentence) targetSentence.innerText = 'Загрузка...';
  if (feedbackBox) feedbackBox.classList.add('hidden');
  if (speechEditCard) speechEditCard.classList.add('hidden');
  if (speechInput) speechInput.value = '';
  if (speakBtn) speakBtn.classList.add('hidden');
  if (manualInputBtn) manualInputBtn.classList.add('hidden');
  if (retryBtn) retryBtn.classList.add('hidden');

  if (mistakes.length > 0 && Math.random() < 0.2) {
    const randomMistake = mistakes[Math.floor(Math.random() * mistakes.length)];
    currentRussianSentence = randomMistake.rus;
    currentEnglishTranslation = randomMistake.eng;
    hasGeneratedSentence = true;
    if (targetSentence) targetSentence.innerText = `[Повторение] ${currentRussianSentence}`;
    if (statusText) statusText.innerText = 'Закрепляем ошибку! Выберите «⚡ Быстро», «🎙️ Запись» или введите текст';
    syncVoiceButtonsUI(false);
    if (manualInputBtn) manualInputBtn.classList.remove('hidden');
    if (speakBtn) speakBtn.classList.remove('hidden');
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
      hasGeneratedSentence = true;
      if (targetSentence) targetSentence.innerText = currentRussianSentence;
      if (statusText) statusText.innerText = 'Выберите «⚡ Быстро» или «🎙️ Запись» (повторное нажатие — стоп)';
      syncVoiceButtonsUI(false);
      if (manualInputBtn) manualInputBtn.classList.remove('hidden');
      if (speakBtn) speakBtn.classList.remove('hidden');
    } else {
      currentRussianSentence = result;
      currentEnglishTranslation = '';
      hasGeneratedSentence = true;
      if (targetSentence) targetSentence.innerText = result;
      if (statusText) statusText.innerText = 'Выберите «⚡ Быстро» или «🎙️ Запись»';
      syncVoiceButtonsUI(false);
      if (manualInputBtn) manualInputBtn.classList.remove('hidden');
    }
  } catch (err) {
    if (targetSentence) targetSentence.innerText = 'Ошибка подключения к ИИ';
    if (statusText) statusText.innerText = 'Сервер перегружен. Нажмите «Повторить запрос».';
    if (retryBtn) retryBtn.classList.remove('hidden');
  }
}

if (generateBtn) generateBtn.addEventListener('click', generateSentence);
if (nextCardBtn) nextCardBtn.addEventListener('click', generateSentence);

async function checkTranslation(userSpeech) {
  lastAction = 'check';
  if (statusText) statusText.innerText = 'ИИ проверяет ваш ответ...';
  if (retryBtn) retryBtn.classList.add('hidden');
  if (submitSpeechBtn) submitSpeechBtn.disabled = true;

  try {
    const prompt = `Уровень: ${selectedLevel}
Фраза (рус): "${currentRussianSentence}"
Перевод (анг): "${currentEnglishTranslation}"
Ответ пользователя (анг): "${userSpeech}"
Примечание: ответ мог быть записан голосом, поэтому мелкие опечатки распознавания не считай грубой ошибкой, если смысл и грамматика в целом верны.

Оцени кратко на русском с поправкой на уровень ${selectedLevel}:
1. Статус: Верно / Ошибка.
2. Краткий комментарий (если ошибка).`;

    const resultText = await callGemini(prompt, 130, 0.7);
    if (feedbackContent) feedbackContent.innerHTML = resultText.replace(/\n/g, '<br>');
    if (feedbackBox) feedbackBox.classList.remove('hidden');

    if (!alreadyCountedForCurrent) {
      total++;
      localStorage.setItem('total', total);
      alreadyCountedForCurrent = true;
    }

    const isError = resultText.toLowerCase().includes('ошибка') || resultText.toLowerCase().includes('неверно');

    if (!isError) {
      streak++;
      if (statusText) statusText.innerText = 'Отлично! Верно! 🎉 Нажмите «Следующий пример»';
      removeMistake(currentRussianSentence);
    } else {
      streak = 0;
      if (statusText) statusText.innerText = 'Есть ошибки. Можно исправить текст выше и нажать «Готово».';
      addMistake(currentRussianSentence, currentEnglishTranslation);
      addFlashcard(currentRussianSentence, currentEnglishTranslation);
    }

    localStorage.setItem('streak', streak);
    updateStatsUI();
  } catch (err) {
    if (statusText) statusText.innerText = 'Сервер перегружен. Нажмите «Повторить запрос».';
    if (retryBtn) retryBtn.classList.remove('hidden');
  } finally {
    if (submitSpeechBtn) submitSpeechBtn.disabled = false;
  }
}

if (retryBtn) {
  retryBtn.addEventListener('click', () => {
    if (lastAction === 'generate') generateSentence();
    else if (lastAction === 'check' && lastUserSpeech) checkTranslation(lastUserSpeech);
  });
}

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
  if (!mistakesContainer || !mistakesList) return;
  if (mistakes.length > 0) {
    mistakesContainer.classList.remove('hidden');
    mistakesList.innerHTML = mistakes.map(m => `
      <div class="mistake-item"><b>${escapeHtml(m.rus)}</b> → <i>${escapeHtml(m.eng)}</i></div>
    `).join('');
  } else {
    mistakesContainer.classList.add('hidden');
  }
}

if (clearMistakesBtn) {
  clearMistakesBtn.addEventListener('click', () => {
    mistakes = [];
    localStorage.removeItem('mistakes');
    renderMistakes();
  });
}

// --- 2. КАРТОЧКИ: ДВА РЕЖИМА, ИИ-ГЕНЕРАТОР 20 КАРТОЧЕК + ЭКСПОРТ В PDF ---
const pdfUpload = document.getElementById('pdf-upload');
const pdfStatus = document.getElementById('pdf-status');
const fcFront = document.getElementById('fc-front');
const fcBack = document.getElementById('fc-back');
const fcToggleBtn = document.getElementById('fc-toggle-btn');
const fcSpeakBtn = document.getElementById('fc-speak-btn');

const modeAllBtn = document.getElementById('mode-all-btn');
const modeDecksBtn = document.getElementById('mode-decks-btn');
const decksSelectorBox = document.getElementById('decks-selector-box');
const decksListContainer = document.getElementById('decks-list-container');
const startDecksBtn = document.getElementById('start-decks-btn');

const deckReportBox = document.getElementById('deck-report-box');
const deckReportContent = document.getElementById('deck-report-content');
const deckReportCloseBtn = document.getElementById('deck-report-close-btn');

const aiDeckToggleBtn = document.getElementById('ai-deck-toggle-btn');
const aiDeckPanel = document.getElementById('ai-deck-panel');
const aiDeckTopic = document.getElementById('ai-deck-topic');
const aiDeckGenerateBtn = document.getElementById('ai-deck-generate-btn');
const aiDeckStatus = document.getElementById('ai-deck-status');

function normalizeCard(c) {
  return {
    id: c.id || (Date.now() + Math.random()),
    front: String(c.front || '').trim(),
    back: String(c.back || '').trim(),
    due: c.due || Date.now(),
    difficulty: c.difficulty || 'hard'
  };
}

flashcards = flashcards.map(normalizeCard).filter(c => c.front && c.back);

function saveAllCardData() {
  localStorage.setItem('flashcards', JSON.stringify(flashcards));
  localStorage.setItem('decks', JSON.stringify(decks));
  updateStatsUI();
}

function addFlashcard(front, back, difficulty = 'hard') {
  const f = String(front || '').trim();
  const b = String(back || '').trim();
  if (!f || !b) return null;

  const existing = flashcards.find(c => c.front.toLowerCase() === f.toLowerCase());
  if (existing) {
    if (!existing.back && b) existing.back = b;
    saveAllCardData();
    return existing;
  }

  const card = normalizeCard({
    id: `card_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    front: f,
    back: b,
    due: Date.now(),
    difficulty
  });
  flashcards.push(card);
  saveAllCardData();
  return card;
}

function registerDeck(title, sourceType, cardIds) {
  const uniqueIds = Array.from(new Set(cardIds.filter(Boolean)));
  if (!uniqueIds.length) return null;

  const deck = {
    id: `deck_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: String(title || 'Набор карточек').trim(),
    sourceType,
    cardIds: uniqueIds,
    createdAt: Date.now()
  };
  decks.unshift(deck);
  saveAllCardData();
  renderDecksList();
  return deck;
}

function exportDeckToPdf(deckId) {
  const deck = decks.find(d => d.id === deckId);
  if (!deck) return;

  const items = deck.cardIds
    .map(id => flashcards.find(c => c.id === id))
    .filter(Boolean);

  if (!items.length) return;

  let sheet = document.getElementById('printable-deck-sheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = 'printable-deck-sheet';
    document.body.appendChild(sheet);
  }

  sheet.innerHTML = `
    <h2>${escapeHtml(deck.title)}</h2>
    <p>Карточек: ${items.length}</p>
    <table border="1" cellpadding="8" cellspacing="0" style="width:100%;border-collapse:collapse;">
      <thead>
        <tr>
          <th style="text-align:left;">Слово / фраза</th>
          <th style="text-align:left;">Перевод / пояснение</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(it => `
          <tr>
            <td>${escapeHtml(it.front)}</td>
            <td>${escapeHtml(it.back)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  window.print();
}

function renderDecksList() {
  if (!decksListContainer) return;

  if (!decks.length) {
    decksListContainer.innerHTML = '<div class="small-note">Пока нет загруженных PDF или сгенерированных наборов. Загрузите PDF или нажмите «Сгенерировать 20 карточек».</div>';
    return;
  }

  decksListContainer.innerHTML = decks.map(deck => {
    const checked = activeSessionDeckIds.includes(deck.id) ? 'checked' : '';
    const badge = deck.sourceType === 'ai' ? 'ИИ-набор' : 'PDF';
    const pdfBtn = deck.sourceType === 'ai'
      ? `<button type="button" class="secondary-action-btn export-pdf-btn" data-deck-id="${escapeHtml(deck.id)}">PDF</button>`
      : '';

    return `
      <div class="deck-item">
        <label>
          <input type="checkbox" class="deck-checkbox" value="${escapeHtml(deck.id)}" ${checked} />
          <span><b>${escapeHtml(deck.title)}</b> (${badge}, ${deck.cardIds.length} шт.)</span>
        </label>
        ${pdfBtn}
      </div>
    `;
  }).join('');

  decksListContainer.querySelectorAll('.export-pdf-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      exportDeckToPdf(btn.getAttribute('data-deck-id'));
    });
  });
}

function setCardMode(nextMode) {
  cardMode = nextMode;
  if (modeAllBtn) modeAllBtn.classList.toggle('active', cardMode === 'all');
  if (modeDecksBtn) modeDecksBtn.classList.toggle('active', cardMode === 'decks');
  if (decksSelectorBox) decksSelectorBox.classList.toggle('hidden', cardMode !== 'decks');
  if (deckReportBox) deckReportBox.classList.add('hidden');

  if (cardMode === 'decks') {
    renderDecksList();
    if (!activeSessionQueue.length) {
      currentCard = null;
      if (fcFront) fcFront.innerText = 'Выберите один или несколько наборов/PDF и нажмите «Начать по выбранным»';
      if (fcBack) {
        fcBack.innerText = '';
        fcBack.classList.add('hidden');
      }
    } else {
      renderNextFlashcard();
    }
  } else {
    renderNextFlashcard();
  }
}

if (modeAllBtn) modeAllBtn.addEventListener('click', () => setCardMode('all'));
if (modeDecksBtn) modeDecksBtn.addEventListener('click', () => setCardMode('decks'));

function pickNextAllModeCard() {
  if (!flashcards.length) return null;

  const isHardOrAgain = (c) => c.difficulty === 'hard' || c.difficulty === 'again';
  const isEasy = (c) => c.difficulty === 'easy';

  const allEasy = flashcards.every(isEasy);
  if (allEasy) {
    if (allModeSeenIds.size >= flashcards.length) {
      allModeSeenIds.clear();
      hardStreakCount = 0;
      flashcards.forEach(c => {
        c.due = Date.now();
      });
      saveAllCardData();
      if (pdfStatus) {
        pdfStatus.innerText = 'Все лёгкие карточки пройдены — запускаю новый круг повторения лёгких слов!';
      }
    }
    const unseenEasy = flashcards.filter(c => !allModeSeenIds.has(c.id));
    const pool = unseenEasy.length ? unseenEasy : flashcards;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  const hardPool = flashcards.filter(isHardOrAgain);
  const easyPool = flashcards.filter(isEasy);

  if (hardStreakCount >= 5 && easyPool.length > 0) {
    hardStreakCount = 0;
    const unseenEasy = easyPool.filter(c => !allModeSeenIds.has(c.id));
    const chosenEasyPool = unseenEasy.length ? unseenEasy : easyPool;
    return chosenEasyPool[Math.floor(Math.random() * chosenEasyPool.length)];
  }

  if (hardPool.length > 0) {
    const unseenHard = hardPool.filter(c => !allModeSeenIds.has(c.id));
    const chosenHardPool = unseenHard.length ? unseenHard : hardPool;
    const picked = chosenHardPool[Math.floor(Math.random() * chosenHardPool.length)];
    hardStreakCount++;
    return picked;
  }

  const unseenAny = flashcards.filter(c => !allModeSeenIds.has(c.id));
  const fallbackPool = unseenAny.length ? unseenAny : flashcards;
  return fallbackPool[Math.floor(Math.random() * fallbackPool.length)];
}

function showDeckSessionReport() {
  if (!deckReportBox || !deckReportContent) return;
  const totalReviewed = activeSessionReport.easy + activeSessionReport.hard + activeSessionReport.again;
  deckReportContent.innerHTML = `
    <div>Пройдено карточек: <b>${totalReviewed}</b> из <b>${activeSessionTotal}</b></div>
    <div class="deck-report-stats">
      <span>🟢 Легко: ${activeSessionReport.easy}</span>
      <span>🟠 Трудно: ${activeSessionReport.hard}</span>
      <span>🔴 Не помню: ${activeSessionReport.again}</span>
    </div>
    <div class="small-note">Можете снова отметить наборы и запустить тренировку заново.</div>
  `;
  deckReportBox.classList.remove('hidden');
}

if (deckReportCloseBtn && deckReportBox) {
  deckReportCloseBtn.addEventListener('click', () => {
    deckReportBox.classList.add('hidden');
  });
}

if (startDecksBtn) {
  startDecksBtn.addEventListener('click', () => {
    const checkedIds = Array.from(document.querySelectorAll('.deck-checkbox:checked')).map(el => el.value);
    if (!checkedIds.length) {
      if (pdfStatus) pdfStatus.innerText = 'Отметьте хотя бы один PDF или ИИ-набор.';
      return;
    }

    activeSessionDeckIds = checkedIds;
    const cardIdSet = new Set();
    decks
      .filter(d => checkedIds.includes(d.id))
      .forEach(d => d.cardIds.forEach(id => cardIdSet.add(id)));

    activeSessionQueue = Array.from(cardIdSet)
      .map(id => flashcards.find(c => c.id === id))
      .filter(Boolean);

    activeSessionTotal = activeSessionQueue.length;
    activeSessionReport = { easy: 0, hard: 0, again: 0 };
    if (deckReportBox) deckReportBox.classList.add('hidden');

    if (!activeSessionQueue.length) {
      currentCard = null;
      if (fcFront) fcFront.innerText = 'В выбранных наборах нет карточек';
      if (fcBack) fcBack.classList.add('hidden');
      return;
    }

    renderNextFlashcard();
  });
}

function renderNextFlashcard() {
  updateStatsUI();

  if (cardMode === 'decks') {
    if (!activeSessionQueue.length) {
      currentCard = null;
      if (fcFront) fcFront.innerText = activeSessionTotal > 0 ? 'Пачка пройдена! Смотрите отчёт ниже.' : 'Карточек пока нет';
      if (fcBack) {
        fcBack.innerText = '';
        fcBack.classList.add('hidden');
      }
      if (activeSessionTotal > 0) showDeckSessionReport();
      return;
    }

    currentCard = activeSessionQueue[0];
    if (fcFront) fcFront.innerText = currentCard.front;
    if (fcBack) {
      fcBack.innerText = currentCard.back;
      fcBack.classList.add('hidden');
    }
    return;
  }

  if (!flashcards.length) {
    currentCard = null;
    if (fcFront) fcFront.innerText = 'Карточек пока нет';
    if (fcBack) {
      fcBack.innerText = '';
      fcBack.classList.add('hidden');
    }
    return;
  }

  currentCard = pickNextAllModeCard();
  if (currentCard) {
    if (fcFront) fcFront.innerText = currentCard.front;
    if (fcBack) {
      fcBack.innerText = currentCard.back;
      fcBack.classList.add('hidden');
    }
  }
}

if (fcToggleBtn) {
  fcToggleBtn.addEventListener('click', () => {
    if (!currentCard || !fcBack) return;
    fcBack.classList.toggle('hidden');
  });
}

if (fcSpeakBtn) {
  fcSpeakBtn.addEventListener('click', () => {
    if (!currentCard) return;
    speakEnglish(currentCard.front);
  });
}

document.querySelectorAll('.rate-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!currentCard) return;
    const rate = btn.getAttribute('data-rate');

    if (rate === 'easy') {
      currentCard.difficulty = 'easy';
      currentCard.due = Date.now() + 24 * 60 * 60 * 1000;
    } else if (rate === 'hard') {
      currentCard.difficulty = 'hard';
      currentCard.due = Date.now() + 10 * 60 * 1000;
    } else {
      currentCard.difficulty = 'again';
      currentCard.due = Date.now() + 60 * 1000;
    }

    if (cardMode === 'decks') {
      if (rate === 'easy') activeSessionReport.easy++;
      else if (rate === 'hard') activeSessionReport.hard++;
      else activeSessionReport.again++;

      const finishedCard = activeSessionQueue.shift();
      if (finishedCard && (rate === 'again' || rate === 'hard') && !finishedCard._requeuedInSession) {
        finishedCard._requeuedInSession = true;
        activeSessionQueue.push(finishedCard);
      }

      saveAllCardData();
      renderNextFlashcard();
      return;
    }

    allModeSeenIds.add(currentCard.id);
    if (allModeSeenIds.size >= flashcards.length && flashcards.every(c => c.difficulty === 'easy')) {
      allModeSeenIds.clear();
      hardStreakCount = 0;
    }

    saveAllCardData();
    renderNextFlashcard();
  });
});

function parsePartialJsonCards(rawText) {
  const cleaned = String(rawText || '')
    .replace(/```json|```/gi, '')
    .trim();

  const arrayStart = cleaned.indexOf('[');
  const arrayEnd = cleaned.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    try {
      const parsed = JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }

  const items = [];
  const objRegex = /\{\s*"en"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"ru"\s*:\s*"((?:\\.|[^"\\])*)"\s*\}/g;
  let match;
  while ((match = objRegex.exec(cleaned)) !== null) {
    try {
      const en = JSON.parse(`"${match[1]}"`);
      const ru = JSON.parse(`"${match[2]}"`);
      items.push({ en, ru });
    } catch (_) {}
  }

  if (items.length > 0) return items;
  throw new Error('Не удалось прочитать список карточек из ответа ИИ');
}

function extractFallbackPairsFromText(rawText) {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const pairs = [];
  const hasLatin = (s) => /[A-Za-z]{2,}/.test(s);
  const hasCyrillic = (s) => /[А-Яа-яЁё]{2,}/.test(s);

  for (const line of lines) {
    const cleanLine = line.replace(/^\d+[\).\s-]+/, '').trim();
    const parts = cleanLine.split(/\s+(?:—|–|-|\||\/|→)\s+/);
    if (parts.length >= 2) {
      const left = parts[0].trim();
      const right = parts.slice(1).join(' ').trim();
      if (hasLatin(left) && hasCyrillic(right)) {
        pairs.push({ en: left, ru: right });
      } else if (hasCyrillic(left) && hasLatin(right)) {
        pairs.push({ en: right, ru: left });
      }
    }
  }

  return pairs.slice(0, 20);
}

if (pdfUpload) {
  pdfUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !window.pdfjsLib) return;

    if (pdfStatus) pdfStatus.innerText = 'Читаю PDF-файл...';
    let extracted = '';

    try {
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      const pagesToRead = Math.min(pdf.numPages, 6);
      for (let i = 1; i <= pagesToRead; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        extracted += content.items.map(item => item.str).join(' ') + '\n';
      }

      const clipped = extracted.slice(0, 2600);
      if (pdfStatus) pdfStatus.innerText = 'ИИ формирует карточки слов...';

      const raw = await callGemini(
        `Извлеки пары английское слово/фраза и перевод на русский (до 20 пар). Верни ТОЛЬКО валидный JSON-массив [{"en":"...","ru":"..."}] без переносов строк внутри значений и без пояснений:\n${clipped}`,
        1200,
        0.3
      );

      const list = parsePartialJsonCards(raw);
      const addedIds = [];
      list.forEach(item => {
        if (item && item.en && item.ru) {
          const card = addFlashcard(item.en, item.ru, 'hard');
          if (card) addedIds.push(card.id);
        }
      });

      if (addedIds.length) {
        registerDeck(file.name.replace(/\.pdf$/i, ''), 'pdf', addedIds);
      }

      if (pdfStatus) pdfStatus.innerText = `Добавлено карточек: ${addedIds.length} (всего в базе: ${flashcards.length})`;
      renderNextFlashcard();
    } catch (err) {
      const fallbackPairs = extractFallbackPairsFromText(extracted);
      if (fallbackPairs.length > 0) {
        const addedIds = [];
        fallbackPairs.forEach(item => {
          const card = addFlashcard(item.en, item.ru, 'hard');
          if (card) addedIds.push(card.id);
        });
        if (addedIds.length) {
          registerDeck(file.name.replace(/\.pdf$/i, ''), 'pdf', addedIds);
        }
        if (pdfStatus) pdfStatus.innerText = `ИИ был перегружен, но собрано карточек напрямую из PDF: ${addedIds.length}`;
        renderNextFlashcard();
      } else if (pdfStatus) {
        pdfStatus.innerText = `Сервер ИИ сейчас перегружен (${err.message}). Повторите через 10–15 секунд.`;
      }
    } finally {
      e.target.value = '';
    }
  });
}

if (aiDeckToggleBtn && aiDeckPanel) {
  aiDeckToggleBtn.addEventListener('click', () => {
    aiDeckPanel.classList.toggle('hidden');
    if (!aiDeckPanel.classList.contains('hidden') && aiDeckTopic) {
      aiDeckTopic.focus();
    }
  });
}

if (aiDeckGenerateBtn) {
  aiDeckGenerateBtn.addEventListener('click', async () => {
    const topicOrText = (aiDeckTopic && aiDeckTopic.value.trim()) || '';
    if (!topicOrText) {
      if (aiDeckStatus) aiDeckStatus.innerText = 'Введите тему или текст, по которым нужно сделать 20 карточек.';
      return;
    }

    aiDeckGenerateBtn.disabled = true;
    if (aiDeckStatus) aiDeckStatus.innerText = 'Генерирую 20 карточек...';

    try {
      const prompt = `Создай ровно 20 учебных карточек (английское слово или короткая фраза + перевод на русский) по теме или тексту ниже. Уровень: ${selectedLevel}.
Материал:
${topicOrText.slice(0, 2400)}

Верни ТОЛЬКО валидный JSON-массив из 20 объектов [{"en":"...","ru":"..."}] без пояснений и без markdown-оформления.`;

      const raw = await callGemini(prompt, 1400, 0.5);
      const parsed = parsePartialJsonCards(raw).slice(0, 20);

      if (!parsed.length) {
        throw new Error('Не удалось сформировать карточки');
      }

      const addedIds = [];
      parsed.forEach(item => {
        if (item && item.en && item.ru) {
          const card = addFlashcard(item.en, item.ru, 'hard');
          if (card) addedIds.push(card.id);
        }
      });

      const shortTitle = topicOrText.split(/\r?\n/)[0].slice(0, 42);
      const createdDeck = registerDeck(`ИИ: ${shortTitle || 'Набор 20'}`, 'ai', addedIds);

      if (aiDeckStatus) {
        aiDeckStatus.innerText = `Готово! Создано карточек: ${addedIds.length}. Набор добавлен в список — можно сразу запустить или скачать в PDF.`;
      }
      if (createdDeck && cardMode === 'decks') {
        activeSessionDeckIds = [createdDeck.id];
        renderDecksList();
      }
      renderNextFlashcard();
    } catch (err) {
      if (aiDeckStatus) {
        aiDeckStatus.innerText = `Не удалось сгенерировать набор (${err.message}). Попробуйте ещё раз.`;
      }
    } finally {
      aiDeckGenerateBtn.disabled = false;
    }
  });
}

// --- 3. ДИАЛОГ (СВОЯ ТЕМА ИЛИ СЦЕНАРИЙ + МИНИМАЛЬНЫЙ КОНТЕКСТ) ---
const scenarioSelect = document.getElementById('scenario-select');
const dialogCustomTopic = document.getElementById('dialog-custom-topic');
const startDialogBtn = document.getElementById('start-dialog-btn');
const chatBox = document.getElementById('chat-box');
const dialogInput = document.getElementById('dialog-input');
const sendDialogBtn = document.getElementById('send-dialog-btn');

function getActiveDialogTopic() {
  const custom = dialogCustomTopic ? dialogCustomTopic.value.trim() : '';
  if (custom) return custom;
  return scenarioSelect ? scenarioSelect.value : 'Свободный разговор';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderDialog() {
  if (!chatBox) return;
  if (!dialogHistory.length) {
    chatBox.innerHTML = '<div class="small-note">Выберите сценарий или напишите свою тему (простую бытовую или любую другую) и нажмите «Начать новый диалог».</div>';
    return;
  }
  chatBox.innerHTML = dialogHistory.map(m => {
    const tipHtml = m.tip ? `<div class="chat-tip">💡 ${escapeHtml(m.tip)}</div>` : '';
    return `<div class="chat-msg ${m.role}">${escapeHtml(m.text)}${tipHtml}</div>`;
  }).join('');
  chatBox.scrollTop = chatBox.scrollHeight;
}

if (startDialogBtn) {
  startDialogBtn.addEventListener('click', async () => {
    const scenario = getActiveDialogTopic();
    dialogHistory = [];
    startDialogBtn.disabled = true;
    if (chatBox) chatBox.innerHTML = '<div class="small-note">Собеседник подключается...</div>';

    try {
      const opener = await callGemini(
        `Ролевая игра / тема: "${scenario}", уровень ${selectedLevel}. Начни диалог 1 короткой естественной фразой на английском.`,
        65,
        0.85
      );
      dialogHistory.push({ role: 'ai', text: opener });
      renderDialog();
      speakEnglish(opener);
    } catch (err) {
      if (chatBox) chatBox.innerHTML = `<div class="small-note">${escapeHtml(err.message)}</div>`;
    } finally {
      startDialogBtn.disabled = false;
    }
  });
}

async function sendDialogReply() {
  const text = dialogInput ? dialogInput.value.trim() : '';
  if (!text) return;
  if (dialogInput) dialogInput.value = '';
  dialogHistory.push({ role: 'user', text });
  renderDialog();

  const scenario = getActiveDialogTopic();
  const shortContext = dialogHistory
    .slice(-4)
    .map(m => `${m.role === 'ai' ? 'AI' : 'User'}: ${m.text}`)
    .join('\n');

  if (sendDialogBtn) sendDialogBtn.disabled = true;
  try {
    const raw = await callGemini(
      `Тема/сценарий: "${scenario}", уровень ${selectedLevel}. Контекст:\n${shortContext}\nОтветь в 2 строках:\nAI: [1-2 коротких предложения на английском]\nTIP: [короткая подсказка на русском или "ок"]`,
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
    if (sendDialogBtn) sendDialogBtn.disabled = false;
  }
}

if (sendDialogBtn) sendDialogBtn.addEventListener('click', sendDialogReply);
if (dialogInput) {
  dialogInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendDialogReply();
  });
}

function updateStatsUI() {
  if (streakCountElem) streakCountElem.innerText = streak;
  if (totalCountElem) totalCountElem.innerText = total;
  if (cardsCountElem) cardsCountElem.innerText = flashcards.length;
}
