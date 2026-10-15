import React, { useEffect } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useApp } from "../store";
import { getSessionWithVerifier } from "../lib/auth";
import { useAuth } from "../lib/auth-context";

/**
 * Landing route for `osudh360://auth-callback?neon_auth_session_verifier=…`.
 *
 * The primary sign-in path resolves the browser-session promise directly, but
 * on some platforms (e.g. web, or an Android edge case) the redirect instead
 * lands here as a deep link. This screen stores whatever verifier arrived and
 * bounces back to the app; the auth hook's restore logic takes it from there.
 */
const VERIFIER_KEY = "neon_auth_session_verifier";

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{ neon_auth_session_verifier?: string }>();
  const router = useRouter();
  const { theme } = useApp();
  const { refresh } = useAuth();

  useEffect(() => {
    const verifier = params.neon_auth_session_verifier;
    void (async () => {
      if (typeof verifier === "string" && verifier.length > 0) {
        await SecureStore.setItemAsync(VERIFIER_KEY, verifier).catch(() => {});
        await getSessionWithVerifier(verifier);
        await refresh();
      }
      router.replace("/");
    })();
  }, [params.neon_auth_session_verifier, router, refresh]);

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <ActivityIndicator color={theme.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center" },
});