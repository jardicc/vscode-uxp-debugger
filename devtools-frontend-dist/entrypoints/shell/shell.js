// gen/front_end/entrypoints/shell/shell.prebundle.js
import "./..\\..\\Images\\Images.js";
import "./..\\..\\ui\\dom_extension\\dom_extension.js";

// gen/front_end/entrypoints/main/main-meta.js
import * as Common from "./..\\..\\core\\common\\common.js";
import * as Host from "./..\\..\\core\\host\\host.js";
import * as i18n from "./..\\..\\core\\i18n\\i18n.js";
import * as Root from "./..\\..\\core\\root\\root.js";
import * as SDK from "./..\\..\\core\\sdk\\sdk.js";
import * as Badges from "./..\\..\\models\\badges\\badges.js";
import * as Persistence from "./..\\..\\models\\persistence\\persistence.js";
import * as Workspace from "./..\\..\\models\\workspace\\workspace.js";
import * as Components from "./..\\..\\ui\\legacy\\components\\utils\\utils.js";
import * as UI from "./..\\..\\ui\\legacy\\legacy.js";
import * as SettingsUI from "./..\\..\\ui\\settings\\settings.js";
var UIStrings = {
  /**
   * @description Title of a setting under the Persistence category in Settings.
   */
  localOverrides: "Local overrides",
  /**
   * @description A tag of enable local overrides setting that can be searched in the command menu.
   */
  interception: "interception",
  /**
   * @description A tag of enable local overrides setting that can be searched in the command menu.
   */
  override: "override",
  /**
   * @description A tag of group network by frame setting that can be searched in the command menu.
   */
  network: "network",
  /**
   * @description A tag of enable local overrides setting that can be searched in the command menu.
   */
  rewrite: "rewrite",
  /**
   * @description A tag of enable local overrides setting that can be searched in the command menu.
   * Noun for network request.
   */
  request: "request",
  /**
   * @description Title of an option under the Persistence category that can be invoked through the command menu.
   */
  enableOverrideNetworkRequests: "Enable override network requests",
  /**
   * @description Title of an option under the Persistence category that can be invoked through the command menu.
   */
  disableOverrideNetworkRequests: "Disable override network requests",
  /**
   * @description Label for a checkbox in the settings UI. Allows developers to opt-in/opt-out
   * of receiving Google Developer Program (GDP) badges based on their activity in Chrome DevTools.
   */
  earnBadges: "Earn badges",
  /**
   * @description Title of a setting under the Appearance category in Settings. When the webpage is
   * paused by devtools, an overlay is shown on top of the page to indicate that it is paused. The
   * overlay is a pause/unpause button and some text, which appears on top of the paused page. This
   * setting turns off this overlay.
   */
  disablePaused: "Disable paused state overlay",
  /**
   * @description Action title to focus the page being debugged.
   */
  focusDebuggee: "Focus page",
  /**
   * @description Action title and shortcut description to toggle the Console drawer.
   */
  toggleDrawer: "Toggle drawer",
  /**
   * @description Title of an action that navigates to the next panel.
   */
  nextPanel: "Next panel",
  /**
   * @description Title of an action that navigates to the previous panel.
   */
  previousPanel: "Previous panel",
  /**
   * @description Title of an action that reloads DevTools.
   */
  reloadDevtools: "Reload DevTools",
  /**
   * @description Title of an action in the main toolbar to restore the last dock position.
   */
  restoreLastDockPosition: "Restore last dock position",
  /**
   * @description Shortcut description and action title to zoom in.
   */
  zoomIn: "Zoom in",
  /**
   * @description Shortcut description and action title to zoom out.
   */
  zoomOut: "Zoom out",
  /**
   * @description Title of an action that resets the zoom level to default.
   */
  resetZoomLevel: "Reset zoom level",
  /**
   * @description Title of an action to search within the current panel.
   */
  searchInPanel: "Search in panel",
  /**
   * @description Title of an action that cancels the current search.
   */
  cancelSearch: "Cancel search",
  /**
   * @description Title of an action that finds the next search result.
   */
  findNextResult: "Find next result",
  /**
   * @description Title of an action to find the previous search result.
   */
  findPreviousResult: "Find previous result",
  /**
   * @description Title of the theme setting under the Appearance category in Settings.
   */
  theme: "Theme:",
  /**
   * @description Command menu option to switch to the browser's preferred color theme.
   */
  switchToBrowserPreferredTheme: "Switch to browser\u2019s preferred theme",
  /**
   * @description Drop-down menu option to match the browser's color theme.
   */
  autoTheme: "Auto",
  /**
   * @description Command menu option to switch to the light color theme.
   */
  switchToLightTheme: "Switch to light theme",
  /**
   * @description Drop-down menu option to select the light color theme.
   */
  lightCapital: "Light",
  /**
   * @description Command menu option to switch to the dark color theme.
   */
  switchToDarkTheme: "Switch to dark theme",
  /**
   * @description Drop-down menu option to select the dark color theme.
   */
  darkCapital: "Dark",
  /**
   * @description Tag for theme preference settings when searched in the command menu.
   */
  darkLower: "dark",
  /**
   * @description Tag for theme preference settings when searched in the command menu.
   */
  lightLower: "light",
  /**
   * @description Title of the panel layout setting under the Appearance category in Settings.
   */
  panelLayout: "Panel layout:",
  /**
   * @description Command menu option to use a horizontal panel layout.
   */
  useHorizontalPanelLayout: "Use horizontal panel layout",
  /**
   * @description Drop-down menu option for horizontal panel layout.
   */
  horizontal: "horizontal",
  /**
   * @description Command menu option to use a vertical panel layout.
   */
  useVerticalPanelLayout: "Use vertical panel layout",
  /**
   * @description Drop-down menu option for vertical panel layout.
   */
  vertical: "vertical",
  /**
   * @description Command menu option to use automatic panel layout.
   */
  useAutomaticPanelLayout: "Use automatic panel layout",
  /**
   * @description Drop-down menu option for automatic panel layout.
   */
  auto: "auto",
  /**
   * @description Checkbox label for the setting to use Ctrl plus number keys to switch panels.
   */
  enableCtrlShortcutToSwitchPanels: "Use Ctrl + 1-9 to switch panels",
  /**
   * @description Checkbox label for the setting to use Command plus number keys to switch panels on Mac.
   */
  enableShortcutToSwitchPanels: "Use \u2318 + 1-9 to switch panels",
  /**
   * @description Drop-down menu option to dock DevTools to the right.
   */
  right: "Right",
  /**
   * @description Title of the action and setting option to dock DevTools to the right of the browser window.
   */
  dockToRight: "Dock to right",
  /**
   * @description Drop-down menu option to dock DevTools to the bottom.
   */
  bottom: "Bottom",
  /**
   * @description Title of the action and setting option to dock DevTools to the bottom of the browser window.
   */
  dockToBottom: "Dock to bottom",
  /**
   * @description Drop-down menu option to dock DevTools to the left.
   */
  left: "Left",
  /**
   * @description Title of the action and setting option to dock DevTools to the left of the browser window.
   */
  dockToLeft: "Dock to left",
  /**
   * @description Drop-down menu option for undocked DevTools in a separate window.
   */
  undocked: "Undocked",
  /**
   * @description Title of the action and setting option to undock DevTools into a separate window.
   */
  undockIntoSeparateWindow: "Undock into separate window",
  /**
   * @description Option label for the default set of DevTools keyboard shortcuts.
   */
  devtoolsDefault: "DevTools (Default)",
  /**
   * @description Title of the language setting that allows users to switch the locale
   * in which DevTools is presented.
   */
  language: "Language:",
  /**
   * @description Users can choose this option when picking the language in which
   * DevTools is presented. Choosing this option means that the DevTools language matches
   * Chrome's UI language.
   */
  browserLanguage: "Browser UI language",
  /**
   * @description Label for a checkbox in the settings UI. Allows developers to opt-in/opt-out
   * of saving settings to their Google account.
   */
  saveSettings: "Save `DevTools` settings to your `Google` account",
  /**
   * @description A command available in the command menu to perform searches, for example in the
   * elements panel, as user types, rather than only when they press Enter.
   */
  searchAsYouTypeSetting: "Search as you type",
  /**
   * @description A command available in the command menu to perform searches, for example in the
   * elements panel, as user types, rather than only when they press Enter.
   */
  searchAsYouTypeCommand: "Enable search as you type",
  /**
   * @description A command available in the command menu to perform searches, for example in the
   * elements panel, only when the user presses Enter.
   */
  searchOnEnterCommand: "Disable search as you type (press Enter to search)",
  /**
   * @description Label of a checkbox under the Appearance category in Settings. Allows developers
   * to opt-in / opt-out of syncing DevTools' color theme with Chrome's color theme.
   */
  matchChromeColorScheme: "Match Chrome color scheme",
  /**
   * @description Tooltip for the learn more link of the Match Chrome color scheme Setting.
   */
  matchChromeColorSchemeDocumentation: "Match DevTools colors to your customized Chrome theme (when enabled)",
  /**
   * @description Command to turn the browser color scheme matching on through the command menu.
   */
  matchChromeColorSchemeCommand: "Match Chrome color scheme",
  /**
   * @description Command to turn the browser color scheme matching off through the command menu.
   */
  dontMatchChromeColorSchemeCommand: "Don\u2019t match Chrome color scheme",
  /**
   * @description Command to toggle the drawer orientation.
   */
  toggleDrawerOrientation: "Toggle drawer orientation"
};
var str_ = i18n.i18n.registerUIStrings("entrypoints/main/main-meta.ts", UIStrings);
var i18nLazyString = i18n.i18n.getLazilyComputedLocalizedString.bind(void 0, str_);
var loadedMainModule;
var loadedInspectorMainModule;
async function loadMainModule() {
  if (!loadedMainModule) {
    loadedMainModule = await import("./..\\main\\main.js");
  }
  return loadedMainModule;
}
async function loadInspectorMainModule() {
  if (!loadedInspectorMainModule) {
    loadedInspectorMainModule = await import("./..\\inspector_main\\inspector_main.js");
  }
  return loadedInspectorMainModule;
}
UI.ActionRegistration.registerActionExtension({
  category: "DRAWER",
  actionId: "inspector-main.focus-debuggee",
  async loadActionDelegate() {
    const InspectorMain = await loadInspectorMainModule();
    return new InspectorMain.InspectorMain.FocusDebuggeeActionDelegate();
  },
  order: 100,
  title: i18nLazyString(UIStrings.focusDebuggee)
});
UI.ActionRegistration.registerActionExtension({
  category: "DRAWER",
  actionId: "main.toggle-drawer",
  async loadActionDelegate() {
    return new UI.InspectorView.ActionDelegate();
  },
  order: 101,
  title: i18nLazyString(UIStrings.toggleDrawer),
  bindings: [
    {
      shortcut: "Esc"
    }
  ]
});
UI.ActionRegistration.registerActionExtension({
  category: "DRAWER",
  actionId: "main.toggle-drawer-orientation",
  async loadActionDelegate() {
    return new UI.InspectorView.ActionDelegate();
  },
  title: i18nLazyString(UIStrings.toggleDrawerOrientation),
  bindings: [
    {
      shortcut: "Shift+Esc"
    }
  ],
  condition: (config) => Boolean(config?.devToolsFlexibleLayout?.verticalDrawerEnabled)
});
UI.ActionRegistration.registerActionExtension({
  actionId: "main.next-tab",
  category: "GLOBAL",
  title: i18nLazyString(UIStrings.nextPanel),
  async loadActionDelegate() {
    return new UI.InspectorView.ActionDelegate();
  },
  bindings: [
    {
      platform: "windows,linux",
      shortcut: "Ctrl+]"
    },
    {
      platform: "mac",
      shortcut: "Meta+]"
    }
  ]
});
UI.ActionRegistration.registerActionExtension({
  actionId: "main.previous-tab",
  category: "GLOBAL",
  title: i18nLazyString(UIStrings.previousPanel),
  async loadActionDelegate() {
    return new UI.InspectorView.ActionDelegate();
  },
  bindings: [
    {
      platform: "windows,linux",
      shortcut: "Ctrl+["
    },
    {
      platform: "mac",
      shortcut: "Meta+["
    }
  ]
});
UI.ActionRegistration.registerActionExtension({
  actionId: "main.debug-reload",
  category: "GLOBAL",
  title: i18nLazyString(UIStrings.reloadDevtools),
  async loadActionDelegate() {
    const Main = await loadMainModule();
    return new Main.MainImpl.ReloadActionDelegate();
  },
  bindings: [
    {
      shortcut: "Alt+R"
    }
  ]
});
UI.ActionRegistration.registerActionExtension({
  category: "GLOBAL",
  title: i18nLazyString(UIStrings.restoreLastDockPosition),
  actionId: "main.toggle-dock",
  async loadActionDelegate() {
    return new UI.DockController.ToggleDockActionDelegate();
  },
  bindings: [
    {
      platform: "windows,linux",
      shortcut: "Ctrl+Shift+D"
    },
    {
      platform: "mac",
      shortcut: "Meta+Shift+D"
    }
  ]
});
UI.ActionRegistration.registerActionExtension({
  actionId: "main.zoom-in",
  category: "GLOBAL",
  title: i18nLazyString(UIStrings.zoomIn),
  async loadActionDelegate() {
    const Main = await loadMainModule();
    return new Main.MainImpl.ZoomActionDelegate();
  },
  bindings: [
    {
      platform: "windows,linux",
      shortcut: "Ctrl+Plus",
      keybindSets: [
        "devToolsDefault",
        "vsCode"
      ]
    },
    {
      platform: "windows,linux",
      shortcut: "Ctrl+Shift+Plus"
    },
    {
      platform: "windows,linux",
      shortcut: "Ctrl+NumpadPlus"
    },
    {
      platform: "windows,linux",
      shortcut: "Ctrl+Shift+NumpadPlus"
    },
    {
      platform: "mac",
      shortcut: "Meta+Plus",
      keybindSets: [
        "devToolsDefault",
        "vsCode"
      ]
    },
    {
      platform: "mac",
      shortcut: "Meta+Shift+Plus"
    },
    {
      platform: "mac",
      shortcut: "Meta+NumpadPlus"
    },
    {
      platform: "mac",
      shortcut: "Meta+Shift+NumpadPlus"
    }
  ]
});
UI.ActionRegistration.registerActionExtension({
  actionId: "main.zoom-out",
  category: "GLOBAL",
  title: i18nLazyString(UIStrings.zoomOut),
  async loadActionDelegate() {
    const Main = await loadMainModule();
    return new Main.MainImpl.ZoomActionDelegate();
  },
  bindings: [
    {
      platform: "windows,linux",
      shortcut: "Ctrl+Minus",
      keybindSets: [
        "devToolsDefault",
        "vsCode"
      ]
    },
    {
      platform: "windows,linux",
      shortcut: "Ctrl+Shift+Minus"
    },
    {
      platform: "windows,linux",
      shortcut: "Ctrl+NumpadMinus"
    },
    {
      platform: "windows,linux",
      shortcut: "Ctrl+Shift+NumpadMinus"
    },
    {
      platform: "mac",
      shortcut: "Meta+Minus",
      keybindSets: [
        "devToolsDefault",
        "vsCode"
      ]
    },
    {
      platform: "mac",
      shortcut: "Meta+Shift+Minus"
    },
    {
      platform: "mac",
      shortcut: "Meta+NumpadMinus"
    },
    {
      platform: "mac",
      shortcut: "Meta+Shift+NumpadMinus"
    }
  ]
});
UI.ActionRegistration.registerActionExtension({
  actionId: "main.zoom-reset",
  category: "GLOBAL",
  title: i18nLazyString(UIStrings.resetZoomLevel),
  async loadActionDelegate() {
    const Main = await loadMainModule();
    return new Main.MainImpl.ZoomActionDelegate();
  },
  bindings: [
    {
      platform: "windows,linux",
      shortcut: "Ctrl+0"
    },
    {
      platform: "windows,linux",
      shortcut: "Ctrl+Numpad0"
    },
    {
      platform: "mac",
      shortcut: "Meta+Numpad0"
    },
    {
      platform: "mac",
      shortcut: "Meta+0"
    }
  ]
});
UI.ActionRegistration.registerActionExtension({
  actionId: "main.search-in-panel.find",
  category: "GLOBAL",
  title: i18nLazyString(UIStrings.searchInPanel),
  async loadActionDelegate() {
    const Main = await loadMainModule();
    return new Main.MainImpl.SearchActionDelegate();
  },
  bindings: [
    {
      platform: "windows,linux",
      shortcut: "Ctrl+F",
      keybindSets: [
        "devToolsDefault",
        "vsCode"
      ]
    },
    {
      platform: "mac",
      shortcut: "Meta+F",
      keybindSets: [
        "devToolsDefault",
        "vsCode"
      ]
    },
    {
      platform: "mac",
      shortcut: "F3"
    }
  ]
});
UI.ActionRegistration.registerActionExtension({
  actionId: "main.search-in-panel.cancel",
  category: "GLOBAL",
  title: i18nLazyString(UIStrings.cancelSearch),
  async loadActionDelegate() {
    const Main = await loadMainModule();
    return new Main.MainImpl.SearchActionDelegate();
  },
  order: 10,
  bindings: [
    {
      shortcut: "Esc"
    }
  ]
});
UI.ActionRegistration.registerActionExtension({
  actionId: "main.search-in-panel.find-next",
  category: "GLOBAL",
  title: i18nLazyString(UIStrings.findNextResult),
  async loadActionDelegate() {
    const Main = await loadMainModule();
    return new Main.MainImpl.SearchActionDelegate();
  },
  bindings: [
    {
      platform: "mac",
      shortcut: "Meta+G",
      keybindSets: [
        "devToolsDefault",
        "vsCode"
      ]
    },
    {
      platform: "windows,linux",
      shortcut: "Ctrl+G"
    },
    {
      platform: "windows,linux",
      shortcut: "F3",
      keybindSets: [
        "devToolsDefault",
        "vsCode"
      ]
    }
  ]
});
UI.ActionRegistration.registerActionExtension({
  actionId: "main.search-in-panel.find-previous",
  category: "GLOBAL",
  title: i18nLazyString(UIStrings.findPreviousResult),
  async loadActionDelegate() {
    const Main = await loadMainModule();
    return new Main.MainImpl.SearchActionDelegate();
  },
  bindings: [
    {
      platform: "mac",
      shortcut: "Meta+Shift+G",
      keybindSets: [
        "devToolsDefault",
        "vsCode"
      ]
    },
    {
      platform: "windows,linux",
      shortcut: "Ctrl+Shift+G"
    },
    {
      platform: "windows,linux",
      shortcut: "Shift+F3",
      keybindSets: [
        "devToolsDefault",
        "vsCode"
      ]
    }
  ]
});
Common.Settings.registerSettingExtension({
  category: "APPEARANCE",
  storageType: "Synced",
  title: i18nLazyString(UIStrings.theme),
  settingName: "ui-theme",
  settingType: "enum",
  defaultValue: "systemPreferred",
  reloadRequired: false,
  options: [
    {
      title: i18nLazyString(UIStrings.switchToBrowserPreferredTheme),
      text: i18nLazyString(UIStrings.autoTheme),
      value: "systemPreferred"
    },
    {
      title: i18nLazyString(UIStrings.switchToLightTheme),
      text: i18nLazyString(UIStrings.lightCapital),
      value: "default"
    },
    {
      title: i18nLazyString(UIStrings.switchToDarkTheme),
      text: i18nLazyString(UIStrings.darkCapital),
      value: "dark"
    }
  ],
  tags: [
    i18nLazyString(UIStrings.darkLower),
    i18nLazyString(UIStrings.lightLower)
  ]
});
Common.Settings.registerSettingExtension({
  category: "APPEARANCE",
  storageType: "Synced",
  title: i18nLazyString(UIStrings.matchChromeColorScheme),
  settingName: "chrome-theme-colors",
  settingType: "boolean",
  defaultValue: true,
  options: [
    {
      value: true,
      title: i18nLazyString(UIStrings.matchChromeColorSchemeCommand)
    },
    {
      value: false,
      title: i18nLazyString(UIStrings.dontMatchChromeColorSchemeCommand)
    }
  ],
  reloadRequired: true,
  learnMore: {
    url: "https://goo.gle/devtools-customize-theme",
    tooltip: i18nLazyString(UIStrings.matchChromeColorSchemeDocumentation)
  }
});
Common.Settings.registerSettingExtension({
  category: "APPEARANCE",
  storageType: "Synced",
  title: i18nLazyString(UIStrings.panelLayout),
  settingName: "sidebar-position",
  settingType: "enum",
  defaultValue: "auto",
  options: [
    {
      title: i18nLazyString(UIStrings.useHorizontalPanelLayout),
      text: i18nLazyString(UIStrings.horizontal),
      value: "bottom"
    },
    {
      title: i18nLazyString(UIStrings.useVerticalPanelLayout),
      text: i18nLazyString(UIStrings.vertical),
      value: "right"
    },
    {
      title: i18nLazyString(UIStrings.useAutomaticPanelLayout),
      text: i18nLazyString(UIStrings.auto),
      value: "auto"
    }
  ]
});
Common.Settings.registerSettingExtension({
  category: "APPEARANCE",
  storageType: "Synced",
  settingName: "language",
  settingType: "enum",
  title: i18nLazyString(UIStrings.language),
  defaultValue: "en-US",
  options: [
    {
      value: "browserLanguage",
      title: i18nLazyString(UIStrings.browserLanguage),
      text: i18nLazyString(UIStrings.browserLanguage)
    },
    ...i18n.i18n.getAllSupportedDevToolsLocales().sort().map((locale) => createOptionForLocale(locale))
  ],
  reloadRequired: true
});
Common.Settings.registerSettingExtension({
  category: "APPEARANCE",
  storageType: "Synced",
  title: Host.Platform.platform() === "mac" ? i18nLazyString(UIStrings.enableShortcutToSwitchPanels) : i18nLazyString(UIStrings.enableCtrlShortcutToSwitchPanels),
  settingName: "shortcut-panel-switch",
  settingType: "boolean",
  defaultValue: false
});
SettingsUI.SettingUIRegistration.register(SDK.SDKSettings.disablePausedStateOverlaySettingDescriptor, {
  category: "APPEARANCE",
  title: i18nLazyString(UIStrings.disablePaused)
});
Common.Settings.registerSettingExtension({
  category: "GLOBAL",
  settingName: "currentDockState",
  settingType: "enum",
  defaultValue: "right",
  options: [
    {
      value: "right",
      text: i18nLazyString(UIStrings.right),
      title: i18nLazyString(UIStrings.dockToRight)
    },
    {
      value: "bottom",
      text: i18nLazyString(UIStrings.bottom),
      title: i18nLazyString(UIStrings.dockToBottom)
    },
    {
      value: "left",
      text: i18nLazyString(UIStrings.left),
      title: i18nLazyString(UIStrings.dockToLeft)
    },
    {
      value: "undocked",
      text: i18nLazyString(UIStrings.undocked),
      title: i18nLazyString(UIStrings.undockIntoSeparateWindow)
    }
  ]
});
Common.Settings.registerSettingExtension({
  storageType: "Synced",
  settingName: "active-keybind-set",
  settingType: "enum",
  defaultValue: "devToolsDefault",
  options: [
    {
      value: "devToolsDefault",
      title: i18nLazyString(UIStrings.devtoolsDefault),
      text: i18nLazyString(UIStrings.devtoolsDefault)
    },
    {
      value: "vsCode",
      title: i18n.i18n.lockedLazyString("Visual Studio Code"),
      text: i18n.i18n.lockedLazyString("Visual Studio Code")
    }
  ]
});
function createLazyLocalizedLocaleSettingText(localeString) {
  return () => i18n.i18n.getLocalizedLanguageRegion(localeString, i18n.DevToolsLocale.DevToolsLocale.instance());
}
function createOptionForLocale(localeString) {
  return {
    value: localeString,
    title: createLazyLocalizedLocaleSettingText(localeString),
    text: createLazyLocalizedLocaleSettingText(localeString)
  };
}
Common.Settings.registerSettingExtension({
  category: "ACCOUNT",
  // This name must be kept in sync with DevToolsSettings::kSyncDevToolsPreferencesFrontendName.
  settingName: "sync-preferences",
  settingType: "boolean",
  title: i18nLazyString(UIStrings.saveSettings),
  defaultValue: false,
  reloadRequired: true
});
SettingsUI.SettingUIRegistration.register(Badges.receiveGdpBadgesSettingDescriptor, {
  category: "ACCOUNT",
  title: i18nLazyString(UIStrings.earnBadges),
  reloadRequired: true
});
SettingsUI.SettingUIRegistration.register(Persistence.NetworkPersistenceManager.persistenceNetworkOverridesEnabledSettingDescriptor, {
  category: "PERSISTENCE",
  title: i18nLazyString(UIStrings.localOverrides),
  tags: [
    i18nLazyString(UIStrings.interception),
    i18nLazyString(UIStrings.override),
    i18nLazyString(UIStrings.network),
    i18nLazyString(UIStrings.rewrite),
    i18nLazyString(UIStrings.request)
  ],
  options: [
    {
      value: true,
      title: i18nLazyString(UIStrings.enableOverrideNetworkRequests)
    },
    {
      value: false,
      title: i18nLazyString(UIStrings.disableOverrideNetworkRequests)
    }
  ]
});
Common.Settings.registerSettingExtension({
  storageType: "Synced",
  settingName: "user-shortcuts",
  settingType: "array",
  defaultValue: []
});
Common.Settings.registerSettingExtension({
  category: "GLOBAL",
  storageType: "Local",
  title: i18nLazyString(UIStrings.searchAsYouTypeSetting),
  settingName: "search-as-you-type",
  settingType: "boolean",
  order: 3,
  defaultValue: true,
  options: [
    {
      value: true,
      title: i18nLazyString(UIStrings.searchAsYouTypeCommand)
    },
    {
      value: false,
      title: i18nLazyString(UIStrings.searchOnEnterCommand)
    }
  ]
});
UI.ViewManager.registerLocationResolver({
  name: "drawer-view",
  category: "DRAWER",
  async loadResolver() {
    return UI.InspectorView.InspectorView.instance();
  }
});
UI.ViewManager.registerLocationResolver({
  name: "drawer-sidebar",
  category: "DRAWER_SIDEBAR",
  async loadResolver() {
    return UI.InspectorView.InspectorView.instance();
  }
});
UI.ViewManager.registerLocationResolver({
  name: "panel",
  category: "PANEL",
  async loadResolver() {
    return UI.InspectorView.InspectorView.instance();
  }
});
UI.ContextMenu.registerProvider({
  contextTypes() {
    return [
      Workspace.UISourceCode.UISourceCode,
      SDK.Resource.Resource,
      SDK.NetworkRequest.NetworkRequest
    ];
  },
  async loadProvider() {
    return new Components.Linkifier.ContentProviderContextMenuProvider();
  }
});
UI.ContextMenu.registerProvider({
  contextTypes() {
    return [
      Node
    ];
  },
  async loadProvider() {
    return new UI.LinkContextMenuProvider.LinkContextMenuProvider();
  }
});
UI.ContextMenu.registerProvider({
  contextTypes() {
    return [
      Node
    ];
  },
  async loadProvider() {
    return new Components.Linkifier.LinkContextMenuProvider();
  }
});
UI.Toolbar.registerToolbarItem({
  separator: true,
  location: "main-toolbar-left",
  order: 100
});
UI.Toolbar.registerToolbarItem({
  separator: true,
  order: 96,
  location: "main-toolbar-right"
});
UI.Toolbar.registerToolbarItem({
  condition(config) {
    const isFlagEnabled = config?.devToolsGlobalAiButton?.enabled;
    const isGeoRestricted = config?.aidaAvailability?.blockedByGeo === true;
    const isPolicyRestricted = config?.aidaAvailability?.blockedByEnterprisePolicy === true;
    return Boolean(isFlagEnabled && !isGeoRestricted && !isPolicyRestricted);
  },
  loadItem: Common.Lazy.lazy(async () => {
    const Main = await loadMainModule();
    return new Main.GlobalAiButton.GlobalAiButtonToolbarProvider();
  }),
  order: 98,
  location: "main-toolbar-right"
});
UI.Toolbar.registerToolbarItem({
  loadItem: Common.Lazy.lazy(async () => {
    const Main = await loadMainModule();
    return new Main.MainImpl.SettingsButtonProvider();
  }),
  order: 99,
  location: "main-toolbar-right"
});
UI.Toolbar.registerToolbarItem({
  condition: () => !Root.Runtime.Runtime.isTraceApp(),
  loadItem: Common.Lazy.lazy(async () => {
    const Main = await loadMainModule();
    return new Main.MainImpl.MainMenuItem();
  }),
  order: 100,
  location: "main-toolbar-right"
});
UI.Toolbar.registerToolbarItem({
  async loadItem() {
    return UI.DockController.CloseButtonProvider.instance();
  },
  order: 101,
  location: "main-toolbar-right"
});
UI.AppProvider.registerAppProvider({
  async loadAppProvider() {
    const Main = await loadMainModule();
    return new Main.SimpleApp.SimpleAppProvider();
  },
  order: 10
});

