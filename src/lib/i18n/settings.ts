// Owned by the Settings screen (src/components/Settings.tsx).
// Add "settings.*" keys here — English first, Ukrainian alongside.
//
// Machine data is never translated: URLs, model ids, file sizes, dates,
// license keys and hotkey combos are interpolated verbatim into these strings.

export const settings = {
  en: {
    "settings.back": "Back",
    "settings.unsaved": "Unsaved changes",
    "settings.save": "Save",

    "settings.tab.general": "General",
    "settings.tab.transcription": "Transcription",
    "settings.tab.postproc": "Post-processing",
    "settings.tab.privacy": "Privacy",
    "settings.tab.license": "License",

    "settings.general.hotkey": "Hotkey",
    "settings.general.hotkeyHint": "Click the field, then press the new shortcut.",
    "settings.general.mode": "Mode",
    "settings.general.mode.push": "Push to talk",
    "settings.general.mode.toggle": "Toggle",
    "settings.general.device": "Input device",
    "settings.general.device.default": "System default",
    "settings.general.pill": "Show recording pill",
    "settings.general.silence": "Silence timeout (ms)",
    "settings.general.vad": "Voice activity detection",
    "settings.general.uiLanguage": "Interface language",
    "settings.general.uiLanguageHint":
      "Changes the language of this app, not the language you dictate in — that one is in Transcription.",

    "settings.transcription.localModel": "Local model",
    "settings.transcription.active": "Active",
    "settings.transcription.useModel": "Use model {id}",
    "settings.transcription.download": "Download",
    "settings.transcription.downloadModel": "Download {id}",
    "settings.transcription.deleteModel": "Delete {id}",
    "settings.transcription.language": "Dictation language",
    "settings.transcription.language.auto": "Auto-detect",
    "settings.transcription.languageHint":
      "With a non-English language, English-only (.en) models automatically fall back to the multilingual variant.",
    "settings.transcription.cloud": "Cloud",
    "settings.transcription.cloudEnabled": "Cloud transcription",
    "settings.transcription.provider": "Provider",
    "settings.transcription.provider.custom": "Custom",
    "settings.transcription.baseUrl": "Base URL",
    "settings.transcription.apiKey": "API key",
    "settings.transcription.showApiKey": "Show API key",
    "settings.transcription.hideApiKey": "Hide API key",
    "settings.transcription.model": "Model",
    "settings.transcription.fallback": "Fall back to local on failure",
    "settings.transcription.cloudNote":
      "The API key is stored in plain text in the local settings file. While cloud transcription is enabled, recorded audio is uploaded to the server above.",

    "settings.groq.help": "How to get a Groq API key",
    "settings.groq.title": "Get a free Groq API key",
    "settings.groq.step1":
      "Open console.groq.com and sign in with Google or GitHub — free, no card required.",
    "settings.groq.step2": "Go to API Keys and create a new key.",
    "settings.groq.step3": "Copy the key — it is shown only once.",
    "settings.groq.step4":
      "Paste it into API key here and turn Cloud transcription on.",
    "settings.groq.open": "Open console.groq.com",
    "settings.groq.note":
      "While cloud transcription is on, recorded audio is uploaded to Groq.",

    "settings.postproc.enabled": "Enable post-processing",
    "settings.postproc.ollamaUrl": "Ollama URL",
    "settings.postproc.model": "Model",
    "settings.postproc.prompt": "Prompt",
    "settings.postproc.note":
      "If Ollama is unreachable or errors, the raw transcript is used silently — dictation never blocks on post-processing.",

    "settings.privacy.cloudOn": "Cloud transcription on — audio is sent to",
    "settings.privacy.local": "100% local — audio never leaves this device",
    "settings.privacy.history": "Save transcription history",
    "settings.privacy.historyOff": "New transcriptions won't be kept in history.",
    "settings.privacy.disk": "Models on disk",
    "settings.privacy.clear": "Clear history",
    "settings.privacy.clearTitle": "Clear history?",
    "settings.privacy.clearBody":
      "This permanently removes all stored transcriptions from this device.",
    "settings.privacy.cancel": "Cancel",
    "settings.privacy.confirm": "Clear",

    "settings.license.status": "Status",
    "settings.license.state.disabled": "Disabled",
    "settings.license.state.trial": "Trial — {days} days left",
    "settings.license.state.active": "Active until {date}",
    "settings.license.state.inactive": "Inactive — dictation blocked",
    "settings.license.state.unverified": "Unverified — could not reach server",
    "settings.license.unknownDate": "unknown date",
    "settings.license.verdict.rejected": "Key rejected — check the key or renew",
    "settings.license.verdict.pending": "Not verified yet",
    "settings.license.verdict.active": "Key active",
    "settings.license.verdict.daysLeft": "{days} days left",
    "settings.license.verdict.until": "until {date}",
    "settings.license.checkedAt": "Checked {time}",
    "settings.license.checkError": "Could not check the license: {error}",
    "settings.license.checking": "Checking…",
    "settings.license.check": "Check now",
    "settings.license.subscribe": "Order a subscription",
    "settings.license.subscribeHint":
      "Payment and key delivery happen in our Telegram bot.",
    "settings.license.credentials": "Credentials",
    "settings.license.key": "License key",
    "settings.license.showKey": "Show license key",
    "settings.license.hideKey": "Hide license key",
    "settings.license.keyHint":
      "Check now saves the key first, so you don't need to save separately.",
    "settings.license.serverUrl": "License server URL",
    "settings.license.serverHint":
      "Leave empty to disable licensing entirely (open-source mode).",
  },
  uk: {
    "settings.back": "Назад",
    "settings.unsaved": "Незбережені зміни",
    "settings.save": "Зберегти",

    "settings.tab.general": "Загальні",
    "settings.tab.transcription": "Розпізнавання",
    "settings.tab.postproc": "Постобробка",
    "settings.tab.privacy": "Приватність",
    "settings.tab.license": "Ліцензія",

    "settings.general.hotkey": "Гаряча клавіша",
    "settings.general.hotkeyHint":
      "Клацніть поле й натисніть нову комбінацію клавіш.",
    "settings.general.mode": "Режим",
    "settings.general.mode.push": "Утримання клавіші",
    "settings.general.mode.toggle": "Перемикання",
    "settings.general.device": "Пристрій запису",
    "settings.general.device.default": "Системний пристрій за замовчуванням",
    "settings.general.pill": "Показувати індикатор запису",
    "settings.general.silence": "Пауза до зупинки (мс)",
    "settings.general.vad": "Виявлення голосової активності",
    "settings.general.uiLanguage": "Мова інтерфейсу",
    "settings.general.uiLanguageHint":
      "Змінює мову цього застосунку, а не мову, якою ви диктуєте, — вона на вкладці «Розпізнавання».",

    "settings.transcription.localModel": "Локальна модель",
    "settings.transcription.active": "Активна",
    "settings.transcription.useModel": "Вибрати модель {id}",
    "settings.transcription.download": "Завантажити",
    "settings.transcription.downloadModel": "Завантажити {id}",
    "settings.transcription.deleteModel": "Видалити {id}",
    "settings.transcription.language": "Мова диктування",
    "settings.transcription.language.auto": "Визначати автоматично",
    "settings.transcription.languageHint":
      "Якщо вибрано не англійську, англомовні моделі (.en) автоматично замінюються багатомовним варіантом.",
    "settings.transcription.cloud": "Хмара",
    "settings.transcription.cloudEnabled": "Хмарне розпізнавання",
    "settings.transcription.provider": "Провайдер",
    "settings.transcription.provider.custom": "Власний",
    "settings.transcription.baseUrl": "Базовий URL",
    "settings.transcription.apiKey": "Ключ API",
    "settings.transcription.showApiKey": "Показати ключ API",
    "settings.transcription.hideApiKey": "Приховати ключ API",
    "settings.transcription.model": "Модель",
    "settings.transcription.fallback":
      "У разі помилки перемикатися на локальну модель",
    "settings.transcription.cloudNote":
      "Ключ API зберігається звичайним текстом у локальному файлі налаштувань. Поки хмарне розпізнавання увімкнене, записаний звук надсилається на сервер, указаний вище.",

    "settings.groq.help": "Як отримати ключ API Groq",
    "settings.groq.title": "Отримайте безкоштовний ключ API Groq",
    "settings.groq.step1":
      "Відкрийте console.groq.com і увійдіть через Google або GitHub — безкоштовно, без картки.",
    "settings.groq.step2": "Перейдіть до розділу API Keys і створіть новий ключ.",
    "settings.groq.step3": "Скопіюйте ключ — його показують лише один раз.",
    "settings.groq.step4":
      "Вставте його в поле «Ключ API» і увімкніть «Хмарне розпізнавання».",
    "settings.groq.open": "Відкрити console.groq.com",
    "settings.groq.note":
      "Поки хмарне розпізнавання увімкнене, записаний звук надсилається до Groq.",

    "settings.postproc.enabled": "Увімкнути постобробку",
    "settings.postproc.ollamaUrl": "URL Ollama",
    "settings.postproc.model": "Модель",
    "settings.postproc.prompt": "Промпт",
    "settings.postproc.note":
      "Якщо Ollama недоступна або повертає помилку, використовується вихідна розшифровка — постобробка ніколи не блокує диктування.",

    "settings.privacy.cloudOn": "Хмарне розпізнавання увімкнене — звук надсилається на",
    "settings.privacy.local": "100% локально — звук не залишає цей пристрій",
    "settings.privacy.history": "Зберігати історію розшифровок",
    "settings.privacy.historyOff": "Нові розшифровки не зберігатимуться в історії.",
    "settings.privacy.disk": "Моделі на диску",
    "settings.privacy.clear": "Очистити історію",
    "settings.privacy.clearTitle": "Очистити історію?",
    "settings.privacy.clearBody":
      "Це назавжди видалить із цього пристрою всі збережені розшифровки.",
    "settings.privacy.cancel": "Скасувати",
    "settings.privacy.confirm": "Очистити",

    "settings.license.status": "Стан",
    "settings.license.state.disabled": "Вимкнено",
    "settings.license.state.trial": "Пробний період — залишилося {days} дн",
    "settings.license.state.active": "Активна до {date}",
    "settings.license.state.inactive": "Неактивна — диктування заблоковано",
    "settings.license.state.unverified": "Не перевірено — сервер недоступний",
    "settings.license.unknownDate": "невідомої дати",
    "settings.license.verdict.rejected":
      "Ключ відхилено — перевірте його або поновіть підписку",
    "settings.license.verdict.pending": "Ще не перевірено",
    "settings.license.verdict.active": "Ключ активний",
    "settings.license.verdict.daysLeft": "залишилося {days} дн",
    "settings.license.verdict.until": "до {date}",
    "settings.license.checkedAt": "Перевірено о {time}",
    "settings.license.checkError": "Не вдалося перевірити ліцензію: {error}",
    "settings.license.checking": "Перевірка…",
    "settings.license.check": "Перевірити зараз",
    "settings.license.subscribe": "Оформити підписку",
    "settings.license.subscribeHint":
      "Оплата та видача ключа — у нашому Telegram-боті.",
    "settings.license.credentials": "Облікові дані",
    "settings.license.key": "Ліцензійний ключ",
    "settings.license.showKey": "Показати ліцензійний ключ",
    "settings.license.hideKey": "Приховати ліцензійний ключ",
    "settings.license.keyHint":
      "«Перевірити зараз» спершу зберігає ключ, тож окремо зберігати не потрібно.",
    "settings.license.serverUrl": "URL сервера ліцензій",
    "settings.license.serverHint":
      "Залиште порожнім, щоб повністю вимкнути ліцензування (режим open source).",
  },
};
