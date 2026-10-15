import React, { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { EmptyState, Loading, SearchField, SyncBar } from "../../components/ui";
import { listGenerics } from "../../lib/db";
import { useApp } from "../../store";
import { useT } from "../../lib/i18n";
import { font, radius, space } from "../../theme";

export default function GenericsScreen() {
  const router = useRouter();
  const { theme, sync, version } = useApp();
  const t = useT();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<{ slug: string; name: string; brandCount: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sync.count === 0) return;
    setLoading(true);
    void listGenerics(400).then((rows) => {
      setItems(rows);
      setLoading(false);
    });
  }, [sync.count, version]);

  const filtered = query
    ? items.filter((g) => g.name.toLowerCase().includes(query.trim().toLowerCase()))
    : items;

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.slug}
        ListHeaderComponent={
          <View style={styles.header}>
            <SyncBar />
            <Text style={[styles.title, { color: theme.text }]}>{t("genericsTitle")}</Text>
            <Text style={[styles.subtitle, { color: theme.muted }]}>{t("genericsSubtitle")}</Text>
            <View style={{ marginTop: space.lg }}>
              <SearchField value={query} onChangeText={setQuery} placeholder={t("genericsSearch")} />
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/generic/${item.slug}`)}
            android_ripple={{ color: theme.accentSoft }}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: pressed ? theme.accentSoft : theme.card,
                borderColor: theme.border,
              },
            ]}
          >
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={[styles.count, { color: theme.faint }]}>{t("brands", item.brandCount)}</Text>
          </Pressable>
        )}
        ListEmptyComponent={loading ? <Loading /> : <EmptyState title={t("nothingFound")} />}
        contentContainerStyle={styles.content}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: space.lg, paddingBottom: space.xxl },
  header: { marginBottom: space.md },
  title: { fontSize: 24, fontFamily: font.semibold },
  subtitle: { fontSize: 13, fontFamily: font.regular, marginTop: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: space.sm,
  },
  name: { fontSize: 15, fontFamily: font.regular, flex: 1 },
  count: { fontSize: 12, fontFamily: font.regular },
});