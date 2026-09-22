// gen/front_end/entrypoints/devtools_app/devtools_app.prebundle.js
import "./..\\shell\\shell.js";

// gen/front_end/panels/elements/elements-meta.js
import * as Common from "./..\\..\\core\\common\\common.js";
import * as i18n from "./..\\..\\core\\i18n\\i18n.js";
import * as Root from "./..\\..\\core\\root\\root.js";
import * as SDK from "./..\\..\\core\\sdk\\sdk.js";
import * as UI from "./..\\..\\ui\\legacy\\legacy.js";
import * as SettingsUI from "./..\\..\\ui\\settings\\settings.js";
import * as Elements from "./..\\..\\panels\\elements\\elements.js";
var UIStrings = {
  /**
   * @description Text of a setting that turn on the measuring rulers when hover over a target.
   */
  rulersOnHover: "Rulers on hover",
  /**
   * @description Text of an option that turn on the measuring rulers when hover over a target through the Command Menu.
   */
  showRulersOnHover: "Show rulers on hover",
  /**
   * @description Text of a setting that do turn off the measuring rulers when hover over a target.
   */
  doNotShowRulersOnHover: "Don\u2019t show rulers on hover",
  /**
   * @description Title of a setting under the Elements category in Settings.
   */
  apca: "Advanced Perceptual Contrast Algorithm (APCA) replacing previous contrast ratio and AA/AAA guidelines",
  /**
   * @description Title of a setting that turns on grid area name labels.
   */
  showAreaNames: "Show area names",
  /**
   * @description Title of a setting under the Grid category that turns CSS Grid Area highlighting on.
   */
  showGridNamedAreas: "Show grid named areas",
  /**
   * @description Title of a setting under the Grid category that turns CSS Grid Area highlighting off.
   */
  doNotShowGridNamedAreas: "Do not show grid named areas",
  /**
   * @description Title of a setting that turns on grid track size labels.
   */
  showTrackSizes: "Show track sizes",
  /**
   * @description Title for CSS Grid tooling option.
   */
  showGridTrackSizes: "Show grid track sizes",
  /**
   * @description Title for CSS Grid tooling option.
   */
  doNotShowGridTrackSizes: "Do not show grid track sizes",
  /**
   * @description Title of a setting that turns on grid extension lines.
   */
  extendGridLines: "Extend grid lines",
  /**
   * @description Title of a setting that turns off the grid extension lines.
   */
  doNotExtendGridLines: "Do not extend grid lines",
  /**
   * @description Title of a setting that turns on grid line labels.
   */
  showLineLabels: "Show line labels",
  /**
   * @description Title of a setting that turns off the grid line labels.
   */
  hideLineLabels: "Hide line labels",
  /**
   * @description Title of a setting that turns on grid line number labels.
   */
  showLineNumbers: "Show line numbers",
  /**
   * @description Title of a setting that turns on grid line name labels.
   */
  showLineNames: "Show line names",
  /**
   * @description Command for showing the 'Elements' panel. Elements refers to HTML elements.
   */
  showElements: "Show Elements",
  /**
   * @description Title of the Elements Panel. Elements refers to HTML elements.
   */
  elements: "Elements",
  /**
   * @description Command for showing the 'Event Listeners' tool. Refers to DOM Event listeners.
   */
  showEventListeners: "Show Event Listeners",
  /**
   * @description Title of the 'Event Listeners' tool in the sidebar of the elements panel. Refers to
   * DOM Event listeners.
   */
  eventListeners: "Event Listeners",
  /**
   * @description Command for showing the 'Properties' tool. Refers to HTML properties.
   */
  showProperties: "Show Properties",
  /**
   * @description Title of the 'Properties' tool in the sidebar of the elements tool. Refers to HTML
   * properties.
   */
  properties: "Properties",
  /**
   * @description Command for showing the 'Layout' tool
   */
  showLayout: "Show Layout",
  /**
   * @description The title of the 'Layout' tool in the sidebar of the elements panel.
   */
  layout: "Layout",
  /**
   * @description Command to hide a HTML element in the Elements tree.
   */
  hideElement: "Hide element",
  /**
   * @description A context menu item (command) in the Elements panel that allows the user to edit the
   * currently selected node as raw HTML text.
   */
  editAsHtml: "Edit as HTML",
  /**
   * @description A context menu item (command) in the Elements panel that creates an exact copy of
   * this HTML element.
   */
  duplicateElement: "Duplicate element",
  /**
   * @description A command in the Elements panel to undo the last action the user took.
   */
  undo: "Undo",
  /**
   * @description A command in the Elements panel to redo the last action the user took (undo an
   * undo).
   */
  redo: "Redo",
  /**
   * @description A command in the Elements panel to capture a screenshot of the selected area.
   */
  captureAreaScreenshot: "Capture area screenshot",
  /**
   * @description Title/tooltip of an action in the elements panel to toggle element search on/off.
   */
  selectAnElementInThePageTo: "Select an element in the page to inspect it",
  /**
   * @description Title/tooltip of an action in the Elements panel to add a new style rule.
   */
  newStyleRule: "New style rule",
  /**
   * @description Title/tooltip of an action in the Elements panel to refresh the event listeners.
   */
  refreshEventListeners: "Refresh event listeners",
  /**
   * @description Title of a setting under the Elements category in Settings. If
   *              this option is on, the Elements panel will automatically wrap
   *              long lines in the DOM tree and try to avoid showing a horizontal
   *              scrollbar if possible.
   */
  wordWrap: "Word wrap",
  /**
   * @description Title of an action in the Elements panel that toggles the 'Word
   *              wrap' setting.
   */
  toggleWordWrap: "Toggle word wrap",
  /**
   * @description Title of a setting under the Elements category. Whether to show/hide code comments in HTML.
   */
  htmlComments: "HTML comments",
  /**
   * @description Title of an option under the Elements category that can be invoked through the Command Menu.
   */
  showHtmlComments: "Show `HTML` comments",
  /**
   * @description Title of an option under the Elements category that can be invoked through the Command Menu.
   */
  hideHtmlComments: "Hide `HTML` comments",
  /**
   * @description Title of a setting under the Elements category in Settings. Whether the position of
   * the DOM node on the actual website should be highlighted/revealed to the user when they hover
   * over the corresponding node in the DOM tree in DevTools.
   */
  revealDomNodeOnHover: "Reveal `DOM` node on hover",
  /**
   * @description Title of a setting under the Elements category in Settings. Turns on a mode where
   * the inspect tooltip (an information pane that hovers next to selected DOM elements) has extra
   * detail.
   */
  detailedInspectTooltip: "Detailed inspect tooltip",
  /**
   * @description Title of a setting under the Elements category in Settings. Turns on a mode where
   * hovering over CSS properties in the Styles tab will display a popover with documentation.
   */
  CSSDocumentationTooltip: "CSS documentation tooltip",
  /**
   * @description A context menu item (command) in the Elements panel that copies the styles of
   * an HTML element.
   */
  copyStyles: "Copy styles",
  /**
   * @description A context menu item (command) in the Elements panel that toggles the view between
   * the element and a11y trees.
   */
  toggleA11yTree: "Toggle accessibility tree",
  /**
   * @description Title of a setting under the Elements category. Whether to show or hide
   * the shadow DOM nodes of HTML elements that are built into the browser (e.g. the <input> element).
   */
  userAgentShadowDOM: "User agent shadow `DOM`",
  /**
   * @description Command for showing the 'Computed' tool. Displays computed CSS styles in Elements sidebar.
   */
  showComputedStyles: "Show Computed styles",
  /**
   * @description Command for showing the 'Styles' tool. Displays CSS styles in Elements sidebar.
   */
  showStyles: "Show Styles",
  /**
   * @description Command for toggling the eye dropper when the color picker is open.
   */
  toggleEyeDropper: "Toggle eye dropper",
  /**
   * @description Title of a setting under the Elements category.
   */
  cssAnimationsOnlyWhenAnimationsTabOpen: "Show animation styles only when the Animations tab is open",
  /**
   * @description Whether CSS rules that do not apply active styles in the Styles tab are collapsed by default.
   */
  collapseNonContributingCSSRules: "Collapse non-contributing CSS rules",
  /**
   * @description Title of a setting in the Event listeners tab.
   */
  frameworkListeners: "Framework listeners"
};
var str_ = i18n.i18n.registerUIStrings("panels/elements/elements-meta.ts", UIStrings);
var i18nLazyString = i18n.i18n.getLazilyComputedLocalizedString.bind(void 0, str_);
var loadedElementsModule;
async function loadElementsModule() {
  if (!loadedElementsModule) {
    loadedElementsModule = await import("./..\\..\\panels\\elements\\elements.js");
  }
  return loadedElementsModule;
}
function maybeRetrieveContextTypes(getClassCallBack) {
  if (loadedElementsModule === void 0) {
    return [];
  }
  return getClassCallBack(loadedElementsModule);
}
UI.ViewManager.registerViewExtension({
  location: "panel",
  id: "elements",
  commandPrompt: i18nLazyString(UIStrings.showElements),
  title: i18nLazyString(UIStrings.elements),
  order: 10,
  persistence: "permanent",
  hasToolbar: false,
  async loadView(universe) {
    const Elements2 = await loadElementsModule();
    const { targetManager, settings } = universe;
    return Elements2.ElementsPanel.ElementsPanel.instance({ forceNew: null, targetManager, settings });
  }
});
UI.ActionRegistration.registerActionExtension({
  actionId: "elements.show-styles",
  category: "ELEMENTS",
  title: i18nLazyString(UIStrings.showStyles),
  async loadActionDelegate() {
    const Elements2 = await loadElementsModule();
    return new Elements2.ElementsPanel.ElementsActionDelegate();
  }
});
UI.ActionRegistration.registerActionExtension({
  actionId: "elements.show-computed",
  category: "ELEMENTS",
  title: i18nLazyString(UIStrings.showComputedStyles),
  async loadActionDelegate() {
    const Elements2 = await loadElementsModule();
    return new Elements2.ElementsPanel.ElementsActionDelegate();
  }
});
UI.ActionRegistration.registerActionExtension({
  actionId: "elements.hide-element",
  category: "ELEMENTS",
  title: i18nLazyString(UIStrings.hideElement),
  async loadActionDelegate() {
    const Elements2 = await loadElementsModule();
    return new Elements2.ElementsPanel.ElementsActionDelegate();
  },
  contextTypes() {
    return maybeRetrieveContextTypes((Elements2) => [Elements2.ElementsPanel.ElementsPanel]);
  },
  bindings: [
    {
      shortcut: "H"
    }
  ]
});
UI.ActionRegistration.registerActionExtension({
  actionId: "elements.toggle-eye-dropper",
  category: "ELEMENTS",
  title: i18nLazyString(UIStrings.toggleEyeDropper),
  async loadActionDelegate() {
    const Elements2 = await loadElementsModule();
    return new Elements2.ElementsPanel.ElementsActionDelegate();
  },
  contextTypes() {
    return maybeRetrieveContextTypes((Elements2) => [Elements2.ColorSwatchPopoverIcon.ColorSwatchPopoverIcon]);
  },
  bindings: [
    {
      shortcut: "c"
    }
  ]
});
UI.ActionRegistration.registerActionExtension({
  actionId: "elements.edit-as-html",
  category: "ELEMENTS",
  title: i18nLazyString(UIStrings.editAsHtml),
  async loadActionDelegate() {
    const Elements2 = await loadElementsModule();
    return new Elements2.ElementsPanel.ElementsActionDelegate();
  },
  contextTypes() {
    return maybeRetrieveContextTypes((Elements2) => [Elements2.ElementsPanel.ElementsPanel]);
  },
  bindings: [
    {
      shortcut: "F2"
    }
  ]
});
UI.ActionRegistration.registerActionExtension({
  actionId: "elements.duplicate-element",
  category: "ELEMENTS",
  title: i18nLazyString(UIStrings.duplicateElement),
  async loadActionDelegate() {
    const Elements2 = await loadElementsModule();
    return new Elements2.ElementsPanel.ElementsActionDelegate();
  },
  contextTypes() {
    return maybeRetrieveContextTypes((Elements2) => [Elements2.ElementsPanel.ElementsPanel]);
  },
  bindings: [
    {
      shortcut: "Shift+Alt+Down"
    }
  ]
});
UI.ActionRegistration.registerActionExtension({
  actionId: "elements.copy-styles",
  category: "ELEMENTS",
  title: i18nLazyString(UIStrings.copyStyles),
  async loadActionDelegate() {
    const Elements2 = await loadElementsModule();
    return new Elements2.ElementsPanel.ElementsActionDelegate();
  },
  contextTypes() {
    return maybeRetrieveContextTypes((Elements2) => [Elements2.ElementsPanel.ElementsPanel]);
  },
  bindings: [
    {
      shortcut: "Ctrl+Alt+C",
      platform: "windows,linux"
    },
    {
      shortcut: "Meta+Alt+C",
      platform: "mac"
    }
  ]
});
UI.ActionRegistration.registerActionExtension({
  actionId: "elements.toggle-a11y-tree",
  category: "ELEMENTS",
  title: i18nLazyString(UIStrings.toggleA11yTree),
  toggleable: true,
  async loadActionDelegate() {
    const Elements2 = await loadElementsModule();
    return new Elements2.ElementsPanel.ElementsActionDelegate();
  },
  contextTypes() {
    return maybeRetrieveContextTypes((Elements2) => [Elements2.ElementsPanel.ElementsPanel]);
  },
  bindings: [
    {
      shortcut: "A"
    }
  ]
});
UI.ActionRegistration.registerActionExtension({
  actionId: "elements.undo",
  category: "ELEMENTS",
  title: i18nLazyString(UIStrings.undo),
  async loadActionDelegate() {
    const Elements2 = await loadElementsModule();
    return new Elements2.ElementsPanel.ElementsActionDelegate();
  },
  contextTypes() {
    return maybeRetrieveContextTypes((Elements2) => [Elements2.ElementsPanel.ElementsPanel]);
  },
  bindings: [
    {
      shortcut: "Ctrl+Z",
      platform: "windows,linux"
    },
    {
      shortcut: "Meta+Z",
      platform: "mac"
    }
  ]
});
UI.ActionRegistration.registerActionExtension({
  actionId: "elements.redo",
  category: "ELEMENTS",
  title: i18nLazyString(UIStrings.redo),
  async loadActionDelegate() {
    const Elements2 = await loadElementsModule();
    return new Elements2.ElementsPanel.ElementsActionDelegate();
  },
  contextTypes() {
    return maybeRetrieveContextTypes((Elements2) => [Elements2.ElementsPanel.ElementsPanel]);
  },
  bindings: [
    {
      shortcut: "Ctrl+Y",
      platform: "windows,linux"
    },
    {
      shortcut: "Meta+Shift+Z",
      platform: "mac"
    }
  ]
});
UI.ActionRegistration.registerActionExtension({
  actionId: "elements.capture-area-screenshot",
  async loadActionDelegate() {
    const Elements2 = await loadElementsModule();
    return new Elements2.InspectElementModeController.ToggleSearchActionDelegate();
  },
  condition: Root.Runtime.conditions.canDock,
  title: i18nLazyString(UIStrings.captureAreaScreenshot),
  category: "SCREENSHOT"
});
UI.ActionRegistration.registerActionExtension({
  category: "ELEMENTS",
  actionId: "elements.toggle-element-search",
  toggleable: true,
  async loadActionDelegate() {
    const Elements2 = await loadElementsModule();
    return new Elements2.InspectElementModeController.ToggleSearchActionDelegate();
  },
  title: i18nLazyString(UIStrings.selectAnElementInThePageTo),
  iconClass: "select-element",
  bindings: [
    {
      shortcut: "Ctrl+Shift+C",
      platform: "windows,linux"
    },
    {
      shortcut: "Meta+Shift+C",
      platform: "mac"
    }
  ],
  configurableBindings: false
});
UI.ActionRegistration.registerActionExtension({
  category: "ELEMENTS",
  actionId: "elements.new-style-rule",
  title: i18nLazyString(UIStrings.newStyleRule),
  iconClass: "plus",
  async loadActionDelegate() {
    const Elements2 = await loadElementsModule();
    return new Elements2.StylesSidebarPane.ActionDelegate();
  },
  contextTypes() {
    return maybeRetrieveContextTypes((Elements2) => [Elements2.StylesSidebarPane.StylesSidebarPane]);
  }
});
Common.Settings.registerSettingExtension({
  category: "ELEMENTS",
  storageType: "Synced",
  order: 1,
  title: i18nLazyString(UIStrings.userAgentShadowDOM),
  settingName: "show-ua-shadow-dom",
  settingType: "boolean",
  defaultValue: false
});
Common.Settings.registerSettingExtension({
  category: "ELEMENTS",
  storageType: "Synced",
  order: 2,
  title: i18nLazyString(UIStrings.wordWrap),
  settingName: "dom-word-wrap",
  settingType: "boolean",
  defaultValue: true
});
UI.ActionRegistration.registerActionExtension({
  category: "ELEMENTS",
  actionId: "elements.toggle-word-wrap",
  async loadActionDelegate() {
    const Elements2 = await loadElementsModule();
    return new Elements2.ElementsPanel.ElementsActionDelegate();
  },
  title: i18nLazyString(UIStrings.toggleWordWrap),
  contextTypes() {
    return maybeRetrieveContextTypes((Elements2) => [Elements2.ElementsPanel.ElementsPanel]);
  },
  bindings: [
    {
      shortcut: "Alt+Z",
      keybindSets: [
        "vsCode"
        /* UI.ActionRegistration.KeybindSet.VS_CODE */
      ]
    }
  ]
});
Common.Settings.registerSettingExtension({
  category: "ELEMENTS",
  storageType: "Synced",
  order: 3,
  title: i18nLazyString(UIStrings.htmlComments),
  settingName: "show-html-comments",
  settingType: "boolean",
  defaultValue: true,
  options: [
    {
      value: true,
      title: i18nLazyString(UIStrings.showHtmlComments)
    },
    {
      value: false,
      title: i18nLazyString(UIStrings.hideHtmlComments)
    }
  ]
});
Common.Settings.registerSettingExtension({
  category: "ELEMENTS",
  storageType: "Synced",
  order: 4,
  title: i18nLazyString(UIStrings.revealDomNodeOnHover),
  settingName: "highlight-node-on-hover-in-overlay",
  settingType: "boolean",
  defaultValue: true
});
Common.Settings.registerSettingExtension({
  category: "ELEMENTS",
  storageType: "Synced",
  order: 5,
  title: i18nLazyString(UIStrings.detailedInspectTooltip),
  settingName: "show-detailed-inspect-tooltip",
  settingType: "boolean",
  defaultValue: true
});
Common.Settings.registerSettingExtension({
  category: "ELEMENTS",
  storageType: "Synced",
  order: 6,
  title: i18nLazyString(UIStrings.cssAnimationsOnlyWhenAnimationsTabOpen),
  settingName: "css-animations-only-when-animations-tab-open",
  settingType: "boolean",
  defaultValue: true
});
Common.Settings.registerSettingExtension({
  category: "ELEMENTS",
  storageType: "Synced",
  order: 7,
  title: i18nLazyString(UIStrings.collapseNonContributingCSSRules),
  settingName: "collapse-non-contributing-css-rules",
  settingType: "boolean",
  defaultValue: false
});
Common.Settings.registerSettingExtension({
  settingName: "show-event-listeners-for-ancestors",
  settingType: "boolean",
  defaultValue: true
});
Common.Settings.registerSettingExtension({
  category: "ADORNER",
  storageType: "Synced",
  settingName: "adorner-settings",
  settingType: "array",
  defaultValue: []
});
Common.Settings.registerSettingExtension({
  category: "ELEMENTS",
  storageType: "Synced",
  title: i18nLazyString(UIStrings.CSSDocumentationTooltip),
  settingName: "show-css-property-documentation-on-hover",
  settingType: "boolean",
  defaultValue: true
});
UI.ContextMenu.registerProvider({
  contextTypes() {
    return [
      SDK.RemoteObject.RemoteObject,
      SDK.DOMModel.DOMNode,
      SDK.DOMModel.DeferredDOMNode
    ];
  },
  async loadProvider() {
    const Elements2 = await loadElementsModule();
    return new Elements2.ElementsPanel.ContextMenuProvider();
  },
  experiment: void 0
});
UI.ViewManager.registerLocationResolver({
  name: "elements-sidebar",
  category: "ELEMENTS",
  async loadResolver() {
    const Elements2 = await loadElementsModule();
    return Elements2.ElementsPanel.ElementsPanel.instance();
  }
});
Common.Revealer.registerRevealer({
  contextTypes() {
    return [
      SDK.DOMModel.DOMNode,
      SDK.DOMModel.DeferredDOMNode,
      SDK.RemoteObject.RemoteObject,
      SDK.DOMModel.AdoptedStyleSheet,
      Elements.ElementsPanel.NodeComputedStyles
    ];
  },
  destination: Common.Revealer.RevealerDestination.ELEMENTS_PANEL,
  async loadRevealer() {
    const Elements2 = await loadElementsModule();
    return new Elements2.ElementsPanel.DOMNodeRevealer();
  }
});
Common.Revealer.registerRevealer({
  contextTypes() {
    return [
      SDK.CSSProperty.CSSProperty
    ];
  },
  destination: Common.Revealer.RevealerDestination.STYLES_SIDEBAR,
  async loadRevealer() {
    const Elements2 = await loadElementsModule();
    return new Elements2.ElementsPanel.CSSPropertyRevealer();
  }
});
UI.Toolbar.registerToolbarItem({
  async loadItem() {
    const Elements2 = await loadElementsModule();
    return Elements2.LayersWidget.ButtonProvider.instance();
  },
  order: 1,
  location: "styles-sidebarpane-toolbar"
});
UI.Toolbar.registerToolbarItem({
  async loadItem() {
    const Elements2 = await loadElementsModule();
    return Elements2.ElementStatePaneWidget.ButtonProvider.instance();
  },
  order: 2,
  location: "styles-sidebarpane-toolbar"
});
UI.Toolbar.registerToolbarItem({
  async loadItem() {
    const Elements2 = await loadElementsModule();
    return Elements2.ClassesPaneWidget.ButtonProvider.instance();
  },
  order: 3,
  location: "styles-sidebarpane-toolbar"
});
UI.Toolbar.registerToolbarItem({
  async loadItem() {
    const Elements2 = await loadElementsModule();
    return Elements2.StylesSidebarPane.ButtonProvider.instance();
  },
  order: 100,
  location: "styles-sidebarpane-toolbar"
});
UI.Toolbar.registerToolbarItem({
  actionId: "elements.toggle-element-search",
  location: "main-toolbar-left",
  order: 0
});
Common.Settings.registerSettingExtension({
  category: "",
  storageType: "Global",
  title: i18nLazyString(UIStrings.frameworkListeners),
  settingName: "show-frameowkr-listeners",
  settingType: "boolean",
  defaultValue: true
});
SettingsUI.SettingUIRegistration.register(SDK.SDKSettings.showMetricsRulersSettingDescriptor, {
  category: "ELEMENTS",
  title: i18nLazyString(UIStrings.rulersOnHover),
  options: [
    {
      value: true,
      title: i18nLazyString(UIStrings.showRulersOnHover)
    },
    {
      value: false,
      title: i18nLazyString(UIStrings.doNotShowRulersOnHover)
    }
  ]
});
SettingsUI.SettingUIRegistration.register(SDK.SDKSettings.apcaSettingDescriptor, {
  category: "ELEMENTS",
  title: i18nLazyString(UIStrings.apca)
});
SettingsUI.SettingUIRegistration.register(SDK.SDKSettings.showGridAreasSettingDescriptor, {
  category: "GRID",
  title: i18nLazyString(UIStrings.showAreaNames),
  options: [
    {
      value: true,
      title: i18nLazyString(UIStrings.showGridNamedAreas)
    },
    {
      value: false,
      title: i18nLazyString(UIStrings.doNotShowGridNamedAreas)
    }
  ]
});
SettingsUI.SettingUIRegistration.register(SDK.SDKSettings.showGridTrackSizesSettingDescriptor, {
  category: "GRID",
  title: i18nLazyString(UIStrings.showTrackSizes),
  options: [
    {
      value: true,
      title: i18nLazyString(UIStrings.showGridTrackSizes)
    },
    {
      value: false,
      title: i18nLazyString(UIStrings.doNotShowGridTrackSizes)
    }
  ]
});
SettingsUI.SettingUIRegistration.register(SDK.SDKSettings.extendGridLinesSettingDescriptor, {
  category: "GRID",
  title: i18nLazyString(UIStrings.extendGridLines),
  options: [
    {
      value: true,
      title: i18nLazyString(UIStrings.extendGridLines)
    },
    {
      value: false,
      title: i18nLazyString(UIStrings.doNotExtendGridLines)
    }
  ]
});
SettingsUI.SettingUIRegistration.register(SDK.SDKSettings.showGridLineLabelsSettingDescriptor, {
  category: "GRID",
  title: i18nLazyString(UIStrings.showLineLabels),
  options: [
    {
      title: i18nLazyString(UIStrings.hideLineLabels),
      text: i18nLazyString(UIStrings.hideLineLabels),
      value: "none"
    },
    {
      title: i18nLazyString(UIStrings.showLineNumbers),
      text: i18nLazyString(UIStrings.showLineNumbers),
      value: "lineNumbers"
    },
    {
      title: i18nLazyString(UIStrings.showLineNames),
      text: i18nLazyString(UIStrings.showLineNames),
      value: "lineNames"
    }
  ]
});

