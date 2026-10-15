// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", "android/*", "ios/*", "expo-env.d.ts"],
  },
  {
    rules: {
      // New in eslint-plugin-react-hooks v6. It fires on every data-loading
      // effect in this app (`setLoading(true)` before an async read), which is
      // the intended pattern here, so it is off rather than refactoring all of
      // them. Re-enable when the screens move to Suspense/query-style loading.
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);
