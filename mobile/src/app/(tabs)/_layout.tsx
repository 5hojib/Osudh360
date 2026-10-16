import React from "react";
import { Tabs } from "expo-router";
import { Text, View, type ColorValue } from "react-native";
import { useApp } from "../../store";
import { font } from "../../theme";
import { useT } from "../../lib/i18n";

/**
 * Tiny text-based tab icons.
 *
 * A vector icon font would mean another dependency and asset bundle for four
 * glyphs; these read fine at 20px and inherit the theme colour automatically.
 */
function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 18, color, fontFamily: font.regular }}>{glyph}</Text>
    </View>
  );
}

export default function TabsLayout() {
  const { theme } = useApp();
  const t = useT();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.bg },
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: font.semibold, fontSize: 18, color: theme.text },
        tabBarStyle: {
          backgroundColor: theme.card,
          borderTopColor: theme.border,
          height: 62,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.faint,
        tabBarLabelStyle: { fontFamily: font.regular, fontSize: 11 },
        sceneStyle: { backgroundColor: theme.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabHome"),
          tabBarIcon: ({ color }) => <TabIcon glyph="⌕" color={color} />,
        }}
      />
      <Tabs.Screen
        name="generics"
        options={{
          title: t("tabGenerics"),
          tabBarIcon: ({ color }) => <TabIcon glyph="◈" color={color} />,
        }}
      />
      <Tabs.Screen
        name="categories"
        options={{
          title: t("tabCategories"),
          tabBarIcon: ({ color }) => <TabIcon glyph="▤" color={color} />,
        }}
      />
      <Tabs.Screen
        name="prescriptions"
        options={{
          title: "Prescriptions",
          tabBarIcon: ({ color }) => <TabIcon glyph="Rx" color={color} />,
        }}
      />
      <Tabs.Screen
        name="about"
        options={{
          title: t("tabAbout"),
          tabBarIcon: ({ color }) => <TabIcon glyph="ⓘ" color={color} />,
        }}
      />
    </Tabs>
  );
}