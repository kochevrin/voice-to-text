/**
 * In-house i18n — no dependencies. Flat, dot-namespaced keys; one dictionary
 * file per screen so each can be edited without stepping on the others.
 *
 * File ownership
 *   common.ts      shared chrome — state readouts, generic actions, the test
 *                  recorder (used by Home and Onboarding alike)
 *   home.ts        the main window (Home.tsx)
 *   settings.ts    the Settings screen (Settings.tsx)
 *   onboarding.ts  the onboarding wizard (Onboarding.tsx)
 *
 * Every dictionary exports `{ en: {...}, uk: {...} }`. English is the source of
 * truth: the `Key` union is derived from the merged English dict, so a typo at
 * a call site is a type error, and a Ukrainian key with no English original
 * trips the `UkKeysAreEnglishKeys` guard below. A missing Ukrainian string
 * falls back to English at runtime rather than showing the raw key.
 */

import { createContext, createElement, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { common } from "./common";
import { home } from "./home";
import { settings } from "./settings";
import { onboarding } from "./onboarding";

export type Lang = "en" | "uk";

/** Language names stay in their own language — never translated. */
export const LANGS: { value: Lang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "uk", label: "Українська" },
];

const en = { ...common.en, ...home.en, ...settings.en, ...onboarding.en };
const uk = { ...common.uk, ...home.uk, ...settings.uk, ...onboarding.uk };

export type Key = keyof typeof en;

type Assert<T extends true> = T;
/** Compile-time guard: no Ukrainian key without an English original. */
export type UkKeysAreEnglishKeys = Assert<
  keyof typeof uk extends Key ? true : false
>;

export type TVars = Record<string, string | number>;
export type TFunction = (key: Key, vars?: TVars) => string;

const DICTS: Record<Lang, Partial<Record<Key, string>>> = { en, uk };

/** Replaces {name} placeholders; an unknown placeholder is left verbatim. */
function interpolate(text: string, vars?: TVars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export function translate(lang: Lang, key: Key, vars?: TVars): string {
  const raw = DICTS[lang][key] ?? en[key] ?? (key as string);
  return interpolate(raw, vars);
}

const LangContext = createContext<Lang>("en");

interface I18nProviderProps {
  lang: Lang;
  children: ReactNode;
}

/** Mounted once in App.tsx from settings.ui_language. Changing `lang`
 * re-renders every consumer immediately — no reload. */
export function I18nProvider({ lang, children }: I18nProviderProps) {
  return createElement(LangContext.Provider, { value: lang }, children);
}

export function useLang(): Lang {
  return useContext(LangContext);
}

export function useT(): TFunction {
  const lang = useLang();
  return useMemo<TFunction>(() => (key, vars) => translate(lang, key, vars), [
    lang,
  ]);
}