// gen/front_end/ui/legacy/components/perf_ui/perf_ui-meta.js
import * as Common2 from "./..\\..\\core\\common\\common.js";
import * as i18n3 from "./..\\..\\core\\i18n\\i18n.js";
import * as UI2 from "./..\\..\\ui\\legacy\\legacy.js";
var UIStrings2 = {
  /**
   * @description Title of a setting under the Performance category in Settings.
   * Selected navigation allows switching between 2 different sets of shortcuts
   * and actions (like zoom on scroll or crtl/cmd + scroll) for navigating the performance panel.
   */
  flamechartSelectedNavigation: "Flamechart navigation:",
  /**
   * @description Modern navigation option in the Performance Panel.
   */
  modern: "Modern",
  /**
   * @description Classic navigation option in the Performance Panel.
   */
  classic: "Classic",
  /**
   * @description Title of an action in the components tool to collect garbage
   */
  collectGarbage: "Collect garbage"
};
var str_2 = i18n3.i18n.registerUIStrings("ui/legacy/components/perf_ui/perf_ui-meta.ts", UIStrings2);
var i18nLazyString2 = i18n3.i18n.getLazilyComputedLocalizedString.bind(void 0, str_2);
var loadedPerfUIModule;
async function loadPerfUIModule() {
  if (!loadedPerfUIModule) {
    loadedPerfUIModule = await import("./..\\..\\ui\\legacy\\components\\perf_ui\\perf_ui.js");
  }
  return loadedPerfUIModule;
}
UI2.ActionRegistration.registerActionExtension({
  actionId: "components.collect-garbage",
  category: "PERFORMANCE",
  title: i18nLazyString2(UIStrings2.collectGarbage),
  iconClass: "mop",
  async loadActionDelegate() {
    const PerfUI = await loadPerfUIModule();
    return new PerfUI.GCActionDelegate.GCActionDelegate();
  }
});
Common2.Settings.registerSettingExtension({
  category: "PERFORMANCE",
  storageType: "Synced",
  title: i18nLazyString2(UIStrings2.flamechartSelectedNavigation),
  settingName: "flamechart-selected-navigation",
  settingType: "enum",
  defaultValue: "classic",
  options: [
    {
      title: i18nLazyString2(UIStrings2.modern),
      text: i18nLazyString2(UIStrings2.modern),
      value: "modern"
    },
    {
      title: i18nLazyString2(UIStrings2.classic),
      text: i18nLazyString2(UIStrings2.classic),
      value: "classic"
    }
  ]
});

