import React, { useState } from "react";
import {
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Badge, Brand, Button, Field, Icon, Notice } from "../components/ui";
import { useWorkspace } from "../context/WorkspaceContext";
import { colors, ui } from "../theme";

export function LoginScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= 1000;
  const { login } = useWorkspace();
  const [email, setEmail] = useState("analyst@cstar.demo");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [remember, setRemember] = useState(true);
  const [help, setHelp] = useState(false);
  const [error, setError] = useState("");
  const submit = () => {
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      password.length < 4
    ) {
      setError(
        "Enter a valid email and a demo password of at least 4 characters.",
      );
      return;
    }
    setError("");
    login(remember);
  };
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View
        style={{ flex: 1, flexDirection: "row", backgroundColor: colors.bg }}
      >
        {wide && (
          <ImageBackground
            source={require("../../assets/city-night.jpg")}
            style={{ flex: 1.15 }}
            imageStyle={{ opacity: 0.55 }}
          >
            <LinearGradient
              colors={["#07111f55", "#07111fbb", "#07111f"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ flex: 1, padding: 48, justifyContent: "space-between" }}
            >
              <Brand />
              <View style={{ gap: 26, maxWidth: 580 }}>
                <Badge>✦ NASA SPACE APPS DEMONSTRATION</Badge>
                <Text
                  style={{
                    color: colors.text,
                    fontSize: 48,
                    lineHeight: 54,
                    fontWeight: "600",
                    letterSpacing: -1.7,
                  }}
                >
                  Beyond monitoring.{"\n"}
                  <Text style={{ color: "#7dd3fc" }}>
                    Understanding change.
                  </Text>
                </Text>
                <Text
                  style={{ color: "#cbd5e1", fontSize: 16, lineHeight: 28 }}
                >
                  A multi-satellite research workspace for investigating
                  plausible causes of persistent lighting, infrastructure, and
                  industrial transitions.
                </Text>
                <View style={ui.row}>
                  {[
                    ["4", "SYNTHETIC EVENTS"],
                    ["5", "EVIDENCE SOURCES"],
                    ["CCTF", "TRANSPARENT METHOD"],
                  ].map(([value, label]) => (
                    <View
                      key={label}
                      style={{
                        flex: 1,
                        backgroundColor: "#07111f99",
                        borderColor: "#ffffff18",
                        borderWidth: 1,
                        padding: 16,
                        borderRadius: 12,
                        gap: 6,
                      }}
                    >
                      <Text
                        style={{
                          color: colors.text,
                          fontSize: 23,
                          fontWeight: "600",
                        }}
                      >
                        {value}
                      </Text>
                      <Text
                        style={{
                          color: colors.muted,
                          fontSize: 9,
                          letterSpacing: 0.6,
                        }}
                      >
                        {label}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
              <Text style={ui.small}>
                Photo: Dennis Kummer / Unsplash · Synthetic demonstration data
              </Text>
            </LinearGradient>
          </ImageBackground>
        )}
        <ScrollView
          style={{ flex: wide ? 0.85 : 1 }}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            padding: wide ? 48 : 24,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={{
              width: "100%",
              maxWidth: 440,
              alignSelf: "center",
              gap: 24,
            }}
          >
            {!wide && (
              <View style={{ marginBottom: 24 }}>
                <Brand />
              </View>
            )}
            <View style={{ gap: 14 }}>
              <Badge tone="amber">◇ RESEARCH PROTOTYPE</Badge>
              <Text
                style={{
                  color: colors.text,
                  fontSize: 32,
                  fontWeight: "600",
                  letterSpacing: -0.6,
                }}
              >
                Welcome back
              </Text>
              <Text style={ui.muted}>
                Sign in to the CSTAR-Energy demonstration workspace.
              </Text>
            </View>
            <Field
              label="Email address"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={{ gap: 8 }}>
              <Text style={ui.muted}>Password</Text>
              <View>
                <Field
                  accessibilityLabel="Demo password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Use any 4+ characters"
                  secureTextEntry={!visible}
                  onSubmitEditing={submit}
                  style={{ paddingRight: 50 }}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    visible ? "Hide password" : "Show password"
                  }
                  onPress={() => setVisible(!visible)}
                  style={{
                    position: "absolute",
                    right: 0,
                    top: 0,
                    padding: 14,
                  }}
                >
                  <Icon name={visible ? "eye-off-outline" : "eye-outline"} />
                </Pressable>
              </View>
            </View>
            <View
              style={[
                ui.row,
                { justifyContent: "space-between", flexWrap: "wrap" },
              ]}
            >
              <View style={ui.row}>
                <Switch
                  accessibilityLabel="Remember this demo session"
                  value={remember}
                  onValueChange={setRemember}
                  trackColor={{ true: colors.cyan, false: colors.border }}
                />
                <Text style={ui.small}>Remember this session</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => setHelp(!help)}
              >
                <Text style={{ color: colors.cyan, fontSize: 12 }}>
                  Demo access help
                </Text>
              </Pressable>
            </View>
            {help && (
              <Notice>
                Use any valid email and any password with 4 or more characters,
                or choose Open demo workspace. This is local demo access; no
                credentials are sent or stored.
              </Notice>
            )}
            {!!error && (
              <Text
                accessibilityRole="alert"
                style={{ color: colors.rose, fontSize: 12 }}
              >
                {error}
              </Text>
            )}
            <Button
              label="Sign in to workspace"
              icon="arrow-forward"
              onPress={submit}
            />
            <View style={ui.row}>
              <View style={[ui.divider, { flex: 1 }]} />
              <Text style={ui.small}>OR EXPLORE THE PROTOTYPE</Text>
              <View style={[ui.divider, { flex: 1 }]} />
            </View>
            <Button
              label="Open demo workspace"
              secondary
              icon="play-outline"
              onPress={() => login(remember)}
            />
            <Notice warning>
              Research demonstration only. All events and satellite observations
              in this workspace are synthetic. No live satellite feeds or secure
              authentication are connected.
            </Notice>
            <Text style={[ui.small, { textAlign: "center" }]}>
              CSTAR—ENERGY · Multi-satellite transition intelligence
            </Text>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
