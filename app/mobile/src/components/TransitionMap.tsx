import React from "react";
import { View, Text, Pressable } from "react-native";
import Svg, {
  Path,
  Line,
  Rect,
  Ellipse,
  Text as SvgText,
} from "react-native-svg";
import type { TransitionEvent } from "../types";
import { colors, ui } from "../theme";

export function TransitionMap({
  events,
  selected,
  onSelect,
  plume = true,
  cells = true,
  height = 340,
}: {
  events: TransitionEvent[];
  selected?: string;
  onSelect: (event: TransitionEvent) => void;
  plume?: boolean;
  cells?: boolean;
  height?: number;
}) {
  return (
    <View style={{ gap: 12 }}>
      <View
        style={{
          height,
          backgroundColor: "#0a1824",
          borderRadius: 8,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: "#1e3543",
        }}
      >
        <Svg
          width="100%"
          height="100%"
          viewBox="0 0 800 430"
          preserveAspectRatio="none"
        >
          <Rect width={800} height={430} fill="#0c1b29" />
          {Array.from({ length: 18 }, (_, i) => (
            <Line
              key={"v" + i}
              x1={i * 50}
              x2={i * 50}
              y1={0}
              y2={430}
              stroke="#213646"
              strokeWidth={0.5}
            />
          ))}
          {Array.from({ length: 10 }, (_, i) => (
            <Line
              key={"h" + i}
              x1={0}
              x2={800}
              y1={i * 48}
              y2={i * 48}
              stroke="#213646"
              strokeWidth={0.5}
            />
          ))}
          <Path
            d="M-20 110 C170 30 205 270 370 225 S560 320 820 170"
            stroke="#133e52"
            strokeWidth={28}
            fill="none"
          />
          <Path
            d="M-20 110 C170 30 205 270 370 225 S560 320 820 170"
            stroke="#1d5469"
            strokeWidth={2}
            fill="none"
          />
          <Path
            d="M0 340 L800 60 M140 0 L560 430 M0 180 L800 370 M370 0 L330 430"
            stroke="#52606a"
            strokeWidth={3}
            fill="none"
            opacity={0.45}
          />
          <Path
            d="M0 340 L800 60 M140 0 L560 430"
            stroke="#b5ac7a"
            strokeWidth={1}
            fill="none"
            opacity={0.35}
          />
          {cells &&
            Array.from({ length: 62 }, (_, i) => (
              <Rect
                key={i}
                x={80 + ((i * 83) % 630)}
                y={50 + ((i * 61) % 320)}
                width={8 + (i % 3) * 5}
                height={8 + (i % 2) * 5}
                fill={i % 3 ? "#647a65" : "#e2b968"}
                opacity={0.17 + (i % 4) * 0.06}
              />
            ))}
          {plume && (
            <>
              <Ellipse
                cx={580}
                cy={225}
                rx={125}
                ry={65}
                rotation={-22}
                origin="580,225"
                fill="#fbbf24"
                fillOpacity={0.08}
                stroke="#fbbf24"
                strokeOpacity={0.32}
                strokeDasharray="7 5"
              />
              <Ellipse
                cx={645}
                cy={185}
                rx={110}
                ry={55}
                rotation={-22}
                origin="645,185"
                fill="#fbbf24"
                fillOpacity={0.04}
                stroke="#fbbf24"
                strokeOpacity={0.18}
                strokeDasharray="7 5"
              />
            </>
          )}
          <SvgText x={85} y={70} fill="#627b8b" fontSize={13} letterSpacing={3}>
            NORTH DISTRICT
          </SvgText>
          <SvgText
            x={490}
            y={360}
            fill="#627b8b"
            fontSize={13}
            letterSpacing={3}
          >
            EASTPORT
          </SvgText>
          <SvgText x={260} y={390} fill="#627b8b" fontSize={11}>
            AURELIA PILOT LOCALITY
          </SvgText>
        </Svg>
        <View
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            backgroundColor: "#07111fe8",
            padding: 8,
            borderRadius: 5,
          }}
        >
          <Text style={[ui.small, { color: colors.muted }]}>
            SYNTHETIC SPATIAL VIEW
          </Text>
        </View>
        <View style={{ position: "absolute", top: 12, right: 14 }}>
          <Text
            style={{ color: colors.muted, textAlign: "center", fontSize: 10 }}
          >
            N{"\n"}↑
          </Text>
        </View>
        {events.map((event) => (
          <Pressable
            key={event.id}
            accessibilityRole="button"
            accessibilityLabel={`Investigate ${event.id}, ${event.location}`}
            onPress={() => onSelect(event)}
            style={{
              position: "absolute",
              left: `${event.coords[0]}%`,
              top: `${event.coords[1]}%`,
              marginLeft: -22,
              marginTop: -22,
              width: 44,
              height: 44,
              borderRadius: 22,
              borderColor: event.color,
              borderWidth: selected === event.id ? 2 : 1,
              backgroundColor: event.color + "22",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <View
              style={{
                backgroundColor: event.color,
                width: 10,
                height: 10,
                borderRadius: 5,
              }}
            />
            <Text
              style={{
                position: "absolute",
                top: 46,
                fontSize: 8,
                color: event.color,
                width: 80,
                textAlign: "center",
              }}
            >
              {event.id}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={ui.wrap}>
        <Text style={ui.small}>
          ●{" "}
          <Text style={{ color: colors.cyan }}>Lighting transition cells</Text>
        </Text>
        {plume && (
          <Text style={ui.small}>
            ◌ <Text style={{ color: colors.amber }}>Atmospheric footprint</Text>
          </Text>
        )}
        <Text style={ui.small}>
          Illustrative geometry · not a geographic basemap
        </Text>
      </View>
    </View>
  );
}