// gen/front_end/ui/legacy/components/quick_open/quick_open-meta.js
import * as i18n5 from "./..\\..\\core\\i18n\\i18n.js";
import * as UI3 from "./..\\..\\ui\\legacy\\legacy.js";
var UIStrings3 = {
  /**
   * @description Title of an action that opens a file.
   */
  openFile: "Open file",
  /**
   * @description Title of an action that opens the command menu.
   */
  runCommand: "Run command"
};
var str_3 = i18n5.i18n.registerUIStrings("ui/legacy/components/quick_open/quick_open-meta.ts", UIStrings3);
var i18nLazyString3 = i18n5.i18n.getLazilyComputedLocalizedString.bind(void 0, str_3);
var loadedQuickOpenModule;
async function loadQuickOpenModule() {
  if (!loadedQuickOpenModule) {
    loadedQuickOpenModule = await import("./..\\..\\ui\\legacy\\components\\quick_open\\quick_open.js");
  }
  return loadedQuickOpenModule;
}
UI3.ActionRegistration.registerActionExtension({
  actionId: "quick-open.show-command-menu",
  category: "GLOBAL",
  title: i18nLazyString3(UIStrings3.runCommand),
  async loadActionDelegate() {
    const QuickOpen = await loadQuickOpenModule();
    return new QuickOpen.CommandMenu.ShowActionDelegate();
  },
  bindings: [
    {
      platform: "windows,linux",
      shortcut: "Ctrl+Shift+P",
      keybindSets: [
        "devToolsDefault",
        "vsCode"
      ]
    },
    {
      platform: "mac",
      shortcut: "Meta+Shift+P",
      keybindSets: [
        "devToolsDefault",
        "vsCode"
      ]
    },
    {
      shortcut: "F1",
      keybindSets: [
        "vsCode"
      ]
    }
  ]
});
UI3.ActionRegistration.registerActionExtension({
  actionId: "quick-open.show",
  category: "GLOBAL",
  title: i18nLazyString3(UIStrings3.openFile),
  async loadActionDelegate() {
    const QuickOpen = await loadQuickOpenModule();
    return new QuickOpen.QuickOpen.ShowActionDelegate();
  },
  order: 100,
  bindings: [
    {
      platform: "mac",
      shortcut: "Meta+P",
      keybindSets: [
        "devToolsDefault",
        "vsCode"
      ]
    },
    {
      platform: "mac",
      shortcut: "Meta+O",
      keybindSets: [
        "devToolsDefault",
        "vsCode"
      ]
    },
    {
      platform: "windows,linux",
      shortcut: "Ctrl+P",
      keybindSets: [
        "devToolsDefault",
        "vsCode"
      ]
    },
    {
      platform: "windows,linux",
      shortcut: "Ctrl+O",
      keybindSets: [
        "devToolsDefault",
        "vsCode"
      ]
    }
  ]
});
UI3.ContextMenu.registerItem({
  location: "mainMenu/default",
  actionId: "quick-open.show-command-menu"
});
UI3.ContextMenu.registerItem({
  location: "mainMenu/default",
  actionId: "quick-open.show"
});

