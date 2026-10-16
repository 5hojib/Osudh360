import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useApp } from "../../store";
import { font, radius, space } from "../../theme";
import { api } from "../../lib/api";
import {
  isFluidForm,
  searchMedicines,
  type LocalMedicine,
} from "../../lib/db";

type DoseSlots = { morning: string; noon: string; evening: string; night: string };

type DoseKind = "solid" | "liquid" | "drops" | "application" | "custom";

type PrescriptionItem = {
  medicine: LocalMedicine;
  kind: DoseKind;
  slots: DoseSlots;
  doseCount: number;
  amount: string; // ml / drops / applications per dose
  timesPerDay: string;
  days: string;
  directions: string;
  customSchedule: string;
  customQty: string;
};

type PrescriptionPayloadItem = {
  medicine: LocalMedicine;
  kind: DoseKind;
  slots?: DoseSlots;
  doseCount?: number;
  amount?: number;
  timesPerDay?: number;
  days: number;
  directions: string;
  customSchedule?: string;
  customQty?: number;
};

type PrescriptionPayload = {
  doctor: string;
  patient: string;
  showPrices: boolean;
  items: PrescriptionPayloadItem[];
};

type CloudPrescription = { id: string; title: string; createdAt: string; payload: unknown };

const SLOT_LABELS = ["Morning", "Noon", "Evening", "Night"];

function unitPrice(m: LocalMedicine): number | null {
  if (m.price == null || !Number.isFinite(m.price)) return null;
  if (m.packSize && m.packSize > 0) return m.price / m.packSize;
  return m.price;
}

function num(v: string | number | undefined | null): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function slotTotal(slots: DoseSlots): number {
  return num(slots.morning) + num(slots.noon) + num(slots.evening) + num(slots.night);
}

function perDayQty(it: PrescriptionItem): number {
  if (it.customSchedule.trim()) return 0;
  if (it.kind === "liquid" || it.kind === "drops") return num(it.amount) * num(it.timesPerDay);
  if (it.kind === "application") return num(it.timesPerDay);
  return slotTotal(it.slots);
}

function totalQty(it: PrescriptionItem): number {
  if (it.customSchedule.trim()) return num(it.customQty);
  return perDayQty(it) * (Number(it.days) || 0);
}

function subtotal(it: PrescriptionItem): number | null {
  if (it.kind !== "solid") return null;
  const up = unitPrice(it.medicine);
  if (up == null) return null;
  return up * totalQty(it);
}

