/**
 * Lab track filters (sessionStorage) for Modules Lab.
 */

import { useCallback, useRef, useState } from "react";
import type { DrinkxHost } from "@service-monitor/core";
import {
  isModuleTracked as isModuleTrackedIn,
  isSensorTracked as isSensorTrackedIn,
  loadLabTrack,
  saveLabTrack,
} from "./modulesLabStorage";
import type { LabTrackState } from "./modulesLabTypes";

export function useLabTrack() {
  const [labTrack, setLabTrack] = useState<LabTrackState>(() => loadLabTrack());
  const [showTrackPanel, setShowTrackPanel] = useState(false);
  const labTrackRef = useRef(labTrack);
  labTrackRef.current = labTrack;

  const isModuleTracked = useCallback((mod: DrinkxHost) => {
    return isModuleTrackedIn(labTrackRef.current, mod);
  }, []);

  const isSensorTracked = useCallback((mod: DrinkxHost, name: string) => {
    return isSensorTrackedIn(labTrackRef.current, mod, name);
  }, []);

  const updateLabTrack = useCallback((next: LabTrackState) => {
    setLabTrack(next);
    saveLabTrack(next);
  }, []);

  return {
    labTrack,
    showTrackPanel,
    setShowTrackPanel,
    labTrackRef,
    isModuleTracked,
    isSensorTracked,
    updateLabTrack,
  };
}