// gen/front_end/panels/network/network-meta.js
import * as Common2 from "./..\\..\\core\\common\\common.js";
import * as i18n3 from "./..\\..\\core\\i18n\\i18n.js";
import * as Root2 from "./..\\..\\core\\root\\root.js";
import * as SDK2 from "./..\\..\\core\\sdk\\sdk.js";
import * as Logs from "./..\\..\\models\\logs\\logs.js";
import * as Workspace from "./..\\..\\models\\workspace\\workspace.js";
import * as PanelCommon from "./..\\..\\panels\\common\\common.js";
import * as UI2 from "./..\\..\\ui\\legacy\\legacy.js";
import * as SettingsUI2 from "./..\\..\\ui\\settings\\settings.js";
import * as NetworkForward from "./..\\..\\panels\\network\\forward\\forward.js";
var UIStrings2 = {
  /**
   * @description Text to keep the log after refreshing.
   */
  keepLog: "Keep log",
  /**
   * @description A term that can be used to search in the command menu, and will find the search
   * result 'Keep log on page reload / navigation'. This is an additional search term to help
   * the user find the setting even when they don't know the exact name of it.
   */
  keep: "keep",
  /**
   * @description A term that can be used to search in the command menu, and will find the search
   * result 'Keep log on page reload / navigation'. This is an additional search term to help
   * the user find the setting even when they don't know the exact name of it.
   */
  preserve: "preserve",
  /**
   * @description A term that can be used to search in the command menu, and will find the search
   * result 'Keep log on page reload / navigation'. This is an additional search term to help
   * the user find the setting even when they don't know the exact name of it.
   */
  clearTag: "clear",
  /**
   * @description A term that can be used to search in the command menu, and will find the search
   * result 'Keep log on page reload / navigation'. This is an additional search term to help
   * the user find the setting even when they don't know the exact name of it.
   */
  reset: "reset",
  /**
   * @description Title of a setting under the Network category that can be invoked through the Command Menu.
   */
  keepLogOnPageReload: "Keep log on page reload / navigation",
  /**
   * @description Title of a setting under the Network category that can be invoked through the Command Menu.
   */
  doNotKeepLogOnPageReload: "Don\u2019t keep log on page reload / navigation",
  /**
   * @description Title of a setting under the Network category that can be invoked through the Command Menu.
   */
  enableCache: "Enable cache",
  /**
   * @description Title of a setting under the Network category that can be invoked through the Command Menu.
   */
  disableCache: "Disable cache while DevTools is open",
  /**
   * @description Tooltip text for a setting that controls the network cache. Disabling the network cache can simulate the network connections of users that are visiting a page for the first time.
   */
  networkCacheExplanation: "Disabling the network cache will simulate a network experience similar to a first time visitor.",
  /**
   * @description Title of a setting under the Network category.
   */
  networkRequestBlocking: "Network request blocking",
  /**
   * @description Title of a setting under the Network category that can be invoked through the Command Menu.
   */
  enableNetworkRequestBlocking: "Enable network request blocking",
  /**
   * @description Title of a setting under the Network category that can be invoked through the Command Menu.
   */
  disableNetworkRequestBlocking: "Disable network request blocking",
  /**
   * @description Command for showing the 'Network' tool
   */
  showNetwork: "Show Network",
  /**
   * @description Title of the Network tool
   */
  network: "Network",
  /**
   * @description Command for showing the 'Network request blocking' tool
   */
  showRequestConditions: "Show request conditions",
  /**
   * @description Title of the 'Request conditions' tool in the bottom drawer
   */
  networkRequestConditions: "Request conditions",
  /**
   * @description Command for showing the 'Network conditions' tool
   */
  showNetworkConditions: "Show Network conditions",
  /**
   * @description Title of the 'Network conditions' tool in the bottom drawer
   */
  networkConditions: "Network conditions",
  /**
   * @description A tag of Network Conditions tool that can be searched in the command menu
   */
  diskCache: "disk cache",
  /**
   * @description A tag of Network Conditions tool that can be searched in the command menu
   */
  networkThrottling: "network throttling",
  /**
   * @description Command for showing the 'Search' tool
   */
  showSearch: "Show Search",
  /**
   * @description Title of a search bar or tool
   */
  search: "Search",
  /**
   * @description Title of an action in the network tool to toggle recording
   */
  recordNetworkLog: "Record network log",
  /**
   * @description Title of an action in the network tool to toggle recording
   */
  stopRecordingNetworkLog: "Stop recording network log",
  /**
   * @description Title of an action that hides network request details
   */
  hideRequestDetails: "Hide request details",
  /**
   * @description Title of a setting under the Network category in Settings
   */
  colorcodeResourceTypes: "Color-code resource types",
  /**
   * @description A tag of Network color-code resource types that can be searched in the command menu
   */
  colorCode: "color code",
  /**
   * @description A tag of Network color-code resource types that can be searched in the command menu
   */
  resourceType: "resource type",
  /**
   * @description Title of a setting under the Network category that can be invoked through the Command Menu
   */
  colorCodeByResourceType: "Color code by resource type",
  /**
   * @description Title of a setting under the Network category that can be invoked through the Command Menu
   */
  useDefaultColors: "Use default colors",
  /**
   * @description Title of a setting under the Network category in Settings
   */
  groupNetworkLogByFrame: "Group network log by frame",
  /**
   * @description A tag of Group Network by frame setting that can be searched in the command menu
   */
  netWork: "network",
  /**
   * @description A tag of Group Network by frame setting that can be searched in the command menu
   */
  frame: "frame",
  /**
   * @description A tag of Group Network by frame setting that can be searched in the command menu
   */
  group: "group",
  /**
   * @description Title of a setting under the Network category that can be invoked through the Command Menu
   */
  groupNetworkLogItemsByFrame: "Group network log items by frame",
  /**
   * @description Title of a setting under the Network category that can be invoked through the Command Menu
   */
  dontGroupNetworkLogItemsByFrame: "Don\u2019t group network log items by frame",
  /**
   * @description Title of a button for clearing the network log
   */
  clear: "Clear network log",
  /**
   * @description Title of an action in the Network request blocking panel to add a new URL pattern to the blocklist.
   */
  addNetworkRequestBlockingOrThrottlingPattern: "Add network request blocking or throttling pattern",
  /**
   * @description Title of an action in the Network request blocking panel to clear all URL patterns.
   */
  removeAllNetworkRequestBlockingOrThrottlingPatterns: "Remove all network request blocking or throttling patterns",
  /**
   * @description Title of an action in the Network panel (and title of a setting in the Network category)
   *              that enables options in the UI to copy or export HAR (not translatable) with sensitive data.
   */
  allowToGenerateHarWithSensitiveData: "Allow to generate `HAR` with sensitive data",
  /**
   * @description Title of an action in the Network panel that disables options in the UI to copy or export
   *              HAR (not translatable) with sensitive data.
   */
  dontAllowToGenerateHarWithSensitiveData: "Don\u2019t allow to generate `HAR` with sensitive data",
  /**
   * @description Tooltip shown as documentation when hovering the (?) icon next to the "Allow to generate
   *              HAR with sensitive data" option in the Settings panel.
   */
  allowToGenerateHarWithSensitiveDataDocumentation: "By default generated HAR logs are sanitized and don\u2019t include `Cookie`, `Set-Cookie`, or `Authorization` HTTP headers. When this setting is enabled, options to export/copy HAR with sensitive data are provided."
};
var str_2 = i18n3.i18n.registerUIStrings("panels/network/network-meta.ts", UIStrings2);
var i18nLazyString2 = i18n3.i18n.getLazilyComputedLocalizedString.bind(void 0, str_2);
var i18nString = i18n3.i18n.getLocalizedString.bind(void 0, str_2);
var loadedNetworkModule;
var isNode = Root2.Runtime.Runtime.isNode();
async function loadNetworkModule() {
  if (!loadedNetworkModule) {
    loadedNetworkModule = await import("./..\\..\\panels\\network\\network.js");
  }
  return loadedNetworkModule;
}
function maybeRetrieveContextTypes2(getClassCallBack) {
  if (loadedNetworkModule === void 0) {
    return [];
  }
  return getClassCallBack(loadedNetworkModule);
}
UI2.ViewManager.registerViewExtension({
  location: "panel",
  id: "network",
  commandPrompt: i18nLazyString2(UIStrings2.showNetwork),
  title: i18nLazyString2(UIStrings2.network),
  order: 40,
  isPreviewFeature: isNode,
  async loadView() {
    const Network = await loadNetworkModule();
    return Network.NetworkPanel.NetworkPanel.instance();
  }
});
UI2.ViewManager.registerViewExtension({
  location: "drawer-view",
  id: "network.blocked-urls",
  commandPrompt: () => i18nString(UIStrings2.showRequestConditions),
  title: () => i18nString(UIStrings2.networkRequestConditions),
  persistence: "closeable",
  order: 60,
  async loadView() {
    const Network = await loadNetworkModule();
    return new Network.RequestConditionsDrawer.RequestConditionsDrawer();
  }
});
UI2.ViewManager.registerViewExtension({
  location: "drawer-view",
  id: "network.config",
  commandPrompt: i18nLazyString2(UIStrings2.showNetworkConditions),
  title: i18nLazyString2(UIStrings2.networkConditions),
  persistence: "closeable",
  order: 40,
  tags: [
    i18nLazyString2(UIStrings2.diskCache),
    i18nLazyString2(UIStrings2.networkThrottling),
    i18n3.i18n.lockedLazyString("useragent"),
    i18n3.i18n.lockedLazyString("user agent"),
    i18n3.i18n.lockedLazyString("user-agent")
  ],
  async loadView() {
    const Network = await loadNetworkModule();
    return Network.NetworkConfigView.NetworkConfigView.instance();
  }
});
UI2.ViewManager.registerViewExtension({
  location: "network-sidebar",
  id: "network.search-network-tab",
  commandPrompt: i18nLazyString2(UIStrings2.showSearch),
  title: i18nLazyString2(UIStrings2.search),
  persistence: "permanent",
  async loadView() {
    const Network = await loadNetworkModule();
    return Network.NetworkPanel.SearchNetworkView.instance();
  }
});
UI2.ActionRegistration.registerActionExtension({
  actionId: "network.toggle-recording",
  category: "NETWORK",
  iconClass: "record-start",
  toggleable: true,
  toggledIconClass: "record-stop",
  toggleWithRedColor: true,
  contextTypes() {
    return maybeRetrieveContextTypes2((Network) => [Network.NetworkPanel.NetworkPanel]);
  },
  async loadActionDelegate() {
    const Network = await loadNetworkModule();
    return new Network.NetworkPanel.ActionDelegate();
  },
  options: [
    {
      value: true,
      title: i18nLazyString2(UIStrings2.recordNetworkLog)
    },
    {
      value: false,
      title: i18nLazyString2(UIStrings2.stopRecordingNetworkLog)
    }
  ],
  bindings: [
    {
      shortcut: "Ctrl+E",
      platform: "windows,linux"
    },
    {
      shortcut: "Meta+E",
      platform: "mac"
    }
  ]
});
UI2.ActionRegistration.registerActionExtension({
  actionId: "network.clear",
  category: "NETWORK",
  title: i18nLazyString2(UIStrings2.clear),
  iconClass: "clear",
  async loadActionDelegate() {
    const Network = await loadNetworkModule();
    return new Network.NetworkPanel.ActionDelegate();
  },
  contextTypes() {
    return maybeRetrieveContextTypes2((Network) => [Network.NetworkPanel.NetworkPanel]);
  },
  bindings: [
    {
      shortcut: "Ctrl+L"
    },
    {
      shortcut: "Meta+K",
      platform: "mac"
    }
  ]
});
UI2.ActionRegistration.registerActionExtension({
  actionId: "network.hide-request-details",
  category: "NETWORK",
  title: i18nLazyString2(UIStrings2.hideRequestDetails),
  contextTypes() {
    return maybeRetrieveContextTypes2((Network) => [Network.NetworkPanel.NetworkPanel]);
  },
  async loadActionDelegate() {
    const Network = await loadNetworkModule();
    return new Network.NetworkPanel.ActionDelegate();
  },
  bindings: [
    {
      shortcut: "Esc"
    }
  ]
});
UI2.ActionRegistration.registerActionExtension({
  actionId: "network.search",
  category: "NETWORK",
  title: i18nLazyString2(UIStrings2.search),
  contextTypes() {
    return maybeRetrieveContextTypes2((Network) => [Network.NetworkPanel.NetworkPanel]);
  },
  async loadActionDelegate() {
    const Network = await loadNetworkModule();
    return new Network.NetworkPanel.ActionDelegate();
  },
  bindings: [
    {
      platform: "mac",
      shortcut: "Meta+F",
      keybindSets: [
        "devToolsDefault",
        "vsCode"
      ]
    },
    {
      platform: "windows,linux",
      shortcut: "Ctrl+F",
      keybindSets: [
        "devToolsDefault",
        "vsCode"
      ]
    }
  ]
});
UI2.ActionRegistration.registerActionExtension({
  actionId: "network.add-network-request-blocking-pattern",
  category: "NETWORK",
  title: () => i18nString(UIStrings2.addNetworkRequestBlockingOrThrottlingPattern),
  iconClass: "plus",
  contextTypes() {
    return maybeRetrieveContextTypes2((Network) => [Network.RequestConditionsDrawer.RequestConditionsDrawer]);
  },
  async loadActionDelegate() {
    const Network = await loadNetworkModule();
    return new Network.RequestConditionsDrawer.ActionDelegate();
  }
});
UI2.ActionRegistration.registerActionExtension({
  actionId: "network.remove-all-network-request-blocking-patterns",
  category: "NETWORK",
  title: () => i18nString(UIStrings2.removeAllNetworkRequestBlockingOrThrottlingPatterns),
  iconClass: "clear",
  contextTypes() {
    return maybeRetrieveContextTypes2((Network) => [Network.RequestConditionsDrawer.RequestConditionsDrawer]);
  },
  async loadActionDelegate() {
    const Network = await loadNetworkModule();
    return new Network.RequestConditionsDrawer.ActionDelegate();
  }
});
Common2.Settings.registerSettingExtension({
  category: "NETWORK",
  storageType: "Synced",
  title: i18nLazyString2(UIStrings2.allowToGenerateHarWithSensitiveData),
  settingName: "network.show-options-to-generate-har-with-sensitive-data",
  settingType: "boolean",
  defaultValue: false,
  tags: [
    i18n3.i18n.lockedLazyString("HAR")
  ],
  options: [
    {
      value: true,
      title: i18nLazyString2(UIStrings2.allowToGenerateHarWithSensitiveData)
    },
    {
      value: false,
      title: i18nLazyString2(UIStrings2.dontAllowToGenerateHarWithSensitiveData)
    }
  ],
  learnMore: {
    url: "https://goo.gle/devtools-export-hars",
    tooltip: i18nLazyString2(UIStrings2.allowToGenerateHarWithSensitiveDataDocumentation)
  }
});
Common2.Settings.registerSettingExtension({
  category: "NETWORK",
  storageType: "Synced",
  title: i18nLazyString2(UIStrings2.colorcodeResourceTypes),
  settingName: "network-color-code-resource-types",
  settingType: "boolean",
  defaultValue: false,
  tags: [
    i18nLazyString2(UIStrings2.colorCode),
    i18nLazyString2(UIStrings2.resourceType)
  ],
  options: [
    {
      value: true,
      title: i18nLazyString2(UIStrings2.colorCodeByResourceType)
    },
    {
      value: false,
      title: i18nLazyString2(UIStrings2.useDefaultColors)
    }
  ]
});
Common2.Settings.registerSettingExtension({
  category: "NETWORK",
  storageType: "Synced",
  title: i18nLazyString2(UIStrings2.groupNetworkLogByFrame),
  settingName: "network.group-by-frame",
  settingType: "boolean",
  defaultValue: false,
  tags: [
    i18nLazyString2(UIStrings2.netWork),
    i18nLazyString2(UIStrings2.frame),
    i18nLazyString2(UIStrings2.group)
  ],
  options: [
    {
      value: true,
      title: i18nLazyString2(UIStrings2.groupNetworkLogItemsByFrame)
    },
    {
      value: false,
      title: i18nLazyString2(UIStrings2.dontGroupNetworkLogItemsByFrame)
    }
  ]
});
SettingsUI2.SettingUIRegistration.register(SDK2.SDKSettings.requestBlockingEnabledSettingDescriptor, {
  category: "NETWORK",
  title: i18nLazyString2(UIStrings2.networkRequestBlocking),
  options: [
    {
      value: true,
      title: i18nLazyString2(UIStrings2.enableNetworkRequestBlocking)
    },
    {
      value: false,
      title: i18nLazyString2(UIStrings2.disableNetworkRequestBlocking)
    }
  ]
});
SettingsUI2.SettingUIRegistration.register(SDK2.SDKSettings.cacheDisabledSettingDescriptor, {
  category: "NETWORK",
  title: i18nLazyString2(UIStrings2.disableCache),
  order: 0,
  options: [
    {
      value: true,
      title: i18nLazyString2(UIStrings2.disableCache)
    },
    {
      value: false,
      title: i18nLazyString2(UIStrings2.enableCache)
    }
  ],
  learnMore: {
    tooltip: i18nLazyString2(UIStrings2.networkCacheExplanation)
  }
});
SettingsUI2.SettingUIRegistration.register(SDK2.SDKSettings.preserveNetworkLogSettingDescriptor, {
  category: "NETWORK",
  title: i18nLazyString2(UIStrings2.keepLog),
  tags: [
    i18nLazyString2(UIStrings2.keep),
    i18nLazyString2(UIStrings2.preserve),
    i18nLazyString2(UIStrings2.clearTag),
    i18nLazyString2(UIStrings2.reset)
  ],
  options: [
    {
      value: true,
      title: i18nLazyString2(UIStrings2.keepLogOnPageReload)
    },
    {
      value: false,
      title: i18nLazyString2(UIStrings2.doNotKeepLogOnPageReload)
    }
  ]
});
SettingsUI2.SettingUIRegistration.register(Logs.NetworkLog.recordNetworkLogSettingDescriptor, {
  category: "NETWORK",
  title: i18nLazyString2(UIStrings2.recordNetworkLog)
});
UI2.ViewManager.registerLocationResolver({
  name: "network-sidebar",
  category: "NETWORK",
  async loadResolver() {
    const Network = await loadNetworkModule();
    return Network.NetworkPanel.NetworkPanel.instance();
  }
});
UI2.ContextMenu.registerProvider({
  contextTypes() {
    return [
      SDK2.NetworkRequest.NetworkRequest,
      SDK2.Resource.Resource,
      Workspace.UISourceCode.UISourceCode,
      SDK2.TraceObject.RevealableNetworkRequest
    ];
  },
  async loadProvider() {
    const Network = await loadNetworkModule();
    return Network.NetworkPanel.NetworkPanel.instance();
  }
});
Common2.Revealer.registerRevealer({
  contextTypes() {
    return [
      SDK2.NetworkRequest.NetworkRequest
    ];
  },
  destination: Common2.Revealer.RevealerDestination.NETWORK_PANEL,
  async loadRevealer() {
    const Network = await loadNetworkModule();
    return new Network.NetworkPanel.RequestRevealer();
  }
});
Common2.Revealer.registerRevealer({
  contextTypes() {
    return [NetworkForward.UIRequestLocation.UIRequestLocation];
  },
  async loadRevealer() {
    const Network = await loadNetworkModule();
    return new Network.NetworkPanel.RequestLocationRevealer();
  }
});
Common2.Revealer.registerRevealer({
  contextTypes() {
    return [NetworkForward.NetworkRequestId.NetworkRequestId];
  },
  destination: Common2.Revealer.RevealerDestination.NETWORK_PANEL,
  async loadRevealer() {
    const Network = await loadNetworkModule();
    return new Network.NetworkPanel.RequestIdRevealer();
  }
});
Common2.Revealer.registerRevealer({
  contextTypes() {
    return [NetworkForward.UIFilter.UIRequestFilter, PanelCommon.ExtensionServer.RevealableNetworkRequestFilter];
  },
  destination: Common2.Revealer.RevealerDestination.NETWORK_PANEL,
  async loadRevealer() {
    const Network = await loadNetworkModule();
    return new Network.NetworkPanel.NetworkLogWithFilterRevealer();
  }
});
Common2.Revealer.registerRevealer({
  contextTypes() {
    return [SDK2.NetworkManager.AppliedNetworkConditions];
  },
  destination: Common2.Revealer.RevealerDestination.NETWORK_PANEL,
  async loadRevealer() {
    const Network = await loadNetworkModule();
    return new Network.RequestConditionsDrawer.AppliedConditionsRevealer();
  }
});

