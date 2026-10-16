import React, { useEffect, useMemo, useState } from "react";
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  Chip,
  EmptyState,
  FormIcon,
  Loading,
  MedicineRow,
  SectionTitle,
  formatPrice,
  useFormatPack,
} from "../../components/ui";
import {
  chipsOf,
  getAlternatives,
  getBrandStrengths,
  getMedicineBySlug,
  getOtherStrengths,
  isFavorite,
  isFluidForm,
  toggleFavorite,
  type LocalMedicine,
} from "../../lib/db";
import { useApp } from "../../store";
import { useT } from "../../lib/i18n";
import { api } from "../../lib/api";
import { font, radius, space } from "../../theme";

/**
 * Everything on this screen is read from the local SQLite mirror, so it opens
 * instantly and works with the radio off. Only the final "source" link needs
 * the network.
 *
 * Tapping another mg (or pack-size) chip switches the medicine in place - it
 * swaps the headline, price and alternatives without pushing a new screen.
 */
export default function MedicineScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { theme } = useApp();
  const t = useT();
  const formatPack = useFormatPack();

  // The URL slug anchors the screen; tapping a variant chip switches the view
  // in place rather than navigating, so the stack only ever holds one entry.
  const [activeSlug, setActiveSlug] = useState<string>(slug);
  const [medicine, setMedicine] = useState<LocalMedicine | null>(null);
  const [alternatives, setAlternatives] = useState<LocalMedicine[]>([]);
  const [otherStrengths, setOtherStrengths] = useState<LocalMedicine[]>([]);
  const [brandStrengths, setBrandStrengths] = useState<LocalMedicine[]>([]);
  const [priceHistory, setPriceHistory] = useState<
    { id: number; price: number | null; capturedAt: string }[]
  >([]);
  const [favorite, setFavorite] = useState(false);
  const [loading, setLoading] = useState(true);

  // A fresh deep link resets the in-place selection.
  useEffect(() => {
    setActiveSlug(slug);
  }, [slug]);

  useEffect(() => {
    if (!activeSlug) return;
    let cancelled = false;
    void (async () => {
      const [m, alt, other, strengths, history] = await Promise.all([
        getMedicineBySlug(activeSlug),
        getAlternatives(activeSlug, 40),
        getOtherStrengths(activeSlug, 20),
        getBrandStrengths(activeSlug, 24),
        api.history(activeSlug).catch(() => ({ items: [] })),
      ]);
      if (cancelled) return;
      setMedicine(m);
      setAlternatives(alt);
      setOtherStrengths(other);
      setBrandStrengths(strengths);
      setPriceHistory(history.items);
      setFavorite(await isFavorite(activeSlug).catch(() => false));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSlug]);

  const chips = useMemo(() => chipsOf(brandStrengths), [brandStrengths]);
  const fluid = medicine ? isFluidForm(medicine.form) : false;

  if (loading) return <Loading />;
  if (!medicine) return <EmptyState title={t("medicineNotFound")} />;

  const unitPrice = medicine.price && medicine.packSize ? medicine.price / medicine.packSize : null;

  const specs: { label: string; value: string }[] = [
    { label: t("generic"), value: medicine.generic ?? "—" },
    { label: t("company"), value: medicine.company ?? "—" },
    { label: t("strength"), value: medicine.strength || "—" },
    { label: t("form"), value: medicine.form },
    { label: t("packSize"), value: formatPack(medicine.packType, medicine.packSize) },
    { label: t("perTablet"), value: unitPrice ? formatPrice(unitPrice) : "—" },
    { label: t("category"), value: medicine.category ?? "—" },
  ];

  return (
    <>
      <Stack.Screen options={{ title: medicine.brand }} />
      <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={styles.content}>
        {medicine.image ? (
          <Image
            source={{ uri: medicine.image }}
            style={{ width: "100%", height: 180, marginBottom: space.md, borderRadius: 12 }}
            resizeMode="contain"
          />
        ) : null}
        {/* headline */}
        <View style={styles.header}>
          <View style={styles.chipRow}>
            <View style={styles.formPill}>
              <FormIcon form={medicine.form} size={13} color={theme.accent} />
              <Text style={[styles.formPillText, { color: theme.accent }]}>{medicine.form}</Text>
            </View>
            {medicine.strength ? <Chip label={medicine.strength} /> : null}
            <Chip label={formatPack(medicine.packType, medicine.packSize)} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.brand, { color: theme.text }]}>{medicine.brand}</Text>
              <Text style={[styles.generic, { color: theme.muted }]}>{medicine.generic ?? "—"}</Text>
            </View>
            <Pressable
              hitSlop={10}
              onPress={async () => {
                setFavorite(await toggleFavorite(medicine.slug));
              }}
            >
              <MaterialCommunityIcons
                name={favorite ? "heart" : "heart-outline"}
                size={26}
                color={favorite ? theme.danger : theme.muted}
              />
            </Pressable>
          </View>
        </View>

        <View style={[styles.priceCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View>
            <Text style={[styles.priceLabel, { color: theme.faint }]}>{t("price")}</Text>
            <Text style={[styles.price, { color: theme.accent }]}>{formatPrice(medicine.price)}</Text>
          </View>
          {unitPrice !== null ? (
            <View style={styles.priceRight}>
              <Text style={[styles.priceLabel, { color: theme.faint }]}>{t("perTablet")}</Text>
              <Text style={[styles.unitPrice, { color: theme.text }]}>{formatPrice(unitPrice)}</Text>
            </View>
          ) : null}
        </View>

        {/* specs */}
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          {specs.map((row, i) => (
            <View
              key={row.label}
              style={[styles.specRow, i > 0 ? { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth } : null]}
            >
              <Text style={[styles.specLabel, { color: theme.muted }]}>{row.label}</Text>
              <Text style={[styles.specValue, { color: theme.text }]} numberOfLines={2}>
                {row.value}
              </Text>
            </View>
          ))}
        </View>

        {/* same brand, other mg strengths / pack sizes */}
        {chips.length > 1 ? (
          <>
            <SectionTitle hint={fluid ? t("dosageHintFluid") : t("dosageHint")}>{t("dosage")}</SectionTitle>
            <View style={styles.variantChips}>
              {chips.map((chip) => {
                const active = chip.slug === medicine.slug;
                return (
                  <Pressable
                    key={chip.slug}
                    onPress={() => {
                      if (!active) setActiveSlug(chip.slug);
                    }}
                    style={[
                      styles.variantChip,
                      {
                        borderColor: active ? "transparent" : theme.border,
                        backgroundColor: active ? theme.accentSoft : "transparent",
                      },
                    ]}
                  >
                    <Text style={[styles.variantChipText, { color: active ? theme.accent : theme.muted }]}>
                      {chip.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {/* alternatives */}
        <SectionTitle hint={t("alternativesHint")}>{t("alternatives")}</SectionTitle>
        {alternatives.length === 0 ? (
          <Text style={[styles.muted, { color: theme.muted }]}>{t("noAlternatives")}</Text>
        ) : (
          alternatives.map((item) => (
            <MedicineRow
              key={item.id}
              brand={item.brand}
              generic={item.generic}
              company={item.company}
              form={item.form}
              strength={item.strength}
              pack={formatPack(item.packType, item.packSize)}
              price={item.price}
              onPress={() => setActiveSlug(item.slug)}
            />
          ))
        )}

        {otherStrengths.length > 0 ? (
          <>
            <SectionTitle>{t("otherStrengths")}</SectionTitle>
            {otherStrengths.map((item) => (
              <MedicineRow
                key={item.id}
                brand={item.brand}
                generic={item.generic}
                company={item.company}
                form={item.form}
                strength={item.strength}
                pack={formatPack(item.packType, item.packSize)}
                price={item.price}
                onPress={() => setActiveSlug(item.slug)}
              />
            ))}
          </>
        ) : null}

        {priceHistory.length > 0 ? (
          <>
            <SectionTitle hint={t("priceHistory")}>{t("priceHistory")}</SectionTitle>
            <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
              {priceHistory.map((row, i) => (
                <View
                  key={row.id}
                  style={[styles.specRow, i > 0 ? { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth } : null]}
                >
                  <Text style={[styles.specLabel, { color: theme.muted }]}>
                    {new Date(row.capturedAt).toLocaleDateString()}
                  </Text>
                  <Text style={[styles.specValue, { color: theme.text }]}>
                    {formatPrice(row.price)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {medicine.sourceUrl ? (
          <Pressable
            onPress={() => void Linking.openURL(medicine.sourceUrl!)}
            style={[styles.source, { borderColor: theme.border }]}
          >
            <Text style={[styles.sourceText, { color: theme.accent }]}>{t("source")}</Text>
          </Pressable>
        ) : null}

        <Text style={[styles.disclaimer, { color: theme.faint }]}>{t("medicineDisclaimer")}</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, paddingBottom: space.xxl },
  header: { marginBottom: space.lg },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginBottom: space.md },
  formPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "transparent",
    borderWidth: 0,
    borderRadius: radius.pill,
  },
  formPillText: { fontSize: 11, fontFamily: font.regular },
  brand: { fontSize: 26, fontFamily: font.semibold },
  generic: { fontSize: 14, fontFamily: font.regular, marginTop: 2 },

  priceCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: space.lg,
  },
  priceRight: { alignItems: "flex-end" },
  priceLabel: { fontSize: 12, fontFamily: font.regular },
  price: { fontSize: 30, fontFamily: font.semibold },
  unitPrice: { fontSize: 18, fontFamily: font.semibold },

  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.lg },
  specRow: { flexDirection: "row", justifyContent: "space-between", gap: space.lg, paddingVertical: space.md },
  specLabel: { fontSize: 13.5, fontFamily: font.regular },
  specValue: { fontSize: 13.5, fontFamily: font.semibold, flexShrink: 1, textAlign: "right" },

  muted: { fontSize: 13, fontFamily: font.regular, marginBottom: space.md },

  variantChips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginBottom: space.md },
  variantChip: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: 5,
  },
  variantChipText: { fontSize: 12.5, fontFamily: font.regular },

  source: {
    marginTop: space.xl,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sourceText: { fontSize: 13, fontFamily: font.regular },
  disclaimer: { fontSize: 12, fontFamily: font.regular, marginTop: space.lg, lineHeight: 18 },
});