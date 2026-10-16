import { useCallback } from "react";
import { useApp } from "../store";

/**
 * Tiny UI dictionary. The app ships Bengali-first; English is a toggle for
 * accessibility, so it is intentionally flat and keyed by screen section.
 *
 * Values may be plain strings or formatters taking a count. `t(key, n)` unwraps
 * both. The choice is persisted in the SQLite meta table by the store.
 */

const bn = {
  // tabs
  tabHome: "ঔষধ",
  tabGenerics: "জেনেরিক",
  tabCategories: "শ্রেণি",
  tabAbout: "সম্পর্কে",

  // home / search
  appName: "Osudh360",
  homeSubtitle: "বাংলাদেশের ঔষধের দাম, প্যাক সাইজ এবং একই জেনেরিকের বিকল্প",
  searchPlaceholder: "ঔষধের নাম বা জেনেরিক লিখুন…",
  popular: "জনপ্রিয়",
  searchResults: (n: number) => `${n} টি ফলাফল`,
  catalogueErrorTitle: "ঔষধের তালিকা নামানো যায়নি",
  catalogueErrorHint:
    "সংযোগ পাওয়া যাচ্ছে না। ইন্টারনেট চালু করে আবার চেষ্টা করুন — প্রথমবার চালু করার সময় একবার অনলাইনে থাকা দরকার।",
  retry: "আবার চেষ্টা করুন",
  downloadingCatalogue: "ঔষধের তালিকা নামানো হচ্ছে…",

  // shared bits
  nothingFound: "কিছু পাওয়া যায়নি",
  nothingFoundHint: "অন্য নামে বা জেনেরিকের নামে খুঁজে দেখুন",
  syncUpdating: "হালনাগাদ হচ্ছে…",
  from: "সর্বনিম্ন",
  looseOne: "১টি",
  brands: (n: number) => `${n} ব্র্যান্ড`,
  medicines: (n: number) => `${n} টি ঔষধ`,
  strengths: (n: number) => `${n} টি মাত্রা`,

  // generics tab
  genericsTitle: "জেনেরিক",
  genericsSubtitle: "উপাদান অনুযায়ী সব ব্র্যান্ড তুলনা করুন",
  genericsSearch: "জেনেরিক খুঁজুন…",

  // categories tab
  categoriesTitle: "ঔষধের শ্রেণি",
  categoriesSubtitle: "কোন রোগের জন্য কী ঔষধ",
  categoriesSearch: "শ্রেণি খুঁজুন…",

  // medicine detail
  medicineNotFound: "ঔষধটি পাওয়া যায়নি",
  generic: "জেনেরিক",
  company: "কোম্পানি",
  strength: "মাত্রা",
  form: "ফর্ম",
  packSize: "প্যাক সাইজ",
  perTablet: "প্রতি ট্যাবলেট",
  category: "শ্রেণি",
  price: "দাম",
  dosageHint: "একই ব্র্যান্ড, ভিন্ন মাত্রা",
  dosageHintFluid: "একই ব্র্যান্ড, ভিন্ন প্যাক সাইজ",
  dosage: "মাত্রা",
  alternativesHint: "একই উপাদান ও মাত্রা, ভিন্ন কোম্পানি",
  alternatives: "একই জেনেরিকের বিকল্প",
  priceHistory: "দামের ইতিহাস",
  noAlternatives: "এই মাত্রার আর কোনো বিকল্প নেই।",
  otherStrengths: "অন্য মাত্রায়",
  source: "তথ্যের উৎসে দেখুন ↗",
  medicineDisclaimer:
    "দাম তথ্য তৃতীয় পক্ষের প্রকাশিত তালিকা থেকে নেওয়া। কেনার আগে প্যাকেটের MRP ও মেয়াদ দেখে নিন।",

  // generic detail
  genericNotFound: "জেনেরিকটি পাওয়া যায়নি",
  genericLabel: "জেনেরিক",
  genericMeta: (n: number, m?: number) => `${n} টি ব্র্যান্ড · ${m ?? 0} টি মাত্রা`,
  genericDisclaimer:
    "একই জেনেরিক মানে একই উপাদান — কোম্পানি ও প্যাক সাইজ অনুযায়ী দাম আলাদা হয়।",

  // category detail
  categoryEmpty: "এই শ্রেণিতে কিছু নেই",
  categoryLabel: "শ্রেণি",

  // about
  aboutTitle: "সম্পর্কে",
  aboutLead:
    "Osudh360 — বাংলাদেশের সব ডোজ ফর্মের ঔষধের দাম, প্যাক সাইজ, কোম্পানি এবং একই জেনেরিকের সব বিকল্প ব্র্যান্ড।",
  medicinesCount: "ঔষধ",
  lastUpdated: "সর্বশেষ হালনাগাদ",
  howItWorks: "কীভাবে কাজ করে",
  stepCollect: "তথ্য সংগ্রহ",
  stepCollectBody: "বাংলাদেশের অনলাইন ফার্মেসির প্রকাশিত তালিকা থেকে ঔষধের তথ্য নেওয়া হয়।",
  stepVerify: "যাচাই",
  stepVerifyBody: "প্রতিটি ঔষধের জেনেরিক, মাত্রা, কোম্পানি ও প্যাক সাইজ পরীক্ষা করে ঢোকানো হয়।",
  stepOffline: "অফলাইন",
  stepOfflineBody: "পুরো তালিকা ফোনেই সংরক্ষিত থাকে, তাই ইন্টারনেট ছাড়াই সব তথ্য দেখা যায়।",
  disclaimerTitle: "দাবিত্যাগ",
  disclaimerBody:
    "এই অ্যাপের উদ্দেশ্য শুধুই তথ্য প্রদান। এটি চিকিৎসা পরামর্শ নয়। দাম তৃতীয় পক্ষের প্রকাশিত তালিকা থেকে নেওয়া এবং যেকোনো সময় পরিবর্তন হতে পারে। যেকোনো ঔষধ কেনা বা গ্রহণের আগে অবশ্যই একজন চিকিৎসক বা ফার্মাসিস্টের পরামর্শ নিন।",

  // settings
  settings: "সেটিংস",
  theme: "থিম",
  themeSystem: "সিস্টেম",
  themeLight: "লাইট",
  themeDark: "ডার্ক",
  language: "ভাষা",

  // account
  account: "অ্যাকাউন্ট",
  signedInAs: "লগইন করা আছে",
  signInWithGoogle: "Google দিয়ে লগইন",
  signOut: "লগআউট",
  signInError: "লগইন ব্যর্থ হয়েছে। আবার চেষ্টা করুন।",
  signInTitle: "লগইন করুন",
  signInBody: "সব তথ্য দেখতে Google দিয়ে লগইন করুন। একবার লগইন করলে ইন্টারনেট ছাড়াও অ্যাপ চলবে।",
  signInFootnote: "লগইন শুধু আপনার পরিচয় নিশ্চিত করে। ঔষধের তালিকা আপনার ফোনেই সংরক্ষিত থাকে।",
  offlineMode: "অফলাইন — সংরক্ষিত তথ্য দেখানো হচ্ছে",
} as const;

