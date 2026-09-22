var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// gen/front_end/entrypoints/inspector_main/InspectorMain.js
var InspectorMain_exports = {};
__export(InspectorMain_exports, {
  BackendSettingsSync: () => BackendSettingsSync,
  DEFAULT_VIEW: () => DEFAULT_VIEW,
  FocusDebuggeeActionDelegate: () => FocusDebuggeeActionDelegate,
  InspectorMainImpl: () => InspectorMainImpl,
  NodeIndicator: () => NodeIndicator,
  NodeIndicatorProvider: () => NodeIndicatorProvider,
  ReloadActionDelegate: () => ReloadActionDelegate,
  SourcesPanelIndicator: () => SourcesPanelIndicator
});
import * as Common from "./..\\..\\core\\common\\common.js";
import * as Host from "./..\\..\\core\\host\\host.js";
import * as i18n from "./..\\..\\core\\i18n\\i18n.js";
import * as Root from "./..\\..\\core\\root\\root.js";
import * as SDK from "./..\\..\\core\\sdk\\sdk.js";
import * as MobileThrottling from "./..\\..\\panels\\mobile_throttling\\mobile_throttling.js";
import * as Components from "./..\\..\\ui\\legacy\\components\\utils\\utils.js";
import * as UI from "./..\\..\\ui\\legacy\\legacy.js";
import * as Lit from "./..\\..\\ui\\lit\\lit.js";

// gen/front_end/entrypoints/inspector_main/nodeIcon.css.js
var nodeIcon_css_default = `/*
 * Copyright 2017 The Chromium Authors
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

.node-icon {
  width: 28px;
  height: 26px;
  /* stylelint-disable-next-line custom-property-pattern */
  background-image: var(--image-file-nodeIcon);
  background-size: 17px 17px;
  background-repeat: no-repeat;
  background-position: center;
  opacity: 80%;
  cursor: auto;
}

.node-icon:hover {
  opacity: 100%;
}

.node-icon.inactive {
  filter: grayscale(100%);
}

/*# sourceURL=${import.meta.resolve("./nodeIcon.css")} */`;

