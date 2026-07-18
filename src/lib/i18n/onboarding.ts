// Owned by the onboarding wizard (src/components/Onboarding.tsx).
// Add "onboarding.*" keys here — English first, Ukrainian alongside.
//
// Untranslated on purpose: whispr-open, the OS names (macOS / Windows / Linux),
// the macOS settings path (System Settings → Privacy & Security →
// Accessibility), X11, Wayland, model ids and hotkey combos.

export const onboarding = {
  en: {
    "onboarding.title": "Welcome to whispr-open",
    "onboarding.step": "Step {current} of {total}",
    "onboarding.progress": "Step {current} of {total} — {title}",
    "onboarding.step.hotkey": "Hotkey",
    "onboarding.step.permissions": "Permissions",
    "onboarding.step.model": "Model and test",

    "onboarding.lang.label": "Interface language",
    "onboarding.lang.hint":
      "Interface language — not the language you dictate in.",

    "onboarding.back": "Back",
    "onboarding.next": "Next",
    "onboarding.finish": "Finish",
    "onboarding.finishHint": "Run the test, or skip it.",

    "onboarding.hotkey.title": "Choose your dictation hotkey",
    "onboarding.hotkey.purpose":
      "Hold it to dictate, release it to insert the text into whatever app you're in.",
    "onboarding.hotkey.label": "Hotkey",
    "onboarding.hotkey.hint": "Click the field, then press the keys you want.",

    "onboarding.permissions.title": "Permissions ({os})",
    "onboarding.permissions.purpose":
      "whispr-open types into other apps — here is what it needs from your system.",
    "onboarding.permissions.macos.accessibility":
      "Typing into the focused app needs the Accessibility permission.",
    "onboarding.permissions.macos.enable":
      "Open System Settings → Privacy & Security → Accessibility, then enable whispr-open.",
    "onboarding.permissions.windows.none":
      "Typing into other apps needs no extra permission.",
    "onboarding.permissions.windows.antivirus":
      "If your antivirus flags simulated keystrokes, allow whispr-open.",
    "onboarding.permissions.linux.x11":
      "On X11 typing into other apps needs no extra permission.",
    "onboarding.permissions.linux.wayland":
      "On Wayland keystroke injection may be blocked, so whispr-open pastes from the clipboard instead.",
    "onboarding.permissions.open": "Open system settings",
    "onboarding.permissions.privacy":
      "The microphone runs only while you hold the hotkey. Audio never leaves this device.",

    "onboarding.model.title": "Pick a model and test it",
    "onboarding.model.purpose": "Larger models are more accurate and slower.",
    "onboarding.model.label": "Model",
    "onboarding.model.onDevice": "On this device",
    "onboarding.model.download": "Download",
    "onboarding.model.downloading": "Downloading…",
    "onboarding.model.downloadHint": "Download it before you test.",
    "onboarding.model.downloadError":
      "Download failed: {error}. Check your connection, then try again.",

    "onboarding.test.label": "Test — say a sentence, then stop",
    "onboarding.test.skip": "Skip test",
  },
  uk: {
    "onboarding.title": "Вітаємо у whispr-open",
    // "із", not "з": the eyebrow is uppercase mono, where a lone "З" is
    // indistinguishable from the digit 3.
    "onboarding.step": "Крок {current} із {total}",
    "onboarding.progress": "Крок {current} із {total} — {title}",
    "onboarding.step.hotkey": "Гаряча клавіша",
    "onboarding.step.permissions": "Дозволи",
    "onboarding.step.model": "Модель і тест",

    "onboarding.lang.label": "Мова інтерфейсу",
    "onboarding.lang.hint": "Мова інтерфейсу — не мова, якою ви диктуєте.",

    "onboarding.back": "Назад",
    "onboarding.next": "Далі",
    "onboarding.finish": "Готово",
    "onboarding.finishHint": "Запустіть тест або пропустіть його.",

    "onboarding.hotkey.title": "Оберіть гарячу клавішу для диктування",
    "onboarding.hotkey.purpose":
      "Утримуйте її, щоб диктувати, і відпустіть — текст з’явиться в застосунку, з яким ви працюєте.",
    "onboarding.hotkey.label": "Гаряча клавіша",
    "onboarding.hotkey.hint": "Клацніть поле й натисніть потрібні клавіші.",

    "onboarding.permissions.title": "Дозволи ({os})",
    "onboarding.permissions.purpose":
      "whispr-open вводить текст в інші застосунки — ось що йому потрібно від вашої системи.",
    "onboarding.permissions.macos.accessibility":
      "Щоб вводити текст в активний застосунок, потрібен дозвіл Accessibility.",
    "onboarding.permissions.macos.enable":
      "Відкрийте System Settings → Privacy & Security → Accessibility й увімкніть whispr-open.",
    "onboarding.permissions.windows.none":
      "Для введення тексту в інші застосунки додаткові дозволи не потрібні.",
    "onboarding.permissions.windows.antivirus":
      "Якщо антивірус реагує на емуляцію натискань клавіш, дозвольте whispr-open.",
    "onboarding.permissions.linux.x11":
      "На X11 для введення тексту в інші застосунки додаткові дозволи не потрібні.",
    "onboarding.permissions.linux.wayland":
      "На Wayland емуляція натискань клавіш може бути заблокована, тому whispr-open вставляє текст із буфера обміну.",
    "onboarding.permissions.open": "Відкрити системні налаштування",
    "onboarding.permissions.privacy":
      "Мікрофон працює, лише поки ви утримуєте гарячу клавішу. Звук не залишає цей пристрій.",

    "onboarding.model.title": "Оберіть модель і перевірте її",
    "onboarding.model.purpose": "Більші моделі точніші, але повільніші.",
    "onboarding.model.label": "Модель",
    "onboarding.model.onDevice": "На цьому пристрої",
    "onboarding.model.download": "Завантажити",
    "onboarding.model.downloading": "Завантаження…",
    "onboarding.model.downloadHint": "Завантажте її перед перевіркою.",
    "onboarding.model.downloadError":
      "Не вдалося завантажити: {error}. Перевірте з’єднання та спробуйте ще раз.",

    "onboarding.test.label": "Тест — скажіть речення й зупиніть запис",
    "onboarding.test.skip": "Пропустити тест",
  },
};
