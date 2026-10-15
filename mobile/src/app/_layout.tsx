import React from "react";
import { Redirect, Stack, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { ActivityIndicator, View } from "react-native";
import { AppProvider, useApp } from "../store";
import { AuthProvider, useAuth } from "../lib/auth-context";
import { useT } from "../lib/i18n";

export default function RootLayout() {
  const [loaded] = useFonts({
    HindSiliguriRegular: require("../../assets/fonts/HindSiliguri-Regular.ttf"),
    HindSiliguriSemiBold: require("../../assets/fonts/HindSiliguri-SemiBold.ttf"),
  });

  if (!loaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppProvider>
          <ThemedStack />
        </AppProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

/**
 * Sign-in gate. The catalogue API requires a signed-in user, so the app does
 * too: without a session every route funnels to /sign-in. `auth-callback` is
 * exempt because the OAuth deep link lands there mid-flow, before the session
 * exists.
 */
function ThemedStack() {
  const { theme, isDark } = useApp();
  const { user, loading } = useAuth();
  const segments = useSegments();
  const t = useT();

  const root = segments[0] as string | undefined;
  const onSignIn = root === "sign-in";
  const onAuthCallback = root === "auth-callback";

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  if (!user && !onSignIn && !onAuthCallback) {
    return <Redirect href="/sign-in" />;
  }
  if (user && onSignIn) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.bg },
          headerTitleStyle: { fontFamily: "HindSiliguri-SemiBold", fontSize: 17, color: theme.text },
          headerTintColor: theme.accent,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.bg },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
        <Stack.Screen name="medicine/[slug]" options={{ title: t("tabHome") }} />
        <Stack.Screen name="generic/[slug]" options={{ title: t("tabGenerics") }} />
        <Stack.Screen name="category/[...path]" options={{ title: t("tabCategories") }} />
      </Stack>
    </>
  );
}
