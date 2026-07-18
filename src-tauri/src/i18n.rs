//! Interface-language message catalog for the Rust side.
//!
//! Covers the strings this app authors at the point where they become a tray
//! notification body, a tray menu label or a command `Err` — the interface
//! language comes from `Settings::ui_language` and is independent of the
//! dictation language (`Settings::language`).
//!
//! Nested technical detail (OS / cpal / enigo / reqwest / whisper-cli text)
//! is not translated: it is appended to a translated wrapper through the
//! `{detail}` placeholder.
//!
//! Placeholders are substituted by the call site with `str::replace`, e.g.
//! `t(lang, Msg::UnknownModel).replace("{model}", &id)`. Every message must
//! carry the same placeholders in both languages (enforced by a unit test).

/// The interface languages the app accepts, per docs/contracts.md.
pub const UI_LANGUAGES: &[&str] = &["en", "uk"];

/// Declares the message keys together with their en/uk table, so a new message
/// cannot be added to one language only.
macro_rules! catalog {
    ($($key:ident { en: $en:literal, uk: $uk:literal })+) => {
        /// A user-facing message key; resolve with [`t`].
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum Msg { $($key),+ }

        #[cfg(test)]
        const ALL: &[Msg] = &[$(Msg::$key),+];

        fn en(key: Msg) -> &'static str {
            match key { $(Msg::$key => $en),+ }
        }

        fn uk(key: Msg) -> &'static str {
            match key { $(Msg::$key => $uk),+ }
        }
    };
}

catalog! {
    // --- hotkeys -----------------------------------------------------------
    HotkeyEmpty {
        en: "hotkey must not be empty",
        uk: "комбінація клавіш не може бути порожньою"
    }
    HotkeyNoKey {
        en: "hotkey needs a non-modifier key",
        uk: "у комбінації потрібна звичайна клавіша, а не лише модифікатори"
    }
    HotkeyUnknownToken {
        en: "unknown key \"{token}\" in hotkey",
        uk: "невідома клавіша «{token}» у комбінації"
    }
    HotkeyNoModifier {
        en: "hotkey needs at least one modifier",
        uk: "комбінація потребує принаймні одного модифікатора"
    }
    HotkeyRegisterFailed {
        en: "failed to register hotkey \"{hotkey}\": {detail}",
        uk: "не вдалося зареєструвати комбінацію «{hotkey}»: {detail}"
    }
    KeepingPreviousSettings {
        en: "{detail}; keeping previous settings",
        uk: "{detail}; залишено попередні налаштування"
    }

    // --- settings / commands ----------------------------------------------
    UnknownModel {
        en: "unknown model: {model}",
        uk: "невідома модель: {model}"
    }
    UnknownUiLanguage {
        en: "unknown interface language: {lang}",
        uk: "невідома мова інтерфейсу: {lang}"
    }
    NoSuchFile {
        en: "no such file: {path}",
        uk: "файл не знайдено: {path}"
    }

    // --- models ------------------------------------------------------------
    UnknownModelId {
        en: "unknown model id: {id}",
        uk: "невідомий ідентифікатор моделі: {id}"
    }
    ModelAlreadyDownloading {
        en: "model \"{id}\" is already downloading",
        uk: "модель «{id}» уже завантажується"
    }
    DownloadFailed {
        en: "download failed: HTTP {status}",
        uk: "не вдалося завантажити: HTTP {status}"
    }
    ModelNotDownloaded {
        en: "model \"{id}\" is not downloaded — open Settings and download it first",
        uk: "модель «{id}» не завантажено — відкрийте Налаштування й завантажте її"
    }

    // --- whisper sidecar ---------------------------------------------------
    SidecarMissing {
        en: "whisper-cli sidecar not found — build it with sidecar/whisper/build-<os>.sh and restart the app",
        uk: "whisper-cli не знайдено — зберіть його скриптом sidecar/whisper/build-<os>.sh і перезапустіть застосунок"
    }
    WhisperSpawnFailed {
        en: "failed to run whisper-cli: {detail}",
        uk: "не вдалося запустити whisper-cli: {detail}"
    }
    WhisperExited {
        en: "whisper-cli exited with {status}: {detail}",
        uk: "whisper-cli завершився з помилкою {status}: {detail}"
    }

    // --- cloud transcription -----------------------------------------------
    CloudReadFailed {
        en: "failed to read recording: {detail}",
        uk: "не вдалося прочитати запис: {detail}"
    }
    CloudRequestFailed {
        en: "cloud transcription request failed: {detail}",
        uk: "не вдалося виконати запит до хмарного розпізнавання: {detail}"
    }
    CloudFailedWithStatus {
        en: "cloud transcription failed with {status}: {detail}",
        uk: "хмарна транскрипція завершилася помилкою {status}: {detail}"
    }
    CloudInvalidJson {
        en: "cloud transcription returned invalid JSON: {detail}",
        uk: "хмарна транскрипція повернула некоректний JSON: {detail}"
    }

    // --- recording pipeline -------------------------------------------------
    StartRecordingFailed {
        en: "Could not start recording: {detail}",
        uk: "Не вдалося почати запис: {detail}"
    }
    RecordingFailed {
        en: "recording failed: {detail}",
        uk: "не вдалося записати звук: {detail}"
    }
    WriteRecordingFailed {
        en: "failed to write recording: {detail}",
        uk: "не вдалося зберегти запис: {detail}"
    }

    // --- injection / clipboard ---------------------------------------------
    TranscriptCopiedPressToPaste {
        en: "Transcript copied — press {key} to paste",
        uk: "Текст скопійовано — натисніть {key}, щоб вставити"
    }
    TypingInterrupted {
        en: "Typing was interrupted — part of the text may already be typed; the rest was copied, press {key} to paste",
        uk: "Введення перервано — частину тексту вже могло бути набрано; решту скопійовано, натисніть {key}, щоб вставити"
    }
    ClipboardCopyFailed {
        en: "Could not copy transcript to clipboard",
        uk: "Не вдалося скопіювати текст у буфер обміну"
    }
    TranscriptCopied {
        en: "Transcript copied to clipboard",
        uk: "Текст скопійовано в буфер обміну"
    }

    // --- licensing ----------------------------------------------------------
    LicenseInactiveNotice {
        en: "Subscription inactive — dictation disabled",
        uk: "Підписка неактивна — диктування вимкнено"
    }
    LicenseBlocked {
        en: "Subscription inactive — renew to keep dictating",
        uk: "Підписка неактивна — поновіть її, щоб диктувати далі"
    }

    // --- tray menu ----------------------------------------------------------
    TraySettings {
        en: "Settings",
        uk: "Налаштування"
    }
    TrayRecent {
        en: "Recent transcriptions",
        uk: "Останні транскрипції"
    }
    TrayRecentEmpty {
        en: "(no transcriptions yet)",
        uk: "(ще немає транскрипцій)"
    }
    TrayPause {
        en: "Pause hotkey",
        uk: "Призупинити гарячу клавішу"
    }
    TrayQuit {
        en: "Quit",
        uk: "Вийти"
    }
}

