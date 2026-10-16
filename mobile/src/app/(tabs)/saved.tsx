import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { EmptyState, Loading, MedicineRow, useFormatPack } from "../../components/ui";
import { listFavoriteMedicines, toggleFavorite, type LocalMedicine } from "../../lib/db";
import { useApp } from "../../store";
import { font, space } from "../../theme";

export default function SavedScreen() {
  const router = useRouter();
  const { theme, version } = useApp();
  const formatPack = useFormatPack();
  const [items, setItems] = useState<LocalMedicine[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listFavoriteMedicines());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, version]);

  if (loading) return <Loading label="Loading saved medicines…" />;

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <FlatList
        data={items}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.text }]}>Saved medicines</Text>
            <Text style={[styles.subtitle, { color: theme.muted }]}>
              Stored on this device only.
            </Text>
          </View>
        }
        ListEmptyComponent={
          <EmptyState title="No saved medicines" hint="Tap the heart on a medicine to save it." />
        }
        renderItem={({ item }) => (
          <View>
            <MedicineRow
              brand={item.brand}
              generic={item.generic}
              company={item.company}
              form={item.form}
              strength={item.strength}
              pack={formatPack(item.packType, item.packSize)}
              price={item.price}
              onPress={() => router.push(`/medicine/${item.slug}`)}
            />
            <Pressable
              onPress={async () => {
                await toggleFavorite(item.slug);
                await load();
              }}
              style={styles.remove}
            >
              <Text style={{ color: theme.danger, fontFamily: font.regular, fontSize: 12 }}>Remove</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: space.lg, paddingBottom: space.xxl },
  header: { marginBottom: space.lg, marginTop: space.sm },
  title: { fontSize: 24, fontFamily: font.semibold },
  subtitle: { fontSize: 13, fontFamily: font.regular, marginTop: 4 },
  remove: { alignSelf: "flex-end", marginBottom: space.sm, paddingRight: space.sm },
});
