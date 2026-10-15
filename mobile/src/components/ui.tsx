import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { font, radius, space } from "../theme";
import { useApp } from "../store";
import { useT } from "../lib/i18n";

/** `৳68.40`, or an em dash when the price is unknown. */
export function formatPrice(price: number | null | undefined): string {
  if (price === null || price === undefined || !Number.isFinite(price)) return "—";
  const rounded = Math.round(price * 100) / 100;
  return `৳${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2)}`;
}

/** "Strip × 10", or "১টি" where a single tablet is what is sold. */
export function formatPack(
  packType: string | null,
  packSize: number | null,
  looseLabel = "১টি",
): string {
  if (!packType && !packSize) return "—";
  const isLoose = packSize === 1 && /tablet|capsule/i.test(packType ?? "");
  if (isLoose) return looseLabel;
  if (packType && packSize) return `${packType} × ${packSize}`;
  return (packType ?? String(packSize)) as string;
}

/** Language-aware pack formatter; use in screens instead of `formatPack`. */
export function useFormatPack() {
  const t = useT();
  return (packType: string | null, packSize: number | null) =>
    formatPack(packType, packSize, t("looseOne"));
}

/* --------------------------------------------------------------- form icons */

/** Material glyph per dosage form; unknown forms get a generic medical bag. */
const FORM_ICONS: Record<string, string> = {
  // A round tablet is a filled disc; a capsule is the elongated two-part pill.
  // `pill` is the only capsule-shaped glyph Material ships, so the tablet has
  // to be something clearly not-a-capsule or the two read as the same icon.
  Tablet: "circle",
  Capsule: "pill",
  "Softgel Capsule": "pill",
  "Vaginal Tablet": "circle",
  Suppository: "pill",
  Syrup: "cup-water",
  Suspension: "bottle-tonic-outline",
  Drops: "eyedropper",
  Injection: "needle",
  Cream: "test-tube",
  Ointment: "test-tube",
  Gel: "test-tube",
  Lotion: "bottle-tonic",
  Shampoo: "bottle-tonic",
  Solution: "flask-outline",
  Spray: "spray",
  Powder: "sack",
  Sachet: "package-variant",
  Patch: "bandage",
  Inhaler: "air-filter",
  Foam: "water",
};

export function formIcon(form: string): string {
  return FORM_ICONS[form] ?? "medical-bag";
}

/** Small dosage-form glyph, e.g. a cup for syrup or a needle for injection. */
export function FormIcon({
  form,
  size = 16,
  color,
}: {
  form: string;
  size?: number;
  color?: string;
}) {
  const { theme } = useApp();
  return (
    <MaterialCommunityIcons
      name={formIcon(form) as keyof typeof MaterialCommunityIcons.glyphMap}
      size={size}
      color={color ?? theme.muted}
    />
  );
}

export function Chip({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "accent";
}) {
  const { theme } = useApp();
  const accent = tone === "accent";
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: accent ? theme.accentSoft : "transparent",
          borderColor: accent ? "transparent" : theme.border,
        },
      ]}
    >
      <Text style={[styles.chipText, { color: accent ? theme.accent : theme.muted }]}>{label}</Text>
    </View>
  );
}

export function SectionTitle({ children, hint }: { children: string; hint?: string }) {
  const { theme } = useApp();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>{children}</Text>
      {hint ? <Text style={[styles.sectionHint, { color: theme.faint }]}>{hint}</Text> : null}
    </View>
  );
}

/** A single medicine row: form glyph, name, generic, pack, price. */
export function MedicineRow({
  brand,
  generic,
  company,
  strength,
  pack,
  price,
  form,
  onPress,
}: {
  brand: string;
  generic?: string | null;
  company?: string | null;
  strength?: string | null;
  pack?: string | null;
  price: number | null;
  form?: string | null;
  onPress: () => void;
}) {
  const { theme } = useApp();
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: theme.accentSoft }}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? theme.accentSoft : theme.card, borderColor: theme.border },
      ]}
    >
      {form ? <FormIcon form={form} size={19} /> : null}
      <View style={styles.rowMain}>
        <View style={styles.rowTitleLine}>
          <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
            {brand}
          </Text>
          {strength ? (
            <Text style={[styles.rowStrength, { color: theme.muted }]}>{strength}</Text>
          ) : null}
        </View>
        <Text style={[styles.rowSub, { color: theme.muted }]} numberOfLines={1}>
          {generic ?? "—"}
          {company ? ` · ${company}` : ""}
        </Text>
        {pack ? <Text style={[styles.rowPack, { color: theme.faint }]}>{pack}</Text> : null}
      </View>

      <Text style={[styles.rowPrice, { color: theme.accent }]}>{formatPrice(price)}</Text>
    </Pressable>
  );
}

