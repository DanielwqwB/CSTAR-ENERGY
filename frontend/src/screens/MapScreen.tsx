import { css } from "../styles";
import { Toggle } from "../components/ui";
import React, { useState } from "react";
import { Button, Card, Notice, Status } from "../components/ui";
import { TransitionMap } from "../components/TransitionMap";
import { useWorkspace } from "../context/WorkspaceContext";
import { colors, ui } from "../theme";
export function MapScreen() {
  const { events, selected, select, go } = useWorkspace();
  const [plume, setPlume] = useState(true);
  const [cells, setCells] = useState(true);
  return (
    <div className="stack" style={css(ui.stack)}>
      <Card title="Map layers">
        <div className="stack" style={css(ui.wrap)}>
          {[
            ["Nighttime radiance cells", cells, setCells],
            ["Atmospheric footprints", plume, setPlume],
          ].map(([label, value, setter]) => (
            <div className="stack" key={label as string} style={css(ui.row)}>
              <Toggle
                aria-label={label as string}
                value={value as boolean}
                onChange={setter as (value: boolean) => void}
              />
              <span style={css(ui.muted)}>{label as string}</span>
            </div>
          ))}
        </div>
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
        <span style={css(ui.heading)}>{selected.location}</span>
        <span style={css(ui.muted)}>{selected.summary}</span>
        <div className="stack" style={css(ui.wrap)}>
          <Status value={selected.adequacy} />
          <Status value={selected.status} />
        </div>
        <Button
          label="Open investigation"
          icon="arrow-forward"
          onClick={() => go("investigation")}
        />
      </Card>
    </div>
  );
}
