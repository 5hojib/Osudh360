import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useApp } from "../store";
import { useAuth } from "../lib/auth-context";
import { useT } from "../lib/i18n";
import { font, radius, space } from "../theme";

/**
 * The only screen an unauthenticated visitor sees. The catalogue API requires a
 * JWT, so nothing else is reachable until Google sign-in completes.
 */
export default function SignInScreen() {
  const { theme } = useApp();
  const { signIn, error } = useAuth();
  const t = useT();
  const [busy, setBusy] = useState(false);

  const onSignIn = async () => {
    setBusy(true);
    try {
      await signIn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <View style={styles.center}>
        <View style={[styles.badge, { backgroundColor: theme.accentSoft }]}>
          <MaterialCommunityIcons name="pill" size={40} color={theme.accent} />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>{t("appName")}</Text>
        <Text style={[styles.subtitle, { color: theme.muted }]}>{t("homeSubtitle")}</Text>

        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>{t("signInTitle")}</Text>
          <Text style={[styles.cardBody, { color: theme.muted }]}>{t("signInBody")}</Text>

          <Pressable
            onPress={onSignIn}
            disabled={busy}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.accent, opacity: busy ? 0.7 : pressed ? 0.85 : 1 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <MaterialCommunityIcons name="google" size={20} color="#ffffff" />
                <Text style={styles.buttonText}>{t("signInWithGoogle")}</Text>
              </>
            )}
          </Pressable>

          {error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
        </View>

        <Text style={[styles.footnote, { color: theme.faint }]}>{t("signInFootnote")}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: space.xl },
  badge: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.lg,
  },
  title: { fontFamily: font.semibold, fontSize: 30 },
  subtitle: {
    fontFamily: font.regular,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 21,
    marginTop: space.sm,
    marginBottom: space.xl,
  },
  card: {
    width: "100%",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: space.xl,
  },
  cardTitle: { fontFamily: font.semibold, fontSize: 17, marginBottom: space.xs },
  cardBody: { fontFamily: font.regular, fontSize: 13, lineHeight: 20, marginBottom: space.lg },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    height: 50,
    borderRadius: radius.md,
  },
  buttonText: { fontFamily: font.semibold, fontSize: 15, color: "#ffffff" },
  error: { fontFamily: font.regular, fontSize: 13, marginTop: space.md, textAlign: "center" },
  footnote: {
    fontFamily: font.regular,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
    marginTop: space.xl,
  },
});