// gen/front_end/models/workspace/workspace-meta.js
import * as Common3 from "./..\\..\\core\\common\\common.js";
Common3.Settings.registerSettingExtension({
  storageType: "Synced",
  settingName: "automatically-ignore-list-known-third-party-scripts",
  settingType: "boolean",
  defaultValue: true
});
Common3.Settings.registerSettingExtension({
  storageType: "Synced",
  settingName: "skip-anonymous-scripts",
  settingType: "boolean",
  defaultValue: false
});
Common3.Settings.registerSettingExtension({
  storageType: "Synced",
  settingName: "enable-ignore-listing",
  settingType: "boolean",
  defaultValue: true
});

// gen/front_end/ui/legacy/components/source_frame/source_frame-meta.js
import * as Common4 from "./..\\..\\core\\common\\common.js";
import * as i18n7 from "./..\\..\\core\\i18n\\i18n.js";
var UIStrings4 = {
  /**
   * @description Title of a setting under the Sources category in Settings
   */
  defaultIndentation: "Default indentation:",
  /**
   * @description Title of a setting under the Sources category that can be invoked through the Command Menu
   */
  setIndentationToSpaces: "Set indentation to 2 spaces",
  /**
   * @description A drop-down menu option to set indentation to 2 spaces
   */
  Spaces: "2 spaces",
  /**
   * @description Title of a setting under the Sources category that can be invoked through the Command Menu
   */
  setIndentationToFSpaces: "Set indentation to 4 spaces",
  /**
   * @description A drop-down menu option to set indentation to 4 spaces
   */
  fSpaces: "4 spaces",
  /**
   * @description Title of a setting under the Sources category that can be invoked through the Command Menu
   */
  setIndentationToESpaces: "Set indentation to 8 spaces",
  /**
   * @description A drop-down menu option to set indentation to 8 spaces
   */
  eSpaces: "8 spaces",
  /**
   * @description Title of a setting under the Sources category that can be invoked through the Command Menu
   */
  setIndentationToTabCharacter: "Set indentation to tab character",
  /**
   * @description A drop-down menu option to set indentation to tab character
   */
  tabCharacter: "Tab character"
};
var str_4 = i18n7.i18n.registerUIStrings("ui/legacy/components/source_frame/source_frame-meta.ts", UIStrings4);
var i18nLazyString4 = i18n7.i18n.getLazilyComputedLocalizedString.bind(void 0, str_4);
Common4.Settings.registerSettingExtension({
  category: "SOURCES",
  storageType: "Synced",
  title: i18nLazyString4(UIStrings4.defaultIndentation),
  settingName: "text-editor-indent",
  settingType: "enum",
  defaultValue: "    ",
  options: [
    {
      title: i18nLazyString4(UIStrings4.setIndentationToSpaces),
      text: i18nLazyString4(UIStrings4.Spaces),
      value: "  "
    },
    {
      title: i18nLazyString4(UIStrings4.setIndentationToFSpaces),
      text: i18nLazyString4(UIStrings4.fSpaces),
      value: "    "
    },
    {
      title: i18nLazyString4(UIStrings4.setIndentationToESpaces),
      text: i18nLazyString4(UIStrings4.eSpaces),
      value: "        "
    },
    {
      title: i18nLazyString4(UIStrings4.setIndentationToTabCharacter),
      text: i18nLazyString4(UIStrings4.tabCharacter),
      value: "	"
    }
  ]
});

