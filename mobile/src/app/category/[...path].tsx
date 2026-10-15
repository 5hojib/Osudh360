import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { EmptyState, Loading, MedicineRow, useFormatPack } from "../../components/ui";
import { searchMedicines, type LocalMedicine } from "../../lib/db";
import { useApp } from "../../store";
import { useT } from "../../lib/i18n";
import { font, space } from "../../theme";

/**
 * Medicines inside one therapeutic category, including everything in its
 * subcategories. The slug path is a slash-separated trail
 * ("cardiovascular-system/beta-blockers"), so a prefix match covers the branch.
 */
export default function CategoryScreen() {
  const params = useLocalSearchParams<{ path: string | string[] }>();
  const router = useRouter();
  const { theme } = useApp();
  const t = useT();
  const formatPack = useFormatPack();

  const slugPath = Array.isArray(params.path) ? params.path.join("/") : (params.path ?? "");

  const [items, setItems] = useState<LocalMedicine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slugPath) return;
    let cancelled = false;
    setLoading(true);
    void searchMedicines({ category: slugPath, limit: 200 }).then((res) => {
      if (cancelled) return;
      setItems(res.items);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [slugPath]);

  const title = slugPath.split("/").pop()?.replace(/-/g, " ") ?? "";

  if (loading) return <Loading />;
  if (items.length === 0) return <EmptyState title={t("categoryEmpty")} />;

  return (
    <>
      <Stack.Screen options={{ title: title || t("categoryLabel") }} />
      <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.label, { color: theme.accent }]}>{t("categoryLabel")}</Text>
          <Text style={[styles.name, { color: theme.text }]}>{title}</Text>
          <Text style={[styles.meta, { color: theme.muted }]}>{t("medicines", items.length)}</Text>
        </View>

        {items.map((item) => (
          <MedicineRow
            key={item.id}
            brand={item.brand}
            generic={item.generic}
            company={item.company}
            form={item.form}
            strength={item.strength}
            pack={formatPack(item.packType, item.packSize)}
            price={item.price}
            onPress={() => router.push(`/medicine/${item.slug}`)}
          />
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, paddingBottom: space.xxl },
  header: { marginBottom: space.lg },
  label: { fontSize: 12, fontFamily: font.regular },
  name: { fontSize: 24, fontFamily: font.semibold, marginTop: 2, textTransform: "capitalize" },
  meta: { fontSize: 13, fontFamily: font.regular, marginTop: 4 },
});