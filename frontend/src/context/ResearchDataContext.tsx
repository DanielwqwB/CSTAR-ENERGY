import React, { createContext, useContext, useEffect, useState } from "react";
import { api, type DatasetRow, type SeriesPoint } from "../api";
import { useWorkspace } from "./WorkspaceContext";

interface Resource<T> {
  data?: T;
  loading: boolean;
  error?: string;
}

interface ResearchData {
  datasets: Resource<DatasetRow[]>;
  series: Resource<SeriesPoint[]>;
}

const Context = createContext<ResearchData | null>(null);

function message(error: unknown) {
  return error instanceof Error ? error.message : "The backend request failed.";
}

export function ResearchDataProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { authenticated } = useWorkspace();
  const [datasets, setDatasets] = useState<Resource<DatasetRow[]>>({
    loading: true,
  });
  const [series, setSeries] = useState<Resource<SeriesPoint[]>>({
    loading: true,
  });

  useEffect(() => {
    let active = true;
    if (!authenticated) {
      setDatasets({ loading: false });
      setSeries({ loading: false });
      return () => {
        active = false;
      };
    }

    setDatasets({ loading: true });
    setSeries({ loading: true });
    api<DatasetRow[]>("/datasets")
      .then((data) => {
        if (active) setDatasets({ data, loading: false });
      })
      .catch((error: unknown) => {
        if (active) setDatasets({ loading: false, error: message(error) });
      });
    api<SeriesPoint[]>("/series")
      .then((data) => {
        if (active) setSeries({ data, loading: false });
      })
      .catch((error: unknown) => {
        if (active) setSeries({ loading: false, error: message(error) });
      });

    return () => {
      active = false;
    };
  }, [authenticated]);

  return (
    <Context.Provider value={{ datasets, series }}>
      {children}
    </Context.Provider>
  );
}

export function useResearchData() {
  const context = useContext(Context);
  if (!context) throw new Error("ResearchDataProvider is required");
  return context;
}
