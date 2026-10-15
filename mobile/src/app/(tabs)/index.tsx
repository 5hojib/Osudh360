import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { EmptyState, Loading, BrandRow, SearchField, SyncBar, useFormatPack } from "../../components/ui";
import { groupByBrand, searchMedicines, type LocalMedicine } from "../../lib/db";
import { useApp } from "../../store";
import { useT } from "../../lib/i18n";
import { font, space } from "../../theme";

const PAGE_SIZE = 40;

const SUGGESTED = ["Napa", "Ace", "Seclo", "Fexo", "Ceevit", "Nido", "Azithral", "Monas"];

export default function SearchScreen() {
  const router = useRouter();
  const { theme, sync, refresh, version } = useApp();
  const t = useT();
  const formatPack = useFormatPack();

  const [query, setQuery] = useState("");
  const [items, setItems] = useState<LocalMedicine[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);

  const catalogueReady = sync.count > 0;

  const load = useCallback(
    async (q: string, offset: number) => {
      setLoading(true);
      try {
        const res = await searchMedicines({ q, limit: PAGE_SIZE, offset });
        setItems((prev) => (offset === 0 ? res.items : [...prev, ...res.items]));
        setTotal(res.total);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Re-query whenever the query, the page, or the cached catalogue changes.
  useEffect(() => {
    if (!catalogueReady) return;
    void load(query, 0);
    setPage(0);
  }, [query, version, catalogueReady, load]);

  const onEndReached = useCallback(() => {
    if (loading || items.length >= total) return;
    const next = page + 1;
    setPage(next);
    void load(query, next * PAGE_SIZE);
  }, [loading, items.length, total, page, query, load]);

  // One entry per brand, with the mg (or pack size) variants collapsed into
  // chips. Re-derived as pages append, so a brand split across pages merges
  // once the rest loads.
  const groups = useMemo(() => groupByBrand(items), [items]);

  const header = useMemo(
    () => (
      <View>
        <SyncBar />
        <View style={styles.intro}>
          <Text style={[styles.title, { color: theme.text }]}>{t("appName")}</Text>
          <Text style={[styles.subtitle, { color: theme.muted }]}>{t("homeSubtitle")}</Text>
        </View>

        <SearchField value={query} onChangeText={setQuery} placeholder={t("searchPlaceholder")} />

        {!query && catalogueReady ? (
          <View style={styles.suggestions}>
            <Text style={[styles.suggestLabel, { color: theme.faint }]}>{t("popular")}</Text>
            <View style={styles.suggestRow}>
              {SUGGESTED.map((s) => (
                <Text
                  key={s}
                  onPress={() => setQuery(s)}
                  style={[styles.suggest, { color: theme.accent, borderColor: theme.border }]}
                >
                  {s}
                </Text>
              ))}
            </View>
          </View>
        ) : null}

        {query && total > 0 ? (
          <Text style={[styles.resultCount, { color: theme.faint }]}>{t("searchResults", total)}</Text>
        ) : null}
      </View>
    ),
    [query, theme, catalogueReady, total, t],
  );

  if (!catalogueReady) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg }]}>
        {header}
        {sync.status === "error" ? (
          <EmptyState
            title={t("catalogueErrorTitle")}
            hint={t("catalogueErrorHint")}
            actionLabel={t("retry")}
            onAction={() => void refresh()}
          />
        ) : (
          <Loading label={t("downloadingCatalogue")} />
        )}
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <FlatList
        data={groups}
        keyExtractor={(group) => group.key}
        ListHeaderComponent={header}
        renderItem={({ item: group }) => {
          // Show a pack only when every variant shares it, so a grouped row
          // never advertises the wrong pack size.
          const packs = new Set(group.variants.map((v) => formatPack(v.packType, v.packSize)));
          const pack = packs.size === 1 ? [...packs][0] : null;
          return (
            <BrandRow
              brand={group.brand}
              generic={group.generic}
              company={group.company}
              form={group.form}
              pack={pack}
              price={group.price}
              variants={group.chips}
              onPress={() => router.push(`/medicine/${group.variants[0].slug}`)}
              onPressVariant={(slug) => router.push(`/medicine/${slug}`)}
            />
          );
        }}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState title={t("nothingFound")} hint={t("nothingFoundHint")} />
          )
        }
        onEndReached={onEndReached}
        onEndReachedThreshold={0.6}
        refreshControl={
          <RefreshControl refreshing={sync.status === "syncing"} onRefresh={() => void refresh()} />
        }
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: space.lg, paddingBottom: space.xxl },
  intro: { marginBottom: space.lg, marginTop: space.sm },
  title: { fontSize: 26, fontFamily: font.semibold },
  subtitle: { fontSize: 13, fontFamily: font.regular, marginTop: 4, lineHeight: 20 },
  suggestions: { marginTop: space.lg },
  suggestLabel: { fontSize: 12, fontFamily: font.regular, marginBottom: space.sm },
  suggestRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  suggest: {
    fontSize: 13,
    fontFamily: font.regular,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: space.md,
    paddingVertical: 5,
  },
  resultCount: { fontSize: 12, fontFamily: font.regular, marginTop: space.lg, marginBottom: space.sm },
});