/// Resolves `key` in `lang`, falling back to English for anything that is not
/// a known interface language.
pub fn t(lang: &str, key: Msg) -> &'static str {
    match lang {
        "uk" => uk(key),
        _ => en(key),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The `{name}` placeholders of a message, in order.
    fn placeholders(text: &str) -> Vec<&str> {
        text.split('{')
            .skip(1)
            .filter_map(|part| part.split_once('}'))
            .map(|(name, _)| name)
            .collect()
    }

    #[test]
    fn every_key_resolves_in_both_languages() {
        for &key in ALL {
            assert!(!t("en", key).is_empty(), "empty en message for {key:?}");
            assert!(!t("uk", key).is_empty(), "empty uk message for {key:?}");
            assert_ne!(t("en", key), t("uk", key), "untranslated message {key:?}");
        }
    }

    #[test]
    fn unknown_language_falls_back_to_english() {
        for &key in ALL {
            let english = t("en", key);
            for lang in ["", "de", "ru", "uk-UA", "UK", "en-US"] {
                assert_eq!(t(lang, key), english, "{key:?} did not fall back for {lang:?}");
            }
        }
    }

    #[test]
    fn translations_keep_the_same_placeholders() {
        for &key in ALL {
            assert_eq!(
                placeholders(t("en", key)),
                placeholders(t("uk", key)),
                "placeholder mismatch for {key:?}"
            );
        }
    }

    #[test]
    fn ui_languages_are_the_contract_pair() {
        assert_eq!(UI_LANGUAGES, &["en", "uk"]);
        for lang in UI_LANGUAGES {
            assert!(!t(lang, Msg::TrayQuit).is_empty());
        }
    }
}
