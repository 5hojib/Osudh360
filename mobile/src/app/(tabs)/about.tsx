import React, { useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useApp, type ThemeMode } from "../../store";
import { useT } from "../../lib/i18n";
import { useAuth } from "../../lib/auth-context";
import { checkForUpdate, downloadAndInstall, type UpdateInfo } from "../../lib/updater";
import { font, radius, space } from "../../theme";

const STEPS: { title: string; body: string }[] = [
  { title: "stepCollect", body: "stepCollectBody" },
  { title: "stepVerify", body: "stepVerifyBody" },
  { title: "stepOffline", body: "stepOfflineBody" },
];

/** Small pill selector used for the theme and language preferences. */
function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { theme } = useApp();
  return (
    <View style={[styles.segmented, { backgroundColor: theme.bg, borderColor: theme.border }]}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[
              styles.segment,
              { backgroundColor: active ? theme.accent : "transparent" },
            ]}
          >
            <Text
              style={[
                styles.segmentText,
                { color: active ? "#ffffff" : theme.muted, fontFamily: active ? font.semibold : font.regular },
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function AboutScreen() {
  const { theme, sync, themeMode, setThemeMode, language, setLanguage } = useApp();
  const t = useT();
  const { user, loading: authLoading, offline, error: authError, signIn, signOut } = useAuth();
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [updateMessage, setUpdateMessage] = useState("");

  const handleCheckUpdate = async () => {
    setChecking(true);
    setUpdateMessage("");
    try {
      const info = await checkForUpdate();
      if (!info) {
        setUpdateInfo(null);
        setUpdateMessage("App is up to date.");
      } else {
        setUpdateInfo(info);
        setUpdateMessage(`New version ${info.version} available.`);
      }
    } catch (e) {
      setUpdateMessage(e instanceof Error ? e.message : "Update check failed.");
    } finally {
      setChecking(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!updateInfo) return;
    setDownloading(true);
    setProgress(0);
    try {
      await downloadAndInstall(updateInfo, setProgress);
    } catch (e) {
      setUpdateMessage(e instanceof Error ? e.message : "Install failed.");
    } finally {
      setDownloading(false);
    }
  };

  const rows: { label: string; value: string }[] = [
    { label: t("medicinesCount"), value: sync.count.toLocaleString("en-US") },
    {
      label: t("lastUpdated"),
      value: sync.lastSyncAt
        ? new Date(sync.lastSyncAt).toLocaleString("en-GB", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "—",
    },
  ];

  const themeOptions: { label: string; value: ThemeMode }[] = [
    { label: t("themeSystem"), value: "system" },
    { label: t("themeLight"), value: "light" },
    { label: t("themeDark"), value: "dark" },
  ];

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: theme.text }]}>{t("aboutTitle")}</Text>
      <Text style={[styles.lead, { color: theme.muted }]}>{t("aboutLead")}</Text>

      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        {rows.map((row, i) => (
          <View
            key={row.label}
            style={[
              styles.row,
              i > 0 ? { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth } : null,
            ]}
          >
            <Text style={[styles.rowLabel, { color: theme.muted }]}>{row.label}</Text>
            <Text style={[styles.rowValue, { color: theme.text }]}>{row.value}</Text>
          </View>
        ))}
      </View>

      <Text style={[styles.sectionTitle, { color: theme.text }]}>{t("account")}</Text>
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        {authLoading ? (
          <View style={styles.accountRow}>
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : user ? (
          <>
            <View style={styles.accountRow}>
              {user.image ? (
                <View style={[styles.avatar, { borderColor: theme.border }]}>
                  <Image source={{ uri: user.image }} style={styles.avatarImage} />
                </View>
              ) : (
                <View style={[styles.avatar, { borderColor: theme.border }]}>
                  <Text style={[styles.avatarText, { color: theme.accent }]}>
                    {(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={[styles.accountName, { color: theme.text }]} numberOfLines={1}>
                  {user.name ?? user.email ?? user.id}
                </Text>
                {user.email ? (
                  <Text style={[styles.accountEmail, { color: theme.muted }]} numberOfLines={1}>
                    {user.email}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.signedIn, { color: theme.faint }]}>{t("signedInAs")}</Text>
            </View>
            {offline ? (
              <View style={[styles.offlineRow, { borderTopColor: theme.border }]}>
                <MaterialCommunityIcons name="cloud-off-outline" size={14} color={theme.faint} />
                <Text style={[styles.offlineText, { color: theme.faint }]}>{t("offlineMode")}</Text>
              </View>
            ) : null}
            <Pressable onPress={() => void signOut()} style={[styles.signOutBtn, { borderColor: theme.border }]}>
              <Text style={[styles.signOutText, { color: theme.accent }]}>{t("signOut")}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable onPress={() => void signIn()} style={[styles.googleBtn, { borderColor: theme.border }]}>
              <MaterialCommunityIcons name="google" size={18} color={theme.text} />
              <Text style={[styles.googleBtnText, { color: theme.text }]}>{t("signInWithGoogle")}</Text>
            </Pressable>
            {authError ? (
              <Text style={[styles.authError, { color: theme.accent }]}>{t("signInError")}</Text>
            ) : null}
          </>
        )}
      </View>

      <Text style={[styles.sectionTitle, { color: theme.text }]}>{t("settings")}</Text>
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <View style={[styles.row, { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
          <Text style={[styles.settingLabel, { color: theme.text }]}>{t("theme")}</Text>
          <Segmented options={themeOptions} value={themeMode} onChange={setThemeMode} />
        </View>
        <View style={styles.row}>
          <Text style={[styles.settingLabel, { color: theme.text }]}>{t("language")}</Text>
          <Segmented
            options={[
              { label: "বাংলা", value: "bn" },
              { label: "English", value: "en" },
            ]}
            value={language}
            onChange={setLanguage}
          />
        </View>
      </View>

      <Text style={[styles.sectionTitle, { color: theme.text }]}>App updates</Text>
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        {updateMessage ? (
          <Text style={[styles.disclaimer, { color: theme.muted, marginTop: 0 }]}>{updateMessage}</Text>
        ) : null}
        <Pressable
          onPress={downloading ? undefined : updateInfo ? handleInstallUpdate : handleCheckUpdate}
          disabled={checking || downloading}
          style={[styles.googleBtn, { borderColor: theme.border, marginTop: updateMessage ? space.md : 0 }]}
        >
          {checking || downloading ? (
            <ActivityIndicator color={theme.accent} />
          ) : (
            <Text style={[styles.googleBtnText, { color: theme.text }]}>
              {updateInfo ? `Install ${updateInfo.version}` : "Check for updates"}
            </Text>
          )}
        </Pressable>
        {downloading ? (
          <View style={{ marginTop: space.md, height: 6, borderRadius: 3, backgroundColor: theme.bg, overflow: "hidden" }}>
            <View style={{ width: `${Math.round(progress * 100)}%`, height: 6, backgroundColor: theme.accent }} />
          </View>
        ) : null}
      </View>

      <Text style={[styles.sectionTitle, { color: theme.text }]}>{t("howItWorks")}</Text>
      {STEPS.map((step, i) => (
        <View
          key={step.title}
          style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
        >
          <Text style={[styles.stepTitle, { color: theme.text }]}>
            {i + 1}. {t(step.title as "stepCollect")}
          </Text>
          <Text style={[styles.stepBody, { color: theme.muted }]}>
            {t(step.body as "stepCollectBody")}
          </Text>
        </View>
      ))}

      <Text style={[styles.sectionTitle, { color: theme.text }]}>{t("disclaimerTitle")}</Text>
      <Text style={[styles.disclaimer, { color: theme.faint }]}>{t("disclaimerBody")}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, paddingBottom: space.xxl },
  title: { fontSize: 24, fontFamily: font.semibold },
  lead: { fontSize: 14, fontFamily: font.regular, marginTop: space.sm, lineHeight: 22 },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    marginTop: space.md,
  },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: space.md },
  rowLabel: { fontSize: 14, fontFamily: font.regular },
  rowValue: { fontSize: 14, fontFamily: font.semibold },
  sectionTitle: { fontSize: 16, fontFamily: font.semibold, marginTop: space.xl, marginBottom: space.xs },
  settingLabel: { fontSize: 14, fontFamily: font.semibold, alignSelf: "center" },
  segmented: {
    flexDirection: "row",
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  segment: {
    paddingHorizontal: space.md,
    paddingVertical: 6,
  },
  segmentText: { fontSize: 12.5, textAlign: "center" },
  stepTitle: { fontSize: 14, fontFamily: font.semibold },
  stepBody: { fontSize: 13, fontFamily: font.regular, marginTop: 4, lineHeight: 20 },
  disclaimer: { fontSize: 12.5, fontFamily: font.regular, marginTop: space.sm, lineHeight: 20 },

  accountRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: { width: 40, height: 40 },
  avatarText: { fontSize: 16, fontFamily: font.semibold },
  accountName: { fontSize: 15, fontFamily: font.semibold },
  accountEmail: { fontSize: 12.5, fontFamily: font.regular, marginTop: 1 },
  signedIn: { fontSize: 11, fontFamily: font.regular },
  offlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  offlineText: { fontSize: 12, fontFamily: font.regular },
  signOutBtn: {
    marginTop: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  signOutText: { fontSize: 13, fontFamily: font.semibold },
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  googleBtnText: { fontSize: 14, fontFamily: font.semibold },
  authError: { fontSize: 12, fontFamily: font.regular, marginTop: space.sm, textAlign: "center" },
});