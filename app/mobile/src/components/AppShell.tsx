import React, { useEffect, useRef, useState } from "react";
import {
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useWorkspace } from "../context/WorkspaceContext";
import { navigation, pageTitles } from "../data/navigation";
import { Badge, Brand, Button, Card, Icon } from "./ui";
import { colors, ui } from "../theme";
import type { Page } from "../types";

const tour: { title: string; body: string; page: Page }[] = [
  {
    title: "The Problem",
    body: "A persistent nighttime-light change is an observation—not an explanation. Select a candidate to begin.",
    page: "overview",
  },
  {
    title: "Multi-Satellite Evidence",
    body: "Black Marble, TROPOMI, meteorology, and Sentinel-2 contribute evidence at different spatial supports.",
    page: "data",
  },
  {
    title: "Event Investigation",
    body: "Review historical context, independent records, and missing evidence.",
    page: "investigation",
  },
  {
    title: "Wind-Aware Assessment",
    body: "Screen wind alignment alongside atmospheric footprints and competing sources.",
    page: "plume",
  },
  {
    title: "CCTF Attribution",
    body: "Supporting, missing, and inconclusive evidence remain visible.",
    page: "attribution",
  },
  {
    title: "Decision Support",
    body: "Export a screening report with provenance and explicit uncertainty.",
    page: "reports",
  },
];
export function AppShell({ children }: { children: React.ReactNode }) {
  const { page, go, logout, profile, toast, select } = useWorkspace();
  const { width } = useWindowDimensions();
  const wide = width >= 1050;
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [step, setStep] = useState<number | null>(null);
  const scroll = useRef<ScrollView>(null);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [page]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (drawer) {
          setDrawer(false);
          return true;
        }
        if (step !== null) {
          setStep(null);
          return true;
        }
        if (page !== "overview") {
          go("overview");
          return true;
        }
        return false;
      },
    );
    return () => subscription.remove();
  }, [drawer, step, page, go]);
  const navigate = (next: Page) => {
    go(next);
    setDrawer(false);
  };
  const tourStep = (index: number) => {
    setStep(index);
    select("DEMO-002");
    navigate(tour[index].page);
  };
  const compact = wide && collapsed;
  const sidebar = (
    <View style={{ flex: 1, backgroundColor: colors.panel }}>
      <View
        style={{
          padding: compact ? 15 : 22,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        {compact ? (
          <Icon name="planet" color={colors.cyan} size={30} />
        ) : (
          <Brand />
        )}
      </View>
      <ScrollView contentContainerStyle={{ padding: 12, gap: 21 }}>
        {navigation.map((group) => (
          <View key={group.group} style={{ gap: 4 }}>
            {!compact && (
              <Text
                style={[
                  ui.label,
                  { color: colors.dim, fontSize: 9, padding: 10 },
                ]}
              >
                {group.group}
              </Text>
            )}
            {group.items.map((item) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: page === item.id }}
                key={item.id}
                onPress={() => navigate(item.id)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  gap: 12,
                  alignItems: "center",
                  minHeight: 42,
                  padding: 11,
                  borderRadius: 7,
                  backgroundColor:
                    page === item.id
                      ? colors.cyan + "18"
                      : pressed
                        ? "#ffffff08"
                        : "transparent",
                })}
              >
                <Icon
                  name={item.icon}
                  size={17}
                  color={page === item.id ? colors.cyan : colors.muted}
                />
                {!compact && (
                  <Text
                    style={{
                      color: page === item.id ? "#7dd3fc" : colors.muted,
                      fontSize: 11,
                      flex: 1,
                    }}
                  >
                    {item.label}
                  </Text>
                )}
                {page === item.id && !compact && (
                  <View
                    style={{
                      width: 5,
                      height: 5,
                      backgroundColor: colors.cyan,
                      borderRadius: 3,
                    }}
                  />
                )}
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
      <View
        style={{
          padding: 14,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          gap: 10,
        }}
      >
        <Button
          label={compact ? "Demo" : "Guided demonstration"}
          secondary
          icon={compact ? undefined : "play-outline"}
          onPress={() => tourStep(0)}
        />
        {wide && (
          <Button
            label={compact ? "Expand" : "Collapse sidebar"}
            secondary
            onPress={() => setCollapsed(!collapsed)}
          />
        )}
        {!wide && (
          <Button
            label="Close menu"
            secondary
            onPress={() => setDrawer(false)}
          />
        )}
      </View>
    </View>
  );
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: colors.bg }}>
      {wide && (
        <View
          style={{
            width: compact ? 92 : 252,
            borderRightWidth: 1,
            borderRightColor: colors.border,
          }}
        >
          {sidebar}
        </View>
      )}
      <Modal
        visible={!wide && drawer}
        animationType="slide"
        transparent
        onRequestClose={() => setDrawer(false)}
      >
        <View
          style={{
            flex: 1,
            flexDirection: "row",
            backgroundColor: "#020711bb",
          }}
        >
          <View style={{ width: Math.min(300, width - 45) }}>{sidebar}</View>
          <Pressable
            style={{ flex: 1 }}
            accessibilityLabel="Close navigation"
            onPress={() => setDrawer(false)}
          />
        </View>
      </Modal>
      <View style={{ flex: 1 }}>
        <View
          style={{
            minHeight: 68,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: wide ? 28 : 16,
            gap: 14,
          }}
        >
          {!wide && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open navigation"
              onPress={() => setDrawer(true)}
              style={{ padding: 8 }}
            >
              <Icon name="menu-outline" size={24} />
            </Pressable>
          )}
          <View style={{ flex: 1 }}>
            {wide ? (
              <Text style={ui.small}>
                Workspace ›{" "}
                <Text style={{ color: colors.muted }}>
                  {pageTitles[page][0]}
                </Text>
              </Text>
            ) : (
              <Text
                style={{ color: colors.text, fontSize: 13, fontWeight: "700" }}
              >
                CSTAR<Text style={{ color: colors.cyan }}>—ENERGY</Text>
              </Text>
            )}
          </View>
          {width > 600 && <Badge tone="amber">DEMONSTRATION</Badge>}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Research alerts"
            onPress={() => navigate("alerts")}
            style={{ padding: 8 }}
          >
            <Icon name="notifications-outline" />
          </Pressable>
          {wide && (
            <View style={ui.row}>
              <View
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  backgroundColor: colors.cyan + "20",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: colors.cyan, fontSize: 10 }}>
                  {profile.name
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")}
                </Text>
              </View>
              <View>
                <Text style={[ui.text, { fontSize: 11 }]}>{profile.name}</Text>
                <Text style={[ui.small, { fontSize: 9 }]}>
                  Research Analyst
                </Text>
              </View>
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            onPress={logout}
            style={{ padding: 8 }}
          >
            <Icon name="log-out-outline" />
          </Pressable>
        </View>
        <ScrollView
          ref={scroll}
          contentContainerStyle={{
            padding: wide ? 28 : 18,
            paddingBottom: step !== null ? 290 : 36,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={{
              width: "100%",
              maxWidth: 1600,
              alignSelf: "center",
              gap: 23,
            }}
          >
            <View style={{ gap: 8 }}>
              <Text
                accessibilityRole="header"
                style={[ui.heading, { fontSize: wide ? 25 : 23 }]}
              >
                {pageTitles[page][0]}
              </Text>
              <Text style={ui.muted}>{pageTitles[page][1]}</Text>
            </View>
            {children}
            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: colors.border,
                paddingTop: 16,
              }}
            >
              <Text style={ui.small}>
                CSTAR—ENERGY · Research Screening Output · Synthetic
                demonstration data
              </Text>
            </View>
          </View>
        </ScrollView>
      </View>
      {!!toast && (
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{
            position: "absolute",
            bottom: 22,
            left: wide ? 280 : 20,
            right: 20,
            alignItems: "center",
            pointerEvents: "none",
          }}
        >
          <View
            style={{
              maxWidth: 600,
              padding: 16,
              borderRadius: 12,
              borderColor: colors.green + "66",
              borderWidth: 1,
              backgroundColor: colors.panel,
            }}
          >
            <Text style={{ color: colors.green, fontSize: 12 }}>{toast}</Text>
          </View>
        </View>
      )}
      {step !== null && (
        <View
          style={{
            position: "absolute",
            bottom: 18,
            right: 18,
            width: Math.min(410, width - 36),
          }}
        >
          <Card
            title={`Scene ${step + 1} — ${tour[step].title}`}
            action={
              <Pressable
                accessibilityLabel="Close guided tour"
                onPress={() => setStep(null)}
              >
                <Icon name="close" />
              </Pressable>
            }
          >
            <Badge>GUIDED DEMO · {step + 1}/6</Badge>
            <Text style={ui.muted}>{tour[step].body}</Text>
            <View style={[ui.row, { justifyContent: "space-between" }]}>
              <Button
                label="Back"
                secondary
                disabled={step === 0}
                onPress={() => tourStep(Math.max(0, step - 1))}
              />
              <Button
                label={step === 5 ? "Finish" : "Next"}
                onPress={() =>
                  step === 5 ? setStep(null) : tourStep(step + 1)
                }
              />
            </View>
          </Card>
        </View>
      )}
    </View>
  );
}
