import React, { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, ui } from "../theme";
import type { IconName } from "../data/navigation";

export function Icon({
  name,
  color = colors.muted,
  size = 18,
}: {
  name: IconName;
  color?: string;
  size?: number;
}) {
  return <Ionicons name={name} color={color} size={size} />;
}
export function Button({
  label,
  onPress,
  icon,
  secondary,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  secondary?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary ? styles.secondary : styles.primary,
        pressed && { opacity: 0.8 },
        disabled && { opacity: 0.4 },
        style,
      ]}
    >
      {icon && (
        <Icon
          name={icon}
          size={16}
          color={secondary ? colors.cyan : colors.bg}
        />
      )}
      <Text
        style={{
          color: secondary ? colors.text : colors.bg,
          fontSize: 12,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function Badge({
  children,
  tone = "cyan",
}: {
  children: React.ReactNode;
  tone?: "cyan" | "green" | "amber" | "rose" | "dim";
}) {
  return (
    <View
      style={[
        styles.badge,
        {
          borderColor: colors[tone] + "44",
          backgroundColor: colors[tone] + "12",
        },
      ]}
    >
      <Text style={{ color: colors[tone], fontSize: 10, fontWeight: "600" }}>
        {children}
      </Text>
    </View>
  );
}
export function Status({ value }: { value: string }) {
  const tone = /Good|Ready|Reviewed|Supporting|Active/.test(value)
    ? "green"
    : /Insufficient|Missing|Unresolved/.test(value)
      ? "rose"
      : /Partial|Pending|Additional|Inconclusive|Moderate/.test(value)
        ? "amber"
        : "cyan";
  return <Badge tone={tone}>● {value}</Badge>;
}
export function Card({
  title,
  subtitle,
  action,
  children,
  style,
}: {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.card, style]}>
      {title && (
        <View style={styles.cardHeader}>
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={ui.title}>{title}</Text>
            {subtitle && <Text style={ui.small}>{subtitle}</Text>}
          </View>
          {action}
        </View>
      )}
      <View style={{ padding: 18, gap: 14 }}>{children}</View>
    </View>
  );
}
export function Field({
  label,
  ...props
}: TextInputProps & { label?: string }) {
  return (
    <View style={{ gap: 8 }}>
      {label && <Text style={ui.muted}>{label}</Text>}
      <TextInput
        accessibilityLabel={label || props.placeholder}
        placeholderTextColor={colors.dim}
        {...props}
        style={[ui.input, props.style]}
      />
    </View>
  );
}
export function Select({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      {label && <Text style={ui.small}>{label}</Text>}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label || "Select"}: ${value}`}
        onPress={() => setOpen(true)}
        style={[ui.input, ui.row, { justifyContent: "space-between" }]}
      >
        <Text style={[ui.text, { flexShrink: 1 }]}>{value}</Text>
        <Icon name="chevron-down" size={14} />
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.overlay}>
          <Pressable
            accessibilityLabel="Close options"
            onPress={() => setOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              styles.card,
              { width: "100%", maxWidth: 480, maxHeight: "80%", padding: 16 },
            ]}
          >
            <Text style={[ui.title, { marginBottom: 12 }]}>
              {label || "Select an option"}
            </Text>
            <ScrollView>
              {options.map((option) => (
                <Pressable
                  accessibilityRole="button"
                  key={option}
                  onPress={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                  style={[
                    styles.option,
                    option === value && { backgroundColor: colors.cyan + "15" },
                  ]}
                >
                  <Text style={[ui.text, { flex: 1 }]}>{option}</Text>
                  {option === value && (
                    <Icon name="checkmark" color={colors.cyan} />
                  )}
                </Pressable>
              ))}
            </ScrollView>
            <Button label="Cancel" secondary onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}
export function Notice({
  children,
  warning = false,
}: {
  children: React.ReactNode;
  warning?: boolean;
}) {
  return (
    <View
      style={[
        ui.row,
        {
          alignItems: "flex-start",
          padding: 14,
          borderWidth: 1,
          borderColor: (warning ? colors.amber : colors.cyan) + "30",
          backgroundColor: (warning ? colors.amber : colors.cyan) + "09",
          borderRadius: 9,
        },
      ]}
    >
      <Icon
        name={
          warning ? "information-circle-outline" : "shield-checkmark-outline"
        }
        color={warning ? colors.amber : colors.cyan}
      />
      <Text style={[ui.muted, { flex: 1, fontSize: 11 }]}>{children}</Text>
    </View>
  );
}
export function Brand() {
  return (
    <View style={ui.row}>
      <View
        style={{ backgroundColor: colors.cyan, borderRadius: 11, padding: 9 }}
      >
        <Icon name="planet-outline" color={colors.bg} size={22} />
      </View>
      <View>
        <Text
          style={{
            color: colors.text,
            fontSize: 15,
            fontWeight: "800",
            letterSpacing: 1,
          }}
        >
          CSTAR<Text style={{ color: colors.cyan }}>—ENERGY</Text>
        </Text>
        <Text
          style={{
            color: colors.dim,
            fontSize: 8,
            letterSpacing: 2,
            marginTop: 5,
          }}
        >
          SATELLITE INTELLIGENCE
        </Text>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  button: {
    minHeight: 42,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
  },
  primary: { backgroundColor: colors.cyan, borderColor: colors.cyan },
  secondary: { backgroundColor: colors.panel, borderColor: colors.border },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 30,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  card: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    padding: 18,
  },
  overlay: {
    flex: 1,
    backgroundColor: "#020711dd",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  option: {
    padding: 14,
    borderRadius: 8,
    flexDirection: "row",
    gap: 12,
    marginBottom: 6,
  },
});
