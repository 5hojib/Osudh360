import React, { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { EmptyState, Loading, SearchField, SyncBar } from "../../components/ui";
import { listCategories } from "../../lib/db";
import { useApp } from "../../store";
import { useT } from "../../lib/i18n";
import { font, radius, space } from "../../theme";

type Row = { slugPath: string; name: string; depth: number; productCount: number };

/**
 * Only the top-level categories are listed; tapping one drills in. Showing
 * every level of the therapeutic tree at once produced a wall of near-identical
 * rows that nobody scrolled through.
 */
export default function CategoriesScreen() {
  const router = useRouter();
  const { theme, sync, version } = useApp();
  const t = useT();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sync.count === 0) return;
    setLoading(true);
    void listCategories(400).then((all) => {
      // depth 1 == no "/" in the slug path.
      setRows(all.filter((r) => !r.slugPath.includes("/")));
      setLoading(false);
    });
  }, [sync.count, version]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, query]);

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.slugPath}
        ListHeaderComponent={
          <View style={styles.header}>
            <SyncBar />
            <Text style={[styles.title, { color: theme.text }]}>{t("categoriesTitle")}</Text>
            <Text style={[styles.subtitle, { color: theme.muted }]}>{t("categoriesSubtitle")}</Text>
            <View style={{ marginTop: space.lg }}>
              <SearchField value={query} onChangeText={setQuery} placeholder={t("categoriesSearch")} />
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/category/${item.slugPath}`)}
            android_ripple={{ color: theme.accentSoft }}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: pressed ? theme.accentSoft : theme.card, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={2}>
              {item.name}
            </Text>
            <Text style={[styles.count, { color: theme.faint }]}>{item.productCount}</Text>
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