// gen/front_end/panels/console_counters/console_counters-meta.js
import * as UI4 from "./..\\..\\ui\\legacy\\legacy.js";
var loadedConsoleCountersModule;
async function loadConsoleCountersModule() {
  if (!loadedConsoleCountersModule) {
    loadedConsoleCountersModule = await import("./..\\..\\panels\\console_counters\\console_counters.js");
  }
  return loadedConsoleCountersModule;
}
UI4.Toolbar.registerToolbarItem({
  async loadItem() {
    const ConsoleCounters = await loadConsoleCountersModule();
    return ConsoleCounters.WarningErrorCounter.WarningErrorCounter.instance();
  },
  order: 1,
  location: "main-toolbar-right"
});

// gen/front_end/ui/comments/comments-meta.js
import * as i18n9 from "./..\\..\\core\\i18n\\i18n.js";
import * as UI5 from "./..\\..\\ui\\legacy\\legacy.js";
var UIStrings5 = {
  /**
   * @description Title of an action that toggles comment mode.
   */
  toggleCommentMode: "Add comments to send to your AI coding agent"
};
var str_5 = i18n9.i18n.registerUIStrings("ui/comments/comments-meta.ts", UIStrings5);
var i18nLazyString5 = i18n9.i18n.getLazilyComputedLocalizedString.bind(void 0, str_5);
var loadedCommentsModule;
async function loadCommentsModule() {
  if (!loadedCommentsModule) {
    loadedCommentsModule = await import("./..\\..\\ui\\comments\\comments.js");
  }
  return loadedCommentsModule;
}
function isCommentsEnabled(config) {
  return Boolean(config?.devToolsComments?.enabled);
}
UI5.ActionRegistration.registerActionExtension({
  category: "GLOBAL",
  actionId: "comments.toggle-comment-mode",
  title: i18nLazyString5(UIStrings5.toggleCommentMode),
  iconClass: "comment-mode",
  toggleable: true,
  condition: isCommentsEnabled,
  async loadActionDelegate() {
    const Comments = await loadCommentsModule();
    return new Comments.CommentsOverlayWidget.ActionDelegate();
  }
});
UI5.Toolbar.registerToolbarItem({
  actionId: "comments.toggle-comment-mode",
  location: "main-toolbar-left",
  order: 1,
  condition: isCommentsEnabled
});