// gen/front_end/entrypoints/inspector_main/inspector_main-meta.js
import * as Common3 from "./..\\..\\core\\common\\common.js";
import * as i18n5 from "./..\\..\\core\\i18n\\i18n.js";
import * as SDK3 from "./..\\..\\core\\sdk\\sdk.js";
import * as UI3 from "./..\\..\\ui\\legacy\\legacy.js";
import * as SettingsUI3 from "./..\\..\\ui\\settings\\settings.js";
var UIStrings3 = {
  /**
   * @description The name of a checkbox setting in the Rendering tool. This setting
   * emulates that the webpage is in auto dark mode.
   */
  emulateAutoDarkMode: "Emulate auto dark mode",
  /**
   * @description Title of an option under the Rendering category that can be invoked through the Command Menu.
   */
  showPaintFlashingRectangles: "Show paint flashing rectangles",
  /**
   * @description Title of an option under the Rendering category that can be invoked through the Command Menu.
   */
  hidePaintFlashingRectangles: "Hide paint flashing rectangles",
  /**
   * @description Title of an option under the Rendering category that can be invoked through the Command Menu.
   */
  showLayoutShiftRegions: "Show layout shift regions",
  /**
   * @description Title of an option under the Rendering category that can be invoked through the Command Menu.
   */
  hideLayoutShiftRegions: "Hide layout shift regions",
  /**
   * @description Text to highlight the rendering frames for ads.
   */
  highlightAdFrames: "Highlight ad frames",
  /**
   * @description Title of an option under the Rendering category that can be invoked through the Command Menu.
   */
  doNotHighlightAdFrames: "Do not highlight ad frames",
  /**
   * @description Title of an option under the Rendering category that can be invoked through the Command Menu.
   */
  showLayerBorders: "Show layer borders",
  /**
   * @description Title of an option under the Rendering category that can be invoked through the Command Menu.
   */
  hideLayerBorders: "Hide layer borders",
  /**
   * @description Title of an option under the Rendering category that can be invoked through the Command Menu.
   */
  showFramesPerSecondFpsMeter: "Show frames per second (FPS) meter",
  /**
   * @description Title of an option under the Rendering category that can be invoked through the Command Menu.
   */
  hideFramesPerSecondFpsMeter: "Hide frames per second (FPS) meter",
  /**
   * @description Title of an option under the Rendering category that can be invoked through the Command Menu.
   */
  showScrollPerformanceBottlenecks: "Show scroll performance bottlenecks",
  /**
   * @description Title of an option under the Rendering category that can be invoked through the Command Menu.
   */
  hideScrollPerformanceBottlenecks: "Hide scroll performance bottlenecks",
  /**
   * @description Title of a Rendering setting that can be invoked through the Command Menu.
   */
  emulateAFocusedPage: "Emulate a focused page",
  /**
   * @description Title of a Rendering setting that can be invoked through the Command Menu.
   */
  doNotEmulateAFocusedPage: "Do not emulate a focused page",
  /**
   * @description Title of a setting under the Rendering category that can be invoked through the Command Menu.
   */
  doNotEmulateCssMediaType: "Do not emulate CSS media type",
  /**
   * @description A drop-down menu option to do not emulate css media type.
   */
  noEmulation: "No emulation",
  /**
   * @description Title of a setting under the Rendering category that can be invoked through the Command Menu.
   */
  emulateCssPrintMediaType: "Emulate CSS print media type",
  /**
   * @description A drop-down menu option to emulate css print media type.
   */
  print: "print",
  /**
   * @description Title of a setting under the Rendering category that can be invoked through the Command Menu.
   */
  emulateCssScreenMediaType: "Emulate CSS screen media type",
  /**
   * @description A drop-down menu option to emulate css screen media type.
   */
  screen: "screen",
  /**
   * @description A tag of Emulate CSS screen media type setting that can be searched in the command menu.
   */
  query: "query",
  /**
   * @description Title of a setting under the Rendering drawer.
   */
  emulateCssMediaType: "Emulate CSS media type",
  /**
   * @description Title of a setting under the Rendering drawer that can be invoked through the Command Menu.
   * @example {prefers-color-scheme} PH1
   */
  doNotEmulateCss: "Do not emulate CSS {PH1}",
  /**
   * @description Title of a setting under the Rendering drawer that can be invoked through the Command Menu.
   * @example {prefers-color-scheme: light} PH1
   */
  emulateCss: "Emulate CSS {PH1}",
  /**
   * @description Title of a setting under the Rendering drawer that can be invoked through the Command Menu.
   * @example {prefers-color-scheme} PH1
   */
  emulateCssMediaFeature: "Emulate CSS media feature {PH1}",
  /**
   * @description Title of the Rendering panel. The Rendering panel is a collection of settings that
   * lets the user debug the rendering (i.e. how the website is drawn onto the screen) of the
   * website (https://developer.chrome.com/docs/devtools/evaluate-performance/reference#rendering).
   */
  rendering: "Rendering",
  /**
   * @description Command for showing the Rendering panel.
   */
  showRendering: "Show Rendering",
  /**
   * @description Command Menu search query that points to the Rendering panel. This refers to the
   * process of drawing pixels onto the screen (called painting).
   */
  paint: "paint",
  /**
   * @description Command Menu search query that points to the Rendering panel. Layout is a phase of
   * rendering a website where the browser calculates where different elements in the website will go
   * on the screen.
   */
  layout: "layout",
  /**
   * @description Command Menu search query that points to the Rendering panel. 'fps' is an acronym
   * for 'Frames per second'. It is in lowercase here because the search box the user will type this
   * into is case-insensitive. If there is an equivalent acronym/shortening in the target language
   * then a translation would be appropriate, otherwise it can be left in English.
   */
  fps: "fps",
  /**
   * @description Command Menu search query that points to the Rendering panel
   * (https://developer.mozilla.org/en-US/docs/Web/CSS/@media#media_types). This is something the user
   * might type in to search for the setting to change the CSS media type.
   */
  cssMediaType: "CSS media type",
  /**
   * @description Command Menu search query that points to the Rendering panel
   * (https://developer.mozilla.org/en-US/docs/Web/CSS/@media#media_features). This is something the
   * user might type in to search for the setting to change the value of various CSS media features.
   */
  cssMediaFeature: "CSS media feature",
  /**
   * @description Command Menu search query that points to the Rendering panel. Possible search term
   * when the user wants to find settings related to visual impairment e.g. blurry vision, blindness.
   */
  visionDeficiency: "vision deficiency",
  /**
   * @description Command Menu search query that points to the Rendering panel. Possible search term
   * when the user wants to find settings related to color vision deficiency/color blindness.
   */
  colorVisionDeficiency: "color vision deficiency",
  /**
   * @description Title of a setting under the Rendering drawer that can be invoked through the Command Menu.
   */
  doNotEmulateAnyVisionDeficiency: "Do not emulate any vision deficiency",
  /**
   * @description Title of a setting under the Rendering drawer that can be invoked through the Command Menu.
   */
  emulateBlurredVision: "Emulate blurred vision",
  /**
   * @description Title of a setting under the Rendering drawer that can be invoked through the Command Menu.
   */
  emulateReducedContrast: "Emulate reduced contrast",
  /**
   * @description Name of a vision deficiency that can be emulated via the Rendering drawer.
   */
  blurredVision: "Blurred vision",
  /**
   * @description Name of a vision deficiency that can be emulated via the Rendering drawer.
   */
  reducedContrast: "Reduced contrast",
  /**
   * @description Title of a setting under the Rendering drawer that can be invoked through the Command Menu.
   */
  emulateProtanopia: "Emulate protanopia (no red)",
  /**
   * @description Name of a color vision deficiency that can be emulated via the Rendering drawer.
   */
  protanopia: "Protanopia (no red)",
  /**
   * @description Title of a setting under the Rendering drawer that can be invoked through the Command Menu.
   */
  emulateDeuteranopia: "Emulate deuteranopia (no green)",
  /**
   * @description Name of a color vision deficiency that can be emulated via the Rendering drawer.
   */
  deuteranopia: "Deuteranopia (no green)",
  /**
   * @description Title of a setting under the Rendering drawer that can be invoked through the Command Menu.
   */
  emulateTritanopia: "Emulate tritanopia (no blue)",
  /**
   * @description Name of a color vision deficiency that can be emulated via the Rendering drawer.
   */
  tritanopia: "Tritanopia (no blue)",
  /**
   * @description Title of a setting under the Rendering drawer that can be invoked through the Command Menu.
   */
  emulateAchromatopsia: "Emulate achromatopsia (no color)",
  /**
   * @description Name of a color vision deficiency that can be emulated via the Rendering drawer.
   */
  achromatopsia: "Achromatopsia (no color)",
  /**
   * @description Title of a setting under the Rendering drawer.
   */
  emulateVisionDeficiencies: "Emulate vision deficiencies",
  /**
   * @description Title of a setting under the Rendering drawer.
   */
  emulateOsTextScale: "Emulate OS text scale",
  /**
   * @description Title of a setting under the Rendering category that can be invoked through the Command Menu.
   */
  doNotEmulateOsTextScale: "Do not emulate OS text scale",
  /**
   * @description A drop-down menu option to not emulate OS text scale.
   */
  osTextScaleEmulationNone: "No emulation",
  /**
   * @description A drop-down menu option to emulate an OS text scale 85%.
   */
  osTextScaleEmulation85: "85%",
  /**
   * @description A drop-down menu option to emulate an OS text scale of 100%.
   */
  osTextScaleEmulation100: "100% (default)",
  /**
   * @description A drop-down menu option to emulate an OS text scale of 115%.
   */
  osTextScaleEmulation115: "115%",
  /**
   * @description A drop-down menu option to emulate an OS text scale of 130%.
   */
  osTextScaleEmulation130: "130%",
  /**
   * @description A drop-down menu option to emulate an OS text scale of 150%.
   */
  osTextScaleEmulation150: "150%",
  /**
   * @description A drop-down menu option to emulate an OS text scale of 180%.
   */
  osTextScaleEmulation180: "180%",
  /**
   * @description A drop-down menu option to emulate an OS text scale of 200%.
   */
  osTextScaleEmulation200: "200%",
  /**
   * @description A drop-down menu option to emulate an OS text scale of 250%.
   */
  osTextScaleEmulation250: "250%",
  /**
   * @description A drop-down menu option to emulate an OS text scale of 300%.
   */
  osTextScaleEmulation300: "300%",
  /**
   * @description A drop-down menu option to emulate an OS text scale of 350%.
   */
  osTextScaleEmulation350: "350%",
  /**
   * @description Text that refers to disabling local fonts.
   */
  disableLocalFonts: "Disable local fonts",
  /**
   * @description Text that refers to enabling local fonts.
   */
  enableLocalFonts: "Enable local fonts",
  /**
   * @description Title of a setting that disables AVIF format.
   */
  disableAvifFormat: "Disable `AVIF` format",
  /**
   * @description Title of a setting that enables AVIF format.
   */
  enableAvifFormat: "Enable `AVIF` format",
  /**
   * @description Title of a setting that disables JPEG XL format.
   */
  disableJpegXlFormat: "Disable `JPEG XL` format",
  /**
   * @description Title of a setting that enables JPEG XL format.
   */
  enableJpegXlFormat: "Enable `JPEG XL` format",
  /**
   * @description Title of a setting that disables WebP format.
   */
  disableWebpFormat: "Disable `WebP` format",
  /**
   * @description Title of a setting that enables WebP format.
   */
  enableWebpFormat: "Enable `WebP` format",
  /**
   * @description Title of an action that reloads the inspected page.
   */
  reloadPage: "Reload page",
  /**
   * @description Title of an action that hard reloads the inspected page. A hard reload also
   * clears the browser's cache, forcing it to reload the most recent version of the page.
   */
  hardReloadPage: "Hard reload page",
  /**
   * @description Title of a setting under the Network category in Settings. All ads on the site will
   * be blocked (the setting is forced on).
   */
  forceAdBlocking: "Force ad blocking on this site",
  /**
   * @description A command available in the command menu to block all ads on the current site.
   */
  blockAds: "Block ads on this site",
  /**
   * @description A command available in the command menu to disable ad blocking on the current site.
   */
  showAds: "Show ads on this site, if allowed",
  /**
   * @description A command available in the command menu to automatically open DevTools when
   * webpages create new popup windows.
   */
  autoOpenDevTools: "Auto-open DevTools for popups",
  /**
   * @description A command available in the command menu to stop automatically opening DevTools when
   * webpages create new popup windows.
   */
  doNotAutoOpen: "Do not auto-open DevTools for popups",
  /**
   * @description Title of an action that toggles the "forces CSS prefers-color-scheme" media feature.
   */
  toggleCssPrefersColorSchemeMedia: "Toggle CSS media feature `prefers-color-scheme`"
};
var str_3 = i18n5.i18n.registerUIStrings("entrypoints/inspector_main/inspector_main-meta.ts", UIStrings3);
var i18nLazyString3 = i18n5.i18n.getLazilyComputedLocalizedString.bind(void 0, str_3);
var loadedInspectorMainModule;
async function loadInspectorMainModule() {
  if (!loadedInspectorMainModule) {
    loadedInspectorMainModule = await import("./..\\inspector_main\\inspector_main.js");
  }
  return loadedInspectorMainModule;
}
UI3.ActionRegistration.registerActionExtension({
  category: "NAVIGATION",
  actionId: "inspector-main.reload",
  async loadActionDelegate() {
    const InspectorMain = await loadInspectorMainModule();
    return new InspectorMain.InspectorMain.ReloadActionDelegate();
  },
  iconClass: "refresh",
  title: i18nLazyString3(UIStrings3.reloadPage),
  bindings: [
    {
      platform: "windows,linux",
      shortcut: "Ctrl+R"
    },
    {
      platform: "windows,linux",
      shortcut: "F5"
    },
    {
      platform: "mac",
      shortcut: "Meta+R"
    }
  ]
});
UI3.ActionRegistration.registerActionExtension({
  category: "NAVIGATION",
  actionId: "inspector-main.hard-reload",
  async loadActionDelegate() {
    const InspectorMain = await loadInspectorMainModule();
    return new InspectorMain.InspectorMain.ReloadActionDelegate();
  },
  title: i18nLazyString3(UIStrings3.hardReloadPage),
  bindings: [
    {
      platform: "windows,linux",
      shortcut: "Shift+Ctrl+R"
    },
    {
      platform: "windows,linux",
      shortcut: "Shift+F5"
    },
    {
      platform: "windows,linux",
      shortcut: "Ctrl+F5"
    },
    {
      platform: "windows,linux",
      shortcut: "Ctrl+Shift+F5"
    },
    {
      platform: "mac",
      shortcut: "Shift+Meta+R"
    }
  ]
});
Common3.Settings.registerSettingExtension({
  category: "NETWORK",
  title: i18nLazyString3(UIStrings3.forceAdBlocking),
  settingName: "network.ad-blocking-enabled",
  settingType: "boolean",
  storageType: "Session",
  defaultValue: false,
  options: [
    {
      value: true,
      title: i18nLazyString3(UIStrings3.blockAds)
    },
    {
      value: false,
      title: i18nLazyString3(UIStrings3.showAds)
    }
  ]
});
Common3.Settings.registerSettingExtension({
  category: "GLOBAL",
  storageType: "Synced",
  title: i18nLazyString3(UIStrings3.autoOpenDevTools),
  settingName: "auto-attach-to-created-pages",
  settingType: "boolean",
  order: 2,
  defaultValue: false,
  options: [
    {
      value: true,
      title: i18nLazyString3(UIStrings3.autoOpenDevTools)
    },
    {
      value: false,
      title: i18nLazyString3(UIStrings3.doNotAutoOpen)
    }
  ]
});
UI3.Toolbar.registerToolbarItem({
  async loadItem() {
    const InspectorMain = await loadInspectorMainModule();
    return new InspectorMain.InspectorMain.NodeIndicatorProvider();
  },
  order: 2,
  location: "main-toolbar-left"
});
UI3.Toolbar.registerToolbarItem({
  loadItem: Common3.Lazy.lazy(async () => {
    const InspectorMain = await loadInspectorMainModule();
    return new InspectorMain.OutermostTargetSelector.OutermostTargetSelector();
  }),
  order: 97,
  location: "main-toolbar-right"
});
SettingsUI3.SettingUIRegistration.register(SDK3.SDKSettings.showPaintRectsSettingDescriptor, {
  category: "RENDERING",
  options: [
    {
      value: true,
      title: i18nLazyString3(UIStrings3.showPaintFlashingRectangles)
    },
    {
      value: false,
      title: i18nLazyString3(UIStrings3.hidePaintFlashingRectangles)
    }
  ]
});
SettingsUI3.SettingUIRegistration.register(SDK3.SDKSettings.showLayoutShiftRegionsSettingDescriptor, {
  category: "RENDERING",
  options: [
    {
      value: true,
      title: i18nLazyString3(UIStrings3.showLayoutShiftRegions)
    },
    {
      value: false,
      title: i18nLazyString3(UIStrings3.hideLayoutShiftRegions)
    }
  ]
});
SettingsUI3.SettingUIRegistration.register(SDK3.SDKSettings.showAdHighlightsSettingDescriptor, {
  category: "RENDERING",
  options: [
    {
      value: true,
      title: i18nLazyString3(UIStrings3.highlightAdFrames)
    },
    {
      value: false,
      title: i18nLazyString3(UIStrings3.doNotHighlightAdFrames)
    }
  ]
});
SettingsUI3.SettingUIRegistration.register(SDK3.SDKSettings.showDebugBordersSettingDescriptor, {
  category: "RENDERING",
  options: [
    {
      value: true,
      title: i18nLazyString3(UIStrings3.showLayerBorders)
    },
    {
      value: false,
      title: i18nLazyString3(UIStrings3.hideLayerBorders)
    }
  ]
});
SettingsUI3.SettingUIRegistration.register(SDK3.SDKSettings.showFPSCounterSettingDescriptor, {
  category: "RENDERING",
  options: [
    {
      value: true,
      title: i18nLazyString3(UIStrings3.showFramesPerSecondFpsMeter)
    },
    {
      value: false,
      title: i18nLazyString3(UIStrings3.hideFramesPerSecondFpsMeter)
    }
  ]
});
SettingsUI3.SettingUIRegistration.register(SDK3.SDKSettings.showScrollBottleneckRectsSettingDescriptor, {
  category: "RENDERING",
  options: [
    {
      value: true,
      title: i18nLazyString3(UIStrings3.showScrollPerformanceBottlenecks)
    },
    {
      value: false,
      title: i18nLazyString3(UIStrings3.hideScrollPerformanceBottlenecks)
    }
  ]
});
SettingsUI3.SettingUIRegistration.register(SDK3.SDKSettings.emulatePageFocusSettingDescriptor, {
  category: "RENDERING",
  title: i18nLazyString3(UIStrings3.emulateAFocusedPage),
  options: [
    {
      value: true,
      title: i18nLazyString3(UIStrings3.emulateAFocusedPage)
    },
    {
      value: false,
      title: i18nLazyString3(UIStrings3.doNotEmulateAFocusedPage)
    }
  ]
});
SettingsUI3.SettingUIRegistration.register(SDK3.SDKSettings.emulatedCSSMediaSettingDescriptor, {
  category: "RENDERING",
  title: i18nLazyString3(UIStrings3.emulateCssMediaType),
  options: [
    {
      title: i18nLazyString3(UIStrings3.doNotEmulateCssMediaType),
      text: i18nLazyString3(UIStrings3.noEmulation),
      value: ""
    },
    {
      title: i18nLazyString3(UIStrings3.emulateCssPrintMediaType),
      text: i18nLazyString3(UIStrings3.print),
      value: "print"
    },
    {
      title: i18nLazyString3(UIStrings3.emulateCssScreenMediaType),
      text: i18nLazyString3(UIStrings3.screen),
      value: "screen"
    }
  ],
  tags: [
    i18nLazyString3(UIStrings3.query)
  ]
});
SettingsUI3.SettingUIRegistration.register(SDK3.SDKSettings.emulatedCSSMediaFeaturePrefersColorSchemeSettingDescriptor, {
  category: "RENDERING",
  options: [
    {
      title: i18nLazyString3(UIStrings3.doNotEmulateCss, { PH1: "prefers-color-scheme" }),
      text: i18nLazyString3(UIStrings3.noEmulation),
      value: ""
    },
    {
      title: i18nLazyString3(UIStrings3.emulateCss, { PH1: "prefers-color-scheme: light" }),
      text: i18n5.i18n.lockedLazyString("prefers-color-scheme: light"),
      value: "light"
    },
    {
      title: i18nLazyString3(UIStrings3.emulateCss, { PH1: "prefers-color-scheme: dark" }),
      text: i18n5.i18n.lockedLazyString("prefers-color-scheme: dark"),
      value: "dark"
    }
  ],
  tags: [
    i18nLazyString3(UIStrings3.query)
  ],
  title: i18nLazyString3(UIStrings3.emulateCssMediaFeature, { PH1: "prefers-color-scheme" })
});
SettingsUI3.SettingUIRegistration.register(SDK3.SDKSettings.emulatedCSSMediaFeatureForcedColorsSettingDescriptor, {
  category: "RENDERING",
  options: [
    {
      title: i18nLazyString3(UIStrings3.doNotEmulateCss, { PH1: "forced-colors" }),
      text: i18nLazyString3(UIStrings3.noEmulation),
      value: ""
    },
    {
      title: i18nLazyString3(UIStrings3.emulateCss, { PH1: "forced-colors: active" }),
      text: i18n5.i18n.lockedLazyString("forced-colors: active"),
      value: "active"
    },
    {
      title: i18nLazyString3(UIStrings3.emulateCss, { PH1: "forced-colors: none" }),
      text: i18n5.i18n.lockedLazyString("forced-colors: none"),
      value: "none"
    }
  ],
  tags: [
    i18nLazyString3(UIStrings3.query)
  ],
  title: i18nLazyString3(UIStrings3.emulateCssMediaFeature, { PH1: "forced-colors" })
});
SettingsUI3.SettingUIRegistration.register(SDK3.SDKSettings.emulatedCSSMediaFeaturePrefersReducedMotionSettingDescriptor, {
  category: "RENDERING",
  options: [
    {
      title: i18nLazyString3(UIStrings3.doNotEmulateCss, { PH1: "prefers-reduced-motion" }),
      text: i18nLazyString3(UIStrings3.noEmulation),
      value: ""
    },
    {
      title: i18nLazyString3(UIStrings3.emulateCss, { PH1: "prefers-reduced-motion: reduce" }),
      text: i18n5.i18n.lockedLazyString("prefers-reduced-motion: reduce"),
      value: "reduce"
    }
  ],
  tags: [
    i18nLazyString3(UIStrings3.query)
  ],
  title: i18nLazyString3(UIStrings3.emulateCssMediaFeature, { PH1: "prefers-reduced-motion" })
});
SettingsUI3.SettingUIRegistration.register(SDK3.SDKSettings.emulatedCSSMediaFeaturePrefersContrastSettingDescriptor, {
  category: "RENDERING",
  options: [
    {
      title: i18nLazyString3(UIStrings3.doNotEmulateCss, { PH1: "prefers-contrast" }),
      text: i18nLazyString3(UIStrings3.noEmulation),
      value: ""
    },
    {
      title: i18nLazyString3(UIStrings3.emulateCss, { PH1: "prefers-contrast: more" }),
      text: i18n5.i18n.lockedLazyString("prefers-contrast: more"),
      value: "more"
    },
    {
      title: i18nLazyString3(UIStrings3.emulateCss, { PH1: "prefers-contrast: less" }),
      text: i18n5.i18n.lockedLazyString("prefers-contrast: less"),
      value: "less"
    },
    {
      title: i18nLazyString3(UIStrings3.emulateCss, { PH1: "prefers-contrast: custom" }),
      text: i18n5.i18n.lockedLazyString("prefers-contrast: custom"),
      value: "custom"
    }
  ],
  tags: [
    i18nLazyString3(UIStrings3.query)
  ],
  title: i18nLazyString3(UIStrings3.emulateCssMediaFeature, { PH1: "prefers-contrast" })
});
SettingsUI3.SettingUIRegistration.register(SDK3.SDKSettings.emulatedCSSMediaFeaturePrefersReducedDataSettingDescriptor, {
  category: "RENDERING",
  options: [
    {
      title: i18nLazyString3(UIStrings3.doNotEmulateCss, { PH1: "prefers-reduced-data" }),
      text: i18nLazyString3(UIStrings3.noEmulation),
      value: ""
    },
    {
      title: i18nLazyString3(UIStrings3.emulateCss, { PH1: "prefers-reduced-data: reduce" }),
      text: i18n5.i18n.lockedLazyString("prefers-reduced-data: reduce"),
      value: "reduce"
    }
  ],
  tags: [
    i18nLazyString3(UIStrings3.query)
  ],
  title: i18nLazyString3(UIStrings3.emulateCssMediaFeature, { PH1: "prefers-reduced-data" })
});
SettingsUI3.SettingUIRegistration.register(SDK3.SDKSettings.emulatedCSSMediaFeaturePrefersReducedTransparencySettingDescriptor, {
  category: "RENDERING",
  options: [
    {
      title: i18nLazyString3(UIStrings3.doNotEmulateCss, { PH1: "prefers-reduced-transparency" }),
      text: i18nLazyString3(UIStrings3.noEmulation),
      value: ""
    },
    {
      title: i18nLazyString3(UIStrings3.emulateCss, { PH1: "prefers-reduced-transparency: reduce" }),
      text: i18n5.i18n.lockedLazyString("prefers-reduced-transparency: reduce"),
      value: "reduce"
    }
  ],
  tags: [
    i18nLazyString3(UIStrings3.query)
  ],
  title: i18nLazyString3(UIStrings3.emulateCssMediaFeature, { PH1: "prefers-reduced-transparency" })
});
SettingsUI3.SettingUIRegistration.register(SDK3.SDKSettings.emulatedCSSMediaFeatureColorGamutSettingDescriptor, {
  category: "RENDERING",
  options: [
    {
      title: i18nLazyString3(UIStrings3.doNotEmulateCss, { PH1: "color-gamut" }),
      text: i18nLazyString3(UIStrings3.noEmulation),
      value: ""
    },
    {
      title: i18nLazyString3(UIStrings3.emulateCss, { PH1: "color-gamut: srgb" }),
      text: i18n5.i18n.lockedLazyString("color-gamut: srgb"),
      value: "srgb"
    },
    {
      title: i18nLazyString3(UIStrings3.emulateCss, { PH1: "color-gamut: p3" }),
      text: i18n5.i18n.lockedLazyString("color-gamut: p3"),
      value: "p3"
    },
    {
      title: i18nLazyString3(UIStrings3.emulateCss, { PH1: "color-gamut: rec2020" }),
      text: i18n5.i18n.lockedLazyString("color-gamut: rec2020"),
      value: "rec2020"
    }
  ],
  tags: [
    i18nLazyString3(UIStrings3.query)
  ],
  title: i18nLazyString3(UIStrings3.emulateCssMediaFeature, { PH1: "color-gamut" })
});
SettingsUI3.SettingUIRegistration.register(SDK3.SDKSettings.emulatedVisionDeficiencySettingDescriptor, {
  category: "RENDERING",
  options: [
    {
      title: i18nLazyString3(UIStrings3.doNotEmulateAnyVisionDeficiency),
      text: i18nLazyString3(UIStrings3.noEmulation),
      value: "none"
    },
    {
      title: i18nLazyString3(UIStrings3.emulateBlurredVision),
      text: i18nLazyString3(UIStrings3.blurredVision),
      value: "blurredVision"
    },
    {
      title: i18nLazyString3(UIStrings3.emulateReducedContrast),
      text: i18nLazyString3(UIStrings3.reducedContrast),
      value: "reducedContrast"
    },
    {
      title: i18nLazyString3(UIStrings3.emulateProtanopia),
      text: i18nLazyString3(UIStrings3.protanopia),
      value: "protanopia"
    },
    {
      title: i18nLazyString3(UIStrings3.emulateDeuteranopia),
      text: i18nLazyString3(UIStrings3.deuteranopia),
      value: "deuteranopia"
    },
    {
      title: i18nLazyString3(UIStrings3.emulateTritanopia),
      text: i18nLazyString3(UIStrings3.tritanopia),
      value: "tritanopia"
    },
    {
      title: i18nLazyString3(UIStrings3.emulateAchromatopsia),
      text: i18nLazyString3(UIStrings3.achromatopsia),
      value: "achromatopsia"
    }
  ],
  tags: [
    i18nLazyString3(UIStrings3.query)
  ],
  title: i18nLazyString3(UIStrings3.emulateVisionDeficiencies)
});
SettingsUI3.SettingUIRegistration.register(SDK3.SDKSettings.emulatedOSTextScaleSettingDescriptor, {
  category: "RENDERING",
  options: [
    {
      title: i18nLazyString3(UIStrings3.doNotEmulateOsTextScale),
      text: i18nLazyString3(UIStrings3.osTextScaleEmulationNone),
      value: ""
    },
    {
      title: i18nLazyString3(UIStrings3.osTextScaleEmulation85),
      text: i18nLazyString3(UIStrings3.osTextScaleEmulation85),
      value: "0.85"
    },
    {
      title: i18nLazyString3(UIStrings3.osTextScaleEmulation100),
      text: i18nLazyString3(UIStrings3.osTextScaleEmulation100),
      value: "1"
    },
    {
      title: i18nLazyString3(UIStrings3.osTextScaleEmulation115),
      text: i18nLazyString3(UIStrings3.osTextScaleEmulation115),
      value: "1.15"
    },
    {
      title: i18nLazyString3(UIStrings3.osTextScaleEmulation130),
      text: i18nLazyString3(UIStrings3.osTextScaleEmulation130),
      value: "1.3"
    },
    {
      title: i18nLazyString3(UIStrings3.osTextScaleEmulation150),
      text: i18nLazyString3(UIStrings3.osTextScaleEmulation150),
      value: "1.5"
    },
    {
      title: i18nLazyString3(UIStrings3.osTextScaleEmulation180),
      text: i18nLazyString3(UIStrings3.osTextScaleEmulation180),
      value: "1.8"
    },
    {
      title: i18nLazyString3(UIStrings3.osTextScaleEmulation200),
      text: i18nLazyString3(UIStrings3.osTextScaleEmulation200),
      value: "2"
    },
    {
      title: i18nLazyString3(UIStrings3.osTextScaleEmulation250),
      text: i18nLazyString3(UIStrings3.osTextScaleEmulation250),
      value: "2.5"
    },
    {
      title: i18nLazyString3(UIStrings3.osTextScaleEmulation300),
      text: i18nLazyString3(UIStrings3.osTextScaleEmulation300),
      value: "3"
    },
    {
      title: i18nLazyString3(UIStrings3.osTextScaleEmulation350),
      text: i18nLazyString3(UIStrings3.osTextScaleEmulation350),
      value: "3.5"
    }
  ],
  tags: [
    i18nLazyString3(UIStrings3.query)
  ],
  title: i18nLazyString3(UIStrings3.emulateOsTextScale)
});
SettingsUI3.SettingUIRegistration.register(SDK3.SDKSettings.localFontsDisabledSettingDescriptor, {
  category: "RENDERING",
  options: [
    {
      value: true,
      title: i18nLazyString3(UIStrings3.disableLocalFonts)
    },
    {
      value: false,
      title: i18nLazyString3(UIStrings3.enableLocalFonts)
    }
  ]
});
SettingsUI3.SettingUIRegistration.register(SDK3.SDKSettings.avifFormatDisabledSettingDescriptor, {
  category: "RENDERING",
  options: [
    {
      value: true,
      title: i18nLazyString3(UIStrings3.disableAvifFormat)
    },
    {
      value: false,
      title: i18nLazyString3(UIStrings3.enableAvifFormat)
    }
  ]
});
SettingsUI3.SettingUIRegistration.register(SDK3.SDKSettings.jpegXlFormatDisabledSettingDescriptor, {
  category: "RENDERING",
  options: [
    {
      value: true,
      title: i18nLazyString3(UIStrings3.disableJpegXlFormat)
    },
    {
      value: false,
      title: i18nLazyString3(UIStrings3.enableJpegXlFormat)
    }
  ]
});
SettingsUI3.SettingUIRegistration.register(SDK3.SDKSettings.webpFormatDisabledSettingDescriptor, {
  category: "RENDERING",
  options: [
    {
      value: true,
      title: i18nLazyString3(UIStrings3.disableWebpFormat)
    },
    {
      value: false,
      title: i18nLazyString3(UIStrings3.enableWebpFormat)
    }
  ]
});
SettingsUI3.SettingUIRegistration.register(SDK3.SDKSettings.emulateAutoDarkModeSettingDescriptor, {
  category: "RENDERING",
  title: i18nLazyString3(UIStrings3.emulateAutoDarkMode)
});

