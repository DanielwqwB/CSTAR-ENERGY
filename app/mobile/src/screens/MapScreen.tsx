import React, { useState } from "react";
import { Switch, Text, View } from "react-native";
import { Button, Card, Notice, Status } from "../components/ui";
import { TransitionMap } from "../components/TransitionMap";
import { useWorkspace } from "../context/WorkspaceContext";
import { colors, ui } from "../theme";

export function MapScreen() {
  const { events, selected, select, go } = useWorkspace();
  const [plume, setPlume] = useState(true);
  const [cells, setCells] = useState(true);
  return (
    <View style={ui.stack}>
      <Card title="Map layers">
        <View style={ui.wrap}>
          {[
            ["Nighttime radiance cells", cells, setCells],
            ["Atmospheric footprints", plume, setPlume],
          ].map(([label, value, setter]) => (
            <View key={label as string} style={ui.row}>
              <Switch
                accessibilityLabel={label as string}
                value={value as boolean}
                onValueChange={setter as (value: boolean) => void}
                trackColor={{ true: colors.cyan }}
              />
              <Text style={ui.muted}>{label as string}</Text>
            </View>
          ))}
        </View>
        <TransitionMap
          events={events}
          selected={selected.id}
          onSelect={(event) => select(event.id)}
          plume={plume}
          cells={cells}
          height={440}
        />
      </Card>
      <Notice>
        Scientific scale: Black Marble represents ~500 m cells. TROPOMI uses
        separate, much larger atmospheric footprints. The diagram is
        illustrative and does not show street-level readings.
      </Notice>
      <Card
        title="Selected transition zone"
        subtitle={`${selected.id} · ${selected.zone}`}
      >
        <Text style={ui.heading}>{selected.location}</Text>
        <Text style={ui.muted}>{selected.summary}</Text>
        <View style={ui.wrap}>
          <Status value={selected.adequacy} />
          <Status value={selected.status} />
        </View>
        <Button
          label="Open investigation"
          icon="arrow-forward"
          onPress={() => go("investigation")}
        />
      </Card>
    </View>
  );
}