// gen/front_end/entrypoints/inspector_main/InspectorMain.js
var { html } = Lit;
var UIStrings = {
  /**
   * @description Text that refers to the main target. The main target is the primary webpage that
   * DevTools is connected to. This text is used in various places in the UI as a label/name to inform
   * the user which target/webpage they are currently connected to, as DevTools may connect to multiple
   * targets at the same time in some scenarios.
   */
  main: "Main",
  /**
   * @description Text that refers to the tab target. The tab target is the Chrome tab that
   * DevTools is connected to. This text is used in various places in the UI as a label/name to inform
   * the user which target they are currently connected to, as DevTools may connect to multiple
   * targets at the same time in some scenarios.
   * @meaning Tab target that's different than the "Tab" of Chrome. (See b/343009012)
   */
  tab: "Tab",
  /**
   * @description A warning shown to the user when JavaScript is disabled on the webpage that
   * DevTools is connected to.
   */
  javascriptIsDisabled: "JavaScript is disabled",
  /**
   * @description Tooltip for the Node.js indicator prompting the user to open dedicated DevTools for Node.js.
   */
  openDedicatedTools: "Open dedicated DevTools for `Node.js`"
};
var str_ = i18n.i18n.registerUIStrings("entrypoints/inspector_main/InspectorMain.ts", UIStrings);
var i18nString = i18n.i18n.getLocalizedString.bind(void 0, str_);
var InspectorMainImpl = class {
  async run() {
    let firstCall = true;
    await SDK.Connections.initMainConnection(async () => {
      const type = Root.Runtime.Runtime.queryParam("v8only") ? SDK.Target.Type.NODE : Root.Runtime.Runtime.queryParam("targetType") === "tab" || Root.Runtime.Runtime.isTraceApp() ? SDK.Target.Type.TAB : SDK.Target.Type.FRAME;
      const waitForDebuggerInPage = type === SDK.Target.Type.FRAME && Root.Runtime.Runtime.queryParam("panel") === "sources";
      const name = type === SDK.Target.Type.FRAME ? i18nString(UIStrings.main) : i18nString(UIStrings.tab);
      const target = SDK.TargetManager.TargetManager.instance().createTarget("main", name, type, null, void 0, waitForDebuggerInPage);
      const waitForPrimaryPageTarget = () => {
        return new Promise((resolve) => {
          const targetManager = SDK.TargetManager.TargetManager.instance();
          targetManager.observeTargets({
            targetAdded: (target2) => {
              if (target2 === targetManager.primaryPageTarget()) {
                target2.setName(i18nString(UIStrings.main));
                resolve(target2);
              }
            },
            targetRemoved: (_) => {
            }
          });
        });
      };
      await waitForPrimaryPageTarget();
      if (!firstCall) {
        return;
      }
      firstCall = false;
      if (waitForDebuggerInPage) {
        const debuggerModel = target.model(SDK.DebuggerModel.DebuggerModel);
        if (debuggerModel) {
          if (!debuggerModel.isReadyToPause()) {
            await debuggerModel.once(SDK.DebuggerModel.Events.DebuggerIsReadyToPause);
          }
          debuggerModel.pause();
        }
      }
      if (type !== SDK.Target.Type.TAB) {
        void target.runtimeAgent().invoke_runIfWaitingForDebugger();
      }
    }, Components.TargetDetachedDialog.TargetDetachedDialog.connectionLost);
    new SourcesPanelIndicator();
    new BackendSettingsSync();
    new MobileThrottling.NetworkPanelIndicator.NetworkPanelIndicator();
    Host.InspectorFrontendHost.InspectorFrontendHostInstance.events.addEventListener(Host.InspectorFrontendHostAPI.Events.ReloadInspectedPage, ({ data: hard }) => {
      SDK.ResourceTreeModel.ResourceTreeModel.reloadAllPages(SDK.TargetManager.TargetManager.instance(), hard);
    });
  }
};
Common.Runnable.registerEarlyInitializationRunnable(() => new InspectorMainImpl());
var ReloadActionDelegate = class {
  handleAction(_context, actionId) {
    switch (actionId) {
      case "inspector-main.reload":
        SDK.ResourceTreeModel.ResourceTreeModel.reloadAllPages(SDK.TargetManager.TargetManager.instance(), false);
        return true;
      case "inspector-main.hard-reload":
        SDK.ResourceTreeModel.ResourceTreeModel.reloadAllPages(SDK.TargetManager.TargetManager.instance(), true);
        return true;
    }
    return false;
  }
};
var FocusDebuggeeActionDelegate = class {
  handleAction(_context, _actionId) {
    const mainTarget = SDK.TargetManager.TargetManager.instance().primaryPageTarget();
    if (!mainTarget) {
      return false;
    }
    void mainTarget.pageAgent().invoke_bringToFront();
    return true;
  }
};
var isNodeProcessRunning = (targetInfos) => {
  return Boolean(targetInfos.find((target) => target.type === "node" && !target.attached));
};
var DEFAULT_VIEW = (input, output, target) => {
  const { nodeProcessRunning } = input;
  Lit.render(html`
    <style>${nodeIcon_css_default}</style>
    <div
        class="node-icon ${!nodeProcessRunning ? "inactive" : ""}"
        title=${i18nString(UIStrings.openDedicatedTools)}
        @click=${() => Host.InspectorFrontendHost.InspectorFrontendHostInstance.openNodeFrontend()}>
    </div>
    `, target);
};
var NodeIndicator = class extends UI.Widget.Widget {
  #view;
  #targetInfos = [];
  #wasShown = false;
  constructor(element, view = DEFAULT_VIEW) {
    super(element, { useShadowDom: true });
    this.#view = view;
    SDK.TargetManager.TargetManager.instance().addEventListener("AvailableTargetsChanged", (event) => {
      this.#targetInfos = event.data;
      this.requestUpdate();
    });
  }
  performUpdate() {
    if (Host.InspectorFrontendHost.isUnderTest()) {
      return;
    }
    const nodeProcessRunning = isNodeProcessRunning(this.#targetInfos);
    if (!this.#wasShown && !nodeProcessRunning) {
      return;
    }
    this.#wasShown = true;
    const input = {
      nodeProcessRunning
    };
    this.#view(input, {}, this.contentElement);
  }
};
var NodeIndicatorProvider = class {
  #toolbarItem;
  #widgetElement;
  constructor() {
    this.#widgetElement = document.createElement("devtools-widget");
    new NodeIndicator(this.#widgetElement);
    this.#toolbarItem = new UI.Toolbar.ToolbarItem(this.#widgetElement);
    this.#toolbarItem.setVisible(false);
  }
  item() {
    return this.#toolbarItem;
  }
};
var SourcesPanelIndicator = class {
  constructor() {
    const disableJavascriptSetting = Common.Settings.Settings.instance().resolve(SDK.SDKSettings.javaScriptDisabledSettingDescriptor);
    disableJavascriptSetting.addChangeListener(javaScriptDisabledChanged);
    javaScriptDisabledChanged();
    function javaScriptDisabledChanged() {
      const warnings = [];
      if (disableJavascriptSetting.get()) {
        warnings.push(i18nString(UIStrings.javascriptIsDisabled));
      }
      UI.InspectorView.InspectorView.instance().setPanelWarnings("sources", warnings);
    }
  }
};
var BackendSettingsSync = class {
  #autoAttachSetting;
  #adBlockEnabledSetting;
  #emulatePageFocusSetting;
  constructor() {
    this.#autoAttachSetting = Common.Settings.Settings.instance().moduleSetting("auto-attach-to-created-pages");
    this.#autoAttachSetting.addChangeListener(this.#updateAutoAttach, this);
    this.#updateAutoAttach();
    this.#adBlockEnabledSetting = Common.Settings.Settings.instance().moduleSetting("network.ad-blocking-enabled");
    this.#adBlockEnabledSetting.addChangeListener(this.#update, this);
    this.#emulatePageFocusSetting = Common.Settings.Settings.instance().resolve(SDK.SDKSettings.emulatePageFocusSettingDescriptor);
    this.#emulatePageFocusSetting.addChangeListener(this.#update, this);
    SDK.TargetManager.TargetManager.instance().addModelListener(SDK.ChildTargetManager.ChildTargetManager, "TargetInfoChanged", this.#targetInfoChanged, this);
    SDK.TargetManager.TargetManager.instance().observeTargets(this);
  }
  #updateTarget(target) {
    if (target.type() !== SDK.Target.Type.FRAME || target.parentTarget()?.type() === SDK.Target.Type.FRAME) {
      return;
    }
    void target.pageAgent().invoke_setAdBlockingEnabled({ enabled: this.#adBlockEnabledSetting.get() });
    void target.emulationAgent().invoke_setFocusEmulationEnabled({ enabled: this.#emulatePageFocusSetting.get() });
  }
  #updateAutoAttach() {
    Host.InspectorFrontendHost.InspectorFrontendHostInstance.setOpenNewWindowForPopups(this.#autoAttachSetting.get());
  }
  #update() {
    for (const target of SDK.TargetManager.TargetManager.instance().targets()) {
      this.#updateTarget(target);
    }
  }
  #targetInfoChanged(event) {
    const targetManager = SDK.TargetManager.TargetManager.instance();
    const target = targetManager.targetById(event.data.targetId);
    if (!target || target.outermostTarget() !== target) {
      return;
    }
    this.#updateTarget(target);
  }
  targetAdded(target) {
    this.#updateTarget(target);
  }
  targetRemoved(_target) {
  }
};
SDK.ChildTargetManager.ChildTargetManager.install();

// gen/front_end/entrypoints/inspector_main/OutermostTargetSelector.js
var OutermostTargetSelector_exports = {};
__export(OutermostTargetSelector_exports, {
  OutermostTargetSelector: () => OutermostTargetSelector
});
import * as i18n3 from "./..\\..\\core\\i18n\\i18n.js";
import * as Platform from "./..\\..\\core\\platform\\platform.js";
import * as SDK2 from "./..\\..\\core\\sdk\\sdk.js";
import * as Bindings from "./..\\..\\models\\bindings\\bindings.js";
import * as UI2 from "./..\\..\\ui\\legacy\\legacy.js";

// gen/front_end/entrypoints/inspector_main/outermostTargetSelector.css.js
var outermostTargetSelector_css_default = `/*
 * Copyright 2023 The Chromium Authors
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

:host {
  padding: 2px 1px 2px 2px;
  white-space: nowrap;
  display: flex;
  flex-direction: column;
  height: 36px;
  justify-content: center;
  overflow-y: auto;
}

.title {
  overflow: hidden;
  padding-left: 8px;
  text-overflow: ellipsis;
  flex-grow: 0;
}

.subtitle {
  color: var(--sys-color-token-subtle);
  margin-right: 3px;
  overflow: hidden;
  padding-left: 8px;
  text-overflow: ellipsis;
  flex-grow: 0;
}

:host(.highlighted) .subtitle {
  color: inherit;
}

/*# sourceURL=${import.meta.resolve("./outermostTargetSelector.css")} */`;

// gen/front_end/entrypoints/inspector_main/OutermostTargetSelector.js
var UIStrings2 = {
  /**
   * @description Title of toolbar item in outermost target selector in the main toolbar.
   */
  targetNotSelected: "Page: Not selected",
  /**
   * @description Title of toolbar item in outermost target selector in the main toolbar.
   * @example {top} PH1
   */
  targetS: "Page: {PH1}"
};
var str_2 = i18n3.i18n.registerUIStrings("entrypoints/inspector_main/OutermostTargetSelector.ts", UIStrings2);
var i18nString2 = i18n3.i18n.getLocalizedString.bind(void 0, str_2);
var OutermostTargetSelector = class {
  listItems = new UI2.ListModel.ListModel();
  #dropDown;
  #toolbarItem;
  constructor() {
    this.#dropDown = new UI2.SoftDropDown.SoftDropDown(this.listItems, this);
    this.#dropDown.setRowHeight(36);
    this.#toolbarItem = new UI2.Toolbar.ToolbarItem(this.#dropDown.element);
    this.#toolbarItem.setTitle(i18nString2(UIStrings2.targetNotSelected));
    this.listItems.addEventListener("ItemsReplaced", () => this.#toolbarItem.setEnabled(Boolean(this.listItems.length)));
    this.#toolbarItem.element.classList.add("toolbar-has-dropdown");
    const targetManager = SDK2.TargetManager.TargetManager.instance();
    targetManager.addModelListener(SDK2.ChildTargetManager.ChildTargetManager, "TargetInfoChanged", this.#onTargetInfoChanged, this);
    targetManager.addEventListener("NameChanged", this.#onInspectedURLChanged, this);
    targetManager.observeTargets(this);
    UI2.Context.Context.instance().addFlavorChangeListener(SDK2.Target.Target, this.#targetChanged, this);
  }
  item() {
    return this.#toolbarItem;
  }
  highlightedItemChanged(_from, _to, fromElement, toElement) {
    if (fromElement) {
      fromElement.classList.remove("highlighted");
    }
    if (toElement) {
      toElement.classList.add("highlighted");
    }
  }
  titleFor(target) {
    return target.name();
  }
  targetAdded(target) {
    if (target.outermostTarget() !== target) {
      return;
    }
    this.listItems.insertWithComparator(target, this.#targetComparator());
    this.#toolbarItem.setVisible(this.listItems.length > 1);
    const primaryTarget = SDK2.TargetManager.TargetManager.instance().primaryPageTarget();
    if (target === primaryTarget || target === UI2.Context.Context.instance().flavor(SDK2.Target.Target)) {
      this.#dropDown.selectItem(target);
    }
  }
  targetRemoved(target) {
    const index = this.listItems.indexOf(target);
    if (index === -1) {
      return;
    }
    this.listItems.remove(index);
    this.#toolbarItem.setVisible(this.listItems.length > 1);
  }
  #targetComparator() {
    return (a, b) => {
      const aTargetInfo = a.targetInfo();
      const bTargetInfo = b.targetInfo();
      if (!aTargetInfo || !bTargetInfo) {
        return 0;
      }
      if (!aTargetInfo.subtype?.length && bTargetInfo.subtype?.length) {
        return -1;
      }
      if (aTargetInfo.subtype?.length && !bTargetInfo.subtype?.length) {
        return 1;
      }
      return aTargetInfo.url.localeCompare(bTargetInfo.url);
    };
  }
  #onTargetInfoChanged(event) {
    const targetManager = SDK2.TargetManager.TargetManager.instance();
    const target = targetManager.targetById(event.data.targetId);
    if (!target || target.outermostTarget() !== target) {
      return;
    }
    this.targetRemoved(target);
    this.targetAdded(target);
  }
  #onInspectedURLChanged(event) {
    const target = event.data;
    if (!target || target.outermostTarget() !== target) {
      return;
    }
    this.targetRemoved(target);
    this.targetAdded(target);
  }
  #targetChanged({ data: target }) {
    this.#dropDown.selectItem(target?.outermostTarget() || null);
  }
  createElementForItem(item) {
    const element = document.createElement("div");
    element.classList.add("target");
    const shadowRoot = UI2.UIUtils.createShadowRootWithCoreStyles(element, { cssFile: outermostTargetSelector_css_default });
    const title = shadowRoot.createChild("div", "title");
    UI2.UIUtils.createTextChild(title, Platform.StringUtilities.trimEndWithMaxLength(this.titleFor(item), 100));
    const subTitle = shadowRoot.createChild("div", "subtitle");
    UI2.UIUtils.createTextChild(subTitle, this.#subtitleFor(item));
    return element;
  }
  #subtitleFor(target) {
    const targetInfo = target.targetInfo();
    if (target === SDK2.TargetManager.TargetManager.instance().primaryPageTarget() && targetInfo) {
      return Bindings.ResourceUtils.displayNameForURL(targetInfo.url);
    }
    return target.targetInfo()?.subtype || "";
  }
  isItemSelectable(_item) {
    return true;
  }
  itemSelected(item) {
    const title = item ? i18nString2(UIStrings2.targetS, { PH1: this.titleFor(item) }) : i18nString2(UIStrings2.targetNotSelected);
    this.#toolbarItem.setTitle(title);
    if (item && item !== UI2.Context.Context.instance().flavor(SDK2.Target.Target)?.outermostTarget()) {
      UI2.Context.Context.instance().setFlavor(SDK2.Target.Target, item);
    }
  }
};
export {
  InspectorMain_exports as InspectorMain,
  OutermostTargetSelector_exports as OutermostTargetSelector
};
//# sourceMappingURL=inspector_main.js.map
