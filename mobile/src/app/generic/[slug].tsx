import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Chip, EmptyState, Loading, MedicineRow, useFormatPack } from "../../components/ui";
import { getBrandsOfGeneric, type LocalMedicine } from "../../lib/db";
import { useApp } from "../../store";
import { useT } from "../../lib/i18n";
import { font, space } from "../../theme";

/**
 * Every brand of one generic, grouped by strength.
 *
 * Grouping matters: a 250 mg tablet and a 500 mg tablet side by side would
 * invite a wrong comparison, so each strength gets its own section and the
 * brands inside are ordered by price.
 */
export default function GenericScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { theme } = useApp();
  const t = useT();
  const formatPack = useFormatPack();

  const [brands, setBrands] = useState<LocalMedicine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    void getBrandsOfGeneric(slug).then((rows) => {
      if (cancelled) return;
      setBrands(rows);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const groups = useMemo(() => {
    const map = new Map<string, LocalMedicine[]>();
    for (const b of brands) {
      const key = `${b.form}|${b.strength}`;
      const list = map.get(key);
      if (list) list.push(b);
      else map.set(key, [b]);
    }
    return [...map.values()];
  }, [brands]);

  const name = brands[0]?.generic ?? slug;

  if (loading) return <Loading />;
  if (brands.length === 0) return <EmptyState title={t("genericNotFound")} />;

  return (
    <>
      <Stack.Screen options={{ title: name }} />
      <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.label, { color: theme.accent }]}>{t("genericLabel")}</Text>
          <Text style={[styles.name, { color: theme.text }]}>{name}</Text>
          <Text style={[styles.meta, { color: theme.muted }]}>
            {t("genericMeta", brands.length, groups.length)}
          </Text>
        </View>

        {groups.map((items) => (
          <View key={`${items[0].form}-${items[0].strength}`} style={{ marginTop: space.lg }}>
            <View style={styles.groupHead}>
              <Chip label={items[0].strength || "—"} tone="accent" />
              <Chip label={items[0].form} />
              <Text style={[styles.groupCount, { color: theme.faint }]}>{items.length}</Text>
            </View>
            {items.map((item) => (
              <MedicineRow
                key={item.id}
                brand={item.brand}
                company={item.company}
                form={item.form}
                pack={formatPack(item.packType, item.packSize)}
                price={item.price}
                onPress={() => router.push(`/medicine/${item.slug}`)}
              />
            ))}
          </View>
        ))}

        <Text style={[styles.disclaimer, { color: theme.faint }]}>{t("genericDisclaimer")}</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, paddingBottom: space.xxl },
  header: { marginBottom: space.sm },
  label: { fontSize: 12, fontFamily: font.regular },
  name: { fontSize: 24, fontFamily: font.semibold, marginTop: 2 },
  meta: { fontSize: 13, fontFamily: font.regular, marginTop: 4 },
  groupHead: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.md },
  groupCount: { fontSize: 12, fontFamily: font.regular },
  disclaimer: { fontSize: 12, fontFamily: font.regular, marginTop: space.xl, lineHeight: 18 },
});