const en: Record<keyof typeof bn, string | ((n: number, m?: number) => string)> = {
  tabHome: "Medicines",
  tabGenerics: "Generics",
  tabCategories: "Categories",
  tabAbout: "About",

  appName: "Osudh360",
  homeSubtitle: "Prices, pack sizes and alternative brands for medicines in Bangladesh",
  searchPlaceholder: "Search medicine or generic…",
  popular: "Popular",
  searchResults: (n: number) => `${n} results`,
  catalogueErrorTitle: "Couldn't download the catalogue",
  catalogueErrorHint:
    "No connection. Turn on the internet and try again — the first launch needs to be online once.",
  retry: "Try again",
  downloadingCatalogue: "Downloading the catalogue…",

  nothingFound: "Nothing found",
  nothingFoundHint: "Try another name or generic",
  syncUpdating: "Updating…",
  from: "from",
  looseOne: "1 pc",
  brands: (n: number) => `${n} brands`,
  medicines: (n: number) => `${n} medicines`,
  strengths: (n: number) => `${n} strengths`,

  genericsTitle: "Generics",
  genericsSubtitle: "Compare every brand by ingredient",
  genericsSearch: "Search generic…",

  categoriesTitle: "Categories",
  categoriesSubtitle: "Which medicine for which condition",
  categoriesSearch: "Search category…",

  medicineNotFound: "Medicine not found",
  generic: "Generic",
  company: "Company",
  strength: "Strength",
  form: "Form",
  packSize: "Pack size",
  perTablet: "Per tablet",
  category: "Category",
  price: "Price",
  dosageHint: "Same brand, different strength",
  dosageHintFluid: "Same brand, different pack size",
  dosage: "Dosage",
  alternativesHint: "Same ingredient & strength, different company",
  alternatives: "Alternatives of the same generic",
  priceHistory: "Price history",
  noAlternatives: "No other alternatives at this strength.",
  otherStrengths: "Other strengths",
  source: "View on source ↗",
  medicineDisclaimer:
    "Prices are taken from third-party published lists. Check the pack MRP and expiry before buying.",

  genericNotFound: "Generic not found",
  genericLabel: "Generic",
  genericMeta: (n: number, m?: number) => `${n} brands · ${m ?? 0} strengths`,
  genericDisclaimer:
    "Same generic means the same ingredient — prices differ by company and pack size.",

  categoryEmpty: "Nothing in this category",
  categoryLabel: "Category",

  aboutTitle: "About",
  aboutLead:
    "Osudh360 — prices, pack sizes, companies and alternative brands for every dosage form in Bangladesh.",
  medicinesCount: "Medicines",
  lastUpdated: "Last updated",
  howItWorks: "How it works",
  stepCollect: "Collect",
  stepCollectBody: "Medicine data is taken from published lists of online pharmacies in Bangladesh.",
  stepVerify: "Verify",
  stepVerifyBody: "Each medicine's generic, strength, company and pack size are checked before entry.",
  stepOffline: "Offline",
  stepOfflineBody: "The whole list is stored on your phone, so everything works without the internet.",
  disclaimerTitle: "Disclaimer",
  disclaimerBody:
    "This app is for information only and is not medical advice. Prices come from third-party published lists and may change at any time. Always consult a doctor or pharmacist before buying or taking any medicine.",

  settings: "Settings",
  theme: "Theme",
  themeSystem: "System",
  themeLight: "Light",
  themeDark: "Dark",
  language: "Language",

  account: "Account",
  signedInAs: "Signed in",
  signInWithGoogle: "Sign in with Google",
  signOut: "Sign out",
  signInError: "Sign-in failed. Please try again.",
  signInTitle: "Sign in",
  signInBody: "Sign in with Google to browse the catalogue. Once signed in, the app works offline.",
  signInFootnote: "Sign-in only verifies your identity. The medicine catalogue stays on your phone.",
  offlineMode: "Offline — showing saved data",
};

type DictKey = keyof typeof bn;

export function useT() {
  const { language } = useApp();
  return useCallback(
    (key: DictKey, n?: number, m?: number): string => {
      const v = language === "en" ? en[key] : bn[key];
      return typeof v === "function" ? v(n ?? 0, m) : v;
    },
    [language],
  );
}