// gen/front_end/panels/mobile_throttling/mobile_throttling-meta.js
import * as Common4 from "./..\\..\\core\\common\\common.js";
import * as i18n7 from "./..\\..\\core\\i18n\\i18n.js";
import * as UI4 from "./..\\..\\ui\\legacy\\legacy.js";
var UIStrings4 = {
  /**
   * @description Text for throttling the network.
   */
  throttling: "Throttling",
  /**
   * @description Command for showing the mobile throttling tool.
   */
  showThrottling: "Show Throttling",
  /**
   * @description Title of an action in the network conditions tool to network offline.
   */
  goOffline: "Go offline",
  /**
   * @description A tag of mobile-related settings that can be searched in the command menu.
   */
  device: "device",
  /**
   * @description A tag of network-related actions that can be searched in the command menu.
   */
  throttlingTag: "throttling",
  /**
   * @description Title of an action in the network conditions tool to simulate an environment with a
   * slow 3G connection, i.e. for a low end mobile device.
   */
  enableSlowGThrottling: "Enable slow `3G` throttling",
  /**
   * @description Title of an action in the network conditions tool to simulate an environment with a
   * medium-speed 3G connection, i.e. for a mid-tier mobile device.
   */
  enableFastGThrottling: "Enable fast `3G` throttling",
  /**
   * @description Title of an action in the network conditions tool to network online.
   */
  goOnline: "Go online"
};
var str_4 = i18n7.i18n.registerUIStrings("panels/mobile_throttling/mobile_throttling-meta.ts", UIStrings4);
var i18nLazyString4 = i18n7.i18n.getLazilyComputedLocalizedString.bind(void 0, str_4);
var loadedMobileThrottlingModule;
async function loadMobileThrottlingModule() {
  if (!loadedMobileThrottlingModule) {
    loadedMobileThrottlingModule = await import("./..\\..\\panels\\mobile_throttling\\mobile_throttling.js");
  }
  return loadedMobileThrottlingModule;
}
UI4.ViewManager.registerViewExtension({
  location: "settings-view",
  id: "throttling-conditions",
  title: i18nLazyString4(UIStrings4.throttling),
  commandPrompt: i18nLazyString4(UIStrings4.showThrottling),
  order: 35,
  async loadView(universe) {
    const MobileThrottling = await loadMobileThrottlingModule();
    const { settings } = universe;
    return new MobileThrottling.ThrottlingSettingsTab.ThrottlingSettingsTab(settings);
  },
  settings: [
    "custom-network-conditions",
    "calibrated-cpu-throttling"
  ],
  iconName: "performance"
});
UI4.ActionRegistration.registerActionExtension({
  actionId: "network-conditions.network-offline",
  category: "NETWORK",
  title: i18nLazyString4(UIStrings4.goOffline),
  async loadActionDelegate() {
    const MobileThrottling = await loadMobileThrottlingModule();
    return new MobileThrottling.ThrottlingManager.ActionDelegate();
  },
  tags: [
    i18nLazyString4(UIStrings4.device),
    i18nLazyString4(UIStrings4.throttlingTag)
  ]
});
UI4.ActionRegistration.registerActionExtension({
  actionId: "network-conditions.network-low-end-mobile",
  category: "NETWORK",
  title: i18nLazyString4(UIStrings4.enableSlowGThrottling),
  async loadActionDelegate() {
    const MobileThrottling = await loadMobileThrottlingModule();
    return new MobileThrottling.ThrottlingManager.ActionDelegate();
  },
  tags: [
    i18nLazyString4(UIStrings4.device),
    i18nLazyString4(UIStrings4.throttlingTag)
  ]
});
UI4.ActionRegistration.registerActionExtension({
  actionId: "network-conditions.network-mid-tier-mobile",
  category: "NETWORK",
  title: i18nLazyString4(UIStrings4.enableFastGThrottling),
  async loadActionDelegate() {
    const MobileThrottling = await loadMobileThrottlingModule();
    return new MobileThrottling.ThrottlingManager.ActionDelegate();
  },
  tags: [
    i18nLazyString4(UIStrings4.device),
    i18nLazyString4(UIStrings4.throttlingTag)
  ]
});
UI4.ActionRegistration.registerActionExtension({
  actionId: "network-conditions.network-online",
  category: "NETWORK",
  title: i18nLazyString4(UIStrings4.goOnline),
  async loadActionDelegate() {
    const MobileThrottling = await loadMobileThrottlingModule();
    return new MobileThrottling.ThrottlingManager.ActionDelegate();
  },
  tags: [
    i18nLazyString4(UIStrings4.device),
    i18nLazyString4(UIStrings4.throttlingTag)
  ]
});
Common4.Settings.registerSettingExtension({
  storageType: "Synced",
  settingName: "custom-network-conditions",
  settingType: "array",
  defaultValue: []
});

// gen/front_end/entrypoints/devtools_app/devtools_app.prebundle.js
import * as Root3 from "./..\\..\\core\\root\\root.js";
import * as Main from "./..\\main\\main.js";
self.runtime = Root3.Runtime.Runtime.instance({ forceNew: true });
new Main.MainImpl.MainImpl({ supportsEmulation: true });
//# sourceMappingURL=devtools_app.js.map
