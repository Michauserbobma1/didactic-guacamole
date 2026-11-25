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

pdfUpload.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !window.pdfjsLib) return;

  pdfStatus.innerText = 'Читаю PDF-файл...';
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
    pdfStatus.innerText = 'ИИ формирует карточки слов...';

    const raw = await callGemini(
      `Извлеки пары английское слово/фраза и перевод на русский (до 20 пар). Верни ТОЛЬКО валидный JSON-массив [{"en":"...","ru":"..."}] без переносов строк внутри значений и без пояснений:\n${clipped}`,
      1200,
      0.3
    );

    const list = parsePartialJsonCards(raw);
    let added = 0;
    list.forEach(item => {
      if (item && item.en && item.ru) {
        addFlashcard(item.en, item.ru);
        added++;
      }
    });

    pdfStatus.innerText = `Добавлено карточек: ${added}`;
    renderNextFlashcard();
  } catch (err) {
    const fallbackPairs = extractFallbackPairsFromText(extracted);
    if (fallbackPairs.length > 0) {
      let added = 0;
      fallbackPairs.forEach(item => {
        addFlashcard(item.en, item.ru);
        added++;
      });
      pdfStatus.innerText = `ИИ был перегружен, но собрано карточек напрямую из PDF: ${added}`;
      renderNextFlashcard();
    } else {
      pdfStatus.innerText = `Сервер ИИ сейчас перегружен (${err.message}). Повторите через 10–15 секунд.`;
    }
  } finally {
    e.target.value = '';
  }
});
