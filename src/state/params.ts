import type { ParamSpec, Preset, TraceParams } from "../ipc";

export type PresetSelection = Preset | "custom";

export type ParamsState = {
  spec: ParamSpec | null;
  preset: PresetSelection;
  params: TraceParams | null;
  isAdvancedOpen: boolean;
};

export type ParamsAction =
  | {
      type: "INIT_SPEC";
      spec: ParamSpec;
      initialPreset?: PresetSelection;
      initialParams?: TraceParams;
    }
  | {
      type: "SET_PRESET";
      preset: Preset;
    }
  | {
      type: "SET_PARAM";
      key: keyof TraceParams;
      value: TraceParams[keyof TraceParams];
    }
  | {
      type: "TOGGLE_ADVANCED";
    }
  | {
      type: "SET_ADVANCED_OPEN";
      isOpen: boolean;
    };

export function createInitialParamsState(spec?: ParamSpec | null): ParamsState {
  if (!spec) {
    return {
      spec: null,
      preset: "colorLogo",
      params: null,
      isAdvancedOpen: false,
    };
  }

  const defaultPreset = spec.defaultPreset;
  const matched = spec.presets.find((p) => p.id === defaultPreset);

  return {
    spec,
    preset: defaultPreset,
    params: matched ? { ...matched.params } : null,
    isAdvancedOpen: false,
  };
}

export function paramsReducer(
  state: ParamsState,
  action: ParamsAction,
): ParamsState {
  switch (action.type) {
    case "INIT_SPEC": {
      if (action.initialPreset && action.initialParams) {
        return {
          ...state,
          spec: action.spec,
          preset: action.initialPreset,
          params: { ...action.initialParams },
        };
      }
      const defaultPreset = action.spec.defaultPreset;
      const matched = action.spec.presets.find((p) => p.id === defaultPreset);
      return {
        ...state,
        spec: action.spec,
        preset: defaultPreset,
        params: matched ? { ...matched.params } : null,
      };
    }
    case "SET_PRESET": {
      if (!state.spec) {
        return state;
      }
      const matched = state.spec.presets.find((p) => p.id === action.preset);
      if (!matched) {
        return state;
      }
      return {
        ...state,
        preset: action.preset,
        params: { ...matched.params },
      };
    }
    case "SET_PARAM": {
      if (!state.params) {
        return state;
      }
      return {
        ...state,
        preset: "custom",
        params: {
          ...state.params,
          [action.key]: action.value,
        },
      };
    }
    case "TOGGLE_ADVANCED":
      return {
        ...state,
        isAdvancedOpen: !state.isAdvancedOpen,
      };
    case "SET_ADVANCED_OPEN":
      return {
        ...state,
        isAdvancedOpen: action.isOpen,
      };
    default:
      return state;
  }
}