function guessKind(m: LocalMedicine): DoseKind {
  const f = (m.form ?? "").toLowerCase();
  if (f.includes("drop")) return "drops";
  if (f.includes("cream") || f.includes("ointment") || f.includes("gel")) return "application";
  if (isFluidForm(m.form)) return "liquid";
  return "solid";
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function scheduleText(it: PrescriptionItem): string {
  if (it.customSchedule.trim()) return it.customSchedule.trim();
  if (it.kind === "liquid") {
    const ml = num(it.amount) || 5;
    const times = num(it.timesPerDay) || 1;
    const chamoch = ml / 5;
    const chamochTxt = chamoch === 1 ? "১ চামচ" : `${chamoch} চামচ`;
    return `${chamochTxt} (${ml} ml) × ${times} বার/দিন`;
  }
  if (it.kind === "drops") {
    return `${num(it.amount) || 1} ফোঁটা × ${num(it.timesPerDay) || 1} বার/দিন`;
  }
  if (it.kind === "application") {
    return `${num(it.timesPerDay) || 1} বার লাগান/দিন`;
  }
  const n = it.doseCount ?? 3;
  const vals = [it.slots.morning, it.slots.noon, it.slots.evening, it.slots.night].slice(0, n);
  const labs = ["সকাল", "দুপুর", "বিকাল", "রাত"].slice(0, n).join("/");
  return `${vals.join("+")} (${labs})`;
}

function buildPdfHtml(p: PrescriptionPayload): string {
  const rows = p.items
    .map((raw, i) => {
      const it = new PayloadItem(raw);
      const tq = totalQty(it);
      const up = unitPrice(it.medicine);
      const tot = it.kind === "solid" && up != null ? up * tq : null;
      const priceCells = p.showPrices
        ? `<td>${up == null || it.kind !== "solid" ? "—" : up.toFixed(2)}</td><td>${tot == null ? "—" : tot.toFixed(2)}</td>`
        : "";
      return `<tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(it.medicine.brand)}<br/><small>${escapeHtml(it.medicine.generic ?? "")} ${escapeHtml(it.medicine.strength)}</small></td>
        <td>${escapeHtml(it.medicine.form)}</td>
        <td>${escapeHtml(scheduleText(it))}</td>
        <td>${escapeHtml(it.directions || "—")}</td>
        <td>${tq}${it.kind === "liquid" ? " ml" : it.kind === "drops" ? " drops" : it.kind === "application" ? " apply" : ""}</td>
        ${priceCells}
      </tr>`;
    })
    .join("");

  const grand = p.showPrices
    ? p.items.reduce((s, raw) => {
        const it = new PayloadItem(raw);
        const up = unitPrice(it.medicine);
        if (up == null || it.kind !== "solid") return s;
        return s + up * totalQty(it);
      }, 0)
    : null;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  body { font-family: -apple-system, "Hind Siliguri", sans-serif; padding: 28px; color: #10221f; }
  .head { display:flex; justify-content:space-between; border-bottom:2px solid #0f766e; padding-bottom:12px; margin-bottom:18px; }
  .title { font-size:22px; font-weight:700; color:#0f766e; margin:0; }
  .meta { font-size:12px; color:#5d6f6b; margin:2px 0; }
  table { width:100%; border-collapse:collapse; margin-top:12px; font-size:11.5px; }
  th,td { border:1px solid #e2e8e6; padding:6px 8px; text-align:left; vertical-align:top; }
  th { background:#d6f0ec; }
  .tot { text-align:right; font-weight:700; margin-top:10px; }
  .foot { margin-top:24px; font-size:11px; color:#8a9a96; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1 class="title">Osudh360 — Prescription</h1>
      <p class="meta">Date: ${escapeHtml(new Date().toLocaleDateString())}</p>
      ${p.patient ? `<p class="meta">Patient: ${escapeHtml(p.patient)}</p>` : ""}
    </div>
    <div>
      ${p.doctor ? `<p class="meta">Doctor: ${escapeHtml(p.doctor)}</p>` : ""}
      <p class="meta">${p.showPrices ? "Price list included" : "Doctor copy (no prices)"}</p>
    </div>
  </div>
  <table>
    <thead><tr>
      <th>#</th><th>Medicine</th><th>Form</th><th>Schedule</th><th>Directions</th><th>Total qty</th>
      ${p.showPrices ? "<th>Unit price</th><th>Subtotal</th>" : ""}
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${p.showPrices && grand != null ? `<p class="tot">Estimated total (tablets only): ${grand.toFixed(2)} BDT</p>` : ""}
  <p class="foot">Information only — not medical advice. Verify brand, strength and expiry on the pack before use.</p>
</body>
</html>`;
}

export default function PrescriptionsScreen() {
  const { theme } = useApp();

  const [view, setView] = useState<"list" | "edit" | "detail">("list");
  const [doctor, setDoctor] = useState("");
  const [patient, setPatient] = useState("");
  const [showPrices, setShowPrices] = useState(true);
  const [items, setItems] = useState<PrescriptionItem[]>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<LocalMedicine[]>([]);
  const [searching, setSearching] = useState(false);
  const [saved, setSaved] = useState<CloudPrescription[]>([]);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [openPayload, setOpenPayload] = useState<PrescriptionPayload | null>(null);

  const [forms, setForms] = useState<{ form: string }[]>([]);
  const [filterForm, setFilterForm] = useState("all");
  const [filterStrength, setFilterStrength] = useState("");
  const [filterPack, setFilterPack] = useState("");

  const loadSaved = async () => {
    setLoading(true);
    try {
      const res = await api.prescriptions.list();
      setSaved(
        res.items.map((r) => ({
          id: r.id,
          title: r.title,
          createdAt: r.updatedAt,
          payload: r.payload,
        })),
      );
    } catch {
      setSaved([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (view === "list") void loadSaved();
  }, [view]);

  useEffect(() => {
    setForms([
      "Tablet",
      "Capsule",
      "Syrup",
      "Suspension",
      "Drops",
      "Injection",
      "Cream",
      "Ointment",
      "Gel",
      "Powder",
      "Solution",
      "Sachet",
      "Spray",
      "Lotion",
    ].map((form) => ({ form })));
  }, []);

  useEffect(() => {
    if (search.trim().length < 2 && filterStrength.trim().length < 2 && filterForm === "all" && filterPack.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    searchMedicines({ q: search.trim() || undefined, form: filterForm === "all" ? undefined : filterForm, limit: 14 })
      .then((r) => {
        let items = r.items;
        if (filterStrength.trim()) {
          const needle = filterStrength.toLowerCase();
          items = items.filter((m) => (m.strength ?? "").toLowerCase().includes(needle));
        }
        if (filterPack.trim()) {
          const needle = filterPack.toLowerCase();
          items = items.filter((m) => `${m.packType ?? ""} ${m.packSize ?? ""}`.toLowerCase().includes(needle));
        }
        setResults(items);
      })
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, [search, filterForm, filterStrength, filterPack]);

  const resetDraft = () => {
    setDoctor("");
    setPatient("");
    setShowPrices(true);
    setItems([]);
    setSearch("");
    setResults([]);
    setFilterForm("all");
    setFilterStrength("");
    setFilterPack("");
  };

  const addItem = (m: LocalMedicine) => {
    if (items.some((it) => it.medicine.id === m.id)) return;
    const kind = guessKind(m);
    setItems((prev) => [
      ...prev,
      {
        medicine: m,
        kind,
        doseCount: 3,
        slots: { morning: kind === "solid" ? "1" : "0", noon: "0", evening: "0", night: kind === "solid" ? "1" : "0" },
        amount: kind === "liquid" ? "5" : kind === "drops" ? "1" : "1",
        timesPerDay: kind === "solid" ? "2" : "3",
        days: "5",
        directions: "",
        customSchedule: "",
        customQty: "",
      },
    ]);
    setSearch("");
    setResults([]);
  };

  const removeItem = (id: number) => setItems((prev) => prev.filter((it) => it.medicine.id !== id));

  const updateItem = (id: number, patch: Partial<PrescriptionItem>) => {
    setItems((prev) => prev.map((it) => (it.medicine.id === id ? { ...it, ...patch } : it)));
  };

  const updateSlots = (id: number, patch: Partial<DoseSlots>) => {
    setItems((prev) =>
      prev.map((it) =>
        it.medicine.id === id ? { ...it, slots: { ...it.slots, ...patch } } : it,
      ),
    );
  };

  const toPayload = (its: PrescriptionItem[]): PrescriptionPayload => ({
    doctor: doctor.trim(),
    patient: patient.trim(),
    showPrices,
    items: its.map((it) => {
      return {
        medicine: it.medicine,
        kind: it.kind,
        slots: it.kind === "solid" ? it.slots : undefined,
        doseCount: it.kind === "solid" ? it.doseCount : undefined,
        amount: it.kind === "liquid" || it.kind === "drops" || it.kind === "application" ? num(it.amount || it.timesPerDay) : undefined,
        timesPerDay: it.kind === "application" ? num(it.timesPerDay) : num(it.timesPerDay),
        days: Number(it.days) || 0,
        directions: it.directions.trim(),
        customSchedule: it.customSchedule.trim() || undefined,
        customQty: it.customSchedule.trim() ? num(it.customQty) : undefined,
      };
    }),
  });

  const saveCurrent = async () => {
    if (items.length === 0) {
      Alert.alert("Empty", "Add at least one medicine.");
      return;
    }
    const id = Date.now().toString();
    const payload = toPayload(items);
    const title = patient.trim() || `Prescription ${new Date().toLocaleDateString()}`;
    await api.prescriptions.save({ id, title, payload });
    resetDraft();
    setView("list");
  };

  const doPrint = async (payload: PrescriptionPayload) => {
    setPrinting(true);
    try {
      const html = buildPdfHtml(payload);
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
      } else {
        Alert.alert("Saved", `PDF saved to ${uri}`);
      }
    } catch (e) {
      Alert.alert("Print failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setPrinting(false);
    }
  };

  // ---------- List ----------
  if (view === "list") {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: theme.text }]}>Prescriptions</Text>
          <Pressable
            onPress={() => {
              resetDraft();
              setView("edit");
            }}
            style={[styles.primaryBtn, { backgroundColor: theme.accent }]}
          >
            <Text style={styles.primaryBtnText}>+ New</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {loading ? <ActivityIndicator color={theme.accent} /> : null}
          {!loading && saved.length === 0 ? (
            <Text style={[styles.muted, { color: theme.muted }]}>No prescriptions saved yet.</Text>
          ) : null}
          {saved.map((row) => (
            <View key={row.id} style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>{row.title}</Text>
              <Text style={[styles.muted, { color: theme.faint }]}>{new Date(row.createdAt).toLocaleString()}</Text>
              <View style={styles.actionRow}>
                <Pressable
                  onPress={() => {
                    setOpenPayload(row.payload as PrescriptionPayload);
                    setView("detail");
                  }}
                  style={[styles.smallBtn, { borderColor: theme.border }]}
                >
                  <Text style={[styles.smallBtnText, { color: theme.text }]}>View</Text>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    await api.prescriptions.remove(row.id);
                    await loadSaved();
                  }}
                  style={[styles.smallBtn, { borderColor: theme.border }]}
                >
                  <Text style={[styles.smallBtnText, { color: theme.danger }]}>Delete</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  // ---------- Detail ----------
  if (view === "detail" && openPayload) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => setView("list")} style={styles.backBtn}>
            <Text style={[styles.backText, { color: theme.accent }]}>‹ Back</Text>
          </Pressable>
          <Text style={[styles.title, { color: theme.text }]}>Prescription</Text>
          <View style={{ width: 60 }} />
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {openPayload.doctor ? <Text style={[styles.muted, { color: theme.text }]}>Doctor: {openPayload.doctor}</Text> : null}
          {openPayload.patient ? <Text style={[styles.muted, { color: theme.text }]}>Patient: {openPayload.patient}</Text> : null}
          {openPayload.items.map((raw, i) => {
            const it = new PayloadItem(raw);
            return (
              <View key={raw.medicine.id + i} style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>{raw.medicine.brand}</Text>
                <Text style={[styles.muted, { color: theme.muted }]}>
                  {raw.medicine.generic ?? ""} · {raw.medicine.strength} · {raw.medicine.form}
                </Text>
                <Text style={[styles.muted, { color: theme.text }]}>
                  {scheduleText(it)} · {it.days} days · {totalQty(it)} total
                </Text>
                {it.directions ? <Text style={[styles.muted, { color: theme.muted }]}>Directions: {it.directions}</Text> : null}
                {openPayload.showPrices && it.kind === "solid" ? (
                  <Text style={[styles.muted, { color: theme.accent }]}>
                    Subtotal: {subtotal(it) == null ? "—" : subtotal(it)!.toFixed(2)} BDT
                  </Text>
                ) : null}
              </View>
            );
          })}
          <Pressable
            disabled={printing}
            onPress={() => doPrint(openPayload)}
            style={[styles.primaryBtn, { backgroundColor: theme.accent, marginTop: space.md }]}
          >
            {printing ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Print / Save PDF</Text>}
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ---------- Edit ----------
  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => {
            resetDraft();
            setView("list");
          }}
          style={styles.backBtn}
        >
          <Text style={[styles.backText, { color: theme.accent }]}>‹ Back</Text>
        </Pressable>
        <Text style={[styles.title, { color: theme.text }]}>New prescription</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.label, { color: theme.muted }]}>Doctor</Text>
        <TextInput
          value={doctor}
          onChangeText={setDoctor}
          placeholder="Doctor name"
          placeholderTextColor={theme.faint}
          style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
        />

        <Text style={[styles.label, { color: theme.muted }]}>Patient</Text>
        <TextInput
          value={patient}
          onChangeText={setPatient}
          placeholder="Patient name"
          placeholderTextColor={theme.faint}
          style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
        />

        <View style={styles.row}>
          <Text style={[styles.label, { color: theme.muted }]}>Show prices</Text>
          <Pressable
            onPress={() => setShowPrices((v) => !v)}
            style={[styles.toggle, { backgroundColor: showPrices ? theme.accent : theme.card, borderColor: theme.border }]}
          >
            <Text style={{ color: showPrices ? "#fff" : theme.text, fontFamily: font.regular }}>{showPrices ? "On" : "Off (doctor)"}</Text>
          </Pressable>
        </View>

        <Text style={[styles.section, { color: theme.text }]}>Filters</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs }}>
          <Pressable
            onPress={() => setFilterForm("all")}
            style={[styles.filterChip, { backgroundColor: filterForm === "all" ? theme.accent : theme.card, borderColor: theme.border }]}
          >
            <Text style={{ color: filterForm === "all" ? "#fff" : theme.text, fontFamily: font.regular, fontSize: 12 }}>All types</Text>
          </Pressable>
          {forms.map((f) => (
            <Pressable
              key={f.form}
              onPress={() => setFilterForm(f.form)}
              style={[styles.filterChip, { backgroundColor: filterForm === f.form ? theme.accent : theme.card, borderColor: theme.border }]}
            >
              <Text style={{ color: filterForm === f.form ? "#fff" : theme.text, fontFamily: font.regular, fontSize: 12 }}>{f.form}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <TextInput
          value={filterStrength}
          onChangeText={setFilterStrength}
          placeholder="Filter by strength (e.g. 500)"
          placeholderTextColor={theme.faint}
          style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
        />
        <TextInput
          value={filterPack}
          onChangeText={setFilterPack}
          placeholder="Filter by pack (e.g. Strip, 10)"
          placeholderTextColor={theme.faint}
          style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
        />

        <Text style={[styles.section, { color: theme.text }]}>Add medicine</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search medicine to add…"
          placeholderTextColor={theme.faint}
          style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
        />
        {searching ? <ActivityIndicator color={theme.accent} /> : null}
        {results.map((m) => (
          <Pressable key={m.id} onPress={() => addItem(m)} style={[styles.resultRow, { borderColor: theme.border, backgroundColor: theme.card }]}>
            <Text style={[styles.resultName, { color: theme.text }]}>{m.brand}</Text>
            <Text style={[styles.resultSub, { color: theme.muted }]}>{m.generic ?? ""} · {m.strength} · {m.form}</Text>
          </Pressable>
        ))}

        <Text style={[styles.section, { color: theme.text }]}>Medicines</Text>
        {items.map((it) => (
          <View key={it.medicine.id} style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={styles.row}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>{it.medicine.brand}</Text>
              <Pressable onPress={() => removeItem(it.medicine.id)}>
                <Text style={{ color: theme.danger }}>✕</Text>
              </Pressable>
            </View>
            <Text style={[styles.muted, { color: theme.muted }]}>{it.medicine.generic ?? ""} · {it.medicine.strength} · {it.medicine.form}</Text>

            {/* Custom schedule overrides everything */}
            <Text style={[styles.label, { color: theme.muted }]}>Custom schedule (optional)</Text>
            <TextInput
              value={it.customSchedule}
              onChangeText={(v) => updateItem(it.medicine.id, { customSchedule: v })}
              placeholder="e.g. 1/2 tablet morning & night, SOS"
              placeholderTextColor={theme.faint}
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bg }]}
            />
            {it.customSchedule.trim() ? (
              <TextInput
                value={it.customQty}
                onChangeText={(v) => updateItem(it.medicine.id, { customQty: v })}
                placeholder="Total quantity"
                keyboardType="numeric"
                placeholderTextColor={theme.faint}
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bg }]}
              />
            ) : null}

            {!it.customSchedule.trim() && (it.kind === "solid") ? (
              <View style={styles.row}>
                <Text style={[styles.label, { color: theme.muted, marginTop: 0 }]}>Doses/day</Text>
                {[2, 3, 4].map((n) => (
                  <Pressable key={n} onPress={() => updateItem(it.medicine.id, { doseCount: n })} style={[styles.filterChip, { backgroundColor: it.doseCount === n ? theme.accent : theme.card, borderColor: theme.border }]}>
                    <Text style={{ color: it.doseCount === n ? "#fff" : theme.text, fontFamily: font.regular, fontSize: 12 }}>{n}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {!it.customSchedule.trim() && (it.kind === "solid") ? (
              <View style={styles.row}>
                {SLOT_LABELS.slice(0, it.doseCount).map((lab, idx) => {
                  const key = (["morning", "noon", "evening", "night"] as (keyof DoseSlots)[])[idx];
                  return (
                    <View key={key} style={styles.fieldCol}>
                      <Text style={[styles.label, { color: theme.muted }]}>{lab}</Text>
                      <TextInput
                        value={it.slots[key]}
                        onChangeText={(v) => updateSlots(it.medicine.id, { [key]: v })}
                        keyboardType="decimal-pad"
                        style={[styles.smallInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bg }]}
                      />
                    </View>
                  );
                })}
                <View style={styles.fieldCol}>
                  <Text style={[styles.label, { color: theme.muted }]}>Days</Text>
                  <TextInput
                    value={it.days}
                    onChangeText={(v) => updateItem(it.medicine.id, { days: v })}
                    keyboardType="numeric"
                    style={[styles.smallInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bg }]}
                  />
                </View>
              </View>
            ) : null}

            {!it.customSchedule.trim() && it.kind !== "solid" ? (
              <View style={styles.row}>
                <View style={styles.fieldCol}>
                  <Text style={[styles.label, { color: theme.muted }]}>
                    {it.kind === "liquid" ? "ml/dose" : it.kind === "drops" ? "Drops/dose" : it.kind === "application" ? "Times/day" : "Qty"}
                  </Text>
                  <TextInput
                    value={it.amount}
                    onChangeText={(v) => updateItem(it.medicine.id, { amount: v })}
                    keyboardType="decimal-pad"
                    style={[styles.smallInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bg }]}
                  />
                </View>
                {(it.kind === "liquid" || it.kind === "drops") ? (
                  <View style={styles.fieldCol}>
                    <Text style={[styles.label, { color: theme.muted }]}>Times/day</Text>
                    <TextInput
                      value={it.timesPerDay}
                      onChangeText={(v) => updateItem(it.medicine.id, { timesPerDay: v })}
                      keyboardType="numeric"
                      style={[styles.smallInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bg }]}
                    />
                  </View>
                ) : null}
                <View style={styles.fieldCol}>
                  <Text style={[styles.label, { color: theme.muted }]}>Days</Text>
                  <TextInput
                    value={it.days}
                    onChangeText={(v) => updateItem(it.medicine.id, { days: v })}
                    keyboardType="numeric"
                    style={[styles.smallInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bg }]}
                  />
                </View>
                <View style={styles.fieldCol}>
                  <Text style={[styles.label, { color: theme.muted }]}>Total</Text>
                  <Text style={[styles.totalText, { color: theme.accent }]}>{totalQty(it)}</Text>
                </View>
              </View>
            ) : null}

            <Text style={[styles.muted, { color: theme.muted }]}>
              Schedule: {scheduleText(it)} · {totalQty(it)} total · {it.days} days
            </Text>
            <TextInput
              value={it.directions}
              onChangeText={(v) => updateItem(it.medicine.id, { directions: v })}
              placeholder="Directions (e.g. After food, খাওয়ার পরে, SOS, external use only)"
              placeholderTextColor={theme.faint}
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bg }]}
            />
            {it.kind === "solid" && unitPrice(it.medicine) != null ? (
              <Text style={[styles.muted, { color: theme.accent }]}>
                Est. cost: {subtotal(it) == null ? "—" : subtotal(it)!.toFixed(2)} BDT
              </Text>
            ) : null}
          </View>
        ))}

        <View style={styles.actionRow}>
          <Pressable onPress={saveCurrent} style={[styles.primaryBtn, { backgroundColor: theme.accent, flex: 1 }]}>
            <Text style={styles.primaryBtnText}>Save prescription</Text>
          </Pressable>
          <Pressable
            disabled={items.length === 0 || printing}
            onPress={() => {
              const payload: PrescriptionPayload = toPayload(items);
              void doPrint(payload);
            }}
            style={[styles.secondaryBtn, { borderColor: theme.border, flex: 1 }]}
          >
            {printing ? <ActivityIndicator color={theme.accent} /> : <Text style={[styles.secondaryBtnText, { color: theme.accent }]}>Print / PDF</Text>}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

class PayloadItem implements PrescriptionItem {
  medicine: LocalMedicine;
  kind: DoseKind;
  slots: DoseSlots;
  doseCount: number;
  amount: string;
  timesPerDay: string;
  days: string;
  directions: string;
  customSchedule: string;
  customQty: string;
  constructor(p: PrescriptionPayloadItem) {
    this.medicine = p.medicine;
    this.kind = p.kind;
    this.slots = p.slots ?? { morning: "1", noon: "0", evening: "0", night: "1" };
    this.doseCount = p.doseCount ?? 3;
    this.amount = String(p.amount ?? (p.kind === "drops" ? 1 : p.kind === "liquid" ? 5 : 1));
    this.timesPerDay = String(p.timesPerDay ?? (p.kind === "solid" ? 2 : 3));
    this.days = String(p.days ?? 0);
    this.directions = p.directions ?? "";
    this.customSchedule = p.customSchedule ?? "";
    this.customQty = String(p.customQty ?? 0);
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, paddingVertical: space.md },
  title: { fontSize: 20, fontFamily: font.semibold },
  backBtn: { width: 60 },
  backText: { fontSize: 15, fontFamily: font.regular },
  content: { padding: space.lg, paddingBottom: space.xxl, gap: space.md },
  label: { fontSize: 12, fontFamily: font.regular, marginBottom: 4, marginTop: space.sm },
  section: { fontSize: 16, fontFamily: font.semibold, marginTop: space.md },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, fontSize: 14, fontFamily: font.regular },
  smallInput: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.sm, paddingVertical: 6, fontSize: 13, fontFamily: font.regular, width: 58 },
  primaryBtn: { paddingVertical: space.md, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  primaryBtnText: { color: "#fff", fontSize: 14, fontFamily: font.semibold },
  secondaryBtn: { paddingVertical: space.md, borderRadius: radius.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  secondaryBtnText: { fontSize: 14, fontFamily: font.semibold },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: 6 },
  cardTitle: { fontSize: 15, fontFamily: font.semibold },
  muted: { fontSize: 12, fontFamily: font.regular },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm, flexWrap: "wrap" },
  fieldCol: { alignItems: "flex-start", gap: 4 },
  totalText: { fontSize: 13, fontFamily: font.semibold },
  toggle: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1 },
  filterChip: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1 },
  resultRow: { borderWidth: 1, borderRadius: radius.md, padding: space.sm, gap: 2 },
  resultName: { fontSize: 14, fontFamily: font.semibold },
  resultSub: { fontSize: 11, fontFamily: font.regular },
  actionRow: { flexDirection: "row", gap: space.sm, marginTop: space.md },
  smallBtn: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 },
  smallBtnText: { fontSize: 12, fontFamily: font.regular },
});