/** One entry per brand, with a tappable chip for each mg strength or pack size. */
export function BrandRow({
  brand,
  generic,
  company,
  pack,
  price,
  variants,
  activeSlug,
  form,
  onPress,
  onPressVariant,
}: {
  brand: string;
  generic?: string | null;
  company?: string | null;
  pack?: string | null;
  price: number | null;
  variants: { slug: string; label: string }[];
  activeSlug?: string;
  form?: string | null;
  onPress: () => void;
  onPressVariant?: (slug: string) => void;
}) {
  const { theme } = useApp();
  const t = useT();
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: theme.accentSoft }}
      style={({ pressed }) => [
        styles.row,
        styles.brandRow,
        { backgroundColor: pressed ? theme.accentSoft : theme.card, borderColor: theme.border },
      ]}
    >
      {form ? <FormIcon form={form} size={19} /> : null}
      <View style={styles.rowMain}>
        <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
          {brand}
        </Text>
        <Text style={[styles.rowSub, { color: theme.muted }]} numberOfLines={1}>
          {generic ?? "—"}
          {company ? ` · ${company}` : ""}
        </Text>
        {pack ? <Text style={[styles.rowPack, { color: theme.faint }]}>{pack}</Text> : null}

        {variants.length > 1 ? (
          <View style={styles.variantRow}>
            {variants.map((v) => {
              const active = v.slug === activeSlug;
              return (
                <Pressable
                  key={v.slug}
                  hitSlop={6}
                  onPress={() => (onPressVariant ? onPressVariant(v.slug) : onPress())}
                  style={[
                    styles.variantChip,
                    {
                      borderColor: active ? "transparent" : theme.border,
                      backgroundColor: active ? theme.accentSoft : "transparent",
                    },
                  ]}
                >
                  <Text style={[styles.variantText, { color: active ? theme.accent : theme.muted }]}>
                    {v.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>

      <View style={styles.rowPriceWrap}>
        <Text style={[styles.rowPrice, { color: theme.accent }]}>{formatPrice(price)}</Text>
        {variants.length > 1 ? (
          <Text style={[styles.rowFrom, { color: theme.faint }]}>{t("from")}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function SearchField({
  value,
  onChangeText,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const { theme } = useApp();
  return (
    <View style={[styles.searchWrap, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.faint}
        autoFocus={autoFocus}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        style={[styles.searchInput, { color: theme.text }]}
      />
      {value.length > 0 ? (
        <Pressable onPress={() => onChangeText("")} hitSlop={10}>
          <Text style={[styles.clear, { color: theme.faint }]}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptyState({
  title,
  hint,
  actionLabel,
  onAction,
}: {
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { theme } = useApp();
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: theme.text }]}>{title}</Text>
      {hint ? <Text style={[styles.emptyHint, { color: theme.muted }]}>{hint}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={[styles.emptyAction, { borderColor: theme.border, backgroundColor: theme.card }]}
        >
          <Text style={[styles.emptyActionText, { color: theme.accent }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const { theme } = useApp();
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={theme.accent} />
      {label ? <Text style={[styles.emptyHint, { color: theme.muted }]}>{label}</Text> : null}
    </View>
  );
}

/** Thin progress bar shown while the catalogue syncs. */
export function SyncBar() {
  const { sync, refresh, theme } = useApp();
  const t = useT();
  if (sync.status !== "syncing") return null;
  return (
    <Pressable onPress={() => void refresh()} style={[styles.syncBar, { backgroundColor: theme.accentSoft }]}>
      <ActivityIndicator size="small" color={theme.accent} />
      <Text style={[styles.syncText, { color: theme.accent }]}>{t("syncUpdating")}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  chipText: { fontSize: 11, fontFamily: font.regular },

  section: { marginBottom: space.sm, marginTop: space.lg },
  sectionTitle: { fontSize: 15, fontFamily: font.semibold },
  sectionHint: { fontSize: 12, fontFamily: font.regular, marginTop: 2 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: space.sm,
  },
  rowMain: { flex: 1, gap: 2 },
  rowTitleLine: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  rowTitle: { fontSize: 15, fontFamily: font.semibold, flexShrink: 1 },
  rowStrength: { fontSize: 12, fontFamily: font.regular },
  rowSub: { fontSize: 12.5, fontFamily: font.regular },
  rowPack: { fontSize: 11.5, fontFamily: font.regular },
  rowPrice: { fontSize: 16, fontFamily: font.semibold },
  rowPriceWrap: { alignItems: "flex-end", gap: 2 },
  rowFrom: { fontSize: 10, fontFamily: font.regular },

  brandRow: { alignItems: "flex-start" },
  variantRow: { flexDirection: "row", flexWrap: "wrap", gap: space.xs, marginTop: 4 },
  variantChip: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  variantText: { fontSize: 11, fontFamily: font.regular },

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
  },
  searchInput: { flex: 1, height: 46, fontSize: 15, fontFamily: font.regular, paddingVertical: 0 },
  clear: { fontSize: 14, fontFamily: font.regular },

  empty: { alignItems: "center", justifyContent: "center", paddingVertical: space.xxl, gap: space.sm },
  emptyTitle: { fontSize: 15, fontFamily: font.semibold },
  emptyHint: { fontSize: 13, fontFamily: font.regular, textAlign: "center" },
  emptyAction: {
    marginTop: space.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  emptyActionText: { fontSize: 14, fontFamily: font.semibold },

  syncBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    paddingVertical: space.sm,
  },
  syncText: { fontSize: 12, fontFamily: font.regular },
});