// gen/front_end/panels/settings/settings-meta.js
import * as i18n11 from "./..\\..\\core\\i18n\\i18n.js";
import * as UI6 from "./..\\..\\ui\\legacy\\legacy.js";
import * as Common5 from "./..\\..\\core\\common\\common.js";
import * as i18n32 from "./..\\..\\core\\i18n\\i18n.js";
import * as Root2 from "./..\\..\\core\\root\\root.js";
import * as UI22 from "./..\\..\\ui\\legacy\\legacy.js";
var UIStrings6 = {
  /**
   * @description Title of the Devices tab/tool. Devices refers to e.g., phones/tablets.
   */
  devices: "Devices",
  /**
   * @description Command that opens the device emulation view.
   */
  showDevices: "Show Devices"
};
var str_6 = i18n11.i18n.registerUIStrings("panels/settings/emulation/emulation-meta.ts", UIStrings6);
var i18nLazyString6 = i18n11.i18n.getLazilyComputedLocalizedString.bind(void 0, str_6);
var loadedEmulationModule;
async function loadEmulationModule() {
  if (!loadedEmulationModule) {
    loadedEmulationModule = await import("./..\\..\\panels\\settings\\emulation\\emulation.js");
  }
  return loadedEmulationModule;
}
UI6.ViewManager.registerViewExtension({
  location: "settings-view",
  commandPrompt: i18nLazyString6(UIStrings6.showDevices),
  title: i18nLazyString6(UIStrings6.devices),
  order: 30,
  async loadView() {
    const Emulation = await loadEmulationModule();
    return new Emulation.DevicesSettingsTab.DevicesSettingsTab();
  },
  id: "devices",
  settings: [
    "standard-emulated-device-list",
    "custom-emulated-device-list"
  ],
  iconName: "devices"
});
var UIStrings22 = {
  /**
   * @description Text for keyboard shortcuts.
   */
  shortcuts: "Shortcuts",
  /**
   * @description Text in Settings.
   */
  preferences: "Preferences",
  /**
   * @description Text in Settings.
   */
  experiments: "Experiments",
  /**
   * @description Title of Ignore list settings.
   */
  ignoreList: "Ignore list",
  /**
   * @description Command for showing the keyboard shortcuts in Settings.
   */
  showShortcuts: "Show Shortcuts",
  /**
   * @description Command for showing the Preferences tab in Settings.
   */
  showPreferences: "Show Preferences",
  /**
   * @description Command for showing the Experiments tab in Settings.
   */
  showExperiments: "Show Experiments",
  /**
   * @description Command for showing the Ignore list settings.
   */
  showIgnoreList: "Show Ignore list",
  /**
   * @description Name of the Settings view.
   */
  settings: "Settings",
  /**
   * @description Text for the documentation of something.
   */
  documentation: "Documentation",
  /**
   * @description Text for AI innovations settings.
   */
  aiInnovations: "AI innovations",
  /**
   * @description Command for showing the AI innovations settings.
   */
  showAiInnovations: "Show AI innovations",
  /**
   * @description Text of a DOM element in Workspace settings tab of the Workspace settings in Settings.
   */
  workspace: "Workspace",
  /**
   * @description Command for showing the Workspace tool in Settings.
   */
  showWorkspace: "Show Workspace settings"
};
var str_22 = i18n32.i18n.registerUIStrings("panels/settings/settings-meta.ts", UIStrings22);
var i18nLazyString22 = i18n32.i18n.getLazilyComputedLocalizedString.bind(void 0, str_22);
var loadedSettingsModule;
async function loadSettingsModule() {
  if (!loadedSettingsModule) {
    loadedSettingsModule = await import("./..\\..\\panels\\settings\\settings.js");
  }
  return loadedSettingsModule;
}
UI22.ViewManager.registerViewExtension({
  location: "settings-view",
  id: "preferences",
  title: i18nLazyString22(UIStrings22.preferences),
  commandPrompt: i18nLazyString22(UIStrings22.showPreferences),
  order: 0,
  async loadView() {
    const Settings22 = await loadSettingsModule();
    return new Settings22.SettingsScreen.GenericSettingsTab();
  },
  iconName: "gear"
});
UI22.ViewManager.registerViewExtension({
  location: "settings-view",
  id: "workspace",
  title: i18nLazyString22(UIStrings22.workspace),
  commandPrompt: i18nLazyString22(UIStrings22.showWorkspace),
  order: 1,
  async loadView() {
    const Settings22 = await loadSettingsModule();
    return new Settings22.WorkspaceSettingsTab.WorkspaceSettingsTab();
  },
  iconName: "folder"
});
UI22.ViewManager.registerViewExtension({
  location: "settings-view",
  id: "chrome-ai",
  title: i18nLazyString22(UIStrings22.aiInnovations),
  commandPrompt: i18nLazyString22(UIStrings22.showAiInnovations),
  order: 2,
  async loadView() {
    const Settings22 = await loadSettingsModule();
    return new Settings22.AISettingsTab.AISettingsTab();
  },
  iconName: "button-magic",
  settings: ["console-insights-enabled"],
  condition: (config) => {
    return (config?.aidaAvailability?.enabled && (config?.devToolsConsoleInsights?.enabled || config?.devToolsFreestyler?.enabled)) ?? false;
  }
});
UI22.ViewManager.registerViewExtension({
  location: "settings-view",
  id: "experiments",
  title: i18nLazyString22(UIStrings22.experiments),
  commandPrompt: i18nLazyString22(UIStrings22.showExperiments),
  order: 3,
  experiment: Root2.ExperimentNames.ExperimentName.ALL,
  async loadView() {
    const Settings22 = await loadSettingsModule();
    return new Settings22.SettingsScreen.ExperimentsSettingsTab();
  },
  iconName: "experiment"
});
UI22.ViewManager.registerViewExtension({
  location: "settings-view",
  id: "blackbox",
  title: i18nLazyString22(UIStrings22.ignoreList),
  commandPrompt: i18nLazyString22(UIStrings22.showIgnoreList),
  order: 4,
  async loadView() {
    const Settings22 = await loadSettingsModule();
    return new Settings22.FrameworkIgnoreListSettingsTab.FrameworkIgnoreListSettingsTab();
  },
  iconName: "clear-list"
});
UI22.ViewManager.registerViewExtension({
  location: "settings-view",
  id: "keybinds",
  title: i18nLazyString22(UIStrings22.shortcuts),
  commandPrompt: i18nLazyString22(UIStrings22.showShortcuts),
  order: 100,
  async loadView() {
    const Settings22 = await loadSettingsModule();
    return new Settings22.KeybindsSettingsTab.KeybindsSettingsTab();
  },
  iconName: "keyboard"
});
UI22.ActionRegistration.registerActionExtension({
  category: "SETTINGS",
  actionId: "settings.show",
  title: i18nLazyString22(UIStrings22.settings),
  async loadActionDelegate() {
    const Settings22 = await loadSettingsModule();
    return new Settings22.SettingsScreen.ActionDelegate();
  },
  iconClass: "gear",
  bindings: [
    {
      shortcut: "F1",
      keybindSets: [
        "devToolsDefault"
      ]
    },
    {
      shortcut: "Shift+?"
    },
    {
      platform: "windows,linux",
      shortcut: "Ctrl+,",
      keybindSets: [
        "vsCode"
      ]
    },
    {
      platform: "mac",
      shortcut: "Meta+,",
      keybindSets: [
        "vsCode"
      ]
    }
  ]
});
UI22.ActionRegistration.registerActionExtension({
  category: "SETTINGS",
  actionId: "settings.documentation",
  title: i18nLazyString22(UIStrings22.documentation),
  async loadActionDelegate() {
    const Settings22 = await loadSettingsModule();
    return new Settings22.SettingsScreen.ActionDelegate();
  }
});
UI22.ActionRegistration.registerActionExtension({
  category: "SETTINGS",
  actionId: "settings.shortcuts",
  title: i18nLazyString22(UIStrings22.showShortcuts),
  async loadActionDelegate() {
    const Settings22 = await loadSettingsModule();
    return new Settings22.SettingsScreen.ActionDelegate();
  },
  bindings: [
    {
      platform: "windows,linux",
      shortcut: "Ctrl+K Ctrl+S",
      keybindSets: [
        "vsCode"
      ]
    },
    {
      platform: "mac",
      shortcut: "Meta+K Meta+S",
      keybindSets: [
        "vsCode"
      ]
    }
  ]
});
UI22.ViewManager.registerLocationResolver({
  name: "settings-view",
  category: "SETTINGS",
  async loadResolver() {
    const Settings22 = await loadSettingsModule();
    return Settings22.SettingsScreen.SettingsScreen.instance();
  }
});
Common5.Revealer.registerRevealer({
  contextTypes() {
    return [
      Common5.Settings.Setting,
      Root2.Runtime.Experiment
    ];
  },
  async loadRevealer() {
    const Settings22 = await loadSettingsModule();
    return new Settings22.SettingsScreen.Revealer();
  }
});
UI22.ContextMenu.registerItem({
  location: "mainMenu/footer",
  actionId: "settings.shortcuts"
});
UI22.ContextMenu.registerItem({
  location: "mainMenuHelp/default",
  actionId: "settings.documentation"
});

// gen/front_end/entrypoints/shell/shell.prebundle.js
import "./..\\main\\main.js";
//# sourceMappingURL=shell.js.map
